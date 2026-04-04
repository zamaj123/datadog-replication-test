import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/server/app.js";

describe("metrics routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ port: 3000, apiKey: "test-key" });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns names with canonical response shape", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/metrics/names?service_name=api-server&environment=production",
      headers: { "x-api-key": "test-key" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      names: ["http.request.count", "http.request.duration"],
    });
  });

  it("returns grouped metric series with canonical fields", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/metrics/query?start=2026-04-02T08:00:00Z&end=2026-04-02T12:00:00Z&name=http.request.duration&service_name=api-server&environment=production&group_by=http.method&agg=avg",
      headers: { "x-api-key": "test-key" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      name: "http.request.duration",
      step: "1m",
      agg: "avg",
      truncated: false,
      series: [
        {
          labels: { "http.method": "GET" },
          points: [{ timestamp: "2026-04-02T09:00:00.000Z", value: 12.5 }],
        },
        {
          labels: { "http.method": "POST" },
          points: [
            { timestamp: "2026-04-02T09:00:00.000Z", value: 143.2 },
            { timestamp: "2026-04-02T09:01:00.000Z", value: 156.8 },
          ],
        },
      ],
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
});

