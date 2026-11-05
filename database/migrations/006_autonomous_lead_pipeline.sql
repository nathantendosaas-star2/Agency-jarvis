-- Supabase PostgreSQL Migration for Autonomous Lead-to-Outreach Automation
-- Idempotent and safe to rerun against the production database.

-- 1. Extend leads table with outreach_channel, instagram handle/URL, processing stages and error fields
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS outreach_channel TEXT DEFAULT 'gmail',
  ADD COLUMN IF NOT EXISTS instagram TEXT,
  ADD COLUMN IF NOT EXISTS processing_stage TEXT DEFAULT 'imported',
  ADD COLUMN IF NOT EXISTS processing_error TEXT;

-- Outreach channel check constraint on leads
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_outreach_channel_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_outreach_channel_check
  CHECK (outreach_channel IN ('gmail', 'instagram', 'whatsapp'));

-- Processing stage check constraint on leads
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_processing_stage_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_processing_stage_check
  CHECK (processing_stage IN (
    'imported',
    'research_pending',
    'researching',
    'research_completed',
    'review_pending',
    'reviewing',
    'review_completed',
    'draft_generation_pending',
    'generating_draft',
    'draft_approved',
    'failed'
  ));

CREATE INDEX IF NOT EXISTS leads_outreach_channel_idx ON public.leads (outreach_channel);
CREATE INDEX IF NOT EXISTS leads_processing_stage_idx ON public.leads (processing_stage);

-- 2. Update outreach_records channel constraint and add generation/approval metadata
ALTER TABLE public.outreach_records DROP CONSTRAINT IF EXISTS outreach_records_channel_check;
ALTER TABLE public.outreach_records ADD CONSTRAINT outreach_records_channel_check
  CHECK (channel IN ('gmail', 'instagram', 'whatsapp', 'email', 'linkedin', 'phone', 'other'));

ALTER TABLE public.outreach_records
  ADD COLUMN IF NOT EXISTS model_used TEXT,
  ADD COLUMN IF NOT EXISTS generation_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_auto_approved BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS outreach_records_channel_idx ON public.outreach_records (channel);

-- 3. Lead Pipeline Jobs Table (Database-backed queue for reliable background processing)
CREATE TABLE IF NOT EXISTS public.lead_pipeline_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN (
    'research_pending',
    'researching',
    'research_completed',
    'review_pending',
    'reviewing',
    'review_completed',
    'draft_generation_pending',
    'generating_draft',
    'draft_approved',
    'failed'
  )),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error_message TEXT,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS lead_pipeline_jobs_lead_id_idx ON public.lead_pipeline_jobs (lead_id);
CREATE INDEX IF NOT EXISTS lead_pipeline_jobs_status_idx ON public.lead_pipeline_jobs (status);
CREATE INDEX IF NOT EXISTS lead_pipeline_jobs_created_at_idx ON public.lead_pipeline_jobs (created_at ASC);

-- Trigger for lead_pipeline_jobs updated_at
DROP TRIGGER IF EXISTS set_lead_pipeline_jobs_updated_at ON public.lead_pipeline_jobs;
CREATE TRIGGER set_lead_pipeline_jobs_updated_at
  BEFORE UPDATE ON public.lead_pipeline_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 4. Enable Row Level Security and permissions for service_role
ALTER TABLE public.lead_pipeline_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lead_pipeline_jobs FROM anon, authenticated;
GRANT ALL ON TABLE public.lead_pipeline_jobs TO service_role;
