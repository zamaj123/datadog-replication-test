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

- All agents must review `docs/review-integration.md` and resolve conflicts before implementation
- `INTERFACES.md` must be created (storage agent proposed as owner for §6; all agents for §1)
- 18 decisions in §4 must be formally resolved and recorded
- Review implementation PRs against INTERFACES.md once agreed contracts exist
- Flag any PR that implements against an OPEN or unresolved section
