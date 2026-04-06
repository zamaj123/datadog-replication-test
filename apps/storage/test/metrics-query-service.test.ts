import { describe, expect, it } from "vitest";

import { queryMetricSeries } from "../src/services/metrics-query-service.js";
import type { MetricQuery } from "../src/services/metrics-query-types.js";

function buildQuery(overrides: Partial<MetricQuery> = {}): MetricQuery {
  return {
    start: "2026-04-02T08:00:00.123456Z",
    end: "2026-04-02T10:00:00.654321Z",
    name: "http.request.duration",
    agg: "avg",
    groupBy: [],
    filters: {},
    ...overrides,
  };
}

describe("metrics query service", () => {
  it("uses exact nanosecond boundaries in the clickhouse query", async () => {
    let capturedSql = "";

    const clickhouse = {
      queryJsonEachRow: async <T>(sql: string) => {
        capturedSql = sql;
        return [] as T[];
      },
    };

    const query = buildQuery();
    await queryMetricSeries(query, clickhouse as never);

    const expectedStartNanos = (BigInt(Date.parse(query.start)) * 1_000_000n).toString();
    const expectedEndNanos = (BigInt(Date.parse(query.end)) * 1_000_000n).toString();

    expect(capturedSql).toContain(`timestamp >= fromUnixTimestamp64Nano(${expectedStartNanos})`);
    expect(capturedSql).toContain(`timestamp < fromUnixTimestamp64Nano(${expectedEndNanos})`);
  });

  it("preserves raw points for auto-selected short ranges", async () => {
    const clickhouse = {
      queryJsonEachRow: async <T>() =>
        [
          {
            timestamp_ms: Date.parse("2026-04-02T09:00:05.000Z"),
            service_name: "api-server",
            environment: "production",
            name: "http.request.duration",
            tags: {},
            value: 143.2,
          },
          {
            timestamp_ms: Date.parse("2026-04-02T09:00:45.000Z"),
            service_name: "api-server",
            environment: "production",
            name: "http.request.duration",
            tags: {},
            value: 156.8,
          },
        ] as T[],
    };

    const response = await queryMetricSeries(
      buildQuery({
        start: "2026-04-02T08:00:00Z",
        end: "2026-04-02T10:00:00Z",
      }),
      clickhouse as never,
    );

    expect(response).toEqual({
      name: "http.request.duration",
      step: "1m",
      agg: "avg",
      truncated: false,
      series: [
        {
          labels: {},
          points: [
            { timestamp: "2026-04-02T09:00:05.000Z", value: 143.2 },
            { timestamp: "2026-04-02T09:00:45.000Z", value: 156.8 },
          ],
        },
      ],
    });
  });
});
