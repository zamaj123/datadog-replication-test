import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { navigate } from "../../app/router";
import type { MetricQueryRequest } from "../../lib/api/types";
import { getDefaultEnd, getDefaultStart } from "../metrics/time";
import { useMetricNames } from "../metrics/useMetricNames";
import { ServiceMetricPanel } from "./ServiceMetricPanel";
import { useEnvironments } from "./useEnvironments";
import { useServiceSummary } from "./useServiceSummary";

const runtimeMetricPriority = [
  "runtime.cpu.usage",
  "runtime.memory.usage",
  "runtime.heap.used",
  "runtime.event_loop.delay"
];

function formatRate(value: number) {
  return `${value.toFixed(2)}/s`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatLatency(value: number) {
  return `${(value / 1_000_000).toFixed(1)} ms`;
}

function buildMetricRequest(base: {
  start: string;
  end: string;
  environment?: string;
  service_name: string;
}, name: string, agg: string, groupBy?: string): MetricQueryRequest {
  return {
    start: base.start,
    end: base.end,
    environment: base.environment,
    service_name: base.service_name,
    name,
    agg,
    group_by: groupBy
  };
}

export function ServiceMetricsPage({ serviceName }: { serviceName: string }) {
  const environments = useEnvironments();
  const [filters, setFilters] = useState({
    start: getDefaultStart(),
    end: getDefaultEnd(),
    environment: undefined as string | undefined
  });
  const summary = useServiceSummary(serviceName, filters);
  const metricNames = useMetricNames({
    environment: filters.environment,
    service_name: serviceName
  });
  const [runtimeMetric, setRuntimeMetric] = useState("");

  useEffect(() => {
    void summary.reload(filters);
  }, [serviceName, filters.start, filters.end, filters.environment]);

  useEffect(() => {
    metricNames.setRequest({
      environment: filters.environment,
      service_name: serviceName
    });
  }, [serviceName, filters.environment]);

  useEffect(() => {
    const names = metricNames.data?.names ?? [];
    const availableRuntimeMetric = runtimeMetricPriority.find((metricName) =>
      names.includes(metricName)
    );

    if (availableRuntimeMetric) {
      setRuntimeMetric((current) => current || availableRuntimeMetric);
      return;
    }

    if (names.length > 0) {
      setRuntimeMetric((current) => current || names[0]);
    }
  }, [metricNames.data]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await summary.reload(filters);
    await metricNames.reload();
  }

  const queryBase = {
    start: filters.start,
    end: filters.end,
    environment: filters.environment,
    service_name: serviceName
  };

  const availableRuntimeMetrics = (metricNames.data?.names ?? []).filter((name) =>
    runtimeMetricPriority.includes(name)
  );

  return (
    <main className="page">
      <div className="top-toolbar">
        <div className="top-toolbar__filters">
          <button type="button" className="toolbar-button toolbar-button--ghost" onClick={() => navigate("/services")}>
            Back to services
          </button>
          <span className="toolbar-chip">environment<br /><strong>{filters.environment ?? "all"}</strong></span>
          <span className="toolbar-chip">service_name<br /><strong>{serviceName}</strong></span>
          <span className="toolbar-chip">time<br /><strong>last 1 hour</strong></span>
        </div>
      </div>

      <header className="service-header">
        <div className="service-header__title">
          <div className="service-header__icon">DD</div>
          <div>
            <p className="service-header__eyebrow">Service</p>
            <h1>{serviceName}</h1>
          </div>
          <span className="service-tag">metrics</span>
          <span className="health-badge">Live</span>
        </div>
        <button type="button" className="service-config" onClick={() => navigate("/services")}>Services List</button>
      </header>

      <div className="service-layout">
        <aside className="service-nav">
          <button type="button" className="service-nav__item service-nav__item--active">Service Summary</button>
          <button type="button" className="service-nav__item">Versions</button>
          <button type="button" className="service-nav__item">Endpoints</button>
          <button type="button" className="service-nav__item">Runtime Metrics</button>
          <button type="button" className="service-nav__item">Logs</button>
          <button type="button" className="service-nav__item">Alerts</button>
        </aside>

        <section className="service-content">
          <section className="content-card">
            <div className="content-card__header">
              <h2>Service Filters</h2>
              <code className="query-endpoint">GET /api/v1/services/:service_name/summary</code>
            </div>

            <form className="service-filter-form" onSubmit={handleSubmit}>
              <label>
                <span>environment</span>
                <select
                  value={filters.environment ?? ""}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, environment: event.target.value || undefined }))
                  }
                >
                  <option value="">All environments</option>
                  {(environments.data?.environments ?? []).map((environment) => (
                    <option key={environment} value={environment}>
                      {environment}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>start</span>
                <input
                  value={filters.start}
                  onChange={(event) => setFilters((current) => ({ ...current, start: event.target.value }))}
                />
              </label>
              <label>
                <span>end</span>
                <input
                  value={filters.end}
                  onChange={(event) => setFilters((current) => ({ ...current, end: event.target.value }))}
                />
              </label>
              <div className="service-filter-form__actions">
                <button type="submit" className="toolbar-button" disabled={summary.isLoading}>
                  {summary.isLoading ? "Loading..." : "Refresh Service"}
                </button>
              </div>
            </form>

            {summary.error ? <p className="error">{summary.error}</p> : null}
            {metricNames.error ? <p className="error">{metricNames.error}</p> : null}

            <div className="summary-grid">
              <article className="summary-card">
                <span>request_rate_per_sec</span>
                <strong>{summary.data ? formatRate(summary.data.request_rate_per_sec) : "Loading..."}</strong>
              </article>
              <article className="summary-card">
                <span>error_rate</span>
                <strong>{summary.data ? formatPercent(summary.data.error_rate) : "Loading..."}</strong>
              </article>
              <article className="summary-card">
                <span>p95_latency_ns</span>
                <strong>{summary.data ? formatLatency(summary.data.p95_latency_ns) : "Loading..."}</strong>
              </article>
              <article className="summary-card">
                <span>p99_latency_ns</span>
                <strong>{summary.data ? formatLatency(summary.data.p99_latency_ns) : "Loading..."}</strong>
              </article>
              <article className="summary-card">
                <span>log_count</span>
                <strong>{summary.data ? String(summary.data.log_count) : "Loading..."}</strong>
              </article>
              <article className="summary-card">
                <span>active_alert_count</span>
                <strong>{summary.data ? String(summary.data.active_alert_count) : "Loading..."}</strong>
              </article>
            </div>
          </section>

          <section className="content-card">
            <div className="content-card__header">
              <h2>Versions</h2>
              <span className="placeholder-toggle">Blocked by contract</span>
            </div>
            <div className="blocked-panel">
              <p>
                The milestone review requires a versions breakdown, but current <code>INTERFACES.md</code> does not
                explicitly define a canonical version-breakdown query source for frontend implementation.
              </p>
              <p>The section is reserved here and will switch from placeholder to live data once that contract is explicit.</p>
            </div>
          </section>

          <div className="charts-row">
            <ServiceMetricPanel
              title="Requests"
              request={buildMetricRequest(queryBase, "service.requests.count", "sum")}
              emptyMessage="No request series returned for this service and time range."
            />
            <ServiceMetricPanel
              title="P95 Latency"
              request={buildMetricRequest(queryBase, "service.request.duration", "p95")}
              emptyMessage="No latency series returned for this service and time range."
            />
            <ServiceMetricPanel
              title="Errors"
              request={buildMetricRequest(queryBase, "service.errors.count", "sum")}
              emptyMessage="No error series returned for this service and time range."
            />
          </div>

          <div className="charts-row charts-row--double">
            <section className="content-card">
              <div className="content-card__header">
                <h2>Endpoints</h2>
                <span className="table-card__status">Grouped by endpoint</span>
              </div>
              <div className="content-card__body">
                <ServiceMetricPanel
                  title="Endpoint Request Volume"
                  request={buildMetricRequest(queryBase, "service.requests.count", "sum", "endpoint")}
                  emptyMessage="No endpoint-tagged request series returned."
                />
              </div>
            </section>

            <section className="content-card">
              <div className="content-card__header">
                <h2>Runtime Metrics</h2>
                <span className="table-card__status">{metricNames.isLoading ? "Loading names..." : "Live"}</span>
              </div>
              <div className="content-card__body">
                <div className="runtime-controls">
                  <label>
                    <span>runtime metric</span>
                    <select value={runtimeMetric} onChange={(event) => setRuntimeMetric(event.target.value)}>
                      {availableRuntimeMetrics.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <code className="query-endpoint">GET /api/v1/metrics/names</code>
                </div>

                {availableRuntimeMetrics.length > 0 ? (
                  <ServiceMetricPanel
                    title="Runtime Metric"
                    request={buildMetricRequest(queryBase, runtimeMetric, "avg")}
                    emptyMessage="No runtime metric series returned for the selected metric."
                  />
                ) : (
                  <div className="blocked-panel">
                    <p>No runtime metrics were advertised by <code>GET /api/v1/metrics/names</code> for this service.</p>
                  </div>
                )}

                <div className="metric-inventory">
                  <h3>Available metrics</h3>
                  <ul className="metric-list">
                    {(metricNames.data?.names ?? []).map((name) => (
                      <li key={name} className="metric-chip metric-chip--static">{name}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
