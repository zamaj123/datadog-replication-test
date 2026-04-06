export interface MetricNamesResponse {
  names: string[];
}

export interface EnvironmentsResponse {
  environments: string[];
}

export interface ServiceListItem {
  service_name: string;
  environment: string;
  last_seen: string;
  request_rate_per_sec: number;
  error_rate: number;
  p99_latency_ns: number;
  log_count: number;
}

export interface ServicesResponse {
  services: ServiceListItem[];
}

export interface ServiceSummaryResponse {
  service_name: string;
  environment: string;
  start: string;
  end: string;
  last_seen: string;
  request_rate_per_sec: number;
  error_rate: number;
  p50_latency_ns: number;
  p95_latency_ns: number;
  p99_latency_ns: number;
  log_count: number;
  active_alert_count: number;
}

export interface MetricQueryPoint {
  timestamp: string;
  value: number;
}

export interface MetricQuerySeries {
  labels: Record<string, string>;
  points: MetricQueryPoint[];
}

export interface MetricQueryResponse {
  name: string;
  step: string;
  agg: string;
  truncated: boolean;
  series: MetricQuerySeries[];
}

export interface MetricNamesRequest {
  environment?: string;
  service_name?: string;
}

export interface ServicesRequest {
  start: string;
  end: string;
  environment?: string;
}

export interface ServiceSummaryRequest {
  start: string;
  end: string;
  environment?: string;
}

export interface MetricQueryRequest {
  start: string;
  end: string;
  name: string;
  environment?: string;
  service_name?: string;
  step?: string;
  agg?: string;
  group_by?: string;
  filter?: Record<string, string>;
}

export interface ApiErrorResponse {
  error: string;
  code: string;
}
