# Alerts Subsystem Design

**Agent:** Alerts  
**Stage:** Shared parallel design (Phase 1)  
**Status:** Draft

---

## 1. Objective

Design the alerting subsystem: rule model, evaluation engine, notification flow, and the explicit interface contracts this subsystem requires from storage/query.

---

## 2. Scope

**In scope:**
- Monitor/rule data model
- Alert state machine
- Evaluation scheduling and condition evaluation
- Notification channels and routing
- API shapes for CRUD on monitors and for consuming query results

**Out of scope:**
- Storage internals (schema, index design)
- Ingestion transport
- Frontend UI beyond API contract
- Auth/RBAC (deferred to Phase 6)

---

## 3. Core Concepts

| Term | Definition |
|---|---|
| **Monitor** | A named, persistent rule that defines what to watch and when to fire |
| **Condition** | The evaluable expression within a monitor (threshold, change, anomaly, log, missing data) |
| **Evaluation** | One execution of a condition against query results at a point in time |
| **Alert** | An instance of a monitor entering a non-OK state |
| **Notification** | A message dispatched to a channel when alert state changes |
| **Resolution** | A monitor returning to OK state after being in ALERT or NO_DATA |

---

## 4. Monitor Model

```typescript
interface Monitor {
  id: string;                        // UUID
  name: string;
  description?: string;
  type: MonitorType;
  condition: Condition;
  evaluation: EvaluationConfig;
  notification_policy: NotificationPolicy;
  tags: Record<string, string>;      // e.g. { service: "api", env: "prod" }
  state: MonitorState;
  created_at: string;                // ISO 8601
  updated_at: string;
  enabled: boolean;
}

type MonitorType =
  | "threshold"        // metric crosses a static boundary
  | "change"           // metric changes by % or absolute delta over a window
  | "anomaly"          // statistical deviation from baseline
  | "log_count"        // log query result count crosses threshold
  | "missing_data";    // no data received in expected window
```

### 4.1 Condition Types

```typescript
type Condition =
  | ThresholdCondition
  | ChangeCondition
  | AnomalyCondition
  | LogCountCondition
  | MissingDataCondition;

interface ThresholdCondition {
  type: "threshold";
  query: MetricQuery;
  aggregation: Aggregation;
  window_seconds: number;            // evaluation lookback window
  operator: ComparisonOperator;      // gt | gte | lt | lte | eq | neq
  threshold: number;
  recovery_threshold?: number;       // optional hysteresis value
}

interface ChangeCondition {
  type: "change";
  query: MetricQuery;
  aggregation: Aggregation;
  window_seconds: number;            // current period window
  compare_window_seconds: number;    // prior period to compare against
  change_type: "absolute" | "percent";
  operator: ComparisonOperator;
  threshold: number;
}

interface AnomalyCondition {
  type: "anomaly";
  query: MetricQuery;
  aggregation: Aggregation;
  window_seconds: number;
  sensitivity: "low" | "medium" | "high";  // controls deviation band width
  direction: "above" | "below" | "either";
}

interface LogCountCondition {
  type: "log_count";
  query: LogQuery;
  window_seconds: number;
  operator: ComparisonOperator;
  threshold: number;
}

interface MissingDataCondition {
  type: "missing_data";
  query: MetricQuery | LogQuery;
  expected_interval_seconds: number;  // data should arrive at least this often
  window_seconds: number;             // how long absence must persist before firing
}

type Aggregation = "avg" | "max" | "min" | "sum" | "count" | "p50" | "p95" | "p99";
type ComparisonOperator = "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
```

### 4.2 Grouping (Multi-Dimensional Alerts)

A monitor can fire per-group rather than globally. Grouping is defined by a set of tag keys. When grouping is active, each distinct combination of tag values produces an independent alert state.

```typescript
interface EvaluationConfig {
  interval_seconds: number;         // how often to evaluate (minimum: 60)
  group_by?: string[];              // tag keys to split evaluation by, e.g. ["service", "host"]
  no_data_timeframe_seconds?: number;  // window before emitting NO_DATA state
  notify_no_data: boolean;
  renotify_interval_seconds?: number;  // re-alert if still firing after this interval
  flap_detection?: FlapDetection;
}

interface FlapDetection {
  enabled: boolean;
  high_threshold_pct: number;       // % of evals in ALERT to consider flapping
  low_threshold_pct: number;        // % of evals in ALERT to consider recovered
}
```

---

## 5. Alert State Machine

Each monitor (or per-group monitor instance) is always in exactly one state.

```
         ┌──────────────────────────────────────────────┐
         │                                              │
         ▼                                              │
      [OK] ──── condition fires ────► [ALERT] ──── resolves ───┘
         │                              │
         │                              └──── acknowledged ──► [ACKNOWLEDGED]
         │                                                           │
         └───────────────────────────── resolves ───────────────────┘
         │
         └──── no data received ──► [NO_DATA]
                                        │
                                        └──── data returns ──► [OK]
```

