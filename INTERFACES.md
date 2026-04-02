# INTERFACES.md

**Authority:** This file is the source of truth for all cross-subsystem contracts.
When any subsystem design conflicts with this file, this file wins.
Changes require a PR reviewed by the Reviewer agent and sign-off from all affected agents listed per section.

**Resolved conflicts:** This document resolves all 20 conflicts identified in `docs/review-integration.md`.
Each decision is final. There are no open options below.

---

## §1 Canonical Identity Fields

**Affects:** Ingestion (writes), Storage (stores and indexes), Frontend (queries and displays), Alerts (filters and groups)

Every telemetry event — metric, log, and span — must carry these fields at the **top level** of the forwarded payload. Fields are never nested inside a `resource` block at the ingestion→storage boundary.

| Field | Type | Required | Constraints |
|---|---|---|---|
| `service_name` | string | yes | Non-empty. Max 256 chars. |
| `environment` | string | yes | Non-empty. Max 64 chars. e.g. `production`, `staging` |
| `host` | string | no | Empty string `""` when absent. Never null. |
| `version` | string | no | Empty string `""` when absent. Never null. |

**Timestamp** is a separate required field on every event. Its type and semantics are defined per-schema in §3–§5 but the value is always **Unix nanoseconds as int64**.

### OTel Resource Attribute Mapping

Ingestion receives OTel `resource` blocks with dotted attribute names. The ingestion identity normalizer maps them to canonical flat names before forwarding. This mapping is owned by ingestion.

| OTel resource attribute | Canonical field |
|---|---|
| `service.name` | `service_name` |
| `deployment.environment` | `environment` |
| `host.name` | `host` |
| `service.version` | `version` |

Any OTel attribute not in this table is discarded from the resource block. Signal-level attributes (metric tags, log attributes, span attributes) are passed through unchanged.

**Rejection rule:** Ingestion rejects any event where `service_name` or `environment` is absent or empty after normalization. `host` and `version` default to `""`.

---

## §2 Write Architecture: Ingestion → Storage

**Affects:** Ingestion (implements), Storage (owns ClickHouse schema)

Ingestion writes directly to ClickHouse using the ClickHouse HTTP interface with `FORMAT JSONEachRow`. There is no intermediate storage write API service. Ingestion owns the ClickHouse write client.

```
SDK → Ingestion Gateway → ClickHouse HTTP (INSERT ... FORMAT JSONEachRow)
```

**ClickHouse connection config** is provided to ingestion via environment variables. Storage defines the variable names:

| Variable | Description |
|---|---|
| `CLICKHOUSE_HOST` | Hostname of ClickHouse instance |
| `CLICKHOUSE_PORT` | HTTP port (default: 8123) |
| `CLICKHOUSE_DATABASE` | Database name |
| `CLICKHOUSE_USER` | Username |
| `CLICKHOUSE_PASSWORD` | Password |

**Batch write rule:** Ingestion buffers and flushes to ClickHouse in batches of 1000 rows or every 500ms, whichever comes first. Individual row inserts are not used.

**trace_index population:** ClickHouse materialized view on the `spans` table. Storage owns this view. Ingestion has no responsibility for `trace_index`.

---

## §3 Metric Event Schema (Ingestion → Storage)

**Affects:** Ingestion (produces), Storage (consumes and stores)

### 3.1 Gauge and Counter

One row per data point.

| Field | Type | Required | Notes |
|---|---|---|---|
| `service_name` | string | yes | From §1 |
| `environment` | string | yes | From §1 |
| `host` | string | yes | `""` if absent |
| `version` | string | yes | `""` if absent |
| `timestamp` | int64 | yes | Unix nanoseconds |
| `name` | string | yes | Dot-namespaced. e.g. `http.request.duration` |
| `type` | string | yes | `"gauge"` or `"counter"` |
| `unit` | string | no | e.g. `"ms"`, `"bytes"`. `""` if absent |
| `value` | float64 | yes | Counter values must be ≥ 0 |
| `tags` | object | yes | `Map<string, string>`. `{}` if no tags |

