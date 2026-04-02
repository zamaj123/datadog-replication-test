# Ingestion Subsystem Design

**Agent:** Ingestion  
**Stage:** Shared parallel design  
**Status:** Aligned to `INTERFACES.md`

---

## 1. Objective

Align the ingestion subsystem design to the source-of-truth contracts in `INTERFACES.md` without changing those contracts.

---

## 2. Plan

1. Accept telemetry on the `/v1` ingestion API.
2. Normalize incoming OTel resource attributes to the canonical top-level identity fields.
3. Validate metric, log, and span events against the canonical ingestion-to-storage schemas.
4. Write accepted rows directly to ClickHouse over HTTP using batched `JSONEachRow`.
5. Return partial-batch acceptance results exactly as defined in `INTERFACES.md`.

---

## 3. Files to Change

- `docs/ingestion-design.md`

---

## 4. Assumptions

- `INTERFACES.md` is authoritative for all ingestion-facing and ingestion-to-storage contracts.
- This document only describes ingestion-owned behavior.
- Any prior ingestion wording that conflicts with `INTERFACES.md` is superseded by `INTERFACES.md`.

---

## 5. Implementation

### 5.1 Canonical Identity Fields

Every forwarded metric row, log row, and span row carries these top-level fields:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `service_name` | string | yes | Non-empty. Max 256 chars. |
| `environment` | string | yes | Non-empty. Max 64 chars. |
| `host` | string | no | `""` when absent. Never `null`. |
| `version` | string | no | `""` when absent. Never `null`. |

Timestamp is a separate required field per schema and is always Unix nanoseconds as `int64` at the ingestion-to-storage boundary.

#### OTel Resource Attribute Mapping

Ingestion maps these OTel resource attributes before forwarding:

| OTel resource attribute | Canonical field |
|---|---|
| `service.name` | `service_name` |
| `deployment.environment` | `environment` |
| `host.name` | `host` |
| `service.version` | `version` |

Rules:

- Fields are not nested inside a `resource` block at the ingestion-to-storage boundary.
- Any OTel resource attribute not listed above is discarded from the resource block.
- Signal-level attributes are passed through unchanged subject to each signal schema.
- Ingestion rejects any event where `service_name` or `environment` is absent or empty after normalization.
- `host` and `version` default to `""`.

### 5.2 Write Architecture

Ingestion writes directly to ClickHouse using the ClickHouse HTTP interface with `FORMAT JSONEachRow`. There is no intermediate storage write API service.

```text
SDK -> Ingestion Gateway -> ClickHouse HTTP (INSERT ... FORMAT JSONEachRow)
```

ClickHouse connection config:

| Variable | Description |
|---|---|
| `CLICKHOUSE_HOST` | Hostname of ClickHouse instance |
| `CLICKHOUSE_PORT` | HTTP port, default `8123` |
| `CLICKHOUSE_DATABASE` | Database name |
| `CLICKHOUSE_USER` | Username |
| `CLICKHOUSE_PASSWORD` | Password |

Batch write rules:

- Ingestion buffers and flushes to ClickHouse in batches of 1000 rows or every 500ms, whichever comes first.
- Individual row inserts are not used.
- `trace_index` is populated by a ClickHouse materialized view on the `spans` table.
- Ingestion has no responsibility for `trace_index`.

### 5.3 Metric Event Schema

#### Gauge and Counter

One row per data point.

| Field | Type | Required | Notes |
|---|---|---|---|
| `service_name` | string | yes | From 5.1 |
| `environment` | string | yes | From 5.1 |
| `host` | string | yes | `""` if absent |
| `version` | string | yes | `""` if absent |
| `timestamp` | int64 | yes | Unix nanoseconds |
| `name` | string | yes | Dot-namespaced |
| `type` | string | yes | `"gauge"` or `"counter"` |
| `unit` | string | no | `""` if absent |
| `value` | float64 | yes | Counter values must be `>= 0` |
| `tags` | object | yes | `Map<string,string>`, `{}` if no tags |

