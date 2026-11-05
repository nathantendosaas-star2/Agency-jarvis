-- Store the user's campaign brief alongside each generated outreach email.
ALTER TABLE public.outreach_records
  ADD COLUMN IF NOT EXISTS email_brief TEXT;
