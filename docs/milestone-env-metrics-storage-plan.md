# Milestone Plan: Env-Driven Sample App Metrics Visibility

## 1. Objective

Define the minimum storage/query work needed so a separate sample app can emit metrics using Datadog-style env vars such as `DD_API_KEY`, `DD_SITE`, and `DD_ENV`, and the site can show a real metrics-oriented service page for that app.

This plan is storage-only. It does not redesign shared contracts in `INTERFACES.md`, and it does not plan logs or traces for this milestone.

## 2. Milestone Outcome

From the storage side, the milestone is complete when all of the following are true:

1. metrics emitted by the sample app are persisted into the canonical `metrics` table using the canonical storage schema
2. storage can discover that the service exists for the selected environment
3. storage can return metric names for that service/environment
4. storage can return real metric series for that service/environment over a recent time range
5. the site can use those responses to render a service-scoped metrics page for the sample app

## 3. Required Storage Behavior

### 3.1 Raw Metrics Must Be Read From The Canonical Table

For this milestone, storage must read the sample app’s metrics from the canonical raw `metrics` table in ClickHouse.

Required behavior:

- connect to the same `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, and `CLICKHOUSE_DATABASE` that ingestion writes to
- query the `metrics` table in that database
- use canonical filter fields from `INTERFACES.md`: `service_name`, `environment`, `name`, and `filter[...]`
- enforce `[start, end)` time range semantics
- return ISO timestamps in responses

This is enough to make recent emitted metrics visible without depending on logs, traces, or alert state.

### 3.2 Metric Name Discovery Must Work

`GET /api/v1/metrics/names` must work against real ClickHouse data.

Required behavior:

- filter by optional `service_name`
- filter by optional `environment`
- return distinct metric names visible for that scope
- not depend on mocks or fixture data

This endpoint is the simplest proof that storage can see the sample app’s emitted metrics at all.

### 3.3 Metric Query Must Work For Recent Sample-App Data

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

## 5. Minimum Endpoints For This Milestone

### 5.1 Must Work

These endpoints must work with real ClickHouse data:

- `GET /api/v1/metrics/names`
- `GET /api/v1/metrics/query`

Those are the minimum endpoints required for a service-scoped metrics view where the selected service and environment are already known.

### 5.2 Likely Needed For A Real Service Page

If the frontend milestone includes actual `/services` navigation or a `/services/:service_name` page header, these endpoints should also work:

- `GET /api/v1/services`
- `GET /api/v1/services/:service_name/summary`

Storage can support the service page milestone in one of two ways:

1. Preferred: implement these canonical service endpoints using metrics-backed service discovery and service summary fields where the needed values are derivable from emitted metrics.
2. Minimum fallback for the milestone: frontend navigates with a known `service_name` and `environment`, and the service metrics page relies on metrics endpoints only.

Because this plan is metrics-only, logs- and traces-derived service summary values are not a milestone dependency here.

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

### 6.3 Metric Names Are Stable And Queryable

Storage assumes ingestion writes canonical metric names that the frontend can reuse directly in `GET /api/v1/metrics/query`.

That means:

- no storage-side rename layer
- no metrics-only alias translation
- the names returned by `GET /api/v1/metrics/names` are the names accepted by `GET /api/v1/metrics/query`

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
- optional `environment`

and will preserve those canonical names in all metrics requests.

### 7.2 Default Time Range Must Include Fresh Data

Storage assumes the frontend default time range is recent and intended for live sample-app data.

For this milestone, frontend should not expect storage to surface old fixture timestamps in a recent default range. Storage will correctly return no data when the selected `[start, end)` window excludes the emitted rows.

### 7.3 Metric Picker Uses The Same Scope As The Chart

Storage assumes frontend will call:

- `GET /api/v1/metrics/names?service_name=...&environment=...`

and then pass one of those returned names into:

- `GET /api/v1/metrics/query`

using the same `service_name` and `environment` scope.

### 7.4 Service Page Routing Must Provide A Real Service Context

If the milestone is framed as a real service page, storage assumes frontend has one of these behaviors:

1. fetch a real service from `GET /api/v1/services` and navigate using that `service_name`, or
2. otherwise enter the page with an explicitly chosen `service_name` and optional `environment`

Storage should not be expected to infer the selected service from metric names alone.

## 8. Milestone Storage Work Items

### 8.1 Validate Real ClickHouse Read Path

Before any milestone polish, storage should prove:

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

1. `GET /api/v1/metrics/names?service_name=<sample>&environment=<env>` returns non-empty names
2. `GET /api/v1/metrics/query` for one returned name and a recent time range returns non-empty series
3. the same storage instance is reading the same ClickHouse database ingestion writes to
4. the query path does not exclude the row due to stale timestamps, mismatched `service_name`, mismatched `environment`, or incorrect tag filters

## 10. Open Issues

- If the milestone requires the site to discover services dynamically from a service list page, storage may need `GET /api/v1/services` earlier than the current metrics-only UI path.
- If the milestone requires the service detail header to show canonical summary fields from `GET /api/v1/services/:service_name/summary`, the exact source metrics for `request_rate_per_sec`, `error_rate`, and latency percentiles must be confirmed before implementation. That is a milestone coordination question, not a storage contract change.