Tag constraints:

- Max 20 key-value pairs.
- Keys match `[a-z_][a-z0-9_.]*`.
- Keys max 64 chars.
- Values max 256 chars.
- Ingestion rejects metrics with malformed tag keys.

#### Histogram

The SDK may send a histogram object to the ingestion gateway. Ingestion explodes it into multiple rows before writing to ClickHouse. `summary` type is not supported in Phase 2.

SDK histogram payload handled by ingestion:

```json
{
  "name": "http.request.duration",
  "type": "histogram",
  "unit": "ms",
  "buckets": [
    { "upper_bound": 50, "count": 10 },
    { "upper_bound": 100, "count": 25 },
    { "upper_bound": 250, "count": 45 },
    { "upper_bound": 500, "count": 47 }
  ],
  "count": 47,
  "sum": 4230.5
}
```

Rows written by ingestion:

| Row | `name` | `type` | `value` | `tags` |
|---|---|---|---|---|
| Bucket `<= 50` | `http.request.duration` | `histogram` | `10` | merged event tags plus `"le": "50"` |
| Bucket `<= 100` | `http.request.duration` | `histogram` | `25` | merged event tags plus `"le": "100"` |
| Bucket `<= 250` | `http.request.duration` | `histogram` | `45` | merged event tags plus `"le": "250"` |
| Bucket `<= 500` | `http.request.duration` | `histogram` | `47` | merged event tags plus `"le": "500"` |
| Count | `http.request.duration_count` | `counter` | `47` | merged event tags only |
| Sum | `http.request.duration_sum` | `counter` | `4230.5` | merged event tags only |

Rules:

- All histogram rows share the same `service_name`, `environment`, `host`, `version`, `timestamp`, and `unit` as the parent event.
- The `le` tag value is the string representation of `upper_bound`.
- There is no `+Inf` row.
- The count row replaces `+Inf`.

### 5.4 Log Event Schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `log_id` | string | yes | ULID generated by ingestion |
| `service_name` | string | yes | From 5.1 |
| `environment` | string | yes | From 5.1 |
| `host` | string | yes | `""` if absent |
| `version` | string | yes | `""` if absent |
| `timestamp` | int64 | yes | Unix nanoseconds |
| `severity_number` | int32 | yes | `0` if unknown |
| `severity_text` | string | yes | Uppercased original string, `""` if absent |
| `message` | string | yes | Max 65536 bytes |
| `trace_id` | string | no | 32 lowercase hex chars, `""` if absent |
| `span_id` | string | no | 16 lowercase hex chars, `""` if absent |
| `attributes` | object | yes | `Map<string,string>`, `{}` if no attributes, max 50 pairs |

Rules:

- Ingestion generates one ULID per log record before forwarding.
- `message` is truncated with `[truncated]` suffix if it exceeds 65536 bytes.
- `trace_id` and `span_id` must be valid hex strings when present.
- Missing `trace_id` or `span_id` is stored as `""`.
- Attribute values are stored as strings. Ingestion converts non-string values to string representation before forwarding.

Severity mapping:

| Incoming string (case-insensitive) | `severity_number` | `severity_text` |
|---|---|---|
| `TRACE`, `trace`, `TRC` | `1` | `TRACE` |
| `DEBUG`, `debug`, `DBG` | `5` | `DEBUG` |
| `INFO`, `info`, `INFORMATION` | `9` | `INFO` |
| `WARN`, `warn`, `WARNING` | `13` | `WARN` |
| `ERROR`, `error`, `ERR` | `17` | `ERROR` |
| `FATAL`, `fatal`, `CRITICAL`, `CRIT` | `21` | `FATAL` |
| anything else | `0` | original string, uppercased |

### 5.5 Trace Span Schema

One row per span. Ingestion accepts individual spans, not assembled traces.

