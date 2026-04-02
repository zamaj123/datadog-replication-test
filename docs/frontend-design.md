# Frontend Design

**Agent:** Frontend  
**Stage:** Phase 1 — Shared Parallel Design  
**Date:** 2026-04-02  
**Status:** Draft — pending cross-agent API contract review

---

## 1. Objective

Define the complete frontend information architecture for the observability platform. This document covers:

- Page hierarchy and navigation
- Global UX primitives
- Dashboard structure and widget types
- Service detail view
- Log Explorer
- Trace Explorer
- Exact backend API requirements (endpoints, parameters, response shapes)
- Shared identity field contracts

This document does not define backend implementation. It defines what the frontend requires from the backend.

---

## 2. Information Architecture

### 2.1 Top-Level Navigation

The application is a single-page app with a persistent left sidebar. Top-level sections:

```
/                          → redirect to /dashboard/overview
/dashboard/overview        → Platform Overview Dashboard
/dashboard/:id             → Custom / named dashboard
/services                  → Services list
/services/:service         → Service Detail (tabs: Overview, Metrics, Logs, Traces)
/logs                      → Log Explorer
/traces                    → Trace Explorer
/traces/:trace_id          → Trace Detail (full waterfall)
/alerts                    → Alert rules (deferred — Phase 4)
```

### 2.2 Page Hierarchy

```
App Shell
├── Global Header
│   ├── Environment selector (env filter, global scope)
│   ├── Time range selector (global, affects all data queries)
│   └── Search bar (global — routes to logs or traces depending on input)
├── Left Sidebar
│   ├── Overview Dashboard
│   ├── Services
│   ├── Log Explorer
│   ├── Trace Explorer
│   └── Alerts (deferred)
└── Main Content Area
    └── (page-specific content)
```

### 2.3 Global State

The following are globally scoped and persist across navigation:

| State key       | Type            | Description                                  |
|-----------------|-----------------|----------------------------------------------|
| `env`           | string          | Active environment filter (e.g. `production`) |
| `timeRange`     | `{ from, to }`  | Active time window, ISO 8601 strings         |
| `selectedService` | string \| null | Active service filter (optional, global)    |

Time range shortcuts: Last 15m, 30m, 1h, 3h, 6h, 12h, 24h, 7d, custom.

---

## 3. Dashboard

### 3.1 Overview Dashboard (`/dashboard/overview`)

A fixed system dashboard. Not user-editable in Phase 3. Provides a platform-wide health summary.

**Layout (grid, 12 columns):**

```
Row 1: [Services Health (4)] [Request Rate — all services (4)] [Error Rate — all services (4)]
Row 2: [P99 Latency — all services (6)]  [Throughput — all services (6)]
Row 3: [Log Volume by Level (6)]  [Active Traces (span count over time) (6)]
Row 4: [Services Table — sortable by error rate, latency, req rate (12)]
```

**Widget types required for Phase 3:**

| Widget type         | Description                                     |
|---------------------|-------------------------------------------------|
| `timeseries`        | Line chart over time range, one or more series  |
| `stat`              | Single numeric value with optional trend arrow  |
| `services_table`    | Tabular list of services with key metrics       |
| `log_volume_bar`    | Bar chart of log counts grouped by level        |

### 3.2 Custom Dashboards (`/dashboard/:id`)

Deferred to Phase 3 advanced scope. The backend must support named dashboard persistence. Frontend will need `GET/POST/PUT /api/v1/dashboards` once that work begins. Not designed in detail here.

---

## 4. Service Detail View (`/services/:service`)

### 4.1 Service List Page (`/services`)

A table of all services observed within the current `env` and `timeRange`.

**Columns:** Service name | Environment | Last seen | Request rate (req/s) | Error rate (%) | P99 latency (ms) | Log count

**Interactions:**
- Click row → navigate to `/services/:service`
- Sort by any column
- Filter by env (uses global env selector)

