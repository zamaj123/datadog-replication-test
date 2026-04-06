export type StorageEnv = {
  port: number;
  apiKey: string;
  frontendDevOrigin: string;
  clickhouse:
    | {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
      }
    | null;
};

export function getEnv(env: NodeJS.ProcessEnv = process.env): StorageEnv {
  const portValue = env.PORT ?? "3000";
  const port = Number.parseInt(portValue, 10);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must be a positive integer");
  }

  const apiKey = env.INGESTION_API_KEY;

  if (!apiKey) {
    throw new Error("INGESTION_API_KEY is required");
  }

  const frontendDevOrigin = env.FRONTEND_DEV_ORIGIN ?? "http://localhost:5173";

  const clickhouseHost = env.CLICKHOUSE_HOST;
  const clickhousePortValue = env.CLICKHOUSE_PORT;
  const clickhouseDatabase = env.CLICKHOUSE_DATABASE;
  const clickhouseUser = env.CLICKHOUSE_USER;
  const clickhousePassword = env.CLICKHOUSE_PASSWORD;
  const clickhouseFields = [
    clickhouseHost,
    clickhousePortValue,
    clickhouseDatabase,
    clickhouseUser,
    clickhousePassword,
  ];
  const hasAnyClickhouseConfig = clickhouseFields.some((value) => Boolean(value));

  if (hasAnyClickhouseConfig && clickhouseFields.some((value) => !value)) {
    throw new Error(
      "CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_DATABASE, CLICKHOUSE_USER, and CLICKHOUSE_PASSWORD must all be set together",
    );
  }

  let clickhouse: StorageEnv["clickhouse"] = null;
  if (hasAnyClickhouseConfig) {
    const clickhousePort = Number.parseInt(clickhousePortValue ?? "", 10);

    if (!Number.isInteger(clickhousePort) || clickhousePort <= 0) {
      throw new Error("CLICKHOUSE_PORT must be a positive integer");
    }

    clickhouse = {
      host: clickhouseHost ?? "",
      port: clickhousePort,
      database: clickhouseDatabase ?? "",
      user: clickhouseUser ?? "",
      password: clickhousePassword ?? "",
    };
  }

  return { port, apiKey, frontendDevOrigin, clickhouse };
}
