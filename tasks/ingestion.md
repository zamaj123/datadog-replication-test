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

### Blocked on
- No ingestion-specific contract blockers remain for Phase 2 design work; `INTERFACES.md` is the authority for implementation.

### Next steps
- Implement canonical ingestion schema types and normalization helpers
- Implement signal parsers + validators with unit tests
- Implement the ClickHouse batch writer using HTTP `FORMAT JSONEachRow`
- End-to-end test with a Node.js OTel emitter and canonical row verification
