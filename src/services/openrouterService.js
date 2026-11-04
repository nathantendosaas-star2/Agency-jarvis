const { getSupabaseClient, isSupabaseConfigured } = require("../config/supabase");
const { GEMINI_FUNCTION_DECLARATIONS, executeAgentTool, readWorkspaceFile } = require("./agentTools");

const DEFAULT_MODEL = "gemini-3.8-flash";
let runtimeGeminiModel = process.env.GEMINI_MODEL || DEFAULT_MODEL;
let runtimeModelLoaded = false;
const SUPPORTED_GEMINI_MODELS = Object.freeze([
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite"
]);

const REVIEW_SYSTEM_PROMPT = `You are Agency Jarvis's Senior SMMA Lead Qualification and Research Specialist.
Your task is to analyze prospective businesses for Social Media Marketing Agency (SMMA) services based strictly on the provided lead details and web research results.

CRITICAL RULES:
1. DO NOT invent or fabricate any business facts, statistics, services, or locations.
2. Clearly distinguish verified information from inferences or assumptions.
3. If specific information (like active ad campaigns, exact revenue, or tech stack) is unavailable in the provided research, explicitly state that it is unavailable.
4. Base your evaluation on actual business activity and digital presence.
5. Provide actionable marketing opportunities and realistic SMMA recommendations (e.g. Meta Ads, Google Ads, Short-form Video Content, Local SEO, Reputation Management, Landing Page Optimization).
6. Provide a qualification score strictly from 0 to 100 based on SMMA fit:
   - 0-30: Poor fit (e.g. unverified, defunct, unsuitable niche, enterprise with dedicated agency).
   - 31-60: Moderate fit (viable business but low digital readiness or missing clear demand indicators).
   - 61-80: Good fit (established business with clear marketing gaps that SMMA can solve).
   - 81-100: Exceptional fit (high-ticket niche, verified active operation, weak/unoptimized social presence, clear revenue opportunity).

You MUST output valid, parseable JSON conforming EXACTLY to the following schema:
{
  "summary": "Concise summary of the business (2-3 sentences)",
  "services_offered": ["Service 1", "Service 2"],
  "target_market": "Description of target customer/client base",
  "evidence_activity": "Concrete evidence that the business is active (e.g. recent reviews, posts, location listings)",
  "marketing_opportunities": ["Opportunity 1", "Opportunity 2"],
  "potential_limitations": ["Limitation or challenge 1", "Limitation 2"],
  "suggested_smma_services": ["SMMA Service 1", "SMMA Service 2"],
  "qualification_score": 75,
  "qualification_reasoning": "Detailed explanation of why this lead received this qualification score",
  "research_sources": ["https://example.com/source1", "https://example.com/source2"]
}`;

function sanitizeJsonResponse(text) {
  let cleaned = String(text || "").trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  }
  return cleaned;
}

function validateEvaluation(data) {
  if (!data || typeof data !== "object") throw new Error("Evaluation response must be an object.");
  if (typeof data.summary !== "string" || !data.summary.trim()) throw new Error("Missing or invalid summary in evaluation.");
  if (typeof data.qualification_score !== "number" || !Number.isFinite(data.qualification_score) || data.qualification_score < 0 || data.qualification_score > 100) {
    throw new Error("Missing or invalid qualification_score (must be number 0-100).");
  }
  if (typeof data.qualification_reasoning !== "string" || !data.qualification_reasoning.trim()) {
    throw new Error("Missing or invalid qualification_reasoning.");
  }
  return {
    summary: data.summary.trim(),
    services_offered: Array.isArray(data.services_offered) ? data.services_offered.map(String) : [],
    target_market: typeof data.target_market === "string" ? data.target_market.trim() : "",
    evidence_activity: typeof data.evidence_activity === "string" ? data.evidence_activity.trim() : "",
    marketing_opportunities: Array.isArray(data.marketing_opportunities) ? data.marketing_opportunities.map(String) : [],
    potential_limitations: Array.isArray(data.potential_limitations) ? data.potential_limitations.map(String) : [],
    suggested_smma_services: Array.isArray(data.suggested_smma_services) ? data.suggested_smma_services.map(String) : [],
    qualification_score: Math.round(data.qualification_score),
    qualification_reasoning: data.qualification_reasoning.trim(),
    research_sources: Array.isArray(data.research_sources) ? data.research_sources.map(String) : []
  };
}

