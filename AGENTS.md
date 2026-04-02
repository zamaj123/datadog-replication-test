# AGENTS.md

All agents working in this repo must follow these rules.

## Global rules
- Do not edit files outside your assigned area unless the task explicitly requires it.
- Before starting new work, ensure your branch includes the latest changes from the integration branch.
- Before coding, restate:
  1. your objective
  2. files you plan to edit
  3. assumptions
  4. validation steps
- Do not merge to main.
- If an interface contract is unclear, propose a change in docs before implementing code against a guess.
- Every feature change must include at least one validation step or test.
- Update the relevant task file in `tasks/`.

## Ownership boundaries
- Ingestion agent: telemetry collection, intake APIs, agents, collectors, pipelines into storage.
- Storage agent: schemas, storage engine, query APIs, indexing, retention behavior.
- Frontend agent: dashboards, service pages, trace/log/metric UI, navigation.
- Alerts agent: monitors, rules, threshold evaluation, notifications, incident flow.
- Reviewer agent: no feature ownership; reviews specs, diffs, contracts, integration risks.

## Required output format for every task
1. Objective
2. Plan
3. Files to change
4. Assumptions
5. Implementation
6. Validation
7. Open issues