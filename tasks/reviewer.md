# Reviewer Agent Task

## Objective
Act as architecture and integration reviewer.

## Deliverables
- Review subsystem plans
- Detect conflicts in contracts
- Flag duplicated work
- Flag hidden assumptions
- Flag integration and scaling risks

## Boundaries
Should not build major feature code unless explicitly reassigned.

---

## Completed Work

### Phase 1 — Shared Parallel Design Review (2026-04-02)

**Output:** `docs/review-design.md`

**Summary of findings:**

**Blocking gaps (7 identified):**
1. Signal identity fields — no fields defined; will cause divergence across all four subsystems
2. Wire format / ingestion protocol — not decided; ingestion and storage cannot design their boundary
3. Storage stack — not decided; blocks all subsystem design to varying degrees
4. Query model — not decided; frontend and alerts cannot design against an unknown API shape
5. Normalization ownership — not assigned to either ingestion or storage
6. Alert evaluation data source — push vs. pull undecided; latency requirements unspecified
7. Trace sampling policy — unaddressed; has correctness implications for alert rules

**Predicted conflicts (5 identified):**
1. Ingestion vs. Storage: double normalization if handoff schema is not defined first
2. Storage vs. Frontend: query API shape mismatch (raw retrieval vs. aggregated responses)
3. Storage vs. Alerts: query latency expectations incompatible if not agreed upfront
4. Alerts vs. Frontend: alert state model divergence
5. Ingestion vs. Alerts: sampling policy affecting rule accuracy on trace-based monitors

**Minimum contracts required before implementation:**
1. Signal Identity Schema (all agents)
2. Ingestion Wire Format (Ingestion, Storage)
3. Internal Event Schema / handoff format (Ingestion, Storage)
4. Query API Contract (Storage, Frontend, Alerts)
5. Alert Evaluation Interface (Storage, Alerts)
6. Alert State Schema (Alerts, Frontend)

**Proposed:** Structure for `INTERFACES.md` with 7 sections and an open decisions log.

---

### Phase 1b — Pre-design contract proposals (2026-04-02, prospective)

**Output:** `docs/review-integration.md` (first pass — no subsystem docs existed yet)

Prospective review based on standard observability platform patterns. Superseded by Phase 2 review below.

---

### Phase 2 — Cross-subsystem conflict review against actual designs (2026-04-02)

**Output:** `docs/review-integration.md` (replaced with concrete findings)

**Source docs:** all four subsystem design docs merged from integration branch.

**Conflicts identified: 20**

- Ingestion vs. Storage (9 conflicts):
  1. Timestamp unit: ingestion=milliseconds, storage=nanoseconds — total timestamp corruption
  2. Identity field names: OTel dotted attrs vs. flat columns — correlation silently broken
  3. Write architecture: ingestion expects write API, storage expects direct ClickHouse — no connection point
  4. Histogram format: one JSON object vs. per-bucket rows — incompatible structures
  5. Span field name: `name` (ingestion) vs. `operation` (storage) — blank operation names
  6. Duration unit: `duration_ms` (ingestion) vs. `duration_ns` (storage) — wrong values stored
  7. Log body field: `body` (ingestion) vs. `message` (storage) — message column never populated
  8. Log severity type: string passthrough vs. integer enum — insert failures
  9. `trace_index` responsibility: assigned to ingestion by storage, unknown to ingestion

- Storage vs. Frontend (6 conflicts):
  10. Query time params: `start`/`end` (storage) vs. `from`/`to` (frontend) — every query fails
  11. Trace list path: `/traces/list` (storage) vs. `/traces/query` (frontend) — 404
  12. Metric series shape: flat points (storage) vs. series-with-labels (frontend) — crash
  13. Services endpoint: metadata only (storage) vs. metrics-enriched (frontend) — missing data
  14. Missing `logs/volume` endpoint — log histogram has no data source
  15. Missing `log_id` field — log table has no stable row key
  16. Log severity field name: `severity` (storage) vs. `level` (frontend) — blank badges
  17. Trace status case: lowercase (storage) vs. uppercase (frontend) — filter and badge failures

- Alerts vs. Storage (3 conflicts):
  18. Metric series shape: same as #12, plus `t`/`v` field names vs. `timestamp`/`value`
  19. `group_by` missing from both alerts MetricQuery and storage API — multi-dimensional alerting impossible
  20. Log query interface: DSL string (alerts) vs. structured params (storage) — incompatible

**Terminology inconsistencies:** 10 term conflicts; canonical table in §5.

**18 missing decisions** tabulated in §4 with proposed answers and resolution group ordering.

**Unified contract layer proposed** in §6: canonical identity fields, metric/log/span event schemas, ingestion API, query API with canonical response shapes, alert state schema.

