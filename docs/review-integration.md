# Integration Review — Pre-Design Conflict Analysis and Contract Proposals

**Author:** Reviewer Agent
**Date:** 2026-04-02
**Input docs reviewed:** `PRODUCT.md`, `ARCHITECTURE.md`, `tasks/*.md`, `docs/review-design.md`
**Note on subsystem design docs:** As of this writing, `docs/ingestion-design.md`, `docs/storage-design.md`, `docs/frontend-design.md`, and `docs/alerts-design.md` do not yet exist. All subsystem branches are at the initial commit. This review therefore operates prospectively: it documents the specific conflicts that will emerge if agents design in isolation, based on the known structure of observability platforms of this type, and proposes the concrete contracts that prevent them. This document should be read and agreed on by all agents before any subsystem design begins.

---

## 1. Conflicts Between Subsystems

### 1.1 Ingestion vs. Storage: Schema Mismatches

These are not hypothetical. They are the canonical failure modes when an ingestion team and a storage team design independently.

**Conflict 1 — Timestamp format.**
Ingestion will pick one of: Unix milliseconds (common in JS), Unix nanoseconds (OTLP standard), Unix microseconds (some Postgres drivers), or RFC 3339 strings (human-readable JSON). Storage will independently pick whatever is native to its chosen engine. If they differ, every event arrives with a timestamp that must be re-parsed at write time, introducing both overhead and potential loss of precision. A trace span with microsecond timestamps written to a storage column expecting milliseconds silently truncates precision, breaking duration calculations.

**Required decision:** one timestamp format for all signal types, enforced at the ingestion boundary. Proposed: Unix nanoseconds (int64) as the canonical form. Rationale: highest precision, OTLP-native, no string parsing, trivially downsampled.

**Conflict 2 — Tag/label representation.**
Ingestion will likely represent metadata as `Map<string, string>` in JSON (the natural form for HTTP intake). Storage will want to either normalize tags into indexed columns (for metrics), store as a flat string (for logs), or use a nested document (for traces). If ingestion passes arbitrary nested objects and storage expects a flat string map, the write path must transform — but no one will have specified that transformation, so both will handle it partially.

**Required decision:** canonical tag representation is `Map<string, string>` with a defined maximum entry count. Storage may index however it chooses internally, but the handoff format from ingestion is a flat string-to-string map.

**Conflict 3 — Metric type encoding.**
A counter, gauge, and histogram are fundamentally different storage structures. Ingestion will receive them from agents in different shapes (a counter is a single number, a histogram is a bucket list). If ingestion normalizes all metrics into a single `{name, value, tags}` structure, histograms will be either dropped or mangled. Storage will not be able to compute correct percentiles from mangled histogram data.

**Required decision:** metric type is a required field. Histograms must carry their bucket boundaries and counts as a structured payload, not as a single `value` field. Ingestion must pass all three types to storage in type-preserving form.

**Conflict 4 — Log severity representation.**
Ingestion receives severity strings from application agents in any format: `"ERROR"`, `"error"`, `"ERR"`, `"40"`, `"4"`. If ingestion normalizes to an integer enum and storage expects a string, or vice versa, any log query using `level = "error"` will return zero results. Frontend will display an empty log explorer.

**Required decision:** canonical internal form for log severity is an integer enum. Ingestion is responsible for mapping all incoming string forms to this enum before writing to storage.

**Conflict 5 — Trace span vs. trace container.**
PRODUCT.md requires trace ingestion and querying. The core model question is: does the ingestion API accept individual spans, or does it accept a complete trace (all spans for a trace_id in one request)? If ingestion accepts individual spans (the OTLP model), storage must assemble traces from spans on read. If ingestion accepts complete traces, it must buffer until the trace is complete before writing, which is fundamentally different pipeline logic. If agents assume different models, ingestion will write spans that storage never assembles into traces, and the trace explorer will show only root spans.

