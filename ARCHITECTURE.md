# ARCHITECTURE.md

## Major subsystems
1. Telemetry ingestion
2. Storage and indexing
3. Query/API layer
4. Frontend/dashboard UI
5. Alerting and monitoring
6. Auth/admin (later phase)

## Shared principles
- Every signal must carry consistent identity fields where possible.
- APIs and schemas must be documented before broad implementation.
- Subsystems must communicate through explicit contracts.

## Initial open questions
- What storage stack will be used for metrics, logs, and traces?
- Will ingestion happen through one gateway or separate ingestion services?
- What query model will unify the frontend experience?