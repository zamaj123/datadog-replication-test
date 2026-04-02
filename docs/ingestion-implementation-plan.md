# Ingestion Implementation Plan

**Agent:** Ingestion  
**Status:** Proposed implementation approach  
**Contract source:** `INTERFACES.md`

---

## 1. Objective

Define a concrete, minimal implementation approach for the ingestion service that matches the current contracts in `INTERFACES.md` without changing those contracts.

---

## 2. Runtime and Language

**Choice:** Go

### Why Go

- A single static binary keeps the service easy to run in local and container environments.
- The standard library provides everything needed for the initial HTTP server, JSON decoding, request timeouts, and background flushing.
- Concurrency for batched ingestion and ClickHouse flush workers is straightforward with goroutines and channels.
- The repo currently has no existing runtime to preserve, so Go is a practical minimal default for a network service with buffering and validation.

This choice does not change any external contract. It only defines the implementation stack for the ingestion-owned service.

---

## 3. Service Shape

Implement ingestion as a single HTTP service process with three intake endpoints:

- `POST /v1/metrics`
- `POST /v1/logs`
- `POST /v1/traces`

For the first implementation pass, all three routes can exist in the server, but metrics should be implemented first. The service should:

- require `X-Api-Key` on all ingestion requests
- accept `application/json`
- decode batch payloads
- normalize OTel resource attributes into canonical top-level identity fields
- validate per-event payloads
- convert timestamps to nanoseconds at the ingestion-to-storage boundary
- buffer accepted rows in memory
- flush accepted rows to ClickHouse over HTTP using `FORMAT JSONEachRow`
- return `202` with accepted/rejected counts and partial-batch errors as defined in `INTERFACES.md`

This remains a single-process architecture:

```text
client SDK -> ingestion HTTP server -> normalizer/validator -> in-memory buffer -> ClickHouse HTTP
```

---

## 4. Minimal Project Structure

Code should live under a new top-level `ingestion/` directory in this repo.

```text
ingestion/
├── go.mod
├── cmd/
│   └── server/
│       └── main.go
├── internal/
│   ├── config/
│   │   └── config.go
│   ├── gateway/
│   │   ├── server.go
│   │   ├── middleware.go
│   │   └── metrics_handler.go
│   ├── identity/
│   │   └── normalizer.go
│   ├── metrics/
│   │   ├── types.go
│   │   ├── decode.go
│   │   ├── validate.go
│   │   └── expand.go
│   ├── buffer/
│   │   └── queue.go
│   ├── clickhouse/
│   │   ├── client.go
│   │   └── writer.go
│   └── ingestion/
│       └── pipeline.go
└── tests/
    ├── metrics_handler_test.go
    ├── metrics_validate_test.go
    └── metrics_expand_test.go
```

### Structure notes

- `cmd/server/main.go` starts the HTTP server and background flush worker.
- `internal/config` loads `INGESTION_API_KEY` and the ClickHouse environment variables defined in `INTERFACES.md`.
- `internal/gateway` owns HTTP routing, auth, request decoding, and response formatting.
- `internal/identity` owns OTel resource-to-canonical-field normalization.
- `internal/metrics` owns metrics request shapes, validation, and histogram expansion.
- `internal/buffer` owns the in-memory queue with the configured row limit.
- `internal/clickhouse` owns batched HTTP inserts to ClickHouse.
- `internal/ingestion/pipeline.go` wires handler -> normalization -> validation -> buffer/write flow.

This structure is intentionally minimal. It creates clear ingestion-owned boundaries without introducing a broader platform framework.

---

## 5. How the Service Runs

The service should run as one HTTP server process.

### Startup behavior

At startup, the service should:

- load config from environment
- fail fast if required config is missing
- construct the in-memory buffer
- construct the ClickHouse client
- start a background flush loop
- start the HTTP listener

### Required environment variables

From `INTERFACES.md`:

- `INGESTION_API_KEY`
- `CLICKHOUSE_HOST`
- `CLICKHOUSE_PORT`
- `CLICKHOUSE_DATABASE`
- `CLICKHOUSE_USER`
- `CLICKHOUSE_PASSWORD`

Additional implementation-local variables may be added only for server operation, such as listen port, but they must not alter the external contract.

### HTTP behavior

