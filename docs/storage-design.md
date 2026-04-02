# Storage Design

## 1. Objective

Define the storage-owned schema, indexing, retention, and query API design for metrics, logs, and traces so it conforms exactly to `INTERFACES.md`.

---

## 2. Plan

1. Use `INTERFACES.md` as the source of truth for all storage-facing contracts.
2. Define ClickHouse tables and materialized views with canonical field names and nanosecond storage semantics.
3. Define the storage query API surface exactly as consumed by frontend and alerts.
4. Keep scope limited to storage-owned schemas, indexes, retention, and query behavior.

---

## 3. Files to Change

- `docs/storage-design.md`
- `tasks/storage.md`

---

## 4. Assumptions

- Phase 2 storage is a single-node ClickHouse deployment plus PostgreSQL for non-timeseries metadata.
- Ingestion writes directly to ClickHouse over HTTP using `FORMAT JSONEachRow`; storage does not own an intermediate write API.
- `INTERFACES.md` is authoritative for field names, request parameters, response bodies, and retention policy.
- Query responses expose ISO 8601 timestamps with millisecond precision even though ClickHouse stores nanosecond timestamps internally.
- Service summary endpoints may read alert state written by alerts into PostgreSQL, but storage does not redesign alerts ownership or schemas here.

---

## 5. Implementation

### 5.1 Storage Engine Selection

| Signal | Engine | Rationale |
|---|---|---|
| Metrics | ClickHouse | Columnar scans and rollups fit range aggregation workloads. |
| Logs | ClickHouse | Append-heavy workload with time filtering, search, and retention TTLs. |
| Traces | ClickHouse | Span storage, trace reconstruction, and trace summary materialization fit one analytical store. |
| Metadata | PostgreSQL | Alert state and future service metadata remain relational, not timeseries. |

The storage subsystem owns ClickHouse schemas, materialized views, query execution, and retention enforcement. Ingestion owns write batching and event normalization before rows reach ClickHouse.

### 5.2 Canonical Identity and Time Model

Storage stores the canonical top-level identity fields from `INTERFACES.md` on every signal table:

| Field | ClickHouse type | Notes |
|---|---|---|
| `service_name` | `LowCardinality(String)` | Required, non-empty at ingestion boundary |
| `environment` | `LowCardinality(String)` | Required, non-empty at ingestion boundary |
| `host` | `LowCardinality(String)` | Required in storage rows; `""` when absent |
| `version` | `LowCardinality(String)` | Required in storage rows; `""` when absent |

All event times are stored as `DateTime64(9, 'UTC')` in ClickHouse after ingestion converts nanosecond wire values into the table column type. Query responses convert these values to ISO 8601 strings with millisecond precision.

### 5.3 Metrics Storage Schema

Metrics use canonical field names from `INTERFACES.md`: `name`, `type`, `unit`, `value`, and `tags`. Histogram points are stored as exploded bucket rows with the same schema as other metrics; bucket identity remains in `tags` (for example `le=0.5`).

```sql
CREATE TABLE metrics
(
    timestamp        DateTime64(9, 'UTC'),
    service_name     LowCardinality(String),
    environment      LowCardinality(String),
    host             LowCardinality(String),
    version          LowCardinality(String),
    name             LowCardinality(String),
    type             LowCardinality(String),
    unit             LowCardinality(String),
    value            Float64,
    tags             Map(String, String)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (service_name, environment, name, timestamp)
TTL toDateTime(timestamp) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192;
```

Storage assumes ingestion already enforced the interface-level validation rules before rows reach ClickHouse. Query planning relies on these invariants:

- `type` is one of `gauge`, `counter`, or `histogram`.
- `tags` stores exact string pairs only; query filters are exact-match filters on tag values.
- `name` is the canonical metric name also used by `/api/v1/metrics/query` and `/api/v1/metrics/names`.

#### Rollup Tables

Storage owns two rollup tiers required by `INTERFACES.md` retention:

```sql
CREATE TABLE metrics_1m
(
    timestamp        DateTime64(0, 'UTC'),
    service_name     LowCardinality(String),
    environment      LowCardinality(String),
    host             LowCardinality(String),
    version          LowCardinality(String),
    name             LowCardinality(String),
    type             LowCardinality(String),
    unit             LowCardinality(String),
    tags             Map(String, String),
    count            UInt64,
    sum_value        Float64,
    min_value        Float64,
    max_value        Float64,
    avg_value        Float64,
    p50_value        Float64,
    p95_value        Float64,
    p99_value        Float64
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (service_name, environment, name, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;

CREATE TABLE metrics_1h
(
    timestamp        DateTime64(0, 'UTC'),
    service_name     LowCardinality(String),
    environment      LowCardinality(String),
    host             LowCardinality(String),
    version          LowCardinality(String),
    name             LowCardinality(String),
    type             LowCardinality(String),
    unit             LowCardinality(String),
    tags             Map(String, String),
    count            UInt64,
    sum_value        Float64,
    min_value        Float64,
    max_value        Float64,
    avg_value        Float64,
    p50_value        Float64,
    p95_value        Float64,
    p99_value        Float64
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (service_name, environment, name, timestamp)
TTL toDateTime(timestamp) + INTERVAL 365 DAY
SETTINGS index_granularity = 8192;
```

