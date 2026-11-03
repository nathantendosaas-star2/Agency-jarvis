# Agency Jarvis

Agency Jarvis is a new MVP codebase for an SMMA operating workspace.

## Approved stack

- Frontend: plain HTML5, CSS3 and vanilla browser JavaScript
- Backend: Node.js 20+ and Express
- Database: Supabase PostgreSQL (connection is a later implementation step)
- Authentication: one administrator password (to be implemented in Step 2)
- Hosting: Render
- Version control: GitHub

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Run `npm run dev`.
5. Visit http://localhost:10000.
6. Check http://localhost:10000/health for the server health response.

## Deploy

The repository includes `render.yaml` for a Render Blueprint deployment. Configure production secrets in Render Environment settings. Never commit `.env`.

## Implementation status

This repository currently contains **Step 1: project foundation**. The Express server serves the static HTML/CSS/JS pages and exposes a health endpoint. The other pages are structural shells.

**Important:** Authentication, database access and integrations are not implemented yet. Do not expose this foundation as a private production app until Step 2 authentication and route protection are complete.

## Planned build sequence

1. Project foundation
2. Password authentication, secure sessions and protected routes
3. Supabase schema and connection
4. Google Sheets lead ingestion
5. OpenRouter + Tavily lead review
6. SMTP outreach with explicit approvals
7. Buffer social content and scheduling with approval
8. Workbench and design brief workflow
9. Render production deployment and testing