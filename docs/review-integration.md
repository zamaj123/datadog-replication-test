# Integration Review — Cross-Subsystem Conflict Analysis

**Author:** Reviewer Agent
**Date:** 2026-04-02
**Branch:** subsystem/review (merged from integration)
**Documents reviewed:**
- `docs/ingestion-design.md`
- `docs/storage-design.md`
- `docs/frontend-design.md`
- `docs/alerts-design.md`
- `PRODUCT.md`, `ARCHITECTURE.md`

---

## Executive Summary

All four subsystem designs are coherent within their own boundaries. The cross-subsystem integration picture is not. There are **20 concrete conflicts** that will cause runtime failures if not resolved before implementation begins. The most severe are:

1. Ingestion timestamps are milliseconds; storage requires nanoseconds — every span ordering calculation breaks.
2. Ingestion uses OTel dotted resource attributes (`service.name`); storage uses flat columns (`service`) — identity-based correlation silently returns no results.
3. Frontend uses `from`/`to` query params; storage uses `start`/`end` — every frontend query fails at the HTTP layer.
4. Storage has no `group_by` on metric queries; alerts requires it for multi-dimensional evaluation — multi-service alerting is unimplementable.
5. Ingestion's write path to storage is architecturally undefined — one agent expects a write API, the other expects direct ClickHouse writes.

---

## 1. Conflicts: Ingestion vs. Storage

### Conflict 1 — Timestamp unit mismatch

**Ingestion** (`§6`): "All timestamps are Unix milliseconds (int64)."
**Storage** (`§5.10, constraint 1`): "Timestamps must be nanosecond-precision UTC. Sub-millisecond precision is required for trace span ordering."

Impact: ingestion writes `1711234567890` (ms); ClickHouse `DateTime64(9)` interprets this as a time in January 1970. Every event is stored with a garbage timestamp. Queries by time range return no data. Trace span ordering is impossible. This is a total integration failure, not a minor discrepancy.

**Resolution required:** pick one unit for the wire format between ingestion and storage. Proposed: nanoseconds throughout. Ingestion must convert incoming milliseconds from SDKs before forwarding.

---

### Conflict 2 — Identity field names: OTel resource attributes vs. flat columns

**Ingestion** defines a `resource` block with dotted OTel attribute names:
```json
{ "resource": { "service.name": "api-server", "deployment.environment": "production", "host.name": "worker-1" } }
```

**Storage** defines flat top-level columns: `service`, `env`, `host`, `version`.

**Frontend** and **Alerts** both expect flat names (`service`, `env`, `host`) in query responses and filters.

Impact: ingestion forwards `service.name`; storage has no column for `service.name`; the `service` column is never populated; all cross-signal correlation, all service-scoped queries, all alert group-by operations return empty results with no error.

There is no documented normalization step that performs this mapping. Ingestion's identity normalizer (`§7`) says it validates `resource.service.name` but does not say it renames the field.

**Resolution required:** normalization to flat field names must be explicitly owned. Proposed: the ingestion identity normalizer maps OTel resource attributes to canonical flat names before forwarding. The mapping must be documented as a contract.

---

### Conflict 3 — Write architecture: write API vs. direct ClickHouse

**Ingestion** (`§4, §8`): "The storage agent will expose a write API (details TBD). Ingestion does not write to storage directly." Open question S1: "What write API does storage expose? (HTTP REST, gRPC, direct DB?)"

**Storage** (`§5.10`): "Ingestion must write to ClickHouse in the formats described above." Open issue 3: "HTTP bulk insert vs. ClickHouse native protocol."

These are contradictory architectural positions. Ingestion expects storage to expose an application-layer write API. Storage assumes ingestion speaks ClickHouse's HTTP/native protocol directly. If ingestion implements an HTTP client calling a storage service endpoint, and storage never builds that endpoint (only exposes ClickHouse), they will never connect.

