# Alerts Subsystem Design

**Agent:** Alerts  
**Stage:** Shared parallel design (Phase 1)  
**Status:** Draft aligned to `INTERFACES.md`

---

## 1. Objective

Design the alerting subsystem so its monitor model, evaluation flow, notification behavior, and public API conform to the canonical contracts in `INTERFACES.md`.

---

## 2. Scope

**In scope:**
- Monitor and incident model owned by alerts
- Evaluation scheduling and condition evaluation
- Notification dispatch and deduplication
- Alerts-owned API endpoints in `INTERFACES.md` §8.4
- How alerts consumes the query API in `INTERFACES.md` §7

**Out of scope:**
- Query API redesign
- Storage schema redesign outside alerts-owned state
- Ingestion transport or identity normalization
- Frontend transport beyond the published alerts API
- Anomaly monitors in the current contract

---

## 3. Contract Alignment

`INTERFACES.md` is authoritative for all cross-subsystem behavior. This design adopts these decisions directly:

- Public monitor `status` values are only `ok`, `alerting`, and `no_data`.
- Public alert APIs live under `/api/v1/alerts/...`, not `/api/v1/monitors`.
- Monitor scope uses canonical fields `service_name` and `environment`.
- Metric evaluation uses `GET /api/v1/metrics/query` with `start`, `end`, `agg`, `group_by`, and `filter[...]`.
- Log-count evaluation uses `GET /api/v1/logs` with structured parameters and `count_only=true`. There is no alerts-specific log DSL.
- Query windows use `[start, end)` semantics.
- `truncated: true` is treated as an evaluation error and must not change public monitor status.
- Alert evaluation windows must not exceed the 30-day raw retention limit from `INTERFACES.md` §9.

---

## 4. Monitor Model

### 4.1 Public Monitor Object

The monitor object served to other subsystems matches `INTERFACES.md` §8.1 exactly.

```typescript
type MonitorStatus = "ok" | "alerting" | "no_data";
type MonitorSeverity = "info" | "warning" | "critical";
type MonitorType = "threshold" | "change" | "log_count" | "missing_data";

interface Monitor {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  type: MonitorType;
  service_name: string;          // "" means platform-wide
  environment: string;           // "" means all environments
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

For monitors without grouping, `breaching_groups` is either empty or contains a single element with `labels: {}`.

### 4.2 Alerts-Local Evaluation Spec

Alerts still needs condition and scheduling details to evaluate a monitor. Those fields are alerts-owned implementation details and must not redefine the cross-subsystem monitor object above.

```typescript
type ComparisonOperator = "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
type Aggregation = "avg" | "min" | "max" | "sum" | "count" | "p50" | "p95" | "p99";

interface MonitorSpec {
  monitor_id: string;
  interval_seconds: number;              // minimum 60
  group_by: string[];                    // maps to metric query `group_by`
  no_data_timeframe_seconds: number | null;
  renotify_interval_seconds: number | null;
  notification_policy: NotificationPolicy;
  condition: Condition;
}

type Condition =
  | ThresholdCondition
  | ChangeCondition
  | LogCountCondition
  | MissingDataCondition;

interface ThresholdCondition {
  type: "threshold";
  name: string;
  agg: Aggregation;
  window_seconds: number;
  filters: Record<string, string>;
  operator: ComparisonOperator;
  threshold: number;
  recovery_threshold?: number;
}

interface ChangeCondition {
  type: "change";
  name: string;
  agg: Aggregation;
  window_seconds: number;
  compare_window_seconds: number;
  filters: Record<string, string>;
  change_type: "absolute" | "percent";
  operator: ComparisonOperator;
  threshold: number;
}

interface LogCountCondition {
  type: "log_count";
  search?: string;
  severity_min?: number;
  window_seconds: number;
  operator: ComparisonOperator;
  threshold: number;
}

