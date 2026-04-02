# Ingestion Subsystem Design

**Agent:** Ingestion  
**Stage:** Shared parallel design  
**Status:** Updated to conform to `INTERFACES.md`

---

## 1. Objective

Define the ingestion subsystem that accepts metrics, logs, and spans from SDKs and agents, normalizes them to the canonical contracts in `INTERFACES.md`, validates each event, and writes accepted rows to ClickHouse.

---

## 2. Plan

1. Accept batched telemetry on the `/v1` ingestion API.
2. Normalize OTel resource attributes into the canonical flat identity fields.
3. Validate per-signal schemas and compute derived fields required at the ingestion to storage boundary.
4. Buffer accepted rows and flush them to ClickHouse over HTTP using `FORMAT JSONEachRow`.
5. Return partial-batch acceptance results to callers.

---

## 3. Files to Change

- `docs/ingestion-design.md`
- `tasks/ingestion.md`

---

## 4. Assumptions

- `INTERFACES.md` is the source of truth for every ingestion-facing and ingestion-to-storage contract.
- Phase 2 uses one ingestion gateway with HTTP JSON endpoints under `/v1`.
- SDKs may submit timestamps in milliseconds, but the ingestion to storage boundary is always Unix nanoseconds as `int64`.
- Ingestion writes directly to ClickHouse. There is no storage-owned write API.
- Authentication is one deployment-wide API key provided by `INGESTION_API_KEY`.

---

## 5. Contract Alignment Summary

The ingestion subsystem owns the following normalization and forwarding behavior:

- Flatten identity fields to top-level `service_name`, `environment`, `host`, and `version` before writing.
- Reject events where `service_name` or `environment` is absent or empty after normalization.
- Default missing optional identity fields to `""`, never `null`.
- Convert accepted timestamps to Unix nanoseconds before ClickHouse insertion.
- Expand histogram inputs into per-bucket metric rows plus `_count` and `_sum` rows.
- Generate `log_id` values for logs and compute `duration_ns` for spans.
- Write only the canonical metric, log, and span row shapes defined in `INTERFACES.md`.

Ingestion does not own:

- `trace_index` population
- storage query responses
- frontend-specific response shaping
- redesign of any storage, frontend, or alerts subsystem

---

## 6. Canonical Identity Normalization

SDKs may submit OTel-style resource attributes. Ingestion maps those attributes to canonical flat fields before validation and forwarding.

| OTel resource attribute | Canonical field | Rule |
|---|---|---|
| `service.name` | `service_name` | required, non-empty |
| `deployment.environment` | `environment` | required, non-empty |
| `host.name` | `host` | defaults to `""` |
| `service.version` | `version` | defaults to `""` |

Rules:

- Canonical identity fields are top-level on every forwarded metric row, log row, and span row.
- Any resource attribute not listed above is discarded from the resource block.
- Signal-level tags or attributes are preserved subject to each signal's limits.
- `host` and `version` are always strings and never `null`.

Example normalized identity:

```json
{
  "service_name": "api-server",
  "environment": "production",
  "host": "worker-1",
  "version": "v1.2.3"
}
```

---

## 7. External API

Base path: `/v1`  
Auth: `X-Api-Key: <key>`  
Content-Type: `application/json`

### 7.1 Endpoints

| Method | Path | Request body | Success |
|---|---|---|---|
| `POST` | `/v1/metrics` | `{ "metrics": [MetricEvent, ...] }` | `202` |
| `POST` | `/v1/logs` | `{ "logs": [LogEvent, ...] }` | `202` |
| `POST` | `/v1/traces` | `{ "spans": [SpanEvent, ...] }` | `202` |

### 7.2 Request and Response Semantics

- Missing or invalid API key returns `401`.
- `202` means the batch was accepted for forwarding, not that ClickHouse has already persisted it.
- Partial batch acceptance is required. Valid events proceed even when some events are rejected.
- Success body:

```json
{ "accepted": 9, "rejected": 1 }
```

- Validation error body:

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

- `index` is the zero-based position inside the submitted array.
- When ClickHouse is unavailable, ingestion buffers accepted rows in memory up to 10,000 rows and drops oldest rows on overflow.
- Callers are expected to retry on `503` with exponential backoff.

### 7.3 Timestamp Handling

- SDKs may submit timestamps in milliseconds.
- Ingestion converts accepted timestamps to Unix nanoseconds before buffering or writing.
- The ClickHouse write path only sees nanosecond timestamps.

---

## 8. Signal Schemas and Processing

### 8.1 Metrics

#### Gauge and Counter Rows

Accepted metric rows written to ClickHouse follow the canonical schema below:

