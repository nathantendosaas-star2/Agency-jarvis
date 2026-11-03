require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const path = require("path");
const cookieSession = require("cookie-session");
const { createAuthRouter } = require("./src/routes/auth");
const { requireAdmin } = require("./src/middleware/auth");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const publicDirectory = path.join(__dirname, "public");

if (!process.env.ADMIN_PASSWORD_HASH) {
  throw new Error("ADMIN_PASSWORD_HASH is required. Run npm run hash-password and add the result to .env.");
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET is required and must contain at least 32 characters.");
}

if (IS_PRODUCTION) app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

app.use(cookieSession({
  name: "agency_jarvis_session",
  keys: [process.env.SESSION_SECRET],
  maxAge: 8 * 60 * 60 * 1000,
  httpOnly: true,
  secure: IS_PRODUCTION,
  sameSite: "strict",
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

app.use(requireAdmin);
app.use(express.static(publicDirectory, {
  extensions: ["html"],
  index: "index.html",
  setHeaders: (res) => res.set("Cache-Control", "no-store")
}));

app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found." }));
app.use((_req, res) => res.status(404).sendFile(path.join(publicDirectory, "404.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Agency Jarvis is running on port ${PORT}`);
});