import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { IngestionEnv } from "../config/env";

interface NotImplementedRouteDeps {
  env: IngestionEnv;
}

async function authenticate(request: FastifyRequest, reply: FastifyReply, env: IngestionEnv): Promise<void> {
  const apiKey = request.headers["x-api-key"];
  if (apiKey !== env.ingestionApiKey) {
    await reply.code(401).send({ error: "unauthorized" });
  }
}

function registerNotImplementedRoute(app: FastifyInstance, path: string, deps: NotImplementedRouteDeps): void {
  app.post(path, async (request, reply) => {
    await authenticate(request, reply, deps.env);
    if (reply.sent) {
      return;
    }

    return reply.code(501).send({ error: "not implemented" });
  });
}

export async function registerNotImplementedIngestionRoutes(
  app: FastifyInstance,
  deps: NotImplementedRouteDeps
): Promise<void> {
  registerNotImplementedRoute(app, "/v1/logs", deps);
  registerNotImplementedRoute(app, "/v1/traces", deps);
}
