# Storage Design

## 1. Objective

Design the storage and query subsystem for an observability platform supporting metrics, logs, and traces. Define schemas, indexing strategy, retention policy, and the API contracts that ingestion must satisfy and that frontend/alerts may consume.

---

## 2. Plan

1. Select storage engines for each signal type
2. Define schemas for metrics, logs, and traces
3. Define indexing and partitioning strategy
4. Define retention assumptions
5. Define query API contracts (inbound from ingestion, outbound to frontend/alerts)
6. Note open issues for cross-agent coordination

---

## 3. Files to Change

- `docs/storage-design.md` (this document)
- `tasks/storage.md` — updated with completion status

---

## 4. Assumptions

- Initial target is a single Dockerized Node.js application; multi-service expansion is expected in Phase 3+.
- Write volume: moderate (tens of thousands of metric points/min, thousands of log lines/min, hundreds of spans/min at start). Schema and partitioning must handle 10x growth without redesign.
- No existing ingestion contracts defined yet — this document proposes the inbound schema contract that ingestion must conform to.
- Query latency target: < 500ms for dashboard time-range queries over 24h windows; < 2s over 7d windows.
- No distributed ClickHouse cluster initially — single-node ClickHouse in Docker is sufficient for Phase 2; cluster mode is a Phase 5 concern.
- Metadata (service catalog, dashboard configs, alert rules) lives in PostgreSQL, not ClickHouse.
- Redis is used for alert state and short-lived query caches only.

---

## 5. Implementation

### 5.1 Storage Engine Selection

| Signal   | Engine              | Rationale                                                                                   |
|----------|---------------------|---------------------------------------------------------------------------------------------|
| Metrics  | ClickHouse          | Columnar, high write throughput, native TTL-based retention, fast range aggregation         |
| Logs     | ClickHouse          | Append-only access pattern, excellent compression, fast filter/search with bloom indexes    |
| Traces   | ClickHouse          | Span-level columnar storage, efficient trace assembly by `trace_id`, avoids extra engines   |
| Metadata | PostgreSQL          | Service registry, dashboard configs, alert rule definitions, user/tenant data               |
| Cache    | Redis               | Alert evaluation state, short-term metric aggregation buffers, query result caching         |

**Rationale for unified ClickHouse:** Running a single ClickHouse instance for all three signal types reduces operational complexity, enables cross-signal JOINs at query time (e.g., correlate a spike in error rate with log lines from the same service and time window), and provides one TTL retention mechanism. ClickHouse's Map column type handles sparse attribute/label payloads efficiently.

---

### 5.2 Identity Fields (Shared Across All Signals)

Every telemetry record must carry the following identity fields. Ingestion is responsible for populating these before writing.

| Field         | Type      | Description                                                  |
|---------------|-----------|--------------------------------------------------------------|
| `service`     | String    | Logical service name (e.g., `api-server`, `worker`)         |
| `env`         | String    | Deployment environment (`production`, `staging`, `dev`)      |
| `host`        | String    | Hostname or container ID of the emitting process             |
| `version`     | String    | Application version or image tag (optional, default `""`)    |
| `timestamp`   | DateTime64(9) | Event time in nanosecond precision UTC                   |

These fields must be top-level columns (not embedded in a Map) so they can participate in primary key / sort key expressions.

---

### 5.3 Metrics Schema

**Table: `metrics`**

```sql
CREATE TABLE metrics
(
    timestamp    DateTime64(9, 'UTC'),
    service      LowCardinality(String),
    env          LowCardinality(String),
    host         LowCardinality(String),
    version      LowCardinality(String),
    metric_name  LowCardinality(String),
    metric_type  Enum8('gauge'=1, 'counter'=2, 'histogram'=3, 'summary'=4),
    value        Float64,
    labels       Map(String, String)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (service, metric_name, timestamp)
TTL toDateTime(timestamp) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192;
```

**Notes:**
- `labels` carries arbitrary key-value pairs (e.g., `{status_code: "200", method: "GET"}`).
- `metric_type` disambiguates gauge vs. counter semantics at query time.
- Histogram/summary raw data: store pre-bucketed values as separate rows with a `le` label key (Prometheus convention). Aggregation happens at query time.
- Sort key `(service, metric_name, timestamp)` optimizes the most common query pattern: fetch one metric for one service over a time range.

