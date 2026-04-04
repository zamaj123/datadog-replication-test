import { describe, expect, it } from "vitest";
import { buildMetricNamesSearchParams, buildMetricQuerySearchParams } from "./metrics";

describe("buildMetricNamesSearchParams", () => {
  it("uses canonical metric-names parameters", () => {
    const searchParams = buildMetricNamesSearchParams({
      environment: "production",
      service_name: "api-server"
    });

    expect(searchParams.get("environment")).toBe("production");
    expect(searchParams.get("service_name")).toBe("api-server");
    expect(searchParams.has("env")).toBe(false);
    expect(searchParams.has("service")).toBe(false);
  });
});

describe("buildMetricQuerySearchParams", () => {
  it("uses canonical metric-query parameters and filter keys", () => {
    const searchParams = buildMetricQuerySearchParams({
      start: "2026-04-02T09:00:00Z",
      end: "2026-04-02T10:00:00Z",
      name: "http.request.duration",
      environment: "production",
      service_name: "api-server",
      agg: "avg",
      step: "1m",
      group_by: "service_name,http.method",
      filter: {
        "http.method": "POST"
      }
    });

    expect(searchParams.get("start")).toBe("2026-04-02T09:00:00Z");
    expect(searchParams.get("end")).toBe("2026-04-02T10:00:00Z");
    expect(searchParams.get("name")).toBe("http.request.duration");
    expect(searchParams.get("environment")).toBe("production");
    expect(searchParams.get("service_name")).toBe("api-server");
    expect(searchParams.get("agg")).toBe("avg");
    expect(searchParams.get("step")).toBe("1m");
    expect(searchParams.get("group_by")).toBe("service_name,http.method");
    expect(searchParams.get("filter[http.method]")).toBe("POST");
    expect(searchParams.has("from")).toBe(false);
    expect(searchParams.has("to")).toBe(false);
    expect(searchParams.has("env")).toBe(false);
    expect(searchParams.has("service")).toBe(false);
    expect(searchParams.has("interval")).toBe(false);
  });
});