**Required decision:** ingestion accepts individual spans (no buffering). Storage is responsible for assembling spans into a queryable trace on write or read (implementation detail), but the ingestion-to-storage handoff is per-span.

---

### 1.2 Storage vs. Frontend: Query Mismatches

**Conflict 6 — Aggregation responsibility.**
Storage will naturally expose raw data retrieval: "give me all data points for metric X between T1 and T2." Frontend needs to render line charts, which require server-side aggregation (downsampling to chart resolution). If storage returns raw points, a 30-day chart with 10-second resolution metric data requires the client to process 259,200 data points per series. This will not work in a browser. Frontend will build its own aggregation layer in JavaScript. Storage will be surprised that no one calls its new aggregation endpoint when they add one in Phase 5.

**Required decision:** storage query API must support a `step` or `resolution` parameter that triggers server-side downsampling. This is a storage design constraint, not a frontend nicety. It must be in the query API contract before storage designs the query layer.

**Conflict 7 — Multi-signal correlation endpoint.**
PRODUCT.md lists "Correlation across metrics, logs, and traces" as a core capability. This requires either: (a) a query endpoint that joins across signal types server-side, or (b) a client that issues three queries and joins on identity fields. Option (b) is only viable if the identity fields are guaranteed to be consistent and the client can join on `trace_id`. Option (a) requires the storage layer to support cross-signal joins. Neither option has been chosen, and neither storage nor frontend has been told which to implement. If storage implements (b) and frontend implements (a), frontend will request a join endpoint that does not exist.

**Required decision:** correlation model must be declared. Proposed: client-side assembly using consistent identity fields (service_name, trace_id) for v1. This means storage only needs consistent field names, not a join API. Document this explicitly so frontend does not wait for a cross-signal endpoint.

**Conflict 8 — Service overview endpoint.**
Frontend's task describes a "Service detail view." To render a service overview (latency p50/p99, error rate, throughput, recent logs, active traces), frontend needs either: one "service summary" endpoint that returns pre-aggregated data across signal types, or five separate queries it assembles client-side. If storage does not design a service summary endpoint, frontend will issue five separate queries per page load, each against potentially different storage backends, with no guarantee of time-consistency between them.

**Required decision:** a `/v1/query/services/{service_name}/summary` endpoint shape must be agreed before storage designs its query API surface.

**Conflict 9 — Pagination models.**
Storage will implement pagination using whatever its engine supports — likely cursor-based (efficient for time-series) or keyset pagination. Frontend log explorers typically expect offset-based pagination ("give me page 3 of results") because users navigate by clicking page numbers. Cursor-based pagination cannot support "jump to page 3." If storage designs cursor-only pagination and frontend designs a paginated log table, the log explorer will not support page navigation.

**Required decision:** log and trace queries use cursor-based pagination. Frontend must design the log explorer UI to use "next page" navigation, not page numbers. This is a frontend constraint derived from storage reality, and frontend must know it before designing the log explorer component.

---

### 1.3 Alerts vs. Storage/Query: Mismatches

**Conflict 10 — Evaluation query vs. dashboard query.**
Frontend queries storage on demand (user-triggered). Alerts evaluates rules on a schedule — potentially hundreds of rules, each issuing a query every 30–60 seconds. These are architecturally different traffic patterns. A storage layer designed for interactive latency will buckle under sustained scheduled query load if no capacity separation exists. If alerts simply uses the same query API as frontend with no acknowledgment of this, the shared query layer becomes a bottleneck and both alert evaluations and dashboard loads degrade together.

**Required decision:** alerts evaluation must use a dedicated query path or the shared query API must document a rate/concurrency contract for evaluation queries. This is an architectural constraint, not an implementation detail.

**Conflict 11 — "No data" semantics.**
An alert rule with condition `metric X > threshold` must distinguish between: (a) the metric exists and is below threshold (OK), (b) the metric exists and is above threshold (ALERTING), and (c) the metric has not been reported for N minutes (NO DATA, which is often itself an alert condition). A storage query API that returns an empty result set for case (c) is indistinguishable from a query with no matching data. Alerts must know which case it is in to evaluate the rule correctly. If storage does not expose "last seen" metadata or a "no data" sentinel, alerts must implement its own absence detection by tracking expected reporting intervals — which is complex and error-prone.