### 4.2 Service Detail Page (`/services/:service`)

Header: service name, environment badge, last-seen timestamp.

**Tabs:**

#### Tab: Overview
- Stat row: Req/s, Error %, P99 latency, P50 latency
- Time series: Request rate + error rate overlaid
- Time series: Latency (P50, P95, P99)
- Recent log entries (last 20, link to Log Explorer filtered to this service)
- Recent traces (last 10, link to Trace Explorer filtered to this service)

#### Tab: Metrics
- Filterable list of metric names for this service
- Select metric → renders full time-series chart
- Supports multiple metrics overlaid on one chart

#### Tab: Logs
- Embedded log view scoped to this service (same UI as Log Explorer, pre-filtered)
- Time range inherits global selector

#### Tab: Traces
- Embedded trace list scoped to this service (same UI as Trace Explorer, pre-filtered)
- Time range inherits global selector

---

## 5. Log Explorer (`/logs`)

### 5.1 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Filter panel (left, collapsible, ~280px)                             │
│  - Service (multi-select)                                            │
│  - Level (DEBUG, INFO, WARN, ERROR — checkbox)                       │
│  - Host (multi-select)                                               │
│  - Free text search (message field)                                  │
│  - Key/value attribute filters (add arbitrary key=value pairs)       │
│                                                                      │
│ Results area (right)                                                 │
│  - Log volume histogram (bar chart over time — click to zoom)        │
│  - Log table (timestamp, level, service, host, message — truncated)  │
│    - Click row → slide-in drawer (full log detail)                   │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 Log Table Columns

| Column      | Field          | Notes                              |
|-------------|----------------|------------------------------------|
| Timestamp   | `timestamp`    | Formatted per user locale          |
| Level       | `level`        | Colored badge (DEBUG/INFO/WARN/ERROR) |
| Service     | `service`      | Clickable → service detail         |
| Host        | `host`         |                                    |
| Message     | `message`      | Truncated to ~120 chars            |
| Trace ID    | `trace_id`     | If present — link to trace detail  |

### 5.3 Log Detail Drawer

Opens on row click. Shows:
- All fields from the log entry
- Full message (untruncated)
- If `trace_id` present: button to "View Trace" → `/traces/:trace_id`
- Structured attributes rendered as key/value table
- "Filter to this service" / "Filter to this host" quick actions

### 5.4 Pagination and Loading

- Default page size: 100 rows
- Load-more pattern (not classic pagination) — append next 100 rows
- Results sorted by `timestamp` descending by default

---

## 6. Trace Explorer (`/traces`)

### 6.1 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Filter panel (left, collapsible, ~280px)                             │
│  - Service (root service of trace — multi-select)                    │
│  - Status (OK / ERROR)                                               │
│  - Min/max duration (ms)                                             │
│  - Trace ID exact match                                              │
│  - Attribute key/value filters                                       │
│                                                                      │
│ Results area (right)                                                 │
│  - Latency scatter plot (x=time, y=duration, color=status)           │
│  - Trace list table                                                  │
│    - Click row → navigate to /traces/:trace_id                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.2 Trace List Table Columns

| Column        | Field            | Notes                                   |
|---------------|------------------|-----------------------------------------|
| Trace ID      | `trace_id`       | Truncated, clickable                    |
| Root Service  | `root_service`   | Service that initiated the trace        |
| Root Name     | `root_name`      | Operation/span name at root             |
| Duration      | `duration_ms`    | Total trace duration                    |
| Spans         | `span_count`     | Number of spans in trace                |
| Status        | `status`         | OK / ERROR badge                        |
| Timestamp     | `start_time`     | When trace started                      |

### 6.3 Trace Detail Page (`/traces/:trace_id`)

Full-page view. Layout:

