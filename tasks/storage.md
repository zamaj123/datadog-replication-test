# Storage Agent Task

## Objective
Design and implement storage and query foundations for metrics, logs, and traces.

## Deliverables
- [x] Storage architecture proposal — `docs/storage-design.md`
- [x] Data model and indexing strategy — `docs/storage-design.md` §5.3–5.7
- [x] Query API contract — `docs/storage-design.md` §5.9
- [x] Retention assumptions — `docs/storage-design.md` §5.8
- [x] Ingestion contract requirements — `docs/storage-design.md` §5.10
- [x] Frontend/alerts contract requirements — `docs/storage-design.md` §5.11
- [ ] Implementation (Phase 2)

## Status
Design phase complete. Awaiting ingestion agent review of §5.10 (inbound contract) before implementation.

## Boundaries
Allowed: schemas, storage services, indexes, query interfaces
Not allowed: frontend UI, telemetry collection logic except schema alignment

## Required coordination
- Ingestion agent must confirm §5.10 contract requirements before deep implementation
- Alerts agent must review §5.11 and confirm whether a `/logs/count` endpoint is needed (Open Issue #1)
- Ingestion agent to coordinate on ClickHouse connection env var naming (Open Issue #6)