**Tag constraints:** Max 20 key-value pairs. Keys match `[a-z_][a-z0-9_.]*`, max 64 chars. Values max 256 chars. Ingestion rejects metrics with malformed tag keys.

**Example:**
```json
{
  "service_name": "api-server",
  "environment": "production",
  "host": "worker-1",
  "version": "v1.2.3",
  "timestamp": 1711234567890000000,
  "name": "http.request.count",
  "type": "counter",
  "unit": "",
  "value": 1.0,
  "tags": { "http.method": "POST", "http.status_code": "200" }
}
```

### 3.2 Histogram

The SDK sends a histogram object to the ingestion gateway. Ingestion explodes it into multiple rows before writing to ClickHouse. Each bucket boundary becomes one row. `summary` type is not supported in Phase 2.

**SDK histogram payload (received by ingestion, not written to storage):**
```json
{
  "name": "http.request.duration",
  "type": "histogram",
  "unit": "ms",
  "buckets": [
    { "upper_bound": 50,   "count": 10 },
    { "upper_bound": 100,  "count": 25 },
    { "upper_bound": 250,  "count": 45 },
    { "upper_bound": 500,  "count": 47 }
  ],
  "count": 47,
  "sum": 4230.5
}
```

**Rows written to ClickHouse by ingestion** (one per bucket, plus `_count` and `_sum`):

| Row | `name` | `type` | `value` | `tags` (merged with event tags) |
|---|---|---|---|---|
| Bucket ≤50 | `http.request.duration` | `histogram` | 10 | `{..., "le": "50"}` |
| Bucket ≤100 | `http.request.duration` | `histogram` | 25 | `{..., "le": "100"}` |
| Bucket ≤250 | `http.request.duration` | `histogram` | 45 | `{..., "le": "250"}` |
| Bucket ≤500 | `http.request.duration` | `histogram` | 47 | `{..., "le": "500"}` |
| Count | `http.request.duration_count` | `counter` | 47 | `{...}` (no `le` tag) |
| Sum | `http.request.duration_sum` | `counter` | 4230.5 | `{...}` (no `le` tag) |

All histogram rows share the same `service_name`, `environment`, `host`, `version`, `timestamp`, and `unit` as the parent event. The `le` tag value is the string representation of `upper_bound`. There is no `+Inf` row; the count row replaces it.

---

## §4 Log Event Schema (Ingestion → Storage)

**Affects:** Ingestion (produces), Storage (consumes and stores)

| Field | Type | Required | Notes |
|---|---|---|---|
| `log_id` | string | yes | ULID generated by ingestion. 26-char string. |
| `service_name` | string | yes | From §1 |
| `environment` | string | yes | From §1 |
| `host` | string | yes | `""` if absent |
| `version` | string | yes | `""` if absent |
| `timestamp` | int64 | yes | Unix nanoseconds |
| `severity_number` | int32 | yes | Integer per OTel severity scale. `0` if unknown. |
| `severity_text` | string | yes | Original string from source, normalized to uppercase. `""` if absent. |
| `message` | string | yes | Log body text. Max 65536 bytes. Truncated with `[truncated]` suffix if exceeded. |
| `trace_id` | string | no | 32 lowercase hex chars. `""` if absent. |
| `span_id` | string | no | 16 lowercase hex chars. `""` if absent. |
| `attributes` | object | yes | `Map<string, string>`. `{}` if no attributes. Max 50 pairs. |

**`log_id`** is a ULID (Universally Unique Lexicographically Sortable Identifier). Ingestion generates one per log record before forwarding. Format: 26 uppercase alphanumeric chars, e.g. `01HV4MXKPQ3ZTJR8FBVS9Y6D2`.

**Severity mapping** — ingestion maps incoming strings to `severity_number` before forwarding:

