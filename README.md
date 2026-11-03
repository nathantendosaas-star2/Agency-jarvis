# Agency Jarvis

MVP application: plain HTML, CSS and vanilla JavaScript frontend; Node.js + Express backend; Supabase PostgreSQL; single administrator password authentication; deployed on Render.

## Local setup

1. Install Node.js 20+.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Run `npm run dev`.
5. Open http://localhost:10000.

## Deployment

Connect this repository to Render using the included `render.yaml`. Configure secrets in Render Environment settings. Never commit `.env`.

## Build status

Step 1 foundation. Authentication and integrations are not active yet; complete those before using this as a private production app.