| State | Meaning |
|---|---|
| `OK` | Condition is not firing |
| `ALERT` | Condition has fired and is active |
| `NO_DATA` | Expected data has not arrived |
| `ACKNOWLEDGED` | Alert is active but an operator has acknowledged it |

**State transition rules:**
- `OK → ALERT`: condition evaluates to true for the configured number of consecutive evaluations (default: 1)
- `ALERT → OK`: condition evaluates to false (optionally: recovery_threshold must be met)
- `* → NO_DATA`: no query results returned within `no_data_timeframe_seconds`
- `NO_DATA → OK`: data resumes and condition is false
- `ALERT → ACKNOWLEDGED`: operator action via API; does not suppress re-notification unless renotify is disabled
- `ACKNOWLEDGED → OK`: condition resolves

---

## 6. Evaluation Flow

```
Scheduler
  │
  ├── tick every interval_seconds per enabled monitor
  │
  └── Evaluator
        │
        ├── build query (MetricQuery or LogQuery) with time range [now - window, now]
        │
        ├── call Query API  ◄──── depends on: Query subsystem contract (§8.1)
        │
        ├── aggregate results (apply aggregation function)
        │
        ├── evaluate condition against aggregated value
        │
        ├── determine group keys (if group_by is set)
        │
        ├── compare to previous state per group
        │
        ├── write state transition to Alert Store  ◄──── depends on: Alert Store (§8.2)
        │
        └── emit state-change events to Notification Dispatcher
```

### 6.1 Evaluation Guarantees

- Evaluations are idempotent for the same `(monitor_id, group_key, evaluation_timestamp)` tuple — safe to retry on failure.
- If the Query API returns an error, the evaluator records `EVAL_ERROR` status but does not change monitor state.
- `NO_DATA` state is only emitted after `no_data_timeframe_seconds` has elapsed with no results, not on a single empty evaluation.

### 6.2 Anomaly Evaluation

Anomaly detection requires a baseline. The evaluator requests a historical window (configurable, default: 1 week at the same hour/day-of-week) from the Query API and computes a rolling mean ± N standard deviations. The band width is determined by `sensitivity`. This is a first-pass statistical model; more sophisticated seasonality models are a later enhancement.

---

## 7. Notification Model

### 7.1 Notification Policy

```typescript
interface NotificationPolicy {
  on_alert: boolean;             // notify when entering ALERT
  on_recovery: boolean;          // notify when returning to OK
  on_no_data: boolean;           // notify on NO_DATA transition
  channels: NotificationChannel[];
  message_template?: string;     // optional override; supports template variables
}
```

### 7.2 Notification Channels

```typescript
type NotificationChannel =
  | EmailChannel
  | WebhookChannel
  | SlackChannel;             // future

interface EmailChannel {
  type: "email";
  addresses: string[];
}

interface WebhookChannel {
  type: "webhook";
  url: string;
  secret?: string;             // HMAC signing secret for payload verification
  headers?: Record<string, string>;
}

interface SlackChannel {
  type: "slack";
  webhook_url: string;         // Slack incoming webhook URL
}
```

### 7.3 Notification Payload

All channels receive a normalized payload. Channel-specific adapters format it for delivery.

```typescript
interface AlertEvent {
  event_id: string;              // UUID, unique per notification
  monitor_id: string;
  monitor_name: string;
  state: MonitorState;
  previous_state: MonitorState;
  transition_at: string;         // ISO 8601
  group_key?: Record<string, string>;  // e.g. { service: "api", host: "web-01" }
  condition_value?: number;      // the value that triggered (for threshold/change)
  threshold?: number;            // the configured threshold
  message: string;               // rendered message_template or default
  tags: Record<string, string>;
  links: {
    monitor: string;             // URL to monitor detail in UI
    dashboard?: string;          // URL to related dashboard if configured
  };
}
```

### 7.4 Notification Dispatcher

- Receives state-change events from the Evaluator.
- Applies `renotify_interval_seconds`: if monitor is still in ALERT, re-dispatches after interval without requiring a state change.
- Deduplications: will not dispatch duplicate events for the same `(monitor_id, group_key, state, transition_at)`.
- Delivery is best-effort for webhooks/email in Phase 4; at-least-once with retry queue is a Phase 5 hardening item.

---

## 8. Dependency Contracts (What Alerts Needs from Other Subsystems)

These are requirements, not implementation prescriptions.

### 8.1 Query Subsystem — Required API

The alerts evaluator must be able to call a query endpoint with the following shape. The query subsystem owns this contract and can implement it as it sees fit, but must satisfy this interface.

