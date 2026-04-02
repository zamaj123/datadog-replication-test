# Alerts Agent Task

## Objective
Design and implement the alerting subsystem.

## Deliverables
- [x] Alert model — see docs/alerts-design.md §4
- [x] Rule evaluation design — see docs/alerts-design.md §6
- [x] Threshold and anomaly starter scope — see docs/alerts-design.md §4.1
- [x] Notification flow design — see docs/alerts-design.md §7
- [x] Initial implementation plan — see docs/alerts-design.md §11
- [ ] Monitor CRUD API implementation
- [ ] Evaluation scheduler implementation
- [ ] Threshold/change evaluator implementation
- [ ] Notification dispatcher (email + webhook)
- [ ] Missing data evaluator
- [ ] Anomaly evaluator

## Boundaries
Allowed: alert definitions, evaluation engine, notifications
Not allowed: frontend-wide redesign, ingestion transport internals

## Required coordination
Must consume query/storage outputs through explicit contracts.

### Blocking dependencies (open)
1. **Log query DSL format** — needed from storage/query agent before log_count evaluator can be built (docs/alerts-design.md issue #1)
2. **Historical query caching policy** — needed from query agent before anomaly evaluator can be built (docs/alerts-design.md issue #2)

### Contracts alerts exposes to other agents
- REST API: `/api/v1/monitors` and `/api/v1/alerts` — see docs/alerts-design.md §9
- Required identity fields on telemetry: `service`, `env`, `host`, `timestamp` — see docs/alerts-design.md §8.3
- Required metric query interface from query agent — see docs/alerts-design.md §8.1
- Required log query interface from query agent — see docs/alerts-design.md §8.1
