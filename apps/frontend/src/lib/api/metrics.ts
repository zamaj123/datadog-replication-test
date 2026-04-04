import { apiGet } from "./client";
import type {
  MetricNamesRequest,
  MetricNamesResponse,
  MetricQueryRequest,
  MetricQueryResponse
} from "./types";

function appendOptional(searchParams: URLSearchParams, key: string, value?: string) {
  if (value && value.trim() !== "") {
    searchParams.set(key, value);
  }
}

export function buildMetricNamesSearchParams(request: MetricNamesRequest) {
  const searchParams = new URLSearchParams();

  appendOptional(searchParams, "environment", request.environment);
  appendOptional(searchParams, "service_name", request.service_name);

  return searchParams;
}

export function buildMetricQuerySearchParams(request: MetricQueryRequest) {
  const searchParams = new URLSearchParams();

  searchParams.set("start", request.start);
  searchParams.set("end", request.end);
  searchParams.set("name", request.name);
  appendOptional(searchParams, "environment", request.environment);
  appendOptional(searchParams, "service_name", request.service_name);
  appendOptional(searchParams, "step", request.step);
  appendOptional(searchParams, "agg", request.agg);
  appendOptional(searchParams, "group_by", request.group_by);

  Object.entries(request.filter ?? {}).forEach(([key, value]) => {
    if (value.trim() !== "") {
      searchParams.set(`filter[${key}]`, value);
    }
  });

  return searchParams;
}

export function getMetricNames(request: MetricNamesRequest) {
  return apiGet<MetricNamesResponse>("/api/v1/metrics/names", buildMetricNamesSearchParams(request));
}

export function getMetricQuery(request: MetricQueryRequest) {
  return apiGet<MetricQueryResponse>("/api/v1/metrics/query", buildMetricQuerySearchParams(request));
}
