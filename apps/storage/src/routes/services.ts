import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { serviceUnavailable } from "../lib/http-errors.js";
import { getServiceSummary, listEnvironments, listServices } from "../services/services-query-service.js";
import { extractString, requireTimeRange } from "./shared.js";

function parseServicesQuery(rawQuery: Record<string, unknown>) {
  const { start, end } = requireTimeRange(rawQuery);

  return {
    start,
    end,
    environment: extractString(rawQuery, "environment"),
  };
}

function parseServiceSummaryQuery(rawQuery: Record<string, unknown>) {
  const { start, end } = requireTimeRange(rawQuery);

  return {
    start,
    end,
    environment: extractString(rawQuery, "environment"),
  };
}

export async function registerServiceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/environments", async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!app.storage.clickhouse) {
      throw serviceUnavailable("clickhouse is not configured");
    }

    reply.send(await listEnvironments(app.storage.clickhouse));
  });

  app.get("/api/v1/services", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!app.storage.clickhouse) {
      throw serviceUnavailable("clickhouse is not configured");
    }

    const query = parseServicesQuery(request.query as Record<string, unknown>);
    reply.send(await listServices(query, app.storage.clickhouse));
  });

  app.get("/api/v1/services/:service_name/summary", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!app.storage.clickhouse) {
      throw serviceUnavailable("clickhouse is not configured");
    }

    const query = parseServiceSummaryQuery(request.query as Record<string, unknown>);
    const params = request.params as { service_name: string };
    reply.send(await getServiceSummary({ ...query, serviceName: params.service_name }, app.storage.clickhouse));
  });
}