#### Metric Query

```typescript
interface MetricQuery {
  metric_name: string;
  filters: Record<string, string>;   // exact tag matches, e.g. { service: "api", env: "prod" }
  group_by?: string[];
}

interface MetricQueryRequest {
  query: MetricQuery;
  start: string;    // ISO 8601
  end: string;      // ISO 8601
  step_seconds?: number;  // resolution; omit for raw points
}

interface MetricQueryResponse {
  series: MetricSeries[];
  truncated: boolean;       // true if result was capped
}

interface MetricSeries {
  labels: Record<string, string>;   // tag values for this series (includes group_by keys)
  points: Array<{ t: string; v: number }>;
}
```

#### Log Query

```typescript
interface LogQuery {
  filter: string;               // query DSL or lucene-style filter expression — format TBD with storage agent
  filters: Record<string, string>;  // structured tag filters applied in addition to free-text filter
}

interface LogQueryRequest {
  query: LogQuery;
  start: string;
  end: string;
  limit?: number;               // for count-based alert conditions, evaluator only needs count
  count_only?: boolean;         // optimization hint: return count, not full log bodies
}

interface LogQueryResponse {
  count: number;
  entries?: LogEntry[];         // omitted if count_only=true
  truncated: boolean;
}

interface LogEntry {
  timestamp: string;
  service: string;
  level?: string;
  message: string;
  labels: Record<string, string>;
}
```

**Open question for storage/query agent:** What is the format of `LogQuery.filter`? Alerts agent needs a defined DSL or pattern-match spec to construct log queries programmatically.

### 8.2 Alert Store — Required Persistence

The alerts subsystem requires persistence for the following entities. The storage agent owns schema; alerts declares what must be queryable.

| Entity | Must support |
|---|---|
| `monitors` | CRUD by id; list by enabled=true; filter by tags |
| `alert_states` | Read/write current state per `(monitor_id, group_key)`; history of last N transitions |
| `notification_log` | Append-only log of dispatched notifications; query by monitor_id and time range |
| `evaluation_log` | Append-only log of evaluations with result; used for debugging and flap detection |

### 8.3 Identity Fields — Required on All Telemetry

For group-by and filtering to work, the alerts subsystem requires that ingested metrics and logs carry at minimum:

| Field | Type | Required |
|---|---|---|
| `service` | string | yes |
| `env` | string | yes |
| `host` | string | yes for metrics, recommended for logs |
| `timestamp` | ISO 8601 | yes |

Additional tag dimensions are optional and pass through the query/filter model unchanged.

---

## 9. REST API Surface (Alerts Subsystem Exposes)

These endpoints are consumed by the frontend and by external tooling.

```
POST   /api/v1/monitors              create monitor
GET    /api/v1/monitors              list monitors (query params: enabled, tag filters)
GET    /api/v1/monitors/:id          get monitor detail + current state
PUT    /api/v1/monitors/:id          update monitor
DELETE /api/v1/monitors/:id          delete monitor

GET    /api/v1/monitors/:id/history  alert state history
POST   /api/v1/monitors/:id/mute     mute notifications for a duration
POST   /api/v1/monitors/:id/unmute   unmute
POST   /api/v1/monitors/:id/acknowledge  acknowledge an active alert

GET    /api/v1/alerts                list all currently active alerts (state=ALERT|NO_DATA)
GET    /api/v1/alerts/:id            get alert detail (alert = one state transition instance)
```

---

## 10. Open Issues

| # | Issue | Owner | Status |
|---|---|---|---|
| 1 | Log query filter DSL format | Storage/Query agent | Blocking log-count alert implementation |
| 2 | Anomaly baseline: should historical window queries be cached, or is query layer responsible for caching? | Query agent | Open |
| 3 | Webhook delivery retry policy: in-process queue vs. external job queue | Alerts agent | Deferred to Phase 5 |
| 4 | Should `ACKNOWLEDGED` state suppress re-notification? Needs product decision | — | Open |
| 5 | Multi-condition (composite) monitors — AND/OR of multiple conditions | Alerts agent | Deferred to Phase 4 iteration 2 |
| 6 | Rate limiting for notification channels | Alerts agent | Deferred to Phase 5 |

---

## 11. Implementation Plan (Phase 4)

1. Implement monitor CRUD API and persistence
2. Implement evaluation scheduler (poll-based, in-process for Phase 4)
3. Implement threshold and change evaluators (simplest; unblocked)
4. Implement log_count evaluator (blocked on log query DSL — issue #1)
5. Implement notification dispatcher with email and webhook channels
6. Implement missing_data evaluator
7. Implement anomaly evaluator (blocked on query caching clarity — issue #2)
8. Frontend API integration (frontend agent consumes the REST API above)
