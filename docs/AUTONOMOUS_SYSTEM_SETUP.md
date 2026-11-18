# Autonomous System Setup

## Current implementation status

This repository adds the durable execution schema and a standalone Node.js 22 runner. The global scheduler is deliberately seeded **disabled**. No production schedule starts until migration 009 is applied and an administrator enables the schedule after reviewing provider quotas.

## Required GitHub Actions secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only; never expose to browser code)

Add only the provider secrets needed by queued task types:
- `GEMINI_API_KEY`
- `OPENROUTER_API_KEY`
- `TAVILY_API_KEY`

Optional repository variable: `AI_PROVIDER`.

## Database

Apply `database/migrations/009_autonomous_execution.sql` in the Supabase SQL Editor after migrations 001–008. The migration is additive, creates execution tables and atomic claim/lease functions, seeds six agent definitions disabled, and creates a disabled primary schedule. It does not delete or reset application data.

## Enable scheduling

After verifying the migration and GitHub secrets, update `agent_schedules` row `schedule_id='primary'`:
- set `enabled=true`
- set `interval_minutes=300`
- set `next_run_at=now()` for an initial cycle

Agent definitions are seeded disabled. Enable only agents and task types that have been configured and tested. The runner currently supports generic `health_check`, `workbench`, and `lead_pipeline` tasks inserted into `agent_tasks`.

## Schedule behaviour

GitHub Actions checks hourly at minute 17. The runner compares the database `next_run_at` to UTC now; if not due or globally disabled, it exits. A successful scheduled run advances `next_run_at` by the configured interval. GitHub may delay or drop scheduled runs, so five hours is an approximate interval, not a precise SLA.

Manual workflow dispatch with `force_run=true` bypasses the due-time check but still requires the database lock. It does not advance the scheduled timestamp.

## Safety

- No outbound message-sending handler is registered in the standalone runner.
- The schedule is disabled by default.
- Task claiming uses PostgreSQL `FOR UPDATE SKIP LOCKED`.
- Worker and scheduler leases prevent concurrent runs; expired task leases can be recovered by rerunning the migration's recovery statement or by operations.
- AI and search API quotas may cost money; configure provider-side limits and monitor `agent_usage`.
- GitHub Actions minute allowances and Supabase free quotas are plan-dependent and can change.

## Known gaps before production autonomy

The current runner is an execution foundation, not a completed implementation of all six specialist agents. It does not yet autonomously discover prospects or create lead candidates, does not import the user's external lead-review playbook into database prompts, does not yet write provider usage rows, and does not yet expose an operations dashboard. Existing lead-pipeline and Workbench services still have their own legacy workers. Do not enable broad scheduled production workloads until these are unified and the approval-state behaviour is audited.