Materialized views populate these rollups from `metrics`. Storage selects raw data, `metrics_1m`, or `metrics_1h` based on the canonical `step` auto-selection rules in `INTERFACES.md`.

### 5.4 Logs Storage Schema

Logs store the canonical schema including `log_id`, `severity_number`, `severity_text`, and optional trace correlation fields.

```sql
CREATE TABLE logs
(
    timestamp         DateTime64(9, 'UTC'),
    log_id            String,
    service_name      LowCardinality(String),
    environment       LowCardinality(String),
    host              LowCardinality(String),
    version           LowCardinality(String),
    severity_number   Int32,
    severity_text     LowCardinality(String),
    message           String,
    trace_id          String,
    span_id           String,
    attributes        Map(String, String)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (service_name, environment, timestamp, log_id)
TTL toDateTime(timestamp) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192;
```

Indexes for common query paths:

```sql
ALTER TABLE logs
    ADD INDEX idx_logs_trace_id trace_id TYPE bloom_filter(0.01) GRANULARITY 1;

ALTER TABLE logs
    ADD INDEX idx_logs_message message TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4;
```

Storage treats `log_id` as an opaque stable identifier generated upstream. The query API exposes it unchanged.

### 5.5 Spans and Trace Index Schema

Spans store canonical fields from `INTERFACES.md`. Root detection remains `parent_span_id == ""` in storage rows. Query responses convert the root `parent_span_id` to `null` for trace detail responses.

```sql
CREATE TABLE spans
(
    trace_id          String,
    span_id           String,
    parent_span_id    String,
    service_name      LowCardinality(String),
    environment       LowCardinality(String),
    host              LowCardinality(String),
    version           LowCardinality(String),
    name              String,
    kind              LowCardinality(String),
    start_time        DateTime64(9, 'UTC'),
    end_time          DateTime64(9, 'UTC'),
    duration_ns       Int64,
    status            LowCardinality(String),
    status_message    String,
    attributes        Map(String, String)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(start_time)
ORDER BY (service_name, environment, start_time, trace_id, span_id)
TTL toDateTime(start_time) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192;
```

Trace list queries use a storage-owned materialized trace summary:

```sql
CREATE TABLE trace_index
(
    trace_id            String,
    root_service_name   LowCardinality(String),
    root_name           String,
    start_time          DateTime64(9, 'UTC'),
    duration_ns         Int64,
    span_count          UInt32,
    status              LowCardinality(String),
    environment         LowCardinality(String)
)
ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMMDD(start_time)
ORDER BY (root_service_name, environment, start_time, trace_id)
TTL toDateTime(start_time) + INTERVAL 30 DAY;
```

`trace_index` is populated by a materialized view over `spans`, not by ingestion code. The materialized view derives:

- `root_service_name` and `root_name` from the root span.
- `duration_ns` as the full trace duration.
- `span_count` as total spans in the trace.
- `status` as `error` when any span in the trace has `status = 'error'`, otherwise `ok`.

Indexes for trace reconstruction:

```sql
ALTER TABLE spans
    ADD INDEX idx_spans_trace_id trace_id TYPE bloom_filter(0.01) GRANULARITY 1;

ALTER TABLE spans
    ADD INDEX idx_spans_name name TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4;
```

### 5.6 Query API Design

Storage owns the `/api/v1` query API. The storage design must match `INTERFACES.md` exactly for paths, parameter names, response field names, pagination, and status values.

#### Shared conventions

- Auth uses `X-Api-Key` and shares the same deployment key as ingestion.
- Time range params are `start` and `end`, both required where defined.
- Time range semantics are `[start, end)`.
- Response timestamps are ISO 8601 strings with millisecond precision.
- Pagination is cursor-based with `next_cursor`; offset pagination is not supported.
- Error responses use `{ "error": "...", "code": "bad_request" }`.

#### `GET /api/v1/metrics/query`

Storage accepts only the canonical parameters:

| Parameter | Required | Notes |
|---|---|---|
| `start` | yes | ISO 8601 |
| `end` | yes | ISO 8601 |
| `name` | yes | Metric name |
| `environment` | no | Exact filter |
| `service_name` | no | Exact filter |
| `step` | no | `1m`, `5m`, `15m`, `1h`, `6h`, `1d`, or omitted for auto |
| `agg` | no | `avg`, `min`, `max`, `sum`, `count`, `p50`, `p95`, `p99` |
| `group_by` | no | Comma-separated tag keys |
| `filter[<key>]` | no | Exact tag filter |