**Resolution required:** decide which architecture before either agent writes a line of implementation code. Two valid options:
- Option A: ingestion writes to ClickHouse directly via ClickHouse HTTP (`INSERT INTO ... FORMAT JSONEachRow`). No storage write service needed. Ingestion must know ClickHouse connection details.
- Option B: storage exposes a write API (HTTP POST) that ingestion calls. Storage owns the ClickHouse write logic. Ingestion has no direct ClickHouse dependency.

Option A is simpler and lower-latency. Option B provides a cleaner abstraction boundary. Choose one. Document it in INTERFACES.md.

---

### Conflict 4 — Histogram storage format

**Ingestion** (`§6.1`): "For `histogram` and `summary`, the client sends pre-aggregated buckets as a JSON object in `value` (shape TBD with storage agent)."

**Storage** (`§5.3`): "Histogram/summary raw data: store pre-bucketed values as separate rows with a `le` label key (Prometheus convention)."

These are two different representations. Ingestion assumes one JSON object per histogram event. Storage expects N rows per histogram (one per bucket boundary), each a normal metric row with an `le` tag. The transformation from one to the other is non-trivial and is owned by nobody. Storage open issue #2 acknowledges this but leaves it unresolved.

**Resolution required:** the histogram wire format (what ingestion sends to storage) must be agreed before Phase 2. Proposed: ingestion receives a bucket list from the SDK and explodes it into per-bucket rows before writing, using the `le` label convention storage expects. The ingestion-to-storage contract specifies the exploded row format.

---

### Conflict 5 — Span field naming: `name` vs. `operation`

**Ingestion** span payload (`§6.3`): span name is in the `name` field: `"name": "GET /api/users/:id"`.

**Storage** spans table (`§5.5`): the column is `operation`.

**Frontend** trace detail response (`§7.5`): the field is `name` in the span object.

The rename `name → operation` is not documented anywhere. If ingestion writes a `name` key and storage has an `operation` column, the column is never populated and trace waterfalls display blank operation names.

**Resolution required:** canonical field name is `name` at the API surface. Storage may use `operation` as a column name internally but must expose it as `name` in query responses.

---

### Conflict 6 — Span duration unit: `duration_ms` vs. `duration_ns`

**Ingestion** (`§6.3`): `"duration_ms": 190` — milliseconds.

**Storage** spans table (`§5.5`): `duration_ns UInt64` — nanoseconds. Storage constraint #1 requires sub-millisecond precision.

These conflict directly. Ingestion either needs to convert to nanoseconds before writing, or storage needs to define its acceptable input unit. No conversion is documented.

**Resolution required:** duration is nanoseconds at the ingestion-to-storage boundary. Ingestion converts `duration_ms` from SDK payloads to `duration_ns` before forwarding.

---

### Conflict 7 — Log field naming: `body` vs. `message`

**Ingestion** log payload (`§6.2`): the log text field is `body`.

**Storage** logs table (`§5.4`): the column is `message`.

**Frontend** log response (`§7.4`): the field is `message`.

Mapping `body → message` is not documented.

**Resolution required:** canonical field name is `message`. Ingestion renames `body` to `message` during normalization.

---

### Conflict 8 — Log severity: string passthrough vs. integer enum

**Ingestion** (`§6.2`): severity is a string: `"TRACE | DEBUG | INFO | WARN | ERROR | FATAL"`. Ingestion normalizes to OTel severity levels but does not specify whether it converts to an integer.

**Storage** (`§5.4`): severity is `Enum8('trace'=1, 'debug'=2, 'info'=3, 'warn'=4, 'error'=5, 'fatal'=6)` — an integer enum.

**Frontend** (`§8`): severity/level is `"DEBUG", "INFO", "WARN", "ERROR"` — a string.

Ingestion forwards a string; storage expects an integer. Unless the forwarder converts, storage will fail to insert the enum value.

