const { callAI, sanitizeJsonResponse } = require("../services/openrouterService");
const { researchBusinessWithTavily } = require("../services/tavilyService");
const {
  generateRedesignBrief,
  generateSmmaProposal,
  generateMarketingStrategy,
  generateCreativeBrief,
  generateClientRecommendations,
  generateLandingPage
} = require("./creativeAgent");
const { generateSocialContent } = require("./socialAgent");
const { getClientById } = require("../services/clientsService");
const { getLeadById } = require("../services/leadsService");

const CLASSIFICATION_PROMPT = `You are Agency Jarvis's Task Orchestrator.
Your role is to classify a natural-language task prompt from an agency owner into one of these 8 supported task types:

1. "research" - Web research or deep intelligence on a business/competitor.
2. "redesign_brief" - Website redesign or UX/CRO improvement brief.
3. "smma_proposal" - Marketing proposal, retainer scope, or pitch deck outline.
4. "marketing_strategy" - Full-funnel digital strategy, paid ad plan, or growth roadmap.
5. "social_ideas" - Social media campaign ideas, posts, or content calendar.
6. "creative_brief" - Creative ad concepts, video hooks, Reels/TikTok scripts.
7. "client_recommendations" - Optimization and account growth recommendations for an existing client.\n8. "landing_page" - Build a complete, standalone HTML landing page and save it as a real file.

Respond strictly in valid JSON format:
{
  "task_type": "research | redesign_brief | smma_proposal | marketing_strategy | social_ideas | creative_brief | client_recommendations | landing_page",
  "reasoning": "Brief reason for classification",
  "target_name": "Extracted business or client name, if mentioned"
}`;

async function classifyTaskPrompt(promptText) {
  if (/\b(landing page|one[- ]page website|single[- ]page website)\b/i.test(promptText) && /\b(build|create|design|make|generate|code|develop)\b/i.test(promptText)) {
    return { task_type: "landing_page", reasoning: "The request explicitly asks to build a landing page." };
  }
  const raw = await callAI({
    messages: [
      { role: "system", content: CLASSIFICATION_PROMPT },
      { role: "user", content: `Classify this task request:\n"${promptText}"` }
    ],
    temperature: 0.1,
    responseFormat: { type: "json_object" }
  });

  const cleaned = sanitizeJsonResponse(raw);
  return JSON.parse(cleaned);
}

async function executeTask({ taskType, prompt, clientId = null, leadId = null }) {
  let contextInfo = { prompt };

  if (clientId) {
    const client = await getClientById(clientId);
    if (client) contextInfo.client = client;
  }
  if (leadId) {
    const lead = await getLeadById(leadId);
    if (lead) contextInfo.lead = lead;
  }

  let resultMarkdown = "";
  let artifact = null;

  switch (taskType) {
    case "research": {
      const tavilyRes = await researchBusinessWithTavily(prompt);
      const answer = tavilyRes.answer || "No direct answer synthesized.";
      const sourcesMd = (tavilyRes.sources || [])
        .map((s) => `- [${s.title || s.url}](${s.url}): ${s.content.slice(0, 180)}…`)
        .join("\n");
      resultMarkdown = `# Web Research Intelligence\n\n**Query:** ${prompt}\n\n## Synthesis\n${answer}\n\n## Sources Found\n${sourcesMd}`;
      break;
    }
    case "redesign_brief":
      resultMarkdown = await generateRedesignBrief(contextInfo);
      break;
    case "smma_proposal":
      resultMarkdown = await generateSmmaProposal(contextInfo);
      break;
    case "marketing_strategy":
      resultMarkdown = await generateMarketingStrategy(contextInfo);
      break;
    case "creative_brief":
      resultMarkdown = await generateCreativeBrief(contextInfo);
      break;
    case "social_ideas": {
      const socialRes = await generateSocialContent(contextInfo.client || { company: prompt }, "Organic Engagement & Authority");
      resultMarkdown = `# Social Media Concepts\n\n**Strategy Notes:** ${socialRes.strategy_notes || "N/A"}\n\n` +
        (socialRes.content_ideas || []).map((idea, idx) => `### Idea ${idx + 1}: ${idea.title} (${idea.platform})\n**Hook:** ${idea.hook}\n\n${idea.caption}\n\n*Hashtags:* ${(idea.hashtags || []).join(" ")}`).join("\n\n---\n\n");
      break;
    }
    case "client_recommendations":
      resultMarkdown = await generateClientRecommendations(contextInfo);
      break;
    case "landing_page": {
      const page = await generateLandingPage(prompt, contextInfo);
      resultMarkdown = page.html;
      artifact = { type: "html", path: page.path, note: page.note || "" };
      break;
    }
    default:
      throw new Error(`Unsupported task type: ${taskType}`);
  }

  return {
    taskType,
    result: resultMarkdown,
    artifact
  };
}

module.exports = {
  classifyTaskPrompt,
  executeTask
};
