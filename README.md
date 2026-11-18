# Agency Jarvis — SMMA Operating System

Agency Jarvis is an AI-powered operating system for running a Social Media Marketing Agency (SMMA). It centralizes lead intake, web intelligence, AI qualification, outreach generation and approval, social publishing, client workspaces, and durable background processing in one application.

## Features

- Lead management with CSV and Google Sheets ingestion
- Tavily-powered web research
- Gemini or OpenRouter lead qualification and outreach generation
- Administrator-gated outreach review and approval
- SMTP email delivery through Nodemailer
- Gmail, Instagram, and WhatsApp outreach workflows
- Buffer social content publishing
- Client and agent workbench views
- Supabase PostgreSQL persistence and row-level security
- Durable background tasks with retry and recovery
- Secure, server-side session authentication

## Architecture

- **Backend:** Node.js 22+ and Express
- **Frontend:** Static HTML5, CSS3, and vanilla JavaScript in `public/`
- **Database:** Supabase PostgreSQL
- **AI:** Google Gemini (default) or OpenRouter
- **Web intelligence:** Tavily
- **Email:** SMTP through Nodemailer
- **Social publishing:** Buffer
- **Lead ingestion:** CSV upload or Google Forms → Google Sheets → Apps Script webhook

## Repository Layout

```text
public/                 Static frontend
src/                    Server modules, routes, services, and middleware
server.js               Express application entry point
scripts/                Operational and setup scripts
database/migrations/    Supabase SQL migrations
docs/                   Integration documentation
test/                   Node test suite
.env.example            Environment variable template
render.yaml             Render web service configuration
```

## Local Development

### Prerequisites

- Node.js 22 or later
- npm
- A Supabase project
- API credentials for any integrations you intend to use

