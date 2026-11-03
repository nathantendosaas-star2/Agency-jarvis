-- Add the lead-reviewer fields required by the MVP application.
-- This is additive: 001_initial_schema.sql has already been applied to the live project.

alter table public.leads
  add column if not exists business_name text,
  add column if not exists normalized_website text,
  add column if not exists business_category text,
  add column if not exists lead_status text,
  add column if not exists research_status text,
  add column if not exists qualification_score integer,
  add column if not exists notes text;

update public.leads
set
  business_name = coalesce(nullif(business_name, ''), company_name),
  business_category = coalesce(nullif(business_category, ''), industry),
  lead_status = coalesce(
    lead_status,
    case
      when status = 'pending_review' then 'new'
      when status in ('new', 'researched', 'contacted', 'replied', 'disqualified', 'converted') then status
      else 'new'
    end
  ),
  research_status = coalesce(research_status, 'pending'),
  normalized_website = coalesce(
    normalized_website,
    nullif(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(trim(website)), '^https?://', ''),
          '^www\.', ''
        ),
        '[/#?].*$',
        ''
      ),
      ''
    )
  ),
  notes = coalesce(notes, message);

alter table public.leads
  alter column business_name set not null,
  alter column lead_status set default 'new',
  alter column lead_status set not null,
  alter column research_status set default 'pending',
  alter column research_status set not null;

create index if not exists leads_normalized_website_idx
  on public.leads(normalized_website)
  where normalized_website is not null and normalized_website <> '';
create index if not exists leads_research_status_idx
  on public.leads(research_status);

alter table public.lead_research
  add column if not exists services_offered jsonb not null default '[]'::jsonb,
  add column if not exists target_market text,
  add column if not exists evidence_activity text,
  add column if not exists marketing_opportunities jsonb not null default '[]'::jsonb,
  add column if not exists potential_limitations jsonb not null default '[]'::jsonb,
  add column if not exists suggested_smma_services jsonb not null default '[]'::jsonb,
  add column if not exists qualification_score integer,
  add column if not exists qualification_reasoning text,
  add column if not exists research_sources jsonb not null default '[]'::jsonb,
  add column if not exists raw_research jsonb not null default '{}'::jsonb;

create index if not exists lead_research_created_at_idx
  on public.lead_research(created_at desc);

comment on column public.leads.business_name is
  'Application-facing business name; mirrored from company_name for existing records.';
