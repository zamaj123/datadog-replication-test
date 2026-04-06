import { describe, expect, it } from "vitest";

import { getServiceSummary, listEnvironments, listServices } from "../src/services/services-query-service.js";

describe("services query service", () => {
  it("returns distinct environments", async () => {
    const clickhouse = {
      queryJsonEachRow: async <T>() =>
        [{ environment: "production" }, { environment: "staging" }] as T[],
    };

    await expect(listEnvironments(clickhouse as never)).resolves.toEqual({
      environments: ["production", "staging"],
    });
  });

  it("computes services list aggregates from metrics rows", async () => {
    const clickhouse = {
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
          {
            timestamp_ms: Date.parse("2026-04-02T09:05:10.000Z"),
            service_name: "worker",
            environment: "production",
            name: "runtime.cpu.usage",
            unit: "",
            tags: {},
            value: 0.8,
          },
        ] as T[],
    };

    const response = await listServices(
      {
        start: "2026-04-02T09:00:00.000Z",
        end: "2026-04-02T10:00:00.000Z",
        environment: "production",
      },
      clickhouse as never,
    );

    expect(response).toEqual({
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
        {
          service_name: "worker",
          environment: "production",
          last_seen: "2026-04-02T09:05:10.000Z",
          request_rate_per_sec: 0,
          error_rate: 0,
          p99_latency_ns: 0,
          log_count: 0,
        },
      ],
    });
  });

  it("computes service summary aggregates across matching rows", async () => {
    const clickhouse = {
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
    };

    const response = await getServiceSummary(
      {
        serviceName: "api-server",
        environment: "production",
        start: "2026-04-02T09:00:00.000Z",
        end: "2026-04-02T10:00:00.000Z",
      },
      clickhouse as never,
    );

    expect(response).toEqual({
      service_name: "api-server",
      environment: "production",
      start: "2026-04-02T09:00:00.000Z",
      end: "2026-04-02T10:00:00.000Z",
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
});
