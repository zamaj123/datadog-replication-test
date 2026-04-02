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
- [x] Contract alignment to `INTERFACES.md` — `docs/frontend-design.md`
- [x] Implementation scaffold plan — `docs/frontend-implementation-plan.md`

## Boundaries
Allowed: frontend app, UI components, page flows, client-side state
Not allowed: backend storage internals, ingestion pipeline implementation

## Required coordination
Must depend on documented query APIs and shared field names.

## Contract decisions adopted from `INTERFACES.md`
1. Query params use `start` and `end`, not `from` and `to`
2. Canonical filters use `environment` and `service_name`
3. Environments come from `GET /api/v1/environments`
4. Metrics use `GET /api/v1/metrics/names` and `GET /api/v1/metrics/query`
5. Logs use `severity_text`, `severity_number`, and `log_id`
6. Traces use lowercase `status`, `duration_ns`, and `root_service_name`
7. Pagination is cursor-based with `cursor` and `next_cursor`
8. Service summaries come from `GET /api/v1/services` and `GET /api/v1/services/:service_name/summary`

## Status
Phase 1 design updated to conform to the finalized cross-subsystem contract. Initial frontend scaffold plan documented in `docs/frontend-implementation-plan.md`.
