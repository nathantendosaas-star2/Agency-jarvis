require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const path = require("path");
const cookieSession = require("cookie-session");
const { createAuthRouter } = require("./src/routes/auth");
const { createLeadsRouter } = require("./src/routes/leads");
const { createClientsRouter } = require("./src/routes/clients");
const { createOutreachRouter } = require("./src/routes/outreach");
const { createWorkbenchRouter } = require("./src/routes/workbench");
const { createSocialRouter } = require("./src/routes/social");
const { createApprovalsRouter } = require("./src/routes/approvals");
const { createDashboardRouter } = require("./src/routes/dashboard");
const { createSettingsRouter } = require("./src/routes/settings");
const { requireAdmin } = require("./src/middleware/auth");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const publicDirectory = path.join(__dirname, "public");

if (!/^\$2[aby]\$\d{2}\$/.test(process.env.ADMIN_PASSWORD_HASH || "")) {
  throw new Error("ADMIN_PASSWORD_HASH must be a bcrypt hash. Run npm run hash-password and add the result to .env.");
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET is required and must contain at least 32 characters.");
}

if (IS_PRODUCTION) app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));

// CORS configuration for Render backend & Netlify frontend
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.NETLIFY_URL
].filter(Boolean).map(url => url.trim().replace(/\/$/, ""));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const isAllowed = allowedOrigins.length === 0 || allowedOrigins.includes(origin) || !IS_PRODUCTION;
    if (isAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    }
  }
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: false, limit: "50kb" }));

// Support cross-site session cookies if FRONTEND_URL is hosted on a different domain than backend
const isCrossSite = Boolean(IS_PRODUCTION && process.env.FRONTEND_URL);
app.use(cookieSession({
  name: "agency_jarvis_session",
  keys: [process.env.SESSION_SECRET],
  maxAge: 8 * 60 * 60 * 1000,
  httpOnly: true,
  secure: IS_PRODUCTION,
  sameSite: isCrossSite ? "none" : "lax",
  path: "/"
}));

app.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(200).json({ status: "ok", service: "agency-jarvis" });
});

app.get(["/login", "/login.html"], (req, res) => {
  if (req.session && req.session.isAdmin === true) return res.redirect("/");
  res.set("Cache-Control", "no-store");
  return res.sendFile(path.join(publicDirectory, "login.html"));
});

app.get("/css/style.css", (_req, res) => {
  res.sendFile(path.join(publicDirectory, "css", "style.css"));
});
app.get("/js/login.js", (_req, res) => {
  res.sendFile(path.join(publicDirectory, "js", "login.js"));
});

app.use("/api/auth", createAuthRouter());

// All following routes require administrator authentication
app.use(requireAdmin);

app.use("/api/dashboard", createDashboardRouter());
app.use("/api/leads", createLeadsRouter());
app.use("/api/clients", createClientsRouter());
app.use("/api/outreach", createOutreachRouter());
app.use("/api/workbench", createWorkbenchRouter());
app.use("/api/social", createSocialRouter());
app.use("/api/approvals", createApprovalsRouter());
app.use("/api/settings", createSettingsRouter());

app.use(express.static(publicDirectory, {
  extensions: ["html"],
  index: "index.html",
  setHeaders: (res) => res.set("Cache-Control", "no-store")
}));

app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found." }));
app.use((_req, res) => res.status(404).sendFile(path.join(publicDirectory, "404.html")));

const { recoverPendingJobs } = require("./src/services/leadPipelineService");

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`Agency Jarvis is running on port ${PORT}`);
    try {
      await recoverPendingJobs();
    } catch (err) {
      console.warn("Could not recover pending jobs on startup:", err.message);
    }
  });
}

module.exports = { app };