function getAIProvider() {
  const provider = (process.env.AI_PROVIDER || "gemini").trim().toLowerCase();
  if (!["gemini", "openrouter"].includes(provider)) {
    throw new Error("AI_PROVIDER must be either 'gemini' or 'openrouter'.");
  }
  return provider;
}

function getSelectedGeminiModel(model = null) {
  const selectedModel = model || runtimeGeminiModel || process.env.GEMINI_MODEL || DEFAULT_MODEL;
  if (!SUPPORTED_GEMINI_MODELS.includes(selectedModel)) {
    throw new Error(`Unsupported GEMINI_MODEL "${selectedModel}". Choose one of: ${SUPPORTED_GEMINI_MODELS.join(", ")}.`);
  }
  return selectedModel;
}

async function loadSelectedGeminiModel() {
  if (runtimeModelLoaded) return runtimeGeminiModel;
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await getSupabaseClient()
        .from("app_settings")
        .select("value")
        .eq("key", "ai_config")
        .maybeSingle();
      if (error) throw error;
      const savedModel = data?.value?.gemini_model;
      if (savedModel && SUPPORTED_GEMINI_MODELS.includes(savedModel)) runtimeGeminiModel = savedModel;
    } catch (error) {
      console.warn("Could not load saved AI model setting:", error.message);
    }
  }
  runtimeModelLoaded = true;
  return runtimeGeminiModel;
}

async function setSelectedGeminiModel(model) {
  if (!SUPPORTED_GEMINI_MODELS.includes(model)) {
    throw new Error(`Unsupported Gemini model. Choose one of: ${SUPPORTED_GEMINI_MODELS.join(", ")}.`);
  }
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase must be configured to save the model selection.");
  }
  const { error } = await getSupabaseClient().from("app_settings").upsert({
    key: "ai_config",
    value: { gemini_model: model, provider: "gemini" },
    updated_at: new Date().toISOString()
  }, { onConflict: "key" });
  if (error) throw error;
  runtimeGeminiModel = model;
  runtimeModelLoaded = true;
  return runtimeGeminiModel;
}

function getMessageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === "string" ? part : (part?.text || "")).join("\n");
  }
  return String(content ?? "");
}

