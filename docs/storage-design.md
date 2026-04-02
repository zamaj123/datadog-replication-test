# Storage Design

**Agent:** Storage  
**Stage:** Phase 2 implementation design  
**Status:** Aligned to `INTERFACES.md`

---

## 1. Objective

Implement the storage layer as:

1. ClickHouse and PostgreSQL schema ownership
2. a Node.js + TypeScript query API that serves the canonical read endpoints in `INTERFACES.md`

This document does not redefine contracts. `INTERFACES.md` remains authoritative.

---

## 2. Plan

1. Define the storage engines and owned schemas
2. Define canonical ClickHouse table strategy
3. Implement a Node.js query API over ClickHouse and PostgreSQL
4. Enforce retention and pagination behavior in line with `INTERFACES.md`
5. keep storage responsibility focused on schema and reads, not a separate write service

---

## 3. Files to Change

- `docs/storage-design.md`
- `tasks/storage.md`

---

## 4. Assumptions

- Runtime is Node.js 22 LTS with TypeScript strict mode.
- Query API uses Fastify.
- ClickHouse is the telemetry store for metrics, logs, spans, and trace summaries.
- PostgreSQL stores metadata and later alert monitor state.
- Ingestion writes directly to ClickHouse and does not call a storage write API.

---

## 5. Storage Ownership

Storage owns:

- ClickHouse DDL
- PostgreSQL DDL for metadata used by query responses
- materialized views and rollups
- `GET /api/v1/...` query endpoints
- SQL tuning and retention policy

Storage does not own:

- telemetry intake endpoints
- SDK payload normalization
- frontend route structure

### 5.3 Canonical Identity and Time Model

Storage stores the canonical top-level identity fields from `INTERFACES.md` on every signal table:

| Field | ClickHouse type | Notes |
|---|---|---|
| `service_name` | `LowCardinality(String)` | Required, non-empty at ingestion boundary |
| `environment` | `LowCardinality(String)` | Required, non-empty at ingestion boundary |
| `host` | `LowCardinality(String)` | Required in storage rows; `""` when absent |
| `version` | `LowCardinality(String)` | Required in storage rows; `""` when absent |

## 6. Engine Selection

| Concern | Engine | Purpose |
|---|---|---|
| metrics | ClickHouse | range scans, aggregation, rollups |
| logs | ClickHouse | append-heavy search and correlation |
| spans | ClickHouse | trace assembly and summary reads |
| trace summaries | ClickHouse materialized view | fast trace list queries |
| metadata | PostgreSQL | service metadata and later alert state joins |

Redis is optional and deferred. Do not introduce it in Phase 2 unless query pressure proves it necessary.

Materialized views populate these rollups from `metrics`. Storage selects raw data, `metrics_1m`, or `metrics_1h` based on the canonical `step` auto-selection rules in `INTERFACES.md`.

## 7. ClickHouse Schema Strategy

### 7.1 Canonical Naming Rule

Actual table columns should stay as close as possible to the canonical names in `INTERFACES.md`.

Preferred examples:

- `service_name`
- `environment`
- `name`
- `type`
- `severity_number`
- `severity_text`
- `start_time`
- `end_time`
- `status`

Avoid internal rename layers like:

- `service`
- `env`
- `metric_name`
- `metric_type`
- `operation`
- `status_code`

Those names are a recurring source of drift and should not be used for new implementation.

### 7.2 Tables

Recommended tables:

- `metrics`
- `metrics_1m`
- `metrics_1h`
- `logs`
- `spans`
- `trace_index`

### 7.3 Trace Summary Strategy

`trace_index` must be owned by storage and implemented as a ClickHouse materialized view derived from `spans`.

Ingestion must not populate `trace_index`.

### 7.4 Rollups

Use ClickHouse materialized views for:

- 1-minute metric rollups
- 1-hour metric rollups

Rollups should be internal optimization tables. The external API must still expose only the canonical endpoint shapes from `INTERFACES.md`.

