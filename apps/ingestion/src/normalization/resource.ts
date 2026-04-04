import { CanonicalMetricIdentity, ResourceAttributes } from "../types/metrics";

const MAX_SERVICE_NAME = 256;
const MAX_ENVIRONMENT = 64;

function canonicalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function emptyWhenMissing(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizeMetricIdentity(input: {
  resource?: ResourceAttributes;
  service_name?: string;
  environment?: string;
  host?: string;
  version?: string;
}): CanonicalMetricIdentity {
  const resource = input.resource ?? {};

  const serviceName =
    canonicalString(input.service_name) ??
    canonicalString(resource["service.name"]) ??
    "";

  const environment =
    canonicalString(input.environment) ??
    canonicalString(resource["deployment.environment"]) ??
    "";

  const host =
    canonicalString(input.host) ??
    emptyWhenMissing(resource["host.name"]);

  const version =
    canonicalString(input.version) ??
    emptyWhenMissing(resource["service.version"]);

  return {
    service_name: serviceName,
    environment,
    host,
    version
  };
}

export function validateIdentityConstraints(identity: CanonicalMetricIdentity): string | null {
  if (identity.service_name.length === 0) {
    return "service_name";
  }
  if (identity.environment.length === 0) {
    return "environment";
  }
  if (identity.service_name.length > MAX_SERVICE_NAME) {
    return "service_name";
  }
  if (identity.environment.length > MAX_ENVIRONMENT) {
    return "environment";
  }

  return null;
}
