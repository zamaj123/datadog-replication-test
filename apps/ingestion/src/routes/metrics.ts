import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import { MetricsWriter } from "../clickhouse/writer";
import { IngestionEnv } from "../config/env";
import { handleMetrics } from "../pipeline/handle-metrics";

interface MetricsRouteDeps {
  env: IngestionEnv;
  writer: MetricsWriter;
}

function hasJsonContentType(request: FastifyRequest): boolean {
  const contentType = request.headers["content-type"];
  return typeof contentType === "string" && contentType.startsWith("application/json");
}

async function authenticate(request: FastifyRequest, reply: FastifyReply, env: IngestionEnv): Promise<void> {
  const apiKey = request.headers["x-api-key"];
  if (apiKey !== env.ingestionApiKey) {
    await reply.code(401).send({ error: "unauthorized" });
  }
}

export async function registerMetricsRoute(app: FastifyInstance, deps: MetricsRouteDeps): Promise<void> {
  app.post("/v1/metrics", async (request, reply) => {
    await authenticate(request, reply, deps.env);
    if (reply.sent) {
      return;
    }

    if (!hasJsonContentType(request)) {
      return reply.code(400).send({
        accepted: 0,
        rejected: 0,
        errors: [{ index: 0, field: "content-type", reason: "Content-Type must be application/json" }]
      });
    }

    try {
      const result = handleMetrics(request.body);
      await deps.writer.writeMetrics(result.rows);
      return reply.code(result.response.rejected > 0 ? 400 : 202).send(result.response);
    } catch (error) {
      if (error instanceof ZodError) {
        const issue = error.issues[0];
        return reply.code(400).send({
          accepted: 0,
          rejected: 0,
          errors: [
            {
              index: 0,
              field: issue.path[0]?.toString() ?? "metrics",
              reason: issue.message
            }
          ]
        });
      }

      request.log.error({ err: error }, "metrics ingestion failed");
      return reply.code(503).send({ error: "writer unavailable" });
    }
  });
}
