# Ingestion Implementation Plan

**Agent:** Ingestion  
**Status:** Proposed scaffold only  
**Contract source:** `INTERFACES.md`

---

## 1. Objective

Define a concrete, minimal implementation scaffold for the ingestion subsystem that:

- follows `INTERFACES.md` exactly for external and ingestion-to-storage contracts
- follows the Node.js + TypeScript implementation direction from the reviewer architecture guidance
- stays within ingestion ownership
- does not implement code yet

---

## 2. Runtime and Language

**Choice:** Node.js 22 LTS + TypeScript

### Reasoning

- This matches the reviewer’s unified implementation direction for backend services.
- It fits the initial product target of a Dockerized Node.js application ecosystem.
- It avoids introducing a mixed-language backend before any runtime code exists in the repo.
- It is sufficient for HTTP intake, JSON validation, in-memory batching, and ClickHouse HTTP writes without adding infrastructure complexity.

This is an implementation-stack choice only. It does not change any contract in `INTERFACES.md`.

---

## 3. Folder Location in This Repo

The ingestion service code should live under:

```text
apps/ingestion/
```

This aligns with the reviewer’s monorepo direction while staying limited to ingestion scope.

Docs remain in `docs/`. Task tracking remains in `tasks/`.

---

## 4. Minimal Server Framework

**Choice:** Fastify

### Why Fastify

- Minimal setup for JSON HTTP APIs
- Good request/response performance for telemetry intake
- Straightforward hook/middleware model for `X-Api-Key` auth
- Simple route registration for `/v1/metrics`, `/v1/logs`, and `/v1/traces`
- Works cleanly with TypeScript without introducing framework-heavy conventions

This should be a single ingestion service process exposing the canonical ingestion API:

- `POST /v1/metrics`
- `POST /v1/logs`
- `POST /v1/traces`

The service writes directly to ClickHouse over HTTP. It must not introduce a storage write API.

---

## 5. Config Approach

Use environment-based config loaded at process startup and validated in one ingestion-owned config module.

### Required contract config

From `INTERFACES.md`:

- `INGESTION_API_KEY`
- `CLICKHOUSE_HOST`
- `CLICKHOUSE_PORT`
- `CLICKHOUSE_DATABASE`
- `CLICKHOUSE_USER`
- `CLICKHOUSE_PASSWORD`

### Additional local runtime config

Allowed only for service operation, not contract changes:

- `PORT`
- optional flush tuning values only if they default to the contract values and do not alter the documented behavior

### Validation approach

Use a small typed config module that:

- reads environment variables once at startup
- validates required values
- fails fast on missing required configuration
- exports one typed config object to the rest of the app

---

## 6. Test Approach

Use the standard Node.js TypeScript service testing split:

- **unit tests** for normalization, validation, timestamp conversion, and histogram expansion
- **route tests** for `/v1/metrics`, `/v1/logs`, and `/v1/traces` request handling behavior
- **writer tests** for batching and ClickHouse HTTP request shaping

### Minimal tooling

- test runner: Vitest
- HTTP route testing: Fastify inject

### Required initial test coverage

The first scaffold should be designed to support tests for:

- missing or invalid `X-Api-Key`
- invalid `Content-Type`
- missing `service_name` or `environment` after normalization
- millisecond-to-nanosecond timestamp conversion
- malformed metric tag keys
- histogram expansion into bucket rows plus `_count` and `_sum`
- partial-batch accepted/rejected responses
- buffer flush threshold behavior

---

## 7. Minimal Project Structure

The initial scaffold should create only the files needed to establish the service shape:

```text
apps/
  ingestion/
    package.json
    tsconfig.json
    src/
      server/
        app.ts
        start.ts
      routes/
        metrics.ts
        logs.ts
        traces.ts
      pipeline/
        handle-metrics.ts
        handle-logs.ts
        handle-traces.ts
      normalization/
        resource.ts
        timestamps.ts
        severity.ts
      clickhouse/
        client.ts
        writer.ts
        buffer.ts
      config/
        env.ts
      types/
        metrics.ts
        logs.ts
        traces.ts
    test/
      metrics.route.test.ts
      metrics.pipeline.test.ts
      resource-normalization.test.ts
```

