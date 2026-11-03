const { callOpenRouter } = require("../services/openrouterService");

const CREATIVE_SYSTEM_PROMPT = `You are Agency Jarvis's Senior Creative Director and SMMA Strategist.
Your task is to generate high-value, professional deliverables for an agency owner to use with prospects or active clients.

Format deliverables in clean, well-structured Markdown.
Include clear headings, actionable bullet points, realistic scope, and agency best practices.
Never claim actions have been taken in the real world—focus on strategic, creative, and operational deliverables.`;

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
  generateRedesignBrief,
  generateSmmaProposal,
  generateMarketingStrategy,
  generateCreativeBrief,
  generateClientRecommendations
};