**INTERFACES.md structure** proposed in §7 with 8 sections and AGREED/PROPOSED/OPEN status model.

---

## Pending Work

- Subsystem owners must update `docs/ingestion-design.md`, `docs/storage-design.md`, `docs/frontend-design.md`, and `docs/alerts-design.md` to match `INTERFACES.md` and clear the findings in `docs/review-alignment.md`.
- Review implementation PRs against `INTERFACES.md` and the alignment findings before feature code lands.
- Flag any PR that implements against stale subsystem design text instead of the canonical contract.

---

## Completed Work

### Phase 2b — Contract conformance review against `INTERFACES.md` (2026-04-02)

**Output:** `docs/review-alignment.md`

**Summary of findings:**

- `INTERFACES.md` now resolves the earlier cross-subsystem conflicts, but the subsystem design docs are not yet aligned to it.
- Remaining violations were found in all four subsystem docs:
  - Ingestion still documents resource-block identity, millisecond timestamps, unresolved write-API architecture, and pre-contract signal schemas.
  - Storage still documents non-canonical schema/query field names, superseded endpoints, incorrect `trace_index` ownership, and missing required query endpoints.
  - Frontend still targets `from`/`to`, old endpoint paths, old response keys, and keeps resolved contract items as open questions.
  - Alerts still defines a divergent monitor/state model, a custom query contract, old telemetry field names, and non-canonical alerts endpoint paths.
- No further contract redesign was proposed. The remaining work is to update subsystem docs so they faithfully reflect `INTERFACES.md`.

### Phase 2c — Unified implementation replacement proposal (2026-04-02)

**Output:** `docs/review-node-typescript-architecture.md`

**Summary of findings:**

- Current integration status is stable at the contract layer but still fragmented at the implementation-design layer.
- Ingestion, storage, and frontend still describe different implementation directions and should not be used as-is for execution planning.
- Proposed a single reviewer-owned replacement architecture using:
  - Node.js 22 + TypeScript across ingestion, query-api, and web
  - Fastify for ingestion and query services
  - React + Vite for the frontend
  - shared Zod-backed contract types
  - direct ClickHouse writes from ingestion
  - a dedicated Node.js query API over ClickHouse and PostgreSQL
- The proposal is intended to replace the implementation ideas in the ingestion, storage, and frontend docs without changing `INTERFACES.md`.

### Phase 2d — Subsystem implementation docs replaced with aligned Node/TypeScript guidance (2026-04-02)

**Outputs:**

- `docs/ingestion-design.md`
- `docs/storage-design.md`
- `docs/frontend-design.md`

**Summary of findings:**

- Replaced the stale implementation sections in the ingestion, storage, and frontend docs rather than deleting the files outright.
- Preserved those subsystem files as the entry points for their areas, but rewrote them so they now match the reviewer architecture and `INTERFACES.md`.
- Removed the prior incorrect implementation assumptions, including:
  - storage write API between ingestion and storage
  - Go-style ingestion module layout
  - non-canonical query paths and params
  - stale frontend aliases such as `from` / `to`, `env`, `service`, and `level`

### Phase 3 — Implementation PR review for ingestion, storage, and frontend (2026-04-04)

**Output:** `docs/review-implementation.md`

**Summary of findings:**

- Reviewed PR #24 (frontend), PR #25 (storage), and PR #26 (ingestion).
- Findings were limited to contract conformance, subsystem integration, and obvious end-to-end failures.
- The main blocking issues are:
  - ingestion currently acknowledges metrics without writing them to ClickHouse
  - ingestion still lacks the required logs and traces endpoints
  - storage still serves mock metric data instead of querying ClickHouse
  - storage only exposes metrics endpoints rather than the full canonical query API
  - storage returns `step: "raw"`, which is outside the documented response contract
- No frontend-only correctness finding was identified in the current metrics-only slice; its integration risk is downstream of the ingestion and storage issues above.

### Phase 3b — Implementation PR review after subsystem updates (2026-04-04)

**Output:** `docs/review-implementation-2.md`

**Summary of findings:**

- Re-reviewed PR #24, PR #25, and PR #26 after they were updated.
- The first-pass findings about the no-op ingestion writer and the `"raw"` metrics step were fixed.
- Remaining blocking issues are:
  - ingestion still returns `501` for `/v1/logs` and `/v1/traces`
  - storage can still run without ClickHouse and silently fall back to fixture metric data
  - storage’s non-metrics query endpoints are still placeholder-only and not backed by real query logic
- No frontend-only correctness finding was identified in the current metrics slice; the remaining integration blockers are still in ingestion and storage.