interface MissingDataCondition {
  type: "missing_data";
  signal: "metric" | "log";
  name?: string;                         // metric only
  filters: Record<string, string>;
  search?: string;                       // log only
  severity_min?: number;                 // log only
  expected_interval_seconds: number;
  window_seconds: number;
}
```

### 4.3 Scope Rules

- `service_name` and `environment` on the monitor are coarse scope fields used for display and service summaries.
- Metric tags and log filters remain condition-level filters.
- Grouping dimensions use canonical keys, for example `service_name`, `host`, or signal tag keys such as `http.method`.
- Alerts rejects monitor configs whose `window_seconds` or `compare_window_seconds` exceed `2_592_000`.

### 4.4 Deferred Types

`anomaly` is intentionally out of the current public monitor contract because `INTERFACES.md` §8.1 does not include it. Any future anomaly work requires a coordinated contract change before implementation.

---

## 5. State Model

Each monitor has one public status and zero or more breaching groups.

```
 [ok] -- threshold breached --> [alerting] -- recovered --> [ok]
   |                               |
   |                               +-- data absent long enough --> [no_data]
   +-- data absent long enough --> [no_data] -- data resumes and not breaching --> [ok]
```

| Status | Meaning |
|---|---|
| `ok` | Last successful evaluation found no active breach |
| `alerting` | One or more groups are currently breaching |
| `no_data` | Required data has been absent for at least `no_data_timeframe_seconds` |

### 5.1 Transition Rules

- `ok -> alerting`: evaluation succeeds and at least one group breaches.
- `alerting -> ok`: evaluation succeeds and no groups breach.
- `ok -> no_data` or `alerting -> no_data`: the query result remains empty long enough to satisfy `no_data_timeframe_seconds`.
- `no_data -> ok`: data resumes and the condition is not breaching.
- `no_data -> alerting`: data resumes and the condition is breaching.

### 5.2 Acknowledgement

`POST /api/v1/alerts/monitors/:id/acknowledge` is supported by the contract, but acknowledgement is not a public monitor status. It is operator metadata attached to the active incident/transition history and does not change `status`.

### 5.3 Internal Evaluation Errors

Alerts may track internal evaluation outcomes such as query failures or truncated responses, but those internal states are not exposed as monitor `status`. When evaluation fails, the public monitor remains at its last good status and `last_evaluated_at` still records the attempt time.

---

## 6. Evaluation Flow

```
Scheduler
  -> select enabled monitors
  -> build canonical query request
  -> call query API
  -> reject truncated results
  -> compute breaching groups
  -> apply no-data timer
  -> write monitor status + history
  -> emit notification events on transitions or renotify intervals
```

### 6.1 Shared Rules

- All evaluation windows use `[start, end)` and ISO 8601 request timestamps.
- Evaluations are idempotent for the tuple `(monitor_id, labels, evaluation_end)`.
- Empty results alone do not trigger `no_data`; absence must persist for the configured duration.
- If the query API returns an error or `truncated: true`, alerts records an internal evaluation failure and does not change public `status`.

### 6.2 Metric Monitor Queries

Threshold, change, and metric-based missing-data monitors call `GET /api/v1/metrics/query` exactly as defined in `INTERFACES.md` §7.1.

```typescript
interface MetricEvaluationRequest {
  start: string;
  end: string;
  name: string;
  environment?: string;
  service_name?: string;
  agg?: Aggregation;
  group_by?: string;                 // comma-separated
  [filter: `filter[${string}]`]: string;
}
```

Evaluation behavior:

- Alerts sets `service_name` and `environment` from the monitor when present.
- Alerts maps `MonitorSpec.group_by` to the query `group_by` parameter.
- Alerts reads `series[].labels` as the canonical group identity.
- Alerts uses the latest point in each series within the returned range as the current value to compare.

### 6.3 Log Count Queries

Log-count and log-based missing-data monitors call `GET /api/v1/logs` with structured parameters only.

```typescript
interface LogCountEvaluationRequest {
  start: string;
  end: string;
  environment?: string;
  service_name?: string;
  severity_min?: number;
  search?: string;
  count_only: true;
}
```

Evaluation behavior:

- Alerts does not send a query DSL string.
- `count_only=true` is required for log-count evaluation.
- A `count` of zero participates in no-data tracking and threshold comparison exactly as defined in `INTERFACES.md` §8.5.

### 6.4 Change Monitors

Change monitors perform two metric queries over adjacent windows:

- current window: `[end - window_seconds, end)`
- comparison window: `[end - window_seconds - compare_window_seconds, end - window_seconds)`

Alerts compares the aggregated values per matching `labels` set. Missing comparison groups are treated as insufficient data and do not trigger unless the monitor is already in `no_data`.

---

## 7. Notification Model

### 7.1 Notification Policy

```typescript
interface NotificationPolicy {
  on_alert: boolean;
  on_recovery: boolean;
  on_no_data: boolean;
  channels: NotificationChannel[];
  message_template?: string;
}
```

### 7.2 Channels

```typescript
type NotificationChannel = EmailChannel | WebhookChannel;

