-- Supabase PostgreSQL Initial Schema for Agency Jarvis MVP
-- Run this migration in the Supabase SQL Editor.

-- Enable pgcrypto or uuid-ossp for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Leads Table
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL,
  website TEXT,
  normalized_website TEXT,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  business_category TEXT,
  location TEXT,
  source TEXT DEFAULT 'manual',
  lead_status TEXT NOT NULL DEFAULT 'new' CHECK (lead_status IN ('new', 'researched', 'contacted', 'replied', 'disqualified', 'converted')),
  research_status TEXT NOT NULL DEFAULT 'pending' CHECK (research_status IN ('pending', 'in_progress', 'completed', 'failed')),
  qualification_score INTEGER CHECK (qualification_score >= 0 AND qualification_score <= 100),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Unique constraint and indexes for Leads
CREATE UNIQUE INDEX IF NOT EXISTS leads_normalized_website_idx ON public.leads (normalized_website) WHERE normalized_website IS NOT NULL AND normalized_website <> '';
CREATE INDEX IF NOT EXISTS leads_email_idx ON public.leads (email) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS leads_created_at_idx ON public.leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_status_idx ON public.leads (lead_status);
CREATE INDEX IF NOT EXISTS leads_research_status_idx ON public.leads (research_status);

-- 2. Lead Research Table
CREATE TABLE IF NOT EXISTS public.lead_research (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  summary TEXT,
  services_offered JSONB DEFAULT '[]'::jsonb,
  target_market TEXT,
  evidence_activity TEXT,
  marketing_opportunities JSONB DEFAULT '[]'::jsonb,
  potential_limitations JSONB DEFAULT '[]'::jsonb,
  suggested_smma_services JSONB DEFAULT '[]'::jsonb,
  qualification_score INTEGER CHECK (qualification_score >= 0 AND qualification_score <= 100),
  qualification_reasoning TEXT,
  research_sources JSONB DEFAULT '[]'::jsonb,
  raw_research JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS lead_research_lead_id_idx ON public.lead_research (lead_id);

-- 3. Outreach Records Table
CREATE TABLE IF NOT EXISTS public.outreach_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'linkedin', 'phone', 'other')),
  recipient TEXT NOT NULL,
  subject TEXT,
  message_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'failed', 'delivered', 'opened', 'replied')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS outreach_records_lead_id_idx ON public.outreach_records (lead_id);
CREATE INDEX IF NOT EXISTS outreach_records_status_idx ON public.outreach_records (status);

-- 4. Social Media Content Table
CREATE TABLE IF NOT EXISTS public.social_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  platforms JSONB DEFAULT '["twitter"]'::jsonb,
  media_urls JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'failed')),
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS social_content_status_idx ON public.social_content (status);

-- 5. Application Settings Table
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Trigger to auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_leads_updated_at ON public.leads;
CREATE TRIGGER set_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_lead_research_updated_at ON public.lead_research;
CREATE TRIGGER set_lead_research_updated_at
  BEFORE UPDATE ON public.lead_research
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_outreach_records_updated_at ON public.outreach_records;
CREATE TRIGGER set_outreach_records_updated_at
  BEFORE UPDATE ON public.outreach_records
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_social_content_updated_at ON public.social_content;
CREATE TRIGGER set_social_content_updated_at
  BEFORE UPDATE ON public.social_content
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