The server should use the standard library `net/http` package for the initial implementation.

Minimal routing:

- `/v1/metrics` -> metrics handler
- `/v1/logs` -> placeholder route registration until implemented
- `/v1/traces` -> placeholder route registration until implemented

Only the metrics path needs to be fully implemented first. Logs and traces can return a clear not-yet-implemented server response internally until their ingestion paths are built, but that is implementation sequencing, not a contract change.

---

## 6. Metrics Path Implementation Approach

Implement the metrics path first because it is self-contained and already fully specified in `INTERFACES.md`.

### Request shape handled by the server

The handler accepts:

```json
{ "metrics": [ ... ] }
```

Each metric event may contain:

- OTel `resource` attributes that need normalization
- metric fields that map to gauge/counter rows
- histogram fields that need expansion before buffering/writing

### Processing steps

For each metric event:

1. Decode JSON request body.
2. Authenticate request via `X-Api-Key`.
3. Normalize resource attributes into `service_name`, `environment`, `host`, and `version`.
4. Validate required identity fields and metric-specific constraints.
5. Convert event timestamp to nanoseconds for the storage boundary.
6. If the metric is `gauge` or `counter`, emit one canonical row.
7. If the metric is `histogram`, emit one row per bucket plus `_count` and `_sum`.
8. Add accepted rows to the shared buffer.
9. Collect per-event validation failures into the response body.
10. Return `202` with accepted and rejected counts.

### Validation rules to enforce from the contract

- `service_name` and `environment` must be present and non-empty after normalization.
- `host` and `version` default to `""`.
- metric `type` must be `gauge`, `counter`, or `histogram`
- `summary` is rejected
- counter `value >= 0`
- tag key regex: `[a-z_][a-z0-9_.]*`
- max 20 tags
- tag key max 64 chars
- tag value max 256 chars

### Buffer and write behavior

- Accepted rows go into a shared in-memory queue.
- The queue must support the contract behavior of buffering up to 10,000 rows and dropping oldest on overflow.
- A background worker flushes up to 1000 rows every 500ms or earlier when batch size is reached.
- Flushes use ClickHouse HTTP inserts with `FORMAT JSONEachRow`.

---

## 7. ClickHouse Write Approach

The ClickHouse writer should be ingestion-owned and minimal.

### Responsibilities

- build the correct ClickHouse HTTP endpoint from environment config
- serialize canonical metric rows as `JSONEachRow`
- send batched inserts
- surface write failures back to the buffer/flush loop

### Table targeting

The writer should assume storage owns the ClickHouse schema and target the metrics table expected by the storage subsystem contract. The ingestion service should not define or redesign storage schema in this plan.

### Failure handling

- If ClickHouse is temporarily unavailable, accepted rows remain buffered until retried or evicted by queue overflow.
- When the server cannot accept more buffered rows for a request, it should return `503` as described by `INTERFACES.md`.

---

## 8. Minimal Testing Plan

The first implementation should include tests for the metrics path only.

Required tests:

- auth test for missing and invalid `X-Api-Key`
- decode/validation test for missing `service_name` after normalization
- timestamp conversion test from milliseconds to nanoseconds
- gauge/counter acceptance test
- counter negative-value rejection test
- malformed tag key rejection test
- histogram expansion test for bucket rows plus `_count` and `_sum`
- partial-batch response test with accepted and rejected events in one request
- buffer overflow behavior test for oldest-row eviction

Tests should be standard Go tests run with `go test ./...` under the `ingestion/` module.

---

## 9. Where Code Should Live in This Repo

Use this repo layout:

- design and planning docs remain in `docs/`
- task tracking remains in `tasks/`
- implementation code for the ingestion service lives in `ingestion/`

This keeps implementation separate from subsystem design docs while staying entirely within ingestion ownership.

---

## 10. Recommended First Delivery Slice

The first implementation slice should be:

1. scaffold `ingestion/` Go module
2. add config loading
3. add HTTP server and auth middleware
4. implement `/v1/metrics`
5. implement identity normalization
6. implement metric validation and histogram expansion
7. implement in-memory queue
8. implement ClickHouse batch writer
9. add metrics-path tests

This is the smallest practical slice that produces a contract-aligned metrics ingestion path without requiring any redesign of shared interfaces.
