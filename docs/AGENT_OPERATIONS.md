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