### Setup

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/nathantendosaas-star2/Agency-jarvis.git
   cd Agency-jarvis
   npm install
   ```

2. Create a local environment file:

   ```bash
   cp .env.example .env
   ```

3. Generate an administrator password hash:

   ```bash
   npm run hash-password
   ```

   Set `ADMIN_PASSWORD_HASH` to the generated bcrypt hash.

4. Generate a session secret:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   Set `SESSION_SECRET` to the generated value.

5. Complete the Supabase and integration values in `.env`, then start the server:

   ```bash
   npm run dev
   ```

6. Open [http://localhost:10000](http://localhost:10000).

## Database Setup

Agency Jarvis uses Supabase PostgreSQL. Apply the migrations in numeric order through Supabase's SQL Editor:

| Migration | Purpose |
| --- | --- |
| `001_initial_schema.sql` | Initial leads, research, outreach, social content, and settings tables |
| `002_lead_reviewer_compatibility.sql` | Lead-review compatibility fields |
| `003_mvp_extensions.sql` | Workbench, client, approval, activity, audit, RLS, and execution-state support |
| `004_agentic_workbench.sql` | Agentic workbench and landing-page support |
| `004_outreach_email_brief.sql` | Outreach email brief support |
| `005_outreach_message_body_compatibility.sql` | Outbound message-body compatibility |
| `006_autonomous_lead_pipeline.sql` | Multi-channel pipeline, processing stages, and pipeline jobs |
| `007_durable_background_tasks.sql` | Durable background-task persistence |
| `008_workbench_auto_classification.sql` | Workbench auto-classification support |

Run every migration once and in sequence. The service-role key must remain server-side only.

## Google Sheets Ingestion

Follow the complete setup in [docs/google-sheets.md](docs/google-sheets.md). In summary:

1. Create a sheet containing `Business Name`, `Website`, `Contact Name`, `Email`, `Phone`, `Business Category`, `Location`, and `Notes`.
2. Add the Apps Script from the guide.
3. Deploy it as a web app with access set to **Anyone**.
4. Set `GOOGLE_SHEETS_SCRIPT_URL` and `GOOGLE_SHEETS_API_SECRET` in the server environment.

## Environment Variables

Copy [.env.example](.env.example) before configuring a deployment.

### Core

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Runtime mode, such as `development` or `production` |
| `PORT` | HTTP port; defaults to `10000` |
| `ADMIN_PASSWORD_HASH` | bcrypt hash for the administrator password |
| `SESSION_SECRET` | Secret used to sign browser sessions |
| `FRONTEND_URL` | Allowed/deployed frontend origin |
| `API_BASE_URL` | Optional backend URL for direct frontend API access |

### Supabase

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service-role key |

### AI and Web Intelligence

| Variable | Purpose |
| --- | --- |
| `AI_PROVIDER` | `gemini` or `openrouter` |
| `GEMINI_API_KEY` | Google Gemini API key |
| `GEMINI_MODEL` | Gemini model; defaults to `gemini-3.5-flash-lite` |
| `OPENROUTER_API_KEY` | Optional OpenRouter API key |
| `OPENROUTER_MODEL` | Optional OpenRouter model; defaults to `openrouter/free` |
| `TAVILY_API_KEY` | Tavily web-intelligence API key |

### Outbound Email

| Variable | Purpose |
| --- | --- |
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP port; usually `587` |
| `SMTP_SECURE` | Use TLS/SMTPS; normally `false` for STARTTLS |
| `SMTP_USER` | SMTP account username |
| `SMTP_PASS` | SMTP account password or app password |
| `SMTP_FROM_EMAIL` | From email address |
| `SMTP_FROM_NAME` | From name |

Never expose service-role keys, AI keys, SMTP credentials, or session secrets in frontend code or public repositories.

### Integrations

| Variable | Purpose |
| --- | --- |
| `BUFFER_ACCESS_TOKEN` | Buffer API access token |
| `GOOGLE_SHEETS_SCRIPT_URL` | Deployed Google Apps Script webhook URL |
| `GOOGLE_SHEETS_API_SECRET` | Shared secret for Sheets ingestion requests |

## Testing

The test suite uses Node's built-in test runner and mocks external integrations where appropriate:

```bash
npm test
```

Tests live in `test/*.test.js`.

## Render Deployment

The repository includes a basic `render.yaml` web-service configuration:

- Runtime: Node
- Plan: Free
- Build command: `npm install`
- Start command: `npm start`
- Health check: `/health`
- Production `NODE_ENV`: `production`
- Port: `10000`

On Render:

1. Create a new Web Service from this repository.
2. Use Node 22 or add it explicitly if your deployment environment requires it.
3. Configure all required environment variables.
4. Apply the Supabase migrations before starting autonomous workflows.

A production deployment should use HTTPS and should set `FRONTEND_URL` to the deployed frontend origin.

## Static Frontend Deployment

The frontend is in `public/` and can be deployed as a static site.

- Netlify base directory: `public`
- Netlify publish directory: `public`
- Build command: leave blank or use `echo "Static frontend"`
- `public/_redirects` can proxy `/api/*` requests to the backend

Set `API_BASE_URL` only when the frontend must call a separate backend origin instead of a same-origin proxy.

## Autonomous Pipeline

Leads can be uploaded and processed through the application workflow:

1. Import leads from CSV or Google Sheets.
2. Select an outreach channel: Gmail, Instagram, or WhatsApp.
3. The pipeline runs web research, AI qualification, draft generation, and approval stages.
4. Open approved outreach drafts through the appropriate external channel.
5. Monitor failures and retry interrupted work from the Leads interface.

Pending, failed, and interrupted jobs should be recoverable across restarts. Verify migration `006` and `007` are applied before enabling these workflows.

## Security Notes

- Authentication is protected by a bcrypt password hash and secure server-side session handling.
- Supabase service-role credentials are never intended for browser code.
- Review outbound outreach before sending or launching it externally.
- Keep SMTP and API credentials in deployment environment variables.
- Enable only the integrations required by your deployment.

## License

No license is currently specified for this repository.