```
Header: Trace ID | Root service | Duration | Status | Start time

Timeline (waterfall):
  ┌─────────────────────────────────────────────────────┐
  │ Span name           Service    Duration   [bar]      │
  │   └─ child span     service2   12ms       [--bar]    │
  │       └─ ...                                         │
  └─────────────────────────────────────────────────────┘

Click span → Span Detail panel (right):
  - span_id, parent_span_id, service, operation name
  - start_time, end_time, duration_ms
  - status, status_message
  - attributes (key/value)
  - Link to logs with matching trace_id
```

**Waterfall rendering requirements:**
- Spans positioned by `start_time` offset from trace start
- Width proportional to `duration_ms`
- Color-coded by `service` (consistent palette per service name)
- ERROR spans highlighted in red
- Collapsed by default beyond depth 3; expand on click

---

## 7. Backend API Requirements

These are the API endpoints the frontend requires. The backend/storage agent must implement these contracts. All paths are under `/api/v1`.

### 7.1 Shared Conventions

- All query endpoints accept `from` and `to` as ISO 8601 query params (required).
- `env` is an optional filter on all endpoints.
- All responses are JSON.
- All timestamps in responses are ISO 8601 strings.
- Errors: `{ "error": "<message>", "code": "<string>" }` with appropriate HTTP status.

### 7.2 Services

#### `GET /api/v1/services`

Returns the list of known services with summary metrics for the current time range.

**Query params:**

| Param  | Type   | Required | Description                  |
|--------|--------|----------|------------------------------|
| `from` | string | yes      | Start of time range (ISO 8601) |
| `to`   | string | yes      | End of time range (ISO 8601)  |
| `env`  | string | no       | Filter by environment         |

**Response:**

```json
{
  "services": [
    {
      "service": "api-server",
      "env": "production",
      "last_seen": "2026-04-02T10:00:00Z",
      "request_rate": 142.3,
      "error_rate": 0.02,
      "p99_latency_ms": 312,
      "log_count": 48201
    }
  ]
}
```

### 7.3 Metrics

#### `GET /api/v1/metrics`

Returns available metric names for a service (used for the Metrics tab selector).

**Query params:**

| Param     | Type   | Required | Description             |
|-----------|--------|----------|-------------------------|
| `service` | string | no       | Filter metrics by service |
| `env`     | string | no       | Filter by environment   |

**Response:**

```json
{
  "metrics": ["http.request.duration", "http.request.count", "process.cpu.usage"]
}
```

#### `GET /api/v1/metrics/query`

Returns time-series data for one metric.

**Query params:**

| Param      | Type   | Required | Description                                |
|------------|--------|----------|--------------------------------------------|
| `metric`   | string | yes      | Metric name                                |
| `from`     | string | yes      | Start of time range (ISO 8601)             |
| `to`       | string | yes      | End of time range (ISO 8601)               |
| `service`  | string | no       | Filter to service                          |
| `env`      | string | no       | Filter by environment                      |
| `host`     | string | no       | Filter by host                             |
| `interval` | string | no       | Rollup interval: `1m`, `5m`, `1h`, etc.    |
| `agg`      | string | no       | Aggregation: `avg`, `sum`, `max`, `min`, `p99`, `p95`, `p50` |

**Response:**

```json
{
  "metric": "http.request.duration",
  "interval": "1m",
  "agg": "p99",
  "series": [
    {
      "labels": { "service": "api-server", "env": "production" },
      "points": [
        { "timestamp": "2026-04-02T09:00:00Z", "value": 287.4 },
        { "timestamp": "2026-04-02T09:01:00Z", "value": 301.1 }
      ]
    }
  ]
}
```

### 7.4 Logs

#### `GET /api/v1/logs/query`

Returns log entries matching filters.

**Query params:**

