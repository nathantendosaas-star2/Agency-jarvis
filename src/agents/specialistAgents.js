const { getSupabaseClient } = require("../config/supabase");
const { researchBusinessWithTavily } = require("../services/tavilyService");
const { normalizeWebsite, findDuplicateLead, createLead, getLeadById } = require("../services/leadsService");
const { enqueueLeadJob, processLeadAutonomousWorkflow } = require("../services/leadPipelineService");
const { getResearchByLeadId } = require("../services/researchService");

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch { return null; }
}

async function runDiscovery(payload = {}) {
  const query = String(payload.query || [payload.industry,payload.location].filter(Boolean).join(" ")).trim();
  if (!query) throw new Error("Discovery requires a query, industry or location.");
  const research = await researchBusinessWithTavily(query,{
    maxResults:Math.min(20,Math.max(1,Number(payload.limit)||10)),
    searchDepth:payload.searchDepth||"advanced"
  });
  const discovered = [];
  const duplicates = [];
  const rejected = [];
  for (const source of research.sources || []) {
    const website = safeHttpUrl(source.url);
    const businessName = String(source.title||"").trim().replace(/\\s+/g," ").slice(0,180);
    if (!website || !businessName) {
      rejected.push({title:source.title||"",reason:"Missing a usable public business name or HTTP(S) source."});
      continue;
    }
    const duplicate = await findDuplicateLead({
      normalized_website:normalizeWebsite(website),
      business_name:businessName
    });
    if (duplicate) {
      duplicates.push({businessName,duplicateId:duplicate.id});
      continue;
    }
    const lead = await createLead({
      business_name:businessName,
      website,
      business_category:payload.industry||null,
      location:payload.location||null,
      source:"autonomous_discovery",
      lead_status:"new",
      notes:"Public discovery evidence URL: "+website+"\\nSource title: "+(source.title||"")+"\\nExcerpt: "+String(source.content||"").slice(0,900)
    });
    await enqueueLeadJob(lead.id,"research_pending");
    discovered.push({id:lead.id,businessName,website});
  }
  return {
    query,
    sourcesReviewed:(research.sources||[]).length,
    discovered,
    duplicates,
    rejected,
    note:"Only unqualified candidate records are created. Candidates enter research and human review; no outreach is sent."
  };
}

async function runResearch(payload = {}) {
  const leadId = payload.leadId || payload.lead_id;
  if (!leadId) throw new Error("Research requires payload.leadId.");
  return processLeadAutonomousWorkflow(leadId,payload.stage||"research_pending");
}

async function runLeadReviewer(payload = {}) {
  const leadId = payload.leadId || payload.lead_id;
  if (!leadId) throw new Error("Lead reviewer requires payload.leadId.");
  const [lead,research] = await Promise.all([getLeadById(leadId),getResearchByLeadId(leadId)]);
  if (!lead) throw new Error("Lead was not found.");
  if (!research) throw new Error("Research must be completed before evidence review.");
  const sources = Array.isArray(research.research_sources) ? research.research_sources.filter(Boolean) : [];
  const checks = [
    {key:"business_identity",passed:Boolean(lead.business_name),detail:"Named business record exists."},
    {key:"independent_sources",passed:sources.length>=2,detail:sources.length+" source URL(s) recorded; target is at least two."},
    {key:"activity_evidence",passed:Boolean(String(research.evidence_activity||"").trim()),detail:"Concrete activity evidence is present."},
    {key:"service_fit",passed:Array.isArray(research.suggested_smma_services)&&research.suggested_smma_services.length>0,detail:"At least one relevant service is identified."},
    {key:"contact_route",passed:Boolean(lead.email||lead.phone||lead.instagram||lead.instagram_handle),detail:"A public contact route is present."},
    {key:"human_qualification",passed:lead.lead_status==="qualified",detail:"Lead qualification remains a human decision."}
  ];
  return {
    leadId,
    businessName:lead.business_name,
    checks,
    passedChecks:checks.filter(x=>x.passed).length,
    totalChecks:checks.length,
    qualificationScore:research.qualification_score??lead.qualification_score??null,
    recommendedStatus:"needs_review",
    decision:"HUMAN_REVIEW_REQUIRED",
    note:"This agent never sets a lead to qualified. A human must verify evidence, budget fit, contact validity and duplicate risk."
  };
}

async function runOutreach(payload = {}) {
  const leadId = payload.leadId || payload.lead_id;
  if (!leadId) throw new Error("Outreach requires payload.leadId.");
  const lead = await getLeadById(leadId);
  if (!lead) throw new Error("Lead was not found.");
  if (lead.lead_status !== "qualified") throw new Error("Outreach is blocked until a human explicitly qualifies this lead.");
  return processLeadAutonomousWorkflow(leadId,"draft_generation_pending");
}

async function runWorkbench(payload = {}) {
  const {executeTask,classifyTaskPrompt} = require("../agents/orchestrator");
  const prompt = String(payload.prompt||"").trim();
  if (!prompt) throw new Error("Workbench requires payload.prompt.");
  let taskType = payload.taskType || payload.task_type || "auto";
  if (taskType==="auto") {
    const classification=await classifyTaskPrompt(prompt);
    taskType=classification.task_type;
  }
  const result=await executeTask({
    taskType,prompt,
    clientId:payload.clientId||payload.client_id||null,
    leadId:payload.leadId||payload.lead_id||null
  });
  return {taskType,result:result.result,artifact:result.artifact||null};
}

async function runOperations() {
  const db=getSupabaseClient();
  const today=new Date();
  today.setHours(0,0,0,0);
  const [runs,tasks,usage]=await Promise.all([
    db.from("agent_runs").select("id,status,started_at,finished_at,tasks_processed,tasks_completed,tasks_failed").order("started_at",{ascending:false}).limit(10),
    db.from("agent_tasks").select("status").limit(1000),
    db.from("agent_usage").select("provider,model,request_count,input_tokens,output_tokens,search_count,estimated_cost").gte("created_at",today.toISOString())
  ]);
  for (const result of [runs,tasks,usage]) if (result.error) throw result.error;
  const queueCounts={};
  for (const row of tasks.data||[]) queueCounts[row.status]=(queueCounts[row.status]||0)+1;
  const todayUsage=(usage.data||[]).reduce((sum,row)=>({
    aiRequests:sum.aiRequests+Number(row.request_count||0),
    searches:sum.searches+Number(row.search_count||0),
    inputTokens:sum.inputTokens+Number(row.input_tokens||0),
    outputTokens:sum.outputTokens+Number(row.output_tokens||0),
    estimatedCostUsd:Number((sum.estimatedCostUsd+Number(row.estimated_cost||0)).toFixed(6))
  }),{aiRequests:0,searches:0,inputTokens:0,outputTokens:0,estimatedCostUsd:0});
  return {generatedAt:new Date().toISOString(),recentRuns:runs.data||[],queueCounts,todayUsage};
}

async function runSpecialistTask(task) {
  const payload=task.payload||{};
  switch(task.agent_id) {
    case "discovery": return runDiscovery(payload);
    case "research": return runResearch(payload);
    case "lead_reviewer": return runLeadReviewer(payload);
    case "outreach": return runOutreach(payload);
    case "workbench": return runWorkbench(payload);
    case "operations": return runOperations();
    default: throw new Error("Unknown specialist agent: "+task.agent_id);
  }
}

module.exports={runSpecialistTask,runDiscovery,runResearch,runLeadReviewer,runOutreach,runWorkbench,runOperations};
