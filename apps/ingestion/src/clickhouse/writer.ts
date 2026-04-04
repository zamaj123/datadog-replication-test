import { Buffer } from "node:buffer";

import { ClickHouseEnv } from "../config/env";
import { MetricWriteRow } from "../types/metrics";

export interface MetricsWriter {
  writeMetrics(rows: MetricWriteRow[]): Promise<void>;
}

export class ClickHouseMetricsWriter implements MetricsWriter {
  constructor(private readonly config: ClickHouseEnv) {}

  async writeMetrics(rows: MetricWriteRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const sql = `INSERT INTO ${this.config.database}.metrics FORMAT JSONEachRow`;
    const url = new URL(`http://${this.config.host}:${this.config.port}/`);
    url.searchParams.set("query", sql);

    const body = rows
      .map((row) =>
        JSON.stringify({
          ...row,
          timestamp: row.timestamp.toString()
        })
      )
      .join("\n");

    const authorization = Buffer.from(`${this.config.user}:${this.config.password}`).toString("base64");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Basic ${authorization}`,
        "content-type": "text/plain; charset=utf-8"
      },
      body
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`clickhouse write failed: ${response.status} ${errorText}`.trim());
    }
  }
}
