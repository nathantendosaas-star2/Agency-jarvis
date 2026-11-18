# Autonomous System Audit

**Audit basis:** live `main` branch at commit `679ed2cfb07820891fe0ab0c95a5c1d484e81ab3`, inspected 18 November 2026. This audit describes repository code, not the live Supabase project (database credentials and schema access were not available to the audit).

## Confirmed architecture

- Node.js 22+, CommonJS, Express 4.21, static HTML/CSS/vanilla JavaScript.
- Supabase JS client uses the server-only `SUPABASE_SERVICE_ROLE_KEY`.
- Authentication uses bcrypt password hash and signed cookie sessions; application API routes are mounted behind `requireAdmin`.
- AI/research code exists in `src/agents/orchestrator.js`, `creativeAgent.js`, `socialAgent.js`, `outreachAgent.js`, and services for OpenRouter, Tavily, leads, research, approvals and Workbench.
- Existing persistence migrations are numbered 001–008; migrations 006 and 007 add lead-pipeline and Workbench background-task state.
- Existing GitHub Actions workflow runs Node 22 tests on pushes to main and pull requests.
- Existing Render web-service configuration remains in place.

## Execution findings

1. `server.js` starts the Workbench polling worker and invokes lead-pipeline recovery only when Express starts. This couples background processing to the web process.
2. `workbenchService.js` claims a candidate using select followed by conditional update. The status compare-and-set limits duplicate claims, but it is not a single PostgreSQL row-locking claim function.
3. `leadPipelineService.js` uses the same select-then-conditional-update pattern for `lead_pipeline_jobs`.
4. Migration 007 adds `attempts`, `locked_at`, and `locked_by` to `workbench_tasks`; these names match the inspected worker queries. No `max_attempts` column is present on that table in the inspected migrations.
5. The lead pipeline originally marked AI score >=60 as qualified and auto-approved generated outreach records. This branch changes the pipeline so AI research is routed to `needs_review`, draft creation requires explicit `lead_status='qualified'`, and created drafts create pending approval records.
6. The existing six requested specialist roles are not six separate autonomous implementations in the repository. The code contains an orchestrator, creative/social/outreach agents, and service-level lead/Workbench processing; discovery and operations reporting need further implementation.
7. Existing lead pipeline and Workbench queues are separate from the new `agent_tasks` queue. Queue unification and dashboard observability are not yet complete.

## Implemented on this branch

- Additive migration 009 with definitions, runs, generic tasks, logs, schedules, locks and usage tables.
- PostgreSQL `FOR UPDATE SKIP LOCKED` atomic task claim RPC and lease-based scheduler lock RPCs.
- Standalone Node.js runner with due-time check, lock, bounded task count/runtime, durable run logs, retry/backoff and clean exit.
- GitHub Actions hourly schedule check plus manual dispatch.
- Human qualification and human outreach approval gates in the existing lead pipeline.
- Initial runner config tests and setup documentation.

## Not yet implemented / not verified

- Migration 009 has not been applied to the user's Supabase project.
- GitHub Actions secrets and workflow enablement have not been configured or verified.
- No live database connection was available; schema compatibility with the actual hosted project is unverified.
- Runner integration tests against Supabase have not been run.
- The runner currently supports `health_check`, `workbench`, and `lead_pipeline` task types only. Discovery, research, reviewer, outreach strategist and operations reporting are not yet wired as six fully autonomous workers.
- Existing `workbench_tasks` and `lead_pipeline_jobs` are not yet automatically bridged into `agent_tasks`.
- No Autonomous Operations dashboard views or controls have been implemented yet.
- Provider usage insertion and hard daily quota enforcement remain outstanding.
- The application has not been deployed or scheduled in production.

## Security and production caution

The schedule is seeded disabled and agent definitions are seeded disabled. Do not enable it until migration application, secrets, provider quotas, task producers, and the dashboard/control plane have been verified. No external send handler is registered in the standalone runner.
