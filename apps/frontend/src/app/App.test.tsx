import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

function createJsonResponse(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  );
}

describe("App milestone flow", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/services");
    vi.restoreAllMocks();
  });

  it("loads the services discovery page and opens a real service metrics page", async () => {
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation((input) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname === "/api/v1/environments") {
        return createJsonResponse({ environments: ["production", "staging"] });
      }

      if (url.pathname === "/api/v1/services") {
        return createJsonResponse({
          services: [
            {
              service_name: "sample-app",
              environment: "production",
              last_seen: "2026-04-06T14:10:00Z",
              request_rate_per_sec: 12.5,
              error_rate: 0.01,
              p99_latency_ns: 240000000,
              log_count: 0
            }
          ]
        });
      }

      if (url.pathname === "/api/v1/services/sample-app/summary") {
        return createJsonResponse({
          service_name: "sample-app",
          environment: "production",
          start: "2026-04-06T13:10:00Z",
          end: "2026-04-06T14:10:00Z",
          last_seen: "2026-04-06T14:10:00Z",
          request_rate_per_sec: 12.5,
          error_rate: 0.01,
          p50_latency_ns: 48000000,
          p95_latency_ns: 130000000,
          p99_latency_ns: 240000000,
          log_count: 0,
          active_alert_count: 0
        });
      }

      if (url.pathname === "/api/v1/metrics/names") {
        return createJsonResponse({
          names: [
            "service.requests.count",
            "service.errors.count",
            "service.request.duration",
            "runtime.cpu.usage"
          ]
        });
      }

      if (url.pathname === "/api/v1/metrics/query") {
        const name = url.searchParams.get("name");
        const groupBy = url.searchParams.get("group_by");

        if (name === "service.requests.count" && groupBy === "endpoint") {
          return createJsonResponse({
            name,
            step: "1m",
            agg: "sum",
            truncated: false,
            series: [
              {
                labels: { endpoint: "/checkout" },
                points: [{ timestamp: "2026-04-06T14:10:00Z", value: 8 }]
              }
            ]
          });
        }

        if (name === "runtime.cpu.usage") {
          return createJsonResponse({
            name,
            step: "1m",
            agg: "avg",
            truncated: false,
            series: [
              {
                labels: {},
                points: [{ timestamp: "2026-04-06T14:10:00Z", value: 0.42 }]
              }
            ]
          });
        }

        return createJsonResponse({
          name,
          step: "1m",
          agg: url.searchParams.get("agg") ?? "avg",
          truncated: false,
          series: [
            {
              labels: {},
              points: [{ timestamp: "2026-04-06T14:10:00Z", value: 12.5 }]
            }
          ]
        });
      }

      return Promise.reject(new Error(`Unhandled request: ${url.pathname}`));
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Services" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "sample-app" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "sample-app" }));

    expect(await screen.findByRole("heading", { name: "sample-app" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Versions" })).toBeTruthy();
    expect(await screen.findByText("request_rate_per_sec")).toBeTruthy();
    expect(await screen.findByText("12.50/s")).toBeTruthy();
    expect((await screen.findAllByText("runtime.cpu.usage")).length).toBeGreaterThan(0);

    await waitFor(() => {
      const requestedPaths = fetchMock.mock.calls.map(([input]) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        return `${url.pathname}?${url.searchParams.toString()}`;
      });

      expect(requestedPaths.some((path) => path.startsWith("/api/v1/services?"))).toBe(true);
      expect(requestedPaths.some((path) => path.startsWith("/api/v1/services/sample-app/summary?"))).toBe(true);
      expect(requestedPaths.some((path) => path.startsWith("/api/v1/metrics/names?"))).toBe(true);
      expect(requestedPaths.some((path) => path.includes("name=service.requests.count"))).toBe(true);
      expect(requestedPaths.some((path) => path.includes("name=service.request.duration"))).toBe(true);
      expect(requestedPaths.some((path) => path.includes("name=service.errors.count"))).toBe(true);
      expect(requestedPaths.some((path) => path.includes("group_by=endpoint"))).toBe(true);
      expect(requestedPaths.some((path) => path.includes("name=runtime.cpu.usage"))).toBe(true);
    });
  });
});
