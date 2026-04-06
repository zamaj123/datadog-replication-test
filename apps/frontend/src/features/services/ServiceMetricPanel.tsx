import { useEffect } from "react";
import { useMetricQuery } from "../metrics/useMetricQuery";
import type { MetricQueryRequest, MetricQuerySeries } from "../../lib/api/types";

interface ServiceMetricPanelProps {
  title: string;
  request: MetricQueryRequest;
  emptyMessage: string;
}

function renderLabels(labels: Record<string, string>) {
  const entries = Object.entries(labels);

  if (entries.length === 0) {
    return "{}";
  }

  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

function getLastPoint(series: MetricQuerySeries) {
  return series.points[series.points.length - 1] ?? null;
}

export function ServiceMetricPanel({ title, request, emptyMessage }: ServiceMetricPanelProps) {
  const query = useMetricQuery(request);

  useEffect(() => {
    void query.runQuery(request);
  }, [request]);

  return (
    <section className="chart-card">
      <div className="chart-card__header">
        <div>
          <h3>{title}</h3>
          <span>{request.name}</span>
        </div>
        <code className="query-endpoint">GET /api/v1/metrics/query</code>
      </div>

      <div className="results__meta">
        <span><strong>agg:</strong> {request.agg ?? "avg"}</span>
        <span><strong>step:</strong> {request.step ?? "auto"}</span>
        <span><strong>group_by:</strong> {request.group_by ?? "none"}</span>
      </div>

      {query.error ? <p className="error">{query.error}</p> : null}
      {query.isLoading ? <p className="panel-status">Loading metric data...</p> : null}

      {query.data && query.data.series.length > 0 ? (
        <ul className="series-list series-list--tight">
          {query.data.series.map((series, index) => {
            const lastPoint = getLastPoint(series);

            return (
              <li key={`${title}-${index}-${renderLabels(series.labels)}`} className="series-card">
                <p className="series-card__labels">{renderLabels(series.labels)}</p>
                <div className="metric-glance">
                  <span>{lastPoint ? lastPoint.timestamp : "No points"}</span>
                  <strong>{lastPoint ? String(lastPoint.value) : "N/A"}</strong>
                </div>
                <ul className="points-list">
                  {series.points.slice(-5).map((point) => (
                    <li key={`${point.timestamp}-${point.value}`}>
                      <code>{point.timestamp}</code>
                      <span>{point.value}</span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : null}

      {!query.isLoading && query.data && query.data.series.length === 0 ? (
        <p className="panel-status">{emptyMessage}</p>
      ) : null}
    </section>
  );
}
