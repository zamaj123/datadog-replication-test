# Frontend Design

**Agent:** Frontend
**Stage:** Phase 1 design aligned to cross-subsystem contract
**Date:** 2026-04-02
**Status:** Contract-aligned with `INTERFACES.md`

---

## 1. Objective

Define the frontend information architecture and page behavior for the observability platform using only the query and alert contracts finalized in `INTERFACES.md`.

This document covers:

- navigation and page hierarchy
- global filters and shared client state
- overview and service pages
- log and trace exploration
- exact API usage expectations for each page

This document is a frontend projection of `INTERFACES.md`. It does not redefine backend schemas, add contract fields, or introduce alternate endpoint shapes. When this document and `INTERFACES.md` differ, `INTERFACES.md` is authoritative.

---

## 2. Information Architecture

### 2.1 Top-Level Navigation

The application is a single-page app with a persistent shell.

```
/                          → redirect to /dashboard/overview
/dashboard/overview        → platform overview dashboard
/services                  → services list
/services/:service_name    → service detail
/logs                      → log explorer
/traces                    → trace explorer
/traces/:trace_id          → trace detail
/alerts                    → alerts list (Phase 4)
```

Only the routes and data dependencies documented below are in scope for the current contract.

### 2.2 App Shell

```
App Shell
├── Global Header
│   ├── environment selector
│   ├── time range selector
│   └── page title / route context
├── Left Sidebar
│   ├── Overview
│   ├── Services
│   ├── Logs
│   ├── Traces
│   └── Alerts
└── Main Content
    └── active route
```

### 2.3 Global State

The following state is shared across pages:

| State key | Type | Notes |
|---|---|---|
| `environment` | `string \| ""` | Selected environment. `""` means unscoped where allowed by the API. |
| `timeRange` | `{ start: string, end: string }` | Required ISO 8601 values. Query semantics are `[start, end)`. |
| `service_name` | `string \| ""` | Optional page-to-page scope carried into logs/traces from service pages. |

Frontend must use canonical parameter names from `INTERFACES.md`: `start`, `end`, `environment`, and `service_name`.

### 2.4 Shared UX Rules

- The environment selector is populated from `GET /api/v1/environments`.
- Time shortcuts must stay within retention windows defined in `INTERFACES.md` §9.
- Empty-state messaging must distinguish between "no data in range" and request failure.
- Paginated views use cursor-based pagination only. Offset/page-number pagination is not supported.
- Trace and monitor status values are lowercase in transport and mapped to visual badges in the UI.

---

## 3. Dashboard

### 3.1 Overview Dashboard (`/dashboard/overview`)

The overview page is a fixed dashboard built from existing query endpoints.

**Layout**

```
Row 1: [Active services] [Request rate] [Error rate]
Row 2: [P99 latency] [Log volume]
Row 3: [Services table]
```

**Cards and data sources**

| Widget | Source | Notes |
|---|---|---|
| Active services | `GET /api/v1/services` | Count rows in `services[]`. |
| Request rate | `GET /api/v1/services` | Sum `request_rate_per_sec` across visible services. |
| Error rate | `GET /api/v1/services` | Derived from `error_rate` values returned in `services[]`. |
| P99 latency | `GET /api/v1/services` | Derived from `p99_latency_ns`, converted client-side for display. |
| Log volume chart | `GET /api/v1/logs/volume` | Uses `by_severity` buckets. |
| Services table | `GET /api/v1/services` | Canonical source for service list page and dashboard table. |

The frontend must not assume a bespoke dashboard summary endpoint beyond the documented services and log-volume APIs.

---

## 4. Services

### 4.1 Services List (`/services`)

Displays all services active in the selected time range.

**Columns**

| Column | Response field |
|---|---|
| Service | `service_name` |
| Environment | `environment` |
| Last seen | `last_seen` |
| Request rate | `request_rate_per_sec` |
| Error rate | `error_rate` |
| P99 latency | `p99_latency_ns` |
| Log count | `log_count` |

**Source**

`GET /api/v1/services?start=...&end=...&environment=...`

**Behavior**