**Resolution required:** ingestion converts severity strings to integer enum values before forwarding to storage. Storage returns both the integer and the string label in query responses. Frontend uses the string.

---

### Conflict 9 — `trace_index` population: assigned to ingestion, unknown to ingestion

**Storage** (`§5.10, constraint 5`): "Ingestion is responsible for detecting root spans and upserting `trace_index` via ReplacingMergeTree semantics."

**Ingestion design**: no mention of `trace_index` anywhere. The storage forwarder sends spans to a write endpoint; there is no logic for detecting root spans or populating a secondary table.

This is not a naming conflict — storage has assigned a specific operational responsibility to ingestion that ingestion has not agreed to or designed for.

**Resolution required:** either ingestion explicitly accepts this responsibility and adds root-span detection logic, or `trace_index` is populated by a ClickHouse materialized view on the `spans` table (eliminating the dependency on ingestion). The materialized view approach is lower-risk. Storage should own this decision.

---

## 2. Conflicts: Storage vs. Frontend

### Conflict 10 — Query time parameter names: `start`/`end` vs. `from`/`to`

**Storage** query API (`§5.9`): all endpoints use `start` and `end` as time range params.

**Frontend** API requirements (`§7.1`): "All query endpoints accept `from` and `to` as ISO 8601 query params (required)."

This is a total mismatch. Every query the frontend issues will omit `start` and `end`. Storage returns HTTP 400 (it enforces mandatory time params). Every page of the UI that queries time-series data returns an error or empty result. Nothing works.

**Resolution required:** one canonical name. Proposed: `start` and `end` (storage and alerts already agree on this). Frontend must align.

---

### Conflict 11 — Trace list endpoint path: `/traces/list` vs. `/traces/query`

**Storage** (`§5.9`): `GET /api/v1/traces/list`

**Frontend** (`§7.5`): `GET /api/v1/traces/query`

The path does not match. Frontend will receive 404.

**Resolution required:** canonical path is `/api/v1/traces` with a query string. Eliminates both the `/list` and `/query` ambiguity.

---

### Conflict 12 — Metric series response structure

**Storage** metric query response (`§5.9`):
```json
{
  "metric": "http.request.duration_ms",
  "series": [
    { "timestamp": "2024-01-01T00:00:00Z", "value": 42.3 }
  ]
}
```
One flat array of `{timestamp, value}` pairs. No per-series label grouping.

**Frontend** metric query expectation (`§7.3`):
```json
{
  "series": [
    {
      "labels": { "service": "api-server", "env": "production" },
      "points": [{ "timestamp": "...", "value": 287.4 }]
    }
  ]
}
```
Array of series, each with a `labels` object and a nested `points` array.

These are structurally incompatible. A frontend chart expecting `series[i].labels` and `series[i].points` against storage's flat format will crash on the first property access. Multi-series charts (multiple services overlaid) are impossible with storage's flat format.

**Resolution required:** storage must return the grouped format. When no `group_by` is specified, `labels` contains only the filter dimensions. This is also required for alerts (see Conflict 17).

---

### Conflict 13 — `/api/v1/services` endpoint: metadata only vs. metrics-enriched

**Storage** (`§5.9`): `GET /api/v1/services` returns:
```json
{ "services": [{ "name": "api-server", "env": "production", "language": "nodejs" }] }
```
Metadata from PostgreSQL only. No metrics.

**Frontend** (`§7.2`): `GET /api/v1/services` requires:
```json
{
  "services": [{
    "service": "api-server",
    "env": "production",
    "last_seen": "...",
    "request_rate": 142.3,
    "error_rate": 0.02,
    "p99_latency_ms": 312,
    "log_count": 48201
  }]
}
```
Five derived metric aggregates per service, computed over the current time range.

These are the same endpoint path returning fundamentally different payloads. Frontend can't render the services list from storage's response. The service-level aggregates (`request_rate`, `error_rate`, `p99_latency_ms`, `log_count`) require cross-signal queries that storage has not designed.