| Field | Type | Required | Notes |
|---|---|---|---|
| `service_name` | string | yes | canonical identity |
| `environment` | string | yes | canonical identity |
| `host` | string | yes | `""` if absent |
| `version` | string | yes | `""` if absent |
| `timestamp` | int64 | yes | Unix nanoseconds |
| `name` | string | yes | dot-namespaced |
| `type` | string | yes | `gauge` or `counter` |
| `unit` | string | yes | `""` if absent |
| `value` | float64 | yes | counter must be `>= 0` |
| `tags` | object | yes | `Map<string,string>`; `{}` when absent |

Metric validation rules:

- At most 20 tag pairs.
- Tag keys match `[a-z_][a-z0-9_.]*` and are at most 64 chars.
- Tag values are at most 256 chars.
- Malformed tag keys reject the metric event.
- `summary` metrics are not accepted in Phase 2.

#### Histogram Expansion

SDKs may submit histogram events. Ingestion does not forward histogram objects directly. It expands them into multiple metric rows before writing:

Input shape handled by ingestion:

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

Rows emitted by ingestion:

| Row | `name` | `type` | `value` | Tag change |
|---|---|---|---|---|
| bucket | `http.request.duration` | `histogram` | bucket count | add `le=<upper_bound>` |
| count | `http.request.duration_count` | `counter` | `count` | no `le` tag |
| sum | `http.request.duration_sum` | `counter` | `sum` | no `le` tag |

Rules:

- Bucket rows inherit the parent identity fields, timestamp, and unit.
- `le` is the string form of `upper_bound`.
- There is no `+Inf` bucket row.
- The `_count` row replaces the `+Inf` convention.

### 8.2 Logs

Accepted log rows written to ClickHouse use the canonical schema below:

| Field | Type | Required | Notes |
|---|---|---|---|
| `log_id` | string | yes | ULID generated by ingestion |
| `service_name` | string | yes | canonical identity |
| `environment` | string | yes | canonical identity |
| `host` | string | yes | `""` if absent |
| `version` | string | yes | `""` if absent |
| `timestamp` | int64 | yes | Unix nanoseconds |
| `severity_number` | int32 | yes | `0` if unknown |
| `severity_text` | string | yes | uppercase; `""` if absent |
| `message` | string | yes | max 65536 bytes |
| `trace_id` | string | yes | `""` if absent |
| `span_id` | string | yes | `""` if absent |
| `attributes` | object | yes | `Map<string,string>` |

Log processing rules:

- `log_id` is a 26-character uppercase ULID generated per accepted log record.
- `message` longer than 65536 bytes is truncated and suffixed with `[truncated]`.
- `trace_id` must be 32 lowercase hex chars when present; otherwise reject the log.
- `span_id` must be 16 lowercase hex chars when present; otherwise reject the log.
- Missing `trace_id` or `span_id` is stored as `""`.
- Non-string attribute values are stringified before forwarding.
- At most 50 attribute pairs are stored.

Severity normalization:

| Incoming string | `severity_number` | `severity_text` |
|---|---|---|
| `TRACE`, `TRC` | `1` | `TRACE` |
| `DEBUG`, `DBG` | `5` | `DEBUG` |
| `INFO`, `INFORMATION` | `9` | `INFO` |
| `WARN`, `WARNING` | `13` | `WARN` |
| `ERROR`, `ERR` | `17` | `ERROR` |
| `FATAL`, `CRITICAL`, `CRIT` | `21` | `FATAL` |
| anything else | `0` | uppercase original |

### 8.3 Traces

Accepted span rows written to ClickHouse use the canonical schema below:

| Field | Type | Required | Notes |
|---|---|---|---|
| `service_name` | string | yes | canonical identity |
| `environment` | string | yes | canonical identity |
| `host` | string | yes | `""` if absent |
| `version` | string | yes | `""` if absent |
| `trace_id` | string | yes | 32 lowercase hex chars |
| `span_id` | string | yes | 16 lowercase hex chars |
| `parent_span_id` | string | yes | `""` on root spans |
| `name` | string | yes | operation name |
| `kind` | string | yes | `internal`, `server`, `client`, `producer`, `consumer` |
| `start_time` | int64 | yes | Unix nanoseconds |
| `end_time` | int64 | yes | Unix nanoseconds |
| `duration_ns` | int64 | yes | computed by ingestion |
| `status` | string | yes | `ok`, `error`, `unset` |
| `status_message` | string | yes | `""` if absent |
| `attributes` | object | yes | `Map<string,string>` |

Trace processing rules:

- Ingestion accepts individual spans, not assembled traces.
- If the SDK supplies `duration_ms`, ingestion converts it to `duration_ns = duration_ms * 1_000_000`.
- Otherwise ingestion computes `duration_ns = end_time - start_time`.
- `end_time < start_time` rejects that span while other batch items continue.
- `parent_span_id == ""` identifies a root span at the storage boundary.
- Ingestion does not populate `trace_index`.
- At most 128 attribute pairs are stored and all values are stringified.

Status normalization:

