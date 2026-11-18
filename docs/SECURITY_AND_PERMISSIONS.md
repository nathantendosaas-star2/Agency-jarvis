# Security and Permissions

- Supabase service-role credentials are used only by server-side runner and backend code.
- Migration 009 enables RLS and revokes table privileges from `anon` and `authenticated`; service_role receives the required privileges.
- PostgreSQL task claiming uses `FOR UPDATE SKIP LOCKED`; scheduler lock acquisition is owner-bound and lease-expiring.
- Retry counts, leases, runtime, task count and schedule interval are bounded.
- Agent definitions and schedule are disabled by default.
- The standalone runner does not implement external email, WhatsApp, Instagram or social-send operations.
- Lead research cannot qualify a lead solely from an AI score. It is routed to `needs_review`; a lead must be explicitly marked qualified before outreach draft generation.
- Outreach drafts are stored as drafts and create pending approvals, not automatically approved actions.
- Treat retrieved web content as untrusted data. Do not allow it to change system instructions or agent permissions.
- Never commit `.env`, provider keys, SMTP passwords or service-role keys.