| Incoming string (case-insensitive) | `severity_number` | `severity_text` (normalized) |
|---|---|---|
| `TRACE`, `trace`, `TRC` | 1 | `TRACE` |
| `DEBUG`, `debug`, `DBG` | 5 | `DEBUG` |
| `INFO`, `info`, `INFORMATION` | 9 | `INFO` |
| `WARN`, `warn`, `WARNING` | 13 | `WARN` |
| `ERROR`, `error`, `ERR` | 17 | `ERROR` |
| `FATAL`, `fatal`, `CRITICAL`, `CRIT` | 21 | `FATAL` |
| anything else | 0 | original string, uppercased |

**`trace_id` / `span_id`** must be valid hex strings when present. Ingestion stores `""` (not null) when absent. Storage uses `""` to mean "no trace context."

**`attributes`** values are stored as strings. Ingestion converts non-string types (numbers, booleans) to their string representation before forwarding.

**Example:**
```json
{
  "log_id": "01HV4MXKPQ3ZTJR8FBVS9Y6D2",
  "service_name": "api-server",
  "environment": "production",
  "host": "worker-1",
  "version": "v1.2.3",
  "timestamp": 1711234567890123456,
  "severity_number": 17,
  "severity_text": "ERROR",
  "message": "Connection refused to postgres at db:5432",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "attributes": { "db.system": "postgresql", "db.name": "users" }
}
```

---

## §5 Trace Span Schema (Ingestion → Storage)

**Affects:** Ingestion (produces), Storage (consumes and stores)

One row per span. Ingestion accepts individual spans (not assembled traces). A trace is the set of all spans sharing a `trace_id`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `service_name` | string | yes | From §1 |
| `environment` | string | yes | From §1 |
| `host` | string | yes | `""` if absent |
| `version` | string | yes | `""` if absent |
| `trace_id` | string | yes | 32 lowercase hex chars |
| `span_id` | string | yes | 16 lowercase hex chars |
| `parent_span_id` | string | yes | 16 lowercase hex chars. `""` for root span. |
| `name` | string | yes | Operation name. e.g. `"POST /v1/checkout"` |
| `kind` | string | yes | `"internal"`, `"server"`, `"client"`, `"producer"`, or `"consumer"` |
| `start_time` | int64 | yes | Unix nanoseconds |
| `end_time` | int64 | yes | Unix nanoseconds. Must be ≥ `start_time`. |
| `duration_ns` | int64 | yes | `end_time - start_time`. Computed by ingestion. |
| `status` | string | yes | `"ok"`, `"error"`, or `"unset"` |
| `status_message` | string | yes | `""` if absent |
| `attributes` | object | yes | `Map<string, string>`. `{}` if no attributes. Max 128 pairs. |

**Duration:** Ingestion computes `duration_ns = end_time - start_time`. If the SDK sends `duration_ms`, ingestion converts: `duration_ns = duration_ms * 1_000_000`. The `duration_ms` field is not forwarded to storage.

**Root span identification:** `parent_span_id == ""`. Storage's materialized view uses this to populate `trace_index`. Ingestion does not detect or signal root spans.

**Status values** are lowercase. Ingestion maps incoming OTel status codes:
- `STATUS_CODE_OK` → `"ok"`
- `STATUS_CODE_ERROR` → `"error"`
- `STATUS_CODE_UNSET` or absent → `"unset"`

**Ingestion rejects** spans where `end_time < start_time`. All other validation errors produce a partial-batch rejection (the span is skipped; other spans in the batch proceed).

**Example:**
```json
{
  "service_name": "api-server",
  "environment": "production",
  "host": "worker-1",
  "version": "v1.2.3",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "parent_span_id": "b9c7c989f97918e1",
  "name": "POST /v1/checkout",
  "kind": "server",
  "start_time": 1711234567800000000,
  "end_time":   1711234567990000000,
  "duration_ns": 190000000,
  "status": "ok",
  "status_message": "",
  "attributes": { "http.method": "POST", "http.status_code": "200" }
}
```

---

## §6 Ingestion External API

**Affects:** Ingestion (owns), SDK/agent authors

Base path: `/v1`
Auth: `X-Api-Key: <key>` header on all requests. Missing or invalid key → `401`. For Phase 2, one global API key per deployment configured via `INGESTION_API_KEY` environment variable.

### Endpoints