| Param      | Type   | Required | Description                                  |
|------------|--------|----------|----------------------------------------------|
| `from`     | string | yes      | Start of time range (ISO 8601)               |
| `to`       | string | yes      | End of time range (ISO 8601)                 |
| `service`  | string | no       | Filter to service (repeatable for multi)     |
| `level`    | string | no       | Filter by level: `DEBUG`, `INFO`, `WARN`, `ERROR` (repeatable) |
| `host`     | string | no       | Filter by host                               |
| `env`      | string | no       | Filter by environment                        |
| `q`        | string | no       | Free-text search against `message` field     |
| `trace_id` | string | no       | Filter to specific trace                     |
| `limit`    | int    | no       | Max results (default 100, max 500)           |
| `cursor`   | string | no       | Pagination cursor from prior response        |

**Response:**

```json
{
  "logs": [
    {
      "log_id": "abc123",
      "timestamp": "2026-04-02T09:05:13.412Z",
      "level": "ERROR",
      "service": "api-server",
      "host": "host-1",
      "env": "production",
      "message": "Failed to connect to database",
      "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
      "span_id": "00f067aa0ba902b7",
      "attributes": {
        "db.system": "postgresql",
        "error.type": "ConnectionError"
      }
    }
  ],
  "next_cursor": "eyJ0cyI6IjIwMjYtMDQtMDJUMDk6MDU6MTMuNDEyWiJ9",
  "total_matched": 1204
}
```

#### `GET /api/v1/logs/volume`

Returns log counts bucketed by time interval, used for the histogram in Log Explorer.

**Query params:** same as `/logs/query` (minus `limit`, `cursor`), plus:

| Param      | Type   | Required | Description                       |
|------------|--------|----------|-----------------------------------|
| `interval` | string | no       | Bucket size: `1m`, `5m`, `1h`    |

**Response:**

```json
{
  "interval": "5m",
  "buckets": [
    { "timestamp": "2026-04-02T09:00:00Z", "count": 412, "by_level": { "INFO": 380, "ERROR": 32 } },
    { "timestamp": "2026-04-02T09:05:00Z", "count": 398, "by_level": { "INFO": 391, "ERROR": 7 } }
  ]
}
```

### 7.5 Traces

#### `GET /api/v1/traces/query`

Returns trace summaries matching filters.

**Query params:**

| Param          | Type   | Required | Description                                  |
|----------------|--------|----------|----------------------------------------------|
| `from`         | string | yes      | Start of time range (ISO 8601)               |
| `to`           | string | yes      | End of time range (ISO 8601)                 |
| `service`      | string | no       | Filter by root service                       |
| `env`          | string | no       | Filter by environment                        |
| `status`       | string | no       | `OK` or `ERROR`                              |
| `min_duration` | int    | no       | Minimum trace duration in ms                 |
| `max_duration` | int    | no       | Maximum trace duration in ms                 |
| `trace_id`     | string | no       | Exact trace ID match                         |
| `limit`        | int    | no       | Max results (default 50, max 200)            |
| `cursor`       | string | no       | Pagination cursor                            |

**Response:**

```json
{
  "traces": [
    {
      "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
      "root_service": "api-server",
      "root_name": "POST /api/orders",
      "start_time": "2026-04-02T09:05:10.100Z",
      "duration_ms": 423,
      "span_count": 8,
      "status": "ERROR",
      "env": "production"
    }
  ],
  "next_cursor": "eyJ0cyI6IjIwMjYtMDQtMDJUMDk6MDU6MTAuMTAwWiJ9"
}
```

#### `GET /api/v1/traces/:trace_id`

Returns the full trace with all spans.

**Path params:** `trace_id`

**Response:**

