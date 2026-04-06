import type { FastifyInstance } from "fastify";

import { badRequest } from "../lib/http-errors.js";
import {
  emptyLogCountResponse,
  emptyLogsResponse,
  emptyLogVolumeResponse,
  emptyTracesResponse,
} from "../services/placeholder-query-service.js";
import { autoSelectStep } from "../services/step-selection.js";
import { extractString, requireTimeRange } from "./shared.js";

function selectLogVolumeStep(rawQuery: Record<string, unknown>): string {
  const explicitStep = extractString(rawQuery, "step");
  if (explicitStep) {
    if (!["1m", "5m", "15m", "1h"].includes(explicitStep)) {
      throw badRequest("invalid parameter: step");
    }
    return explicitStep;
  }

  const { start, end } = requireTimeRange(rawQuery);
  const auto = autoSelectStep(Date.parse(start), Date.parse(end));
  return auto === "6h" || auto === "1d" ? "1h" : auto;
}

export async function registerPlaceholderQueryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/logs", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    requireTimeRange(query);
    const countOnly = extractString(query, "count_only");
    if (countOnly === "true") {
      reply.send(emptyLogCountResponse());
      return;
    }

    reply.send(emptyLogsResponse());
  });

  app.get("/api/v1/logs/volume", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const step = selectLogVolumeStep(query);
    reply.send(emptyLogVolumeResponse(step));
  });

  app.get("/api/v1/traces", async (request, reply) => {
    requireTimeRange(request.query as Record<string, unknown>);
    reply.send(emptyTracesResponse());
  });

  app.get("/api/v1/traces/:trace_id", async (_request, reply) => {
    reply.status(404).send({ error: "trace not found", code: "not_found" });
  });
}
