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

### Phase 1b — Integration Conflict Analysis and Contract Proposals (2026-04-02)

**Output:** `docs/review-integration.md`

**Note:** Subsystem design docs did not exist at time of review (all branches at initial commit). Review was performed prospectively based on observability platform design patterns.

**Conflicts identified (13):**
- 5 ingestion vs. storage schema conflicts (timestamp format, tag representation, metric types, log severity, trace unit)
- 4 storage vs. frontend query conflicts (aggregation ownership, correlation endpoint, service summary, pagination model)
- 4 alerts vs. storage conflicts (evaluation traffic pattern, no-data semantics, group-by requirement, window boundary semantics)

**Terminology inconsistencies:** 10 term conflicts across subsystems; canonical table produced in §3.

**Concrete contracts proposed:**
- Universal identity fields (service_name, environment, timestamp, host, version)
- Metric event JSON schema with histogram payload
- Log event JSON schema with OTel severity scale
- Trace span JSON schema with all required fields
- Ingestion API endpoints, auth, ack semantics, partial failure format
- Query API endpoints with full parameter and response shapes (metrics, logs, traces, service summary)
- Alert state schema and polling delivery model
- Full proposed INTERFACES.md section structure with AGREED/PROPOSED/OPEN status model

**18 decisions tabled** in §6 that all agents must agree on before design docs are written.

---

## Pending Work

- Review subsystem design proposals once agents produce them
- Verify each design doc references INTERFACES.md sections and does not contradict them
- Review first draft of `INTERFACES.md` once Storage agent produces it (or produce stub if no agent does)
- Re-review after storage stack decision is made — histogram storage format and query model may need revision
- Flag any implementation that proceeds against an undocumented or OPEN interface section
