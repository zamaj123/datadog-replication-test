# Milestone Plan: DD-Style Env Metrics Ingestion

**Agent:** Ingestion  
**Scope:** Metrics only  
**Contract source:** `INTERFACES.md`

---

## 1. Objective

Define the minimal ingestion-side plan to support this milestone:

- a separate sample app emits metrics using Datadog-like environment configuration
- ingestion accepts those metrics through the existing `/v1/metrics` contract
- storage and frontend can show a real service metrics page for that app

This plan does not redesign ingestion contracts, add a storage write API, or plan logs/traces work.

---

## 2. Milestone Shape

The milestone should work like this:

```text
sample app
  -> metrics client / small compatibility emitter
  -> POST /v1/metrics
  -> ingestion normalization + validation
  -> ClickHouse metrics table
  -> storage metrics query API
  -> frontend service metrics page
```

The ingestion contract remains the canonical `/v1/metrics` JSON API from `INTERFACES.md`.

---

## 3. What the Sample App Should Emit

The sample app should emit metric requests in the existing ingestion format:

```json
{
  "metrics": [
    {
      "resource": {
        "service.name": "sample-app",
        "deployment.environment": "development",
        "host.name": "localhost",
        "service.version": "v1"
      },
      "timestamp": 1711234567890,
      "name": "service.requests.count",
      "type": "counter",
      "value": 1,
      "tags": {
        "endpoint": "/",
        "http.method": "GET",
        "http.status_code": "200"
      }
    }
  ]
}
```

This is already compatible with ingestion’s current metrics normalization path:

- `resource.service.name` maps to `service_name`
- `resource.deployment.environment` maps to `environment`
- `resource.host.name` maps to `host`
- `resource.service.version` maps to `version`
- millisecond timestamps are converted to nanoseconds by ingestion

The sample app does not need to emit top-level canonical identity fields directly for this milestone, as long as it emits the supported OTel-style `resource` attributes.

---

## 4. DD-Style Env Mapping

The milestone should support Datadog-like environment names at the sample-app configuration layer, without changing the ingestion API.

| Sample-app env | Meaning for this milestone | Mapping |
|---|---|---|
| `DD_API_KEY` | Shared ingestion API key | Sent as `X-Api-Key` on requests to `/v1/metrics` |
| `DD_SITE` | Destination for telemetry export | Used as the base URL for `POST /v1/metrics`; not forwarded as telemetry data |
| `DD_ENV` | Deployment environment | Emitted as `resource["deployment.environment"]`, then normalized by ingestion to `environment` |
| `DD_SERVICE` | Service identity | Emitted as `resource["service.name"]`, then normalized by ingestion to `service_name` |
| `DD_VERSION` | Service version | Emitted as `resource["service.version"]`, then normalized by ingestion to `version`; defaults to `""` when absent |

Additional identity still required for a service metrics page:

| Input | Required? | Mapping |
|---|---|---|
| service name | yes | Primary source is `DD_SERVICE`, emitted as `resource["service.name"]`, then normalized to `service_name` |
| version | no | Primary source is `DD_VERSION`, emitted as `resource["service.version"]`, then normalized to `version`; defaults to `""` |
| host | optional | Emitted as `resource["host.name"]`, then normalized to `host` |

For this milestone, ingestion should not infer `service_name` or `version` from hostname, metric names, or `DD_SITE`. The sample app must provide `DD_SERVICE`, and missing `DD_VERSION` becomes `version = ""`.

---

## 5. Translation Boundary

Only one translation is needed for Datadog-like naming:

### 5.1 Sample-app / emitter translation

This is outside the ingestion-to-storage contract:

- `DD_API_KEY` becomes the `X-Api-Key` HTTP header
- `DD_SITE` becomes the base URL used by the sample app or emitter for `POST /v1/metrics`
- `DD_ENV` becomes `resource["deployment.environment"]`
- `DD_SERVICE` becomes `resource["service.name"]`
- `DD_VERSION` becomes `resource["service.version"]`, defaulting to omission and therefore `version = ""`

### 5.2 Ingestion translation

This is already owned by ingestion and already matches `INTERFACES.md`:

- `resource["service.name"]` -> `service_name`
- `resource["deployment.environment"]` -> `environment`
- `resource["host.name"]` -> `host`
- `resource["service.version"]` -> `version`
- timestamp ms -> timestamp ns

### 5.3 No translation at storage boundary

Rows written to ClickHouse must remain canonical:

- `service_name`
- `environment`
- `host`
- `version`
- `timestamp`
- `name`
- `type`
- `unit`
- `value`
- `tags`

No Datadog-specific field names should cross the ingestion-to-storage boundary.

---

## 6. What Ingestion Should Accept for This Milestone

Ingestion should accept metrics from the sample app exactly as allowed by `INTERFACES.md` and the current ingestion implementation:

- `POST /v1/metrics`
- `Content-Type: application/json`
- `X-Api-Key` auth
- body shape `{ "metrics": [...] }`
- OTel-style `resource` block for identity
- metric `type` of `gauge`, `counter`, or `histogram`
- millisecond timestamps from the sample app

