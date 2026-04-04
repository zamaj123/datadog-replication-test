import type { MockMetricRow } from "./metrics-query-types.js";

export const mockMetricRows: MockMetricRow[] = [
  {
    timestamp: "2026-04-02T09:00:00.000Z",
    service_name: "api-server",
    environment: "production",
    name: "http.request.duration",
    tags: { "http.method": "POST", "http.route": "/v1/checkout" },
    value: 143.2,
  },
  {
    timestamp: "2026-04-02T09:01:00.000Z",
    service_name: "api-server",
    environment: "production",
    name: "http.request.duration",
    tags: { "http.method": "POST", "http.route": "/v1/checkout" },
    value: 156.8,
  },
  {
    timestamp: "2026-04-02T09:00:00.000Z",
    service_name: "api-server",
    environment: "production",
    name: "http.request.duration",
    tags: { "http.method": "GET", "http.route": "/health" },
    value: 12.5,
  },
  {
    timestamp: "2026-04-02T09:01:00.000Z",
    service_name: "worker",
    environment: "staging",
    name: "process.cpu.usage",
    tags: { cpu: "total" },
    value: 0.42,
  },
  {
    timestamp: "2026-04-02T09:00:00.000Z",
    service_name: "api-server",
    environment: "production",
    name: "http.request.count",
    tags: { "http.method": "POST" },
    value: 18,
  },
];

