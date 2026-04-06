# Milestone Plan — Env Metrics Frontend

**Agent:** Frontend  
**Date:** 2026-04-06  
**Status:** Planning only

---

## 1. Objective

Define the minimum frontend milestone needed for a user to:

1. run a separate sample app configured with `DD_API_KEY`, `DD_SITE`, and `DD_ENV`-style environment variables
2. emit metrics through the platform pipeline
3. open this frontend
4. discover the emitted service
5. view a usable service metrics page showing real data for that service

This plan stays strictly within the frontend subsystem. It does not redesign the platform or expand into logs or traces.

---

## 2. Milestone Outcome

For this milestone, the frontend succeeds if a user can:

1. open the site
2. select an environment that matches the emitted sample app
3. see the sample app appear in a services list
4. open that service
5. view a service metrics page backed by real query responses

The milestone is not a full observability surface. It is a minimum “real service metrics page” flow.

---

## 3. Minimum UI Flow

### 3.1 Entry

The user lands on either:

- `/services`
- or `/dashboard/overview` with a clear path into `/services`

For this milestone, `/services` should be treated as the primary entry because it is the most direct way to discover a newly emitting sample app.

### 3.2 Discovery

The user should be able to:

1. choose an `environment`
2. set a recent `timeRange`
3. see a list of emitting services for that range
4. click the sample app row

### 3.3 Service View

After selection, the user should land on:

- `/services/:service_name`

This page should show:

- service identity
- last seen
- summary metrics for the current time range
- one small set of real charts or series views driven by canonical metric queries

The page must feel like a usable service page even if the scope is metrics-only.

---

## 4. Pages for This Milestone

Only two pages are required.

### 4.1 Services List Page

Route:

- `/services`

Purpose:

- discover whether the sample app is being received as a real service
- select that emitted service

Minimum elements:

- page title
- environment selector
- time range selector
- services table
- empty state when no services are found

### 4.2 Service Metrics Page

Route:

- `/services/:service_name`

Purpose:

- show a real service page for the selected app using current canonical metrics and service summary responses

Minimum elements:

- service header
- environment and time context
- summary stats row
- metric selector or metric sections
- one or more real metric panels
- empty-state boxes for not-yet-implemented areas

No separate overview dashboard, logs page, trace page, or alert workflow is required for this milestone.

---

## 5. How the Emitted Service Should Be Discovered

The frontend should not require the user to know the service name in advance.

Discovery should work through:

- `GET /api/v1/services`

Recommended discovery flow:

1. default the user into a recent time window
2. allow environment selection
3. query the services list
4. render `services[]`
5. let the user click the row where `service_name` matches the emitted sample app

The frontend should not invent a separate “service search” endpoint for this milestone.

If multiple services appear, the user still has a clear, contract-aligned discovery path: the services list.

---

## 6. Storage Endpoints the Frontend Must Rely On

This milestone should rely only on the canonical query API endpoints already defined in `INTERFACES.md`.

### 6.1 Required

- `GET /api/v1/services`
  - for service discovery
- `GET /api/v1/services/:service_name/summary`
  - for the service header and summary stats
- `GET /api/v1/metrics/names`
  - for available metric names for the selected service
- `GET /api/v1/metrics/query`
  - for the real metric charts / series views
- `GET /api/v1/environments`
  - for environment selection

### 6.2 Not Required for This Milestone

- `GET /api/v1/logs`
- `GET /api/v1/logs/volume`
- `GET /api/v1/traces`
- `GET /api/v1/traces/:trace_id`
- alert endpoints

Those remain out of scope.

---

## 7. Minimum Data Flow

### 7.1 Services List

The services list page should:

1. call `GET /api/v1/environments`
2. call `GET /api/v1/services?start=...&end=...&environment=...`
3. render:
   - `service_name`
   - `environment`
   - `last_seen`
   - `request_rate_per_sec`
   - `error_rate`
   - `p99_latency_ns`
   - `log_count`

### 7.2 Service Metrics Page

The service page should:

1. call `GET /api/v1/services/:service_name/summary?start=...&end=...&environment=...`
2. call `GET /api/v1/metrics/names?service_name=...&environment=...`
3. call `GET /api/v1/metrics/query?...`

The service page should render real data from:

