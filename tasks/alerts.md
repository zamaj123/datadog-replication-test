# Alerts Agent Task

## Objective
Design and implement the alerting subsystem.

## Deliverables
- [x] Alert model — see docs/alerts-design.md §4
- [x] Rule evaluation design — see docs/alerts-design.md §6
- [x] Threshold/change/log-count/missing-data scope aligned to `INTERFACES.md` — see docs/alerts-design.md §3-§6
- [x] Alerts API surface aligned to `INTERFACES.md` — see docs/alerts-design.md §7
- [x] Contract-preserving implementation notes — see docs/alerts-design.md §9
- [x] Design doc aligned to `INTERFACES.md` and reviewer alignment findings — see docs/alerts-design.md
- [ ] Monitor CRUD API implementation
- [ ] Evaluation scheduler implementation
- [ ] Threshold/change evaluator implementation
- [ ] Notification dispatcher (email + webhook)
- [ ] Missing data evaluator

## Boundaries
Allowed: alert definitions, evaluation engine, notifications
Not allowed: frontend-wide redesign, ingestion transport internals

## Required coordination
Must consume query/storage outputs through explicit contracts.

### Blocking dependencies (open)
- None for the current contract surface in `INTERFACES.md`.

### Contracts alerts exposes to other agents
- REST API: `/api/v1/alerts/monitors` and `/api/v1/alerts/incidents` — see `INTERFACES.md` §8.4 and docs/alerts-design.md §7
- Public monitor schema: `status` in `ok|alerting|no_data`, `service_name`, `environment`, `severity`, and `breaching_groups` — see `INTERFACES.md` §8.1-§8.2 and docs/alerts-design.md §4-§5
- Required metric query interface from storage/query: `GET /api/v1/metrics/query` with `start`, `end`, `agg`, `group_by`, and `filter[...]` — see `INTERFACES.md` §7.1 and docs/alerts-design.md §6.2
- Required log query interface from storage/query: `GET /api/v1/logs` with structured params and `count_only=true` for log-count evaluation — see `INTERFACES.md` §7.3 and docs/alerts-design.md §6.3
- Retention constraint: monitor evaluation windows must not exceed 30 days — see `INTERFACES.md` §9 and docs/alerts-design.md §6.1
