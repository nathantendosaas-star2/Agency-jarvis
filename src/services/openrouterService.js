const DEFAULT_MODEL = "google/gemma-4-26b-a4b-it:free";

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
  let cleaned = text.trim();
  // Strip markdown code fences if model returned ```json ... ```
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  }
  return cleaned;
}

function validateEvaluation(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Evaluation response must be an object.");
  }
  if (typeof data.summary !== "string" || !data.summary.trim()) {
    throw new Error("Missing or invalid summary in evaluation.");
  }
  if (typeof data.qualification_score !== "number" || isNaN(data.qualification_score) || data.qualification_score < 0 || data.qualification_score > 100) {
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

async function evaluateLeadWithOpenRouter(lead, researchData, options = {}) {
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  const model = options.model || process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const endpoint = "https://openrouter.ai/api/v1/chat/completions";

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
    sources: (researchData.sources || []).map((s) => ({
      title: s.title,
      url: s.url,
      snippet: s.content ? s.content.slice(0, 500) : ""
    }))
  };

  const userPrompt = `Please evaluate the following prospect lead for SMMA services using this verified research:

LEAD DETAILS:
${JSON.stringify(leadContext, null, 2)}

TAVILY RESEARCH DATA:
${JSON.stringify(researchContext, null, 2)}

Output your evaluation strictly in the required JSON format.`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://agencyjarvis.local",
      "X-Title": "Agency Jarvis MVP"
    },
    body: JSON.stringify({
      model: model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: REVIEW_SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    let errorDetail = "";
    try {
      const errJson = await response.json();
      errorDetail = errJson.error ? (errJson.error.message || JSON.stringify(errJson.error)) : JSON.stringify(errJson);
    } catch {
      errorDetail = await response.text();
    }
    throw new Error(`OpenRouter API error (${response.status}): ${errorDetail}`);
  }

  const result = await response.json();
  const choice = result.choices && result.choices[0];
  if (!choice || !choice.message || !choice.message.content) {
    throw new Error("OpenRouter returned an empty or invalid completion.");
  }

  const rawContent = choice.message.content;
  const cleanedContent = sanitizeJsonResponse(rawContent);

  let parsedJson;
  try {
    parsedJson = JSON.parse(cleanedContent);
  } catch (err) {
    throw new Error(`Failed to parse AI response as JSON: ${err.message}. Content was: ${rawContent.slice(0, 300)}`);
  }

  const validated = validateEvaluation(parsedJson);

  // Fallback: If AI returned empty research sources, populate from Tavily sources
  if (validated.research_sources.length === 0 && researchData.sources && researchData.sources.length > 0) {
    validated.research_sources = researchData.sources.map((s) => s.url).filter(Boolean);
  }

  return validated;
}

module.exports = {
  DEFAULT_MODEL,
  sanitizeJsonResponse,
  validateEvaluation,
  evaluateLeadWithOpenRouter
};