| Method | Path | Request body | Success response |
|--------|------|-------------|-----------------|
| POST | `/v1/metrics` | `{ "metrics": [MetricEvent, ...] }` | `202` |
| POST | `/v1/logs` | `{ "logs": [LogEvent, ...] }` | `202` |
| POST | `/v1/traces` | `{ "spans": [SpanEvent, ...] }` | `202` |

`Content-Type: application/json` on all requests.

**Acknowledgment semantics:** `202` means the payload has been received and accepted for forwarding. It does not mean the data has been written to ClickHouse. If ClickHouse is unavailable, ingestion buffers in memory (max 10,000 rows; drops oldest on overflow) and continues attempting to flush. Callers must implement retry with exponential backoff on `503`.

**Partial batch behavior:** Within a single request, valid events are processed even if some events are rejected. The response body describes which events were rejected.

**Success response body (202):**
```json
{ "accepted": 9, "rejected": 1 }
```

**Error response body (400 — validation failure):**
```json
{
  "accepted": 8,
  "rejected": 2,
  "errors": [
    { "index": 2, "field": "service_name", "reason": "required field is empty" },
    { "index": 7, "field": "end_time",     "reason": "end_time < start_time" }
  ]
}
```

`index` is the zero-based position of the event in the submitted array.

**Timestamp conversion responsibility:** The ingestion gateway converts SDK-submitted millisecond timestamps to nanoseconds before forwarding to ClickHouse. SDKs may send milliseconds. The ingestion→storage boundary always uses nanoseconds.

---

## §7 Query API

**Affects:** Storage (owns and implements), Frontend (consumes), Alerts (consumes)

Base path: `/api/v1`
Auth: `X-Api-Key: <key>` header. Same key as ingestion API.
All responses: `Content-Type: application/json`.

### §7.0 Shared Conventions

**Time range parameters:** All time-series endpoints use `start` and `end`. Both are required. Format: ISO 8601 with timezone, e.g. `2026-04-02T09:00:00Z`. Requests missing `start` or `end` receive `400`.

**Time range semantics:** `[start, end)` — inclusive start, exclusive end. All consumers use this convention. Alert evaluation windows use the same semantics.

**Timestamps in responses:** ISO 8601 strings with millisecond precision, e.g. `"2026-04-02T09:05:13.412Z"`.

**Status values:** Lowercase throughout. `"ok"`, `"error"`, `"unset"`. Never `"OK"`, `"ERROR"`.

**Pagination:** Cursor-based, forward-only. Requests include `cursor=<opaque string>`. Responses include `"next_cursor": "<string>"` (or `null` when no further pages). Offset-based pagination is not supported.

**Error response format:**
```json
{ "error": "missing required parameter: start", "code": "bad_request" }
```

---

### §7.1 Metric Query

```
GET /api/v1/metrics/query
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `start` | string | yes | ISO 8601 |
| `end` | string | yes | ISO 8601 |
| `name` | string | yes | Metric name, e.g. `http.request.duration` |
| `environment` | string | no | Filter to one environment |
| `service_name` | string | no | Filter to one service |
| `step` | string | no | Rollup interval: `1m`, `5m`, `15m`, `1h`, `6h`, `1d`. Default: auto-selected by storage based on range. |
| `agg` | string | no | `avg`, `min`, `max`, `sum`, `count`, `p50`, `p95`, `p99`. Default: `avg`. |
| `group_by` | string | no | Comma-separated tag keys. e.g. `service_name,http.method`. When present, one series per unique value combination. |
| `filter[<key>]` | string | no | Exact tag match filter. Repeatable. e.g. `filter[http.method]=POST` |

**Step auto-selection** (when `step` is omitted):

| Time range | Selected step |
|---|---|
| ≤ 3 hours | raw data (no rollup) |
| 3 hours – 48 hours | `1m` |
| 48 hours – 2 weeks | `1h` |
| > 2 weeks | `1d` |

**Response:**
```json
{
  "name": "http.request.duration",
  "step": "1m",
  "agg": "avg",
  "truncated": false,
  "series": [
    {
      "labels": { "service_name": "api-server", "http.method": "POST" },
      "points": [
        { "timestamp": "2026-04-02T09:00:00Z", "value": 143.2 },
        { "timestamp": "2026-04-02T09:01:00Z", "value": 156.8 }
      ]
    }
  ]
}
```

`truncated: true` when the result set was capped (e.g. `group_by` produced more series than the server limit of 100). Alerts must check this field before evaluating conditions.

When `group_by` is not specified, `labels` contains only the filter dimensions that were supplied. When `group_by` is specified, `labels` contains the value of each grouped dimension for that series.

---

### §7.2 Metric Names

```
GET /api/v1/metrics/names
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `environment` | string | no | Filter to one environment |
| `service_name` | string | no | Filter to one service |