**Required decision:** storage query API must return a `last_seen` timestamp or a boolean `has_data` field in results, not just an empty array, so alerts can distinguish absence from below-threshold.

**Conflict 12 — Group-by and multi-dimensional evaluation.**
A typical alert rule is: "error rate for any service in environment=production exceeds 5%." This requires a group-by query: compute error rate grouped by `service_name`, then threshold-evaluate each group independently. If the query API does not support `group_by`, alerts must either (a) query all data and aggregate in memory — which is untenable at scale — or (b) know all possible service names in advance and issue N individual queries, one per service. Neither is acceptable.

**Required decision:** metric query API must support `group_by` on tag dimensions. This is an alerts-driven requirement that storage must know before designing the query API.

**Conflict 13 — Evaluation window semantics.**
Alert rules evaluate over a time window (e.g., "p99 latency over the last 5 minutes exceeds 500ms"). The query API must support `start`, `end`, and `step` parameters with well-defined semantics for what happens at window boundaries. If storage returns inclusive-start/exclusive-end intervals and alerts computes inclusive-start/inclusive-end windows, the evaluation time range is off by one data point — small for most cases, but critical for high-cardinality, short-window rules.

**Required decision:** time range query semantics (inclusive/exclusive bounds) must be documented in the query API contract and must be identical for all consumers.

---

## 2. Missing Decisions That Will Block Implementation

### 2.1 Canonical Timestamp Format
- **Blocking:** Ingestion schema, storage schema, query API response format, frontend display logic, alert evaluation window computation.
- **Decision required:** one wire format (proposed: Unix nanoseconds int64 for internal representation; ISO 8601 string in query API responses for frontend consumption).

### 2.2 Canonical Tag/Label Key Names
- **Blocking:** Every cross-signal feature. If ingestion writes `service` and storage indexes `service_name` and alerts queries `svc`, cross-signal correlation returns empty results with no error.
- **Decision required:** exact string names for universal identity fields. See Section 4.1.

### 2.3 Trace Correlation Strategy
- **Blocking:** Frontend trace explorer, log-to-trace linking, alert rules on trace data.
- **Decision required:** are trace_id and span_id propagated through log events? If yes, how is this enforced at ingestion? If no, log-to-trace correlation is impossible regardless of UI design.

### 2.4 Metric Type Taxonomy
- **Blocking:** Ingestion payload schema, storage schema, alert rule evaluation (you cannot compute `rate()` on a gauge).
- **Decision required:** canonical list of supported metric types and their payload shapes. At minimum: `gauge`, `counter`, `histogram`. Derived types like `summary` can be deferred.

### 2.5 Authentication on the Ingestion API
- **Blocking:** Ingestion cannot design its intake API without knowing auth model. Frontend cannot make API calls to query layer without knowing auth model.
- **Decision required:** for v1, is ingestion unauthenticated (local/trusted network only), API-key authenticated (single key per deployment), or token-authenticated? This affects how the Node.js agent is configured by users.

### 2.6 Ingestion Acknowledgment Semantics
- **Blocking:** Whether a 200 from the ingestion API means "received" or "written to storage" changes the reliability guarantees the platform advertises. Affects whether agents need to retry on failure.
- **Decision required:** ingestion acks on receipt (at-least-once guarantee with possible storage delay) or on persistence (synchronous write path with higher latency). Proposed: ack on receipt for v1 with documented at-least-once semantics.

### 2.7 Retention Policy
- **Blocking:** Alert rules that reference data older than the retention window will fail. Frontend must not allow users to query outside the retention window. Storage must design with retention in mind (not bolt it on later).
- **Decision required:** default retention period per signal type. These may differ (metrics: 30 days, logs: 7 days, traces: 3 days is a common starting point).

