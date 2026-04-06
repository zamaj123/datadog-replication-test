import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const metricsSchemaPath = path.resolve(__dirname, "../migrations/clickhouse/001_metrics.sql");

describe("metrics ClickHouse schema", () => {
  it("defines the canonical metrics table in the default database", async () => {
    const sql = await readFile(metricsSchemaPath, "utf8");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS metrics");
    expect(sql).toContain("timestamp DateTime64(9, 'UTC')");
    expect(sql).toContain("service_name LowCardinality(String)");
    expect(sql).toContain("environment LowCardinality(String)");
    expect(sql).toContain("host LowCardinality(String)");
    expect(sql).toContain("version LowCardinality(String)");
    expect(sql).toContain("name LowCardinality(String)");
    expect(sql).toContain("type LowCardinality(String)");
    expect(sql).toContain("unit LowCardinality(String)");
    expect(sql).toContain("value Float64");
    expect(sql).toContain("tags Map(String, String)");
    expect(sql).toContain("ENGINE = MergeTree()");
    expect(sql).toContain("ORDER BY (service_name, environment, name, timestamp)");
    expect(sql).toContain("TTL toDateTime(timestamp) + INTERVAL 30 DAY");
  });
});
