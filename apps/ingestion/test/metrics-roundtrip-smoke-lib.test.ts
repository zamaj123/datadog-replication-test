import { describe, expect, it } from "vitest";

import { buildSmokeMetricCase } from "../src/scripts/metrics-roundtrip-smoke-lib";

describe("buildSmokeMetricCase", () => {
  it("builds a unique payload and bounded storage query window", () => {
    const smoke = buildSmokeMetricCase(1_711_234_567_890);

    expect(smoke.serviceName).toBe("smoke-service-1711234567890");
    expect(smoke.metricName).toBe("smoke.metric.1711234567890");
    expect(smoke.environment).toBe("production");
    expect(smoke.start).toBe("2024-03-23T22:55:07.890Z");
    expect(smoke.end).toBe("2024-03-23T22:57:07.890Z");
    expect(smoke.payload).toEqual({
      metrics: [
        {
          resource: {
            "service.name": "smoke-service-1711234567890",
            "deployment.environment": "production",
          },
          timestamp: 1_711_234_567_890,
          name: "smoke.metric.1711234567890",
          type: "counter",
          value: 1,
          tags: {
            source: "metrics-roundtrip-smoke",
          },
        },
      ],
    });
  });
});
