-- Specialist workflows, legacy queue bridge and cost controls. Additive and idempotent.
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS source_queue TEXT;
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS source_task_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS agent_tasks_source_queue_task_uidx
 ON public.agent_tasks(source_queue,source_task_id)
 WHERE source_queue IS NOT NULL AND source_task_id IS NOT NULL;

ALTER TABLE public.agent_schedules
 ADD COLUMN IF NOT EXISTS daily_budget_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS allow_paid_models BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.agent_usage
 ADD COLUMN IF NOT EXISTS reservation_id UUID,
 ADD COLUMN IF NOT EXISTS billing_basis TEXT NOT NULL DEFAULT 'configured_model_pricing';
CREATE UNIQUE INDEX IF NOT EXISTS agent_usage_reservation_uidx
 ON public.agent_usage(reservation_id);

CREATE TABLE IF NOT EXISTS public.agent_usage_reservations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id UUID REFERENCES public.agent_runs(id) ON DELETE SET NULL,
 agent_id TEXT NOT NULL,
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 usage_type TEXT NOT NULL CHECK (usage_type IN ('ai','search')),
 reserved_units INTEGER NOT NULL DEFAULT 1 CHECK (reserved_units BETWEEN 1 AND 20),
 estimated_cost NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (estimated_cost >= 0),
 actual_cost NUMERIC(12,6),
 status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','settled','released')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 settled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_usage_reservations_day_idx
 ON public.agent_usage_reservations(created_at,status,usage_type);

