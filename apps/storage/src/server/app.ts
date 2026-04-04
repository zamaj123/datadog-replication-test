import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

import type { StorageEnv } from "../config/env.js";
import { HttpError, unauthorized } from "../lib/http-errors.js";
import { registerMetricsRoutes } from "../routes/metrics.js";

export async function buildApp(env: StorageEnv): Promise<FastifyInstance> {
  const app = Fastify();

  app.addHook("onRequest", async (request) => {
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

  return app;
}

