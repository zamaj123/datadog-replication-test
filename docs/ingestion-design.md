# Ingestion Subsystem Design

**Agent:** Ingestion  
**Stage:** Shared parallel design  
**Status:** Draft — open for review by Storage and Frontend agents

---

## 1. Objective

Design the telemetry ingestion subsystem responsible for accepting, validating, normalizing, and forwarding metrics, logs, and traces from instrumented services into the storage layer.

---

## 2. Plan

1. Define a common identity model shared across all signal types.
2. Define intake payload shapes for metrics, logs, and traces.
3. Define service boundaries and major ingestion components.
4. Propose the module/file structure.
5. Identify open questions for storage and frontend agents.

---

## 3. Files to Change

- `docs/ingestion-design.md` (this file)
- `tasks/ingestion.md` (update status)

---

## 4. Assumptions

- Initial target runtime is a Dockerized Node.js application; instrumentation libraries send HTTP POST requests.
- OpenTelemetry-aligned payload formats are used as the foundation for all three signal types. This is the industry standard and avoids vendor-specific lock-in.
- A single ingestion gateway handles all signal types and routes internally. Signal-specific services can split out later if scale demands it.
- Auth/API key validation is out of scope for Phase 2 but the gateway must have a placeholder for it.
- The storage agent will expose a write API (details TBD). Ingestion does not write to storage directly.
- Telemetry batching is the responsibility of the client agent/SDK. The intake API accepts batches.

---

## 5. Common Identity Model

Every signal payload must carry a `resource` block. This provides consistent identity across metrics, logs, and traces for correlation.

```json
{
  "resource": {
    "service.name":           "string (required)",
    "service.version":        "string",
    "host.name":              "string",
    "host.id":                "string",
    "deployment.environment": "string (e.g. production, staging)",
    "telemetry.sdk.name":     "string (e.g. opentelemetry)",
    "telemetry.sdk.version":  "string"
  }
}
```

`service.name` is required on all payloads. All other resource attributes are optional but strongly recommended. The ingestion layer normalizes and validates this block before forwarding.

---

## 6. Intake Payload Shapes

All endpoints accept `Content-Type: application/json`. All timestamps are Unix milliseconds (int64).

### 6.1 Metrics — `POST /v1/metrics`

```json
{
  "resource": { "service.name": "api-server", "..." : "..." },
  "metrics": [
    {
      "name":      "http.request.duration",
      "type":      "gauge | counter | histogram | summary",
      "value":     123.4,
      "timestamp": 1711234567890,
      "unit":      "ms",
      "tags": {
        "http.method":      "GET",
        "http.status_code": "200",
        "http.route":       "/api/users"
      }
    }
  ]
}
```

**Field notes:**
- `name`: dot-namespaced string, e.g. `http.request.duration`, `process.cpu.usage`.
- `type`: one of `gauge`, `counter`, `histogram`, `summary`.
- `value`: numeric. For `histogram` and `summary`, the client sends pre-aggregated buckets as a JSON object in `value` (shape TBD with storage agent).
- `tags`: arbitrary key-value string pairs for slicing/grouping.
- Multiple metric points may be batched in the `metrics` array.

### 6.2 Logs — `POST /v1/logs`

```json
{
  "resource": { "service.name": "api-server", "..." : "..." },
  "logs": [
    {
      "timestamp":  1711234567890,
      "severity":   "TRACE | DEBUG | INFO | WARN | ERROR | FATAL",
      "body":       "Connection refused to postgres at db:5432",
      "trace_id":   "4bf92f3577b34da6a3ce929d0e0e4736",
      "span_id":    "00f067aa0ba902b7",
      "attributes": {
        "db.system":    "postgresql",
        "db.name":      "users",
        "code.filepath":"src/db/client.js",
        "code.lineno":  42
      }
    }
  ]
}
```

**Field notes:**
- `severity`: normalized to the OpenTelemetry severity levels.
- `body`: the raw log message string.
- `trace_id` / `span_id`: optional but critical for log-trace correlation. Must be propagated by the instrumentation library.
- `attributes`: structured key-value metadata. The storage agent indexes selected attributes for search.
- Stack traces should be placed in `attributes["exception.stacktrace"]`.

### 6.3 Traces — `POST /v1/traces`

