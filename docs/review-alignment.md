# Review Alignment — Remaining Interface Mismatches

**Author:** Reviewer Agent  
**Date:** 2026-04-02

## Scope

Reviewed for conformance with `INTERFACES.md`:

- `docs/ingestion-design.md`
- `docs/storage-design.md`
- `docs/frontend-design.md`
- `docs/alerts-design.md`

`INTERFACES.md` resolves the earlier cross-subsystem conflicts. The remaining issues are stale subsystem design content that still contradicts the canonical contract. This review lists only the unresolved mismatches, omissions, or contract violations that still remain in the subsystem docs.

## Findings

### 1. Ingestion design still describes the pre-contract write boundary and unauthenticated intake.

- `docs/ingestion-design.md:37-39`, `docs/ingestion-design.md:201-216`, `docs/ingestion-design.md:247`, `docs/ingestion-design.md:294-306`, `docs/ingestion-design.md:324-327`
- `INTERFACES.md §2` and `§6` require direct ClickHouse HTTP writes, specific ClickHouse env vars, `X-Api-Key` auth, and no open write-architecture questions.
- The ingestion design still says storage exposes a write API, treats auth as a placeholder, and leaves the write path as unresolved questions. That is now a contract violation, not an open design choice.

### 2. Ingestion identity and payload schemas still use the old resource-block model and millisecond wire format.

- `docs/ingestion-design.md:45-61`, `docs/ingestion-design.md:67`, `docs/ingestion-design.md:73`, `docs/ingestion-design.md:102`, `docs/ingestion-design.md:132`, `docs/ingestion-design.md:214`, `docs/ingestion-design.md:269`, `docs/ingestion-design.md:288`
- `INTERFACES.md §1`, `§3`, `§4`, and `§5` require canonical top-level fields `service_name`, `environment`, `host`, `version`, with nanosecond timestamps at the ingestion to storage boundary.
- The ingestion design still centers the contract on a `resource` block, `service.name`, and Unix milliseconds. It also validates `service.name` rather than `service_name` after normalization. That no longer conforms to the canonical event schemas.

### 3. Ingestion signal schemas still include unsupported or renamed fields and leave resolved signal rules open.

- `docs/ingestion-design.md:77-95`, `docs/ingestion-design.md:105-126`, `docs/ingestion-design.md:135-172`, `docs/ingestion-design.md:213`, `docs/ingestion-design.md:304-305`, `docs/ingestion-design.md:335-336`
- Remaining violations against `INTERFACES.md §3-§5` include:
- Metrics still allow `summary` and describe histogram/summary payload shape as TBD, even though `summary` is explicitly unsupported and histogram explosion is fully specified.
- Logs still use `severity` and `body` instead of the canonical `severity_number`, `severity_text`, and `message`.
- Spans still document `duration_ms`, nested `status.code`/`status.message`, and `events`/`links`, none of which appear in the canonical ingestion to storage schema.

### 4. Storage design still uses non-canonical schema and column names.

- `docs/storage-design.md:59-99`, `docs/storage-design.md:133-170`, `docs/storage-design.md:183-198`, `docs/storage-design.md:211-218`, `docs/storage-design.md:279-285`, `docs/storage-design.md:520-523`
- `INTERFACES.md §1`, `§3`, `§4`, `§5`, and `§10` define canonical field names such as `service_name`, `environment`, `name`, `type`, `tags`, `severity_number`, `severity_text`, `start_time`, `end_time`, and `status`.
- The storage design still specifies `service`, `env`, `metric_name`, `metric_type`, `labels`, `severity`, `operation`, `status_code`, `root_service`, and `root_operation`. It also still includes unsupported `summary` metrics and span `events`. Those schema definitions are no longer contract-compliant.

### 5. Storage design still assigns `trace_index` ownership incorrectly.

- `docs/storage-design.md:206-226`, `docs/storage-design.md:523`
- `INTERFACES.md §2` assigns `trace_index` population to a ClickHouse materialized view owned by storage, and explicitly says ingestion has no responsibility for `trace_index`.
- The storage design still says `trace_index` is populated by ingestion or a materialized view, and later states ingestion is responsible for detecting root spans and upserting `trace_index`. That directly contradicts the contract.

### 6. Storage query API documentation still exposes the superseded API surface.

