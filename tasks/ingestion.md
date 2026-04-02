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
  - Common identity/resource model defined
  - Payload shapes for metrics, logs, and traces defined (OpenTelemetry-aligned, HTTP JSON)
  - Service boundaries and major components documented (gateway, parsers, identity normalizer, validation pipeline, storage forwarder)
  - Proposed module/file structure (`ingestion/cmd`, `internal/`, `pkg/schema/`)
  - Validation behavior and HTTP response codes specified
  - Client SDK/agent transport expectations documented
  - 7 open questions raised for Storage agent (S1–S7)
  - 5 open questions raised for Frontend agent (F1–F5)

### Blocked on
- Storage agent: must answer S1–S7 before `forwarder/storage_client.go` can be implemented
- Frontend agent: F1–F5 review requested

### Next steps (after storage contract is agreed)
- Implement `pkg/schema` types
- Implement signal parsers + validators with unit tests
- Implement storage forwarder against agreed write API
- End-to-end test with Node.js OTel SDK