This is the most complex missing endpoint in the API surface. It requires: (1) a metric query for request rate and latency, (2) a metric or log query for error rate, (3) a log count query — all scoped to the `from`/`to` time range, all joined by service name.

**Resolution required:** storage must design a dedicated service-summary computation path. This endpoint cannot be a simple metadata lookup. Frontend and storage must agree on the response schema and the time range params before storage designs this endpoint.

---

### Conflict 14 — Missing `GET /api/v1/logs/volume` endpoint

**Frontend** (`§7.4`): requires `GET /api/v1/logs/volume` for the log histogram (counts bucketed by time interval, broken down by level).

**Storage**: this endpoint is not defined anywhere in the storage design.

The log volume histogram in the Log Explorer has no data source.

**Resolution required:** storage must add this endpoint. The response shape frontend specifies (`buckets[].by_level`) is reasonable and should be adopted as the contract.

---

### Conflict 15 — Missing `log_id` field

**Frontend** (`§7.4`): expects a `log_id` field on every log entry for row keying.

**Storage** logs table: no stable unique ID column. ClickHouse's `MergeTree` has no auto-generated row ID. The logs table has no primary key that produces a queryable row identifier.

**Resolution required:** either storage adds a UUID column populated at ingest time, or ingestion generates and forwards a log ID as part of normalization. Without it, the frontend log table has no stable row key, causing React re-render bugs and making the "click to expand row" interaction stateful in an unreliable way.

---

### Conflict 16 — Log severity field name in query response: `severity` vs. `level`

**Storage** log query response (`§5.9`): field is `severity` (the enum string).

**Frontend** log table (`§5.2`): the field is `level`. Frontend renders colored badges keyed on `level`.

**Frontend** identity contract (`§8`): the field is `level`.

Storage returns `severity`; frontend looks for `level`; the severity badge column is always blank.

**Resolution required:** canonical name in query responses is `severity_text` for the string form. Frontend maps `severity_text` to its display logic. Alternatively, storage aliases the field to `level` in responses — but this conflicts with storage's own schema naming. Pick one and document it.

---

### Conflict 17 — Trace status case: lowercase vs. uppercase

**Storage** trace list response (`§5.9`): `"status_code": "error"` (lowercase).

**Frontend** trace list table (`§6.2`): expects `"status": "ERROR"` (uppercase). Frontend filter param: `status=OK` or `status=ERROR`.

**Storage** trace list filter param: `status=ok` or `status=error` (lowercase).

The case mismatch affects both the response parsing and the filter parameter. Frontend will never match a filter or render a status badge correctly.

**Resolution required:** lowercase throughout: `ok`, `error`, `unset`. Frontend must align its filter params and badge rendering.

---

## 3. Conflicts: Alerts vs. Storage/Query

### Conflict 18 — Metric series response structure (same as Conflict 12, but from alerts' side)

**Alerts** `MetricQueryResponse` (`§8.1`):
```typescript
interface MetricSeries {
  labels: Record<string, string>;
  points: Array<{ t: string; v: number }>;
}
```
Expects `labels` per series and short-form `t`/`v` fields on each point.

**Storage** metric response: flat `{ timestamp, value }` with no per-series label grouping.

The field names differ (`t` vs. `timestamp`, `v` vs. `value`) and the structure differs (nested vs. flat). Alerts' evaluator will fail to read any metric data from storage.

**Resolution required:** canonical point format is `{ "timestamp": string, "value": number }`. Alerts must align its internal types. Storage must return the series-with-labels structure (same fix as Conflict 12).

---

### Conflict 19 — `group_by` absent from both query API and alerts query type

**Alerts** `EvaluationConfig` (`§4.2`): supports `group_by?: string[]` — fire independently per tag value combination.

