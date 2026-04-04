# Frontend Implementation Plan

**Agent:** Frontend
**Date:** 2026-04-02
**Status:** Planning only

---

## 1. Objective

Define a minimal, practical implementation scaffold for the frontend subsystem so contract-defined UI work can start in this repo without inventing new shared contracts.

This plan stays within frontend ownership:

- dashboards
- service pages
- logs / traces / metrics UI
- navigation
- client-side query consumption

This plan does not change `INTERFACES.md`.

---

## 2. Chosen Scaffold

### 2.1 Language and Runtime

- Language: TypeScript
- Runtime: Node.js 22 LTS for tooling and local development

Rationale:

- TypeScript gives direct typing for the response shapes already defined in `INTERFACES.md`.
- Node.js tooling is the most practical baseline for a frontend SPA in this repo.

### 2.2 Folder Location

Create the frontend app under:

`apps/frontend/`

This keeps implementation separate from the current top-level contract and design docs while remaining inside the frontend agent's ownership boundary.

### 2.3 Framework and App Structure

Use:

- React
- Vite
- React Router

Minimal app shape:

```text
apps/frontend/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── public/
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── router.tsx
│   │   ├── providers.tsx
│   │   └── layout/
│   ├── pages/
│   │   ├── dashboard/
│   │   ├── services/
│   │   ├── logs/
│   │   ├── traces/
│   │   └── alerts/
│   ├── components/
│   │   ├── charts/
│   │   ├── tables/
│   │   ├── filters/
│   │   └── layout/
│   ├── features/
│   │   ├── metrics/
│   │   ├── services/
│   │   ├── logs/
│   │   ├── traces/
│   │   └── alerts/
│   ├── lib/
│   │   ├── api/
│   │   ├── time/
│   │   ├── format/
│   │   └── env/
│   ├── state/
│   ├── styles/
│   └── test/
└── tests/
```

Why this shape:

- `pages/` maps directly to the routes already defined in `docs/frontend-design.md`
- `features/metrics/` contains the contract-specific metric picker, query hooks, and chart adapters
- `lib/api/` keeps raw request/response handling centralized so canonical field names remain intact at the boundary

### 2.4 Rendering Model

Use a client-rendered SPA.

Rationale:

- the current frontend contract is query-API driven
- no server-rendering requirements are defined in `INTERFACES.md`
- a SPA is the smallest practical scaffold for dashboard, service, logs, traces, and metrics flows

---

## 3. Config Approach

### 3.1 Environment Variables

Frontend config should be limited to deployment/runtime concerns, not contract changes.

Initial config:

- `VITE_API_BASE_URL`
- `VITE_API_KEY`

Use:

- `VITE_API_BASE_URL` for the `/api/v1` host prefix
- `VITE_API_KEY` for the `X-Api-Key` header required by `INTERFACES.md`

No frontend config should rename query params or response fields from the contract.

### 3.2 API Client Rules

Create a small typed fetch layer in `apps/frontend/src/lib/api/` with these rules:

- always send `X-Api-Key`
- preserve canonical request params: `start`, `end`, `environment`, `service_name`, `name`, `step`, `agg`, `group_by`, `filter[...]`, `cursor`
- preserve canonical response fields exactly as returned by the API
- convert units only in presentation helpers, not in transport models

### 3.3 Shared State

Keep the initial global state minimal:

- `environment`
- `timeRange`
- optional current `service_name`

This matches `docs/frontend-design.md` and avoids inventing broader app state.

---

## 4. Metrics UI Path

This scaffold must support the contract-defined metrics path first.

### 4.1 Metrics Data Flow

1. Load metric names from `GET /api/v1/metrics/names`
2. User selects a metric
3. Request series from `GET /api/v1/metrics/query`
4. Render `series[].labels` and `series[].points[]`
5. Surface `truncated` when present

### 4.2 Metrics Feature Ownership

Place initial metrics-specific code under:

`apps/frontend/src/features/metrics/`

Initial responsibilities:

- request builders for metric names and metric query endpoints
- transport types that mirror `INTERFACES.md`
- chart data adapters that consume `series[].labels` and `series[].points[]`
- UI controls for metric selection and aggregation selection

