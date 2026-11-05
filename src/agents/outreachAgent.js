const { callGemini, sanitizeJsonResponse } = require("../services/openrouterService");

const OUTREACH_SYSTEM_PROMPT = `You are Agency Jarvis's Senior Cold Outreach Strategist for Social Media Marketing Agencies.
Your job is to generate highly personalized, concise, relevant cold outreach emails for prospective clients based on business research.

CRITICAL RULES:
1. Keep the email concise: 80 to 140 words maximum.
2. DO NOT use generic buzzwords or aggressive sales fluff.
3. Reference specific facts from the research (services, target market, or clear marketing opportunities).
4. Provide a clear, low-friction call-to-action (e.g., asking for feedback on an idea or offering a quick 10-minute chat).
5. Generate 3 compelling subject lines.

You MUST respond strictly in valid JSON format:
{
  "subject_lines": ["Subject 1", "Subject 2", "Subject 3"],
  "selected_subject": "Best Subject Line",
  "email_body": "Personalized email body text...",
  "angle_used": "Explanation of marketing opportunity targeted"
}`;

const REPLY_CLASSIFICATION_PROMPT = `You are Agency Jarvis's Prospect Conversation Specialist.
Your job is to analyze a prospect's reply to our agency outreach, classify their sentiment/intent, and recommend the best next strategic step.

Categories:
- "interested": Positive response, wants to meet, asks for pricing/portfolio.
- "objection": Raised concerns (budget, timing, current provider), but still open.
- "not_interested": Explicit decline or unsubscribe.
- "referral": Re-routed to another colleague or department.
- "neutral": Vague response, acknowledged receipt without clear intent.

You MUST respond strictly in valid JSON format:
{
  "classification": "interested | objection | not_interested | referral | neutral",
  "sentiment_summary": "1-2 sentence analysis of prospect's tone and needs",
  "recommended_action": "Clear next action step for the agency owner",
  "suggested_follow_up": "Draft response to this prospect, or empty string if not interested"
}`;

async function generateOutreachDraft(lead, research, emailBrief = "") {
  const prompt = `Generate a personalized cold outreach email for this prospect.

USER EMAIL BRIEF (follow this direction while keeping all claims truthful and grounded in the research):
${emailBrief || "Use your best judgment to write a concise, relevant introduction to our SMMA services."}

Business Name: ${lead.business_name}
Contact Name: ${lead.contact_name || "Business Owner"}
Industry/Category: ${lead.business_category || lead.industry || "Local Business"}
Website: ${lead.website || "Not provided"}

RESEARCH SUMMARY:
${research?.summary || "No detailed summary available"}

MARKETING OPPORTUNITIES:
${JSON.stringify(research?.marketing_opportunities || [])}

SUGGESTED SMMA SERVICES:
${JSON.stringify(research?.suggested_smma_services || [])}`;

  const responseText = await callGemini({
    messages: [
      { role: "system", content: OUTREACH_SYSTEM_PROMPT },
      { role: "user", content: prompt }
    ],
    model: "gemini-3.6-flash",
    temperature: 0.3,
    responseFormat: { type: "json_object" }
  });

  const cleaned = sanitizeJsonResponse(responseText);
  const parsed = JSON.parse(cleaned);

  if (!parsed.email_body || !parsed.selected_subject) {
    throw new Error("Invalid outreach draft response from AI.");
  }

  return {
    subject_lines: Array.isArray(parsed.subject_lines) ? parsed.subject_lines : [parsed.selected_subject],
    subject: parsed.selected_subject,
    body: parsed.email_body,
    angle: parsed.angle_used || "Direct SMMA opportunity"
  };
}

async function classifyProspectReply(originalEmail, replyContent) {
  const prompt = `Analyze this prospect reply:
ORIGINAL OUTREACH EMAIL:
Subject: ${originalEmail?.subject || "Initial inquiry"}
Body: ${originalEmail?.message_body || "N/A"}

PROSPECT'S REPLY:
"${replyContent}"`;

  const responseText = await callGemini({
    messages: [
      { role: "system", content: REPLY_CLASSIFICATION_PROMPT },
      { role: "user", content: prompt }
    ],
    model: "gemini-3.6-flash",
    temperature: 0.2,
    responseFormat: { type: "json_object" }
  });

  const cleaned = sanitizeJsonResponse(responseText);
  return JSON.parse(cleaned);
}

module.exports = {
  generateOutreachDraft,
  classifyProspectReply
};
