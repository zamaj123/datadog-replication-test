# Milestone Env Metrics Review

## Objective

Turn the env-driven metrics milestone review into a concrete guide for ingestion, storage, and frontend so their implementation plans converge on one executable milestone:

> From a separate sample app, send metrics using `DD_API_KEY` / `DD_SITE` / `DD_ENV`-style env vars, and have our site show a real service metrics page for that app.

Reviewed sources:

- `INTERFACES.md`
- PR #34 — `docs/milestone-env-metrics-ingestion-plan.md`
- PR #35 — `docs/milestone-env-metrics-frontend-plan.md`
- PR #36 — `docs/milestone-env-metrics-storage-plan.md`

## Milestone Decisions

These decisions are now fixed for this milestone and should be reflected in all three subsystem plans.

### 1. Sample-app identity mapping

- `DD_SERVICE` -> canonical `service_name`
- `DD_ENV` -> canonical `environment`
- `DD_VERSION` -> canonical `version`
- `DD_SITE` -> ingestion base URL

If `DD_VERSION` is missing, ingestion/storage/frontend should treat the value as:

- `version = ""`

No subsystem should infer `service_name` or `version` from hostname, metric names, or `DD_SITE`.

### 2. Sample-app emission protocol

The sample app uses:

- the existing canonical `POST /v1/metrics` JSON contract

It does not use:

- a Datadog vendor ingestion protocol
- a separate compatibility endpoint

### 3. Required metric names

The sample app must emit these service-scoped metrics:

- `service.requests.count`
- `service.errors.count`
- `service.request.duration` as a histogram

The sample app must also emit these runtime metrics:

- `runtime.cpu.usage`
- `runtime.memory.usage`
- `runtime.heap.used`
- `runtime.event_loop.delay`

### 4. Required dimensions

The milestone assumes these dimensions are available where applicable:

- `endpoint`
- `http.method`
- `http.status_code`
- `version`
- `environment`
- `service_name`

The endpoint tag key for this milestone is:

- `endpoint`

### 5. Required derived service values

For this milestone, storage and frontend should use these meanings:

- `request_rate_per_sec` from `service.requests.count`
- `error_rate` from `service.errors.count / service.requests.count`
- `p95_latency_ns` from the `service.request.duration` histogram at the same `service_name` + `environment` scope
- `log_count = 0`
- `active_alert_count = 0`

Logs and alerts are out of scope for this milestone.

### 6. Required frontend routes

These routes are required for milestone completion:

- `/services`
- `/services/:service_name`

Users are expected to:

1. land on `/services`
2. discover the emitted service there
3. click through to `/services/:service_name`

### 7. Default UI behavior

- environment scope defaults to all environments
- default time range is last 1 hour

### 8. Version behavior

The service page must:

- show a versions list or breakdown
- allow filtering or grouping by version

The `/services` list does not need version or version-count columns unless they fall out cheaply.

## Required Plan Changes

### Ingestion

The ingestion milestone plan should be updated so it explicitly says:

- `DD_SERVICE` is the primary source of `service_name`
- `DD_ENV` is the source of `environment`
- `DD_VERSION` is the source of `version`, defaulting to `""` when absent
- `DD_SITE` is the base URL for `POST /v1/metrics`
- the sample app emits the canonical metrics JSON envelope, not a Datadog vendor protocol
- the minimum required emitted metrics are:
  - `service.requests.count`
  - `service.errors.count`
  - `service.request.duration`
  - the four runtime metrics listed above
- the required dimension key is `endpoint`

The ingestion plan should not leave the sample app’s `service_name` source as an open question anymore.

### Storage

The storage milestone plan should be updated so it explicitly commits to the canonical endpoints required by the frontend milestone:

- `GET /api/v1/environments`
- `GET /api/v1/services`
- `GET /api/v1/services/:service_name/summary`
- `GET /api/v1/metrics/names`
- `GET /api/v1/metrics/query`

The storage plan should no longer describe the service endpoints as optional for this milestone.

It should also explicitly tie milestone summary fields to the agreed metric sources:

- `request_rate_per_sec` from `service.requests.count`
- `error_rate` from `service.errors.count / service.requests.count`
- `p95_latency_ns` from `service.request.duration`
- `log_count = 0`
- `active_alert_count = 0`

Storage should treat this as a metrics-backed service page milestone, not a full multi-signal service summary milestone.

### Frontend

The frontend milestone plan should be updated so it explicitly aligns the page requirements to the metrics-only scope:

- `/services` is required
- `/services/:service_name` is required
- `/services` shows:
  - `service_name`
  - `environment`
  - `last_seen`
  - `request_rate_per_sec`
  - `error_rate`
  - `p95_latency_ns`
  - `log_count = 0`
  - `active_alert_count = 0`
- `/services/:service_name` shows:
  - service header
  - versions breakdown
  - Requests
  - p95 Latency
  - Errors
  - Endpoints
  - Runtime Metrics

The frontend plan should not require logs or alerts behavior for milestone success.

It should also stop treating richer service-summary expectations as implicit if they depend on out-of-scope signals.

## Remaining Cross-Plan Risks

After the decisions above, the main remaining risks are narrower:

### 1. Minimum emitted metric set still needs to be written identically into all three plans.

This is now decided, but until each plan is updated, the milestone still risks drifting into:

- arbitrary sample metrics
- incomplete service-page inputs
- inconsistent endpoint or runtime sections

### 2. Service-summary semantics must stay metrics-backed for this milestone.

If any plan re-expands the milestone to depend on logs or alerts, it will no longer match the agreed scope.

### 3. Version handling must stay explicit.

All three plans should preserve:

- `DD_VERSION` -> `version`
- missing `DD_VERSION` -> `version = ""`

No inference layer should be introduced.

## Conclusion

The milestone is achievable with metrics only under the clarified scope above.

The next step for the subsystem agents is not to redesign anything further. It is to update their milestone implementation plans so they all reflect the same fixed decisions:

- canonical DD-style env mapping
- canonical `/v1/metrics` emission
- one required metric set
- one required dimension set
- required `/services` and `/services/:service_name` flow
- metrics-backed service summary with `log_count = 0` and `active_alert_count = 0`