The sample app should use the canonical JSON envelope. It should not use a Datadog vendor ingestion protocol or a separate compatibility endpoint.

### 6.1 Required metric set

The sample app must emit these service metrics:

- `service.requests.count`
- `service.errors.count`
- `service.request.duration` as a histogram

The sample app must also emit these runtime metrics:

- `runtime.cpu.usage`
- `runtime.memory.usage`
- `runtime.heap.used`
- `runtime.event_loop.delay`

### 6.2 Required dimensions

The milestone assumes these dimensions are available where applicable:

- `endpoint`
- `http.method`
- `http.status_code`
- `version`
- `environment`
- `service_name`

For this milestone, the endpoint tag key is `endpoint`.

The sample app should emit `version` through the canonical identity mapping on every milestone metric so downstream consumers can group by version using existing canonical query endpoints.

Ingestion should reject:

- missing or invalid `X-Api-Key`
- missing `service.name` / `service_name` after normalization
- missing `deployment.environment` / `environment` after normalization
- malformed metric tags
- unsupported metric type `summary`

---

## 7. Minimum Ingestion Changes Required

This milestone should stay minimal.

### 7.1 Required ingestion work

- document the sample-app emission shape and env mapping
- explicitly document `DD_SERVICE`, `DD_ENV`, `DD_VERSION`, and `DD_SITE` handling
- keep the sample app on the canonical `/v1/metrics` JSON protocol
- verify the required milestone metrics and `endpoint` dimension pass through ingestion unchanged
- verify the current `/v1/metrics` path accepts the sample app’s emitted payload
- verify the written ClickHouse row shape matches the canonical metrics schema
- add or keep a deterministic smoke path that proves:
  - request accepted by ingestion
  - canonical metric row written
  - row queryable by storage

### 7.2 Not required from ingestion

- no contract changes
- no new ingestion endpoint
- no Datadog API emulation
- no `DD_SITE` parsing inside ingestion
- no logs or traces work

### 7.3 Possible small ingestion helper work

If a tiny ingestion-owned helper is needed for local milestone validation, it should be limited to:

- a sample request builder
- a smoke script
- temporary validation docs

It should not introduce a second ingestion protocol.

---

## 8. Assumptions From Storage

For the milestone to succeed, ingestion needs storage to provide:

- a real `metrics` ClickHouse table using the canonical schema
- storage query code reading from the same ClickHouse database/table that ingestion writes to
- metric names discoverable through `GET /api/v1/metrics/names`
- metric series queryable through `GET /api/v1/metrics/query`
- service and environment filters honoring canonical `service_name` and `environment`
- `/api/v1/services` staying aligned to `INTERFACES.md`, including:
  - `p99_latency_ns` for list latency
  - no `active_alert_count` field on the services list response
- `/api/v1/services/:service_name/summary` staying aligned to `INTERFACES.md`, including:
  - `active_alert_count`
  - `p95_latency_ns` and `p99_latency_ns`
- version-breakdown data being sourced through existing canonical metrics queries, not a new version-specific endpoint

Ingestion assumes storage does not require any non-canonical fields beyond the metrics schema in `INTERFACES.md`.

---

## 9. Assumptions From Frontend

For the milestone to succeed, ingestion needs frontend to provide:

- a service metrics page that queries storage using the ingested `service_name`
- environment selection or filtering using canonical `environment`
- metric selection from names actually returned by storage
- a time range that includes the newly emitted metrics
- `/services` list behavior aligned to the current contract:
  - show `p99_latency_ns` for latency
  - do not expect `active_alert_count` on the services list
- versions breakdown on `/services/:service_name` sourced via existing canonical endpoints, using metrics grouped or filtered by `version`

Ingestion does not need any frontend-specific payload changes for this milestone.

---

## 10. Recommended Milestone Validation

The milestone should be considered complete for ingestion when this sequence works:

1. set sample-app env vars using `DD_API_KEY`, `DD_SITE`, `DD_ENV`, `DD_SERVICE`, and optional `DD_VERSION`
2. sample app sends the required milestone metrics to `/v1/metrics`
3. ingestion accepts and normalizes it
4. ingestion writes the canonical metric row to ClickHouse
5. storage returns that metric for the sample app’s `service_name` and `environment`
6. frontend shows a real service metrics page for that app

The key proof points for ingestion are:

- `DD_API_KEY` was translated into valid `X-Api-Key` auth
- `DD_SERVICE` became canonical `service_name`
- `DD_ENV` became canonical `environment`
- `DD_VERSION` became canonical `version`, defaulting to `""` when absent
- the required service and runtime metrics were accepted without renaming
- the `endpoint` dimension was preserved as `endpoint`
- the `version` field was preserved on milestone metrics so downstream version grouping is possible through canonical query APIs
- the metric was written under canonical storage fields, not Datadog field names

---

## 11. Open Issues

- If the sample app insists on using a Datadog vendor protocol instead of the canonical `/v1/metrics` JSON API, that would require a separate compatibility decision and should be documented before implementation.
- `DD_SITE` should be treated as sample-app destination configuration, not as an ingestion schema field.
