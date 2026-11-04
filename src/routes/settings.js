const express = require("express");
const { isSupabaseConfigured, getSupabaseClient } = require("../config/supabase");
const { testSmtpConnection, getSmtpConfig } = require("../services/smtpService");
const { testBufferConnection, getBufferConfig } = require("../services/bufferService");
const { researchBusinessWithTavily } = require("../services/tavilyService");
const { callAI, getAIProvider, getSelectedGeminiModel, loadSelectedGeminiModel, setSelectedGeminiModel, SUPPORTED_GEMINI_MODELS } = require("../services/openrouterService");

function createSettingsRouter() {
  const router = express.Router();

  // GET /api/settings/status - Safe configuration health matrix
  router.get("/status", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    await loadSelectedGeminiModel();
    const smtpConfig = getSmtpConfig();
    const bufferConfig = getBufferConfig();

    return res.status(200).json({
      supabase: {
        configured: isSupabaseConfigured(),
        url: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.replace(/^(https?:\/\/[^/]{4})[^/]+/, "$1***") : null
      },
      ai: {
        provider: getAIProvider(),
        configured: getAIProvider() === "gemini" ? Boolean(process.env.GEMINI_API_KEY) : Boolean(process.env.OPENROUTER_API_KEY),
        model: getAIProvider() === "gemini" ? getSelectedGeminiModel() : (process.env.OPENROUTER_MODEL || "openrouter/free"),
        availableModels: SUPPORTED_GEMINI_MODELS
      },
      openrouter: {
        configured: Boolean(process.env.OPENROUTER_API_KEY),
        model: process.env.OPENROUTER_MODEL || "openrouter/free"
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

  // GET /api/settings/ai-model - Current runtime model selection
  router.get("/ai-model", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    const model = await loadSelectedGeminiModel();
    return res.json({ provider: getAIProvider(), model, availableModels: SUPPORTED_GEMINI_MODELS });
  });

  // PUT /api/settings/ai-model - Persist model selection without a server restart
  router.put("/ai-model", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const { model } = req.body || {};
    if (!SUPPORTED_GEMINI_MODELS.includes(model)) {
      return res.status(400).json({ error: "Choose a supported Gemini model.", availableModels: SUPPORTED_GEMINI_MODELS });
    }
    try {
      await setSelectedGeminiModel(model);
      return res.json({ success: true, provider: "gemini", model });
    } catch (err) {
      return res.status(500).json({ error: `Could not save model selection: ${err.message}` });
    }
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

  // POST /api/settings/test/ai - Test the configured AI provider
  router.post("/test/ai", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    const provider = getAIProvider();
    const configured = provider === "gemini" ? Boolean(process.env.GEMINI_API_KEY) : Boolean(process.env.OPENROUTER_API_KEY);
    if (!configured) {
      return res.status(200).json({ success: false, message: provider === "gemini" ? "GEMINI_API_KEY not configured." : "OPENROUTER_API_KEY not configured." });
    }
    try {
      const reply = await callAI({
        messages: [{ role: "user", content: "Reply with the word PONG" }],
        maxTokens: 10
      });
      return res.status(200).json({ success: true, message: `${provider} responded: "${reply.trim()}"` });
    } catch (err) {
      return res.status(200).json({ success: false, message: `${provider} test failed: ${err.message}` });
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
