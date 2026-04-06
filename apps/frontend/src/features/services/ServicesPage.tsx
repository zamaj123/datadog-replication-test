import { useEffect } from "react";
import type { FormEvent } from "react";
import { navigate } from "../../app/router";
import type { ServiceListItem, ServicesRequest } from "../../lib/api/types";
import { getDefaultEnd, getDefaultStart } from "../metrics/time";
import { useEnvironments } from "./useEnvironments";
import { useServicesList } from "./useServicesList";

function formatLatency(value: number) {
  return `${(value / 1_000_000).toFixed(1)} ms`;
}

function formatErrorRate(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatRate(value: number) {
  return `${value.toFixed(2)}/s`;
}

function renderServiceRow(service: ServiceListItem) {
  return (
    <tr key={`${service.environment}-${service.service_name}`}>
      <td>
        <button
          type="button"
          className="service-link"
          onClick={() => navigate(`/services/${encodeURIComponent(service.service_name)}`)}
        >
          {service.service_name}
        </button>
      </td>
      <td>{service.environment}</td>
      <td>{service.last_seen}</td>
      <td>{formatRate(service.request_rate_per_sec)}</td>
      <td>{formatErrorRate(service.error_rate)}</td>
      <td>{formatLatency(service.p99_latency_ns)}</td>
      <td>{service.log_count}</td>
    </tr>
  );
}

export function ServicesPage() {
  const environments = useEnvironments();
  const services = useServicesList({
    start: getDefaultStart(),
    end: getDefaultEnd(),
    environment: undefined
  });

  useEffect(() => {
    void services.reload(services.request);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await services.reload(services.request);
  }

  function handleRequestChange(patch: Partial<ServicesRequest>) {
    services.setRequest((current) => ({ ...current, ...patch }));
  }

  return (
    <main className="page page--services">
      <div className="top-toolbar">
        <div className="top-toolbar__filters">
          <span className="toolbar-chip">scope<br /><strong>services</strong></span>
          <span className="toolbar-chip">environment<br /><strong>{services.request.environment ?? "all"}</strong></span>
          <span className="toolbar-chip">time<br /><strong>last 1 hour</strong></span>
        </div>
      </div>

      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">APM</p>
          <h1>Services</h1>
          <p className="page-header__summary">Discover emitted services and open a real metrics-backed service page.</p>
        </div>
      </header>

      <section className="content-card">
        <div className="content-card__header">
          <h2>Discovery Filters</h2>
        </div>

        <form className="service-filter-form" onSubmit={handleSubmit}>
          <label>
            <span>environment</span>
            <select
              value={services.request.environment ?? ""}
              onChange={(event) => handleRequestChange({ environment: event.target.value || undefined })}
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
              value={services.request.start}
              onChange={(event) => handleRequestChange({ start: event.target.value })}
            />
          </label>

          <label>
            <span>end</span>
            <input
              value={services.request.end}
              onChange={(event) => handleRequestChange({ end: event.target.value })}
            />
          </label>

          <div className="service-filter-form__actions">
            <button type="submit" className="toolbar-button" disabled={services.isLoading}>
              {services.isLoading ? "Loading..." : "Load Services"}
            </button>
            <code className="query-endpoint">GET /api/v1/services</code>
          </div>
        </form>

        {environments.error ? <p className="error">{environments.error}</p> : null}
        {services.error ? <p className="error">{services.error}</p> : null}
      </section>

      <section className="content-card">
        <div className="content-card__header">
          <h2>Service Discovery</h2>
          <span className="table-card__status">
            {(services.data?.services.length ?? 0) > 0
              ? `1-${services.data?.services.length} of ${services.data?.services.length}`
              : "0 services"}
          </span>
        </div>

        <div className="services-table-wrap">
          <table className="services-table">
            <thead>
              <tr>
                <th>service_name</th>
                <th>environment</th>
                <th>last_seen</th>
                <th>request_rate_per_sec</th>
                <th>error_rate</th>
                <th>p99_latency_ns</th>
                <th>log_count</th>
              </tr>
            </thead>
            <tbody>{(services.data?.services ?? []).map(renderServiceRow)}</tbody>
          </table>

          {!services.isLoading && services.data && services.data.services.length === 0 ? (
            <div className="metric-table__empty">
              <div className="metric-table__empty-icon">!</div>
              <p>No services were returned for the selected environment and time range.</p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
