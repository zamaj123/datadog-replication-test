# Ingestion Subsystem Design

**Agent:** Ingestion  
**Stage:** Phase 2 implementation design  
**Status:** Aligned to `INTERFACES.md`

---

## 1. Objective

Implement a Node.js + TypeScript ingestion service that accepts metrics, logs, and traces, normalizes them to the canonical event shapes in `INTERFACES.md`, and writes them directly to ClickHouse.

`INTERFACES.md` remains the source of truth for all external and cross-subsystem contracts. This document only defines how ingestion should be implemented.

---

## 2. Plan

1. Build one Fastify service exposing `/v1/metrics`, `/v1/logs`, and `/v1/traces`
2. Authenticate every request using `X-Api-Key`
3. Normalize incoming OTel-style payloads into canonical top-level fields
4. Validate, expand, and batch rows per signal
5. Write directly to ClickHouse HTTP using `FORMAT JSONEachRow`

---

## 3. Files to Change

- `docs/ingestion-design.md`
- `tasks/ingestion.md`

---

## 4. Assumptions

- Runtime is Node.js 22 LTS with TypeScript strict mode.
- Fastify is used for the HTTP server.
- Shared request and event schemas are defined in a TypeScript contracts package and derived from `INTERFACES.md`.
- Ingestion writes directly to ClickHouse. There is no storage write API service.
- OTel-compatible clients may still submit `resource` blocks and millisecond timestamps, but ingestion owns conversion to the canonical ingestion to storage shape.

---

## 5. Runtime Architecture

Single service:

```text
instrumented app / SDK
  -> ingestion gateway
  -> normalization + validation pipeline
  -> in-memory signal buffers
  -> ClickHouse HTTP INSERT
```

Responsibilities:

- route handling
- API key authentication
- request parsing
- resource attribute normalization
- signal-specific validation
- histogram expansion
- severity normalization
- timestamp conversion
- span duration calculation
- partial-batch acceptance / rejection accounting
- buffered ClickHouse writes

Non-responsibilities:

- query APIs
- trace list materialization
- `trace_index` management
- dashboard or frontend concerns

### 5.2 Write Architecture

## 6. Internal Pipeline

Every request should pass through these steps:

1. Validate `X-Api-Key`
2. Parse JSON body
3. Validate request envelope shape
4. Normalize `resource` attributes into:
   - `service_name`
   - `environment`
   - `host`
   - `version`
5. Validate canonical required fields
6. Convert SDK timestamps from milliseconds to nanoseconds when needed
7. Apply signal-specific transforms:
   - metrics: expand histograms into per-bucket rows plus `_count` and `_sum`
   - logs: generate `log_id`, map `severity_number` and `severity_text`, stringify attribute values
   - traces: compute `duration_ns`, normalize `status`, validate `end_time >= start_time`
8. Append valid rows to per-table buffers
9. Return `202` or `400` with accepted / rejected counts per `INTERFACES.md`
10. Flush buffers to ClickHouse every 500ms or when 1000 rows accumulate

---

## 7. Module Layout

```text
apps/ingestion/
  src/
    server/
      app.ts
      plugins.ts
    routes/
      metrics.ts
      logs.ts
      traces.ts
    pipeline/
      handle-metrics.ts
      handle-logs.ts
      handle-traces.ts
      result.ts
    normalization/
      resource.ts
      timestamps.ts
      severity.ts
      attributes.ts
    clickhouse/
      writer.ts
      buffer.ts
      sql.ts
    config/
      env.ts
```

Key implementation notes:

- route handlers stay thin
- pipeline modules own signal behavior
- normalization is shared across all routes
- ClickHouse writes are isolated from HTTP handling

Batch write rules:

## 8. Request Handling Rules

### 8.1 Authentication

- All ingestion endpoints require `X-Api-Key`
- Key value comes from `INGESTION_API_KEY`
- Missing or invalid key returns `401`

### 8.2 Partial Batch Behavior

- Valid events in the submitted array proceed even if some are rejected
- Response bodies must include `accepted` and `rejected`
- Validation failures return `400` with per-item errors
- Temporary ClickHouse unavailability can return `503`

### 8.3 Buffering

- Buffer rows in memory only
- Maximum in-memory buffer is 10,000 rows across pending writes
- On overflow, drop oldest rows as required by `INTERFACES.md`
- Retries are flush-level, not per-row

- Max 20 key-value pairs.
- Keys match `[a-z_][a-z0-9_.]*`.
- Keys max 64 chars.
- Values max 256 chars.
- Ingestion rejects metrics with malformed tag keys.

## 9. ClickHouse Write Design

### 9.1 Connection

Use these environment variables:

- `CLICKHOUSE_HOST`
- `CLICKHOUSE_PORT`
- `CLICKHOUSE_DATABASE`
- `CLICKHOUSE_USER`
- `CLICKHOUSE_PASSWORD`

### 9.2 Insert Strategy

Write directly to ClickHouse using HTTP `INSERT ... FORMAT JSONEachRow`.

Recommended tables:

- `metrics`
- `logs`
- `spans`

The ingestion service should not write to `trace_index`.

### 9.3 Failure Handling

- treat insert failure as a flush failure
- keep buffered rows until retry or eviction
- emit structured logs and internal metrics for:
  - buffer depth
  - flush latency
  - flush failures
  - rejected event count

`index` is the zero-based position of the event in the submitted array.

## 10. Canonical Field Mapping

Ingestion must normalize OTel resource attributes using the exact mapping in `INTERFACES.md`:

| Incoming attribute | Canonical field |
|---|---|
| `service.name` | `service_name` |
| `deployment.environment` | `environment` |
| `host.name` | `host` |
| `service.version` | `version` |

Any implementation that forwards `resource`, `service.name`, `env`, or `service` across the ingestion to storage boundary is incorrect.

---

## 11. Validation

- [ ] API key middleware returns `401` on missing or invalid keys
- [ ] metric, log, and trace request schemas match `INTERFACES.md`
- [ ] histogram expansion matches the canonical row format
- [ ] logs generate `log_id` and canonical severity fields
- [ ] spans compute `duration_ns` and reject `end_time < start_time`
- [ ] batch flushing uses 1000 rows or 500ms
- [ ] end-to-end test confirms direct ClickHouse writes

---

## 12. Open Issues

- The implementation should use a shared contracts package so ingestion and query code cannot drift on field names.
- If load increases materially, the next scaling step is separate ingestion replicas behind a load balancer, not a new write API.
