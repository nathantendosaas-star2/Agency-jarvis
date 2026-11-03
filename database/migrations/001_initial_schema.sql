-- Agency Jarvis MVP initial schema. Backend-only access via service_role.
create extension if not exists pgcrypto;

create table public.leads (
 id uuid primary key default gen_random_uuid(),
 source text not null default 'google_sheets',
 source_record_id text,
 company_name text not null,
 contact_name text,
 email text,
 phone text,
 website text,
 location text,
 industry text,
 service_interest text,
 message text,
 status text not null default 'pending_review',
 raw_submission jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (source, source_record_id)
);
create index leads_status_idx on public.leads(status);
create index leads_created_at_idx on public.leads(created_at desc);
create index leads_company_name_idx on public.leads(company_name);
create index leads_email_idx on public.leads(email);

create table public.lead_research (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null references public.leads(id) on delete cascade,
 research_type text not null default 'qualification',
 summary text,
 findings jsonb not null default '{}'::jsonb,
 evidence jsonb not null default '[]'::jsonb,
 sources jsonb not null default '[]'::jsonb,
 confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
 qualification_decision text,
 model text,
 researched_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create index lead_research_lead_id_idx on public.lead_research(lead_id);
create index lead_research_researched_at_idx on public.lead_research(researched_at desc);

create table public.outreach_records (
 id uuid primary key default gen_random_uuid(),
 lead_id uuid references public.leads(id) on delete set null,
 channel text not null default 'email',
 direction text not null default 'outbound',
 recipient text,
 subject text,
 body text not null,
 status text not null default 'draft',
 approval_status text not null default 'pending',
 approved_at timestamptz,
 sent_at timestamptz,
 provider_message_id text,
 idempotency_key text unique,
 response_text text,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index outreach_records_lead_id_idx on public.outreach_records(lead_id);
create index outreach_records_status_idx on public.outreach_records(status);
create index outreach_records_created_at_idx on public.outreach_records(created_at desc);

create table public.social_content (
 id uuid primary key default gen_random_uuid(),
 client_name text,
 platform text not null,
 channel_id text,
 title text,
 caption text not null,
 media_urls text[] not null default '{}'::text[],
 scheduled_for timestamptz,
 buffer_update_id text,
 status text not null default 'draft',
 approval_status text not null default 'pending',
 approved_at timestamptz,
 published_at timestamptz,
 idempotency_key text unique,
 last_error text,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index social_content_status_idx on public.social_content(status);
create index social_content_scheduled_for_idx on public.social_content(scheduled_for);
create index social_content_platform_idx on public.social_content(platform);
create index social_content_created_at_idx on public.social_content(created_at desc);

create table public.app_settings (
 key text primary key,
 value jsonb not null default '{}'::jsonb,
 description text,
 updated_at timestamptz not null default now()
);

alter table public.leads enable row level security;
alter table public.lead_research enable row level security;
alter table public.outreach_records enable row level security;
alter table public.social_content enable row level security;
alter table public.app_settings enable row level security;

comment on table public.app_settings is 'Non-secret application settings only. Keep API credentials in server environment variables.';