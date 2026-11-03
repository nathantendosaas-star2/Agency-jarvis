# Agency Jarvis

Agency Jarvis is a new MVP codebase for an SMMA operating workspace.

## Approved stack

- Frontend: plain HTML5, CSS3 and vanilla browser JavaScript
- Backend: Node.js 20+ and Express
- Database: Supabase PostgreSQL (Step 3)
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
7. Run `npm run dev`.
8. Visit http://localhost:10000. The application should redirect to the login page.
9. Check http://localhost:10000/health for the server health response.

## Step 2 authentication

- Administrator password is verified on the server using bcrypt.
- Passwords are never stored as plaintext.
- Session is stored in a signed, HTTP-only, SameSite=Strict cookie with an eight-hour lifetime.
- The cookie is marked Secure in production (HTTPS).
- Login is limited to five attempts per IP in a rolling 15-minute window.
- Login and logout POST requests require a matching same-origin header.
- All application pages and future API routes are protected; `/login`, its required static assets, `/api/auth/login`, `/api/auth/logout`, and `/health` remain public.
- Logout clears the session cookie.

## Render deployment

Connect the repository to Render using `render.yaml`. Add these environment variables in the Render service dashboard:

- `NODE_ENV=production`
- `ADMIN_PASSWORD_HASH`: generated locally with `npm run hash-password`
- `SESSION_SECRET`: a fresh random value of at least 32 characters

Do not add your actual password, password hash, session secret, or `.env` file to GitHub. Use Render's environment settings. Render must serve the app over HTTPS for the Secure cookie to work.

## Current implementation status

- **Step 1 — Project foundation:** Express server, static frontend shell, Render configuration and health endpoint.
- **Step 2 — Administrator authentication:** implemented in the codebase; perform the local verification checklist before deployment.
- **Step 3 — Supabase schema and connection:** next.
- Step 4 — Google Sheets lead ingestion.
- Step 5 — OpenRouter + Tavily lead review.
- Step 6 — SMTP outreach with explicit approvals.
- Step 7 — Buffer social content and scheduling with approval.
- Step 8 — Workbench and design brief workflow.
- Step 9 — Render production deployment and testing.

## Security note

The login limiter currently uses an in-memory store, appropriate for this single-instance MVP. If multiple instances are introduced, move rate-limit state to a shared store. Rotating `SESSION_SECRET` invalidates existing sessions.