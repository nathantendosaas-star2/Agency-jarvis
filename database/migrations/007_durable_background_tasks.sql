-- Durable background Workbench queue.
-- Workbench tasks are inserted as pending and executed by the backend worker.
ALTER TABLE public.workbench_tasks
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by TEXT;

ALTER TABLE public.workbench_tasks DROP CONSTRAINT IF EXISTS workbench_tasks_task_type_check;
ALTER TABLE public.workbench_tasks ADD CONSTRAINT workbench_tasks_task_type_check
  CHECK (task_type IN ('research', 'redesign_brief', 'smma_proposal', 'marketing_strategy', 'social_ideas', 'creative_brief', 'client_recommendations', 'landing_page'));

CREATE INDEX IF NOT EXISTS workbench_tasks_pending_created_idx
  ON public.workbench_tasks (created_at ASC) WHERE status = 'pending';

-- Existing running tasks may have been interrupted by the old request-bound implementation.
UPDATE public.workbench_tasks
SET status = 'pending', locked_at = NULL, locked_by = NULL
WHERE status = 'running';
