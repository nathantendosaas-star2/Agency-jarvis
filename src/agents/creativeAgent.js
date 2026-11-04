const { callOpenRouter, callGeminiWithTools } = require("../services/openrouterService");
const { readWorkspaceFile } = require("../services/agentTools");

const CREATIVE_SYSTEM_PROMPT = `You are Agency Jarvis's Senior Creative Director and SMMA Strategist.
Your task is to generate high-value, professional deliverables for an agency owner to use with prospects or active clients.

Format deliverables in clean, well-structured Markdown.
Include clear headings, actionable bullet points, realistic scope, and agency best practices.
Never claim actions have been taken in the real world—focus on strategic, creative, and operational deliverables.`;

async function generateLandingPage(prompt, businessInfo = {}) {
  const systemPrompt = `You are Jarvis, an agentic web designer and frontend developer working for an SMMA agency.
Create a polished, conversion-focused, production-ready single-page landing page.
You have tools to list, read, write files in a private workspace and run a small allowlist of safe validation commands.
You MUST use write_workspace_file to save the finished page to deliverables/landing-page.html.
The deliverable must be a complete standalone HTML document with embedded CSS and minimal vanilla JavaScript, responsive mobile-first layout, accessible semantic markup, strong visual hierarchy, clear CTA, SEO title/description, Open Graph metadata, and realistic placeholder contact details clearly marked for replacement.
Do not return a Markdown strategy or a description instead of the website. Do not use external frameworks or build tools. Do not invent testimonials, client results, certifications, or factual claims. Use clearly labeled placeholders when business details are missing.
After writing the file, use read_workspace_file to verify the saved HTML. Then respond with a short completion note and the saved file path.`;

  const userPrompt = `Build the actual HTML landing page for this request.\n\nREQUEST:\n${prompt}\n\nAVAILABLE BUSINESS CONTEXT:\n${JSON.stringify(businessInfo, null, 2)}\n\nSave the complete HTML using write_workspace_file at deliverables/landing-page.html. Do not give me a marketing strategy.`;
  const result = await callGeminiWithTools({ systemPrompt, userPrompt, maxTokens: 12000, maxToolTurns: 8 });
  const written = result.writtenPaths.includes("deliverables/landing-page.html");
  if (!written) throw new Error("Jarvis did not save the landing page artifact. Please retry the task.");
  const file = await readWorkspaceFile({ path: "deliverables/landing-page.html" });
  if (!/<!doctype html|<html[\s>]/i.test(file.content)) {
    throw new Error("The generated artifact is not a complete HTML document.");
  }
  return { html: file.content, path: file.path, note: result.text };
}

async function generateRedesignBrief(businessInfo) {
  const userPrompt = `Create a Website Redesign Brief for the following business:
${JSON.stringify(businessInfo, null, 2)}

Include:
1. Executive Summary & Problem Statement
2. Target Audience & User Personas
3. Recommended Information Architecture & Site Map
4. Key Conversion Rate Optimization (CRO) improvements
5. Call-to-action (CTA) hierarchy
6. Recommended Tech Stack & SMMA Integration (Pixel, GA4, CRM, Lead Magnet)`;

  return await callOpenRouter({
    messages: [
      { role: "system", content: CREATIVE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.3,
    maxTokens: 2500
  });
}

async function generateSmmaProposal(businessInfo) {
  const userPrompt = `Generate a comprehensive, client-ready SMMA Proposal for:
${JSON.stringify(businessInfo, null, 2)}

Include:
1. Executive Summary & Growth Objectives
2. Strategic SMMA Scope (Paid Ads, Content Creation, Funnel Optimization)
3. Month 1-3 Phased Roadmap
4. Proposed Retainer Tiers (Core vs. Growth vs. Scale)
5. KPIs and Reporting Cadence
6. Next Steps & Terms of Engagement`;

  return await callOpenRouter({
    messages: [
      { role: "system", content: CREATIVE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.3,
    maxTokens: 2500
  });
}

async function generateMarketingStrategy(businessInfo) {
  const userPrompt = `Develop a Full-Funnel Digital Marketing Strategy for:
${JSON.stringify(businessInfo, null, 2)}

Include:
1. Market Positioning & Unique Value Proposition
2. Top-of-Funnel (Organic & Paid Awareness)
3. Middle-of-Funnel (Nurture, Social Proof, Retargeting)
4. Bottom-of-Funnel (High-Intent Conversion & Offers)
5. 90-Day Execution Timeline`;

  return await callOpenRouter({
    messages: [
      { role: "system", content: CREATIVE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.3,
    maxTokens: 2500
  });
}

async function generateCreativeBrief(businessInfo) {
  const userPrompt = `Generate a Creative Campaign Brief for:
${JSON.stringify(businessInfo, null, 2)}

Include:
1. Campaign Objective & Core Message
2. Visual Tone, Mood & Brand Aesthetic
3. Content Angles & Video Hooks (Short-Form / Reels / TikTok)
4. Static Ad Concepts (Headline, Graphic Idea, CTA)
5. Deliverables Checklist & Production Timeline`;

  return await callOpenRouter({
    messages: [
      { role: "system", content: CREATIVE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.4,
    maxTokens: 2500
  });
}

async function generateClientRecommendations(clientInfo) {
  const userPrompt = `Generate Strategic SMMA Optimization Recommendations for existing client:
${JSON.stringify(clientInfo, null, 2)}

Include:
1. Current State Assessment
2. Immediate Quick Wins (Next 14 Days)
3. Content Scaling Opportunities
4. Ad Spend & ROAS Growth Recommendations
5. Retention and Upsell Strategy`;

  return await callOpenRouter({
    messages: [
      { role: "system", content: CREATIVE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.3,
    maxTokens: 2000
  });
}

module.exports = {
  generateLandingPage,
  generateRedesignBrief,
  generateSmmaProposal,
  generateMarketingStrategy,
  generateCreativeBrief,
  generateClientRecommendations
};
