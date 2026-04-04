import { describe, expect, it } from "vitest";

import { normalizeMetricIdentity, validateIdentityConstraints } from "../src/normalization/resource";

describe("normalizeMetricIdentity", () => {
  it("maps OTel resource attributes to canonical fields", () => {
    const identity = normalizeMetricIdentity({
      resource: {
        "service.name": "api",
        "deployment.environment": "production",
        "host.name": "worker-1",
        "service.version": "v1"
      }
    });

    expect(identity).toEqual({
      service_name: "api",
      environment: "production",
      host: "worker-1",
      version: "v1"
    });
    expect(validateIdentityConstraints(identity)).toBeNull();
  });
});
