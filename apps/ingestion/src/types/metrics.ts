export type ResourceAttributes = Record<string, unknown>;

export type MetricType = "gauge" | "counter" | "histogram";

export interface RawHistogramBucket {
  upper_bound: number;
  count: number;
}

export interface RawMetricEvent {
  resource?: ResourceAttributes;
  service_name?: string;
  environment?: string;
  host?: string;
  version?: string;
  timestamp: number | bigint;
  name: string;
  type: MetricType | "summary";
  unit?: string;
  value?: number;
  tags?: Record<string, string>;
  buckets?: RawHistogramBucket[];
  count?: number;
  sum?: number;
}

export interface MetricEnvelope {
  metrics: unknown[];
}

export interface CanonicalMetricIdentity {
  service_name: string;
  environment: string;
  host: string;
  version: string;
}

export interface MetricWriteRow extends CanonicalMetricIdentity {
  timestamp: bigint;
  name: string;
  type: "gauge" | "counter" | "histogram";
  unit: string;
  value: number;
  tags: Record<string, string>;
}

export interface ValidationErrorItem {
  index: number;
  field: string;
  reason: string;
}

export interface MetricsRouteResponse {
  accepted: number;
  rejected: number;
  errors?: ValidationErrorItem[];
}
