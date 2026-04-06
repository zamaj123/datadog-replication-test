import { describe, expect, it } from "vitest";

import { handleMetrics } from "../src/pipeline/handle-metrics";
import { buildMilestoneMetricCase } from "../src/scripts/milestone-env-metrics-lib";

describe("handleMetrics", () => {
  it("expands histograms into bucket, count, and sum rows", () => {
    const result = handleMetrics({
      metrics: [
        {
          resource: {
            "service.name": "api",
            "deployment.environment": "production"
          },
          timestamp: 1711234567890,
          name: "http.request.duration",
          type: "histogram",
          unit: "ms",
          tags: {
            "http.method": "GET"
          },
          buckets: [
            { upper_bound: 50, count: 10 },
            { upper_bound: 100, count: 25 }
          ],
          count: 25,
          sum: 813.2
        }
      ]
    });

    expect(result.response.accepted).toBe(1);
    expect(result.response.rejected).toBe(0);
    expect(result.rows).toHaveLength(4);
    expect(result.rows[0].tags.le).toBe("50");
    expect(result.rows[2].name).toBe("http.request.duration_count");
    expect(result.rows[3].name).toBe("http.request.duration_sum");
  });

  it("rejects malformed metric tag keys", () => {
    const result = handleMetrics({
      metrics: [
        {
          resource: {
            "service.name": "api",
            "deployment.environment": "production"
          },
          timestamp: 1711234567890,
          name: "http.request.count",
          type: "counter",
          value: 1,
          tags: {
            "bad-tag": "x"
          }
        }
      ]
    });

    expect(result.response.accepted).toBe(0);
    expect(result.response.rejected).toBe(1);
    expect(result.response.errors?.[0]?.field).toBe("tags");
  });

  it("accepts the milestone metric set and preserves canonical identity", () => {
    const milestone = buildMilestoneMetricCase(
      {
        apiKey: "secret",
        environment: "production",
        serviceName: "checkout-api",
        site: "http://localhost:3001",
        version: "v1.2.3",
      },
      1_711_234_567_890,
    );

    const result = handleMetrics(milestone.payload);
    const rowNames = result.rows.map((row) => row.name).sort();

    expect(result.response).toEqual({ accepted: 7, rejected: 0 });
    expect(result.rows).toHaveLength(11);
    expect(rowNames).toEqual(
      [
        "runtime.cpu.usage",
        "runtime.event_loop.delay",
        "runtime.heap.used",
        "runtime.memory.usage",
        "service.errors.count",
        "service.request.duration",
        "service.request.duration",
        "service.request.duration",
        "service.request.duration_count",
        "service.request.duration_sum",
        "service.requests.count",
      ].sort(),
    );

    for (const row of result.rows) {
      expect(row.service_name).toBe("checkout-api");
      expect(row.environment).toBe("production");
      expect(row.version).toBe("v1.2.3");
      expect(row.timestamp).toBe(1_711_234_567_890_000_000n);
    }

    expect(result.rows.find((row) => row.name === "service.requests.count")?.tags).toEqual({
      endpoint: "/checkout",
      "http.method": "POST",
      "http.status_code": "200",
    });
    expect(result.rows.find((row) => row.name === "service.errors.count")?.tags).toEqual({
      endpoint: "/checkout",
      "http.method": "POST",
      "http.status_code": "500",
    });
    expect(result.rows.find((row) => row.name === "runtime.cpu.usage")?.tags).toEqual({});
  });
});
