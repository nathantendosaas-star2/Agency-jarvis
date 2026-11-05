-- Keep the application-facing message_body field compatible with the existing body column.
ALTER TABLE public.outreach_records
  ADD COLUMN IF NOT EXISTS message_body TEXT;

UPDATE public.outreach_records
SET message_body = body
WHERE message_body IS NULL;

COMMENT ON COLUMN public.outreach_records.message_body IS
  'Application compatibility field; mirrors body for outreach email content.';
