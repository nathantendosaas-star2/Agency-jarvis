# Agency Jarvis — SMMA Operating System (MVP)

Agency Jarvis is an AI-powered operating system for running a Social Media Marketing Agency (SMMA). It centralizes prospect intake, automated web intelligence, AI lead qualification, administrator-approved cold outreach, agency deliverable generation, and multi-platform social media publishing via Buffer.

---

## 1. Architecture & Tech Stack

- **Backend**: Node.js 22+, Express.js.
- **Frontend**: Plain HTML5, CSS3, and Vanilla JavaScript (No React, Vue, Tailwind, or build steps).
- **Database**: Supabase PostgreSQL (`@supabase/supabase-js`).
- **AI Gateway**: OpenRouter API (`google/gemma-4-26b-a4b-it:free` default).
- **Web Intelligence**: Tavily API for evidence collection.
- **Outbound Email**: SMTP (Nodemailer) with explicit administrator approval gating and safe dev sandbox.
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
3. `003_mvp_extensions.sql` — Adds `clients`, `workbench_tasks`, `approvals`, `activity_logs`, and audit columns for outreach and social tables.

### Applying Migrations
- Log into your Supabase Dashboard → SQL Editor.
- If running on a new instance, execute `001_initial_schema.sql`, `002_lead_reviewer_compatibility.sql`, and `003_mvp_extensions.sql`.
- Migration `003_mvp_extensions.sql` is strictly additive and non-destructive.

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

### OpenRouter API
- Create an account at [openrouter.ai](https://openrouter.ai) and generate an API key.
- Set `OPENROUTER_API_KEY` and optional `OPENROUTER_MODEL`.

### Tavily API
- Obtain an API key from [tavily.com](https://tavily.com).
- Set `TAVILY_API_KEY`.

### SMTP Email
- Provide standard credentials for your transactional email provider (Mailgun, SendGrid, Amazon SES, Postmark, etc.):
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.
- To prevent real emails from being sent during testing, set `SMTP_DEV_MODE=true`.

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
The test suite utilizes Node's built-in test runner (`node:test`) and mocks all external APIs (OpenRouter, Tavily, Buffer, SMTP) to prevent real API calls or outbound emails.

---

## 7. Render Web Service Deployment

Agency Jarvis is pre-configured for Render via `render.yaml` or as a standard Node Web Service:

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
   - `ADMIN_PASSWORD_HASH`
   - `SESSION_SECRET`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENROUTER_API_KEY`
   - `OPENROUTER_MODEL`
   - `TAVILY_API_KEY`
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_USER`
   - `SMTP_PASSWORD`
   - `SMTP_FROM`
   - `BUFFER_ACCESS_TOKEN`
   - `GOOGLE_SHEETS_SCRIPT_URL`
   - `GOOGLE_SHEETS_API_SECRET`
