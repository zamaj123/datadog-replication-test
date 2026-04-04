# Implementation Review — PRs 24, 25, 26 (Second Pass)

**Author:** Reviewer Agent  
**Date:** 2026-04-04

## Scope

Reviewed PRs:

- PR #24 — frontend (`subsystem/frontend-impl-plan`)
- PR #25 — storage (`subsystem/storage`)
- PR #26 — ingestion (`subsystem/ingestion`)

Review scope remained limited to:

- contract conformance with `INTERFACES.md`
- integration compatibility between subsystems
- obvious implementation mistakes that will break end-to-end flow

## Findings

### 1. Ingestion still does not implement the required logs and traces ingestion paths, so two-thirds of the ingestion contract remain non-functional.

- PR #26
- `apps/ingestion/src/routes/not-implemented.ts:16`
- `apps/ingestion/src/routes/not-implemented.ts:23`
- `apps/ingestion/src/routes/not-implemented.ts:31`
- `apps/ingestion/src/routes/not-implemented.ts:32`

The PR now registers `/v1/logs` and `/v1/traces`, but both routes unconditionally return `501 not implemented`. `INTERFACES.md §6` requires working ingestion endpoints for metrics, logs, and traces. Any end-to-end flow involving logs or traces still fails immediately.

### 2. Storage can still run with no ClickHouse configuration and silently fall back to fixture data, so the metrics query path can remain detached from ingested telemetry.

- PR #25
- `apps/storage/src/config/env.ts:4`
- `apps/storage/src/config/env.ts:49`
- `apps/storage/src/server/app.ts:20`
- `apps/storage/src/server/app.ts:21`
- `apps/storage/src/services/metrics-query-service.ts:9`
- `apps/storage/src/services/metrics-query-service.ts:207`
- `apps/storage/src/services/metrics-query-service.ts:238`

`clickhouse` is optional in the storage env, and when it is absent the metrics query service falls back to `mockMetricRows`. That means the storage service can start successfully while returning fixture responses unrelated to ingestion output. In that mode, the ingestion -> storage -> frontend path is still broken even though the endpoint shapes look correct.

### 3. Storage’s non-metrics query endpoints are still placeholder-only, so logs, traces, services, and environments are not integrated with any backing store.

- PR #25
- `apps/storage/src/server/app.ts:8`
- `apps/storage/src/server/app.ts:42`
- `apps/storage/src/routes/query-placeholders.ts:29`
- `apps/storage/src/routes/query-placeholders.ts:39`
- `apps/storage/src/routes/query-placeholders.ts:50`
- `apps/storage/src/routes/query-placeholders.ts:54`
- `apps/storage/src/routes/query-placeholders.ts:59`
- `apps/storage/src/routes/query-placeholders.ts:66`
- `apps/storage/src/routes/query-placeholders.ts:83`

The route set now exists, but every non-metrics endpoint still returns empty placeholder payloads or a synthetic 404. That means the canonical query surface is still not integrated for logs, traces, services, and environments, so those flows remain non-functional end to end.

## Frontend

No new frontend-only contract or integration finding was identified in the current metrics slice. The remaining frontend risk is still downstream of the ingestion and storage blockers above.
