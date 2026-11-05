const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Wait 15 minutes and try again." },
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many login attempts. Wait 15 minutes and try again." });
  }
});

function requireSameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (!origin) return res.status(403).json({ error: "Origin check failed." });

  try {
    const parsed = new URL(origin);
    const forwardedHost = req.get("x-forwarded-host");
    const forwardedProto = req.get("x-forwarded-proto");
    const expectedHost = (forwardedHost || req.get("host") || "").split(",")[0].trim();
    const expectedProtocol = (forwardedProto || req.protocol || "").split(",")[0].trim();
    const backendOrigin = `${expectedProtocol.replace(/:$/, "")}://${expectedHost}`;
    const configuredFrontendOrigins = [process.env.FRONTEND_URL, process.env.NETLIFY_URL]
      .filter(Boolean)
      .map(value => {
        try { return new URL(value).origin; } catch { return null; }
      })
      .filter(Boolean);

    // Accept the backend's own origin and explicitly configured frontend origins.
    // This supports Netlify's same-origin proxy without weakening the allowlist.
    if (parsed.origin !== backendOrigin && !configuredFrontendOrigins.includes(parsed.origin)) {
      return res.status(403).json({ error: "Origin check failed." });
    }
    return next();
  } catch {
    return res.status(403).json({ error: "Origin check failed." });
  }
}

function createAuthRouter() {
  const router = express.Router();

  router.post("/login", requireSameOrigin, loginLimiter, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const password = req.body && req.body.password;

    if (typeof password !== "string" || password.length < 1 || password.length > 200) {
      return res.status(400).json({ error: "Enter your administrator password." });
    }

    try {
      const valid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
      if (!valid) return res.status(401).json({ error: "Incorrect password." });

      req.session = { isAdmin: true, authenticatedAt: Date.now() };
      return res.status(200).json({ authenticated: true });
    } catch (error) {
      console.error("Authentication verification failed:", error.message);
      return res.status(500).json({ error: "Unable to sign in right now." });
    }
  });

  router.post("/logout", requireSameOrigin, (req, res) => {
    req.session = null;
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ authenticated: false });
  });

  router.get("/me", (req, res) => {
    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      authenticated: Boolean(req.session && req.session.isAdmin === true)
    });
  });

  return router;
}

module.exports = { createAuthRouter };
