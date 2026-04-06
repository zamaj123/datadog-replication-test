import { apiGet } from "./client";
import type {
  EnvironmentsResponse,
  ServiceSummaryRequest,
  ServiceSummaryResponse,
  ServicesRequest,
  ServicesResponse
} from "./types";

function appendOptional(searchParams: URLSearchParams, key: string, value?: string) {
  if (value && value.trim() !== "") {
    searchParams.set(key, value);
  }
}

export function buildServicesSearchParams(request: ServicesRequest) {
  const searchParams = new URLSearchParams();

  searchParams.set("start", request.start);
  searchParams.set("end", request.end);
  appendOptional(searchParams, "environment", request.environment);

  return searchParams;
}

export function buildServiceSummarySearchParams(request: ServiceSummaryRequest) {
  const searchParams = new URLSearchParams();

  searchParams.set("start", request.start);
  searchParams.set("end", request.end);
  appendOptional(searchParams, "environment", request.environment);

  return searchParams;
}

export function getEnvironments() {
  return apiGet<EnvironmentsResponse>("/api/v1/environments");
}

export function getServices(request: ServicesRequest) {
  return apiGet<ServicesResponse>("/api/v1/services", buildServicesSearchParams(request));
}

export function getServiceSummary(serviceName: string, request: ServiceSummaryRequest) {
  return apiGet<ServiceSummaryResponse>(
    `/api/v1/services/${encodeURIComponent(serviceName)}/summary`,
    buildServiceSummarySearchParams(request)
  );
}