Response shape:

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
        { "timestamp": "2026-04-02T09:00:00Z", "value": 143.2 }
      ]
    }
  ]
}
```

Behavior rules:

- When `group_by` is omitted, `labels` contains only supplied filter dimensions.
- When grouped series exceed the server cap of 100, storage sets `truncated: true`.
- Step selection follows the `INTERFACES.md` ranges: raw for up to 3 hours, `1m` for 3 hours to 48 hours, `1h` for 48 hours to 2 weeks, and `1d` beyond 2 weeks.

#### `GET /api/v1/metrics/names`

Supported params: `environment`, `service_name`.

Response:

```json
{ "names": ["http.request.duration", "http.request.count"] }
```

#### `GET /api/v1/logs`

Supported params: `start`, `end`, `environment`, `service_name`, `severity_min`, `search`, `trace_id`, `limit`, `cursor`, `count_only`.

Response shape:

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
  "next_cursor": null,
  "total_matched": 1204,
  "truncated": false
}
```

When `count_only=true`, storage returns:

```json
{ "count": 1204, "truncated": false }
```

#### `GET /api/v1/logs/volume`

Supported params: `start`, `end`, `environment`, `service_name`, `step`.

Response:

```json
{
  "step": "5m",
  "buckets": [
    {
      "timestamp": "2026-04-02T09:00:00Z",
      "count": 412,
      "by_severity": {
        "INFO": 380,
        "ERROR": 20
      }
    }
  ]
}
```

#### `GET /api/v1/traces`

Supported params: `start`, `end`, `environment`, `service_name`, `status`, `min_duration_ms`, `trace_id`, `limit`, `cursor`.

Response:

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

#### `GET /api/v1/traces/:trace_id`

Storage returns all spans for the trace sorted by ascending `start_time`. Root span `parent_span_id` is rendered as `null` in this response only.

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
      "attributes": { "http.method": "POST" }
    }
  ]
}
```

#### `GET /api/v1/services`

Storage computes this from telemetry in the requested time range, not from static PostgreSQL metadata.

Supported params: `start`, `end`, `environment`.

Response:

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

#### `GET /api/v1/services/:service_name/summary`

Supported params: `start`, `end`, `environment`.

Response:

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

`active_alert_count` is read from alert monitor state in PostgreSQL and counts monitors in `alerting` or `no_data` scoped to the service and optional environment.

#### `GET /api/v1/environments`

Response:

```json
{ "environments": ["production", "staging", "dev"] }
```

### 5.7 Indexing and Query Strategy

| Table | Partition key | Sort key | Query path served |
|---|---|---|---|
| `metrics` | `toYYYYMMDD(timestamp)` | `(service_name, environment, name, timestamp)` | raw metric time windows |
| `metrics_1m` | `toYYYYMMDD(timestamp)` | `(service_name, environment, name, timestamp)` | metric queries with `1m` step |
| `metrics_1h` | `toYYYYMMDD(timestamp)` | `(service_name, environment, name, timestamp)` | metric queries with `1h` and `1d` step |
| `logs` | `toYYYYMMDD(timestamp)` | `(service_name, environment, timestamp, log_id)` | log search and volume |
| `spans` | `toYYYYMMDD(start_time)` | `(service_name, environment, start_time, trace_id, span_id)` | trace detail and trace-derived summaries |
| `trace_index` | `toYYYYMMDD(start_time)` | `(root_service_name, environment, start_time, trace_id)` | trace list |

Design notes:

- All time-range endpoints require `start` and `end` to guarantee partition pruning.
- Log cursors should encode the last `(timestamp, log_id)` pair to keep pagination stable.
- Trace cursors should encode the last `(start_time, trace_id)` pair.
- `services` and `service summary` queries should be assembled from signal-specific aggregates, not from a static service registry.

### 5.8 Retention Policy

Storage enforces the canonical retention policy from `INTERFACES.md`:

| Signal | Retention |
|---|---|
| Raw metrics | 30 days |
| Metrics 1-minute rollup | 90 days |
| Metrics 1-hour rollup | 1 year |
| Logs | 30 days |
| Spans | 30 days |
| Trace index | 30 days |
| PostgreSQL metadata | Indefinite |

Query behavior beyond retention:

- If a query falls fully outside retention, storage returns an empty result and no error.
- If a query overlaps the retention boundary, storage returns only retained data.
- Storage does not enforce alert window limits; alerts validates those at monitor creation time.

### 5.9 Storage-Owned Contract Notes

The storage design depends on these interface decisions already resolved in `INTERFACES.md`:

- Canonical identity fields are `service_name`, `environment`, `host`, and `version`.
- Metric query responses are grouped as `series[].labels[].points[]`.
- Trace list and trace detail use `root_service_name`, `root_name`, `duration_ns`, and lowercase `status`.
- `trace_index` is a storage-owned materialized view concern.

---

## 6. Validation

- [x] Rewrote storage-owned schema and API design to use canonical field names from `INTERFACES.md`.
- [x] Removed retired field names, schemas, and endpoint assumptions from this storage design.
- [x] Aligned retention, trace index ownership, and grouped metric response shape with `INTERFACES.md`.
- [ ] DDL execution against a local ClickHouse instance remains future implementation validation; this repo does not include runnable storage code yet.

---

## 7. Open Issues

- Storage implementation code does not exist in this repo yet, so DDL execution and handler tests remain Phase 2 follow-up work.
- `INTERFACES.md` requires `log_id` in storage responses; generation is assumed upstream and should remain consistent once ingestion is implemented.
