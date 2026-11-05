# Agency Jarvis — SMMA Operating System (MVP)

Agency Jarvis is an AI-powered operating system for running a Social Media Marketing Agency (SMMA). It centralizes prospect intake, automated web intelligence, AI lead qualification, administrator-approved cold outreach, agency deliverable generation, and multi-platform social media publishing via Buffer.

---

## 1. Architecture & Tech Stack

- **Backend**: Node.js 22+, Express.js.
- **Frontend**: Plain HTML5, CSS3, and Vanilla JavaScript (No React, Vue, Tailwind, or build steps).
- **Database**: Supabase PostgreSQL (`@supabase/supabase-js`).
- **AI Gateway**: Google Gemini API by default, with OpenRouter available as an optional alternative.
- **Web Intelligence**: Tavily API for evidence collection.
- **Outbound Email**: Configurable SMTP via Nodemailer, with explicit administrator approval gating.
- **Social Scheduling**: Buffer API.
- **Lead Ingestion**: Google Forms → Google Sheets → Google Apps Script Web App → Jarvis API.
- **Security**: Single administrator bcrypt password, secure HTTP-only cookies, SameSite cookies, login rate limiting, helmet security headers.

---

## 2. Local Installation & Development

### Prerequisites
- Node.js version 22 or later.
- npm version 10 or later.

### Steps
1. Clone the repository and install dependencies:
   ```bash
   git checkout <feature-branch>
   npm install
   ```

2. Create `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

3. Generate your administrator password hash:
   ```bash
   npm run hash-password
   ```
   Paste the generated bcrypt string into `ADMIN_PASSWORD_HASH` and supply a 32+ character random string for `SESSION_SECRET`.

4. Start development server:
   ```bash
   npm run dev
   ```
   Or production start:
   ```bash
   npm start
   ```

5. Open [http://localhost:10000](http://localhost:10000) in your browser.

---

## 3. Database Migrations

Agency Jarvis uses Supabase PostgreSQL. Migrations are organized sequentially in `database/migrations/`:

1. `001_initial_schema.sql` — Baseline schema (`leads`, `lead_research`, `outreach_records`, `social_content`, `app_settings`).
2. `002_lead_reviewer_compatibility.sql` — Compatibility enhancements for lead qualification fields.
3. `003_mvp_extensions.sql` — Adds client/workbench/approval/activity tables, audit columns, one-use approval execution state, and RLS/direct-access restrictions.
4. `004_agentic_workbench.sql` — Adds landing page generator support.
5. `004_outreach_email_brief.sql` — Outreach campaign brief column.
6. `005_outreach_message_body_compatibility.sql` — Message body compatibility mirroring.
7. `006_autonomous_lead_pipeline.sql` — Multi-channel outreach (`gmail`, `instagram`, `whatsapp`), processing stages, auto-approval metadata, and `lead_pipeline_jobs` table for autonomous background processing.

### Applying Migrations
- Log into your Supabase Dashboard → SQL Editor.
- If running on a new instance, execute migrations in sequential order up through `006_autonomous_lead_pipeline.sql`.
- Migration 006 adds `outreach_channel`, `instagram`, `processing_stage`, and `processing_error` to `leads`, updates constraints on `outreach_records`, and creates `lead_pipeline_jobs` with RLS restricted to `service_role`.

---

## 4. Google Sheets Lead Ingestion Setup

1. Create a Google Sheet with columns:
   `Business Name`, `Website`, `Contact Name`, `Email`, `Phone`, `Business Category`, `Location`, `Notes`.
2. In Google Sheets, navigate to **Extensions → Apps Script**.
3. Paste the Apps Script code found in `docs/google-sheets.md`.
4. Set your `API_SECRET` in the script.
5. Click **Deploy → New deployment → Web app** (Execute as: *Me*, Who has access: *Anyone*).
6. Copy the Web App URL and configure `GOOGLE_SHEETS_SCRIPT_URL` and `GOOGLE_SHEETS_API_SECRET` in your environment.
7. Prospects can now be ingested manually via the **Leads** page or automated via webhook.

---

## 5. External Service Setup

### Google Gemini API (default)
- Create an API key in [Google AI Studio](https://aistudio.google.com/apikey).
- Set `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, and `GEMINI_MODEL=gemini-3.5-flash-lite`.
- Supported model IDs: `gemini-3.5-flash-lite` (default for outreach and autonomous pipeline), `gemini-3.8-flash`, and `gemini-3.6-flash`. Change `GEMINI_MODEL` and restart the server to switch models.