```json
{
  "resource": { "service.name": "api-server", "..." : "..." },
  "spans": [
    {
      "trace_id":       "4bf92f3577b34da6a3ce929d0e0e4736",
      "span_id":        "00f067aa0ba902b7",
      "parent_span_id": "b9c7c989f97918e1",
      "name":           "GET /api/users/:id",
      "kind":           "server | client | producer | consumer | internal",
      "start_time":     1711234567800,
      "end_time":       1711234567990,
      "duration_ms":    190,
      "status": {
        "code":    "ok | error | unset",
        "message": "db connection refused"
      },
      "attributes": {
        "http.method":      "GET",
        "http.url":         "/api/users/42",
        "http.status_code": 200,
        "db.system":        "postgresql",
        "db.statement":     "SELECT * FROM users WHERE id=$1"
      },
      "events": [
        {
          "name":      "exception",
          "timestamp": 1711234567850,
          "attributes": { "exception.type": "Error", "exception.message": "..." }
        }
      ],
      "links": []
    }
  ]
}
```

**Field notes:**
- A single request body may contain spans from multiple traces.
- `parent_span_id` absent or null means root span.
- `duration_ms` is computed on ingest if not provided (`end_time - start_time`).
- `kind` determines rendering in the service map and trace waterfall.
- `events` model in-span logs (exceptions, checkpoints).

---

## 7. Service Boundaries and Components

```
┌─────────────────────────────────────────────────────────┐
│                    Ingestion Gateway                     │
│  POST /v1/metrics   POST /v1/logs   POST /v1/traces      │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ Metrics  │  │  Logs    │  │  Traces  │  ← Parsers    │
│  │ Parser   │  │ Parser   │  │  Parser  │               │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘               │
│       │              │              │                    │
│       └──────────────┴──────────────┘                   │
│                       │                                  │
│              ┌─────────▼──────────┐                      │
│              │  Identity          │  ← Normalize resource│
│              │  Normalizer        │    attrs, validate   │
│              │                    │    service.name etc. │
│              └─────────┬──────────┘                      │
│                        │                                  │
│              ┌─────────▼──────────┐                      │
│              │  Validation        │  ← Schema validation │
│              │  Pipeline          │    + error responses │
│              └─────────┬──────────┘                      │
│                        │                                  │
│              ┌─────────▼──────────┐                      │
│              │  Storage           │  ← Calls storage     │
│              │  Forwarder         │    write API (TBD)   │
│              └────────────────────┘                      │
└─────────────────────────────────────────────────────────┘
```

**Component responsibilities:**

| Component | Responsibility |
|---|---|
| Gateway / HTTP server | Accept requests, basic auth placeholder, route to signal parsers |
| Signal Parsers (×3) | Deserialize JSON, map fields, compute derived fields (e.g. duration_ms) |
| Identity Normalizer | Validate `resource.service.name`, normalize tag keys, apply defaults |
| Validation Pipeline | Enforce required fields, type checks, reject malformed payloads with 400 |
| Storage Forwarder | Forward normalized payloads to storage write API; handle retries/backpressure |

---

## 8. Proposed Module/File Structure

```
ingestion/
├── cmd/
│   └── server/
│       └── main.go              # entrypoint; wires gateway and config
├── internal/
│   ├── gateway/
│   │   ├── server.go            # HTTP server, route registration
│   │   ├── handlers.go          # handler funcs per signal endpoint
│   │   └── middleware.go        # auth placeholder, request logging
│   ├── intake/
│   │   ├── metrics/
│   │   │   ├── parser.go        # JSON → internal MetricBatch type
│   │   │   └── validator.go     # field presence + type checks
│   │   ├── logs/
│   │   │   ├── parser.go
│   │   │   └── validator.go
│   │   └── traces/
│   │       ├── parser.go
│   │       └── validator.go
│   ├── identity/
│   │   └── normalizer.go        # resource attribute normalization
│   ├── pipeline/
│   │   └── pipeline.go          # parse → normalize → validate → forward
│   └── forwarder/
│       └── storage_client.go    # interface + HTTP impl for storage write API
├── pkg/
│   └── schema/
│       ├── resource.go          # ResourceAttrs type (shared with storage agent)
│       ├── metric.go            # MetricPoint, MetricBatch types
│       ├── log.go               # LogRecord, LogBatch types
│       └── span.go              # Span, TraceBatch types
└── config/
    └── config.go                # env-based config (port, storage URL, etc.)
```

**Notes:**
- `pkg/schema` types are the proposed contract to share with the storage agent. These should be reviewed and locked before implementation begins.
- `forwarder/storage_client.go` defines an interface — the concrete implementation depends on what write API the storage agent exposes.