- Clicking a row navigates to `/services/:service_name`.
- Sorting behavior is frontend-owned and does not require additional API fields.
- Numeric latency display converts nanoseconds to ms.
- Error rate display converts fraction to percent.

### 4.2 Service Detail (`/services/:service_name`)

The service detail header and summary cards come from the service summary endpoint.

**Header data**

- `service_name`
- `environment`
- `last_seen`
- `active_alert_count`

**Primary source**

`GET /api/v1/services/:service_name/summary?start=...&end=...&environment=...`

### 4.3 Service Detail Tabs

#### Overview

Shows:

- stats: `request_rate_per_sec`, `error_rate`, `p50_latency_ns`, `p95_latency_ns`, `p99_latency_ns`, `log_count`, `active_alert_count`
- recent logs preview from `GET /api/v1/logs`
- recent traces preview from `GET /api/v1/traces`

Preview requests must still use canonical query parameters: `start`, `end`, `environment`, `service_name`, and endpoint-specific `limit`.

#### Metrics

Shows:

- metric picker from `GET /api/v1/metrics/names?service_name=...&environment=...`
- one or more charts backed by `GET /api/v1/metrics/query`

Frontend query rules:

- use `name` for the selected metric
- use `service_name` and `environment` as filters
- use `agg` explicitly for percentile charts (`p50`, `p95`, `p99`) where needed
- use `filter[<key>]` for exact tag filters
- consume `series[].labels` and `series[].points[]`

#### Logs

Embedded log explorer scoped with `service_name` and the shared `start`/`end`/`environment` range.

#### Traces

Embedded trace list scoped with `service_name` and the shared `start`/`end`/`environment` range.

---

## 5. Log Explorer (`/logs`)

### 5.1 Data Sources

| UI area | Endpoint |
|---|---|
| Results table | `GET /api/v1/logs` |
| Volume histogram | `GET /api/v1/logs/volume` |

### 5.2 Supported Filters

The frontend must expose only documented structured filters:

| UI filter | Query parameter |
|---|---|
| Time range | `start`, `end` |
| Environment | `environment` |
| Service | `service_name` |
| Minimum severity | `severity_min` |
| Message search | `search` |
| Exact trace match | `trace_id` |
| Page size | `limit` |
| Pagination | `cursor` |

There is no free-form backend filter DSL in the contract.

### 5.3 Table Columns

| Column | Response field |
|---|---|
| Timestamp | `timestamp` |
| Severity | `severity_text` |
| Service | `service_name` |
| Environment | `environment` |
| Host | `host` |
| Message | `message` |
| Trace ID | `trace_id` |

Expanded row content may show:

- `log_id`
- `span_id`
- `attributes`
- `severity_number`

### 5.4 Pagination and Counts

- Default result page size is driven by backend default or explicit `limit`.
- Infinite scroll or load-more must use `next_cursor`.
- If the UI needs a pure count, it uses `count_only=true` on `GET /api/v1/logs`.
- `total_matched` is an estimate and should be labeled accordingly.
- `truncated` should surface as a non-blocking warning because it indicates capped results.
- The UI must not assume offset pagination or stable page numbers.

### 5.5 Severity Display

Transport values stay canonical:

- `severity_number`: integer
- `severity_text`: uppercase display string such as `INFO`, `WARN`, `ERROR`

The UI may style badges by `severity_text`, but it must not rename the field to `level`.

---

## 6. Trace Explorer (`/traces`)

### 6.1 Data Sources

| UI area | Endpoint |
|---|---|
| Trace list | `GET /api/v1/traces` |
| Trace detail waterfall | `GET /api/v1/traces/:trace_id` |

### 6.2 Supported Filters

| UI filter | Query parameter |
|---|---|
| Time range | `start`, `end` |
| Environment | `environment` |
| Root service | `service_name` |
| Status | `status` |
| Minimum duration | `min_duration_ms` |
| Exact trace ID | `trace_id` |
| Page size | `limit` |
| Pagination | `cursor` |

`status` values are lowercase and limited to `ok` and `error` on the trace list endpoint.

### 6.3 Trace List Columns

