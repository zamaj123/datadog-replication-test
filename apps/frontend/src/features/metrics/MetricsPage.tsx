import { useEffect } from "react";
import { MetricNamesPanel } from "./MetricNamesPanel";
import { MetricQueryPanel } from "./MetricQueryPanel";
import { getDefaultEnd, getDefaultStart } from "./time";
import { useMetricNames } from "./useMetricNames";
import { useMetricQuery } from "./useMetricQuery";

export function MetricsPage() {
  const metricNames = useMetricNames({
    environment: "",
    service_name: ""
  });

  const metricQuery = useMetricQuery({
    start: getDefaultStart(),
    end: getDefaultEnd(),
    name: "",
    environment: "",
    service_name: "",
    agg: "avg"
  });

  useEffect(() => {
    const firstMetricName = metricNames.data?.names[0];

    if (firstMetricName && metricQuery.request.name === "") {
      metricQuery.setRequest({ ...metricQuery.request, name: firstMetricName });
    }
  }, [metricNames.data, metricQuery]);

  return (
    <main className="page">
      <div className="top-toolbar">
        <div className="top-toolbar__filters">
          <span className="toolbar-chip">operation<br /><strong>{metricQuery.request.name || "select a metric"}</strong></span>
          <span className="toolbar-chip">environment<br /><strong>{metricNames.request.environment || "demo"}</strong></span>
          <span className="toolbar-chip">service_name<br /><strong>{metricNames.request.service_name || "all"}</strong></span>
        </div>
        <div className="top-toolbar__time">
          <button type="button" className="toolbar-button">1h</button>
          <button type="button" className="toolbar-button toolbar-button--ghost">Past 1 Hour</button>
        </div>
      </div>

      <header className="service-header">
        <div className="service-header__title">
          <div className="service-header__icon">DD</div>
          <div>
            <p className="service-header__eyebrow">Service</p>
            <h1>datadog-demo-app</h1>
          </div>
          <span className="service-tag">js</span>
          <span className="health-badge">OK</span>
        </div>
        <button type="button" className="service-config">Service Config</button>
      </header>

      <div className="service-layout">
        <aside className="service-nav">
          <button type="button" className="service-nav__item">Service Summary</button>
          <button type="button" className="service-nav__item">Endpoints</button>
          <button type="button" className="service-nav__item service-nav__item--active">Deployments</button>
          <button type="button" className="service-nav__item">Dependencies</button>
          <button type="button" className="service-nav__item">Traces</button>
          <button type="button" className="service-nav__item">Errors</button>
          <button type="button" className="service-nav__item">Infrastructure</button>
          <button type="button" className="service-nav__item">Runtime Metrics</button>
          <button type="button" className="service-nav__item">Logs</button>
          <button type="button" className="service-nav__item">Security</button>
        </aside>

        <section className="service-content">
          <div className="content-card">
            <div className="content-card__header">
              <h2>Deployments</h2>
            </div>

            <div className="charts-row">
              <MetricQueryPanel
                title="Requests"
                request={metricQuery.request}
                setRequest={metricQuery.setRequest}
                data={metricQuery.data}
                error={metricQuery.error}
                isLoading={metricQuery.isLoading}
                onSubmit={metricQuery.runQuery}
              />
              <section className="chart-card chart-card--placeholder">
                <div className="chart-card__header">
                  <h3>P95 Latency</h3>
                  <span>Top 5</span>
                </div>
                <div className="empty-chart" />
              </section>
              <section className="chart-card chart-card--placeholder">
                <div className="chart-card__header">
                  <h3>Errors</h3>
                  <span>Top 5</span>
                </div>
                <div className="empty-chart" />
              </section>
            </div>

            <div className="table-card">
              <div className="table-card__header">
                <div className="table-card__status">Showing {(metricNames.data?.names.length ?? 0) > 0 ? `1-${metricNames.data?.names.length}` : "0-0"} of {metricNames.data?.names.length ?? 0}</div>
                <div className="table-card__actions">
                  <input aria-label="Search metric names" className="table-search" placeholder="Search metric names" />
                  <button type="button" className="table-options">Options</button>
                </div>
              </div>
              <MetricNamesPanel
                request={metricNames.request}
                setRequest={metricNames.setRequest}
                data={metricNames.data}
                error={metricNames.error}
                isLoading={metricNames.isLoading}
                onReload={metricNames.reload}
                selectedMetricName={metricQuery.request.name}
                onSelectMetricName={(name) => metricQuery.setRequest({ ...metricQuery.request, name })}
              />
            </div>
          </div>

          <div className="content-card content-card--collapsed">
            <div className="content-card__header">
              <h2>Dependencies</h2>
              <span className="placeholder-toggle">Grouped</span>
            </div>
            <div className="placeholder-panel" />
          </div>
        </section>
      </div>
    </main>
  );
}
