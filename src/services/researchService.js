const { getSupabaseClient } = require("../config/supabase");

async function getResearchByLeadId(leadId) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("lead_research")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function saveLeadResearch(leadId, researchResult) {
  const supabase = getSupabaseClient();

  const record = {
    lead_id: leadId,
    summary: researchResult.summary || "",
    services_offered: researchResult.services_offered || [],
    target_market: researchResult.target_market || "",
    evidence_activity: researchResult.evidence_activity || "",
    marketing_opportunities: researchResult.marketing_opportunities || [],
    potential_limitations: researchResult.potential_limitations || [],
    suggested_smma_services: researchResult.suggested_smma_services || [],
    qualification_score:
      typeof researchResult.qualification_score === "number"
        ? Math.max(0, Math.min(100, Math.round(researchResult.qualification_score)))
        : null,
    qualification_reasoning: researchResult.qualification_reasoning || "",
    research_sources: researchResult.research_sources || [],
    raw_research: researchResult.raw_research || {}
  };

  const { data, error } = await supabase.from("lead_research").insert(record).select().single();
  if (error) throw error;
  return data;
}

module.exports = {
  getResearchByLeadId,
  saveLeadResearch
};
