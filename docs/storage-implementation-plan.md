# Storage Implementation Plan

## 1. Objective

Define a minimal, concrete implementation scaffold for the storage subsystem that can implement the current storage contracts in `INTERFACES.md` without redesigning those contracts.

## 2. Plan

1. Choose a small runtime and server stack that can serve the storage query API and talk to ClickHouse directly.
2. Place the scaffold in a storage-owned folder in this repo.
3. Separate ClickHouse schema SQL, API handlers, config, and query logic so the metrics path can be implemented incrementally.
4. Keep the initial layout minimal: only what is needed to build the metrics storage and query path first.

## 3. Files to change

- `docs/storage-implementation-plan.md`
- `tasks/storage.md`

## 4. Assumptions

- This document is a storage-owned planning artifact only; it does not change any shared contract from `INTERFACES.md`.
- The first implementation target is the metrics path defined in `INTERFACES.md` and `docs/storage-design.md`.
- A single process query/API server is sufficient for Phase 2.
- ClickHouse remains the only timeseries storage dependency in this scaffold.

## 5. Implementation

### 5.1 Language and Runtime

Choose `TypeScript` on `Node.js`.

Reason:
- Minimal friction in this repo, which already targets a Node.js-based initial product.
- Good ClickHouse HTTP client support.
- Fast path to building the REST query API from `INTERFACES.md`.
- Practical local testing and startup without introducing extra infrastructure.

### 5.2 Folder Location in This Repo

Create the storage implementation under:

```text
storage/
```

Reason:
- Keeps implementation clearly inside storage ownership.
- Avoids implying a monorepo package layout that does not exist yet.
- Leaves room for future `ingestion/`, `frontend/`, and `alerts/` implementations without forcing that structure now.

Proposed top-level layout:

```text
storage/
  package.json
  tsconfig.json
  src/
  migrations/
  test/
```

### 5.3 Query/API Server Approach

Use a single `Fastify` HTTP server for the storage query API.

Scope of the initial server:
- Serve `/api/v1/metrics/query`
- Serve `/api/v1/metrics/names`
- Apply `X-Api-Key` authentication exactly as defined in `INTERFACES.md`
- Parse and validate query parameters to the existing contract only
- Translate API requests into ClickHouse queries

Why Fastify:
- Small and practical
- Good request validation and test ergonomics
- No need for a heavier framework for the current storage API surface

Request handling shape:
- `src/server.ts` boots Fastify and config
- `src/routes/metrics.ts` owns metrics endpoints
- `src/services/metrics-query-service.ts` builds and runs ClickHouse queries
- `src/lib/clickhouse.ts` owns the ClickHouse client

### 5.4 ClickHouse Schema and Migration Layout

Use plain SQL migration files in:

```text
storage/migrations/clickhouse/
```

Layout:

```text
storage/migrations/clickhouse/
  001_metrics.sql
  002_metrics_rollups.sql
```

Purpose:
- `001_metrics.sql`
  - create `metrics`
  - add any storage-owned indexes needed for the metrics path
- `002_metrics_rollups.sql`
  - create `metrics_1m`
  - create `metrics_1h`
  - create the materialized views that populate those rollups

Migration approach:
- Keep migrations append-only
- Apply them in lexical order
- Track applied migrations in ClickHouse with a small storage-owned migration table

The scaffold should also include a tiny runner script under:

```text
storage/src/scripts/run-clickhouse-migrations.ts
```

That runner is implementation support only; it does not redefine any schema or contract.

### 5.5 Config Approach

Use environment-variable config with startup validation.

Config source:
- `process.env`

Storage-owned config module:

```text
storage/src/config.ts
```

Required config for the initial scaffold:
- `PORT`
- `API_KEY`
- `CLICKHOUSE_HOST`
- `CLICKHOUSE_PORT`
- `CLICKHOUSE_DATABASE`
- `CLICKHOUSE_USER`
- `CLICKHOUSE_PASSWORD`

Config rules:
- Fail fast at startup if required values are missing
- Keep names aligned with `INTERFACES.md` for ClickHouse connection config
- Do not introduce config files or secret-management abstractions yet

### 5.6 Test Approach

Use `Vitest` for unit and HTTP-level tests.

Initial test layers:
- Unit tests for metrics query parameter validation
- Unit tests for step auto-selection logic from `INTERFACES.md`
- Unit tests for result shaping into the canonical `series[].labels[].points[]` response
- HTTP tests against the Fastify server using injected requests

Add optional integration tests for ClickHouse under:

```text
storage/test/integration/
```

Those tests should run only when ClickHouse is available locally. The scaffold should not require them for every edit, but it should leave a clear place for them.

### 5.7 Initial Files to Create

Minimal initial scaffold files:

```text
storage/package.json
storage/tsconfig.json
storage/src/server.ts
storage/src/config.ts
storage/src/lib/clickhouse.ts
storage/src/routes/metrics.ts
storage/src/services/metrics-query-service.ts
storage/src/services/metrics-query-types.ts
storage/src/services/step-selection.ts
storage/src/scripts/run-clickhouse-migrations.ts
storage/migrations/clickhouse/001_metrics.sql
storage/migrations/clickhouse/002_metrics_rollups.sql
storage/test/metrics-routes.test.ts
storage/test/metrics-query-service.test.ts
storage/test/step-selection.test.ts
storage/README.md
```

File responsibilities:
- `server.ts`
  - boot Fastify
  - register auth and routes
- `config.ts`
  - validate env vars
- `lib/clickhouse.ts`
  - construct shared ClickHouse client
- `routes/metrics.ts`
  - implement `/api/v1/metrics/query` and `/api/v1/metrics/names`
- `metrics-query-service.ts`
  - choose raw vs rollup table
  - build ClickHouse queries
  - shape canonical metric responses
- `metrics-query-types.ts`
  - local TypeScript types that mirror the existing storage contract
- `step-selection.ts`
  - implement the exact step auto-selection rules from `INTERFACES.md`
- `run-clickhouse-migrations.ts`
  - apply SQL files in order
- `001_metrics.sql` and `002_metrics_rollups.sql`
  - define schema already specified in `docs/storage-design.md`
- test files
  - validate contract compliance for the metrics path

### 5.8 What This Scaffold Intentionally Does Not Include

To keep the scaffold minimal and within current storage scope, it should not include:
- log or trace handlers yet
- background workers beyond migration execution
- ORM layers
- Docker orchestration files
- client SDKs
- auth redesign beyond checking the existing `X-Api-Key`
- PostgreSQL integration before it is needed for a storage-owned endpoint

## 6. Validation

- The plan chooses a concrete language/runtime, folder location, API server approach, migration layout, config approach, test approach, and initial file set.
- The plan stays aligned with `INTERFACES.md` and does not change endpoint paths, field names, or payload shapes.
- The plan remains within storage ownership and only scaffolds what is needed to start the metrics path.

## 7. Open issues

- The plan assumes Node.js and TypeScript are acceptable for the first storage implementation. That is a scaffold choice, not a contract change.
- Query implementation details for percentile aggregation against raw histogram-style metric rows will need to follow the existing storage design exactly when code is written.