async function callGemini({ messages, responseFormat = null, model = null, maxTokens = 2000, apiKey: passedApiKey = null }) {
  const apiKey = passedApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const selectedModel = model ? getSelectedGeminiModel(model) : await loadSelectedGeminiModel();
  const systemMessages = messages.filter((message) => message.role === "system").map((message) => getMessageText(message.content));
  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: getMessageText(message.content) }]
    }));

  if (contents.length === 0) throw new Error("At least one user or assistant message is required.");

  const generationConfig = { maxOutputTokens: maxTokens };
  if (responseFormat?.type === "json_object") generationConfig.responseMimeType = "application/json";
  const payload = { contents, generationConfig };
  if (systemMessages.length) payload.systemInstruction = { parts: [{ text: systemMessages.join("\n\n") }] };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    let response;
    let result = {};
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      result = await response.json().catch(() => ({}));
      if (response.ok) break;

      const retryable = [429, 500, 502, 503, 504, 543].includes(response.status);
      if (!retryable || attempt === 2) {
        const detail = result.error?.message || JSON.stringify(result);
        throw new Error(`Gemini API error (${response.status}): ${detail}`);
      }
      const delay = Math.min(8000, 1000 * (2 ** attempt)) + Math.floor(Math.random() * 350);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const candidate = result.candidates?.[0];
    const responseText = candidate?.content?.parts?.map((part) => part.text || "").join("").trim();
    if (!responseText) {
      const reason = candidate?.finishReason || result.promptFeedback?.blockReason || "no text returned";
      throw new Error(`Gemini returned an empty completion (${reason}).`);
    }
    return responseText;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callGeminiWithTools({ systemPrompt, userPrompt, model = null, maxTokens = 6000, maxToolTurns = 8 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  const selectedModel = model ? getSelectedGeminiModel(model) : await loadSelectedGeminiModel();
  const contents = [{ role: "user", parts: [{ text: userPrompt }] }];
  const writtenPaths = [];
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    for (let turn = 0; turn < maxToolTurns; turn += 1) {
      const payload = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools: [{ functionDeclarations: GEMINI_FUNCTION_DECLARATIONS }],
        generationConfig: { maxOutputTokens: maxTokens }
      };
      let response;
      let result = {};
      for (let attempt = 0; attempt <= 2; attempt += 1) {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        result = await response.json().catch(() => ({}));
        if (response.ok) break;
        const retryable = [429, 500, 502, 503, 504, 543].includes(response.status);
        if (!retryable || attempt === 2) {
          throw new Error(`Gemini API error (${response.status}): ${result.error?.message || JSON.stringify(result)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 1000 * (2 ** attempt))));
      }

      const candidate = result.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const calls = parts.filter((part) => part.functionCall);
      if (!calls.length) {
        const text = parts.map((part) => part.text || "").join("").trim();
        return { text, writtenPaths };
      }

      contents.push(candidate.content);
      for (const part of calls) {
        const { name, args = {} } = part.functionCall;
        let toolResult;
        try {
          toolResult = await executeAgentTool(name, args);
          if (name === "write_workspace_file" && toolResult?.written) writtenPaths.push(toolResult.path);
        } catch (error) {
          toolResult = { error: error.message };
        }
        contents.push({
          role: "user",
          parts: [{ functionResponse: { name, response: { result: toolResult } } }]
        });
      }
    }
    throw new Error("Jarvis reached the maximum number of tool-execution steps without completing the task.");
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOpenRouter({ messages, temperature = 0.3, responseFormat = null, model = null, maxTokens = 2000, apiKey: passedApiKey = null }) {
  const apiKey = passedApiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");

  const selectedModel = model || process.env.OPENROUTER_MODEL || "openrouter/free";
  const bodyPayload = { model: selectedModel, temperature, max_tokens: maxTokens, messages };
  if (responseFormat) bodyPayload.response_format = responseFormat;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://agencyjarvis.local",
        "X-Title": "Agency Jarvis MVP"
      },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = result.error?.message || JSON.stringify(result);
      throw new Error(`OpenRouter API error (${response.status}): ${detail}`);
    }
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("OpenRouter returned an empty or invalid completion.");
    }
    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Kept under its historical name so existing agents continue to work.
// AI_PROVIDER selects the backend for every agent call, not just lead review.
async function callAI(options) {
  const provider = getAIProvider();
  return provider === "gemini" ? callGemini(options) : callOpenRouter(options);
}

async function evaluateLeadWithOpenRouter(lead, researchData, options = {}) {
  const provider = getAIProvider();
  const apiKey = options.apiKey || (provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENROUTER_API_KEY);
  if (!apiKey) throw new Error(provider === "gemini" ? "GEMINI_API_KEY is not configured." : "OPENROUTER_API_KEY is not configured.");

  const leadContext = {
    business_name: lead.business_name,
    website: lead.website || "Not provided",
    contact_name: lead.contact_name || "Not provided",
    category: lead.business_category || "Not provided",
    location: lead.location || "Not provided",
    notes: lead.notes || "None"
  };
  const researchContext = {
    query: researchData.query || "",
    tavily_answer: researchData.answer || null,
    sources: (researchData.sources || []).map((source) => ({
      title: source.title,
      url: source.url,
      snippet: source.content ? source.content.slice(0, 500) : ""
    }))
  };
  const userPrompt = `Please evaluate the following prospect lead for SMMA services using this verified research:

LEAD DETAILS:
${JSON.stringify(leadContext, null, 2)}

TAVILY RESEARCH DATA:
${JSON.stringify(researchContext, null, 2)}

Output your evaluation strictly in the required JSON format.`;

  const rawContent = await callAI({
    messages: [
      { role: "system", content: REVIEW_SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.2,
    responseFormat: { type: "json_object" },
    model: options.model,
    apiKey
  });

  let parsedJson;
  try {
    parsedJson = JSON.parse(sanitizeJsonResponse(rawContent));
  } catch (err) {
    throw new Error(`Failed to parse AI response as JSON: ${err.message}. Content was: ${rawContent.slice(0, 300)}`);
  }
  const validated = validateEvaluation(parsedJson);
  if (validated.research_sources.length === 0 && researchData.sources?.length) {
    validated.research_sources = researchData.sources.map((source) => source.url).filter(Boolean);
  }
  return validated;
}

module.exports = {
  DEFAULT_MODEL,
  SUPPORTED_GEMINI_MODELS,
  getAIProvider,
  getSelectedGeminiModel,
  loadSelectedGeminiModel,
  setSelectedGeminiModel,
  sanitizeJsonResponse,
  validateEvaluation,
  callAI,
  callGemini,
  callOpenRouter: callAI,
  callOpenRouterProvider: callOpenRouter,
  evaluateLeadWithOpenRouter
};
