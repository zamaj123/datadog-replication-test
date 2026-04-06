import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/server/app.js";

describe("service routes", () => {
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

  it("returns explicit error when clickhouse is not configured for services", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/services?start=2026-04-02T09:00:00Z&end=2026-04-02T10:00:00Z",
      headers: { "x-api-key": "test-key" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "clickhouse is not configured",
      code: "service_unavailable",
    });
  });

  it("returns a contract-shaped services list when clickhouse is configured", async () => {
    app.storage.clickhouse = {
      queryJsonEachRow: async <T>() =>
        [
          {
            timestamp_ms: Date.parse("2026-04-02T09:05:13.000Z"),
            service_name: "api-server",
            environment: "production",
            name: "service.requests.count",
            unit: "",
            tags: {},
            value: 120,
          },
          {
            timestamp_ms: Date.parse("2026-04-02T09:04:13.000Z"),
            service_name: "api-server",
            environment: "production",
            name: "service.errors.count",
            unit: "",
            tags: {},
            value: 6,
          },
          {
            timestamp_ms: Date.parse("2026-04-02T09:03:13.000Z"),
            service_name: "api-server",
            environment: "production",
            name: "service.request.duration",
            unit: "ms",
            tags: { le: "50" },
            value: 60,
          },
          {
            timestamp_ms: Date.parse("2026-04-02T09:03:13.000Z"),
            service_name: "api-server",
            environment: "production",
            name: "service.request.duration",
            unit: "ms",
            tags: { le: "100" },
            value: 110,
          },
          {
            timestamp_ms: Date.parse("2026-04-02T09:03:13.000Z"),
            service_name: "api-server",
            environment: "production",
            name: "service.request.duration",
            unit: "ms",
            tags: { le: "250" },
            value: 120,
          },
          {
            timestamp_ms: Date.parse("2026-04-02T09:03:13.000Z"),
            service_name: "api-server",
            environment: "production",
            name: "service.request.duration_count",
            unit: "ms",
            tags: {},
            value: 120,
          },
        ] as T[],
    } as never;

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/services?start=2026-04-02T09:00:00Z&end=2026-04-02T10:00:00Z&environment=production",
      headers: { "x-api-key": "test-key" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      services: [
        {
          service_name: "api-server",
          environment: "production",
          last_seen: "2026-04-02T09:05:13.000Z",
          request_rate_per_sec: 120 / 3600,
          error_rate: 0.05,
          p99_latency_ns: 250_000_000,
          log_count: 0,
        },
      ],
    });
  });

  it("returns a contract-shaped service summary when clickhouse is configured", async () => {
    app.storage.clickhouse = {
      queryJsonEachRow: async <T>() =>
        [
          {
            timestamp_ms: Date.parse("2026-04-02T09:05:13.000Z"),
            service_name: "api-server",
            environment: "production",
            name: "service.requests.count",
            unit: "",
            tags: {},
            value: 100,
          },
          {
            timestamp_ms: Date.parse("2026-04-02T09:05:10.000Z"),
            service_name: "api-server",
            environment: "production",
            name: "service.errors.count",
            unit: "",
            tags: {},
            value: 5,
          },
          {
            timestamp_ms: Date.parse("2026-04-02T09:05:00.000Z"),
            service_name: "api-server",
            environment: "production",
            name: "service.request.duration",
            unit: "ms",
            tags: { le: "50" },
            value: 40,
          },
          {
            timestamp_ms: Date.parse("2026-04-02T09:05:00.000Z"),
            service_name: "api-server",
            environment: "production",
            name: "service.request.duration",
            unit: "ms",
            tags: { le: "100" },
            value: 85,
          },
          {
            timestamp_ms: Date.parse("2026-04-02T09:05:00.000Z"),
            service_name: "api-server",
            environment: "production",
            name: "service.request.duration",
            unit: "ms",
            tags: { le: "250" },
            value: 100,
          },
          {
            timestamp_ms: Date.parse("2026-04-02T09:05:00.000Z"),
            service_name: "api-server",
            environment: "production",
            name: "service.request.duration_count",
            unit: "ms",
            tags: {},
            value: 100,
          },
        ] as T[],
    } as never;

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/services/api-server/summary?start=2026-04-02T09:00:00Z&end=2026-04-02T10:00:00Z&environment=production",
      headers: { "x-api-key": "test-key" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service_name: "api-server",
      environment: "production",
      start: "2026-04-02T09:00:00Z",
      end: "2026-04-02T10:00:00Z",
      last_seen: "2026-04-02T09:05:13.000Z",
      request_rate_per_sec: 100 / 3600,
      error_rate: 0.05,
      p50_latency_ns: 100_000_000,
      p95_latency_ns: 250_000_000,
      p99_latency_ns: 250_000_000,
      log_count: 0,
      active_alert_count: 0,
    });
  });

  it("returns environments from clickhouse when configured", async () => {
    app.storage.clickhouse = {
      queryJsonEachRow: async <T>() =>
        [{ environment: "production" }, { environment: "staging" }] as T[],
    } as never;

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/environments",
      headers: { "x-api-key": "test-key" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      environments: ["production", "staging"],
    });
  });
});
