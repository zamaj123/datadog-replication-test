import { loadEnv } from "../config/env";
import { buildMilestoneMetricCase, loadMilestoneEmitterEnv } from "./milestone-env-metrics-lib";

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
  const ingestionEnv = loadEnv();
  const emitterEnv = loadMilestoneEmitterEnv(process.env, {
    defaultApiKey: ingestionEnv.ingestionApiKey,
    defaultEnvironment: "production",
    defaultServiceName: `milestone-env-smoke-${Date.now()}`,
    defaultSite: process.env.INGESTION_BASE_URL ?? `http://localhost:${ingestionEnv.port}`,
    defaultVersion: "",
  });
  const smoke = buildMilestoneMetricCase(emitterEnv);
  const clickhouseAuth = basicAuth(ingestionEnv.clickhouse.user, ingestionEnv.clickhouse.password);
  const clickhouseUrl = new URL("/", `http://${ingestionEnv.clickhouse.host}:${ingestionEnv.clickhouse.port}`);

  console.log("milestone env metrics smoke case", {
    clickhouseDatabase: ingestionEnv.clickhouse.database,
    clickhouseHost: ingestionEnv.clickhouse.host,
    clickhousePort: ingestionEnv.clickhouse.port,
    environment: smoke.emitterEnv.environment,
    ingestionBaseUrl: smoke.emitterEnv.site,
    serviceName: smoke.emitterEnv.serviceName,
    serviceVersion: smoke.emitterEnv.version,
    start: smoke.start,
    end: smoke.end,
  });

  const ingestionResponse = await fetch(new URL("/v1/metrics", smoke.emitterEnv.site), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": smoke.emitterEnv.apiKey,
    },
    body: JSON.stringify(smoke.payload),
  });

  const ingestionBody = (await ingestionResponse.json()) as IngestionResponse | { error: string };
  console.log("ingestion response", { status: ingestionResponse.status, body: ingestionBody });

  if (
    !ingestionResponse.ok ||
    !("accepted" in ingestionBody) ||
    ingestionBody.accepted !== smoke.expectedAcceptedMetrics ||
    ingestionBody.rejected !== 0
  ) {
    throw new Error(`ingestion write failed: ${JSON.stringify(ingestionBody)}`);
  }

  const clickhouseRows = await poll(
    "clickhouse milestone rows",
    async () => {
      const sql = `
SELECT service_name, environment, version, name, type, tags
FROM metrics
WHERE service_name = '${smoke.emitterEnv.serviceName}'
  AND environment = '${smoke.emitterEnv.environment}'
  AND timestamp >= fromUnixTimestamp64Milli(${smoke.timestampMs - 60_000})
  AND timestamp < fromUnixTimestamp64Milli(${smoke.timestampMs + 60_000})
FORMAT JSONEachRow
`;
      const url = new URL(clickhouseUrl);
      url.searchParams.set("database", ingestionEnv.clickhouse.database);
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
        version: string;
        name: string;
        type: string;
        tags: Record<string, string>;
      }>(body);
    },
    (rows) => rows.length >= smoke.expectedWrittenMetricNames.length,
  );

  const rowNames = clickhouseRows.map((row) => row.name).sort();
  console.log("clickhouse rows", JSON.stringify(clickhouseRows, null, 2));

  for (const metricName of smoke.expectedWrittenMetricNames) {
    if (!rowNames.includes(metricName)) {
      throw new Error(`missing expected metric row: ${metricName}`);
    }
  }

  for (const row of clickhouseRows) {
    if (row.service_name !== smoke.emitterEnv.serviceName) {
      throw new Error(`unexpected service_name in row: ${JSON.stringify(row)}`);
    }
    if (row.environment !== smoke.emitterEnv.environment) {
      throw new Error(`unexpected environment in row: ${JSON.stringify(row)}`);
    }
    if (row.version !== smoke.emitterEnv.version) {
      throw new Error(`unexpected version in row: ${JSON.stringify(row)}`);
    }
  }

  console.log("milestone env metrics smoke passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
