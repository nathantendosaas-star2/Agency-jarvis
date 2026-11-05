const { callGemini, sanitizeJsonResponse, getSelectedGeminiModel } = require("../services/openrouterService");

const GMAIL_SYSTEM_PROMPT = `You are Agency Jarvis's Senior Cold Outreach Strategist for Social Media Marketing Agencies.
Your job is to generate a highly personalized, concise, professional cold outreach email for prospective clients based on business research.

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
  "message_body": "Personalized email body text...",
  "angle_used": "Explanation of marketing opportunity targeted"
}`;

const INSTAGRAM_SYSTEM_PROMPT = `You are Agency Jarvis's Social Media Outreach Specialist.
Your job is to generate a personalized, natural, highly conversational Instagram Direct Message (DM) to a business owner or marketing lead.

CRITICAL RULES:
1. Keep it short and punchy: strictly under 100 words (40 to 80 words recommended).
2. DO NOT include any email subject line.
3. Use a casual, warm, conversational peer tone suitable for Instagram DMs.
4. Reference a genuine observation from their brand or online presence.
5. Provide a low-friction question or compliment to start a dialogue.
6. Avoid formal corporate jargon, marketing buzzwords, or aggressive pitches.

You MUST respond strictly in valid JSON format:
{
  "message_body": "Concise conversational DM text...",
  "angle_used": "Key observation or opportunity referenced"
}`;

const WHATSAPP_SYSTEM_PROMPT = `You are Agency Jarvis's Direct Messaging Specialist.
Your job is to generate a concise, friendly WhatsApp message for an initial business outreach.

CRITICAL RULES:
1. Keep paragraphs very short (1-2 sentences each). Total length: 50 to 90 words.
2. DO NOT include any email subject line.
3. Use a direct, respectful, and friendly tone suitable for WhatsApp business communication.
4. Reference a specific, genuine opportunity or observation about their business.
5. Provide a clear, easy-to-answer question to initiate contact without pressure.
6. Avoid spammy greetings or generic sales hype.

You MUST respond strictly in valid JSON format:
{
  "message_body": "Concise WhatsApp message formatted with short paragraphs...",
  "angle_used": "Key opportunity or angle used"
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

function getSystemPromptForChannel(channel = "gmail") {
  const norm = String(channel || "gmail").toLowerCase().trim();
  if (norm === "instagram") return INSTAGRAM_SYSTEM_PROMPT;
  if (norm === "whatsapp") return WHATSAPP_SYSTEM_PROMPT;
  return GMAIL_SYSTEM_PROMPT;
}

async function generateOutreachDraft(lead, research, emailBrief = "", options = {}) {
  const channel = (options.channel || lead.outreach_channel || "gmail").toLowerCase().trim();
  const configuredModel = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const model = getSelectedGeminiModel(options.model || configuredModel);

  const prompt = `Generate a personalized ${channel.toUpperCase()} outreach message for this prospect.

TARGET OUTREACH CHANNEL: ${channel.toUpperCase()}
USER BRIEF (if any):
${emailBrief || "Write a concise, relevant introduction to our SMMA services grounded in the research findings."}

PROSPECT LEAD INFORMATION:
- Business Name: ${lead.business_name}
- Contact Name: ${lead.contact_name || "Business Owner"}
- Industry/Category: ${lead.business_category || lead.industry || "Local Business"}
- Website: ${lead.website || "Not provided"}
- Location: ${lead.location || "Not specified"}
- Instagram: ${lead.instagram || lead.instagram_handle || "Not provided"}
- Phone: ${lead.phone || "Not provided"}
- Email: ${lead.email || "Not provided"}

RESEARCH FINDINGS & QUALIFICATION:
- Summary: ${research?.summary || "No detailed summary available"}
- Marketing Opportunities: ${JSON.stringify(research?.marketing_opportunities || [])}
- Identified Services: ${JSON.stringify(research?.services_offered || [])}
- Target Market: ${research?.target_market || "General audience"}
- Suggested SMMA Services: ${JSON.stringify(research?.suggested_smma_services || [])}
- Qualification Score: ${research?.qualification_score ?? lead.qualification_score ?? "N/A"}/100
- Qualification Reasoning: ${research?.qualification_reasoning || "N/A"}`;

  const systemPrompt = getSystemPromptForChannel(channel);

  const responseText = await callGemini({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt }
    ],
    model,
    temperature: 0.3,
    responseFormat: { type: "json_object" }
  });

  const cleaned = sanitizeJsonResponse(responseText);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse AI outreach response as JSON: ${err.message}. Content: ${cleaned.slice(0, 200)}`);
  }

  const messageBody = parsed.message_body || parsed.email_body || parsed.body || "";
  if (!messageBody || !messageBody.trim()) {
    throw new Error(`Generated outreach draft for ${channel} was empty.`);
  }

  const selectedSubject = channel === "gmail" ? (parsed.selected_subject || parsed.subject || `Opportunity for ${lead.business_name}`) : null;
  const subjectLines = channel === "gmail"
    ? (Array.isArray(parsed.subject_lines) && parsed.subject_lines.length ? parsed.subject_lines : [selectedSubject])
    : [];

  return {
    channel,
    model_used: model,
    subject_lines: subjectLines,
    subject: selectedSubject,
    body: messageBody.trim(),
    message_body: messageBody.trim(),
    angle: parsed.angle_used || "Tailored SMMA opportunity"
  };
}

async function classifyProspectReply(originalEmail, replyContent, options = {}) {
  const model = getSelectedGeminiModel(options.model || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite");
  const prompt = `Analyze this prospect reply:
ORIGINAL OUTREACH:
Subject: ${originalEmail?.subject || "Initial inquiry"}
Body: ${originalEmail?.message_body || originalEmail?.body || "N/A"}

PROSPECT'S REPLY:
"${replyContent}"`;

  const responseText = await callGemini({
    messages: [
      { role: "system", content: REPLY_CLASSIFICATION_PROMPT },
      { role: "user", content: prompt }
    ],
    model,
    temperature: 0.2,
    responseFormat: { type: "json_object" }
  });

  const cleaned = sanitizeJsonResponse(responseText);
  return JSON.parse(cleaned);
}

module.exports = {
  generateOutreachDraft,
  classifyProspectReply,
  getSystemPromptForChannel
};