| Column | Response field |
|---|---|
| Trace ID | `trace_id` |
| Root service | `root_service_name` |
| Root name | `root_name` |
| Duration | `duration_ns` |
| Spans | `span_count` |
| Status | `status` |
| Start time | `start_time` |
| Environment | `environment` |

The frontend converts `duration_ns` to ms for display.

### 6.4 Trace Detail Page (`/traces/:trace_id`)

Header fields:

- `trace_id`
- `root_service_name`
- `root_name`
- `start_time`
- `duration_ns`
- `status`
- `environment`

Waterfall row fields:

- `span_id`
- `parent_span_id`
- `service_name`
- `name`
- `kind`
- `start_time`
- `end_time`
- `duration_ns`
- `status`
- `status_message`
- `attributes`

Frontend tree-building rules:

- spans are already returned in ascending `start_time`
- root span uses `parent_span_id: null` in the trace-detail response
- error highlighting keys off `status == "error"`
- duration and offsets are computed from ISO timestamps and `duration_ns`
- the request to `GET /api/v1/traces/:trace_id` takes no query parameters

---

## 7. API Contract Usage Matrix

### 7.1 Query Endpoints Consumed by Frontend

| Endpoint | Used by |
|---|---|
| `GET /api/v1/environments` | global environment selector |
| `GET /api/v1/services` | overview dashboard, services list |
| `GET /api/v1/services/:service_name/summary` | service detail header and stats |
| `GET /api/v1/metrics/names` | service metrics picker |
| `GET /api/v1/metrics/query` | overview/service metric charts |
| `GET /api/v1/logs` | log explorer, service log preview |
| `GET /api/v1/logs/volume` | overview log volume, log explorer histogram |
| `GET /api/v1/traces` | trace explorer, service trace preview |
| `GET /api/v1/traces/:trace_id` | trace detail page |
| `GET /api/v1/alerts/monitors` | alerts page in Phase 4 |

### 7.2 Required Parameter Conventions

- Time range params are always `start` and `end`.
- Service filter param is always `service_name`.
- Environment filter param is always `environment`.
- Pagination uses `cursor` in the request and `next_cursor` in the response.
- All timestamps in responses are ISO 8601 strings.
- Query API auth uses `X-Api-Key: <key>` as defined in `INTERFACES.md`.

### 7.3 Canonical Response Fields Used in the UI

Frontend-owned display models must preserve these canonical field names at the API boundary:

- `service_name`
- `environment`
- `host`
- `timestamp`
- `severity_number`
- `severity_text`
- `log_id`
- `trace_id`
- `span_id`
- `parent_span_id`
- `status`
- `root_service_name`
- `duration_ns`
- `request_rate_per_sec`
- `error_rate`
- `p50_latency_ns`
- `p95_latency_ns`
- `p99_latency_ns`
- `last_seen`
- `log_count`
- `active_alert_count`
- `root_name`
- `span_count`
- `series`
- `labels`
- `points`
- `next_cursor`
- `truncated`

If the UI wants alternate labels such as "P99 latency (ms)" or "Severity", that is a presentation concern only.

---

## 8. Frontend Validation Rules

- Do not generate requests with `from`, `to`, `env`, `service`, `root_service`, `level`, or `duration_ms` as API field names.
- Do not assume uppercase trace status values in requests or responses.
- Do not assume `parent_span_id == ""` on trace detail responses; the contract uses `null` there.
- Do not assume log rows can be keyed by timestamp alone; use `log_id`.
- Do not invent dashboard, service, log, trace, metric, or alert response fields beyond those listed in `INTERFACES.md`.
- Treat `truncated` as meaningful response metadata and surface it in the UI.

---

## 9. Delivery Status

Resolved by `INTERFACES.md` and adopted here:

- time range params are `start` and `end`
- environments are listed by `GET /api/v1/environments`
- service summaries are provided by `GET /api/v1/services` and `GET /api/v1/services/:service_name/summary`
- metric names come from `GET /api/v1/metrics/names`
- logs use `severity_text` and `log_id`
- traces use lowercase `status` and `duration_ns`
- pagination is cursor-based

Remaining frontend work is implementation against these contracts once application code is present in the repo.
