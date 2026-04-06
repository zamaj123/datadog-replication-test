# Milestone Plan: Env-Driven Sample App Metrics Visibility

## 1. Objective

Define the minimum storage/query work needed so a separate sample app can emit metrics using Datadog-style env vars such as `DD_API_KEY`, `DD_SITE`, and `DD_ENV`, and the site can show a real metrics-oriented service page for that app.

This plan is storage-only. It does not redesign shared contracts in `INTERFACES.md`, and it does not plan logs or traces for this milestone.

## 2. Milestone Outcome

From the storage side, the milestone is complete when all of the following are true:

1. metrics emitted by the sample app are persisted into the canonical `metrics` table using the canonical storage schema
2. storage can list environments that include the sample app
3. storage can discover the sample app on `/services`
4. storage can return a metrics-backed service summary on `/services/:service_name`
5. storage can return metric names for that service/environment
6. storage can return real metric series for that service/environment over a recent time range
7. the site can use those responses to render the required `/services` and `/services/:service_name` flow for the sample app

## 3. Required Storage Behavior

### 3.1 Canonical Milestone Endpoint Set Must Work

For this milestone, storage must back these canonical endpoints with real ClickHouse data:

- `GET /api/v1/environments`
- `GET /api/v1/services`
- `GET /api/v1/services/:service_name/summary`
- `GET /api/v1/metrics/names`
- `GET /api/v1/metrics/query`

These endpoints are not optional for this milestone. The frontend milestone requires users to:

1. land on `/services`
2. discover the emitted service there
3. click through to `/services/:service_name`

### 3.2 Service Discovery And Summary Must Be Metrics-Backed

For this milestone, storage should treat the service page as a metrics-backed page, not a full multi-signal summary.

Required service-list and service-summary meanings:

- `request_rate_per_sec` from `service.requests.count`
- `error_rate` from `service.errors.count / service.requests.count`
- `/services` `p99_latency_ns` from the `service.request.duration` histogram
- `/services/:service_name/summary` `p50_latency_ns` from the `service.request.duration` histogram
- `/services/:service_name/summary` `p95_latency_ns` from the `service.request.duration` histogram
- `/services/:service_name/summary` `p99_latency_ns` from the `service.request.duration` histogram
- `/services` `log_count = 0`
- `/services/:service_name/summary` `log_count = 0`
- `active_alert_count = 0`

These values must be computed at `service_name` + optional `environment` scope using the selected `[start, end)` time range.
`active_alert_count` applies only to `GET /api/v1/services/:service_name/summary`, because it is not part of the `GET /api/v1/services` response contract in `INTERFACES.md`.

### 3.3 Raw Metrics Must Be Read From The Canonical Table

For this milestone, storage must read the sample app’s metrics from the canonical raw `metrics` table in ClickHouse.

Required behavior:

