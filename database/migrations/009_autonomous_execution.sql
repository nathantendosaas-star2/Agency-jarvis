-- Agency Jarvis autonomous execution infrastructure.
-- Additive only: preserves all existing leads, workbench tasks, approvals and settings.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.agent_definitions (
  agent_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  permissions JSONB NOT NULL DEFAULT '{"read":true,"write":true,"queue":true,"execute":false}'::jsonb,
  provider TEXT,
  model TEXT,
  max_tasks_per_run INTEGER NOT NULL DEFAULT 5 CHECK (max_tasks_per_run BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('schedule','manual')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','partial','failed','skipped')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  agents_selected TEXT[] NOT NULL DEFAULT '{}',
  tasks_processed INTEGER NOT NULL DEFAULT 0,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_failed INTEGER NOT NULL DEFAULT 0,
  usage_totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL REFERENCES public.agent_definitions(agent_id),
  task_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','needs_review','cancelled')),
  priority INTEGER NOT NULL DEFAULT 100,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  output JSONB,
  error TEXT,
  run_id UUID REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_tasks_claim_idx
  ON public.agent_tasks(status, next_attempt_at, priority, created_at);
CREATE INDEX IF NOT EXISTS agent_tasks_agent_status_idx ON public.agent_tasks(agent_id,status);
CREATE INDEX IF NOT EXISTS agent_runs_started_idx ON public.agent_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS public.agent_run_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id UUID REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  agent_id TEXT,
  task_id UUID REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('debug','info','warn','error')),
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_run_logs_run_idx ON public.agent_run_logs(run_id,created_at);

CREATE TABLE IF NOT EXISTS public.agent_schedules (
  schedule_id TEXT PRIMARY KEY DEFAULT 'primary',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  interval_minutes INTEGER NOT NULL DEFAULT 300 CHECK (interval_minutes BETWEEN 60 AND 10080),
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  daily_task_limit INTEGER NOT NULL DEFAULT 20 CHECK (daily_task_limit BETWEEN 1 AND 500),
  daily_ai_call_limit INTEGER NOT NULL DEFAULT 100 CHECK (daily_ai_call_limit BETWEEN 1 AND 5000),
  daily_search_limit INTEGER NOT NULL DEFAULT 50 CHECK (daily_search_limit BETWEEN 0 AND 5000),
  max_runtime_seconds INTEGER NOT NULL DEFAULT 420 CHECK (max_runtime_seconds BETWEEN 30 AND 900),
  max_tasks_per_run INTEGER NOT NULL DEFAULT 10 CHECK (max_tasks_per_run BETWEEN 1 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.agent_schedules(schedule_id,enabled,next_run_at)
VALUES ('primary',false,now()) ON CONFLICT (schedule_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.agent_locks (
  lock_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.agent_usage (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT,
  agent_id TEXT,
  run_id UUID REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  input_tokens BIGINT,
  output_tokens BIGINT,
  search_count INTEGER NOT NULL DEFAULT 0,
  estimated_cost NUMERIC(12,6),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_usage_created_idx ON public.agent_usage(created_at DESC);

-- Seed roles as disabled only where no prior definition exists. Global schedule stays paused.
INSERT INTO public.agent_definitions(agent_id,name,description,enabled) VALUES
 ('discovery','Discovery','Find candidate businesses and public contact routes.',false),
 ('research','Business Research','Research prospect websites, positioning and evidence.',false),
 ('lead_reviewer','Lead Reviewer','Apply evidence-led qualification and duplicate checks.',false),
 ('outreach','Outreach Strategist','Prepare outreach drafts for human review; never send.',false),
 ('workbench','Workbench Specialist','Process authorised internal Workbench tasks.',false),
 ('operations','Operations & Reporting','Summarise runs, failures and usage.',false)
ON CONFLICT (agent_id) DO NOTHING;

-- Atomic claim: one transaction/statement claims at most one eligible task.
CREATE OR REPLACE FUNCTION public.claim_agent_task(p_worker TEXT, p_lease_seconds INTEGER DEFAULT 300)
RETURNS SETOF public.agent_tasks
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidate AS (
    SELECT t.id
    FROM public.agent_tasks t
    JOIN public.agent_definitions d ON d.agent_id=t.agent_id AND d.enabled=true
    WHERE t.status='pending'
      AND t.next_attempt_at <= now()
      AND t.attempts < t.max_attempts
    ORDER BY t.priority ASC, t.created_at ASC
    FOR UPDATE OF t SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.agent_tasks t
  SET status='running', attempts=t.attempts+1, locked_at=now(),
      locked_by=p_worker, lease_expires_at=now()+make_interval(secs=>GREATEST(30,LEAST(p_lease_seconds,900))),
      updated_at=now()
  FROM candidate c
  WHERE t.id=c.id
  RETURNING t.*;
$$;

CREATE OR REPLACE FUNCTION public.acquire_agent_lock(p_lock_id TEXT,p_owner TEXT,p_lease_seconds INTEGER DEFAULT 600)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE acquired BOOLEAN;
BEGIN
  INSERT INTO public.agent_locks(lock_id,owner,acquired_at,expires_at)
  VALUES(p_lock_id,p_owner,now(),now()+make_interval(secs=>GREATEST(30,LEAST(p_lease_seconds,1800))))
  ON CONFLICT(lock_id) DO UPDATE
    SET owner=EXCLUDED.owner,acquired_at=now(),expires_at=EXCLUDED.expires_at
    WHERE public.agent_locks.expires_at < now()
       OR public.agent_locks.owner = p_owner;
  GET DIAGNOSTICS acquired = ROW_COUNT;
  RETURN acquired;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_agent_lock(p_lock_id TEXT,p_owner TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE released BOOLEAN;
BEGIN
  DELETE FROM public.agent_locks WHERE lock_id=p_lock_id AND owner=p_owner;
  GET DIAGNOSTICS released = ROW_COUNT;
  RETURN released;
END;
$$;

-- Requeue expired task leases with bounded exponential backoff; exhaust attempts into failed.
UPDATE public.agent_tasks
SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'pending' END,
    error=COALESCE(error,'Worker lease expired; task recovered.'),
    next_attempt_at=now()+make_interval(secs=>LEAST(3600,(2^LEAST(attempts,10))::INTEGER*15)),
    locked_at=NULL,locked_by=NULL,lease_expires_at=NULL,updated_at=now()
WHERE status='running' AND lease_expires_at < now();

ALTER TABLE public.agent_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_run_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_definitions,public.agent_runs,public.agent_tasks,public.agent_run_logs,
 public.agent_schedules,public.agent_locks,public.agent_usage FROM anon,authenticated;
GRANT ALL ON public.agent_definitions,public.agent_runs,public.agent_tasks,public.agent_run_logs,
 public.agent_schedules,public.agent_locks,public.agent_usage TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_agent_task(TEXT,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_agent_lock(TEXT,TEXT,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_agent_lock(TEXT,TEXT) TO service_role;