### 2.8 Cardinality Limits
- **Blocking:** Storage cannot design indexing without knowing the maximum number of unique tag value combinations. Frontend cannot design tag filter UI without knowing what to expect.
- **Decision required:** maximum tag count per event, maximum unique tag values per key. These are hard limits enforced at ingestion.

---

## 3. Terminology Inconsistencies to Resolve

Each of these inconsistencies will result in different subsystems using different terms for the same concept. That leads to confusion in code, naming conflicts in shared types, and UI labels that don't match the API field names.

| Concept | Likely ingestion term | Likely storage term | Likely frontend term | Likely alerts term | **Canonical term (proposed)** |
|---|---|---|---|---|---|
| Identifying name of the emitting service | `service` | `service_name` | `service` | `svc` | `service_name` |
| Deployment context (prod/staging) | `env` | `environment` | `environment` | `env` | `environment` |
| Key-value metadata on an event | `tags` | `labels` | `tags` | `dimensions` | `tags` |
| A single time-series data point | `data_point` | `sample` | `point` | `value` | `data_point` |
| A distributed trace tree | `trace` | `trace` | `trace` | `trace` | `trace` |
| An individual span within a trace | `span` | `span` | `span` | `operation` | `span` |
| The root span of a trace | `root_span` | `entry_span` | `root` | — | `root_span` |
| A triggered alert condition | `alert` | — | `alert` | `incident` | `alert` (the event), `monitor` (the rule) |
| The rule that defines an alert | `rule` | — | `monitor` | `monitor` | `monitor` |
| Log importance level | `level` | `severity` | `level` | — | `severity_level` → split: `severity` (int enum), `severity_text` (string) |
| A named grouping of services | — | — | `service_group` | — | defer to Phase 2 |

**Action required:** each agent must use the canonical term column when naming fields, API parameters, and UI labels. Deviations require a INTERFACES.md amendment, not a unilateral rename.

---

## 4. Proposed Unified Contract Layer

### 4.1 Canonical Identity Fields (All Signal Types)

These fields are required on every ingested event of every type. Ingestion must reject events missing required fields. Storage must index all required fields.

```
service_name  string   required  Logical service name. e.g. "checkout-api"
environment   string   required  Deployment environment. e.g. "production", "staging"
timestamp     int64    required  Unix nanoseconds (UTC). Must not be in the future by >60s.
host          string   optional  Hostname or pod name of the emitting process.
version       string   optional  Service version or git SHA. e.g. "v1.2.3" or "abc1234"
```

**Enforcement:** ingestion rejects any event where `service_name`, `environment`, or `timestamp` is absent or null. It does not reject events with unknown extra fields (forward-compatible intake).

---

### 4.2 Metric Event Schema

```json
{
  "service_name": "checkout-api",
  "environment": "production",
  "timestamp": 1743610032000000000,
  "host": "worker-1",
  "name": "http.request.duration",
  "type": "histogram",
  "unit": "ms",
  "tags": {
    "method": "POST",
    "route": "/v1/checkout",
    "status_code": "200"
  },
  "value": 143.2,
  "histogram": {
    "count": 1,
    "sum": 143.2,
    "buckets": [
      {"upper_bound": 50,  "count": 0},
      {"upper_bound": 100, "count": 0},
      {"upper_bound": 250, "count": 1},
      {"upper_bound": 500, "count": 1}
    ]
  }
}
```

Rules:
- `type` is required; must be one of: `gauge`, `counter`, `histogram`.
- `value` is required for `gauge` and `counter`. For `histogram`, `value` is the raw observation; `histogram` block is also required.
- `unit` is optional but recommended. Ingestion does not validate unit strings.
- `tags`: max 20 key-value pairs, keys max 64 chars, values max 256 chars. Keys must match `[a-z_][a-z0-9_]*`.
- Negative `counter` values must be rejected by ingestion.

---

### 4.3 Log Event Schema

