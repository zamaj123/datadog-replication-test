import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { badRequest, serviceUnavailable } from "../lib/http-errors.js";
import { listMetricNames, queryMetricSeries } from "../services/metrics-query-service.js";
import type { MetricQuery } from "../services/metrics-query-types.js";
import { extractString, requireTimeRange } from "./shared.js";

const stepSchema = z.enum(["1m", "5m", "15m", "1h", "6h", "1d"]);
const aggSchema = z.enum(["avg", "min", "max", "sum", "count", "p50", "p95", "p99"]);
const groupDimensionSchema = z.string().regex(/^(service_name|environment|[a-z_][a-z0-9_.]*)$/);
const filterKeySchema = z.string().regex(/^[a-z_][a-z0-9_.]*$/);

function parseMetricQuery(rawQuery: Record<string, unknown>): MetricQuery {
  const { start, end } = requireTimeRange(rawQuery);

  const name = extractString(rawQuery, "name");
  if (!name) {
    throw badRequest("missing required parameter: name");
  }

  const step = extractString(rawQuery, "step");
  if (step !== undefined && !stepSchema.safeParse(step).success) {
    throw badRequest("invalid parameter: step");
  }

  const agg = extractString(rawQuery, "agg") ?? "avg";
  if (!aggSchema.safeParse(agg).success) {
    throw badRequest("invalid parameter: agg");
  }

  const groupByValue = extractString(rawQuery, "group_by");
  const groupBy = groupByValue
    ? groupByValue.split(",").map((value) => value.trim()).filter(Boolean)
    : [];
  for (const dimension of groupBy) {
    if (!groupDimensionSchema.safeParse(dimension).success) {
      throw badRequest("invalid parameter: group_by");
    }
  }

  const filters: Record<string, string> = {};
  for (const key of Object.keys(rawQuery)) {
    const match = /^filter\[(.+)\]$/.exec(key);
    if (!match) {
      continue;
    }

    const filterKey = match[1] ?? "";
    if (!filterKeySchema.safeParse(filterKey).success) {
      throw badRequest(`invalid parameter: ${key}`);
    }

    const filterValue = extractString(rawQuery, key);
    if (filterValue === undefined) {
      throw badRequest(`invalid parameter: ${key}`);
    }

    filters[filterKey] = filterValue;
  }

  return {
    start,
    end,
    name,
    environment: extractString(rawQuery, "environment"),
    serviceName: extractString(rawQuery, "service_name"),
    step,
    agg,
    groupBy,
    filters,
  };
}

function parseMetricNamesQuery(rawQuery: Record<string, unknown>) {
  return {
    environment: extractString(rawQuery, "environment"),
    serviceName: extractString(rawQuery, "service_name"),
  };
}

export async function registerMetricsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/metrics/query", async (request: FastifyRequest, reply: FastifyReply) => {
    const query = parseMetricQuery(request.query as Record<string, unknown>);
    if (!app.storage.clickhouse) {
      throw serviceUnavailable("clickhouse is not configured");
    }
    reply.send(await queryMetricSeries(query, app.storage.clickhouse));
  });

  app.get("/api/v1/metrics/names", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!app.storage.clickhouse) {
      throw serviceUnavailable("clickhouse is not configured");
    }

    const query = parseMetricNamesQuery(request.query as Record<string, unknown>);
    reply.send(await listMetricNames(query, app.storage.clickhouse));
  });
}
