export interface ClickHouseEnv {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface IngestionEnv {
  port: number;
  ingestionApiKey: string;
  clickhouse: ClickHouseEnv;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): IngestionEnv {
  const ingestionApiKey = source.INGESTION_API_KEY;
  if (!ingestionApiKey) {
    throw new Error("Missing required environment variable: INGESTION_API_KEY");
  }

  const portRaw = source.PORT ?? "3001";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${portRaw}`);
  }

  const host = source.CLICKHOUSE_HOST;
  const database = source.CLICKHOUSE_DATABASE;
  const user = source.CLICKHOUSE_USER;
  const password = source.CLICKHOUSE_PASSWORD;
  const clickhousePortRaw = source.CLICKHOUSE_PORT ?? "8123";
  const clickhousePort = Number(clickhousePortRaw);

  if (!host) {
    throw new Error("Missing required environment variable: CLICKHOUSE_HOST");
  }
  if (!database) {
    throw new Error("Missing required environment variable: CLICKHOUSE_DATABASE");
  }
  if (!user) {
    throw new Error("Missing required environment variable: CLICKHOUSE_USER");
  }
  if (!password) {
    throw new Error("Missing required environment variable: CLICKHOUSE_PASSWORD");
  }
  if (!Number.isInteger(clickhousePort) || clickhousePort <= 0) {
    throw new Error(`Invalid CLICKHOUSE_PORT: ${clickhousePortRaw}`);
  }

  return {
    port,
    ingestionApiKey,
    clickhouse: {
      host,
      port: clickhousePort,
      database,
      user,
      password
    }
  };
}