**Response:**
```json
{ "names": ["http.request.duration", "http.request.count", "process.cpu.usage"] }
```

---

### §7.3 Log Query

```
GET /api/v1/logs
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `start` | string | yes | ISO 8601 |
| `end` | string | yes | ISO 8601 |
| `environment` | string | no | Filter to one environment |
| `service_name` | string | no | Filter to one service |
| `severity_min` | int | no | Minimum severity_number (inclusive). e.g. `13` for WARN and above. |
| `search` | string | no | Full-text search against `message` field |
| `trace_id` | string | no | Return only logs with this exact trace_id |
| `limit` | int | no | Max results. Default: 100. Max: 1000. |
| `cursor` | string | no | Pagination cursor |
| `count_only` | bool | no | When `true`, return count only (no log bodies). Default: false. |

**Response (default):**
```json
{
  "logs": [
    {
      "log_id": "01HV4MXKPQ3ZTJR8FBVS9Y6D2",
      "timestamp": "2026-04-02T09:05:13.412Z",
      "severity_number": 17,
      "severity_text": "ERROR",
      "service_name": "api-server",
      "environment": "production",
      "host": "worker-1",
      "message": "Connection refused to postgres at db:5432",
      "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
      "span_id": "00f067aa0ba902b7",
      "attributes": { "db.system": "postgresql" }
    }
  ],
  "next_cursor": "eyJ0cyI6IjIwMjYtMDQtMDJUMDk6MDU6MTMuNDEyWiJ9",
  "total_matched": 1204,
  "truncated": false
}
```

**Response (count_only=true):**
```json
{ "count": 1204, "truncated": false }
```

`total_matched` is an estimate. `truncated: true` when result count exceeds an internal cap before reaching `end`.

---

### §7.4 Log Volume

```
GET /api/v1/logs/volume
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `start` | string | yes | ISO 8601 |
| `end` | string | yes | ISO 8601 |
| `environment` | string | no | Filter to one environment |
| `service_name` | string | no | Filter to one service |
| `step` | string | no | Bucket size. `1m`, `5m`, `15m`, `1h`. Default: auto (same logic as metric query). |

**Response:**
```json
{
  "step": "5m",
  "buckets": [
    {
      "timestamp": "2026-04-02T09:00:00Z",
      "count": 412,
      "by_severity": {
        "INFO":  380,
        "WARN":   12,
        "ERROR":  20
      }
    },
    {
      "timestamp": "2026-04-02T09:05:00Z",
      "count": 398,
      "by_severity": {
        "INFO":  391,
        "ERROR":   7
      }
    }
  ]
}
```

`by_severity` keys are `severity_text` values. Only severity levels present in the bucket appear.

---

### §7.5 Trace List

