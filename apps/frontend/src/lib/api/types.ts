export interface MetricNamesResponse {
  names: string[];
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