- connect to the same `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, and `CLICKHOUSE_DATABASE` that ingestion writes to
- query the `metrics` table in that database
- use canonical filter fields from `INTERFACES.md`: `service_name`, `environment`, `name`, and `filter[...]`
- enforce `[start, end)` time range semantics
- return ISO timestamps in responses

This is enough to make recent emitted metrics visible without depending on logs, traces, or alert state.

### 3.4 Metric Name Discovery Must Work

`GET /api/v1/metrics/names` must work against real ClickHouse data.

Required behavior:

- filter by optional `service_name`
- filter by optional `environment`
- return distinct metric names visible for that scope
- not depend on mocks or fixture data

This endpoint is the simplest proof that storage can see the sample app’s emitted metrics at all.

### 3.5 Metric Query Must Work For Recent Sample-App Data

`GET /api/v1/metrics/query` must work against real ClickHouse data.

Required behavior:

- match the exact `name`
- apply optional `service_name`
- apply optional `environment`
- apply exact tag filters from `filter[...]`
- preserve raw data for auto-selected short ranges
- use exact nanosecond boundaries for ClickHouse time filtering
- shape the canonical response with `name`, `step`, `agg`, `truncated`, `series[].labels`, and `series[].points`

For this milestone, correctness matters more than rollup optimization. A recent, service-scoped query over raw data is sufficient.

### 3.6 Practical Implementation Notes

The milestone implementation in `apps/storage` uses:

- `GET /api/v1/environments` from distinct `environment` values in the `metrics` table
- `GET /api/v1/services` from metrics-backed aggregation over raw `metrics` rows in the requested time range
- `GET /api/v1/services/:service_name/summary` from metrics-backed aggregation over raw `metrics` rows in the requested time range

For this milestone implementation:

- `log_count` is returned as `0`
- `active_alert_count` is returned as `0`

This matches the milestone review scope and keeps the implementation within storage ownership while logs and alerts remain out of scope for this milestone.

### 3.7 Review/Spec Conflict Notes

Two review-driven areas required explicit handling against `INTERFACES.md`:

1. Earlier review guidance described service latency mainly in terms of `p95_latency_ns`, but `INTERFACES.md` requires:
   - `/services` `p99_latency_ns`
   - `/services/:service_name/summary` `p50_latency_ns`, `p95_latency_ns`, and `p99_latency_ns`

   The implementation follows `INTERFACES.md` for the endpoint field set while keeping the milestone metrics-backed derivation.

2. The milestone review requires a versions breakdown on the service page, but `INTERFACES.md` does not explicitly define a canonical read path for version breakdown and does not explicitly allow `group_by=version` on `GET /api/v1/metrics/query`.

   The implementation does not invent a new contract here. It preserves `version` in storage and leaves the version-breakdown read path blocked on contract clarification.

## 4. Schema, Index, And Aggregation Changes

### 4.1 Schema Changes

No new raw metrics schema is required for this milestone.

The current canonical `metrics` table already stores the fields storage needs:

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

That is sufficient for:

- service/environment discovery from metrics
- metrics-backed service summary values for this milestone
- metric name discovery
- service-scoped metric series queries

### 4.2 Index Strategy

No new index or table-ordering change is required for the milestone.

The current ordering of the raw metrics table:

- `(service_name, environment, name, timestamp)`

already matches the dominant milestone read path:

- one selected `service_name`
- one selected `environment`
- one selected `name`
- recent `start` / `end`

That ordering is appropriate for the service metrics page and should be kept for this milestone.

### 4.3 Rollups And Aggregation

No new rollup requirement is needed to make the sample app visible on the site.

For the milestone:

- recent windows can read directly from raw `metrics`
- auto-selected raw behavior for short ranges must remain correct
- existing 1-minute and 1-hour rollup design can remain a later optimization, not a milestone prerequisite

Storage should not introduce new aggregation semantics for this milestone. It should keep the canonical `agg` behavior from `INTERFACES.md`.

## 5. Required Milestone Metric Set And Derived Values

Storage assumes the sample app emits this minimum metric set:

- `service.requests.count`
- `service.errors.count`
- `service.request.duration`
- `runtime.cpu.usage`
- `runtime.memory.usage`
- `runtime.heap.used`
- `runtime.event_loop.delay`

Storage also assumes these milestone dimensions are available where applicable:

- `endpoint`
- `http.method`
- `http.status_code`
- `version`
- `environment`
- `service_name`

The milestone endpoint tag key is:

- `endpoint`

For storage, these decisions matter because:

- `/services` and `/services/:service_name/summary` depend on the first three service metrics
- the service detail page’s runtime section depends on the four runtime metrics
- endpoint-level charts and grouping depend on the `endpoint` tag key remaining stable
- version breakdown remains a milestone requirement, but storage cannot assume a non-explicit metric-query grouping contract

## 6. Storage Assumptions From Ingestion

Storage needs these assumptions to hold for the milestone:

### 6.1 Canonical Identity Fields Are Present

Every written metric row must already contain:

- `service_name`
- `environment`
- `host`
- `version`

Storage assumes ingestion has normalized these from upstream DD/OTel-style inputs before writing.

### 6.2 The Sample App Emits A Stable Service Identity

The sample app must emit a stable, non-empty:

- `service_name`
- `environment`

for every metric row.

For a sample app configured through env vars, storage assumes ingestion maps the app’s emitted environment into canonical `environment` and does not write empty strings for either required field.

Storage also assumes these env mappings are fixed for the milestone:

- `DD_SERVICE -> service_name`
- `DD_ENV -> environment`
- `DD_VERSION -> version`
- missing `DD_VERSION -> version = ""`

Storage should not infer `service_name` or `version` from hostnames, metric names, or `DD_SITE`.

### 6.3 Metric Names Are Stable And Queryable

Storage assumes ingestion writes canonical metric names that the frontend can reuse directly in `GET /api/v1/metrics/query`.

That means:

- no storage-side rename layer
- no metrics-only alias translation
- the names returned by `GET /api/v1/metrics/names` are the names accepted by `GET /api/v1/metrics/query`

Storage also assumes the sample app emits through the existing canonical `POST /v1/metrics` JSON contract, not through a Datadog-vendor-specific ingestion protocol.

### 6.4 Timestamps Are Recent

Storage assumes the sample app emits timestamps close to real wall clock time.

This matters because the site’s default recent time ranges will legitimately return no data if ingestion writes historical sample timestamps outside the selected window.

### 6.5 Runtime ClickHouse Config Matches

Storage assumes ingestion writes to the same runtime ClickHouse target that storage reads from:

- same host
- same port
- same database
- same canonical `metrics` table

If ingestion and storage point at different databases or hosts, storage cannot make the sample app visible regardless of query correctness.

## 7. Storage Assumptions From Frontend

### 7.1 Service And Environment Selection Must Be Explicit

Storage assumes frontend will scope requests using:

- `service_name`
- optional `environment`, defaulting to all environments for the milestone

and will preserve those canonical names in all metrics requests.

### 7.2 Default Time Range Must Include Fresh Data

Storage assumes the frontend default time range is the last 1 hour and intended for live sample-app data.

For this milestone, frontend should not expect storage to surface old fixture timestamps in a recent default range. Storage will correctly return no data when the selected `[start, end)` window excludes the emitted rows.

### 7.3 Metric Picker Uses The Same Scope As The Chart

Storage assumes frontend will call:

- `GET /api/v1/metrics/names?service_name=...&environment=...`

and then pass one of those returned names into:

- `GET /api/v1/metrics/query`

using the same `service_name` and `environment` scope.

### 7.4 Service Flow Is Required

Storage assumes frontend will implement the required milestone route flow:

1. fetch `/services`
2. display the emitted sample-app service there
3. navigate to `/services/:service_name`
4. fetch `/services/:service_name/summary`
5. fetch `metrics/names` and `metrics/query` within the same service/environment scope

Storage should not plan around a metrics-only page that bypasses `/services` discovery for this milestone.

### 7.5 Version Breakdown Is Required On The Service Page

Storage assumes the service page will show a versions list or breakdown and allow filtering or grouping by version.

For storage, the current contract situation is:

- `version` must remain a top-level canonical stored field
- no storage-side collapsing of version values should be introduced for milestone reads

However, `INTERFACES.md` does not explicitly state that `GET /api/v1/metrics/query` supports `group_by=version`, and the canonical service endpoints do not expose a version breakdown field.

So storage should not treat a version-breakdown read path as contract-settled yet. For this milestone plan, the storage-owned requirement is:

- preserve `version` in the raw metrics schema
- preserve the ability to add a contract-approved version-breakdown query path without schema changes

Before implementation depends on version-breakdown reads, the contract must be clarified in docs by one of:

1. explicitly allowing `version` as a supported grouping dimension for `GET /api/v1/metrics/query`, or
2. adding a separate canonical endpoint/field for version breakdown

Until that clarification exists, storage should not implement the version breakdown against an assumed query contract.

## 8. Milestone Storage Work Items

### 8.1 Validate Real ClickHouse Read Path

Before any milestone polish, storage should prove:

- `GET /api/v1/environments` returns the sample app environment
- `GET /api/v1/services` returns the sample app service with contract fields including `p99_latency_ns` and without `active_alert_count`
- `GET /api/v1/services/:service_name/summary` returns the metrics-backed summary fields for the sample app
- `GET /api/v1/metrics/names` returns at least one real metric name for the sample app scope
- `GET /api/v1/metrics/query` returns at least one real series for that same scope

This is the first storage-side checkpoint for milestone success.

### 8.2 Keep Query Logic Strictly Canonical

Storage should keep the milestone read path aligned to `INTERFACES.md`:

- canonical params only
- canonical response fields only
- exact service/environment filtering
- no storage-specific aliases

### 8.3 Defer Non-Milestone Optimizations

Do not make these a milestone prerequisite:

- new telemetry stores
- logs/traces endpoint work
- broad rollup redesign
- extra caching layers
- non-canonical response shortcuts

## 9. Validation For This Milestone

Storage is ready for the milestone when it can demonstrate all of the following against real sample-app emissions:

1. `GET /api/v1/environments` returns the emitted environment
2. `GET /api/v1/services` returns the emitted service with contract fields including `request_rate_per_sec`, `error_rate`, `p99_latency_ns`, and `log_count = 0`
3. `GET /api/v1/services/:service_name/summary` returns `request_rate_per_sec`, `error_rate`, `p50_latency_ns`, `p95_latency_ns`, `p99_latency_ns`, `log_count = 0`, and `active_alert_count = 0` for the selected scope
4. `GET /api/v1/metrics/names?service_name=<sample>&environment=<env>` returns non-empty names
5. `GET /api/v1/metrics/query` for one returned name and a recent time range returns non-empty series
6. the same storage instance is reading the same ClickHouse database ingestion writes to
7. the query path does not exclude rows due to stale timestamps, mismatched `service_name`, mismatched `environment`, or incorrect tag filters
8. version remains preserved in stored metrics rows and available for future contract-approved query use

## 10. Open Issues

- The exact ClickHouse query shape for deriving `p95_latency_ns` from the exploded `service.request.duration` histogram rows should be fixed during implementation and validated against the canonical histogram write format from `INTERFACES.md`.
- Before storage implements the versions breakdown, the contract must be clarified in docs so the read path is explicit rather than inferred from `group_by=version`.