**Materialized view for downsampling (1-minute rollups):**

```sql
CREATE MATERIALIZED VIEW metrics_1m
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMMDD(timestamp_bucket)
ORDER BY (service, metric_name, timestamp_bucket)
AS
SELECT
    toStartOfMinute(timestamp)   AS timestamp_bucket,
    service,
    env,
    host,
    metric_name,
    metric_type,
    labels,
    avgState(value)   AS avg_value,
    minState(value)   AS min_value,
    maxState(value)   AS max_value,
    countState()      AS count_value
FROM metrics
GROUP BY timestamp_bucket, service, env, host, metric_name, metric_type, labels;
```

A `metrics_1h` view follows the same pattern. Dashboard queries over > 6h windows use the rollup tables.

---

### 5.4 Logs Schema

**Table: `logs`**

```sql
CREATE TABLE logs
(
    timestamp    DateTime64(9, 'UTC'),
    service      LowCardinality(String),
    env          LowCardinality(String),
    host         LowCardinality(String),
    version      LowCardinality(String),
    severity     Enum8('trace'=1, 'debug'=2, 'info'=3, 'warn'=4, 'error'=5, 'fatal'=6),
    message      String,
    trace_id     FixedString(32),   -- hex-encoded 128-bit trace ID, empty string if absent
    span_id      FixedString(16),   -- hex-encoded 64-bit span ID, empty string if absent
    attributes   Map(String, String)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (service, severity, timestamp)
TTL toDateTime(timestamp) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192;
```

**Indexes for log search:**

```sql
-- Bloom filter on message for fast text contains queries
ALTER TABLE logs ADD INDEX idx_message_bf message TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4;

-- Bloom filter on trace_id for trace-to-log correlation
ALTER TABLE logs ADD INDEX idx_trace_id trace_id TYPE bloom_filter(0.01) GRANULARITY 1;

-- Set index on severity for fast severity filter
ALTER TABLE logs ADD INDEX idx_severity severity TYPE set(8) GRANULARITY 1;
```

**Notes:**
- `trace_id` and `span_id` enable cross-signal correlation: given a trace, find all associated logs.
- `attributes` holds structured fields parsed from the log line (e.g., `{http.method: "POST", http.status: "500"}`).
- Full-text search uses `LIKE` or `hasToken()` leveraging the bloom filter index.

---

### 5.5 Traces Schema

Traces are stored as individual spans. A trace is reconstructed by querying all spans sharing a `trace_id`.

**Table: `spans`**

```sql
CREATE TABLE spans
(
    trace_id        FixedString(32),   -- hex 128-bit
    span_id         FixedString(16),   -- hex 64-bit
    parent_span_id  FixedString(16),   -- empty string for root spans
    timestamp       DateTime64(9, 'UTC'),   -- span start time
    duration_ns     UInt64,
    service         LowCardinality(String),
    env             LowCardinality(String),
    host            LowCardinality(String),
    version         LowCardinality(String),
    operation       String,
    span_kind       Enum8('internal'=0, 'server'=1, 'client'=2, 'producer'=3, 'consumer'=4),
    status_code     Enum8('unset'=0, 'ok'=1, 'error'=2),
    status_message  String,
    attributes      Map(String, String),
    events          String    -- JSON array of {timestamp, name, attributes} — kept as String for flexibility
)
ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (service, timestamp, trace_id)
TTL toDateTime(timestamp) + INTERVAL 30 DAY
SETTINGS index_granularity = 8192;
```

**Table: `trace_index`** — root span summary for fast trace list queries

```sql
CREATE TABLE trace_index
(
    trace_id        FixedString(32),
    root_service    LowCardinality(String),
    root_operation  String,
    start_time      DateTime64(9, 'UTC'),
    duration_ns     UInt64,
    span_count      UInt32,
    error_count     UInt32,
    env             LowCardinality(String)
)
ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMMDD(start_time)
ORDER BY (root_service, start_time, trace_id)
TTL toDateTime(start_time) + INTERVAL 30 DAY;
```

`trace_index` is populated by ingestion (or a ClickHouse materialized view) when the root span arrives. It powers the trace list UI without requiring a full `spans` scan.

**Indexes on spans:**