CREATE OR REPLACE FUNCTION public.claim_agent_task(p_worker TEXT,p_lease_seconds INTEGER DEFAULT 300)
RETURNS SETOF public.agent_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_daily_limit INTEGER; v_claimed_today BIGINT;
BEGIN
 SELECT daily_task_limit INTO v_daily_limit
 FROM public.agent_schedules
 WHERE schedule_id='primary' AND enabled=TRUE
 FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;

 SELECT count(*) INTO v_claimed_today
 FROM public.agent_tasks
 WHERE attempts > 0
   AND updated_at >= date_trunc('day',now());
 IF v_claimed_today >= v_daily_limit THEN RETURN; END IF;

 RETURN QUERY
 WITH candidate AS (
  SELECT t.id FROM public.agent_tasks t
  JOIN public.agent_definitions d ON d.agent_id=t.agent_id AND d.enabled=TRUE
  WHERE t.status='pending' AND t.next_attempt_at<=now() AND t.attempts<t.max_attempts
  ORDER BY t.priority ASC,t.created_at ASC
  FOR UPDATE OF t SKIP LOCKED LIMIT 1
 )
 UPDATE public.agent_tasks t
 SET status='running',attempts=t.attempts+1,locked_at=now(),locked_by=p_worker,
     lease_expires_at=now()+make_interval(secs=>GREATEST(30,LEAST(p_lease_seconds,900))),
     updated_at=now()
 FROM candidate c WHERE t.id=c.id RETURNING t.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_agent_usage(
 p_run_id UUID,p_agent_id TEXT,p_provider TEXT,p_model TEXT,
 p_usage_type TEXT,p_units INTEGER,p_estimated_cost NUMERIC
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE s public.agent_schedules%ROWTYPE;
 v_ai_used BIGINT; v_search_used BIGINT; v_ai_reserved BIGINT; v_search_reserved BIGINT;
 v_cost_used NUMERIC(12,6); v_cost_reserved NUMERIC(12,6); v_id UUID;
BEGIN
 IF p_usage_type NOT IN ('ai','search') OR p_units<1 OR p_units>20 OR p_estimated_cost<0 THEN
  RAISE EXCEPTION 'Invalid usage reservation';
 END IF;
 SELECT * INTO s FROM public.agent_schedules WHERE schedule_id='primary' FOR UPDATE;
 IF NOT FOUND OR s.enabled IS NOT TRUE THEN RAISE EXCEPTION 'Autonomous schedule is disabled'; END IF;
 SELECT COALESCE(sum(request_count),0) INTO v_ai_used FROM public.agent_usage WHERE created_at>=date_trunc('day',now());
 SELECT COALESCE(sum(search_count),0) INTO v_search_used FROM public.agent_usage WHERE created_at>=date_trunc('day',now());
 SELECT COALESCE(sum(reserved_units),0) INTO v_ai_reserved FROM public.agent_usage_reservations
  WHERE status='reserved' AND usage_type='ai' AND created_at>=date_trunc('day',now());
 SELECT COALESCE(sum(reserved_units),0) INTO v_search_reserved FROM public.agent_usage_reservations
  WHERE status='reserved' AND usage_type='search' AND created_at>=date_trunc('day',now());
 SELECT COALESCE(sum(estimated_cost),0) INTO v_cost_used FROM public.agent_usage WHERE created_at>=date_trunc('day',now());
 SELECT COALESCE(sum(estimated_cost),0) INTO v_cost_reserved FROM public.agent_usage_reservations
  WHERE status='reserved' AND created_at>=date_trunc('day',now());

 IF p_usage_type='ai' AND v_ai_used+v_ai_reserved+p_units>s.daily_ai_call_limit THEN
  RAISE EXCEPTION 'Daily AI-call limit reached';
 END IF;
 IF p_usage_type='search' AND v_search_used+v_search_reserved+p_units>s.daily_search_limit THEN
  RAISE EXCEPTION 'Daily search limit reached';
 END IF;
 IF p_estimated_cost>0 AND s.allow_paid_models IS NOT TRUE THEN
  RAISE EXCEPTION 'Paid models are disabled for autonomous execution';
 END IF;
 IF v_cost_used+v_cost_reserved+p_estimated_cost>s.daily_budget_usd THEN
  RAISE EXCEPTION 'Daily autonomous spend limit would be exceeded';
 END IF;

 INSERT INTO public.agent_usage_reservations(run_id,agent_id,provider,model,usage_type,reserved_units,estimated_cost)
 VALUES(p_run_id,p_agent_id,p_provider,p_model,p_usage_type,p_units,p_estimated_cost)
 RETURNING id INTO v_id;
 RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_agent_usage(
 p_reservation_id UUID,p_request_count INTEGER,p_input_tokens BIGINT,p_output_tokens BIGINT,
 p_search_count INTEGER,p_actual_cost NUMERIC,p_billing_basis TEXT,p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE r public.agent_usage_reservations%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.agent_usage_reservations WHERE id=p_reservation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Usage reservation not found'; END IF;
 IF r.status='settled' THEN RETURN TRUE; END IF;
 IF r.status<>'reserved' THEN RAISE EXCEPTION 'Usage reservation is no longer active'; END IF;
 IF p_request_count<0 OR p_search_count<0 OR p_actual_cost<0 THEN RAISE EXCEPTION 'Invalid usage settlement'; END IF;
 INSERT INTO public.agent_usage(provider,model,agent_id,run_id,request_count,input_tokens,output_tokens,
   search_count,estimated_cost,reservation_id,billing_basis,metadata)
 VALUES(r.provider,r.model,r.agent_id,r.run_id,p_request_count,p_input_tokens,p_output_tokens,
   p_search_count,p_actual_cost,r.id,p_billing_basis,COALESCE(p_metadata,'{}'::jsonb))
 ON CONFLICT(reservation_id) DO NOTHING;
 UPDATE public.agent_usage_reservations SET status='settled',actual_cost=p_actual_cost,settled_at=now() WHERE id=r.id;
 RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_agent_usage(p_reservation_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_rows INTEGER;
BEGIN
 UPDATE public.agent_usage_reservations SET status='released',settled_at=now()
 WHERE id=p_reservation_id AND status='reserved';
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 RETURN v_rows>0;
END;
$$;

ALTER TABLE public.agent_usage_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_usage_reservations FROM anon,authenticated;
GRANT ALL ON public.agent_usage_reservations TO service_role;

REVOKE ALL ON FUNCTION public.claim_agent_task(TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.acquire_agent_lock(TEXT,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.release_agent_lock(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reserve_agent_usage(UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,NUMERIC) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.settle_agent_usage(UUID,INTEGER,BIGINT,BIGINT,INTEGER,NUMERIC,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.release_agent_usage(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_agent_task(TEXT,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_agent_lock(TEXT,TEXT,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_agent_lock(TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_agent_usage(UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_agent_usage(UUID,INTEGER,BIGINT,BIGINT,INTEGER,NUMERIC,TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_agent_usage(UUID) TO service_role;
