import type { Dispatch, SetStateAction } from "react";
import type { MetricNamesRequest, MetricNamesResponse } from "../../lib/api/types";

interface MetricNamesPanelProps {
  request: MetricNamesRequest;
  setRequest: Dispatch<SetStateAction<MetricNamesRequest>>;
  data: MetricNamesResponse | null;
  error: string | null;
  isLoading: boolean;
  onReload: () => void;
  selectedMetricName: string;
  onSelectMetricName: (name: string) => void;
}

export function MetricNamesPanel(props: MetricNamesPanelProps) {
  const {
    request,
    setRequest,
    data,
    error,
    isLoading,
    onReload,
    selectedMetricName,
    onSelectMetricName
  } = props;

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>Metric Names</h2>
          <p>Calls <code>GET /api/v1/metrics/names</code>.</p>
        </div>
        <button type="button" onClick={onReload} disabled={isLoading}>
          {isLoading ? "Loading..." : "Reload"}
        </button>
      </div>

      <div className="form-grid">
        <label>
          <span>environment</span>
          <input
            value={request.environment ?? ""}
            onChange={(event) =>
              setRequest((current) => ({ ...current, environment: event.target.value || undefined }))
            }
            placeholder="production"
          />
        </label>
        <label>
          <span>service_name</span>
          <input
            value={request.service_name ?? ""}
            onChange={(event) =>
              setRequest((current) => ({ ...current, service_name: event.target.value || undefined }))
            }
            placeholder="api-server"
          />
        </label>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <ul className="metric-list">
        {(data?.names ?? []).map((name) => (
          <li key={name}>
            <button
              type="button"
              className={name === selectedMetricName ? "metric-chip metric-chip--active" : "metric-chip"}
              onClick={() => onSelectMetricName(name)}
            >
              {name}
            </button>
          </li>
        ))}
      </ul>

      {!isLoading && data && data.names.length === 0 ? <p>No metric names returned.</p> : null}
    </section>
  );
}
