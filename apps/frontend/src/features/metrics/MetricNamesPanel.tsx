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
    <section className="metric-table">
      <div className="metric-table__header">
        <div className="metric-table__filters">
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
        <button type="button" className="table-options" onClick={onReload} disabled={isLoading}>
          {isLoading ? "Loading..." : "Reload"}
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="metric-table__columns">
        <span>METRIC NAME</span>
        <span>QUERY STATUS</span>
        <span>SELECTION</span>
      </div>

      <ul className="metric-table__rows">
        {(data?.names ?? []).map((name) => {
          const isSelected = name === selectedMetricName;

          return (
            <li key={name} className="metric-row">
              <span className="metric-row__name">{name}</span>
              <span className="metric-row__status">GET /api/v1/metrics/names</span>
              <button
                type="button"
                className={isSelected ? "metric-chip metric-chip--active" : "metric-chip"}
                onClick={() => onSelectMetricName(name)}
              >
                {isSelected ? "Selected" : "Select"}
              </button>
            </li>
          );
        })}
      </ul>

      {!isLoading && data && data.names.length === 0 ? (
        <div className="metric-table__empty">
          <div className="metric-table__empty-icon">!</div>
          <p>No metric names returned for the current filters.</p>
        </div>
      ) : null}
    </section>
  );
}
