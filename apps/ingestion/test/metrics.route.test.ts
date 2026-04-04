import { describe, expect, it } from "vitest";

import { MetricsWriter } from "../src/clickhouse/writer";
import { buildApp } from "../src/server/app";

class RecordingWriter implements MetricsWriter {
  public rowsWritten = 0;

  async writeMetrics(rows: Parameters<MetricsWriter["writeMetrics"]>[0]): Promise<void> {
    this.rowsWritten += rows.length;
  }
}

const testEnv = {
  port: 3001,
  ingestionApiKey: "secret",
  clickhouse: {
    host: "localhost",
    port: 8123,
    database: "default",
    user: "default",
    password: "password"
  }
} as const;

describe("POST /v1/metrics", () => {
  it("returns 401 when the api key is missing", async () => {
    const app = await buildApp({
      env: testEnv,
      metricsWriter: new RecordingWriter()
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
    const writer = new RecordingWriter();
    const app = await buildApp({
      env: testEnv,
      metricsWriter: writer
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
    expect(writer.rowsWritten).toBe(1);
    await app.close();
  });

  it("returns 400 for partial validation failure", async () => {
    const app = await buildApp({
      env: testEnv,
      metricsWriter: new RecordingWriter()
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

  it("registers logs and traces routes so they do not 404", async () => {
    const app = await buildApp({
      env: testEnv,
      metricsWriter: new RecordingWriter()
    });

    const logsResponse = await app.inject({
      method: "POST",
      url: "/v1/logs",
      headers: {
        "content-type": "application/json",
        "x-api-key": "secret"
      },
      payload: {}
    });

    const tracesResponse = await app.inject({
      method: "POST",
      url: "/v1/traces",
      headers: {
        "content-type": "application/json",
        "x-api-key": "secret"
      },
      payload: {}
    });

    expect(logsResponse.statusCode).toBe(501);
    expect(tracesResponse.statusCode).toBe(501);
    await app.close();
  });
});
