import { describe, expect, it } from "vitest";

import {
  buildMilestoneMetricCase,
  loadMilestoneEmitterEnv,
} from "../src/scripts/milestone-env-metrics-lib";

describe("loadMilestoneEmitterEnv", () => {
  it("loads DD-style env inputs and defaults version to empty string", () => {
    const env = loadMilestoneEmitterEnv(
      {
        DD_API_KEY: "sample-api-key",
        DD_ENV: "production",
        DD_SERVICE: "checkout-api",
        DD_SITE: "http://localhost:3001",
      }
    );

    expect(env).toEqual({
      apiKey: "sample-api-key",
      environment: "production",
      serviceName: "checkout-api",
      site: "http://localhost:3001",
      version: "",
    });
  });

  it("prefers explicit DD_VERSION and DD_SITE values", () => {
    const env = loadMilestoneEmitterEnv({
      DD_API_KEY: "sample-api-key",
      DD_ENV: "production",
      DD_SERVICE: "checkout-api",
      DD_SITE: "http://localhost:3001",
      DD_VERSION: "v1.2.3",
    });

    expect(env.version).toBe("v1.2.3");
    expect(env.site).toBe("http://localhost:3001");
  });
});

describe("buildMilestoneMetricCase", () => {
  it("builds the required milestone metric set from DD-style identity inputs", () => {
    const milestone = buildMilestoneMetricCase(
      {
        apiKey: "sample-api-key",
        environment: "production",
        serviceName: "checkout-api",
        site: "http://localhost:3001",
        version: "v1.2.3",
      },
      1_711_234_567_890,
    );

    expect(milestone.expectedAcceptedMetrics).toBe(7);
    expect(milestone.expectedWrittenMetricNames).toEqual([
      "service.requests.count",
      "service.errors.count",
      "service.request.duration",
      "service.request.duration_count",
      "service.request.duration_sum",
      "runtime.cpu.usage",
      "runtime.memory.usage",
      "runtime.heap.used",
      "runtime.event_loop.delay",
    ]);
    expect(milestone.serviceMetricNames).toEqual([
      "service.requests.count",
      "service.errors.count",
      "service.request.duration",
      "runtime.cpu.usage",
      "runtime.memory.usage",
      "runtime.heap.used",
      "runtime.event_loop.delay",
    ]);
    expect(milestone.start).toBe("2024-03-23T22:55:07.890Z");
    expect(milestone.end).toBe("2024-03-23T22:57:07.890Z");
    expect(milestone.payload.metrics).toHaveLength(7);
    expect(milestone.payload.metrics[0]).toMatchObject({
      resource: {
        "deployment.environment": "production",
        "service.name": "checkout-api",
        "service.version": "v1.2.3",
      },
      name: "service.requests.count",
      type: "counter",
      value: 7,
      tags: {
        endpoint: "/checkout",
        "http.method": "POST",
        "http.status_code": "200",
      },
    });
    expect(milestone.payload.metrics[2]).toMatchObject({
      name: "service.request.duration",
      type: "histogram",
      unit: "ns",
      count: 7,
      sum: 785_000_000,
    });
  });
});
