# Autonomous System Architecture

## Components

- **Express application:** existing authenticated dashboard and APIs; remains separate from scheduled compute.
- **GitHub Actions:** hourly lightweight due-time check and manual workflow dispatch on Node.js 22.
- **Standalone runner:** `scripts/agent-runner.js`; does not start Express.
- **Supabase:** durable schedule, task, run, log, lock and usage state.
- **Existing agent code:** orchestrator and existing service adapters reused by supported task handlers.

## Execution sequence

1. Validate server-side Supabase configuration.
2. Read primary schedule; exit if disabled or not due (unless manual force-run).
3. Acquire database scheduler lease.
4. Create a durable run record.
5. Recover/claim eligible generic tasks through the atomic RPC.
6. Execute supported task handlers with bounded runtime and task count.
7. Persist task output or retry/failure state.
8. Persist run summary and advance the schedule after scheduled runs.
9. Release the scheduler lock.

## Persistence

Migration 009 adds agent definitions, runs, tasks, run logs, schedules, locks and usage. Existing leads, outreach, approvals, Workbench tasks and lead pipeline tables are retained. RLS is enabled and direct browser-role table access revoked; service-role grants remain server-side.

## Scheduling

GitHub Actions checks hourly at minute 17. The database `next_run_at` and `interval_minutes` determine whether the run is due. The default interval is 300 minutes, but schedule enablement is false by default. GitHub scheduled events are best-effort and can be delayed or dropped.

## Task contracts

- `health_check`: checks enabled agent definitions.
- `workbench`: payload includes `prompt` and optional `taskType`, `clientId`, `leadId`.
- `lead_pipeline`: payload includes `leadId` and optional `stage`; it performs research and routes the lead to review. A human must explicitly qualify it before draft generation.

Unsupported task types fail with a persisted error and retry policy. No message-send task type exists.
