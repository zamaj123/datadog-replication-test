import { describe, expect, it } from "vitest";

import { handleMetrics } from "../src/pipeline/handle-metrics";

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
});
