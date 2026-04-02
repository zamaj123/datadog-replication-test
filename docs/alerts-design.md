# Alerts Subsystem Design

**Agent:** Alerts  
**Stage:** Shared parallel design (Phase 1)  
**Status:** Aligned to `INTERFACES.md`

---

## 1. Objective

Define the alerts subsystem in terms of the canonical contracts in `INTERFACES.md`, with no alternate monitor schema, query API, or endpoint surface.

---

## 2. Scope

**In scope:**
- Monitor objects and current monitor status
- Evaluation scheduling and condition evaluation
- Alerts-owned API endpoints in `INTERFACES.md` §8.4
- Alerts consumption of the shared query API in `INTERFACES.md` §7
- Notification dispatch triggered by monitor state changes

**Out of scope:**
- Query API redesign
- Storage schema redesign outside alerts-owned PostgreSQL state
- Ingestion schema or transport changes
- Frontend transport changes

---

## 3. Source Of Truth

`INTERFACES.md` is authoritative for alerts.

This design adopts these contract decisions directly:

- Public monitor types are only `threshold`, `change`, `log_count`, and `missing_data`.
- Public monitor `status` values are only `ok`, `alerting`, and `no_data`.
- Monitor scope fields are `service_name` and `environment`.
- Alerts consumes the shared query API through `GET /api/v1/metrics/query` and `GET /api/v1/logs`.
- Alerts API endpoints live under `/api/v1/alerts/...`.
- Query ranges use `[start, end)`.
- `truncated: true` never changes public monitor status.
- Monitor evaluation windows must not exceed 30 days.

---

## 4. Monitor Object

The alerts subsystem serves the monitor object exactly as defined in `INTERFACES.md` §8.1.

```typescript
type MonitorType = "threshold" | "change" | "log_count" | "missing_data";
type MonitorStatus = "ok" | "alerting" | "no_data";
type MonitorSeverity = "info" | "warning" | "critical";

interface Monitor {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  type: MonitorType;
  service_name: string;
  environment: string;
  severity: MonitorSeverity;
  status: MonitorStatus;
  triggered_at: string | null;
  resolved_at: string | null;
  last_evaluated_at: string;
  created_at: string;
  updated_at: string;
  breaching_groups: BreachingGroup[];
}

interface BreachingGroup {
  labels: Record<string, string>;
  value: number;
}
```

Contract rules:

- `service_name == ""` means platform-wide scope.
- `environment == ""` means all environments.
- `breaching_groups` is empty when `status == "ok"`.
- For monitors without grouping, there is at most one breaching group with `labels: {}`.

---

## 5. Public State Model

The public monitor state model matches `INTERFACES.md` §8.

| Status | Meaning |
|---|---|
| `ok` | No current breach |
| `alerting` | One or more groups are breaching |
| `no_data` | Required data has been absent long enough to satisfy the monitor's no-data timer |

State rules:

- `ok -> alerting` when a successful evaluation finds one or more breaches.
- `alerting -> ok` when a successful evaluation finds no active breaches.
- `ok -> no_data` or `alerting -> no_data` only after absence persists for `no_data_timeframe_seconds`.
- `no_data -> ok` when data resumes and the condition is not breaching.
- `no_data -> alerting` when data resumes and the condition is breaching.

`POST /api/v1/alerts/monitors/:id/acknowledge` is part of the API contract, but acknowledgement is not a public `status` value.

---

## 6. Evaluation Contract

Alerts evaluates enabled monitors on a scheduler and uses the shared query API exactly as defined in `INTERFACES.md` §7 and §8.5.

### 6.1 Shared Evaluation Rules

- Every query uses ISO 8601 `start` and `end` parameters.
- Every evaluation window follows `[start, end)`.
- Alerts records `last_evaluated_at` on each evaluation attempt.
- Query failures do not change public monitor `status`.
- `truncated: true` produces an internal evaluation failure and does not change public monitor `status`.
- Empty results alone do not trigger `no_data`; absence must persist for the configured duration.
- Monitor creation must reject any evaluation window over `2_592_000` seconds.

### 6.2 Metric Monitors

Threshold, change, and metric-based missing-data monitors call:

```text
GET /api/v1/metrics/query
```

Alerts uses the canonical request parameters from `INTERFACES.md` §7.1:

- `start`
- `end`
- `name`
- `environment`
- `service_name`
- `agg`
- `group_by`
- `filter[<key>]`

Alerts reads:

- `series[].labels` as the group identity
- `points[].timestamp` and `points[].value` as the returned time series
- `truncated` before evaluating the condition

When `group_by` is present on the monitor, alerts sends the same dimensions in the metric query and evaluates each returned label set independently.

### 6.3 Log Count Monitors

Log-count and log-based missing-data monitors call:

```text
GET /api/v1/logs
```

Alerts uses the canonical request parameters from `INTERFACES.md` §7.3:

- `start`
- `end`
- `environment`
- `service_name`
- `severity_min`
- `search`
- `count_only=true`

Alerts does not define or depend on any log query DSL.

When `count_only=true`, alerts evaluates the returned `count` and checks `truncated` before changing state.

### 6.4 No-Data Handling

No-data behavior follows `INTERFACES.md` §8.5 exactly:

- metrics: no data begins when the response `series` array is empty
- log count: no data begins when `count == 0`
- public `status` changes to `no_data` only after the configured absence duration elapses

---

## 7. Alerts API

The alerts subsystem exposes exactly these endpoints from `INTERFACES.md` §8.4:

```text
POST   /api/v1/alerts/monitors
GET    /api/v1/alerts/monitors
GET    /api/v1/alerts/monitors/:id
PUT    /api/v1/alerts/monitors/:id
DELETE /api/v1/alerts/monitors/:id
GET    /api/v1/alerts/monitors/:id/history
POST   /api/v1/alerts/monitors/:id/acknowledge
GET    /api/v1/alerts/incidents
```

Frontend integration rules:

- Frontend polls `GET /api/v1/alerts/monitors` every 30 seconds.
- Alerts does not provide WebSocket or SSE state delivery in this phase.
- `GET /api/v1/alerts/incidents` returns monitors whose public `status` is `alerting` or `no_data`.

---

## 8. Persistence

Per `INTERFACES.md` §8.1 and §7.8:

- monitor objects are stored in PostgreSQL
- alerts writes current monitor state that storage reads for `active_alert_count`

This document does not define an alternate storage contract beyond those requirements.

---

## 9. Implementation Notes

Implementation work in alerts must preserve the contract above:

1. Persist and serve the canonical `Monitor` object.
2. Evaluate monitor types `threshold`, `change`, `log_count`, and `missing_data` only.
3. Use the shared query API without adding wrappers or alternate request shapes.
4. Keep public status semantics limited to `ok`, `alerting`, and `no_data`.
