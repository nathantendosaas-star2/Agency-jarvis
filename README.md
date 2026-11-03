# Agency Jarvis

Agency Jarvis is an SMMA operating workspace MVP.

## Approved stack

- Frontend: plain HTML5, CSS3 and vanilla browser JavaScript
- Backend: Node.js 22+ and Express
- Database: Supabase PostgreSQL
- Integrations: Google Sheets (via Google Apps Script Web App), OpenRouter, Tavily
- Authentication: one administrator password with a bcrypt hash and signed HTTP-only session cookie
- Hosting: Render
- Version control: GitHub

## Local setup

1. Install Node.js 22 or newer (the current Supabase JS client requires Node.js 22+).
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Generate a password hash using `npm run hash-password` in a terminal.
5. Put the generated hash in `ADMIN_PASSWORD_HASH` in `.env`.
6. Generate a session secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and put it in `SESSION_SECRET`.
7. Configure Supabase, Google Sheets, Tavily, and OpenRouter as detailed below.
8. Run `npm run dev`.
9. Visit http://localhost:10000. The application should redirect to the login page.
10. Check http://localhost:10000/health for the server health response.

## Supabase PostgreSQL Setup

Run migrations in numeric order from the Supabase SQL Editor:
1. `database/migrations/001_initial_schema.sql` — creates the base application tables and backend-only RLS configuration.
2. `database/migrations/002_lead_reviewer_compatibility.sql` — adds and backfills the lead/research fields consumed by the current API. This migration is additive and preserves existing records.

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`. The service-role secret must remain server-side and must never be exposed to browser JavaScript.

## Google Sheets Lead Ingestion

1. Create a Google Sheet with headers: `Business Name` (required), `Website`, `Contact Name`, `Email`, `Phone`, `Business Category`, `Location`, and `Notes`.
2. Follow `docs/google-sheets.md` to deploy the Google Apps Script Web App.
3. Set `GOOGLE_SHEETS_SCRIPT_URL` and `GOOGLE_SHEETS_API_SECRET` in `.env`.
4. On `/leads.html`, use **Import from Google Sheets**. The backend reads the configured URL and secret, validates rows, skips duplicates, and reports import results.

## AI Lead Reviewer

Set `TAVILY_API_KEY`, `OPENROUTER_API_KEY`, and `OPENROUTER_MODEL` in `.env`. On the Leads page, use **AI Review** to gather web evidence through Tavily and generate a structured SMMA qualification assessment through OpenRouter. Verify evidence before acting on a recommendation; AI scores are decision support, not proof.

## Automated Testing

Run `npm test`. The suite uses Node's built-in test runner and mocks external services.

## Current implementation status

- Step 1 — Project foundation and Render health endpoint.
- Step 2 — Administrator password authentication and protected pages.
- Step 3 — Supabase schema and server-side client.
- Step 4 — Google Sheets lead ingestion.
- Step 5 — Tavily research and OpenRouter lead qualification.
- Step 6 — SMTP outreach with explicit approval (planned).
- Step 7 — Buffer social scheduling with approval (planned).
- Step 8 — Workbench and design brief workflow (planned).
- Step 9 — Render production deployment and verification.