| Incoming code | Stored `status` |
|---|---|
| `STATUS_CODE_OK` | `ok` |
| `STATUS_CODE_ERROR` | `error` |
| `STATUS_CODE_UNSET` or absent | `unset` |

Fields intentionally not forwarded by ingestion in Phase 2:

- trace `events`
- trace `links`
- any redundant `duration_ms` field
- nested `status` objects after normalization

---

## 9. Write Path to ClickHouse

Ingestion writes directly to ClickHouse over HTTP using `INSERT ... FORMAT JSONEachRow`.

```text
SDK/Agent -> Ingestion Gateway -> In-memory Buffer -> ClickHouse HTTP
```

### 9.1 Connection Configuration

| Variable | Description |
|---|---|
| `CLICKHOUSE_HOST` | ClickHouse hostname |
| `CLICKHOUSE_PORT` | ClickHouse HTTP port, default `8123` |
| `CLICKHOUSE_DATABASE` | target database |
| `CLICKHOUSE_USER` | username |
| `CLICKHOUSE_PASSWORD` | password |

### 9.2 Flush Policy

- Flush in batches of 1000 rows or every 500ms, whichever comes first.
- Do not issue single-row inserts.
- Buffering is in memory only in Phase 2.
- Accepted rows remain eligible for retry until flushed or evicted by overflow.

### 9.3 ClickHouse Ownership Boundary

- Ingestion owns the HTTP write client and row serialization.
- Storage owns the ClickHouse table schemas and materialized views.
- `trace_index` is populated by storage-owned materialized view logic, not by ingestion.

---

## 10. Validation Behavior

| Condition | Response |
|---|---|
| valid batch with all events accepted | `202` with accepted/rejected counts |
| valid batch with partial rejects | `202` with `errors[]` describing rejected items |
| malformed JSON | `400` |
| missing `Content-Type: application/json` | `400` |
| missing or invalid API key | `401` |
| empty `metrics`, `logs`, or `spans` array | `400` |
| required identity field empty after normalization | item rejected |
| malformed tag or attribute constraints violated | item rejected |
| ClickHouse unavailable and buffer can still accept rows | `202` for accepted items |
| ClickHouse unavailable and buffer cannot accept rows | `503` |

Operational rules:

- Ingestion does not silently drop rejected validation failures.
- Validation failures are reported per event index.
- Partial-batch rejection is the default behavior for signal validation.

---

## 11. Ingestion-Owned Components

```text
ingestion/
├── cmd/
│   └── server/
│       └── main.go
├── internal/
│   ├── gateway/
│   │   ├── server.go
│   │   ├── handlers.go
│   │   └── middleware.go
│   ├── intake/
│   │   ├── metrics/
│   │   │   ├── parser.go
│   │   │   ├── normalizer.go
│   │   │   └── validator.go
│   │   ├── logs/
│   │   │   ├── parser.go
│   │   │   ├── normalizer.go
│   │   │   └── validator.go
│   │   └── traces/
│   │       ├── parser.go
│   │       ├── normalizer.go
│   │       └── validator.go
│   ├── identity/
│   │   └── normalizer.go
│   ├── buffer/
│   │   └── queue.go
│   ├── clickhouse/
│   │   ├── client.go
│   │   └── writer.go
│   └── pipeline/
│       └── pipeline.go
└── config/
    └── config.go
```

Component responsibilities:

| Component | Responsibility |
|---|---|
| gateway | auth, routing, request/response semantics |
| signal parsers | decode batches and extract SDK fields |
| identity normalizer | map OTel resource attributes to canonical flat fields |
| validators | enforce per-signal constraints and produce indexed errors |
| buffer | shared in-memory queue with 10,000-row cap |
| clickhouse client | batch inserts with `JSONEachRow` |
| pipeline | accepted event flow from HTTP handler to buffered writer |

---

## 12. Validation

- [ ] Review edited design against `INTERFACES.md` sections 1-6 for field names, timestamp units, auth, and response semantics.
- [ ] Verify the design no longer references storage write APIs, nested `resource` payload requirements at the storage boundary, `summary` metrics, trace `events`, or trace `links`.
- [ ] Validate the implementation plan includes at least:
  - parser and validator unit tests for all three signal types
  - histogram expansion tests
  - timestamp conversion tests
  - ClickHouse batch writer tests for flush size and interval
- [ ] End-to-end test: Node.js OTel emitter -> ingestion gateway -> ClickHouse rows written in canonical schema.

---

## 13. Open Issues

- SDK request examples beyond the canonical field contracts are still intentionally minimal here. If we add richer OTLP compatibility docs later, they must remain adapters into the canonical schemas above.
- Phase 2 buffering is memory-only. If durability during prolonged ClickHouse outages becomes required, that is a future ingestion enhancement and not a contract change.
- OTLP/gRPC support is still out of scope for Phase 2. Adding it later must preserve the same normalized write shapes and validation rules.
