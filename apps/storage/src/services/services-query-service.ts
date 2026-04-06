import { ClickHouseClient, sqlString } from "../lib/clickhouse.js";
import type {
  EnvironmentsResponse,
  ServiceListItem,
  ServiceMetricRow,
  ServiceSummaryResponse,
  ServicesResponse,
} from "./services-query-types.js";

type ServiceScope = {
  start: string;
  end: string;
  environment?: string;
  serviceName?: string;
};

type ClickHouseServiceRow = Omit<ServiceMetricRow, "timestamp"> & { timestamp_ms: number };

type ServiceAccumulator = {
  service_name: string;
  environment: string;
  lastSeenMs: number;
  requestCount: number;
  errorCount: number;
  latencyUnit: string;
  latencyBuckets: Map<number, number>;
  latencyCount: number;
};

const REQUEST_COUNT_METRIC = "service.requests.count";
const ERROR_COUNT_METRIC = "service.errors.count";
const REQUEST_DURATION_METRIC = "service.request.duration";
const REQUEST_DURATION_COUNT_METRIC = "service.request.duration_count";

function formatIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function isoToUnixNanos(timestamp: string): string {
  return (BigInt(Date.parse(timestamp)) * 1_000_000n).toString();
}

function buildScopedWhereClause(scope: ServiceScope): string {
  const clauses = [
    `timestamp >= fromUnixTimestamp64Nano(${isoToUnixNanos(scope.start)})`,
    `timestamp < fromUnixTimestamp64Nano(${isoToUnixNanos(scope.end)})`,
  ];

  if (scope.environment) {
    clauses.push(`environment = ${sqlString(scope.environment)}`);
  }

  if (scope.serviceName) {
    clauses.push(`service_name = ${sqlString(scope.serviceName)}`);
  }

  return clauses.join(" AND ");
}

function unitToNanoseconds(value: number, unit: string): number {
  switch (unit) {
    case "s":
      return value * 1_000_000_000;
    case "ms":
      return value * 1_000_000;
    case "us":
      return value * 1_000;
    case "ns":
    case "":
      return value;
    default:
      return value;
  }
}

function percentileFromBuckets(
  bucketEntries: Array<[number, number]>,
  totalCount: number,
  percentileRank: number,
  unit: string,
): number {
  if (totalCount <= 0 || bucketEntries.length === 0) {
    return 0;
  }

  const threshold = totalCount * (percentileRank / 100);
  for (const [upperBound, cumulativeCount] of bucketEntries) {
    if (cumulativeCount >= threshold) {
      return unitToNanoseconds(upperBound, unit);
    }
  }

  return unitToNanoseconds(bucketEntries[bucketEntries.length - 1]?.[0] ?? 0, unit);
}

function createAccumulator(row: ServiceMetricRow): ServiceAccumulator {
  return {
    service_name: row.service_name,
    environment: row.environment,
    lastSeenMs: Date.parse(row.timestamp),
    requestCount: 0,
    errorCount: 0,
    latencyUnit: "",
    latencyBuckets: new Map<number, number>(),
    latencyCount: 0,
  };
}

function mergeAccumulators(entries: ServiceAccumulator[]): ServiceAccumulator | undefined {
  const first = entries[0];
  if (!first) {
    return undefined;
  }

  const merged: ServiceAccumulator = {
    service_name: first.service_name,
    environment: "",
    lastSeenMs: first.lastSeenMs,
    requestCount: 0,
    errorCount: 0,
    latencyUnit: first.latencyUnit,
    latencyBuckets: new Map<number, number>(),
    latencyCount: 0,
  };

  for (const entry of entries) {
    merged.lastSeenMs = Math.max(merged.lastSeenMs, entry.lastSeenMs);
    merged.requestCount += entry.requestCount;
    merged.errorCount += entry.errorCount;
    merged.latencyCount += entry.latencyCount;
    if (!merged.latencyUnit && entry.latencyUnit) {
      merged.latencyUnit = entry.latencyUnit;
    }

    for (const [upperBound, cumulativeCount] of entry.latencyBuckets.entries()) {
      merged.latencyBuckets.set(upperBound, (merged.latencyBuckets.get(upperBound) ?? 0) + cumulativeCount);
    }
  }

  return merged;
}

function accumulateServiceMetrics(rows: ServiceMetricRow[]): Map<string, ServiceAccumulator> {
  const services = new Map<string, ServiceAccumulator>();

  for (const row of rows) {
    const key = `${row.service_name}\u0000${row.environment}`;
    const entry = services.get(key) ?? createAccumulator(row);
    entry.lastSeenMs = Math.max(entry.lastSeenMs, Date.parse(row.timestamp));

    if (row.name === REQUEST_COUNT_METRIC) {
      entry.requestCount += row.value;
    } else if (row.name === ERROR_COUNT_METRIC) {
      entry.errorCount += row.value;
    } else if (row.name === REQUEST_DURATION_COUNT_METRIC) {
      entry.latencyCount += row.value;
      if (!entry.latencyUnit && row.unit) {
        entry.latencyUnit = row.unit;
      }
    } else if (row.name === REQUEST_DURATION_METRIC) {
      const bucketUpperBound = row.tags.le;
      if (bucketUpperBound) {
        const upperBound = Number(bucketUpperBound);
        if (!Number.isNaN(upperBound)) {
          entry.latencyBuckets.set(upperBound, (entry.latencyBuckets.get(upperBound) ?? 0) + row.value);
          if (!entry.latencyUnit && row.unit) {
            entry.latencyUnit = row.unit;
          }
        }
      }
    }

    services.set(key, entry);
  }

  return services;
}