---

## 9. Validation Behavior

| Condition | HTTP Response |
|---|---|
| Valid payload | `202 Accepted` — payload accepted for forwarding |
| Missing `service.name` | `400 Bad Request` with error detail |
| Unknown/invalid `type` for metrics | `400 Bad Request` |
| Invalid timestamp (negative, non-numeric) | `400 Bad Request` |
| Empty `metrics`/`logs`/`spans` array | `400 Bad Request` |
| Storage forwarder unavailable | `503 Service Unavailable` (fail-open option: buffer + `202`) |
| Malformed JSON | `400 Bad Request` |

The ingestion layer does **not** drop data silently. All errors are returned to the caller.

---

## 10. Transport Expectations (Client SDK / Agent)

The platform expects instrumentation agents or SDKs running alongside the target service to:

1. Batch telemetry before sending (reduce request volume).
2. Send on a configurable flush interval (default: 10s for metrics, 5s for traces/logs).
3. Retry on `503` with exponential backoff.
4. Populate `trace_id` and `span_id` in log records when a trace context is active.
5. Use UTC Unix milliseconds for all timestamps.

For the initial Node.js target, the expectation is an OpenTelemetry Node.js SDK configured with a custom OTLP-HTTP exporter pointing at this ingestion gateway.

---

## 11. Open Questions for Storage Agent

These must be resolved before the Storage Forwarder can be implemented.

| # | Question | Impact |
|---|---|---|
| S1 | What write API does storage expose? (HTTP REST, gRPC, direct DB?) | Determines `forwarder/storage_client.go` implementation |
| S2 | What is the expected write payload format — does storage accept our internal schema types directly, or does it define its own? | May require a translation layer in the forwarder |
| S3 | Does storage expect metrics, logs, and traces on separate endpoints, or a single intake? | Affects routing in the forwarder |
| S4 | What backpressure / flow-control mechanism does storage support? | Determines retry/buffer strategy in the forwarder |
| S5 | For histograms and summaries: what bucket format does storage want? | Needed to finalize `metric.go` schema type |
| S6 | Does storage need retention hints at write time (e.g., TTL tags per signal)? | If yes, ingestion must support passing them through from config |
| S7 | How should ingestion handle storage unavailability — drop, buffer in memory, or buffer to disk? | Operational reliability decision |

---

## 12. Open Questions for Frontend Agent

| # | Question | Impact |
|---|---|---|
| F1 | What time-series resolution is needed for metrics display (raw points vs. pre-aggregated rollups)? | Informs whether ingestion should pre-aggregate or store raw |
| F2 | Does the service map view require ingestion to extract and store service-dependency edges from trace spans (caller → callee)? | If yes, the trace parser needs to emit a derived dependency event |
| F3 | What log search fields need to be indexed (severity, service, trace_id, body substring)? | Guides which `attributes` keys ingestion should surface/normalize |
| F4 | Does the UI need a live-tail / streaming log view? | Would require ingestion to support a pub/sub or SSE mechanism, not just batch write |
| F5 | What is the expected correlation UX — e.g., "show logs for this trace span"? | Confirms that `trace_id` + `span_id` on log records is sufficient or if more linking is needed |

---

## 13. Validation Steps

- [ ] Storage agent reviews and confirms or proposes changes to `pkg/schema` types (S1–S7 above).
- [ ] Frontend agent reviews open questions F1–F5.
- [ ] Reviewer agent reviews payload shapes and component boundaries for integration risks.
- [ ] Once storage write API contract is agreed, implement `forwarder/storage_client.go` interface.
- [ ] Implement parsers and validators with unit tests covering required-field enforcement and malformed input.
- [ ] End-to-end test: Node.js app with OTel SDK → ingestion gateway → storage write confirmed.

---

## 14. Open Issues

- **Histogram/summary value format** (S5): Not fully specified. Proposing storage agent drives this decision since they own the query model.
- **Auth placeholder**: Gateway middleware has a stub. Real auth (API keys or mTLS) is Phase 5 work but the stub must not block unauthenticated requests in Phase 2.
- **Single gateway vs. multi-service**: Design defaults to single gateway. If metrics volume significantly outpaces logs/traces, splitting into separate services is straightforward given the internal component boundaries.
- **OTLP/gRPC support**: Currently HTTP JSON only. gRPC transport (standard OTLP) should be added in Phase 3 to support broader SDK compatibility.