```sql
ALTER TABLE spans ADD INDEX idx_trace_id trace_id TYPE bloom_filter(0.01) GRANULARITY 1;
ALTER TABLE spans ADD INDEX idx_operation operation TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4;
```

---

### 5.6 PostgreSQL Metadata Schema

These tables live in PostgreSQL and are not time-series.

```sql
-- Service registry
CREATE TABLE services (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    env         TEXT NOT NULL,
    language    TEXT,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Dashboard definitions (stored as JSON blobs)
CREATE TABLE dashboards (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    definition  JSONB NOT NULL,
    created_by  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Alert rule definitions
CREATE TABLE alert_rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    signal_type TEXT NOT NULL CHECK (signal_type IN ('metric', 'log', 'trace')),
    query       JSONB NOT NULL,
    condition   JSONB NOT NULL,
    state       TEXT DEFAULT 'ok',
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 5.7 Indexing and Partitioning Strategy

| Table         | Partition Key              | Sort Key                              | Rationale                                              |
|---------------|----------------------------|---------------------------------------|--------------------------------------------------------|
| `metrics`     | `toYYYYMMDD(timestamp)`    | `(service, metric_name, timestamp)`   | Range queries by service+metric+time are dominant      |
| `metrics_1m`  | `toYYYYMMDD(timestamp_bucket)` | `(service, metric_name, timestamp_bucket)` | Same as raw, lower cardinality              |
| `logs`        | `toYYYYMMDD(timestamp)`    | `(service, severity, timestamp)`      | Most queries filter by service and severity first      |
| `spans`       | `toYYYYMMDD(timestamp)`    | `(service, timestamp, trace_id)`      | Service+time is common; trace_id bloom for single trace|
| `trace_index` | `toYYYYMMDD(start_time)`   | `(root_service, start_time, trace_id)`| Trace list ordered by service and time                 |

**Partition pruning:** All dashboard and alert queries must include a time range predicate. The query API enforces a mandatory `start` / `end` parameter to ensure partition pruning is effective.

---

### 5.8 Retention Policy

Default retention: **30 days** for all raw signal data, enforced via ClickHouse TTL on each table.

| Tier             | Retention  | Table                       |
|------------------|------------|-----------------------------|
| Raw metrics      | 30 days    | `metrics`                   |
| 1-min rollups    | 90 days    | `metrics_1m`                |
| 1-hour rollups   | 1 year     | `metrics_1h`                |
| Raw logs         | 30 days    | `logs`                      |
| Raw spans        | 30 days    | `spans`                     |
| Trace index      | 30 days    | `trace_index`                |
| Metadata         | Indefinite | PostgreSQL tables            |

Retention values are configurable via environment variables at deployment time. Phase 5 may introduce per-service or per-signal retention overrides stored in PostgreSQL.

---

### 5.9 Query API Contract

The query service exposes a REST API over HTTP. All responses are JSON.

#### Base URL

```
/api/v1/
```

#### Authentication

Phase 2: no auth (internal only). Phase 4+: bearer token, validated against PostgreSQL.

---

#### Metrics Endpoints

**`GET /api/v1/metrics/query`** — instant or range query

| Parameter    | Type    | Required | Description                                          |
|--------------|---------|----------|------------------------------------------------------|
| `metric`     | string  | yes      | Metric name                                          |
| `service`    | string  | no       | Filter by service                                    |
| `env`        | string  | no       | Filter by environment                                |
| `labels`     | string  | no       | URL-encoded label selector, e.g. `method=GET,status=200` |
| `start`      | ISO8601 | yes      | Range start (UTC)                                    |
| `end`        | ISO8601 | yes      | Range end (UTC)                                      |
| `step`       | string  | no       | Rollup interval, e.g. `1m`, `5m`, `1h`. Default: auto |
| `aggregate`  | string  | no       | `avg`, `min`, `max`, `sum`, `count`. Default: `avg`  |

**Response:**

```json
{
  "metric": "http.request.duration_ms",
  "service": "api-server",
  "labels": {"method": "GET"},
  "step": "1m",
  "series": [
    { "timestamp": "2024-01-01T00:00:00Z", "value": 42.3 },
    { "timestamp": "2024-01-01T00:01:00Z", "value": 44.1 }
  ]
}
```

**`GET /api/v1/metrics/names`** — list available metric names

| Parameter | Type   | Required | Description          |
|-----------|--------|----------|----------------------|
| `service` | string | no       | Filter by service    |
| `env`     | string | no       | Filter by environment |

**Response:**

```json
{ "metrics": ["http.request.duration_ms", "process.cpu.percent", ...] }
```

**`GET /api/v1/metrics/labels`** — list label keys/values for a metric

| Parameter | Type   | Required | Description       |
|-----------|--------|----------|-------------------|
| `metric`  | string | yes      | Metric name       |
| `key`     | string | no       | Filter to one key |

---

#### Logs Endpoints

**`GET /api/v1/logs/query`** — search logs

| Parameter    | Type    | Required | Description                                              |
|--------------|---------|----------|----------------------------------------------------------|
| `service`    | string  | no       | Filter by service                                        |
| `env`        | string  | no       | Filter by environment                                    |
| `severity`   | string  | no       | Comma-separated: `error,warn`                            |
| `search`     | string  | no       | Full-text search against `message`                       |
| `trace_id`   | string  | no       | Filter logs belonging to a specific trace                |
| `start`      | ISO8601 | yes      | Range start                                              |
| `end`        | ISO8601 | yes      | Range end                                                |
| `limit`      | int     | no       | Max rows returned. Default: 200, max: 1000               |
| `cursor`     | string  | no       | Pagination cursor (opaque, returned in previous response)|

**Response:**

```json
{
  "logs": [
    {
      "timestamp": "2024-01-01T00:00:01.123456789Z",
      "service": "api-server",
      "severity": "error",
      "message": "Unhandled exception in /checkout",
      "trace_id": "abc123...",
      "span_id": "def456...",
      "attributes": { "http.status": "500" }
    }
  ],
  "next_cursor": "eyJ0cyI6IjIwMjQtMDEtMDFUMDA..."
}
```

---

#### Traces Endpoints

**`GET /api/v1/traces/list`** — paginated trace list

| Parameter    | Type    | Required | Description                                    |
|--------------|---------|----------|------------------------------------------------|
| `service`    | string  | no       | Filter by root service                         |
| `env`        | string  | no       | Filter by environment                          |
| `operation`  | string  | no       | Filter by root operation                       |
| `status`     | string  | no       | `ok`, `error`                                  |
| `min_duration_ms` | int | no      | Filter traces slower than this threshold       |
| `start`      | ISO8601 | yes      | Range start                                    |
| `end`        | ISO8601 | yes      | Range end                                      |
| `limit`      | int     | no       | Default: 50, max: 200                          |
| `cursor`     | string  | no       | Pagination cursor                              |

**Response:**

```json
{
  "traces": [
    {
      "trace_id": "abc123...",
      "root_service": "api-server",
      "root_operation": "POST /checkout",
      "start_time": "2024-01-01T00:00:01Z",
      "duration_ms": 312,
      "span_count": 14,
      "error_count": 1
    }
  ],
  "next_cursor": "..."
}
```

**`GET /api/v1/traces/:trace_id`** — full trace (all spans)

**Response:**

```json
{
  "trace_id": "abc123...",
  "spans": [
    {
      "span_id": "def456...",
      "parent_span_id": "",
      "service": "api-server",
      "operation": "POST /checkout",
      "start_time": "2024-01-01T00:00:01Z",
      "duration_ms": 312,
      "status_code": "error",
      "status_message": "timeout",
      "attributes": { "http.method": "POST", "http.status_code": "500" },
      "events": []
    }
  ]
}
```

---

#### Cross-Signal Correlation Endpoints

**`GET /api/v1/correlate/trace`** — given a trace_id, return linked logs and metric context

| Parameter  | Type   | Required | Description   |
|------------|--------|----------|---------------|
| `trace_id` | string | yes      |               |

**Response:**

```json
{
  "trace_id": "abc123...",
  "logs": [ /* same shape as /logs/query rows */ ],
  "metric_context": {
    "service": "api-server",
    "window": { "start": "...", "end": "..." },
    "hint": "Use /metrics/query with the above window and service to retrieve metric series."
  }
}
```

---

#### Services Metadata Endpoint

**`GET /api/v1/services`** — list known services

**Response:**

```json
{
  "services": [
    { "name": "api-server", "env": "production", "language": "nodejs" }
  ]
}
```

---

### 5.10 Contract Requirements for Ingestion

Ingestion must write to ClickHouse in the formats described above. The following rules apply:

1. **Timestamps** must be nanosecond-precision UTC. Sub-millisecond precision is required for trace span ordering.
2. **Identity fields** (`service`, `env`, `host`, `version`) must be populated on every row. Empty string is acceptable for `version`; never null.
3. **trace_id / span_id** in logs must be the hex-encoded W3C TraceContext format (32 hex chars for trace_id, 16 for span_id). Empty string when absent.
4. **metric_type** must be set correctly — ingestion must not default everything to `gauge`.
5. **trace_index** must be populated by ingestion when a root span (empty `parent_span_id`) is written. Ingestion is responsible for detecting root spans and upserting `trace_index` via ReplacingMergeTree semantics.
6. **Batch writes preferred:** ingestion should buffer and write in batches of ≥ 1000 rows or ≤ 500ms flush interval to minimize ClickHouse merge overhead.
7. **No deduplication guarantee:** the storage layer does not deduplicate. Ingestion must not retry individual rows without idempotency controls; prefer at-least-once with acceptable duplicate tolerance.

---

### 5.11 Contract Requirements for Frontend and Alerts

1. **All time-range queries must include `start` and `end`.** The query service will reject requests without these parameters (HTTP 400) to protect partition pruning.
2. **Alert evaluation** must use `GET /api/v1/metrics/query` with a short `step` (e.g., `1m`) and compare the last N data points against thresholds. The query API does not perform threshold evaluation — that logic lives in the alerts subsystem.
3. **Log-based alert patterns:** use `GET /api/v1/logs/query` with a `severity` filter and `limit=1` plus a time window to detect error spikes. Count-based alerting requires the alerts agent to page through results or use a dedicated count endpoint (see Open Issues).
4. **Pagination is cursor-based** for logs and traces. Frontend must handle `next_cursor` and request subsequent pages. Offset-based pagination is not supported.
5. **Step auto-selection:** if `step` is omitted from metric queries, the query service selects the appropriate rollup table based on the requested time range (raw for < 3h, 1m rollups for 3–48h, 1h rollups for > 48h).

---

## 6. Validation

- [ ] Schema DDL is executable against a local ClickHouse Docker instance without error.
- [ ] Each query endpoint has at least one example request/response pair documented above.
- [ ] Identity fields are consistent across all three signal schemas.
- [ ] Cross-signal correlation (trace_id in logs → spans) is structurally possible via the defined schemas.
- [ ] Retention TTL expressions reference the correct timestamp column in each table.
- [ ] Ingestion contract is explicit enough that the ingestion agent can implement without ambiguity.

---

## 7. Open Issues

| # | Issue | Owner | Blocking |
|---|-------|-------|---------|
| 1 | Log count endpoint: alerts may need `GET /api/v1/logs/count` (returns integer count for a query window) rather than paginating. Propose adding this endpoint before alert implementation. | Storage + Alerts agents | Phase 4 |
| 2 | Histogram storage: raw bucket rows with `le` label is Prometheus-compatible but requires client-side quantile computation. Evaluate whether to store pre-computed p50/p95/p99 as separate metric rows at ingestion time. | Ingestion + Storage agents | Phase 2 |
| 3 | Ingestion batch write protocol: HTTP bulk insert vs. ClickHouse native protocol. Recommend HTTP `/api/v1/query` with `FORMAT JSONEachRow` for Phase 2; revisit native TCP in Phase 5. | Ingestion agent | Phase 2 |
| 4 | Multi-tenancy: current schema has no `tenant_id`. If the platform needs to isolate multiple organizations, tenant_id must be added to sort keys before data accumulates. Defer to Phase 4 only if explicitly required. | All agents | Phase 4 |
| 5 | `events` column in spans is stored as JSON string. If span events become query targets (e.g., search for spans with a specific exception event), this needs to become a nested table or separate `span_events` table. | Storage agent | Phase 3 |
| 6 | ClickHouse write credentials and connection config: storage agent will define env vars; ingestion agent must consume them. Coordinate on naming before implementation. | Storage + Ingestion agents | Phase 2 |
