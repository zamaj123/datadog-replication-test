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
      "name": "sample.request.count",
      "type": "counter",
      "value": 1,
      "tags": {
        "route": "/",
        "method": "GET"
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
| `DD_SITE` | Destination for telemetry export | Translated by the sample app or emitter config into the ingestion base URL; not forwarded as telemetry data |
| `DD_ENV` | Deployment environment | Emitted as `resource["deployment.environment"]`, then normalized by ingestion to `environment` |

Additional identity still required for a service metrics page:

| Input | Required? | Mapping |
|---|---|---|
| service name | yes | Emitted as `resource["service.name"]`, then normalized to `service_name` |
| version | optional | Emitted as `resource["service.version"]`, then normalized to `version` |
| host | optional | Emitted as `resource["host.name"]`, then normalized to `host` |

For this milestone, ingestion should not infer `service_name` from `DD_SITE`, hostname, or metric names. The sample app must provide a real service identity field.

---

## 5. Translation Boundary

Only one translation is needed for Datadog-like naming:

### 5.1 Sample-app / emitter translation

This is outside the ingestion-to-storage contract:

- `DD_API_KEY` becomes the `X-Api-Key` HTTP header
- `DD_SITE` becomes the ingestion destination URL used by the sample app or compatibility emitter
- `DD_ENV` becomes `resource["deployment.environment"]`

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

Ingestion assumes storage does not require any non-canonical fields beyond the metrics schema in `INTERFACES.md`.

---

## 9. Assumptions From Frontend

For the milestone to succeed, ingestion needs frontend to provide:

- a service metrics page that queries storage using the ingested `service_name`
- environment selection or filtering using canonical `environment`
- metric selection from names actually returned by storage
- a time range that includes the newly emitted metrics

Ingestion does not need any frontend-specific payload changes for this milestone.

---

## 10. Recommended Milestone Validation

The milestone should be considered complete for ingestion when this sequence works:

1. set sample-app env vars using the DD-style names
2. sample app sends a metric to `/v1/metrics`
3. ingestion accepts and normalizes it
4. ingestion writes the canonical metric row to ClickHouse
5. storage returns that metric for the sample app’s `service_name` and `environment`
6. frontend shows a real service metrics page for that app

The key proof points for ingestion are:

- `DD_API_KEY` was translated into valid `X-Api-Key` auth
- `DD_ENV` became canonical `environment`
- sample-app service identity became canonical `service_name`
- the metric was written under canonical storage fields, not Datadog field names

---

## 11. Open Issues

- The sample app still needs a concrete service-name input. `DD_ENV` alone is not enough to produce a valid service metrics page.
- If the sample app insists on using a Datadog vendor protocol instead of the canonical `/v1/metrics` JSON API, that would require a separate compatibility decision and should be documented before implementation.
- `DD_SITE` should be treated as sample-app destination configuration, not as an ingestion schema field.
