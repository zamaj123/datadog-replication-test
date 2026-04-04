# Implementation Review — PRs 24, 25, 26

**Author:** Reviewer Agent  
**Date:** 2026-04-04

## Scope

Reviewed PRs:

- PR #24 — frontend (`subsystem/frontend-impl-plan`)
- PR #25 — storage (`subsystem/storage`)
- PR #26 — ingestion (`subsystem/ingestion`)

Review scope was limited to:

- contract conformance with `INTERFACES.md`
- integration compatibility between subsystems
- obvious implementation mistakes that will break end-to-end flow

## Findings

### 1. Ingestion acknowledges accepted metrics without persisting them, so the ingestion to storage path is non-functional.

- PR #26
- `apps/ingestion/src/server/app.ts:4`
- `apps/ingestion/src/server/app.ts:31`
- `apps/ingestion/src/server/app.ts:33`
- `apps/ingestion/src/server/start.ts:5`
- `apps/ingestion/src/server/start.ts:6`
- `apps/ingestion/src/clickhouse/writer.ts:7`
- `apps/ingestion/src/config/env.ts:1`
- `apps/ingestion/src/config/env.ts:7`

The app defaults to `NoopMetricsWriter`, and `start.ts` never injects a real ClickHouse writer. The only environment values loaded are `PORT` and `INGESTION_API_KEY`; none of the `CLICKHOUSE_*` variables required by `INTERFACES.md §2` are present. As a result, `POST /v1/metrics` can return `202` even though no rows are written anywhere.

### 2. Ingestion only implements `/v1/metrics`, so two required ingestion endpoints still 404.

- PR #26
- `apps/ingestion/src/server/app.ts:6`
- `apps/ingestion/src/server/app.ts:31`
- `apps/ingestion/src/routes/metrics.ts:25`

`INTERFACES.md §6` requires `POST /v1/metrics`, `POST /v1/logs`, and `POST /v1/traces`. This PR only registers the metrics route. Any client sending canonical log or trace traffic will fail integration immediately.

### 3. Storage serves hard-coded mock metric rows instead of querying ClickHouse, so frontend and alerts cannot observe ingested data.

- PR #25
- `apps/storage/src/services/mock-metrics.ts:3`
- `apps/storage/src/services/metrics-query-service.ts:8`
- `apps/storage/src/services/metrics-query-service.ts:63`
- `apps/storage/src/services/metrics-query-service.ts:159`

The storage service is detached from the ingestion path: it reads from `mockMetricRows` rather than ClickHouse. Even if ingestion were fixed to write real telemetry, query responses would still come from static fixture data, so the end-to-end ingestion -> storage -> frontend flow remains broken.

### 4. Storage only exposes the two metrics endpoints, so the canonical query surface is still incomplete.

- PR #25
- `apps/storage/src/server/app.ts:6`
- `apps/storage/src/server/app.ts:28`
- `apps/storage/src/routes/metrics.ts:122`
- `apps/storage/src/routes/metrics.ts:128`

`INTERFACES.md §7` requires logs, log volume, traces, trace detail, services, service summary, and environments endpoints in addition to the metrics endpoints. This PR registers only `/api/v1/metrics/query` and `/api/v1/metrics/names`. Any integration against the rest of the canonical query API will 404.

### 5. Storage returns `step: "raw"` for auto-selected raw data, which is outside the defined query contract.

- PR #25
- `apps/storage/src/services/step-selection.ts:4`
- `apps/storage/src/services/step-selection.ts:8`
- `apps/storage/src/services/metrics-query-service.ts:115`
- `apps/storage/src/services/metrics-query-service.ts:150`

`INTERFACES.md §7.1` defines the accepted `step` tokens as rollup intervals such as `1m`, `5m`, `15m`, `1h`, `6h`, and `1d`; for short ranges it specifies raw data semantics, not a `"raw"` step value. This implementation returns `"raw"` in the response, which breaks strict contract conformance for consumers that validate or branch on the documented step values.

## Frontend

No frontend-only contract break was identified in the implemented metrics client slice. The current frontend PR is blocked primarily by the ingestion and storage findings above: the storage API does not read ingested data, and the wider canonical API surface is not implemented yet.
