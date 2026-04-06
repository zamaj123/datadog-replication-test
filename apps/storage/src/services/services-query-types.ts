export type ServiceMetricRow = {
  timestamp: string;
  service_name: string;
  environment: string;
  name: string;
  unit: string;
  tags: Record<string, string>;
  value: number;
};

export type ServiceListItem = {
  service_name: string;
  environment: string;
  last_seen: string;
  request_rate_per_sec: number;
  error_rate: number;
  p99_latency_ns: number;
  log_count: number;
};

export type ServicesResponse = {
  services: ServiceListItem[];
};

export type ServiceSummaryResponse = {
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
};

export type EnvironmentsResponse = {
  environments: string[];
};