### 4.3 Metrics Page Integration

Initial route consumers:

- service detail metrics tab
- overview dashboard metric cards and charts

The scaffold must not invent metric endpoints beyond:

- `GET /api/v1/metrics/names`
- `GET /api/v1/metrics/query`

---

## 5. Test Approach

### 5.1 Unit and Component Tests

Use:

- Vitest
- React Testing Library

Primary initial test targets:

- query parameter construction for metric requests
- handling of `series`, `labels`, `points`, and `truncated`
- formatting helpers for latency/unit display
- route-level rendering of empty, loading, and error states

### 5.2 API Mocking

Use:

- Mock Service Worker (MSW)

Reason:

- it allows frontend tests to exercise the contract-defined HTTP surface without inventing backend behavior
- it supports realistic responses for `GET /api/v1/metrics/names` and `GET /api/v1/metrics/query`

### 5.3 End-to-End Tests

Use:

- Playwright

Initial E2E scope:

- app boot
- navigate to services page
- open service detail
- open metrics tab
- select metric
- verify chart renders from contract-shaped mocked responses

Keep E2E coverage narrow initially. The scaffold should start with one working contract path, not broad test sprawl.

---

## 6. Initial Files To Create

These are the first files the frontend scaffold should add in a later implementation turn.

### 6.1 Root App Files

- `apps/frontend/package.json`
- `apps/frontend/tsconfig.json`
- `apps/frontend/vite.config.ts`
- `apps/frontend/index.html`
- `apps/frontend/.env.example`

### 6.2 App Boot Files

- `apps/frontend/src/main.tsx`
- `apps/frontend/src/app/router.tsx`
- `apps/frontend/src/app/providers.tsx`
- `apps/frontend/src/app/layout/AppShell.tsx`

### 6.3 API Layer

- `apps/frontend/src/lib/api/client.ts`
- `apps/frontend/src/lib/api/types.ts`
- `apps/frontend/src/lib/api/metrics.ts`
- `apps/frontend/src/lib/api/environments.ts`
- `apps/frontend/src/lib/api/services.ts`

### 6.4 Metrics Feature Files

- `apps/frontend/src/features/metrics/types.ts`
- `apps/frontend/src/features/metrics/api.ts`
- `apps/frontend/src/features/metrics/hooks.ts`
- `apps/frontend/src/features/metrics/components/MetricsPicker.tsx`
- `apps/frontend/src/features/metrics/components/MetricsChart.tsx`
- `apps/frontend/src/features/metrics/components/MetricsState.tsx`

### 6.5 Initial Pages

- `apps/frontend/src/pages/dashboard/OverviewPage.tsx`
- `apps/frontend/src/pages/services/ServicesListPage.tsx`
- `apps/frontend/src/pages/services/ServiceDetailPage.tsx`

### 6.6 Test Files

- `apps/frontend/src/test/setup.ts`
- `apps/frontend/src/test/msw/server.ts`
- `apps/frontend/src/test/msw/handlers.ts`
- `apps/frontend/src/features/metrics/api.test.ts`
- `apps/frontend/src/features/metrics/components/MetricsPicker.test.tsx`
- `apps/frontend/src/features/metrics/components/MetricsChart.test.tsx`
- `apps/frontend/tests/metrics-ui.spec.ts`

---

## 7. Practical Non-Goals

The initial scaffold should not include:

- SSR or full-stack app infrastructure
- custom backend proxy contracts
- dashboard persistence APIs
- alert rule editing flows
- custom query DSLs
- non-contract field aliases

These can be added later only if required by future frontend work and still aligned to `INTERFACES.md`.

---

## 8. Recommended Next Implementation Step

In the first implementation turn after scaffold creation:

1. create the Vite + React + TypeScript app under `apps/frontend/`
2. build the typed API client with `X-Api-Key` support
3. implement the service detail metrics tab path using `GET /api/v1/metrics/names` and `GET /api/v1/metrics/query`
4. add MSW-backed tests for the metric request/response contract

This is the smallest practical path from docs-only state to a working frontend feature aligned to the existing contracts.