### OpenRouter API (optional alternative)
- Create an account at [openrouter.ai](https://openrouter.ai) and generate an API key.
- Set `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, and optional `OPENROUTER_MODEL`.

### Tavily API
- Obtain an API key from [tavily.com](https://tavily.com).
- Set `TAVILY_API_KEY`.

### SMTP Email
- Create an API key in Bird under **Developers → API keys**.
- Set `SMTP_HOST`, `SMTP_FROM_EMAIL`, and optionally `SMTP_FROM_NAME`.
- Verify the sending domain/address in Bird before sending real prospect emails.
- Keep `BIRD_DEV_MODE=true` locally to simulate delivery. Set it to `false` only when you intend to send real emails.
- The key is read only by the backend; never add it to browser JavaScript or commit it to Git.
- Bird's `accepted` response means the provider accepted the email for asynchronous delivery, not that it reached the recipient's inbox.

### Buffer Publishing
- Create a developer app or generate an access token in your Buffer dashboard.
- Set `BUFFER_ACCESS_TOKEN`.
- Connected channels are automatically retrieved in the **Social Studio** and **Settings** pages.

---

## 6. Automated Testing

Run the test suite:
```bash
npm test
```
The test suite utilizes Node's built-in test runner (`node:test`) and mocks external APIs to prevent real API calls or outbound emails.

---

## 7. Render Web Service Deployment (Backend)

Deploy Agency Jarvis as a standard Node Web Service on Render:

1. Create a **New Web Service** on Render connected to this repository.
2. Configure settings:
   - **Environment**: `Node`
   - **Node Version**: `22`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
3. Configure Environment Variables in Render Dashboard:
   - `NODE_ENV=production`
   - `PORT=10000`
   - `ADMIN_PASSWORD_HASH` (bcrypt hash from `npm run hash-password`)
   - `SESSION_SECRET` (at least 32 characters)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `AI_PROVIDER=gemini`
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL=gemini-3.5-flash-lite`
   - `FRONTEND_URL` (your deployed Netlify URL, e.g. `https://agency-jarvis.netlify.app`)
   - `TAVILY_API_KEY`
   - `BUFFER_ACCESS_TOKEN`
   - `GOOGLE_SHEETS_SCRIPT_URL` (optional)
   - `GOOGLE_SHEETS_API_SECRET` (optional)

---

## 8. Netlify Deployment (Frontend)

Deploy Agency Jarvis frontend to Netlify:

1. Connect the GitHub repository in Netlify.
2. Configure build settings:
   - **Base directory**: `public`
   - **Publish directory**: `public`
   - **Build command**: (leave empty or `echo "Frontend static deploy"`)
3. Configure Environment Variables in Netlify:
   - `API_BASE_URL`: The URL of your deployed Render backend (e.g. `https://agency-jarvis.onrender.com`).
4. Proxy Configuration:
   - `public/_redirects` contains `/api/* :API_BASE_URL/api/:splat 200` to transparently route frontend API calls to Render without cross-origin cookie restrictions.

---

## 9. Testing & Troubleshooting Autonomous Pipeline

### Testing CSV Lead Import & Automation
1. Navigate to the **Leads** page.
2. Click **Import CSV Leads**.
3. Choose a default outreach channel (`Gmail`, `Instagram`, or `WhatsApp`).
4. Select a CSV file containing at least `Business Name` and `Email` or `Phone` or `Instagram`.
5. Click **Upload & Start Automation**.
6. The leads will be saved, duplicate checked, and enqueued.
7. The autonomous worker automatically proceeds through:
   - Web intelligence research via Tavily
   - SMMA qualification via OpenRouter/Gemini
   - Outreach draft generation via Gemini 3.5 Flash Lite tailored to the channel
   - Automatic draft approval
8. Navigate to **Outreach** to view the auto-approved messages and click **Open in Gmail**, **Open Instagram**, or **Open WhatsApp** to launch the prefilled message.

### Troubleshooting Failed Jobs
- Inspect the **Autonomous Pipeline** dashboard card on the Leads page to view failed count and recent logs.
- Click the **Retry** button in the Leads table on any failed row to re-enqueue from the failed stage without losing existing research data.
- After a server restart, pending or interrupted jobs are automatically detected and recovered by `recoverPendingJobs()`.
