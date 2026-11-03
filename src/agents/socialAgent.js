const { callOpenRouter, sanitizeJsonResponse } = require("../services/openrouterService");

const SOCIAL_SYSTEM_PROMPT = `You are Agency Jarvis's Lead Social Media Manager and Content Strategist.
Your goal is to craft high-performing social media content and calendars for agency clients.

You MUST follow platform conventions:
- LinkedIn: Professional tone, hooks, line breaks, career/business insights, 3-5 relevant hashtags.
- Twitter/X: Concise (under 280 chars), punchy hook, engaging question or call to action.
- Instagram: Engaging caption, clear visual direction description, call-to-action, 10-15 hashtags.
- Facebook: Community-focused, conversational tone, clear link or discussion prompt.

Respond strictly in valid JSON matching this schema:
{
  "content_ideas": [
    {
      "title": "Short concept title",
      "platform": "linkedin | twitter | instagram | facebook",
      "objective": "brand_awareness | engagement | lead_generation",
      "hook": "Opening hook line",
      "caption": "Full post copy with emojis and line breaks",
      "hashtags": ["#tag1", "#tag2"],
      "media_description": "Suggested visual or video idea"
    }
  ],
  "strategy_notes": "Summary of content angle and schedule advice"
}`;

async function generateSocialContent(clientOrBrand, objective, platform = "linkedin") {
  const userPrompt = `Generate 3 distinct social media post concepts for:
Brand / Client: ${clientOrBrand.company || clientOrBrand.name || "Agency Client"}
Industry: ${clientOrBrand.industry || "General Business"}
Core Objective: ${objective || "Client Growth & Authority"}
Target Platform: ${platform}
Additional Context: ${clientOrBrand.notes || "None"}

Provide high quality, ready-to-post options.`;

  const responseText = await callOpenRouter({
    messages: [
      { role: "system", content: SOCIAL_SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.4,
    responseFormat: { type: "json_object" }
  });

  const cleaned = sanitizeJsonResponse(responseText);
  return JSON.parse(cleaned);
}

async function generateContentCalendar(clientOrBrand, periodDays = 7) {
  const userPrompt = `Generate a ${periodDays}-day social media content calendar for:
Client: ${clientOrBrand.company || clientOrBrand.name}
Industry: ${clientOrBrand.industry || "General"}
Target Audience: ${clientOrBrand.target_audience || "Prospective Clients"}

Include 1 post per day covering an ideal mix of educational, social proof, thought leadership, and promotional content.`;

  const responseText = await callOpenRouter({
    messages: [
      { role: "system", content: SOCIAL_SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.4,
    responseFormat: { type: "json_object" }
  });

  const cleaned = sanitizeJsonResponse(responseText);
  return JSON.parse(cleaned);
}

module.exports = {
  generateSocialContent,
  generateContentCalendar
};
