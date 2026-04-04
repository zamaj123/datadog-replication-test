import { z } from "zod";

import { normalizeMetricIdentity, validateIdentityConstraints } from "../normalization/resource";
import { toNanoseconds } from "../normalization/timestamps";
import {
  CanonicalMetricIdentity,
  MetricEnvelope,
  MetricsRouteResponse,
  MetricWriteRow,
  RawMetricEvent,
  ValidationErrorItem
} from "../types/metrics";

const tagKeyPattern = /^[a-z_][a-z0-9_.]*$/;

const envelopeSchema = z.object({
  metrics: z.array(z.unknown()).min(1)
});

const metricEventSchema = z.object({
  resource: z.record(z.unknown()).optional(),
  service_name: z.string().optional(),
  environment: z.string().optional(),
  host: z.string().optional(),
  version: z.string().optional(),
  timestamp: z.union([z.number().int(), z.bigint()]),
  name: z.string().min(1),
  type: z.enum(["gauge", "counter", "histogram", "summary"]),
  unit: z.string().optional(),
  value: z.number().optional(),
  tags: z.record(z.string()).optional(),
  buckets: z
    .array(
      z.object({
        upper_bound: z.number(),
        count: z.number()
      })
    )
    .optional(),
  count: z.number().optional(),
  sum: z.number().optional()
});

export interface MetricsPipelineOutput {
  rows: MetricWriteRow[];
  response: MetricsRouteResponse;
}

function makeError(index: number, field: string, reason: string): ValidationErrorItem {
  return { index, field, reason };
}

function normalizeTags(tags: Record<string, string> | undefined): Record<string, string> {
  return tags ?? {};
}

function validateTags(index: number, tags: Record<string, string>): ValidationErrorItem | null {
  const entries = Object.entries(tags);
  if (entries.length > 20) {
    return makeError(index, "tags", "too many tags");
  }

  for (const [key, value] of entries) {
    if (!tagKeyPattern.test(key)) {
      return makeError(index, "tags", "malformed tag key");
    }
    if (key.length > 64) {
      return makeError(index, "tags", "tag key exceeds max length");
    }
    if (value.length > 256) {
      return makeError(index, "tags", "tag value exceeds max length");
    }
  }

  return null;
}

function baseRow(
  identity: CanonicalMetricIdentity,
  event: RawMetricEvent,
  timestamp: bigint,
  tags: Record<string, string>
): Omit<MetricWriteRow, "type" | "value" | "name"> & { name: string; tags: Record<string, string> } {
  return {
    ...identity,
    timestamp,
    name: event.name,
    unit: event.unit ?? "",
    tags
  };
}

function expandHistogram(
  identity: CanonicalMetricIdentity,
  event: RawMetricEvent,
  timestamp: bigint,
  tags: Record<string, string>
): MetricWriteRow[] {
  if (!event.buckets || event.count === undefined || event.sum === undefined) {
    throw new Error("histogram requires buckets, count, and sum");
  }

  const rows: MetricWriteRow[] = event.buckets.map((bucket) => ({
    ...baseRow(identity, event, timestamp, {
      ...tags,
      le: String(bucket.upper_bound)
    }),
    type: "histogram",
    value: bucket.count
  }));

  rows.push({
    ...baseRow(identity, event, timestamp, tags),
    name: `${event.name}_count`,
    type: "counter",
    value: event.count
  });

  rows.push({
    ...baseRow(identity, event, timestamp, tags),
    name: `${event.name}_sum`,
    type: "counter",
    value: event.sum
  });

  return rows;
}

function handleMetricEvent(event: RawMetricEvent, index: number): { rows: MetricWriteRow[]; error?: ValidationErrorItem } {
  const parsed = metricEventSchema.safeParse(event);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      rows: [],
      error: makeError(index, issue.path[0]?.toString() ?? "metrics", issue.message)
    };
  }

  const metric = parsed.data;
  const identity = normalizeMetricIdentity(metric);
  const identityField = validateIdentityConstraints(identity);
  if (identityField) {
    return {
      rows: [],
      error: makeError(index, identityField, "required field is empty")
    };
  }

  const tags = normalizeTags(metric.tags);
  const tagsError = validateTags(index, tags);
  if (tagsError) {
    return { rows: [], error: tagsError };
  }

  let timestamp: bigint;
  try {
    timestamp = toNanoseconds(metric.timestamp);
  } catch (error) {
    return {
      rows: [],
      error: makeError(index, "timestamp", error instanceof Error ? error.message : "invalid timestamp")
    };
  }

  if (metric.type === "summary") {
    return {
      rows: [],
      error: makeError(index, "type", "summary is not supported")
    };
  }

  if (metric.type === "counter" || metric.type === "gauge") {
    if (metric.value === undefined) {
      return {
        rows: [],
        error: makeError(index, "value", "value is required")
      };
    }
    if (metric.type === "counter" && metric.value < 0) {
      return {
        rows: [],
        error: makeError(index, "value", "counter value must be >= 0")
      };
    }

    return {
      rows: [
        {
          ...baseRow(identity, metric, timestamp, tags),
          type: metric.type,
          value: metric.value
        }
      ]
    };
  }

  try {
    return {
      rows: expandHistogram(identity, metric, timestamp, tags)
    };
  } catch (error) {
    return {
      rows: [],
      error: makeError(index, "buckets", error instanceof Error ? error.message : "invalid histogram")
    };
  }
}

export function parseMetricsEnvelope(body: unknown): MetricEnvelope {
  return envelopeSchema.parse(body);
}

export function handleMetrics(body: unknown): MetricsPipelineOutput {
  const envelope = parseMetricsEnvelope(body);
  const rows: MetricWriteRow[] = [];
  const errors: ValidationErrorItem[] = [];
  let accepted = 0;

  envelope.metrics.forEach((event, index) => {
    const result = handleMetricEvent(event as RawMetricEvent, index);
    if (result.error) {
      errors.push(result.error);
      return;
    }

    rows.push(...result.rows);
    accepted += 1;
  });

  return {
    rows,
    response: {
      accepted,
      rejected: errors.length,
      ...(errors.length > 0 ? { errors } : {})
    }
  };
}
