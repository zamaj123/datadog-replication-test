import type { FastifyInstance } from "fastify";

import { badRequest } from "../lib/http-errors.js";
import {
  emptyEnvironmentsResponse,
  emptyLogCountResponse,
  emptyLogsResponse,
  emptyLogVolumeResponse,
  emptyServicesResponse,
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

  app.get("/api/v1/services", async (request, reply) => {
    requireTimeRange(request.query as Record<string, unknown>);
    reply.send(emptyServicesResponse());
  });

  app.get("/api/v1/services/:service_name/summary", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { start, end } = requireTimeRange(query);
    const params = request.params as { service_name: string };
    reply.send({
      service_name: params.service_name,
      environment: extractString(query, "environment") ?? "",
      start,
      end,
      last_seen: "",
      request_rate_per_sec: 0,
      error_rate: 0,
      p50_latency_ns: 0,
      p95_latency_ns: 0,
      p99_latency_ns: 0,
      log_count: 0,
      active_alert_count: 0,
    });
  });

  app.get("/api/v1/environments", async (_request, reply) => {
    reply.send(emptyEnvironmentsResponse());
  });
}
