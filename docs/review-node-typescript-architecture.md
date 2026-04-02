# Reviewer Proposal — Unified Node.js + TypeScript Architecture

**Author:** Reviewer Agent  
**Date:** 2026-04-02  
**Status:** Proposed replacement for the implementation sections of:

- `docs/ingestion-design.md`
- `docs/storage-design.md`
- `docs/frontend-design.md`

## 1. Objective

Provide one implementation architecture for ingestion, storage/query, and frontend that:

- uses Node.js + TypeScript end to end
- conforms to `INTERFACES.md` without redefining contracts
- replaces the divergent implementation ideas currently described in the subsystem docs
- is realistic for Phase 2 and extensible for later phases

## 2. Current Integration Status

Current `integration` status is structurally improved but still not implementation-ready:

- `INTERFACES.md` is now the source of truth for all cross-subsystem contracts.
- The ingestion, storage, and frontend docs still describe incompatible implementation assumptions and stale field names.
- `docs/review-alignment.md` already records those remaining mismatches.

The implication is simple: implementation should not follow the current subsystem implementation sections. It should follow `INTERFACES.md` plus the architecture in this document.

## 3. Replacement Decision

This document should replace the implementation direction of the three subsystem docs in the following way:

- Replace ingestion’s Go-style service/module structure and storage write-API assumption.
- Replace storage’s mixed “schema plus API sketch” implementation direction with a Node.js query service over ClickHouse and PostgreSQL.
- Replace frontend’s backend-facing implementation assumptions with a TypeScript web app built directly against the canonical query API in `INTERFACES.md`.

This is an implementation architecture replacement, not a contract change.

## 4. Stack

### 4.1 Languages and Runtimes

- Node.js 22 LTS
- TypeScript with strict mode enabled across all apps and packages

### 4.2 Core Frameworks

- Ingestion API: Fastify
- Query API: Fastify
- Frontend: React + Vite + TypeScript
- Shared validation: Zod
- Database access:
  - ClickHouse HTTP client for telemetry writes and queries
  - PostgreSQL via `pg`
- Background scheduling:
  - in-process timers only where required in later phases
  - no queue system required for Phase 2 ingestion/storage/frontend

### 4.3 Infrastructure

- ClickHouse for metrics, logs, spans, and trace index
- PostgreSQL for metadata and alert monitor state later
- Redis is optional and deferred until query caching or alert state pressure justifies it

## 5. Top-Level Architecture

The platform should be implemented as three Node.js applications in one TypeScript monorepo:

1. `apps/ingestion`
2. `apps/query-api`
3. `apps/web`

There should not be a separate storage write service. Storage ownership remains the ClickHouse schema, SQL migrations, and query layer, but the write path follows `INTERFACES.md`:

```text
SDK / OTel HTTP client
  -> ingestion (Fastify)
  -> direct ClickHouse HTTP INSERT ... FORMAT JSONEachRow

browser
  -> web app (React/Vite)
  -> query-api (Fastify)
  -> ClickHouse / PostgreSQL
```

## 6. Monorepo Layout

```text
apps/
  ingestion/
    src/
      server/
      routes/
      pipeline/
      normalization/
      clickhouse/
      config/
  query-api/
    src/
      server/
      routes/
      services/
      repositories/
      clickhouse/
      postgres/
      config/
  web/
    src/
      app/
      pages/
      features/
      components/
      api/
      state/
      lib/

packages/
  contracts/
    src/
      ingestion.ts
      query.ts
      alerts.ts
      shared.ts
  config/
    src/
      env.ts
  clickhouse/
    src/
      client.ts
      sql/
  observability/
    src/
      logging.ts
      metrics.ts
      tracing.ts
  ui/
    src/
      components/
      theme/

schema/
  clickhouse/
    001_metrics.sql
    002_logs.sql
    003_spans.sql
    004_trace_index_mv.sql
  postgres/
    001_metadata.sql
```

## 7. Shared Package Responsibilities

### 7.1 `packages/contracts`

Purpose:

- encode the canonical request and response shapes from `INTERFACES.md`
- provide Zod schemas plus inferred TypeScript types
- prevent drift between ingestion, query-api, and web

Rules:

- field names must exactly match `INTERFACES.md`
- no alternate aliases such as `service`, `env`, `from`, `to`, `metric`, or `level`

