# Agency Jarvis

Agency Jarvis is an SMMA operating workspace MVP.

## Approved stack

- Frontend: plain HTML5, CSS3 and vanilla browser JavaScript
- Backend: Node.js 20+ and Express
- Database: Supabase PostgreSQL
- Integrations: Google Sheets (via Google Apps Script Web App), OpenRouter, Tavily
- Authentication: one administrator password with a bcrypt hash and signed HTTP-only session cookie
- Hosting: Render
- Version control: GitHub

## Local setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Generate a password hash using `npm run hash-password` in a terminal.
5. Put the generated hash in `ADMIN_PASSWORD_HASH` in `.env`.
6. Generate a session secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and put it in `SESSION_SECRET`.
7. Configure Supabase, Google Sheets, Tavily, and OpenRouter as detailed below.
8. Run `npm run dev`.
9. Visit http://localhost:10000. The application should redirect to the login page.
10. Check http://localhost:10000/health for the server health response.

## Supabase PostgreSQL Setup (Task 1 / Step 3)

1. Create a project in [Supabase](https://supabase.com).
2. Open the **SQL Editor** in your Supabase dashboard.
3. Open `database/migrations/001_initial_schema.sql` and run the script. This creates:
   - `leads`: prospect business records, statuses, and scores.
   - `lead_research`: AI research findings, SWOT, services, and source citations.
   - `outreach_records`: prospect communication logs.
   - `social_content`: scheduled social posts.
   - `app_settings`: persistent configuration key-values.
4. Retrieve your **Project URL** and **Service Role Secret Key** from Project Settings -> API.
5. In `.env`, set:
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-secret-key
   ```
   *Note: Never expose the Supabase service role key to the browser.*

## Google Sheets Lead Ingestion (Task 2 / Step 4)

1. Create a Google Sheet with column headers:
   - `Business Name` (Required)
   - `Website`
   - `Contact Name`
   - `Email`
   - `Phone`
   - `Business Category`
   - `Location`
   - `Notes`
2. Follow the detailed instructions in `docs/google-sheets.md` to deploy the Google Apps Script Web App.
3. In `.env`, set:
   ```env
   GOOGLE_SHEETS_SCRIPT_URL=https://script.google.com/macros/s/your-deployment-id/exec
   GOOGLE_SHEETS_API_SECRET=your_configured_secret
   ```
4. On the Leads page (`/leads.html`), click **Import from Google Sheets** to trigger ingestion. Agency Jarvis validates each row, deduplicates against existing records, and imports prospects.

## AI Lead Reviewer & Qualification (Task 3 / Step 5)

Agency Jarvis automates prospect research using **Tavily Search** and evaluates SMMA qualification using **OpenRouter**.

1. Obtain an API key from [Tavily](https://tavily.com).
2. Obtain an API key from [OpenRouter](https://openrouter.ai).
3. In `.env`, set:
   ```env
   TAVILY_API_KEY=your_tavily_api_key
   OPENROUTER_API_KEY=your_openrouter_api_key
   OPENROUTER_MODEL=openai/gpt-4o-mini
   ```
   *(You can configure any OpenRouter model such as `meta-llama/llama-3.1-8b-instruct`, `anthropic/claude-3.5-haiku`, etc.)*
4. On the Leads page, click **AI Review** on any lead. Agency Jarvis gathers live web intelligence via Tavily, instructs OpenRouter with strict anti-hallucination constraints, parses and validates the structured findings, and updates the qualification score (0-100). Click **View Review** to inspect the detailed breakdown and verified sources.

## Automated Testing

Run the test suite:
```bash
npm test
```
The test suite executes using Node's built-in test runner (`node --test test/*.test.js`).
All external requests (Supabase, Tavily, OpenRouter, Google Sheets) are mocked in tests, so no live external credentials are required to verify the application.

## Current Implementation Status

- **Step 1 — Project foundation:** Express server, static frontend shell, Render configuration and health endpoint.
- **Step 2 — Administrator authentication:** bcrypt hash validation, secure cookie sessions, brute-force protection.
- **Step 3 — Supabase foundation:** PostgreSQL migration schema, repository service layer, environment-configured client.
- **Step 4 — Google Sheets ingestion:** configurable Apps Script ingestion, row validation, duplicate detection, import stats.
- **Step 5 — AI Lead Reviewer:** Tavily web research, OpenRouter structured qualification, research modal, scoring.
- Step 6 — SMTP outreach with explicit approvals (planned).
- Step 7 — Buffer social content and scheduling with approval (planned).
- Step 8 — Workbench and design brief workflow (planned).
- Step 9 — Render production deployment and testing.
