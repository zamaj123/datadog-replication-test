# Frontend Design

**Agent:** Frontend  
**Stage:** Phase 2 implementation design  
**Status:** Aligned to `INTERFACES.md`

---

## 1. Objective

Implement a TypeScript frontend for the observability platform using the canonical query APIs defined in `INTERFACES.md`.

This document keeps the UI scope from the earlier design but replaces the stale backend-facing implementation assumptions with a concrete React + TypeScript architecture.

---

## 2. Plan

1. Build a React + TypeScript SPA
2. Organize the app by feature and page rather than backend endpoint drift
3. Use one typed API client layer against the canonical query API
4. keep global filters aligned to the canonical field names and params
5. support overview, services, logs, traces, and trace detail in Phase 2

---

## 3. Files to Change

- `docs/frontend-design.md`
- `tasks/frontend.md`

---

## 4. Assumptions

- Runtime is Node.js 22 LTS for development and build tooling.
- Frontend stack is React + Vite + TypeScript.
- Data fetching uses a typed client layer plus a query library for caching and pagination.
- The frontend consumes only the query API. It does not call ClickHouse directly and does not implement alternate endpoint shapes.

---

## 5. Application Architecture

Recommended structure:

```text
apps/web/
  src/
    app/
      router.tsx
      providers.tsx
      layout.tsx
    pages/
      dashboard-overview-page.tsx
      services-page.tsx
      service-summary-page.tsx
      logs-page.tsx
      traces-page.tsx
      trace-detail-page.tsx
    features/
      dashboard/
      services/
      metrics/
      logs/
      traces/
    components/
      app-shell/
      charts/
      tables/
      filters/
    api/
      client.ts
      metrics.ts
      logs.ts
      traces.ts
      services.ts
      environments.ts
    state/
      app-filters.ts
    lib/
      format.ts
      time.ts
```

Principles:

- route files compose features
- feature modules own UI logic
- API modules own canonical endpoint calls
- display formatting stays separate from transport models

---

## 6. Global State

Global state should use canonical concepts:

| State key | Type | Purpose |
|---|---|---|
| `environment` | `string \| null` | global environment filter |
| `timeRange` | `{ start: string; end: string }` | global ISO 8601 query range |
| `selectedServiceName` | `string \| null` | route-driven service context |

Do not carry old aliases such as `env`, `from`, or `to` in the main application state.

---

## 7. Routing

Keep the existing page structure:

- `/dashboard/overview`
- `/services`
- `/services/:service_name`
- `/logs`
- `/traces`
- `/traces/:trace_id`

The route parameter should be treated as `service_name`, even if the URL segment stays `/services/:service_name`.

- `service_name`
- `environment`
- `last_seen`
- `active_alert_count`

## 8. Data Fetching

Use a query library such as TanStack Query.

Responsibilities:

- cache results by canonical params
- support cursor-based pagination
- deduplicate overlapping requests
- centralize retry and error handling

Query keys should include:

- `start`
- `end`
- `environment`
- endpoint-specific filters

- metric picker from `GET /api/v1/metrics/names?service_name=...&environment=...`
- one or more charts backed by `GET /api/v1/metrics/query`

## 9. API Integration Rules

The frontend should call only these canonical endpoints:

- `GET /api/v1/metrics/query`
- `GET /api/v1/metrics/names`
- `GET /api/v1/logs`
- `GET /api/v1/logs/volume`
- `GET /api/v1/traces`
- `GET /api/v1/traces/:trace_id`
- `GET /api/v1/services`
- `GET /api/v1/services/:service_name/summary`
- `GET /api/v1/environments`

Do not implement clients for superseded paths such as:

- `/api/v1/logs/query`
- `/api/v1/traces/query`
- `/api/v1/metrics`

### 9.1 Parameter Rule

Use:

- `start`
- `end`
- `environment`
- `service_name`
- `search`
- `severity_min`
- `step`
- `agg`

Do not use:

- `from`
- `to`
- `env`
- `service`
- `q`
- `level`
- `interval`

---

## 10. Page Implementation Notes

### 10.1 Overview Dashboard

Use:

- services summary endpoint for service table
- metrics query endpoint for request rate, error rate, and latency charts
- log volume endpoint for severity histogram

### 10.2 Services Page

Use `GET /api/v1/services`.

Display conversions:

- `p99_latency_ns` should be formatted into milliseconds in the UI
- `error_rate` should be displayed as a percentage

### 10.3 Service Detail Page

Use:

- `GET /api/v1/services/:service_name/summary`
- `GET /api/v1/metrics/names`
- `GET /api/v1/metrics/query`
- `GET /api/v1/logs`
- `GET /api/v1/traces`

### 10.4 Log Explorer

Use:

- `GET /api/v1/logs`
- `GET /api/v1/logs/volume`

Display fields:

- `severity_text` for visible badges
- `severity_number` for threshold and filter behavior when needed
- `service_name`
- `environment`

### 10.5 Trace Explorer

Use:

- `GET /api/v1/traces`
- `GET /api/v1/traces/:trace_id`

Display conversions:

- `duration_ns` to human-readable milliseconds
- lowercase `status` to styled badges

The frontend must not depend on uppercase status values.

---

## 11. Shared Type Strategy

Frontend transport models should come from a shared TypeScript contracts package derived from `INTERFACES.md`.

Rules:

- no local duplicate API type definitions when a shared contract exists
- no alias translation layer that renames canonical fields into legacy names
- formatting helpers may derive display strings, but raw response types remain canonical

---

## 12. UX and State Boundaries

The frontend owns:

- view composition
- charting and formatting
- route state
- user filter persistence

The frontend does not own:

- backend rollup policy
- endpoint aliases
- response reshaping away from the canonical contract

---

## 13. Validation

- [ ] global filter state uses `start`, `end`, and `environment`
- [ ] API clients call only canonical endpoints
- [ ] no stale query params remain in the implementation design
- [ ] logs UI uses `severity_text` and `severity_number` rather than `level`
- [ ] traces UI expects lowercase `status` and `duration_ns`
- [ ] service pages use `service_name` and `environment`
- [ ] cursor pagination is used for logs and traces

---

## 14. Open Issues

- If custom dashboards are implemented later, they should reuse the same canonical API client layer rather than inventing a second query abstraction.
- If SSR is ever introduced, it should not change the frontend contract assumptions in this document.