**Alerts** `MetricQuery` (`§8.1`): has `filters: Record<string,string>` but no `group_by` field. Group-by is defined on the evaluation config but not passed through to the query.

**Storage** metric query API (`§5.9`): no `group_by` parameter exists on `GET /api/v1/metrics/query`.

This means: an alert configured to fire per-service (`group_by: ["service"]`) issues a query with no group_by. Storage returns a single aggregated series. The evaluator receives one value and evaluates the entire fleet as one unit. Per-service, per-host, or per-route alerting — any multi-dimensional alert — silently evaluates against the aggregate and misses individual service failures.

**Resolution required:** `group_by` must be added to both (1) the alerts `MetricQuery` type and (2) the storage metric query API. Storage must return a series per group-by value combination. This is not optional — it is a core requirement for multi-service alerting.

---

### Conflict 20 — Log query interface: DSL string vs. structured params

**Alerts** `LogQuery` (`§8.1`): `filter: string` — "query DSL or lucene-style filter expression — format TBD with storage agent."

**Storage** log query (`§5.9`): structured params: `service`, `severity`, `search` (free text), `trace_id`. No DSL, no filter string param.

These are incompatible interfaces. Alerts constructs a `filter` string that storage has no parameter to receive. Alerts open issue #1 acknowledges this is blocking but defers resolution. It must be resolved before Phase 4 log-count monitor implementation.

**Resolution required:** alerts must use storage's structured parameter model for log queries, not a DSL string. The `LogQuery.filter` field should be replaced with explicit structured fields matching storage's API: `service`, `severity_min`, `search`, `trace_id`. Alerts' log filter DSL ambition is deferred or resolved as a query builder in the alerts engine that emits structured params.

---

## 4. Missing Decisions That Block Implementation

| # | Decision | Blocking | Proposed answer |
|---|----------|----------|----------------|
| M1 | Timestamp unit at ingestion-to-storage boundary | Conflict 1, 6 | Unix nanoseconds. Ingestion converts from SDK milliseconds. |
| M2 | Resource attribute → flat field normalization owner | Conflict 2 | Ingestion identity normalizer owns the mapping; table below. |
| M3 | Write architecture: write API or direct ClickHouse | Conflict 3 | Decide before Phase 2. Proposed: direct ClickHouse (Option A). |
| M4 | Histogram wire format | Conflict 4 | Ingestion explodes bucket list into per-`le` rows. |
| M5 | Query time params: `from`/`to` or `start`/`end` | Conflict 10 | `start` and `end`. Frontend aligns. |
| M6 | Trace list endpoint path | Conflict 11 | `GET /api/v1/traces` |
| M7 | Metric series response structure | Conflicts 12, 18 | Series-with-labels. `{ series: [{ labels: {}, points: [{timestamp,value}] }] }` |
| M8 | Service summary endpoint design | Conflict 13 | Storage designs; response shape from frontend §7.2 is the requirement. |
| M9 | `GET /api/v1/logs/volume` endpoint | Conflict 14 | Storage adds it. Response shape from frontend §7.4. |
| M10 | `log_id` field | Conflict 15 | Ingestion generates UUID per log record; storage stores and returns it. |
| M11 | Log severity field name in responses | Conflict 16 | `severity_text` (string) in responses. Frontend maps to display. |
| M12 | Trace status case | Conflict 17 | Lowercase: `ok`, `error`, `unset`. |
| M13 | `group_by` in metric query API | Conflict 19 | Storage adds `group_by` param. Alerts adds to `MetricQuery` type. |
| M14 | Log query interface for alerts | Conflict 20 | Alerts uses structured params, not DSL string. |
| M15 | `trace_index` population owner | Conflict 9 | ClickHouse materialized view (storage owns). Ingestion not responsible. |
| M16 | `truncated` flag in query responses | — | Storage adds `truncated: bool` to metric and log responses. Alerts requires it. |
| M17 | `env` values endpoint | Frontend Q3 | `GET /api/v1/environments` returning `{ environments: string[] }`. Storage owns. |
| M18 | Span `name` canonical field | Conflict 5 | `name` at API surface. Storage may column-name it `operation` internally. |