```json
{
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "root_service": "api-server",
  "root_name": "POST /api/orders",
  "start_time": "2026-04-02T09:05:10.100Z",
  "duration_ms": 423,
  "status": "ERROR",
  "env": "production",
  "spans": [
    {
      "span_id": "00f067aa0ba902b7",
      "parent_span_id": null,
      "service": "api-server",
      "name": "POST /api/orders",
      "start_time": "2026-04-02T09:05:10.100Z",
      "end_time": "2026-04-02T09:05:10.523Z",
      "duration_ms": 423,
      "status": "ERROR",
      "status_message": "Internal Server Error",
      "attributes": {
        "http.method": "POST",
        "http.route": "/api/orders",
        "http.status_code": 500
      }
    },
    {
      "span_id": "a2fb4a1d1a96d312",
      "parent_span_id": "00f067aa0ba902b7",
      "service": "order-db",
      "name": "db.query",
      "start_time": "2026-04-02T09:05:10.200Z",
      "end_time": "2026-04-02T09:05:10.480Z",
      "duration_ms": 280,
      "status": "ERROR",
      "status_message": "Query timeout",
      "attributes": {
        "db.system": "postgresql",
        "db.operation": "INSERT"
      }
    }
  ]
}
```

### 7.6 Log–Trace Correlation Convenience Endpoint

The frontend requires a way to link from a trace span to related logs without a full log query. This endpoint allows the trace detail view to fetch logs matching a `trace_id` efficiently.

This is satisfied by `GET /api/v1/logs/query?trace_id=<id>&limit=50` — no additional endpoint needed.

---

## 8. Shared Identity Field Contracts

These field names must be consistent across all signal types (metrics, logs, traces). The frontend relies on them for filtering and cross-signal linking.

| Field       | Type   | Present in           | Description                                       |
|-------------|--------|----------------------|---------------------------------------------------|
| `service`   | string | metrics, logs, traces | Service name (e.g. `api-server`)                 |
| `env`       | string | metrics, logs, traces | Deployment environment (e.g. `production`)       |
| `host`      | string | logs, metrics         | Hostname of the emitting process                 |
| `timestamp` | string | metrics, logs, traces | ISO 8601 event time                              |
| `trace_id`  | string | logs, traces          | W3C trace context trace ID (32 hex chars)        |
| `span_id`   | string | logs, traces          | W3C trace context span ID (16 hex chars)         |
| `level`     | string | logs                  | `DEBUG`, `INFO`, `WARN`, `ERROR`                 |
| `status`    | string | traces                | `OK` or `ERROR`                                  |

---

## 9. Open Questions for Other Agents

These are unresolved items the frontend design depends on. Each requires a documented answer from the relevant agent before Phase 3 implementation begins.

| # | Question | Blocking | Owner |
|---|----------|----------|-------|
| 1 | What is the max supported `from`/`to` query window for logs and traces before the API requires further narrowing or pagination? | Log Explorer UX | Storage/API agent |
| 2 | Will metric rollup intervals be computed server-side, or does the frontend specify the exact `interval` and the backend rejects unsupported values? Needs an enum of valid intervals. | Dashboard timeseries widget | Storage/API agent |
| 3 | Is there a supported list of `env` values returned from an endpoint, or does the frontend derive them from service responses? | Global env selector | API agent |
| 4 | What is the consistent field name convention for structured log attributes: flat (`attributes.db.system`) vs. nested JSON object? | Log detail drawer | Ingestion/Storage agent |
| 5 | Will trace `status` be limited to `OK`/`ERROR`, or will OpenTelemetry's `UNSET` also be present? | Trace status filter | Ingestion agent |
| 6 | Is cursor-based pagination the confirmed pagination model, or will offset/keyset be used? | Log Explorer load-more | API agent |
| 7 | Will a `GET /api/v1/services` endpoint be implemented, or should the frontend derive service lists from log/trace/metric responses? | Services page | API agent |

---

## 10. Validation Checklist

- [x] All deliverables from `tasks/frontend.md` are addressed (information architecture, dashboard, service detail, log explorer, trace explorer, API requirements)
- [x] Every API endpoint specifies: method, path, query params, response shape, and consuming view
- [x] No backend implementation details assumed (storage engine, ingestion internals)
- [x] All field names used in UI descriptions match field names in Section 8 (identity contracts)
- [x] Dashboard, service detail, log explorer, and trace explorer are self-consistent (same field names, same filter mechanics)
- [x] Open questions are explicitly listed rather than resolved by assumption