- `docs/storage-design.md:319-365`, `docs/storage-design.md:379-410`, `docs/storage-design.md:416-511`, `docs/storage-design.md:531-556`
- Violations against `INTERFACES.md §7` include:
- Auth is documented as no auth / bearer token later, instead of `X-Api-Key`.
- Metric query uses `metric`, `service`, `env`, `labels`, and `aggregate` instead of `name`, `service_name`, `environment`, `filter[...]`, and `agg`.
- Log query is documented as `GET /api/v1/logs/query` with `severity`, not `GET /api/v1/logs` with `severity_min`.
- Trace list is documented as `GET /api/v1/traces/list`, not `GET /api/v1/traces`.
- Response bodies still use non-canonical keys such as `metrics`, `service`, `severity`, `root_service`, `duration_ms`, `status_code`, and omit required fields like `truncated`, `total_matched`, `root_service_name`, and `environment`.
- The storage design also still documents non-contract endpoints such as `GET /api/v1/metrics/labels` and `GET /api/v1/correlate/trace`, while omitting required endpoints such as `GET /api/v1/logs/volume`, `GET /api/v1/services/:service_name/summary`, and `GET /api/v1/environments`.

### 7. Frontend design still targets the old query parameters, field names, and response shapes.

- `docs/frontend-design.md:67-71`, `docs/frontend-design.md:170-177`, `docs/frontend-design.md:218-225`, `docs/frontend-design.md:243-245`, `docs/frontend-design.md:265-527`, `docs/frontend-design.md:535-545`
- Violations against `INTERFACES.md §7` and `§10` include:
- Global time range and every documented endpoint still use `from`/`to` instead of `start`/`end`.
- Filters and shared identity fields still use `service`, `env`, and `level` instead of `service_name`, `environment`, `severity_text`, and `severity_number`.
- Metrics use `GET /api/v1/metrics` and `metric`/`interval`; the contract uses `GET /api/v1/metrics/names` and `name`/`step`.
- Logs use `GET /api/v1/logs/query` and `q`; the contract uses `GET /api/v1/logs` and `search`.
- Traces use `GET /api/v1/traces/query`, uppercase `status`, `root_service`, `duration_ms`, and `env`; the contract uses `GET /api/v1/traces`, lowercase status, `root_service_name`, `duration_ns`, and `environment`.
- The frontend shared field contract section still codifies superseded names, so the doc remains self-consistent internally while still violating the canonical interface.

### 8. Frontend still leaves resolved contract decisions as open questions.

- `docs/frontend-design.md:552-560`
- `INTERFACES.md` already resolves several items the frontend marks as open, including:
- `start` / `end` query semantics and required format
- supported `step` values and auto-selection
- `GET /api/v1/environments`
- cursor-based pagination
- trace status values including `unset`
- `GET /api/v1/services`
- These should no longer be tracked as unresolved dependencies.

### 9. Alerts design still uses a monitor/state model that diverges from the canonical monitor object.

- `docs/alerts-design.md:48-68`, `docs/alerts-design.md:132-149`, `docs/alerts-design.md:153-185`, `docs/alerts-design.md:232-265`, `docs/alerts-design.md:272-288`
- `INTERFACES.md §8` defines the canonical `Monitor` object and public states. The contract supports monitor types `threshold`, `change`, `log_count`, and `missing_data`, with public monitor `status` values `ok`, `alerting`, and `no_data`.
- The alerts design still includes `anomaly`, `ACKNOWLEDGED`, `state`, `tags`, Slack channels, and notification payload shapes that are outside the canonical monitor contract. Those may be future design ideas, but as written they conflict with the current source of truth.

### 10. Alerts query contract still assumes a custom internal API instead of the canonical query API.

- `docs/alerts-design.md:310-366`, `docs/alerts-design.md:420`, `docs/alerts-design.md:434`
- `INTERFACES.md §7` and `§8.5` define alerts consumption of the shared query API through HTTP parameters and canonical response shapes.
- The alerts design still defines its own `MetricQueryRequest` wrapper, uses `metric_name`, `filters`, `step_seconds`, and point fields `{ t, v }`, and still depends on an unresolved `LogQuery.filter` DSL. Those interfaces were superseded by the contract and should not remain open.

### 11. Alerts telemetry field names and alerts API paths remain out of contract.

- `docs/alerts-design.md:313`, `docs/alerts-design.md:357-388`, `docs/alerts-design.md:398-411`
- `INTERFACES.md §1`, `§8.4`, and `§10` require canonical telemetry names (`service_name`, `environment`) and alerts endpoints rooted at `/api/v1/alerts/monitors`.
- The alerts design still requires `service` / `env`, treats `timestamp` as ISO 8601 on telemetry, and documents `/api/v1/monitors`, `/api/v1/alerts`, `mute`, and `unmute` endpoints that are not part of the canonical alerts API.

## Conclusion

The remaining integration problem is no longer disagreement about what the contracts should be. `INTERFACES.md` resolves that. The unresolved work is documentation alignment: all four subsystem design docs still contain pre-contract interface definitions that would mislead implementation if used as-is.
