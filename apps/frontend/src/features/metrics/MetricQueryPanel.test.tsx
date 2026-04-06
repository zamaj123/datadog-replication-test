import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MetricQueryPanel } from "./MetricQueryPanel";

describe("MetricQueryPanel", () => {
  it("keeps the canonical group_by control available", () => {
    const setRequest = vi.fn();

    render(
      <MetricQueryPanel
        title="Requests"
        request={{
          start: "2026-04-02T09:00:00Z",
          end: "2026-04-02T10:00:00Z",
          name: "http.request.duration",
          environment: "production",
          service_name: "api-server",
          agg: "avg",
          step: "1m"
        }}
        setRequest={setRequest}
        data={null}
        error={null}
        isLoading={false}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const groupByInput = screen.getByLabelText("group_by");
    expect(groupByInput).toBeTruthy();

    fireEvent.change(groupByInput, { target: { value: "service_name,http.method" } });

    expect(setRequest).toHaveBeenCalledWith({
      start: "2026-04-02T09:00:00Z",
      end: "2026-04-02T10:00:00Z",
      name: "http.request.duration",
      environment: "production",
      service_name: "api-server",
      agg: "avg",
      step: "1m",
      group_by: "service_name,http.method"
    });
  });
});
