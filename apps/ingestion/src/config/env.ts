export interface IngestionEnv {
  port: number;
  ingestionApiKey: string;
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

  return {
    port,
    ingestionApiKey
  };
}
