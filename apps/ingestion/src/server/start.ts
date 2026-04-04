import { loadEnv } from "../config/env";
import { buildApp } from "./app";

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp({ env });

  await app.listen({
    host: "0.0.0.0",
    port: env.port
  });
}

void main();