```
GET /api/v1/traces
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `start` | string | yes | ISO 8601 |
| `end` | string | yes | ISO 8601 |
| `environment` | string | no | Filter to one environment |
| `service_name` | string | no | Filter by root service |
| `status` | string | no | `"ok"` or `"error"` |
| `min_duration_ms` | int | no | Minimum trace duration in milliseconds |
| `trace_id` | string | no | Exact trace_id match (returns 0 or 1 result) |
| `limit` | int | no | Default: 50. Max: 200. |
| `cursor` | string | no | Pagination cursor |

**Response:**
```json
{
  "traces": [
    {
      "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
      "root_service_name": "api-server",
      "root_name": "POST /v1/checkout",
      "start_time": "2026-04-02T09:05:10.100Z",
      "duration_ns": 190000000,
      "span_count": 8,
      "status": "ok",
      "environment": "production"
    }
  ],
  "next_cursor": null
}
```

`duration_ns` is the total trace duration in nanoseconds. Frontend converts to display units. `status` is `"error"` if any span in the trace has `status == "error"`; otherwise `"ok"`.

---

### §7.6 Trace Detail

```
GET /api/v1/traces/:trace_id
```

No query parameters. Returns all spans for the trace.

**Response:**
```json
{
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "root_service_name": "api-server",
  "root_name": "POST /v1/checkout",
  "start_time": "2026-04-02T09:05:10.100Z",
  "duration_ns": 190000000,
  "status": "error",
  "environment": "production",
  "spans": [
    {
      "span_id": "00f067aa0ba902b7",
      "parent_span_id": null,
      "service_name": "api-server",
      "name": "POST /v1/checkout",
      "kind": "server",
      "start_time": "2026-04-02T09:05:10.100Z",
      "end_time": "2026-04-02T09:05:10.290Z",
      "duration_ns": 190000000,
      "status": "error",
      "status_message": "upstream timeout",
      "attributes": { "http.method": "POST", "http.status_code": "504" }
    },
    {
      "span_id": "a2fb4a1d1a96d312",
      "parent_span_id": "00f067aa0ba902b7",
      "service_name": "payment-service",
      "name": "POST /charge",
      "kind": "client",
      "start_time": "2026-04-02T09:05:10.150Z",
      "end_time": "2026-04-02T09:05:10.280Z",
      "duration_ns": 130000000,
      "status": "error",
      "status_message": "timeout after 30s",
      "attributes": { "http.method": "POST", "http.url": "/charge" }
    }
  ]
}
```

Spans are returned in ascending `start_time` order. `parent_span_id` is `null` (not `""`) on the root span in this response. Clients assemble the tree using `parent_span_id`.

---

### §7.7 Services List

```
GET /api/v1/services
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `start` | string | yes | ISO 8601 |
| `end` | string | yes | ISO 8601 |
| `environment` | string | no | Filter to one environment |

Returns all services that have emitted any telemetry in the given time range, with pre-aggregated summary metrics computed over that range.

**Response:**
```json
{
  "services": [
    {
      "service_name": "api-server",
      "environment": "production",
      "last_seen": "2026-04-02T09:05:13Z",
      "request_rate_per_sec": 142.3,
      "error_rate": 0.023,
      "p99_latency_ns": 312000000,
      "log_count": 48201
    }
  ]
}
```

`error_rate` is a fraction (0.023 = 2.3%). `p99_latency_ns` is nanoseconds. Frontend converts to display units. `log_count` is the total log events from this service in the time range.

These values are computed by storage from ClickHouse. They are not served from PostgreSQL metadata.

---

### §7.8 Service Summary

