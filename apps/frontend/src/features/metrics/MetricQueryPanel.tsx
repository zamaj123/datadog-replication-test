import type { FormEvent } from "react";
import type {
  MetricQueryRequest,
  MetricQueryResponse,
  MetricQuerySeries
} from "../../lib/api/types";

interface MetricQueryPanelProps {
  title: string;
  request: MetricQueryRequest;
  setRequest: (request: MetricQueryRequest) => void;
  data: MetricQueryResponse | null;
  error: string | null;
  isLoading: boolean;
  onSubmit: (request: MetricQueryRequest) => Promise<void>;
}

function renderLabels(labels: Record<string, string>) {
  const entries = Object.entries(labels);

  if (entries.length === 0) {
    return "{}";
  }

  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

function renderSeries(series: MetricQuerySeries, index: number) {
  return (
    <li key={`${index}-${renderLabels(series.labels)}`} className="series-card">
      <p className="series-card__labels">{renderLabels(series.labels)}</p>
      <ul className="points-list">
        {series.points.map((point) => (
          <li key={`${point.timestamp}-${point.value}`}>
            <code>{point.timestamp}</code>
            <span>{point.value}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function MetricQueryPanel(props: MetricQueryPanelProps) {
  const { title, request, setRequest, data, error, isLoading, onSubmit } = props;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(request);
  }

  return (
    <section className="panel">
      <div className="chart-card__header">
        <div>
          <h3>{title}</h3>
          <span>Top 5</span>
        </div>
      </div>

      <form className="query-form query-form--compact" onSubmit={handleSubmit}>
        <div className="query-form__row">
          <label>
            <span>name</span>
            <input
              required
              value={request.name}
              onChange={(event) => setRequest({ ...request, name: event.target.value })}
              placeholder="http.request.duration"
            />
          </label>
          <label>
            <span>start</span>
            <input
              required
              value={request.start}
              onChange={(event) => setRequest({ ...request, start: event.target.value })}
            />
          </label>
          <label>
            <span>end</span>
            <input
              required
              value={request.end}
              onChange={(event) => setRequest({ ...request, end: event.target.value })}
            />
          </label>
        </div>
        <div className="query-form__row">
          <label>
            <span>environment</span>
            <input
              value={request.environment ?? ""}
              onChange={(event) => setRequest({ ...request, environment: event.target.value || undefined })}
              placeholder="production"
            />
          </label>
          <label>
            <span>service_name</span>
            <input
              value={request.service_name ?? ""}
              onChange={(event) => setRequest({ ...request, service_name: event.target.value || undefined })}
              placeholder="api-server"
            />
          </label>
          <label>
            <span>agg</span>
            <input
              value={request.agg ?? ""}
              onChange={(event) => setRequest({ ...request, agg: event.target.value || undefined })}
              placeholder="avg"
            />
          </label>
          <label>
            <span>group_by</span>
            <input
              value={request.group_by ?? ""}
              onChange={(event) => setRequest({ ...request, group_by: event.target.value || undefined })}
              placeholder="service_name,http.method"
            />
          </label>
          <label>
            <span>step</span>
            <input
              value={request.step ?? ""}
              onChange={(event) => setRequest({ ...request, step: event.target.value || undefined })}
              placeholder="1m"
            />
          </label>
        </div>

        <div className="query-form__actions">
          <button type="submit" disabled={isLoading}>
          {isLoading ? "Loading..." : "Run Query"}
          </button>
          <code className="query-endpoint">GET /api/v1/metrics/query</code>
        </div>
      </form>

      {error ? <p className="error">{error}</p> : null}

      {data ? (
        <div className="chart-results">
          <div className="results__meta">
            <span><strong>name:</strong> {data.name}</span>
            <span><strong>step:</strong> {data.step}</span>
            <span><strong>agg:</strong> {data.agg}</span>
            <span><strong>truncated:</strong> {String(data.truncated)}</span>
          </div>

          <ul className="series-list series-list--tight">
            {data.series.map(renderSeries)}
          </ul>

          {data.series.length === 0 ? <p>No series returned.</p> : null}
        </div>
      ) : (
        <div className="empty-chart" />
      )}
    </section>
  );
}
