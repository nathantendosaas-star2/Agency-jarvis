-- Supabase PostgreSQL Additive Migration for Agency Jarvis MVP Extensions
-- Run this migration in the Supabase SQL Editor.
-- This migration is strictly additive and preserves existing records.

-- 1. Ensure pgcrypto extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Expand lead_status check constraint on leads table
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_lead_status_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_lead_status_check
  CHECK (lead_status IN ('new', 'research_pending', 'researching', 'needs_review', 'researched', 'qualified', 'disqualified', 'contacted', 'replied', 'converted'));

-- Ensure research_status check constraint allows all application statuses
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_research_status_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_research_status_check
  CHECK (research_status IN ('pending', 'in_progress', 'completed', 'failed'));

-- 3. Clients Table
CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  website TEXT,
  industry TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'former', 'onboarding')),
  tier TEXT DEFAULT 'standard' CHECK (tier IN ('standard', 'growth', 'premium', 'custom')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS clients_name_idx ON public.clients (name);
CREATE INDEX IF NOT EXISTS clients_company_idx ON public.clients (company);
CREATE INDEX IF NOT EXISTS clients_status_idx ON public.clients (status);
CREATE INDEX IF NOT EXISTS clients_created_at_idx ON public.clients (created_at DESC);

-- 4. Workbench Tasks Table
CREATE TABLE IF NOT EXISTS public.workbench_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL CHECK (task_type IN ('research', 'redesign_brief', 'smma_proposal', 'marketing_strategy', 'social_ideas', 'creative_brief', 'client_recommendations')),
  prompt TEXT NOT NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  result TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS workbench_tasks_task_type_idx ON public.workbench_tasks (task_type);
CREATE INDEX IF NOT EXISTS workbench_tasks_status_idx ON public.workbench_tasks (status);
CREATE INDEX IF NOT EXISTS workbench_tasks_created_at_idx ON public.workbench_tasks (created_at DESC);

-- 5. Approvals Table (Backend-enforced approval system)
CREATE TABLE IF NOT EXISTS public.approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL CHECK (action_type IN ('send_email', 'schedule_post', 'publish_post', 'send_deliverable')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('outreach', 'social', 'workbench')),
  entity_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'cancelled')),
  title TEXT NOT NULL,
  summary TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  decision_notes TEXT,
  decided_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  execution_result JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS approvals_status_idx ON public.approvals (status);
CREATE INDEX IF NOT EXISTS approvals_entity_idx ON public.approvals (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS approvals_created_at_idx ON public.approvals (created_at DESC);

-- 6. Activity Logs Table
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS activity_logs_event_type_idx ON public.activity_logs (event_type);
CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx ON public.activity_logs (created_at DESC);

-- 7. Add columns to Outreach Records
ALTER TABLE public.outreach_records
  ADD COLUMN IF NOT EXISTS reply_content TEXT,
  ADD COLUMN IF NOT EXISTS reply_sentiment TEXT,
  ADD COLUMN IF NOT EXISTS reply_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS follow_up_recommendation TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_status TEXT DEFAULT 'none' CHECK (follow_up_status IN ('none', 'drafted', 'approved', 'sent')),
  ADD COLUMN IF NOT EXISTS error_message TEXT;

-- 8. Add columns to Social Media Content
ALTER TABLE public.social_content
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS buffer_profile_id TEXT,
  ADD COLUMN IF NOT EXISTS buffer_update_id TEXT,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS post_type TEXT DEFAULT 'post' CHECK (post_type IN ('post', 'calendar_entry', 'idea'));

-- Drop and recreate updated_at triggers for new tables
DROP TRIGGER IF EXISTS set_clients_updated_at ON public.clients;
CREATE TRIGGER set_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_workbench_tasks_updated_at ON public.workbench_tasks;
CREATE TRIGGER set_workbench_tasks_updated_at
  BEFORE UPDATE ON public.workbench_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_approvals_updated_at ON public.approvals;
CREATE TRIGGER set_approvals_updated_at
  BEFORE UPDATE ON public.approvals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- One-use approval execution state. Executing approvals cannot be reused.
ALTER TABLE public.approvals DROP CONSTRAINT IF EXISTS approvals_status_check;
ALTER TABLE public.approvals ADD CONSTRAINT approvals_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'executing', 'executed', 'cancelled'));

-- The server uses the service_role key only. Browser roles receive no table privileges.
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_research ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workbench_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.leads, public.lead_research, public.outreach_records,
  public.social_content, public.app_settings, public.clients, public.workbench_tasks,
  public.approvals, public.activity_logs FROM anon, authenticated;
GRANT ALL ON TABLE public.leads, public.lead_research, public.outreach_records,
  public.social_content, public.app_settings, public.clients, public.workbench_tasks,
  public.approvals, public.activity_logs TO service_role;