```
GET /api/v1/services/:service_name/summary
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `start` | string | yes | ISO 8601 |
| `end` | string | yes | ISO 8601 |
| `environment` | string | no | Filter to one environment |

**Response:**
```json
{
  "service_name": "api-server",
  "environment": "production",
  "start": "2026-04-02T09:00:00Z",
  "end": "2026-04-02T09:05:00Z",
  "last_seen": "2026-04-02T09:05:13Z",
  "request_rate_per_sec": 142.3,
  "error_rate": 0.023,
  "p50_latency_ns": 43000000,
  "p95_latency_ns": 143000000,
  "p99_latency_ns": 312000000,
  "log_count": 48201,
  "active_alert_count": 1
}
```

`active_alert_count` is the number of monitors in `alerting` or `no_data` state scoped to this service. Storage reads this from the alerts monitor state, which alerts writes to PostgreSQL.

---

### §7.9 Environments List

```
GET /api/v1/environments
```

No parameters. Returns all distinct `environment` values seen across all signal types.

**Response:**
```json
{ "environments": ["production", "staging", "dev"] }
```

---

## §8 Alert State Schema

**Affects:** Alerts (owns and writes), Frontend (reads)

### §8.1 Monitor Object

The complete definition of an alert rule. Stored in PostgreSQL. Served by the alerts API.

| Field | Type | Notes |
|---|---|---|
| `id` | string | UUID. Set by alerts on creation. |
| `name` | string | Human-readable name. Required. |
| `description` | string | Optional. `""` if absent. |
| `enabled` | bool | Whether the evaluator runs this monitor. |
| `type` | string | `"threshold"`, `"change"`, `"log_count"`, `"missing_data"` |
| `service_name` | string | Scoping field. Used for display and `active_alert_count`. `""` means platform-wide. |
| `environment` | string | Scoping field. `""` means all environments. |
| `severity` | string | `"info"`, `"warning"`, `"critical"`. Set on the monitor, not derived at eval time. |
| `status` | string | Current evaluation state: `"ok"`, `"alerting"`, `"no_data"`. |
| `triggered_at` | string | ISO 8601. `null` when status is `"ok"`. |
| `resolved_at` | string | ISO 8601. `null` unless previously triggered and now resolved. |
| `last_evaluated_at` | string | ISO 8601. Timestamp of most recent evaluation run. |
| `created_at` | string | ISO 8601. |
| `updated_at` | string | ISO 8601. |
| `breaching_groups` | array | See §8.2. Empty when status is `"ok"`. |

**Example:**
```json
{
  "id": "01HV4MXKPQ3ZTJR8FBVS9Y6D2",
  "name": "High p99 latency — api-server",
  "description": "",
  "enabled": true,
  "type": "threshold",
  "service_name": "api-server",
  "environment": "production",
  "severity": "critical",
  "status": "alerting",
  "triggered_at": "2026-04-02T09:03:00Z",
  "resolved_at": null,
  "last_evaluated_at": "2026-04-02T09:05:00Z",
  "created_at": "2026-03-01T00:00:00Z",
  "updated_at": "2026-03-01T00:00:00Z",
  "breaching_groups": [
    { "labels": { "service_name": "api-server" }, "value": 843200000 }
  ]
}
```

### §8.2 Breaching Groups

Each element in `breaching_groups` represents one dimension combination that is currently in violation.

| Field | Type | Notes |
|---|---|---|
| `labels` | object | `Map<string,string>` — the group_by dimension values for this group |
| `value` | number | The current aggregated value that is breaching the threshold |

For monitors without `group_by`, there is at most one element with `labels: {}`.

### §8.3 Alert State Delivery to Frontend

Frontend polls `GET /api/v1/alerts/monitors` on a 30-second interval. Alerts does not push state to frontend. There is no WebSocket or SSE mechanism in Phase 4.

### §8.4 Alerts API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/alerts/monitors` | Create monitor |
| GET | `/api/v1/alerts/monitors` | List all monitors with current status |
| GET | `/api/v1/alerts/monitors/:id` | Get one monitor |
| PUT | `/api/v1/alerts/monitors/:id` | Update monitor |
| DELETE | `/api/v1/alerts/monitors/:id` | Delete monitor |
| GET | `/api/v1/alerts/monitors/:id/history` | State transition history |
| POST | `/api/v1/alerts/monitors/:id/acknowledge` | Acknowledge active alert |
| GET | `/api/v1/alerts/incidents` | List monitors in `alerting` or `no_data` state |

### §8.5 Alerts → Query API Contract

Alerts calls the query API defined in §7. The following rules apply specifically to alerts usage:

**Metric queries from alerts** use `group_by` matching the monitor's `group_by` field. Alerts reads `series[].labels` to determine which groups are breaching.

**Log count queries from alerts** use `count_only=true` and structured parameters (`service_name`, `severity_min`, `search`). The `filter` DSL string is not used. Alerts constructs log query parameters from structured monitor condition fields.

**`truncated` field:** Alerts checks `truncated` on every query response. If `truncated: true`, the monitor enters a special `eval_error` internal state and does not change its public `status`. This prevents false positives from capped result sets.