---

## 8. Initial Files to Create

The first scaffold should create these files under `apps/ingestion/`:

### Project files

- `package.json`
- `tsconfig.json`

### Server entrypoints

- `src/server/app.ts`
- `src/server/start.ts`

### Route registration

- `src/routes/metrics.ts`
- `src/routes/logs.ts`
- `src/routes/traces.ts`

### Ingestion pipeline

- `src/pipeline/handle-metrics.ts`
- `src/pipeline/handle-logs.ts`
- `src/pipeline/handle-traces.ts`

### Normalization and validation support

- `src/normalization/resource.ts`
- `src/normalization/timestamps.ts`
- `src/normalization/severity.ts`

### ClickHouse write path

- `src/clickhouse/client.ts`
- `src/clickhouse/writer.ts`
- `src/clickhouse/buffer.ts`

### Config

- `src/config/env.ts`

### Local ingestion types

- `src/types/metrics.ts`
- `src/types/logs.ts`
- `src/types/traces.ts`

### Initial tests

- `test/metrics.route.test.ts`
- `test/metrics.pipeline.test.ts`
- `test/resource-normalization.test.ts`

This is the smallest practical scaffold that supports the contract-defined ingestion pipeline without adding unrelated framework structure.

---

## 9. Service Shape

The scaffold should support one Fastify process with these responsibilities:

1. authenticate requests using `X-Api-Key`
2. parse JSON request bodies
3. normalize OTel resource attributes into canonical top-level identity fields
4. validate signal-specific event payloads against `INTERFACES.md`
5. convert timestamps to nanoseconds at the ingestion-to-storage boundary
6. expand histogram metrics into canonical rows
7. buffer accepted rows in memory
8. flush rows directly to ClickHouse with `FORMAT JSONEachRow`
9. return `202` partial-batch results in the contract shape

This process owns ingestion only. It does not own:

- query APIs
- trace assembly
- `trace_index` maintenance
- a storage write API

---

## 10. Metrics-First Delivery Slice

The first implementation slice should focus on the metrics path while keeping the scaffold ready for logs and traces.

### First slice

1. scaffold `apps/ingestion`
2. add env parsing and server startup
3. register `/v1/metrics`, `/v1/logs`, `/v1/traces`
4. fully implement `/v1/metrics`
5. add resource normalization and timestamp conversion helpers
6. add in-memory buffering and ClickHouse HTTP writer
7. add metrics-path tests

### Why this is minimal

- Metrics are fully defined in `INTERFACES.md`
- Histogram expansion is the most distinctive ingestion-specific transform
- It proves the direct ClickHouse write path without inventing any new subsystem boundary

Logs and traces should be scaffolded at the route and pipeline level but not implemented in the first code pass if the goal is the smallest practical start.

---

## 11. Contract Alignment Rules

The scaffold must preserve these contract decisions:

- `INTERFACES.md` field names remain canonical
- identity fields are top-level at the ingestion-to-storage boundary
- timestamps are nanoseconds at the ingestion-to-storage boundary
- ingestion writes directly to ClickHouse HTTP
- ingestion uses `X-Api-Key`
- batching remains 1000 rows or 500ms
- `trace_index` remains storage-owned

The scaffold must not introduce:

- a storage write service
- alternate field aliases such as `service`, `env`, `metric`, or `level`
- a different API shape for `/v1` ingestion routes
- a different batching contract

---

## 12. Open Issues

- The exact package-manager choice is intentionally left open in this scaffold plan because it does not affect the ingestion contract. The initial scaffold can use the repo’s eventual monorepo standard when implementation begins.
