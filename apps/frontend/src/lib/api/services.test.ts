import { describe, expect, it } from "vitest";
import { buildServiceSummarySearchParams, buildServicesSearchParams } from "./services";

describe("buildServicesSearchParams", () => {
  it("uses canonical services-list parameters", () => {
    const searchParams = buildServicesSearchParams({
      start: "2026-04-02T09:00:00Z",
      end: "2026-04-02T10:00:00Z",
      environment: "production"
    });

    expect(searchParams.get("start")).toBe("2026-04-02T09:00:00Z");
    expect(searchParams.get("end")).toBe("2026-04-02T10:00:00Z");
    expect(searchParams.get("environment")).toBe("production");
    expect(searchParams.has("from")).toBe(false);
    expect(searchParams.has("to")).toBe(false);
    expect(searchParams.has("env")).toBe(false);
  });
});

describe("buildServiceSummarySearchParams", () => {
  it("uses canonical service-summary parameters", () => {
    const searchParams = buildServiceSummarySearchParams({
      start: "2026-04-02T09:00:00Z",
      end: "2026-04-02T10:00:00Z",
      environment: "production"
    });

    expect(searchParams.get("start")).toBe("2026-04-02T09:00:00Z");
    expect(searchParams.get("end")).toBe("2026-04-02T10:00:00Z");
    expect(searchParams.get("environment")).toBe("production");
    expect(searchParams.has("from")).toBe(false);
    expect(searchParams.has("to")).toBe(false);
    expect(searchParams.has("env")).toBe(false);
  });
});