| Field | Type | Required | Notes |
|---|---|---|---|
| `service_name` | string | yes | From 5.1 |
| `environment` | string | yes | From 5.1 |
| `host` | string | yes | `""` if absent |
| `version` | string | yes | `""` if absent |
| `trace_id` | string | yes | 32 lowercase hex chars |
| `span_id` | string | yes | 16 lowercase hex chars |
| `parent_span_id` | string | yes | 16 lowercase hex chars, `""` for root span |
| `name` | string | yes | Operation name |
| `kind` | string | yes | `"internal"`, `"server"`, `"client"`, `"producer"`, or `"consumer"` |
| `start_time` | int64 | yes | Unix nanoseconds |
| `end_time` | int64 | yes | Unix nanoseconds, must be `>= start_time` |
| `duration_ns` | int64 | yes | Computed by ingestion |
| `status` | string | yes | `"ok"`, `"error"`, or `"unset"` |
| `status_message` | string | yes | `""` if absent |
| `attributes` | object | yes | `Map<string,string>`, `{}` if no attributes, max 128 pairs |

Rules:

- Ingestion computes `duration_ns = end_time - start_time`.
- If the SDK sends `duration_ms`, ingestion converts `duration_ns = duration_ms * 1_000_000`.
- `duration_ms` is not forwarded to storage.
- `parent_span_id == ""` identifies a root span.
- Ingestion rejects spans where `end_time < start_time`.
- Validation failures are partial-batch rejections for the affected span.

Status mapping:

- `STATUS_CODE_OK` -> `ok`
- `STATUS_CODE_ERROR` -> `error`
- `STATUS_CODE_UNSET` or absent -> `unset`

### 5.6 Ingestion External API

Base path: `/v1`  
Auth: `X-Api-Key: <key>` on all requests. Missing or invalid key returns `401`.  
Config: one deployment-wide API key via `INGESTION_API_KEY`  
Content-Type: `application/json`

Endpoints:

| Method | Path | Request body | Success response |
|---|---|---|---|
| `POST` | `/v1/metrics` | `{ "metrics": [MetricEvent, ...] }` | `202` |
| `POST` | `/v1/logs` | `{ "logs": [LogEvent, ...] }` | `202` |
| `POST` | `/v1/traces` | `{ "spans": [SpanEvent, ...] }` | `202` |

Acknowledgment semantics:

- `202` means the payload has been received and accepted for forwarding.
- `202` does not mean the data has already been written to ClickHouse.
- If ClickHouse is unavailable, ingestion buffers in memory up to 10,000 rows, drops oldest on overflow, and continues attempting to flush.
- Callers must implement retry with exponential backoff on `503`.

Partial batch behavior:

- Valid events in a request are processed even if some events are rejected.
- The response body describes which events were rejected.

Success response body:

```json
{ "accepted": 9, "rejected": 1 }
```

Validation error response body:

```json
{
  "accepted": 8,
  "rejected": 2,
  "errors": [
    { "index": 2, "field": "service_name", "reason": "required field is empty" },
    { "index": 7, "field": "end_time", "reason": "end_time < start_time" }
  ]
}
```

`index` is the zero-based position of the event in the submitted array.

Timestamp conversion responsibility:

- The ingestion gateway converts SDK-submitted millisecond timestamps to nanoseconds before forwarding to ClickHouse.
- The ingestion-to-storage boundary always uses nanoseconds.

---

## 6. Validation

- [ ] Confirm every ingestion field name, type, and rejection rule matches `INTERFACES.md`.
- [ ] Confirm the document does not reintroduce a storage write API, nested identity fields at the storage boundary, unsupported `summary` metrics, or ingestion-owned `trace_index` behavior.
- [ ] Confirm the external API section matches the `/v1` routes, auth header, partial-batch semantics, and response bodies in `INTERFACES.md`.

---

## 7. Open Issues

- None in the ingestion design doc after alignment to `INTERFACES.md` and the ingestion findings in `docs/review-alignment.md`.