---

## 5. Terminology Inconsistencies

| Concept | Ingestion | Storage | Frontend | Alerts | Canonical |
|---|---|---|---|---|---|
| Service identifier | `service.name` (resource attr) | `service` (column) | `service` (field) | `service` (filter) | `service_name` |
| Deployment env | `deployment.environment` | `env` | `env` | `env` | `environment` |
| Log text content | `body` | `message` | `message` | `message` | `message` |
| Log importance | `severity` (string) | `severity` (enum int) | `level` (string) | `level` (string) | `severity_text` (string) + `severity_number` (int) |
| Span operation name | `name` | `operation` | `name` | — | `name` |
| Trace status value | `ok`/`error`/`unset` | lowercase | `OK`/`ERROR` | `ok`/`error` | lowercase: `ok`, `error`, `unset` |
| Query start bound | `start` | `start` | `from` | `start` | `start` |
| Query end bound | `end` | `end` | `to` | `end` | `end` |
| Metric rollup interval | — | `step` | `interval` | `step_seconds` | `step` (duration string e.g. `1m`) |
| Data point fields | — | `timestamp`, `value` | `timestamp`, `value` | `t`, `v` | `timestamp`, `value` |
| Alert rule entity | — | — | "alert rule" | `Monitor` | `Monitor` (rule), `Alert` (instance) |

---

## 6. Proposed Unified Contract Layer

This section is the canonical reference. When any subsystem's design conflicts with what is written here, this document wins. Changes require sign-off from affected agents.

### 6.1 Canonical Identity Fields

Every telemetry event of every type must carry these fields at the top level (not nested inside a `resource` block). Ingestion is responsible for normalizing from OTel resource attributes before forwarding.

| Canonical field | OTel source attribute | Type | Required |
|---|---|---|---|
| `service_name` | `service.name` | string | yes |
| `environment` | `deployment.environment` | string | yes |
| `host` | `host.name` | string | optional |
| `version` | `service.version` | string | optional |
| `timestamp` | `timestamp` | int64 (Unix nanoseconds) | yes |

### 6.2 Canonical Metric Event (Ingestion → Storage)

```json
{
  "service_name": "api-server",
  "environment": "production",
  "host": "worker-1",
  "version": "v1.2.3",
  "timestamp": 1711234567890000000,
  "name": "http.request.duration",
  "type": "gauge | counter | histogram",
  "unit": "ms",
  "value": 143.2,
  "tags": { "http.method": "POST", "http.status_code": "200" }
}
```

For `histogram`, the forwarded form is one row per bucket (exploded by ingestion):
```json
{
  "service_name": "api-server",
  "environment": "production",
  "timestamp": 1711234567890000000,
  "name": "http.request.duration",
  "type": "histogram",
  "unit": "ms",
  "value": 1,
  "tags": { "http.method": "POST", "le": "250" }
}
```
Plus a `_count` row (`le="+Inf"`) and a `_sum` row.

### 6.3 Canonical Log Event (Ingestion → Storage)

```json
{
  "log_id": "01HV4...",
  "service_name": "api-server",
  "environment": "production",
  "host": "worker-1",
  "timestamp": 1711234567890000000,
  "severity_number": 17,
  "severity_text": "ERROR",
  "message": "Connection refused to postgres at db:5432",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "attributes": { "db.system": "postgresql", "db.name": "users" }
}
```

Ingestion severity mapping (string → `severity_number`):
`TRACE→1, DEBUG→5, INFO→9, WARN→13, ERROR→17, FATAL→21`. Unknown → `0`.

### 6.4 Canonical Trace Span Event (Ingestion → Storage)