function durationSeconds(start: string, end: string): number {
  return Math.max(1, (Date.parse(end) - Date.parse(start)) / 1000);
}

function buildServiceListItem(entry: ServiceAccumulator, start: string, end: string): ServiceListItem {
  const bucketEntries = [...entry.latencyBuckets.entries()].sort((left, right) => left[0] - right[0]);
  const requestRate = entry.requestCount / durationSeconds(start, end);
  const errorRate = entry.requestCount > 0 ? entry.errorCount / entry.requestCount : 0;

  return {
    service_name: entry.service_name,
    environment: entry.environment,
    last_seen: formatIso(entry.lastSeenMs),
    request_rate_per_sec: requestRate,
    error_rate: errorRate,
    p99_latency_ns: percentileFromBuckets(bucketEntries, entry.latencyCount, 99, entry.latencyUnit),
    log_count: 0,
  };
}

function buildServiceSummary(
  entry: ServiceAccumulator | undefined,
  scope: ServiceScope & { serviceName: string },
): ServiceSummaryResponse {
  const bucketEntries = entry ? [...entry.latencyBuckets.entries()].sort((left, right) => left[0] - right[0]) : [];
  const requestCount = entry?.requestCount ?? 0;
  const errorCount = entry?.errorCount ?? 0;
  const latencyUnit = entry?.latencyUnit ?? "";
  const latencyCount = entry?.latencyCount ?? 0;

  return {
    service_name: scope.serviceName,
    environment: scope.environment ?? "",
    start: scope.start,
    end: scope.end,
    last_seen: entry ? formatIso(entry.lastSeenMs) : "",
    request_rate_per_sec: requestCount / durationSeconds(scope.start, scope.end),
    error_rate: requestCount > 0 ? errorCount / requestCount : 0,
    p50_latency_ns: percentileFromBuckets(bucketEntries, latencyCount, 50, latencyUnit),
    p95_latency_ns: percentileFromBuckets(bucketEntries, latencyCount, 95, latencyUnit),
    p99_latency_ns: percentileFromBuckets(bucketEntries, latencyCount, 99, latencyUnit),
    log_count: 0,
    active_alert_count: 0,
  };
}

async function queryServiceRows(scope: ServiceScope, clickhouseClient: ClickHouseClient): Promise<ServiceMetricRow[]> {
  const rows = await clickhouseClient.queryJsonEachRow<ClickHouseServiceRow>(`
SELECT
  toUnixTimestamp64Milli(timestamp) AS timestamp_ms,
  service_name,
  environment,
  name,
  unit,
  tags,
  value
FROM metrics
WHERE ${buildScopedWhereClause(scope)}
FORMAT JSONEachRow
`);

  return rows.map((row) => ({
    ...row,
    timestamp: formatIso(row.timestamp_ms),
  }));
}

export async function listEnvironments(clickhouseClient: ClickHouseClient): Promise<EnvironmentsResponse> {
  const rows = await clickhouseClient.queryJsonEachRow<{ environment: string }>(`
SELECT DISTINCT environment
FROM metrics
ORDER BY environment
FORMAT JSONEachRow
`);

  return { environments: rows.map((row) => row.environment) };
}

export async function listServices(
  scope: Omit<ServiceScope, "serviceName">,
  clickhouseClient: ClickHouseClient,
): Promise<ServicesResponse> {
  const rows = await queryServiceRows(scope, clickhouseClient);
  const services = [...accumulateServiceMetrics(rows).values()]
    .map((entry) => buildServiceListItem(entry, scope.start, scope.end))
    .sort((left, right) => {
      const byService = left.service_name.localeCompare(right.service_name);
      return byService !== 0 ? byService : left.environment.localeCompare(right.environment);
    });

  return { services };
}

export async function getServiceSummary(
  scope: ServiceScope & { serviceName: string },
  clickhouseClient: ClickHouseClient,
): Promise<ServiceSummaryResponse> {
  const rows = await queryServiceRows(scope, clickhouseClient);
  const allEntries = [...accumulateServiceMetrics(rows).values()].filter((entry) => entry.service_name === scope.serviceName);
  const entry =
    scope.environment === undefined
      ? mergeAccumulators(allEntries)
      : allEntries.find((candidate) => candidate.environment === scope.environment);

  return buildServiceSummary(entry, scope);
}
