export type MetricPoint = {
  timestamp: string;
  value: number;
};

export type MetricSeries = {
  labels: Record<string, string>;
  points: MetricPoint[];
};

export type MetricQueryResponse = {
  name: string;
  step: string;
  agg: string;
  truncated: boolean;
  series: MetricSeries[];
};

export type MetricNamesResponse = {
  names: string[];
};

export type MetricQuery = {
  start: string;
  end: string;
  name: string;
  environment?: string;
  serviceName?: string;
  step?: string;
  agg: string;
  groupBy: string[];
  filters: Record<string, string>;
};

export type MockMetricRow = {
  timestamp: string;
  service_name: string;
  environment: string;
  name: string;
  tags: Record<string, string>;
  value: number;
};

