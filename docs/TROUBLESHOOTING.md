# Autonomous System Troubleshooting

## Workflow exits with missing configuration

Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as GitHub Actions repository secrets. Add provider secrets only for the task types being used.

## Runner says no cycle is due

Check `agent_schedules` row `schedule_id='primary'`. It must have `enabled=true` and `next_run_at <= now()`. A manual workflow run can use `force_run=true`.

## Runner cannot claim tasks

Confirm migration 009 is applied, task `agent_id` exists and is enabled, task status is pending, `next_attempt_at` is in the past, and attempts are below max_attempts.

## Another runner owns the lock

Wait for the lease to expire or inspect `agent_locks`. Do not manually delete a lock while its owner may still be running.

## Tasks repeatedly fail

Inspect `agent_tasks.error` and `agent_run_logs`. Confirm that task payloads match the supported handler contract and provider credentials/quotas are valid.

## Production schedule

Do not assume the workflow YAML alone means the system is running. Verify GitHub Actions execution, Supabase run records, and the next-run timestamp.