### 7.2 `packages/config`

Purpose:

- centralize environment parsing and validation
- keep all service env var names explicit and typed

### 7.3 `packages/clickhouse`

Purpose:

- thin shared ClickHouse HTTP client wrapper
- SQL helpers for inserts and read queries
- no ORM abstraction

This layer should stay small. ClickHouse behavior is too specific for a generic repository abstraction to add value.

## 8. Ingestion Service Design

### 8.1 Responsibilities

`apps/ingestion` owns:

- `POST /v1/metrics`
- `POST /v1/logs`
- `POST /v1/traces`
- API key validation
- OTel resource normalization to canonical fields
- partial batch validation behavior
- in-memory batching and ClickHouse writes

It does not own:

- query APIs
- trace assembly
- `trace_index` maintenance

### 8.2 Internal Pipeline

Each request should flow through these stages:

1. authenticate using `X-Api-Key`
2. parse request body with Zod
3. normalize OTel resource attributes to `service_name`, `environment`, `host`, `version`
4. validate signal-specific fields against the canonical ingestion schemas
5. convert timestamps to nanoseconds where SDK payloads are in milliseconds
6. expand histograms into multiple metric rows
7. map logs to `log_id`, `severity_number`, `severity_text`, and stringified attributes
8. compute span `duration_ns`
9. append valid rows to signal-specific in-memory buffers
10. flush to ClickHouse in batches of 1000 rows or every 500ms

### 8.3 Runtime Shape

Recommended internal modules:

```text
src/
  server/app.ts
  routes/metrics.ts
  routes/logs.ts
  routes/traces.ts
  pipeline/handle-metrics.ts
  pipeline/handle-logs.ts
  pipeline/handle-traces.ts
  normalization/resource.ts
  normalization/severity.ts
  normalization/timestamps.ts
  clickhouse/writer.ts
  clickhouse/buffer.ts
  config/env.ts
```

### 8.4 Why This Replaces the Existing Ingestion Idea

This design replaces the prior ingestion implementation idea because it:

- uses Node.js + TypeScript instead of the Go-style package layout currently documented
- removes the fictional storage write API
- aligns directly with the direct ClickHouse write path required by `INTERFACES.md`

## 9. Storage and Query Design

### 9.1 Storage Ownership Split

Storage should be implemented as two things:

1. schema ownership
2. query service ownership

That means:

- ClickHouse DDL lives in `schema/clickhouse`
- PostgreSQL DDL lives in `schema/postgres`
- runtime query behavior lives in `apps/query-api`

There is no standalone “storage service” for writes.

### 9.2 ClickHouse Schema Strategy

Use the canonical field names in actual table columns where possible. Do not rely on internal renames like `service`, `env`, `metric_name`, or `operation` if the API and ingestion contracts use `service_name`, `environment`, and `name`.

Recommended tables:

- `metrics`
- `metrics_1m`
- `metrics_1h`
- `logs`
- `spans`
- `trace_index`

Recommended rule:

- raw table schemas should stay close to the canonical payload names so debugging and inserts remain straightforward
- response shaping logic belongs in `query-api`, not in bespoke per-consumer SQL

### 9.3 `trace_index`

Implement `trace_index` as a ClickHouse materialized view owned by storage, derived from `spans`.

That avoids:

- duplicate writes from ingestion
- root-span detection logic in the ingestion service
- contract drift around trace summary ownership

### 9.4 Query API Service

`apps/query-api` should own all `GET /api/v1/...` endpoints from `INTERFACES.md`.

Its responsibilities:

- validate query parameters with shared contracts
- translate canonical API filters into ClickHouse SQL
- read service metadata or alert counts from PostgreSQL when required
- return only canonical response shapes

Recommended structure:

```text
src/
  server/app.ts
  routes/metrics.ts
  routes/logs.ts
  routes/traces.ts
  routes/services.ts
  routes/environments.ts
  services/metrics-query-service.ts
  services/logs-query-service.ts
  services/traces-query-service.ts
  services/services-query-service.ts
  repositories/clickhouse-metrics.ts
  repositories/clickhouse-logs.ts
  repositories/clickhouse-traces.ts
  repositories/postgres-services.ts
  config/env.ts
```

