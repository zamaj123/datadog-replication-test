import { z } from "zod";

import { badRequest } from "../lib/http-errors.js";

const isoDatetime = z.string().datetime({ offset: true });

export function extractString(query: Record<string, unknown>, key: string): string | undefined {
  const value = query[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") {
    return value[0];
  }

  throw badRequest(`invalid parameter: ${key}`);
}

export function requireTimeRange(rawQuery: Record<string, unknown>): { start: string; end: string } {
  const start = extractString(rawQuery, "start");
  if (!start) {
    throw badRequest("missing required parameter: start");
  }

  const end = extractString(rawQuery, "end");
  if (!end) {
    throw badRequest("missing required parameter: end");
  }

  if (!isoDatetime.safeParse(start).success) {
    throw badRequest("invalid parameter: start");
  }

  if (!isoDatetime.safeParse(end).success) {
    throw badRequest("invalid parameter: end");
  }

  if (Date.parse(end) <= Date.parse(start)) {
    throw badRequest("end must be greater than start");
  }

  return { start, end };
}
