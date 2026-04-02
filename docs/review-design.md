# Design Review — Shared Parallel Design Phase

**Author:** Reviewer Agent
**Date:** 2026-04-02
**Stage:** Shared parallel design (pre-implementation)
**Status:** Blocking issues identified; team must resolve before subsystem implementation begins

---

## 1. Scope of This Review

Reviewed documents: `AGENTS.md`, `PRODUCT.md`, `ARCHITECTURE.md`, `ROADMAP.md`, and all five `tasks/*.md` files.

No subsystem agent has produced a concrete design proposal yet. All four subsystem task files describe deliverables but contain no actual design content. This review therefore operates on the shared foundation docs and identifies what must be decided before parallel work can proceed without conflict.

---

## 2. What Is Working

- Ownership boundaries in `AGENTS.md` are unambiguous and non-overlapping.
- `ARCHITECTURE.md` correctly identifies the three biggest open questions rather than papering over them.
- Required coordination is noted in every task file.
- The product scope in `PRODUCT.md` is tight enough to be implementable.

---

## 3. Blocking Gaps

These are unresolved decisions that will cause divergent implementation if left open during parallel design.

### 3.1 Signal Identity Fields — Not Defined

**ARCHITECTURE.md states:** "Every signal must carry consistent identity fields where possible."

No fields are named anywhere. Each agent will independently assume what fields exist. Likely divergences:

- Ingestion will choose field names when it designs its payload schema.
- Storage will choose field names when it designs its data model.
- Frontend will hard-code field names in its query builder.
- Alerts will reference field names in its rule DSL.

If these do not agree, cross-signal correlation — a listed core capability — breaks entirely. This is the highest-priority gap.

**Must decide before any other design work:** the minimum required identity fields for every signal type (metrics, logs, traces). At minimum: `service`, `environment`, `timestamp`, and for traces: `trace_id`, `span_id`, `parent_span_id`.

### 3.2 Wire Format and Protocol — Not Decided

Ingestion is supposed to define "payload schemas" and storage is supposed to "review ingestion payload contracts." Neither has done so, and neither can do so independently — the choice of wire format (OTLP, custom JSON, StatsD for metrics, etc.) has architectural consequences that span ingestion design, SDK/agent expectations, and normalization logic.

This decision must precede ingestion's design work. Storage cannot design its write path without it.

### 3.3 Storage Stack — Not Decided

`ARCHITECTURE.md` lists this as an open question. It is the most load-bearing unresolved decision in the architecture. It directly constrains:

- Ingestion: what client library and write protocol to use
- Storage: schema, indexing, and retention implementation
- Frontend: what query primitives are available (SQL? PromQL? custom?)
- Alerts: what evaluation queries are possible and at what latency

No subsystem agent should begin deep design until this is resolved. An incorrect guess in any one subsystem will require a rewrite once the real decision is made.

### 3.4 Query Model — Not Decided

`ARCHITECTURE.md` lists "what query model will unify the frontend experience?" as open. Frontend and alerts both depend on a query API that storage will build. Without a query model decision, storage will build what is structurally easy, frontend will design a UI against an assumed API shape, and they will not match.

This requires a joint decision between storage, frontend, and alerts — not a unilateral choice by storage.

### 3.5 Normalization Ownership — Not Assigned

Who is responsible for normalizing raw incoming telemetry into the canonical internal format? The current docs leave this ambiguous at the ingestion/storage boundary. Two failure modes:

- Both agents partially normalize → double transformation with drift between subsystems.
- Neither agent normalizes → storage receives heterogeneous formats it was not designed to handle.

This must be explicitly assigned to one agent with a defined handoff format at the boundary.

### 3.6 Alert Evaluation Data Source — Not Specified

Alerts needs to evaluate rules on a continuous or near-continuous basis. The docs do not specify:

- Whether alerts queries the same storage layer as frontend (pull model) or receives a streaming feed from ingestion (push/stream model).
- What latency is acceptable for alert evaluation (sub-minute requires a different data path than 5-minute windows).
- What happens if the query layer is under load — does alert evaluation degrade?

Without this decision, alerts and storage will design incompatible data paths.

### 3.7 Trace Sampling Policy — Not Addressed

The docs do not mention sampling. For traces at any meaningful volume, sampling is unavoidable. The choice of sampling strategy has major consequences:

