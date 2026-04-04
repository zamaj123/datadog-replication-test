import { describe, expect, it } from "vitest";

import { NoopMetricsWriter } from "../src/clickhouse/writer";
import { buildApp } from "../src/server/app";

describe("POST /v1/metrics", () => {
  it("returns 401 when the api key is missing", async () => {
    const app = await buildApp({
      env: { port: 3001, ingestionApiKey: "secret" },
      metricsWriter: new NoopMetricsWriter()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/metrics",
      headers: { "content-type": "application/json" },
      payload: { metrics: [] }
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("accepts a valid metric event", async () => {
    const app = await buildApp({
      env: { port: 3001, ingestionApiKey: "secret" },
      metricsWriter: new NoopMetricsWriter()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/metrics",
      headers: {
        "content-type": "application/json",
        "x-api-key": "secret"
      },
      payload: {
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
              "http.method": "POST"
            }
          }
        ]
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: 1, rejected: 0 });
    await app.close();
  });

  it("returns 400 for partial validation failure", async () => {
    const app = await buildApp({
      env: { port: 3001, ingestionApiKey: "secret" },
      metricsWriter: new NoopMetricsWriter()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/metrics",
      headers: {
        "content-type": "application/json",
        "x-api-key": "secret"
      },
      payload: {
        metrics: [
          {
            resource: {
              "service.name": "api",
              "deployment.environment": "production"
            },
            timestamp: 1711234567890,
            name: "http.request.count",
            type: "counter",
            value: 1
          },
          {
            resource: {
              "service.name": "",
              "deployment.environment": "production"
            },
            timestamp: 1711234567890,
            name: "http.request.count",
            type: "counter",
            value: 1
          }
        ]
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      accepted: 1,
      rejected: 1
    });
    await app.close();
  });
});