### 9.5 Query Service Rules

- Keep SQL close to the repository layer; do not bury query logic in route handlers.
- Normalize all timestamps to ISO 8601 at the API edge.
- Use cursor-based pagination for logs and traces only.
- Enforce `truncated` semantics in the service layer so frontend and alerts receive consistent behavior.
- Implement step auto-selection in one shared metrics query module, not separately per endpoint.

### 9.6 Why This Replaces the Existing Storage Idea

This design replaces the prior storage implementation idea because it:

- stops treating storage as both a write API and a query sketch
- turns storage into a concrete Node.js query service plus owned schema migrations
- keeps all runtime backend code in TypeScript while preserving ClickHouse as the actual telemetry store

## 10. Frontend Design

### 10.1 Application Shape

`apps/web` should be a React + TypeScript SPA built with Vite.

Use feature-oriented organization:

```text
src/
  app/
    router.tsx
    providers.tsx
  pages/
    dashboard-overview-page.tsx
    services-page.tsx
    service-summary-page.tsx
    logs-page.tsx
    traces-page.tsx
    trace-detail-page.tsx
  features/
    metrics/
    logs/
    traces/
    services/
  api/
    client.ts
    metrics.ts
    logs.ts
    traces.ts
    services.ts
    environments.ts
  state/
    app-filters.ts
```

### 10.2 State Model

Global UI state should be limited to:

- `environment`
- `timeRange`
- optional selected service in route context

Do not encode old aliases like `env`, `from`, or `to` in frontend state or API clients. Internal naming should match the canonical API names.

### 10.3 API Integration Rules

- The frontend should call only the canonical `query-api`.
- Every API client function should be typed from `packages/contracts`.
- Frontend display conversions such as `duration_ns -> ms` should happen in view helpers, not in API response models.
- Query keys and cache scopes should include `start`, `end`, `environment`, and endpoint-specific filters.

### 10.4 UI Data-Fetching

Use a query library such as TanStack Query for:

- caching
- deduplication
- cursor pagination
- loading/error states

This is preferable to hand-rolled fetch state because the platform has multiple filterable pages with overlapping query windows.

### 10.5 Why This Replaces the Existing Frontend Idea

This design replaces the prior frontend implementation direction because it:

- makes the frontend implementation explicitly TypeScript-based
- binds the web app to the canonical query API instead of stale endpoint shapes
- defines a concrete app structure rather than only information architecture

## 11. Deployment Shape

For Phase 2, run four containers:

1. `ingestion`
2. `query-api`
3. `web`
4. `clickhouse`

Plus PostgreSQL when service metadata or alerts work requires it.

Recommended local development:

- `web` on `5173`
- `query-api` on `3000`
- `ingestion` on `3001`
- ClickHouse on `8123`

The browser should only talk to `query-api`. Instrumented apps should only talk to `ingestion`.

## 12. Non-Goals

This replacement architecture does not add:

- Kafka or any durable queue
- a separate internal storage write service
- microservice decomposition beyond ingestion/query/web
- GraphQL
- multi-tenant partitioning in Phase 2
- SSR requirements for the frontend

Those would increase complexity before the core telemetry path is proven.

## 13. Phase Plan

### Phase 2

- implement `apps/ingestion`
- implement ClickHouse schemas and materialized views
- implement `apps/query-api`
- implement `apps/web` overview, services, logs, traces

### Phase 3

- add rollup tuning
- add custom dashboards
- add stronger query caching if needed
- add more aggressive query optimization and service map derivations

### Phase 4

- add alerts service against the existing query API
- read active alert counts into service summary responses

## 14. Validation

This design is valid if the following are true:

- `apps/ingestion` can implement `INTERFACES.md §6` without inventing new storage interfaces
- `apps/query-api` can serve every endpoint in `INTERFACES.md §7`
- the frontend can consume the query API without alias translation layers
- shared TypeScript contracts prevent field-name drift across the three apps
- ClickHouse remains the only telemetry write target

## 15. Open Issues

- The subsystem docs should be updated or explicitly superseded so engineers do not implement against the stale implementation sections.
- If the team wants one backend process instead of separate `ingestion` and `query-api`, that is feasible in Node.js, but it should still remain two logical modules with separate routes and config. My recommendation is two services for operational clarity.
