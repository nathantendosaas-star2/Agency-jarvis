# Agent Operations

## Safe initial state

The global schedule and all six agent definitions are disabled by migration 009. Keep them disabled until the database migration, GitHub secrets, provider quotas, and task-producing workflows are verified.

## Queue task examples

Insert tasks only after enabling the matching agent and reviewing the payload. Example Workbench task:

```sql
INSERT INTO public.agent_tasks(agent_id,task_type,payload,idempotency_key)
VALUES (
  'workbench','workbench',
  '{"prompt":"Prepare a market-entry strategy for a Kampala premium spa","taskType":"marketing_strategy"}'::jsonb,
  'workbench:market-entry-kampala-spa:v1'
);
```

Lead pipeline task:

```sql
INSERT INTO public.agent_tasks(agent_id,task_type,payload,idempotency_key)
VALUES (
  'lead_reviewer','lead_pipeline',
  '{"leadId":"00000000-0000-0000-0000-000000000000","stage":"research_pending"}'::jsonb,
  'lead-review:00000000-0000-0000-0000-000000000000:v1'
);
```

Replace the example UUID with an existing lead ID. The pipeline now leaves researched leads in `needs_review`; only a separate explicit qualification allows outreach draft generation.

## Recovery

Tasks with expired leases can be safely requeued by the recovery statement in migration 009. A task that exhausts `max_attempts` becomes failed. Inspect `agent_runs`, `agent_tasks`, and `agent_run_logs` for diagnosis.

## Manual runs

Use GitHub Actions → Agency Jarvis Autonomous Cycle → Run workflow. Select `force_run=true` to bypass the due-time check. The database lock still prevents overlapping execution.


## Specialist agent workflows

Six disabled-by-default specialist definitions are supported:

- **Discovery** searches public sources, checks duplicate candidates and creates unqualified lead records with source URLs. Each candidate is enqueued for research.
- **Business Research** collects public business evidence and writes a structured research record. It routes the lead to `needs_review`.
- **Lead Reviewer** checks source coverage, activity evidence, service fit and public contact availability. It does not set `lead_status=qualified`.
- **Outreach Strategist** requires a human-qualified lead. It generates a draft and a pending approval record only; it never sends.
- **Workbench Specialist** runs internal Workbench prompts and saves output/artifact metadata to the existing Workbench record.
- **Operations & Reporting** summarises recent runs, task queue state and daily recorded usage.

## Legacy queue integration

New Workbench and lead-pipeline records are mirrored to `agent_tasks` with stable idempotency keys and a source table/row reference. The standalone runner also bridges existing pending legacy records and reconciles terminal records. The Express web process no longer starts a second Workbench or lead-pipeline worker.

## Usage accounting and daily caps

Provider requests made during autonomous runs are intercepted at the fetch boundary, including provider calls made indirectly by Workbench tools. Before each Gemini, OpenRouter or Tavily request the runner reserves quota and estimated spend in Postgres. After a successful response, it stores token counts (Gemini/OpenRouter), search count (Tavily), and provider-reported cost where returned; configured model rates are used as the cost basis otherwise. Failed requests release their reservation.

Configure the GitHub Actions secret `AGENT_MODEL_PRICING_JSON` using this shape:

```json
{
  "gemini:gemini-3.5-flash-lite": {
    "inputUsdPerMillion": 0,
    "outputUsdPerMillion": 0,
    "free": true
  },
  "openrouter:openrouter/free": {
    "inputUsdPerMillion": 0,
    "outputUsdPerMillion": 0,
    "free": true
  },
  "tavily:search": {
    "requestUsd": 0,
    "free": true
  }
}
```

This is a configuration example, not a claim that any provider/model is currently free. Verify the applicable provider price and account quota before entering values. Unknown prices are blocked. AI pricing must include both input and output rates, unless explicitly marked `free: true`; search pricing must include a per-request rate unless explicitly marked free. The DB defaults are a USD 0 daily cap and paid models disabled. Reservations are serialized against daily AI-call, search and spend limits. The task-claim RPC also enforces the daily task cap.

## Database and deployment validation

Migration 010 adds source-queue references, usage reservations and guarded cost-limit RPCs, and revokes public/anon/authenticated execution of the SECURITY DEFINER queue/usage RPCs. It is additive and leaves schedule/agent enablement unchanged. Apply and verify it on a development Supabase project before production.

The connected Agency-Jarvis Supabase project was paused during this implementation. Live SQL validation and migration application remain blocked until it is restored or a separate active development project is connected. Do not restore it without reviewing any associated billing implications.

The scheduling workflow has a pull-request validation job separate from the actual runner job. Production cron execution still requires valid GitHub Actions secrets, a live Supabase project and an observed scheduled run. The web app deployment host is separate from GitHub Actions; repository changes alone do not prove the hosting provider deployed or passed its health check.