interface EmailChannel {
  type: "email";
  addresses: string[];
}

interface WebhookChannel {
  type: "webhook";
  url: string;
  secret?: string;
  headers?: Record<string, string>;
}
```

### 7.3 Event Payload

```typescript
interface AlertEvent {
  event_id: string;
  monitor_id: string;
  monitor_name: string;
  status: MonitorStatus;
  previous_status: MonitorStatus;
  transition_at: string;
  labels: Record<string, string>;
  value?: number;
  threshold?: number;
  service_name: string;
  environment: string;
  message: string;
}
```

### 7.4 Delivery Rules

- Notifications are emitted on `ok -> alerting`, `ok -> no_data`, `alerting -> ok`, and `no_data -> ok` when the corresponding notification policy flag is enabled.
- `renotify_interval_seconds` applies only while public status remains `alerting`.
- Deduplication key: `(monitor_id, labels, status, transition_at)`.
- Delivery is best-effort in the current phase. Retry queues remain a later hardening item.

---

## 8. Persistence Owned by Alerts

Alerts owns PostgreSQL persistence for:

- monitor records matching the public object in `INTERFACES.md` §8.1
- monitor evaluation specs used internally by the evaluator
- current breaching groups per monitor
- state transition history for `GET /api/v1/alerts/monitors/:id/history`
- acknowledgement metadata for active incidents
- notification delivery log

Storage reads alerts-owned current monitor state when serving service summaries that include `active_alert_count`, as defined in `INTERFACES.md` §7.8.

---

## 9. Alerts API Surface

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

Contract notes:

- `GET /api/v1/alerts/monitors` returns monitor objects with current `status`.
- `GET /api/v1/alerts/incidents` lists monitors whose public status is `alerting` or `no_data`.
- Frontend polls `GET /api/v1/alerts/monitors` every 30 seconds. Alerts does not provide SSE or WebSocket delivery in this phase.

---

## 10. Open Issues

| # | Issue | Owner | Status |
|---|---|---|---|
| 1 | Webhook delivery retry queue and durability model | Alerts | Deferred to hardening |
| 2 | Notification rate limiting and backoff policy | Alerts | Deferred to hardening |
| 3 | Anomaly monitor contract addition | Alerts + Reviewer + affected agents | Deferred until `INTERFACES.md` amendment |

---

## 11. Implementation Plan

1. Implement alerts-owned PostgreSQL schema for monitor objects, monitor specs, breaching groups, transition history, and notification log.
2. Implement `POST/GET/PUT/DELETE /api/v1/alerts/monitors` and `GET /api/v1/alerts/incidents` against the canonical monitor object.
3. Implement the in-process scheduler for enabled monitors.
4. Implement threshold, change, log-count, and missing-data evaluators using the canonical query API.
5. Enforce `truncated` handling, `[start, end)` window semantics, and the 30-day evaluation window limit.
6. Implement notification dispatch for email and webhook channels.
