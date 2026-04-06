import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

import type { StorageEnv } from "../config/env.js";
import { ClickHouseClient } from "../lib/clickhouse.js";
import { HttpError, unauthorized } from "../lib/http-errors.js";
import { registerMetricsRoutes } from "../routes/metrics.js";
import { registerPlaceholderQueryRoutes } from "../routes/query-placeholders.js";

declare module "fastify" {
  interface FastifyInstance {
    storage: {
      clickhouse: ClickHouseClient | null;
      frontendDevOrigin: string;
    };
  }
}

function getRequestOrigin(originHeader: string | string[] | undefined): string | undefined {
  return Array.isArray(originHeader) ? originHeader[0] : originHeader;
}

export async function buildApp(env: StorageEnv): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate("storage", {
    clickhouse: env.clickhouse ? new ClickHouseClient(env.clickhouse) : null,
    frontendDevOrigin: env.frontendDevOrigin,
  });

  app.addHook("onRequest", async (request, reply) => {
    const origin = getRequestOrigin(request.headers.origin);

    if (origin === env.frontendDevOrigin) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Headers", "X-Api-Key, Content-Type");
      reply.header("Access-Control-Allow-Methods", "GET, OPTIONS");
      reply.header("Vary", "Origin");
    }

    if (request.method === "OPTIONS") {
      reply.status(204).send();
      return;
    }

    const apiKey = request.headers["x-api-key"];

    if (apiKey !== env.apiKey) {
      throw unauthorized();
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.status(error.statusCode).send({ error: error.message, code: error.code });
      return;
    }

    reply.status(500).send({ error: "internal server error", code: "internal_error" });
  });

  await registerMetricsRoutes(app);
  await registerPlaceholderQueryRoutes(app);

  return app;
}