- Auth uses `X-Api-Key` and shares the same deployment key as ingestion.
- Time range params are `start` and `end`, both required where defined.
- Time range semantics are `[start, end)`.
- Response timestamps are ISO 8601 strings with millisecond precision.
- Status values are lowercase throughout: `ok`, `error`, `unset`.
- Pagination is cursor-based with `next_cursor`; offset pagination is not supported.
- Error responses use `{ "error": "...", "code": "bad_request" }`.

## 8. Query API Architecture

Implement one dedicated Node.js service:

```text
browser / alerts
  -> query-api
  -> ClickHouse / PostgreSQL
```

### 8.1 Service Responsibilities

- validate query params with shared contracts
- convert canonical filters into SQL
- format timestamps as ISO 8601 strings
- implement cursor-based pagination
- set `truncated` flags consistently
- join PostgreSQL metadata where required for service summary endpoints

### 8.2 Module Layout

```text
apps/query-api/
  src/
    server/
      app.ts
      plugins.ts
    routes/
      metrics.ts
      logs.ts
      traces.ts
      services.ts
      environments.ts
    services/
      metrics-query-service.ts
      logs-query-service.ts
      traces-query-service.ts
      services-query-service.ts
    repositories/
      clickhouse-metrics.ts
      clickhouse-logs.ts
      clickhouse-traces.ts
      postgres-services.ts
    clickhouse/
      client.ts
      sql.ts
    postgres/
      pool.ts
    config/
      env.ts
```

### 8.3 Endpoint Set

Implement the exact canonical endpoints:

- `GET /api/v1/metrics/query`
- `GET /api/v1/metrics/names`
- `GET /api/v1/logs`
- `GET /api/v1/logs/volume`
- `GET /api/v1/traces`
- `GET /api/v1/traces/:trace_id`
- `GET /api/v1/services`
- `GET /api/v1/services/:service_name/summary`
- `GET /api/v1/environments`

Do not implement alternate public paths such as:

- `/api/v1/logs/query`
- `/api/v1/traces/query`
- `/api/v1/traces/list`
- `/api/v1/metrics`
- `/api/v1/metrics/labels`
- `/api/v1/correlate/trace`

---

## 9. Query Service Rules

### 9.1 Authentication

- all query endpoints require `X-Api-Key`
- use the same deployment key model defined in `INTERFACES.md`

### 9.2 Time Range

- accept `start` and `end`
- enforce `[start, end)` semantics
- reject missing values with `400`

### 9.3 Pagination

- logs and traces use cursor-based pagination only
- responses return `next_cursor`
- offset-based pagination is not supported

### 9.4 Truncation

- set `truncated: true` when server caps a result set
- this behavior must be stable because alerts depends on it

### 9.5 Metrics Step Selection

- centralize step auto-selection in one metrics service module
- route handlers must not implement custom selection logic

---

## 10. PostgreSQL Scope

PostgreSQL should store:

- service metadata if needed for later enrichment
- dashboard metadata in later phases
- alert monitor state in later phases

PostgreSQL should not become a second telemetry store.

`active_alert_count` is read from alert monitor state in PostgreSQL and counts monitors in `alerting` or `no_data` scoped to the service and optional environment.

## 11. Retention and Operations

Retention must match `INTERFACES.md`:

- raw metrics: 30 days
- metrics_1m: 90 days
- metrics_1h: 1 year
- logs: 30 days
- spans: 30 days
- trace_index: 30 days

Operational priorities:

- explicit SQL migrations
- reproducible local Docker setup
- clear table ownership
- query observability on latency and scanned rows

---

## 12. Validation

- [ ] ClickHouse schemas use canonical field names or minimal justified deviations
- [ ] `trace_index` is generated by a materialized view, not ingestion
- [ ] every public endpoint in `INTERFACES.md §7` exists in the query API
- [ ] no superseded endpoint paths remain in implementation plans
- [ ] log and trace pagination are cursor-based
- [ ] query responses use canonical field names and timestamp formatting
- [ ] retention rules are expressed in ClickHouse TTL definitions

---

## 13. Open Issues

- If query latency becomes a problem, optimize SQL and rollups before adding more infrastructure.
- Any future caching layer must preserve canonical response behavior, especially `truncated`, cursor, and timestamp semantics.