```json
{
  "service_name": "api-server",
  "environment": "production",
  "host": "worker-1",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "parent_span_id": "b9c7c989f97918e1",
  "name": "POST /v1/checkout",
  "kind": "server",
  "start_time": 1711234567800000000,
  "end_time": 1711234567990000000,
  "duration_ns": 190000000,
  "status": "ok",
  "status_message": "",
  "attributes": { "http.method": "POST", "http.status_code": "200" }
}
```

All times are Unix nanoseconds. `duration_ns` is computed by ingestion from `end_time - start_time`. If the client sends `duration_ms`, ingestion converts before forwarding.

### 6.5 Ingestion API

| Method | Path | Body | Success |
|--------|------|------|---------|
| POST | `/v1/metrics` | `{ "metrics": [...] }` | 202 |
| POST | `/v1/logs` | `{ "logs": [...] }` | 202 |
| POST | `/v1/traces` | `{ "spans": [...] }` | 202 |

- 202 = received. Does not guarantee persistence.
- Partial batches accepted. Rejected events listed in response body.
- Auth: `X-Api-Key` header (v1: single global key).

### 6.6 Query API

All endpoints under `/api/v1`. Auth: same API key.

**Shared conventions:**
- Time params: `start` and `end` (ISO 8601 string). Required on all time-series endpoints.
- All timestamps in responses: ISO 8601 strings.
- Pagination: cursor-based. `next_cursor` in response; `cursor` in request.
- Trace and log status values: lowercase (`ok`, `error`, `unset`).

**Endpoints:**

| Method | Path | Owner | Consumers |
|--------|------|-------|-----------|
| GET | `/api/v1/metrics/query` | Storage | Frontend, Alerts |
| GET | `/api/v1/metrics/names` | Storage | Frontend |
| GET | `/api/v1/logs` | Storage | Frontend, Alerts |
| GET | `/api/v1/logs/volume` | Storage | Frontend |
| GET | `/api/v1/traces` | Storage | Frontend, Alerts |
| GET | `/api/v1/traces/:trace_id` | Storage | Frontend |
| GET | `/api/v1/services` | Storage | Frontend |
| GET | `/api/v1/services/:service_name/summary` | Storage | Frontend |
| GET | `/api/v1/environments` | Storage | Frontend |

**Metric query response (canonical):**
```json
{
  "metric": "http.request.duration",
  "step": "1m",
  "truncated": false,
  "series": [
    {
      "labels": { "service_name": "api-server", "http.method": "POST" },
      "points": [
        { "timestamp": "2024-01-01T00:00:00Z", "value": 42.3 }
      ]
    }
  ]
}
```

**Log query response (canonical):**
```json
{
  "logs": [
    {
      "log_id": "01HV4...",
      "timestamp": "2024-01-01T00:00:01.123Z",
      "severity_text": "ERROR",
      "severity_number": 17,
      "service_name": "api-server",
      "environment": "production",
      "host": "worker-1",
      "message": "Connection refused",
      "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
      "span_id": "00f067aa0ba902b7",
      "attributes": {}
    }
  ],
  "next_cursor": "...",
  "total_matched": 1204,
  "truncated": false
}
```

**Trace list response (canonical):**
```json
{
  "traces": [
    {
      "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
      "root_service_name": "api-server",
      "root_name": "POST /v1/checkout",
      "start_time": "2024-01-01T00:00:01Z",
      "duration_ns": 190000000,
      "span_count": 8,
      "status": "ok",
      "environment": "production"
    }
  ],
  "next_cursor": null
}
```

### 6.7 Alert State Schema

Canonical field names for the alerts API surface (consumed by frontend):

```json
{
  "id": "mon_abc123",
  "name": "High error rate — api-server",
  "service_name": "api-server",
  "environment": "production",
  "status": "alerting",
  "previous_status": "ok",
  "severity": "critical",
  "triggered_at": "2026-04-02T14:00:00Z",
  "resolved_at": null,
  "last_evaluated_at": "2026-04-02T14:05:00Z",
  "breaching_groups": [
    { "service_name": "api-server", "value": 843.2 }
  ]
}
```