- **Head-based sampling** (decided at ingestion entry) is simple but means alert rules on trace error rates operate on incomplete data.
- **Tail-based sampling** (decided after full trace is assembled) requires ingestion to buffer entire traces before writing, which complicates the ingestion pipeline significantly.
- **No sampling** limits scale.

Ingestion cannot finalize its pipeline design without a sampling decision. Alerts cannot reason about correctness of trace-based rules without knowing whether data is sampled.

---

## 4. Cross-Subsystem Conflict Predictions

These are conflicts that will emerge during parallel design if the teams do not coordinate explicitly.

### 4.1 Ingestion vs. Storage: Normalization Boundary

- **Risk:** Ingestion normalizes fields before storage; storage also normalizes on write. Result: two normalization passes with no agreed canonical form between them. Any field renamed or dropped by one pass corrupts the other.
- **Trigger:** Both agents begin implementation without a written handoff schema.

### 4.2 Storage vs. Frontend: Query API Shape

- **Risk:** Storage builds a query API optimized for point queries and raw time-series retrieval. Frontend needs aggregated, multi-signal, joined responses to render dashboards. These are architecturally different API shapes — the former requires the client to aggregate, the latter requires server-side computation.
- **Trigger:** Storage designs the query API without frontend's requirements document; frontend designs the UI against an assumed API.

### 4.3 Storage vs. Alerts: Query Latency Expectations

- **Risk:** Alerts requires repeated, low-latency queries for rule evaluation (potentially every 30–60 seconds per rule). A storage layer optimized for interactive dashboard queries may not support this query pattern without degradation. If alerts assumes a streaming data source and storage only provides a request/response API, the alert evaluation loop has no viable data path.
- **Trigger:** Neither team documents its latency requirement or latency guarantee before design.

### 4.4 Alerts vs. Frontend: Alert State Model

- **Risk:** Alerts produces incident/alert state. Frontend must display it. If each designs its own representation, the frontend will parse alert state incorrectly or require alerts to expose a special UI-facing API it was not designed to provide.
- **Trigger:** Alerts designs its internal state model for evaluation correctness; frontend assumes a different shape for display.

### 4.5 Ingestion vs. Alerts: Sampling and Rule Accuracy

- **Risk:** If ingestion samples traces before storage writes them, alert rules that count trace errors or measure error rates operate on sampled data. A 1% sample rate could suppress a real error spike below the alert threshold. This is a correctness failure, not just a performance issue.
- **Trigger:** Ingestion decides on sampling without alerting team input.

---

## 5. Minimum Interface Contracts Required Now

These are the contracts that must be agreed before any agent begins implementation. Each contract requires sign-off from the agents listed.

| # | Contract | Description | Agents Required |
|---|----------|-------------|-----------------|
| 1 | Signal Identity Schema | Required fields on every metric, log, and trace | All four |
| 2 | Ingestion Wire Format | Protocol and payload shape accepted at the intake boundary | Ingestion, Storage |
| 3 | Internal Event Schema | Normalized form that ingestion hands to storage (the handoff contract) | Ingestion, Storage |
| 4 | Query API Contract | REST/query API shape that frontend and alerts depend on | Storage, Frontend, Alerts |
| 5 | Alert Evaluation Interface | Data query contract alerts depends on, including latency SLO | Storage, Alerts |
| 6 | Alert State Schema | Shared model for alert status and incident state consumed by frontend | Alerts, Frontend |

None of these contracts require implementation decisions. They require field names, API shapes, and latency expectations. Each can and should be written as a stub in `INTERFACES.md` before implementation begins.

---

## 6. Proposed Structure for INTERFACES.md

