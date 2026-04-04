# Ingestion Agent Task

## Objective
Design and implement telemetry intake for metrics, logs, and traces.

## Deliverables
- Intake API/service design
- Payload schemas
- Collector/agent expectations
- Validation path for incoming telemetry
- Initial implementation plan

## Boundaries
Allowed: ingestion services, intake routes, parsers, validation, transport docs
Not allowed: frontend dashboards, alert rule engine, storage internals except contract discussions

## Required coordination
Must define contracts with storage before deep implementation.

## Status

### Completed
- [x] Subsystem design written to `docs/ingestion-design.md`
  - Canonical top-level identity fields aligned to `INTERFACES.md`
  - `/v1` ingestion API semantics aligned, including auth, partial-batch behavior, and indexed error responses
  - Metric, log, and span write shapes aligned to the canonical ingestion to storage schemas
  - Histogram expansion behavior documented using per-bucket rows plus `_count` and `_sum`
  - Direct ClickHouse HTTP write path documented with batching and in-memory buffering rules
  - Old conflicting assumptions removed (`resource`-only storage boundary, storage write API, `summary` metrics, trace `events`/`links`, millisecond storage timestamps)
  - Follow-up review alignment completed against `docs/review-alignment.md` ingestion findings without changing the contract in `INTERFACES.md`
- [x] Implementation approach proposed in `docs/ingestion-implementation-plan.md`
  - Node.js 22 + TypeScript selected as the runtime and language for the first ingestion service implementation
  - Minimal scaffold defined under `apps/ingestion/`
  - Fastify selected as the minimal HTTP server framework for `/v1` ingestion routes
  - Environment-based config and Vitest-based test approach defined for the initial scaffold
  - Metrics-first implementation slice retained without changing shared contracts
- [x] Initial ingestion scaffold created under `apps/ingestion/`
  - Node.js + TypeScript package metadata and compiler config added
  - Fastify app bootstrap and HTTP server entrypoint added
  - `POST /v1/metrics` implemented with JSON parsing and `X-Api-Key` auth
  - Metrics normalization and validation implemented against `INTERFACES.md`
  - Placeholder metrics writer added in place of full ClickHouse wiring
  - Initial Vitest coverage added for auth, normalization, and metrics pipeline behavior
- [x] Implementation review issues addressed for ingestion
  - Real ClickHouse config loading and metrics writer wiring added for the metrics path
  - `/v1/logs` and `/v1/traces` routes registered so canonical ingestion endpoints no longer 404
  - Tests updated to cover route registration and non-noop writer integration

### Blocked on
- No ingestion-specific contract blockers remain for Phase 2 design work; `INTERFACES.md` is the authority for implementation.

### Next steps
- Implement contract-compliant logs and traces ingestion behavior behind the registered routes
- Add in-memory batching and flush interval behavior for ClickHouse writes
- Expand test coverage for request-envelope failures and writer failure paths
- End-to-end test with a Node.js OTel emitter and canonical row verification
