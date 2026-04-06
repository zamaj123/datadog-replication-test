export interface SmokeMetricCase {
  environment: string;
  metricName: string;
  serviceName: string;
  start: string;
  end: string;
  timestampMs: number;
  payload: {
    metrics: Array<{
      resource: {
        "service.name": string;
        "deployment.environment": string;
      };
      timestamp: number;
      name: string;
      type: "counter";
      value: number;
      tags: Record<string, string>;
    }>;
  };
}

function iso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

export function buildSmokeMetricCase(now: number = Date.now()): SmokeMetricCase {
  const suffix = `${now}`;
  const environment = "production";
  const serviceName = `smoke-service-${suffix}`;
  const metricName = `smoke.metric.${suffix}`;
  const timestampMs = now;

  return {
    environment,
    metricName,
    serviceName,
    start: iso(now - 60_000),
    end: iso(now + 60_000),
    timestampMs,
    payload: {
      metrics: [
        {
          resource: {
            "service.name": serviceName,
            "deployment.environment": environment,
          },
          timestamp: timestampMs,
          name: metricName,
          type: "counter",
          value: 1,
          tags: {
            source: "metrics-roundtrip-smoke",
          },
        },
      ],
    },
  };
}
