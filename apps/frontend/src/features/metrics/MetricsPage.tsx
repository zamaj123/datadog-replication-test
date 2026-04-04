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
      <header className="hero">
        <p className="eyebrow">Datadog Frontend</p>
        <h1>Metrics Contract Smoke Test</h1>
        <p>
          This scaffold only implements the metrics path: bootstrap, metric-name lookup, and one
          metric query view using the canonical transport field names from <code>INTERFACES.md</code>.
        </p>
      </header>

      <div className="page__grid">
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
        <MetricQueryPanel
          request={metricQuery.request}
          setRequest={metricQuery.setRequest}
          data={metricQuery.data}
          error={metricQuery.error}
          isLoading={metricQuery.isLoading}
          onSubmit={metricQuery.runQuery}
        />
      </div>
    </main>
  );
}