```json
{
  "service_name": "checkout-api",
  "environment": "production",
  "timestamp": 1743610032000000000,
  "host": "worker-1",
  "severity": 17,
  "severity_text": "ERROR",
  "message": "Payment gateway timeout after 30s",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "attributes": {
    "http.method": "POST",
    "http.url": "/charge",
    "error.type": "TimeoutError"
  }
}
```

Rules:
- `severity` is required; integer using OpenTelemetry severity number scale (1–24). Ingestion must map common string forms: `"DEBUG"→5`, `"INFO"→9`, `"WARN"→13`, `"ERROR"→17`, `"FATAL"→21`. Unknown strings map to `0` (unspecified), not rejected.
- `severity_text` is optional; preserved as-is from the source for display.
- `message` is required; max 64KB. Ingestion truncates with a `[truncated]` suffix, does not reject.
- `trace_id` and `span_id` are optional but strongly recommended. When present, they must match the hex formats below.
- `attributes`: max 50 key-value pairs, values may be string, number, or boolean.

---

### 4.4 Trace Span Schema

```json
{
  "service_name": "checkout-api",
  "environment": "production",
  "host": "worker-1",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "parent_span_id": "b7ad6b7169203331",
  "operation_name": "POST /v1/checkout",
  "start_time": 1743610032000000000,
  "end_time":   1743610032143200000,
  "duration_ns": 143200000,
  "status": "ok",
  "status_message": "",
  "kind": "server",
  "attributes": {
    "http.method": "POST",
    "http.route": "/v1/checkout",
    "http.status_code": 200,
    "db.system": "postgresql"
  }
}
```

Rules:
- `trace_id`: required; 32 lowercase hex characters (128-bit).
- `span_id`: required; 16 lowercase hex characters (64-bit).
- `parent_span_id`: optional; absent or null indicates root span. When present, must be a valid 16-char hex string.
- `start_time`, `end_time`: both required; Unix nanoseconds. Ingestion must reject spans where `end_time < start_time`.
- `duration_ns`: ingestion computes this as `end_time - start_time`; if provided by the client, ingestion validates it matches (within 1ns tolerance) and rejects if it does not.
- `status`: required; enum `"unset" | "ok" | "error"`.
- `kind`: required; enum `"internal" | "server" | "client" | "producer" | "consumer"`.
- `attributes`: max 128 key-value pairs; values may be string, number, boolean, or array of string/number/boolean.

---

### 4.5 Ingestion API Contract

**Base path:** `/v1/ingest`
**Auth (v1):** API key via `X-Api-Key` header. Missing or invalid key returns 401. For v1, one global API key per deployment.

| Method | Path | Body | Success | Notes |
|--------|------|------|---------|-------|
| POST | `/v1/ingest/metrics` | `{"metrics": [...]}` | 202 | Batch of metric events |
| POST | `/v1/ingest/logs` | `{"logs": [...]}` | 202 | Batch of log events |
| POST | `/v1/ingest/traces` | `{"spans": [...]}` | 202 | Batch of spans (not complete traces) |

**Ack semantics:** 202 means "received and queued for storage." It does not mean "written to storage." Callers should implement retry with exponential backoff on 5xx. 4xx errors are not retried (validation failure).

**Error response format:**
```json
{
  "status": 400,
  "error": "validation_failed",
  "message": "3 of 10 events rejected",
  "rejected": [
    {"index": 2, "reason": "missing required field: service_name"},
    {"index": 5, "reason": "timestamp in future by 300s"},
    {"index": 9, "reason": "counter value is negative: -1.5"}
  ]
}
```

Partial batches are accepted: valid events in a batch are processed even if some events are rejected. The response indicates which indices were rejected and why.

**Content-Type:** `application/json` for all endpoints in v1. OTLP/protobuf may be added in a later phase via `/v1/ingest/otlp`.

---

### 4.6 Query API Contract

**Base path:** `/v1/query`
**Auth:** same API key mechanism as ingestion.

