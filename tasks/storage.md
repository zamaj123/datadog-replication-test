# Storage Agent Task

## Objective
Design and implement storage and query foundations for metrics, logs, and traces.

## Deliverables
- [x] Storage architecture proposal — `docs/storage-design.md`
- [x] Implementation scaffold plan — `docs/storage-implementation-plan.md`
- [x] Data model and indexing strategy — `docs/storage-design.md` §5.4–§5.8
- [x] Query API contract — `docs/storage-design.md` §5.7
- [x] Retention assumptions — `docs/storage-design.md` §5.9
- [x] Ingestion contract requirements — `docs/storage-design.md` §5.2 and §5.10
- [x] Frontend/alerts contract requirements — `docs/storage-design.md` §5.7 and §5.10
- [ ] Implementation (Phase 2)

## Status
Design updated to conform to `INTERFACES.md`. `apps/storage` now requires ClickHouse configuration for the metrics read path and returns an explicit error instead of synthetic data when that dependency is absent. The canonical `metrics` table DDL and a local ClickHouse schema init script are now present, the metrics read path now uses exact nanosecond ClickHouse range boundaries while preserving raw-data behavior for auto-selected short ranges, and the HTTP server now allows the frontend dev origin to call the storage API with `X-Api-Key` over CORS. Broader Phase 2 implementation remains pending.

## Boundaries
Allowed: schemas, storage services, indexes, query interfaces
Not allowed: frontend UI, telemetry collection logic except schema alignment

## Required coordination
- No storage-side contract redesign remains open; `INTERFACES.md` is the authority for cross-subsystem behavior.
- Implementation coordination remains for ingestion write behavior and alerts state integration during Phase 2.
