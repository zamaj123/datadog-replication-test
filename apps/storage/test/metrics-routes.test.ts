import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/server/app.js";

describe("metrics routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({
      port: 3000,
      apiKey: "test-key",
      frontendDevOrigin: "http://localhost:5173",
      clickhouse: null,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns explicit error when clickhouse is not configured for metric names", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/metrics/names?service_name=api-server&environment=production",
      headers: { "x-api-key": "test-key" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "clickhouse is not configured",
      code: "service_unavailable",
    });
  });

  it("returns explicit error when clickhouse is not configured for metric query", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/metrics/query?start=2026-04-02T08:00:00Z&end=2026-04-02T12:00:00Z&name=http.request.duration&service_name=api-server&environment=production&group_by=http.method&agg=avg",
      headers: { "x-api-key": "test-key" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "clickhouse is not configured",
      code: "service_unavailable",
    });
  });

  it("returns contract error shape for missing required params", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/metrics/query?end=2026-04-02T12:00:00Z&name=http.request.duration",
      headers: { "x-api-key": "test-key" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "missing required parameter: start",
      code: "bad_request",
    });
  });

  it("rejects missing api key", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/metrics/names",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "unauthorized",
      code: "unauthorized",
    });
  });

  it("handles cors preflight for the frontend dev origin", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/metrics/query",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-api-key",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(response.headers["access-control-allow-headers"]).toBe("X-Api-Key, Content-Type");
    expect(response.headers["access-control-allow-methods"]).toBe("GET, OPTIONS");
    expect(response.headers.vary).toBe("Origin");
  });

  it("returns cors headers for requests from the frontend dev origin", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/metrics/names",
      headers: {
        origin: "http://localhost:5173",
        "x-api-key": "test-key",
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(response.headers["access-control-allow-headers"]).toBe("X-Api-Key, Content-Type");
    expect(response.headers["access-control-allow-methods"]).toBe("GET, OPTIONS");
    expect(response.headers.vary).toBe("Origin");
  });

  it("returns a contract-shaped metrics response when clickhouse is configured", async () => {
    app.storage.clickhouse = {
      queryJsonEachRow: async <T>() =>
        [
          {
            timestamp_ms: Date.parse("2026-04-02T09:00:05.000Z"),
            service_name: "api-server",
            environment: "production",
            name: "http.request.duration",
            tags: { "http.method": "POST" },
            value: 143.2,
          },
          {
            timestamp_ms: Date.parse("2026-04-02T09:00:45.000Z"),
            service_name: "api-server",
            environment: "production",
            name: "http.request.duration",
            tags: { "http.method": "POST" },
            value: 156.8,
          },
        ] as T[],
    } as never;

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/metrics/query?start=2026-04-02T08:00:00Z&end=2026-04-02T10:00:00Z&name=http.request.duration&service_name=api-server&environment=production&group_by=http.method&agg=avg",
      headers: { "x-api-key": "test-key" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      name: "http.request.duration",
      step: "raw",
      agg: "avg",
      truncated: false,
      series: [
        {
          labels: { "http.method": "POST" },
          points: [
            { timestamp: "2026-04-02T09:00:05.000Z", value: 143.2 },
            { timestamp: "2026-04-02T09:00:45.000Z", value: 156.8 },
          ],
        },
      ],
    });
  });
});