#### Metric range query
```
GET /v1/query/metrics
  ?name=http.request.duration       required
  &service_name=checkout-api        optional
  &environment=production           optional
  &start=1743610032000000000        required, Unix ns
  &end=1743610032143200000          required, Unix ns
  &step=60000000000                 optional, Unix ns, default = auto
  &group_by=method,route            optional, comma-separated tag keys
  &agg=avg                          optional, default=avg; options: avg,sum,min,max,p50,p90,p95,p99
  &tags[method]=POST                optional, tag filter
```

Response:
```json
{
  "name": "http.request.duration",
  "step_ns": 60000000000,
  "series": [
    {
      "tags": {"method": "POST", "route": "/v1/checkout"},
      "data_points": [
        {"timestamp": 1743610032000000000, "value": 143.2},
        {"timestamp": 1743610092000000000, "value": 156.8}
      ]
    }
  ],
  "has_data": true,
  "last_seen_ns": 1743610032000000000
}
```

`has_data: false` and an empty `series` array is returned when no data exists for the query window. `last_seen_ns` is the timestamp of the most recent data point for this metric name + tag combination, regardless of the query window. Alerts uses this to detect "no data" conditions.

#### Log search
```
GET /v1/query/logs
  ?service_name=checkout-api        optional
  &environment=production           optional
  &start=1743610032000000000        required
  &end=1743610092000000000          required
  &severity_min=13                  optional, integer
  &q=payment+timeout                optional, full-text search string
  &trace_id=4bf92f3577b34da6a...    optional
  &limit=100                        optional, default=100, max=1000
  &cursor=<opaque string>           optional, for pagination
```

Response:
```json
{
  "logs": [...],
  "next_cursor": "<opaque string or null>",
  "total_matched": 1432
}
```

`total_matched` is an estimate. `next_cursor` is null when no more results exist. Clients must not assume offset-based behavior — the only navigation supported is forward-cursor.

#### Trace search
```
GET /v1/query/traces
  ?service_name=checkout-api        optional
  &environment=production           optional
  &start=1743610032000000000        required
  &end=1743610092000000000          required
  &status=error                     optional, enum: ok|error|unset
  &duration_min_ns=100000000        optional
  &limit=50                         optional, default=50, max=500
  &cursor=<opaque string>           optional
```

Response:
```json
{
  "traces": [
    {
      "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
      "root_service_name": "checkout-api",
      "root_operation_name": "POST /v1/checkout",
      "start_time": 1743610032000000000,
      "duration_ns": 143200000,
      "status": "error",
      "span_count": 12
    }
  ],
  "next_cursor": null
}
```

#### Trace detail
```
GET /v1/query/traces/{trace_id}
```

Response: full span tree for the trace. Spans are returned flat, sorted by `start_time`. Clients assemble the tree using `parent_span_id`.

#### Service summary
```
GET /v1/query/services/{service_name}/summary
  ?environment=production           optional
  &window_ns=300000000000           optional, default=5min
```

Response:
```json
{
  "service_name": "checkout-api",
  "environment": "production",
  "window_ns": 300000000000,
  "request_rate": 142.3,
  "error_rate": 0.023,
  "p50_latency_ns": 43200000,
  "p95_latency_ns": 143200000,
  "p99_latency_ns": 312000000,
  "active_alerts": 1,
  "last_seen_ns": 1743610032000000000
}
```

This endpoint exists so that a service list page can be rendered with one query per service, not five. Storage is responsible for implementing this with appropriate pre-aggregation. Frontend must not implement the aggregation client-side.

**Time range semantics:** all time ranges are `[start, end)` — inclusive start, exclusive end. All consumers must use this convention. Alert evaluation windows use the same semantics.

---

### 4.7 Alert State Schema

