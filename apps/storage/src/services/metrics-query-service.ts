import { ClickHouseClient, sqlIdentifier, sqlString } from "../lib/clickhouse.js";
import type {
  MetricNamesResponse,
  MetricPoint,
  MetricQuery,
  MetricQueryResponse,
  MetricRow,
} from "./metrics-query-types.js";
import { autoSelectStep, stepToBucketMs } from "./step-selection.js";

function isoToMs(timestamp: string): number {
  return new Date(timestamp).getTime();
}

function bucketTimestamp(timestampMs: number, bucketMs: number | null): number {
  if (bucketMs === null) {
    return timestampMs;
  }

  return Math.floor(timestampMs / bucketMs) * bucketMs;
}

function formatIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function percentile(values: number[], percentileRank: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((percentileRank / 100) * sorted.length) - 1);
  return sorted[index] ?? sorted[sorted.length - 1];
}

function aggregate(values: number[], agg: string): number {
  switch (agg) {
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "sum":
      return values.reduce((sum, value) => sum + value, 0);
    case "count":
      return values.length;
    case "p50":
      return percentile(values, 50);
    case "p95":
      return percentile(values, 95);
    case "p99":
      return percentile(values, 99);
    case "avg":
    default:
      return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
}

function defaultLabels(query: MetricQuery): Record<string, string> {
  const labels: Record<string, string> = {};

  if (query.serviceName) {
    labels.service_name = query.serviceName;
  }

  if (query.environment) {
    labels.environment = query.environment;
  }

  for (const [key, value] of Object.entries(query.filters)) {
    labels[key] = value;
  }

  return labels;
}

function labelValueForDimension(row: MetricRow, dimension: string): string {
  if (dimension === "service_name") {
    return row.service_name;
  }

  if (dimension === "environment") {
    return row.environment;
  }

  return row.tags[dimension] ?? "";
}

function shapeMetricSeries(rows: MetricRow[], query: MetricQuery): MetricQueryResponse {
  const startMs = Date.parse(query.start);
  const endMs = Date.parse(query.end);
  const selectedStep = query.step ?? autoSelectStep(startMs, endMs);
  const bucketMs = stepToBucketMs(selectedStep);
  const seriesMap = new Map<string, { labels: Record<string, string>; points: Map<number, number[]> }>();

  for (const row of rows) {
    const labels =
      query.groupBy.length === 0
        ? defaultLabels(query)
        : Object.fromEntries(query.groupBy.map((dimension) => [dimension, labelValueForDimension(row, dimension)]));
    const seriesKey = JSON.stringify(labels);
    const pointKey = bucketTimestamp(isoToMs(row.timestamp), bucketMs);
    const existingSeries = seriesMap.get(seriesKey) ?? { labels, points: new Map<number, number[]>() };
    const values = existingSeries.points.get(pointKey) ?? [];

    values.push(row.value);
    existingSeries.points.set(pointKey, values);
    seriesMap.set(seriesKey, existingSeries);
  }

  const series = [...seriesMap.values()]
    .map((entry) => {
      const points: MetricPoint[] = [...entry.points.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([timestampMs, values]) => ({
          timestamp: formatIso(timestampMs),
          value: aggregate(values, query.agg),
        }));

      return { labels: entry.labels, points };
    })
    .sort((left, right) => JSON.stringify(left.labels).localeCompare(JSON.stringify(right.labels)));

  return {
    name: query.name,
    step: selectedStep,
    agg: query.agg,
    truncated: false,
    series,
  };
}

function buildWhereClause(query: MetricQuery): string {
  const clauses = [
    `timestamp >= fromUnixTimestamp64Nano(${Date.parse(query.start) * 1_000_000})`,
    `timestamp < fromUnixTimestamp64Nano(${Date.parse(query.end) * 1_000_000})`,
    `name = ${sqlString(query.name)}`,
  ];

  if (query.environment) {
    clauses.push(`environment = ${sqlString(query.environment)}`);
  }

  if (query.serviceName) {
    clauses.push(`service_name = ${sqlString(query.serviceName)}`);
  }

  for (const [key, value] of Object.entries(query.filters)) {
    clauses.push(`tags[${sqlString(key)}] = ${sqlString(value)}`);
  }

  return clauses.join(" AND ");
}

export async function queryMetricSeries(
  query: MetricQuery,
  clickhouseClient: ClickHouseClient,
): Promise<MetricQueryResponse> {
  const clickhouseRows = await clickhouseClient.queryJsonEachRow<
    Omit<MetricRow, "timestamp"> & { timestamp_ms: number }
  >(`
SELECT
  toUnixTimestamp64Milli(timestamp) AS timestamp_ms,
  service_name,
  environment,
  name,
  tags,
  value
FROM metrics
WHERE ${buildWhereClause(query)}
FORMAT JSONEachRow
`);

  const rows: MetricRow[] = clickhouseRows.map((row) => ({
    ...row,
    timestamp: formatIso(row.timestamp_ms),
  }));

  return shapeMetricSeries(rows, query);
}

export async function listMetricNames(
  filters: { environment?: string; serviceName?: string },
  clickhouseClient: ClickHouseClient,
): Promise<MetricNamesResponse> {
  const whereClauses: string[] = [];
  if (filters.environment) {
    whereClauses.push(`environment = ${sqlString(filters.environment)}`);
  }
  if (filters.serviceName) {
    whereClauses.push(`service_name = ${sqlString(filters.serviceName)}`);
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const rows = await clickhouseClient.queryJsonEachRow<{ name: string }>(`
SELECT DISTINCT ${sqlIdentifier("name")} AS name
FROM metrics
${whereSql}
ORDER BY name
FORMAT JSONEachRow
`);

  return { names: rows.map((row) => row.name) };
}
