# Frontend Agent Task

## Objective
Design and implement the observability UI.

## Deliverables
- [x] Information architecture — `docs/frontend-design.md` §2
- [x] Dashboard layouts — `docs/frontend-design.md` §3
- [x] Service detail view — `docs/frontend-design.md` §4
- [x] Log explorer concept — `docs/frontend-design.md` §5
- [x] Trace exploration concept — `docs/frontend-design.md` §6
- [x] API requirements for frontend — `docs/frontend-design.md` §7–8

## Boundaries
Allowed: frontend app, UI components, page flows, client-side state
Not allowed: backend storage internals, ingestion pipeline implementation

## Required coordination
Must depend on documented query APIs and shared field names.

## Blocking open questions (see `docs/frontend-design.md` §9)
1. Max time window for log/trace queries before forced pagination
2. Valid metric rollup intervals (server-side or client-specified enum)
3. How env values are enumerated (dedicated endpoint vs. derived)
4. Structured log attribute field naming convention (flat vs. nested)
5. Trace status values: OK/ERROR only, or UNSET included
6. Pagination model: cursor-based confirmed?
7. `GET /api/v1/services` — will this endpoint be implemented?

## Status
Phase 1 design complete. Pending cross-agent review of API contracts before Phase 3 implementation.