- `request_rate_per_sec`
- `error_rate`
- `p50_latency_ns`
- `p95_latency_ns`
- `p99_latency_ns`
- `last_seen`
- `active_alert_count` only if desired as a summary chip; it does not require alert UI
- metric `series[].labels`
- metric `series[].points[]`

---

## 8. Frontend Defaults That Could Hide Real Data

This is the highest-risk part of the milestone. A real emitting sample app can still appear “missing” if the frontend defaults are wrong.

### 8.1 Time Range Default

The frontend must default to a recent range that will catch newly emitted metrics.

Recommended default:

- last 1 hour

Avoid defaults that are too narrow or too unusual for a first-run flow.

Risk:

- if the default window is too short, the service list may appear empty even though the sample app emitted data shortly before the page loaded

### 8.2 Environment Default

The environment selector must not silently filter to the wrong environment.

Recommended behavior:

- if there is exactly one available environment, preselect it
- otherwise default to unscoped or require explicit selection

Risk:

- defaulting to a hard-coded environment such as `production` or `demo` can hide the emitted sample app entirely

### 8.3 Service Filter Carryover

The frontend should avoid persisting a stale `service_name` filter into the discovery page.

Risk:

- the user may arrive on `/services` and see no rows because an old service filter is still applied

### 8.4 Metric Name Default

The service page should select a sensible initial metric automatically from `GET /api/v1/metrics/names`.

Recommended behavior:

- select the first returned metric name
- or prefer a known service-health metric if present

Risk:

- an empty metric selection makes the page look broken even though the service is real and metrics are available

### 8.5 Step / Aggregation Defaults

The frontend should avoid defaults that over-filter or distort the first successful query.

Recommended behavior:

- omit `step` unless the UI explicitly sets it
- default `agg` to `avg` unless a specific metric panel requires another value

Risk:

- unusual defaults can cause confusing charts, especially for a first-run sample app

### 8.6 Empty States

The UI must distinguish between:

- no service discovered in the selected range
- service discovered but no metric names returned
- metric names returned but selected metric query produced no series
- request failure

If these are all rendered the same way, real data problems become hard to diagnose.

---

## 9. Minimum Visual Elements for a Usable Service Page

This milestone does not need a full Datadog clone. It does need enough structure to feel like a real service page.

### 9.1 Header

Minimum:

- service name
- environment
- last seen
- time range context

### 9.2 Summary Stats Row

Minimum:

- request rate
- error rate
- p50 latency
- p95 latency
- p99 latency

These should be derived from `GET /api/v1/services/:service_name/summary`.

### 9.3 Metrics Area

Minimum:

- metric name picker
- at least one real metric chart or series panel
- clear chart title
- visible indication of the metric `name`, `agg`, and `step`

### 9.4 Placeholder Panels

To make the page feel complete without expanding scope, the layout may include empty placeholder cards for:

- deployments
- dependencies
- additional metric panels

But only the implemented metrics panel(s) should show live data.

### 9.5 Empty and Loading States

Minimum:

- loading state for service summary
- loading state for metric names
- loading state for metric query
- explicit empty state text that references the active `environment` and time range

---

## 10. Recommended Milestone UX

Recommended end-to-end frontend flow:

1. User opens `/services`
2. User sees environment selector populated from `GET /api/v1/environments`
3. User uses default recent time range
4. User sees emitted sample app in `GET /api/v1/services`
5. User clicks the sample app row
6. User lands on `/services/:service_name`
7. Page loads:
   - summary from `GET /api/v1/services/:service_name/summary`
   - metric names from `GET /api/v1/metrics/names`
   - initial chart from `GET /api/v1/metrics/query`
8. User can switch metrics and confirm live data is present

This is the smallest frontend milestone that proves the pipeline ends in a usable service metrics page.

---

## 11. Explicit Non-Goals

Not part of this milestone:

- log explorer work
- trace explorer work
- alert rule workflows
- dashboard persistence
- broad multi-page platform navigation redesign
- custom search or discovery endpoints beyond canonical services discovery

---

## 12. Frontend Readiness Checklist

This milestone is frontend-ready when:

- `/services` can show real emitting services
- a user can select the sample app without knowing its name ahead of time
- `/services/:service_name` renders summary metrics from real backend data
- at least one metrics panel shows real `series[].points[]`
- defaults do not hide the sample app by time range or environment mismatch
- all requests use canonical contract params and fields
