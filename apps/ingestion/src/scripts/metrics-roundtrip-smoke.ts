import { loadEnv } from "../config/env";
import { buildSmokeMetricCase } from "./metrics-roundtrip-smoke-lib";

type MetricNamesResponse = {
  names: string[];
};

type MetricQueryResponse = {
  series: Array<{
    labels: Record<string, string>;
    points: Array<{ timestamp: string; value: number }>;
  }>;
};

type IngestionResponse = {
  accepted: number;
  rejected: number;
};

function basicAuth(user: string, password: string): string {
  return Buffer.from(`${user}:${password}`).toString("base64");
}

function parseJsonEachRow<T>(body: string): T[] {
  if (!body.trim()) {
    return [];
  }

  return body
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll<T>(label: string, fn: () => Promise<T>, isReady: (value: T) => boolean): Promise<T> {
  let latest: T | undefined;

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    latest = await fn();
    if (isReady(latest)) {
      return latest;
    }

    if (attempt < 10) {
      await sleep(300);
    }
  }

  throw new Error(`${label} did not become ready after 10 attempts: ${JSON.stringify(latest, null, 2)}`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const smoke = buildSmokeMetricCase();
  const ingestionBaseUrl = process.env.INGESTION_BASE_URL ?? `http://localhost:${env.port}`;
  const storageBaseUrl = process.env.STORAGE_BASE_URL ?? "http://localhost:3002";
  const storageApiKey = process.env.STORAGE_API_KEY ?? env.ingestionApiKey;
  const clickhouseAuth = basicAuth(env.clickhouse.user, env.clickhouse.password);
  const clickhouseUrl = new URL("/", `http://${env.clickhouse.host}:${env.clickhouse.port}`);

  console.log("metrics roundtrip smoke case", {
    ingestionBaseUrl,
    storageBaseUrl,
    clickhouseHost: env.clickhouse.host,
    clickhousePort: env.clickhouse.port,
    clickhouseDatabase: env.clickhouse.database,
    serviceName: smoke.serviceName,
    metricName: smoke.metricName,
    start: smoke.start,
    end: smoke.end,
  });

  const ingestionResponse = await fetch(new URL("/v1/metrics", ingestionBaseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ingestionApiKey,
    },
    body: JSON.stringify(smoke.payload),
  });

  const ingestionBody = (await ingestionResponse.json()) as IngestionResponse | { error: string };
  console.log("ingestion response", { status: ingestionResponse.status, body: ingestionBody });

  if (!ingestionResponse.ok || !("accepted" in ingestionBody) || ingestionBody.accepted !== 1 || ingestionBody.rejected !== 0) {
    throw new Error(`ingestion write failed: ${JSON.stringify(ingestionBody)}`);
  }

  const clickhouseRows = await poll(
    "clickhouse row",
    async () => {
      const sql = `
SELECT service_name, environment, name, value, toUnixTimestamp64Milli(timestamp) AS timestamp_ms
FROM metrics
WHERE service_name = '${smoke.serviceName}'
  AND environment = '${smoke.environment}'
  AND name = '${smoke.metricName}'
FORMAT JSONEachRow
`;
      const url = new URL(clickhouseUrl);
      url.searchParams.set("database", env.clickhouse.database);
      url.searchParams.set("query", sql);
      const response = await fetch(url, {
        headers: { Authorization: `Basic ${clickhouseAuth}` },
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`clickhouse query failed: ${response.status} ${body}`);
      }
      return parseJsonEachRow<{
        service_name: string;
        environment: string;
        name: string;
        value: number;
        timestamp_ms: number;
      }>(body);
    },
    (rows) => rows.length > 0,
  );
  console.log("clickhouse rows", clickhouseRows);

  const storageNames = await poll(
    "storage names",
    async () => {
      const url = new URL("/api/v1/metrics/names", storageBaseUrl);
      url.searchParams.set("environment", smoke.environment);
      url.searchParams.set("service_name", smoke.serviceName);
      const response = await fetch(url, {
        headers: { "x-api-key": storageApiKey },
      });
      const body = (await response.json()) as MetricNamesResponse | { error: string };
      if (!response.ok) {
        throw new Error(`storage names failed: ${JSON.stringify(body)}`);
      }
      return body as MetricNamesResponse;
    },
    (body) => body.names.includes(smoke.metricName),
  );
  console.log("storage names", storageNames);

  const storageSeries = await poll(
    "storage series",
    async () => {
      const url = new URL("/api/v1/metrics/query", storageBaseUrl);
      url.searchParams.set("start", smoke.start);
      url.searchParams.set("end", smoke.end);
      url.searchParams.set("name", smoke.metricName);
      url.searchParams.set("environment", smoke.environment);
      url.searchParams.set("service_name", smoke.serviceName);
      url.searchParams.set("agg", "sum");
      const response = await fetch(url, {
        headers: { "x-api-key": storageApiKey },
      });
      const body = (await response.json()) as MetricQueryResponse | { error: string };
      if (!response.ok) {
        throw new Error(`storage query failed: ${JSON.stringify(body)}`);
      }
      return body as MetricQueryResponse;
    },
    (body) => body.series.length > 0 && body.series.some((series) => series.points.length > 0),
  );
  console.log("storage series", JSON.stringify(storageSeries, null, 2));
  console.log("metrics roundtrip smoke passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