```json
{
  "id": "mon_abc123",
  "name": "High error rate — checkout-api",
  "service_name": "checkout-api",
  "environment": "production",
  "status": "alerting",
  "severity": "critical",
  "condition": {
    "metric": "http.request.duration",
    "agg": "p99",
    "threshold": 500,
    "operator": ">",
    "window_ns": 300000000000,
    "group_by": ["service_name"]
  },
  "triggered_at": "2026-04-02T14:00:00Z",
  "resolved_at": null,
  "last_evaluated_at": "2026-04-02T14:05:00Z",
  "notification_channels": ["ops-slack"],
  "breaching_groups": [
    {"service_name": "checkout-api", "value": 843.2}
  ]
}
```

Fields:
- `status`: `"ok" | "alerting" | "no_data"`. Never null.
- `severity`: `"info" | "warning" | "critical"`. Set on the monitor definition, not derived from the condition.
- `triggered_at`: ISO 8601 string. Null when status is `"ok"`.
- `resolved_at`: ISO 8601 string. Null unless the alert was previously triggered and is now resolved (enables duration calculation).
- `breaching_groups`: which group-by dimension values are currently in violation. Empty array when status is `"ok"`.

**Alert state API:**

| Method | Path | Notes |
|--------|------|-------|
| GET | `/v1/alerts/monitors` | List all monitors with current status |
| GET | `/v1/alerts/monitors/{id}` | Single monitor detail |
| POST | `/v1/alerts/monitors` | Create monitor (alerts agent owns) |
| PUT | `/v1/alerts/monitors/{id}` | Update monitor |
| DELETE | `/v1/alerts/monitors/{id}` | Delete monitor |
| GET | `/v1/alerts/incidents` | Active incidents (status=alerting) |

**State change delivery to frontend:** frontend polls `GET /v1/alerts/incidents` on a fixed interval (recommended: 30 seconds). There is no push/websocket mechanism in v1. Alerts does not call the frontend; the frontend calls alerts.

---

## 5. Proposed Structure for INTERFACES.md

```markdown
# INTERFACES.md

## Purpose
Source of truth for all cross-subsystem contracts. No agent may implement
against an interface not documented here. All changes require sign-off from
affected agents listed on each section.

## Status legend
- AGREED: signed off by all affected agents; safe to implement against
- PROPOSED: drafted by reviewer; requires agent sign-off
- OPEN: decision not yet made; do not implement against this section

---

## 0. Open Decisions Log
| # | Decision | Blocking agents | Status | Owner |
|---|----------|----------------|--------|-------|
| 1 | Storage stack | All | OPEN | Storage |
| 2 | Sampling policy | Ingestion, Alerts | OPEN | Ingestion |
| 3 | OTLP support timeline | Ingestion | OPEN | Ingestion |
| 4 | Histogram storage format | Storage, Ingestion | OPEN | Storage |
| 5 | Auth token scope (per-service vs global) | Ingestion | OPEN | [TBD] |

---

## 1. Canonical Identity Fields
Status: PROPOSED
Affects: Ingestion, Storage, Frontend, Alerts
Sign-off required from: all agents

### 1.1 Universal required fields
### 1.2 Universal optional fields
### 1.3 Field naming rules

---

## 2. Metric Event Schema
Status: PROPOSED
Affects: Ingestion, Storage
Sign-off required from: Ingestion, Storage

### 2.1 Field definitions
### 2.2 Type taxonomy (gauge, counter, histogram)
### 2.3 Histogram payload shape
### 2.4 Validation rules and rejection behavior

---

## 3. Log Event Schema
Status: PROPOSED
Affects: Ingestion, Storage
Sign-off required from: Ingestion, Storage

### 3.1 Field definitions
### 3.2 Severity integer mapping
### 3.3 Trace correlation fields (trace_id, span_id)
### 3.4 Validation rules

---

## 4. Trace Span Schema
Status: PROPOSED
Affects: Ingestion, Storage, Frontend
Sign-off required from: Ingestion, Storage, Frontend

### 4.1 Field definitions
### 4.2 Span kind taxonomy
### 4.3 Status taxonomy
### 4.4 Root span identification
### 4.5 Validation rules

---

## 5. Ingestion API (External Boundary)
Status: PROPOSED
Affects: Ingestion (owns), all consumers
Sign-off required from: Ingestion, Storage

### 5.1 Endpoint map
### 5.2 Auth mechanism
### 5.3 Batch format
### 5.4 Acknowledgment semantics
### 5.5 Partial failure error format
### 5.6 Rate limits (v1: undecided)

---

## 6. Query API (Storage → Frontend + Alerts)
Status: PROPOSED
Affects: Storage (owns), Frontend, Alerts
Sign-off required from: Storage, Frontend, Alerts

### 6.1 Metric range query
### 6.2 Log search query
### 6.3 Trace search query
### 6.4 Trace detail query
### 6.5 Service summary endpoint
### 6.6 Time range semantics (inclusive/exclusive)
### 6.7 Pagination model (cursor-based)
### 6.8 has_data and last_seen semantics for alert use

---

## 7. Alert Evaluation Interface
Status: OPEN
Affects: Storage, Alerts
Sign-off required from: Storage, Alerts

### 7.1 Data delivery model (pull vs push)
### 7.2 Evaluation query format
### 7.3 Latency SLO for evaluation queries
### 7.4 Sampling caveat for trace-based rules

---

## 8. Alert State Schema (Alerts → Frontend)
Status: PROPOSED
Affects: Alerts (owns), Frontend
Sign-off required from: Alerts, Frontend

### 8.1 Monitor object schema
### 8.2 Status enum
### 8.3 Severity enum
### 8.4 Breaching groups format
### 8.5 State change delivery model (polling in v1)

---

## 9. Retention Policy
Status: OPEN
Affects: Storage (owns), Frontend, Alerts
Sign-off required from: Storage, Alerts

### 9.1 Default retention per signal type
### 9.2 Query behavior outside retention window
### 9.3 Alert rule behavior when evaluation window overlaps retention boundary
```

