import type { StorageEnv } from "../config/env.js";

type ClickHouseConfig = NonNullable<StorageEnv["clickhouse"]>;

function escapeLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function escapeIdentifier(identifier: string): string {
  return identifier.replaceAll("`", "``");
}

export class ClickHouseClient {
  #config: ClickHouseConfig;

  constructor(config: ClickHouseConfig) {
    this.#config = config;
  }

  async queryJsonEachRow<T>(sql: string): Promise<T[]> {
    const baseUrl = `http://${this.#config.host}:${this.#config.port}/?database=${encodeURIComponent(this.#config.database)}`;
    const auth = Buffer.from(`${this.#config.user}:${this.#config.password}`).toString("base64");
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "text/plain; charset=utf-8",
      },
      body: sql,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ClickHouse query failed: ${response.status} ${body}`);
    }

    const text = await response.text();

    if (!text.trim()) {
      return [];
    }

    return text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  }
}

export function sqlString(value: string): string {
  return `'${escapeLiteral(value)}'`;
}

export function sqlIdentifier(value: string): string {
  return `\`${escapeIdentifier(value)}\``;
}