---

## 7. Proposed INTERFACES.md Structure

```markdown
# INTERFACES.md

## How to Use
Source of truth for cross-subsystem contracts. No agent implements against
an undocumented interface. Changes require reviewer sign-off + sign-off from
all affected agents listed per section.

Status values: AGREED | PROPOSED | OPEN

---

## §0 Open Decisions Log
Table of unresolved decisions blocking implementation (M1–M18 from review).

## §1 Canonical Identity Fields
Status: PROPOSED | Affects: all agents
- Universal required fields
- OTel attribute → flat field mapping table
- Enforcement: who rejects, when

## §2 Metric Event Schema (Ingestion → Storage)
Status: PROPOSED | Affects: Ingestion, Storage
- Field table with types, units, constraints
- Histogram exploded-row format
- Tags constraints (max count, key format)

## §3 Log Event Schema (Ingestion → Storage)
Status: PROPOSED | Affects: Ingestion, Storage
- Field table
- Severity number mapping table
- log_id generation ownership
- trace_id/span_id format constraints

## §4 Trace Span Schema (Ingestion → Storage)
Status: PROPOSED | Affects: Ingestion, Storage
- Field table
- Timestamp unit: nanoseconds
- duration_ns computation rule
- status enum (lowercase)

## §5 Ingestion API (External Boundary)
Status: PROPOSED | Affects: Ingestion (owns), Storage
- Endpoint map
- Auth mechanism
- 202 ack semantics
- Partial failure error format
- SDK timestamp conversion responsibilities

## §6 Query API (Storage → Frontend + Alerts)
Status: PROPOSED | Affects: Storage (owns), Frontend, Alerts
- §6.1 Metric query — params, group_by, response shape
- §6.2 Log query — params, count_only, volume endpoint, response shape
- §6.3 Trace list query — params, response shape
- §6.4 Trace detail query
- §6.5 Services list + summary endpoint
- §6.6 Environments list endpoint
- §6.7 Shared conventions (start/end, cursor, lowercase status)
- §6.8 truncated flag semantics

## §7 Alert State Schema (Alerts → Frontend)
Status: PROPOSED | Affects: Alerts (owns), Frontend
- Monitor object schema
- Alert instance schema
- Status enum values and state machine
- Polling delivery model

## §8 Retention Policy
Status: OPEN | Affects: Storage (owns), Frontend, Alerts
- Per-signal retention periods
- Query behavior at retention boundary
- Alert evaluation window overlap behavior
```

---

## 8. Recommended Resolution Order

The following must be resolved before any agent begins implementation. Grouped by dependency:

**Group 1 — Do immediately (blocks all Phase 2 work):**
- M3: Write architecture (API or direct ClickHouse)
- M1, M4: Timestamp unit and histogram format (Ingestion + Storage must agree)
- M2: Normalization mapping table (Ingestion owns)

**Group 2 — Required before storage begins query API (blocks Frontend + Alerts):**
- M5: `start`/`end` param names (Frontend aligns)
- M7: Series response structure (Storage redesigns; Alerts aligns `t`/`v` → `timestamp`/`value`)
- M13: `group_by` added to storage metric query API

**Group 3 — Required before Frontend begins Phase 3:**
- M6, M8, M9, M11, M12, M17, M18: Endpoint path, service summary, log volume, field naming, status case

**Group 4 — Required before Alerts begins Phase 4:**
- M14: Log query interface (structured params, not DSL)
- M16: `truncated` flag
- M13: `group_by` (same as Group 2)

**Group 5 — Implementation detail, can be deferred to implementation start:**
- M10: `log_id` generation (ingestion or storage, pick one)
- M15: `trace_index` population (storage moves to materialized view)