---

## 6. Summary: Decisions Agents Must Agree On Before Design

The following decisions require explicit team agreement before any agent produces a design doc. Each agent's design will embed assumptions about these — divergent assumptions are the source of every integration conflict described in this document.

| # | Decision | Proposed answer | Must agree before |
|---|----------|----------------|-------------------|
| 1 | Canonical timestamp format | Unix nanoseconds (int64) | Any schema design |
| 2 | Tag representation | `Map<string,string>`, max 20 entries | Ingestion + storage schema |
| 3 | Metric type taxonomy | gauge, counter, histogram (summary deferred) | Ingestion + storage schema |
| 4 | Histogram payload shape | bucket list + sum + count | Ingestion + storage schema |
| 5 | Log severity encoding | Integer (OTel scale) + optional text | Ingestion + storage schema |
| 6 | Trace ingestion unit | Per-span (not per-trace) | Ingestion pipeline design |
| 7 | Trace correlation via logs | trace_id + span_id fields on log events | All schema design |
| 8 | Aggregation responsibility | Server-side (storage provides `step` param) | Storage query API design |
| 9 | Correlation model (v1) | Client-side join on identity fields | Storage + frontend design |
| 10 | Pagination model | Cursor-based, forward-only | Storage query API + frontend UI design |
| 11 | Alert no-data detection | `has_data` + `last_seen_ns` in query response | Storage query API + alerts design |
| 12 | `group_by` in metric queries | Required query param, implemented by storage | Storage query API + alerts design |
| 13 | Time range semantics | `[start, end)` inclusive-start exclusive-end | Storage query API + alerts evaluation |
| 14 | Alert state delivery | Frontend polls; no push in v1 | Frontend + alerts design |
| 15 | Ingestion ack semantics | 202 = received, not persisted | Ingestion API design |
| 16 | V1 auth model | Global API key, `X-Api-Key` header | Ingestion + query API design |
| 17 | Canonical field names | See Section 3 terminology table | All design docs |
| 18 | Service summary endpoint | Exists as `/v1/query/services/{name}/summary` | Storage + frontend design |
