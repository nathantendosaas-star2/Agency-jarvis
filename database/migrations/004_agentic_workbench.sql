-- Agency Jarvis: enable HTML landing-page deliverables in Workbench.
-- Existing tasks and task history are preserved.
ALTER TABLE public.workbench_tasks
  DROP CONSTRAINT IF EXISTS workbench_tasks_task_type_check;

ALTER TABLE public.workbench_tasks
  ADD CONSTRAINT workbench_tasks_task_type_check
  CHECK (task_type IN (
    'research',
    'redesign_brief',
    'smma_proposal',
    'marketing_strategy',
    'social_ideas',
    'creative_brief',
    'client_recommendations',
    'landing_page'
  ));
