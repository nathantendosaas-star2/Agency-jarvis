const express = require("express");
const { isSupabaseConfigured, getSupabaseClient } = require("../config/supabase");
const { testSmtpConnection, getSmtpConfig } = require("../services/smtpService");
const { testBufferConnection, getBufferConfig } = require("../services/bufferService");
const { researchBusinessWithTavily } = require("../services/tavilyService");
const { callAI, getAIProvider, getSelectedGeminiModel } = require("../services/openrouterService");

function createSettingsRouter() {
  const router = express.Router();

  // GET /api/settings/status - Safe configuration health matrix
  router.get("/status", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    const smtpConfig = getSmtpConfig();
    const bufferConfig = getBufferConfig();

    return res.status(200).json({
      supabase: {
        configured: isSupabaseConfigured(),
        url: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/^(https?:\/\/[^/]{4})[^/]+/, "$1***") : null
      },
      openrouter: {
        configured: Boolean(process.env.OPENROUTER_API_KEY),
        model: process.env.OPENROUTER_MODEL || "google/gemma-4-26b-a4b-it:free"
      },
      tavily: {
        configured: Boolean(process.env.TAVILY_API_KEY)
      },
      smtp: {
        configured: smtpConfig.isConfigured,
        host: smtpConfig.host || null,
        port: smtpConfig.port,
        from: smtpConfig.from || null
      },
      buffer: {
        configured: bufferConfig.isConfigured
      },
      googleSheets: {
        configured: Boolean(process.env.GOOGLE_SHEETS_SCRIPT_URL)
      }
    });
  });

  // POST /api/settings/test/supabase
  router.post("/test/supabase", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    if (!isSupabaseConfigured()) {
      return res.status(200).json({ success: false, message: "Supabase credentials not configured." });
    }
    try {
      const { count, error } = await getSupabaseClient().from("leads").select("id", { count: "exact", head: true });
      if (error) throw error;
      return res.status(200).json({ success: true, message: `Connected to Supabase. Found ${count || 0} leads.` });
    } catch (err) {
      return res.status(200).json({ success: false, message: `Supabase query failed: ${err.message}` });
    }
  });

  // POST /api/settings/test/openrouter
  router.post("/test/openrouter", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(200).json({ success: false, message: "OPENROUTER_API_KEY not configured." });
    }
    try {
      const reply = await callOpenRouter({
        messages: [{ role: "user", content: "Reply with the word PONG" }],
        maxTokens: 10
      });
      return res.status(200).json({ success: true, message: `OpenRouter responded: "${reply.trim()}"` });
    } catch (err) {
      return res.status(200).json({ success: false, message: `OpenRouter test failed: ${err.message}` });
    }
  });

  // POST /api/settings/test/tavily
  router.post("/test/tavily", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    if (!process.env.TAVILY_API_KEY) {
      return res.status(200).json({ success: false, message: "TAVILY_API_KEY not configured." });
    }
    try {
      const result = await researchBusinessWithTavily("Agency Jarvis Social Media Marketing Agency", { maxResults: 1 });
      return res.status(200).json({ success: true, message: `Tavily returned ${result.sources?.length || 0} source result(s).` });
    } catch (err) {
      return res.status(200).json({ success: false, message: `Tavily test failed: ${err.message}` });
    }
  });

  // POST /api/settings/test/smtp
  router.post("/test/smtp", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    const testResult = await testSmtpConnection();
    return res.status(200).json({ success: testResult.connected, message: testResult.message });
  });

  // POST /api/settings/test/buffer
  router.post("/test/buffer", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    const testResult = await testBufferConnection();
    return res.status(200).json({ success: testResult.connected, message: testResult.message, profiles: testResult.profiles });
  });

  return router;
}

module.exports = { createSettingsRouter };
