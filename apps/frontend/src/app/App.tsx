import { ServiceMetricsPage } from "../features/services/ServiceMetricsPage";
import { ServicesPage } from "../features/services/ServicesPage";
import { useAppRoute } from "./router";

export function App() {
  const route = useAppRoute();

  return (
    <div className="app-shell">
      <aside className="global-rail">
        <div className="brand">
          <div className="brand__mark">DD</div>
          <div className="brand__name">DATADOG</div>
        </div>

        <nav className="global-rail__nav">
          <button className="rail-link rail-link--muted" type="button">Go to...</button>
          <button className="rail-link rail-link--muted" type="button">Recent</button>
          <button className="rail-link rail-link--muted" type="button">Dashboards</button>
          <button className="rail-link rail-link--muted" type="button">Monitoring</button>
          <button className="rail-link rail-link--muted" type="button">Infrastructure</button>
          <button className="rail-link rail-link--active" type="button">APM</button>
          <button className="rail-link rail-link--muted" type="button">Metrics</button>
          <button className="rail-link rail-link--muted" type="button">Logs</button>
        </nav>

        <div className="global-rail__footer">
          <button className="rail-link rail-link--muted" type="button">Datadog Setup</button>
          <button className="rail-link rail-link--muted" type="button">Help</button>
        </div>
      </aside>

      <div className="workspace">
        {route.kind === "services" ? (
          <ServicesPage />
        ) : (
          <ServiceMetricsPage serviceName={route.serviceName} />
        )}
      </div>
    </div>
  );
}
