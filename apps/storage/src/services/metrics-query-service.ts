import type {
  MetricNamesResponse,
  MetricPoint,
  MetricQuery,
  MetricQueryResponse,
  MockMetricRow,
} from "./metrics-query-types.js";
import { mockMetricRows } from "./mock-metrics.js";
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

function filterRows(query: MetricQuery): MockMetricRow[] {
  const startMs = Date.parse(query.start);
  const endMs = Date.parse(query.end);

  return mockMetricRows.filter((row) => {
    const rowMs = isoToMs(row.timestamp);
    if (row.name !== query.name) {
      return false;
    }
    if (rowMs < startMs || rowMs >= endMs) {
      return false;
    }
    if (query.environment && row.environment !== query.environment) {
      return false;
    }
    if (query.serviceName && row.service_name !== query.serviceName) {
      return false;
    }

    return Object.entries(query.filters).every(([key, value]) => row.tags[key] === value);
  });
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

function labelValueForDimension(row: MockMetricRow, dimension: string): string {
  if (dimension === "service_name") {
    return row.service_name;
  }

  if (dimension === "environment") {
    return row.environment;
  }

  return row.tags[dimension] ?? "";
}

export function queryMetricSeries(query: MetricQuery): MetricQueryResponse {
  const startMs = Date.parse(query.start);
  const endMs = Date.parse(query.end);
  const selectedStep = query.step ?? autoSelectStep(startMs, endMs);
  const bucketMs = stepToBucketMs(selectedStep);
  const rows = filterRows(query);
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

export function listMetricNames(filters: { environment?: string; serviceName?: string }): MetricNamesResponse {
  const names = [...new Set(
    mockMetricRows
      .filter((row) => {
        if (filters.environment && row.environment !== filters.environment) {
          return false;
        }
        if (filters.serviceName && row.service_name !== filters.serviceName) {
          return false;
        }

        return true;
      })
      .map((row) => row.name),
  )].sort();

  return { names };
}

