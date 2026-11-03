const { getLeadById, updateLead } = require("./leadsService");
const { saveLeadResearch } = require("./researchService");
const { researchBusinessWithTavily } = require("./tavilyService");
const { evaluateLeadWithOpenRouter } = require("./openrouterService");

async function reviewAndQualifyLead(leadId, options = {}) {
  const lead = await getLeadById(leadId);
  if (!lead) {
    throw new Error(`Lead with id ${leadId} not found.`);
  }

  // Mark research as in_progress
  await updateLead(leadId, { research_status: "in_progress" });

  try {
    // 1. Formulate Tavily research query
    const searchQuery = [
      lead.business_name,
      lead.website || "",
      lead.location || "",
      lead.business_category || ""
    ]
      .filter(Boolean)
      .join(" ");

    // 2. Perform web research via Tavily
    const researchData = await researchBusinessWithTavily(searchQuery, options.tavilyOptions);

    // 3. Evaluate lead via OpenRouter
    const evaluation = await evaluateLeadWithOpenRouter(lead, researchData, options.openrouterOptions);

    // 4. Save evaluation to lead_research
    const savedResearch = await saveLeadResearch(leadId, {
      ...evaluation,
      raw_research: researchData
    });

    // 5. Update lead record
    const updatedLead = await updateLead(leadId, {
      research_status: "completed",
      qualification_score: evaluation.qualification_score,
      lead_status: evaluation.qualification_score >= 60 ? "researched" : (lead.lead_status || "researched")
    });

    return {
      success: true,
      lead: updatedLead,
      research: savedResearch
    };
  } catch (err) {
    // Mark research as failed if error occurs
    await updateLead(leadId, { research_status: "failed" });
    throw err;
  }
}

module.exports = {
  reviewAndQualifyLead
};
