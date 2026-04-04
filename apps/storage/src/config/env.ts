export type StorageEnv = {
  port: number;
  apiKey: string;
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

  return { port, apiKey };
}

