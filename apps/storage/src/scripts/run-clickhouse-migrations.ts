import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getEnv } from "../config/env.js";
import { ClickHouseClient } from "../lib/clickhouse.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations/clickhouse");

async function main(): Promise<void> {
  const env = getEnv();

  if (!env.clickhouse) {
    throw new Error(
      "ClickHouse configuration is required. Set CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_DATABASE, CLICKHOUSE_USER, and CLICKHOUSE_PASSWORD.",
    );
  }

  const client = new ClickHouseClient(env.clickhouse);
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const migrationFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  if (migrationFiles.length === 0) {
    console.log("No ClickHouse migrations found.");
    return;
  }

  for (const filename of migrationFiles) {
    const fullPath = path.join(MIGRATIONS_DIR, filename);
    const sql = await readFile(fullPath, "utf8");
    console.log(`Applying ${filename}...`);
    await client.execute(sql);
  }

  console.log("ClickHouse schema initialization complete.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