**`no_data` detection:** After each evaluation, alerts checks if the response `series` array is empty (for metrics) or `count == 0` (for log count). If data has been absent for `no_data_timeframe_seconds`, alerts sets monitor status to `"no_data"`. An empty result array alone does not trigger `"no_data"` — the absence must persist for the configured duration.

---

## §9 Retention Policy

**Affects:** Storage (owns and enforces), Frontend (must not query beyond), Alerts (evaluation windows must not exceed)

| Signal | Raw data retention | Rollup retention |
|---|---|---|
| Metrics (raw) | 30 days | — |
| Metrics (1-minute rollup) | 90 days | — |
| Metrics (1-hour rollup) | 1 year | — |
| Logs | 30 days | — |
| Spans | 30 days | — |
| Trace index | 30 days | — |
| PostgreSQL metadata | Indefinite | — |

**Query behavior beyond retention:** Storage returns empty results for time ranges that fall entirely outside the retention window. It does not return an error. Queries that span the retention boundary return only the data within the retention window.

**Alert evaluation window constraint:** Alert monitor `window_seconds` must not exceed the raw retention period for the signal type being queried. Storage does not enforce this; alerts validates it on monitor creation and rejects monitors with evaluation windows exceeding 30 days (2,592,000 seconds).

---

## §10 Field Name Reference

Complete canonical field name list for all cross-subsystem fields. Any name not on this list requires a INTERFACES.md amendment before use.

| Concept | Canonical field name | Type | Used in |
|---|---|---|---|
| Service identifier | `service_name` | string | all schemas, all query params |
| Deployment environment | `environment` | string | all schemas, all query params |
| Emitting host | `host` | string | all schemas |
| Service version | `version` | string | all schemas |
| Event timestamp | `timestamp` (int64 ns in payloads) / `timestamp` (ISO 8601 in responses) | int64 / string | all schemas |
| Log unique ID | `log_id` | string (ULID) | log schema, log query response |
| Log message text | `message` | string | log schema, log query response |
| Log severity integer | `severity_number` | int32 | log schema, log query response |
| Log severity string | `severity_text` | string | log schema, log query response |
| Distributed trace ID | `trace_id` | string (32 hex) | span schema, log schema |
| Span ID | `span_id` | string (16 hex) | span schema, log schema |
| Parent span ID | `parent_span_id` | string (16 hex, `""` for root) | span schema |
| Span operation name | `name` | string | span schema, trace responses |
| Span status | `status` | string (`ok`/`error`/`unset`) | span schema, trace responses |
| Metric name | `name` | string | metric schema |
| Metric type | `type` | string | metric schema |
| Metric numeric value | `value` | float64 | metric schema, metric query response |
| Metric tags | `tags` | Map<string,string> | metric schema |
| Log attributes | `attributes` | Map<string,string> | log schema, span schema |
| Query range start | `start` | string (ISO 8601) | all query endpoints |
| Query range end | `end` | string (ISO 8601) | all query endpoints |
| Metric rollup interval | `step` | string (`1m`,`5m`,`1h`,…) | metric query, log volume |
| Metric aggregation function | `agg` | string | metric query |
| Group-by dimensions | `group_by` | string (comma-separated keys) | metric query |
| Response series array | `series` | array | metric query response |
| Series dimension labels | `labels` | Map<string,string> | metric query response |
| Series data points | `points` | array | metric query response |
| Data point time | `timestamp` | string (ISO 8601) | metric query response points |
| Data point value | `value` | float64 | metric query response points |
| Pagination cursor (response) | `next_cursor` | string or null | paginated responses |
| Pagination cursor (request) | `cursor` | string | paginated query params |
| Result cap flag | `truncated` | bool | metric and log responses |
| Alert rule entity | `Monitor` | — | alerts terminology |
| Alert instance entity | `Alert` | — | alerts terminology |
| Monitor current state | `status` | string (`ok`/`alerting`/`no_data`) | monitor object |
| Monitor severity level | `severity` | string (`info`/`warning`/`critical`) | monitor object |
