import { getEnv } from "./config/env.js";
import { buildApp } from "./server/app.js";

async function main(): Promise<void> {
  const env = getEnv();
  const app = await buildApp(env);

  await app.listen({ host: "0.0.0.0", port: env.port });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

