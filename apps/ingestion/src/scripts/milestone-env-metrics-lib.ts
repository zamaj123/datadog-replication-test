import { MetricEnvelope } from "../types/metrics";

const REQUIRED_METRIC_NAMES = [
  "service.requests.count",
  "service.errors.count",
  "service.request.duration",
  "runtime.cpu.usage",
  "runtime.memory.usage",
  "runtime.heap.used",
  "runtime.event_loop.delay",
] as const;

const HISTOGRAM_BUCKETS = [
  { upper_bound: 50_000_000, count: 2 },
  { upper_bound: 100_000_000, count: 5 },
  { upper_bound: 250_000_000, count: 7 },
] as const;

export interface MilestoneEmitterEnv {
  apiKey: string;
  environment: string;
  serviceName: string;
  site: string;
  version: string;
}

export interface MilestoneMetricCase {
  emitterEnv: MilestoneEmitterEnv;
  expectedAcceptedMetrics: number;
  expectedWrittenMetricNames: string[];
  payload: MetricEnvelope;
  serviceMetricNames: string[];
  start: string;
  end: string;
  timestampMs: number;
}

interface MilestoneEnvOptions {
  defaultApiKey?: string;
  defaultEnvironment?: string;
  defaultServiceName?: string;
  defaultSite?: string;
  defaultVersion?: string;
}

function requireString(value: string | undefined, field: string): string {
  if (!value) {
    throw new Error(`Missing required milestone env value: ${field}`);
  }

  return value;
}

function iso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

export function loadMilestoneEmitterEnv(
  source: NodeJS.ProcessEnv = process.env,
  options: MilestoneEnvOptions = {},
): MilestoneEmitterEnv {
  const apiKey = source.DD_API_KEY ?? options.defaultApiKey;
  const site = source.DD_SITE ?? options.defaultSite;
  const environment = source.DD_ENV ?? options.defaultEnvironment;
  const serviceName = source.DD_SERVICE ?? options.defaultServiceName;
  const version = source.DD_VERSION ?? options.defaultVersion ?? "";

  return {
    apiKey: requireString(apiKey, "DD_API_KEY"),
    site: requireString(site, "DD_SITE"),
    environment: requireString(environment, "DD_ENV"),
    serviceName: requireString(serviceName, "DD_SERVICE"),
    version,
  };
}

export function buildMilestoneMetricCase(
  emitterEnv: MilestoneEmitterEnv,
  now: number = Date.now(),
): MilestoneMetricCase {
  const timestampMs = now;

  const identity = {
    "deployment.environment": emitterEnv.environment,
    "service.name": emitterEnv.serviceName,
    "service.version": emitterEnv.version,
  };

  return {
    emitterEnv,
    expectedAcceptedMetrics: REQUIRED_METRIC_NAMES.length,
    expectedWrittenMetricNames: [
      "service.requests.count",
      "service.errors.count",
      "service.request.duration",
      "service.request.duration_count",
      "service.request.duration_sum",
      "runtime.cpu.usage",
      "runtime.memory.usage",
      "runtime.heap.used",
      "runtime.event_loop.delay",
    ],
    payload: {
      metrics: [
        {
          resource: identity,
          timestamp: timestampMs,
          name: "service.requests.count",
          type: "counter",
          value: 7,
          tags: {
            endpoint: "/checkout",
            "http.method": "POST",
            "http.status_code": "200",
          },
        },
        {
          resource: identity,
          timestamp: timestampMs,
          name: "service.errors.count",
          type: "counter",
          value: 2,
          tags: {
            endpoint: "/checkout",
            "http.method": "POST",
            "http.status_code": "500",
          },
        },
        {
          resource: identity,
          timestamp: timestampMs,
          name: "service.request.duration",
          type: "histogram",
          unit: "ns",
          buckets: [...HISTOGRAM_BUCKETS],
          count: 7,
          sum: 785_000_000,
          tags: {
            endpoint: "/checkout",
            "http.method": "POST",
            "http.status_code": "200",
          },
        },
        {
          resource: identity,
          timestamp: timestampMs,
          name: "runtime.cpu.usage",
          type: "gauge",
          value: 0.42,
          tags: {},
        },
        {
          resource: identity,
          timestamp: timestampMs,
          name: "runtime.memory.usage",
          type: "gauge",
          unit: "bytes",
          value: 268_435_456,
          tags: {},
        },
        {
          resource: identity,
          timestamp: timestampMs,
          name: "runtime.heap.used",
          type: "gauge",
          unit: "bytes",
          value: 134_217_728,
          tags: {},
        },
        {
          resource: identity,
          timestamp: timestampMs,
          name: "runtime.event_loop.delay",
          type: "gauge",
          unit: "ns",
          value: 1_500_000,
          tags: {},
        },
      ],
    },
    serviceMetricNames: [...REQUIRED_METRIC_NAMES],
    start: iso(now - 60_000),
    end: iso(now + 60_000),
    timestampMs,
  };
}