```
# INTERFACES.md

## How to use this file
This file is the source of truth for cross-subsystem contracts.
No agent may implement against an interface that is not documented here.
Changes require review from all affected agents.

---

## 1. Signal Identity Fields
*Owner: all agents. Must be agreed before any schema or API work.*

### 1.1 Universal fields (required on all signal types)
| Field | Type | Description |
...

### 1.2 Metric-specific fields
| Field | Type | Description |
...

### 1.3 Log-specific fields
...

### 1.4 Trace-specific fields (spans)
| Field | Type | Description |
| trace_id | string (uuid) | ... |
| span_id  | string | ... |
| parent_span_id | string | nullable; absent on root span |
...

---

## 2. Ingestion API (External Boundary)
*Owner: Ingestion. Reviewed by: Storage.*

### 2.1 Protocol decision
[OPEN — must decide: OTLP, custom HTTP/JSON, or other]

### 2.2 Endpoint map
| Method | Path | Signal type | Auth |
...

### 2.3 Request shape per signal type
...

### 2.4 Acknowledgment semantics
[OPEN — ack before or after persistence?]

---

## 3. Internal Event Schema (Ingestion → Storage)
*Owner: agreed jointly by Ingestion and Storage.*

### 3.1 Normalized metric event
...

### 3.2 Normalized log event
...

### 3.3 Normalized trace span event
...

### 3.4 Validation and rejection behavior
[Who validates? What happens to invalid events?]

---

## 4. Query API (Storage → Frontend + Alerts)
*Owner: Storage. Requirements from: Frontend, Alerts.*

### 4.1 Query model decision
[OPEN — PromQL-compatible? SQL? Custom DSL? REST range queries?]

### 4.2 Metric query endpoint
...

### 4.3 Log query endpoint
...

### 4.4 Trace query endpoint
...

### 4.5 Cross-signal / correlation query
[OPEN — server-side join or client-side assembly?]

### 4.6 Latency guarantees
| Consumer | Max acceptable query latency | Notes |
| Frontend | interactive (~500ms) | dashboard renders |
| Alerts | evaluation window (~30s) | rule eval frequency |

---

## 5. Alert Evaluation Interface
*Owner: agreed jointly by Storage and Alerts.*

### 5.1 Data delivery model
[OPEN — pull (alerts queries storage) or push (ingestion streams to alerts)]

### 5.2 Evaluation query contract
[Stub query format alerts will use for rule evaluation]

### 5.3 Sampling caveat
[Document how sampling affects rule accuracy for trace-based rules]

---

## 6. Alert State Schema (Alerts → Frontend)
*Owner: Alerts. Reviewed by: Frontend.*

### 6.1 Alert/monitor state model
| Field | Type | Description |
| id | string | ... |
| name | string | ... |
| status | enum | ok, alerting, no_data |
| severity | enum | ... |
| triggered_at | timestamp | ... |
| resolved_at | timestamp | nullable |
...

### 6.2 State change events
[How does frontend learn of state changes — polling or push?]

---

## 7. Open Decisions Log
*Decisions blocking implementation. Each must be resolved before affected agents proceed.*

| Decision | Blocking | Owner | Status |
|----------|----------|-------|--------|
| Storage stack | All | [TBD] | OPEN |
| Wire format protocol | Ingestion, Storage | Ingestion | OPEN |
| Query model | Storage, Frontend, Alerts | Storage | OPEN |
| Normalization ownership | Ingestion, Storage | [TBD] | OPEN |
| Sampling policy | Ingestion, Alerts | [TBD] | OPEN |
| Alert eval data path | Storage, Alerts | [TBD] | OPEN |
```

---

## 7. Recommended Next Actions

In priority order:

1. **Resolve storage stack.** All other design work is partially speculative until this is decided. Storage agent should propose options with trade-offs; other agents review.

2. **Agree on signal identity fields.** This can happen in parallel with (1). Requires a 30-field max stub that all agents sign off on. Write into `INTERFACES.md §1`.

3. **Storage and ingestion jointly define the internal event schema.** This unblocks ingestion's pipeline design and storage's write path. Write into `INTERFACES.md §3`.

4. **Frontend and alerts jointly document their query API requirements.** Storage cannot design a query API that serves both without knowing what both need. Write requirements into `INTERFACES.md §4` (as stubs with `[OPEN]` sections).

5. **Decide normalization ownership.** One sentence in `INTERFACES.md §3` with an explicit agent name. Eliminates the biggest ingestion/storage conflict risk.

6. **Alerts and storage agree on evaluation data path.** Must happen before either designs their internal architecture. Write into `INTERFACES.md §5`.

Items 2–6 can proceed in parallel once (1) is decided or scoped to be storage-stack-agnostic at the interface level.

---

## 8. What This Review Does Not Cover

- Implementation approach for any subsystem (not reviewer's scope)
- Technology recommendations beyond noting that choices must be made
- UI/UX design decisions (frontend's scope)
- Specific storage schema decisions (storage's scope once stack is chosen)
