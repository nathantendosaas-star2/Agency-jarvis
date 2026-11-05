-- Allow the worker to classify prompts asynchronously.
ALTER TABLE public.workbench_tasks DROP CONSTRAINT IF EXISTS workbench_tasks_task_type_check;
ALTER TABLE public.workbench_tasks ADD CONSTRAINT workbench_tasks_task_type_check
  CHECK (task_type IN ('auto', 'research', 'redesign_brief', 'smma_proposal', 'marketing_strategy', 'social_ideas', 'creative_brief', 'client_recommendations', 'landing_page'));
