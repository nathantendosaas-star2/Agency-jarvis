const express = require("express");
const crypto = require("node:crypto");
const {getSupabaseClient,isSupabaseConfigured}=require("../config/supabase");
const {getLeadById}=require("../services/leadsService");

const AGENTS=new Set(["discovery","research","lead_reviewer","outreach","workbench","operations"]);
function missingSchema(error){return ["42P01","PGRST205","PGRST202","42883"].includes(error?.code);}
function unavailable(res,error){
  console.error("Autonomous operations database error:",error?.message||error);
  return res.status(503).json({error:"Autonomous operations schema unavailable. Validate and apply migrations 009 and 010 to the target Supabase project."});
}

function createAgentsRouter(){
  const router=express.Router();

  router.get("/",async(_req,res)=>{
    res.set("Cache-Control","no-store");
    if(!isSupabaseConfigured()) return res.status(503).json({error:"Supabase is not configured."});
    try{
      const db=getSupabaseClient();
      const start=new Date(); start.setHours(0,0,0,0);
      const [schedule,agents,runs,tasks,usage,workbench,leadQueue]=await Promise.all([
        db.from("agent_schedules").select("*").eq("schedule_id","primary").single(),
        db.from("agent_definitions").select("*").order("agent_id"),
        db.from("agent_runs").select("*").order("started_at",{ascending:false}).limit(20),
        db.from("agent_tasks").select("id,agent_id,task_type,status,priority,attempts,max_attempts,error,created_at,updated_at,completed_at,output,source_queue").order("created_at",{ascending:false}).limit(50),
        db.from("agent_usage").select("provider,model,request_count,input_tokens,output_tokens,search_count,estimated_cost,created_at").gte("created_at",start.toISOString()),
        db.from("workbench_tasks").select("id,status",{count:"exact",head:true}).in("status",["pending","running"]),
        db.from("lead_pipeline_jobs").select("id,status",{count:"exact",head:true}).in("status",["pending","processing"])
      ]);
      const failed=[schedule,agents,runs,tasks,usage,workbench,leadQueue].find(x=>x.error);
      if(failed) return missingSchema(failed.error)?unavailable(res,failed.error):res.status(500).json({error:failed.error.message});
      const today=(usage.data||[]).reduce((sum,row)=>({
        aiRequests:sum.aiRequests+Number(row.request_count||0),
        searches:sum.searches+Number(row.search_count||0),
        inputTokens:sum.inputTokens+Number(row.input_tokens||0),
        outputTokens:sum.outputTokens+Number(row.output_tokens||0),
        costUsd:Number((sum.costUsd+Number(row.estimated_cost||0)).toFixed(6))
      }),{aiRequests:0,searches:0,inputTokens:0,outputTokens:0,costUsd:0});
      return res.json({
        schedule:schedule.data,agents:agents.data||[],runs:runs.data||[],tasks:tasks.data||[],
        usageToday:today,legacyQueues:{workbench:workbench.count||0,leadPipeline:leadQueue.count||0},
        pricingConfigured:Boolean(process.env.AGENT_MODEL_PRICING_JSON)
      });
    }catch(error){return missingSchema(error)?unavailable(res,error):res.status(500).json({error:"Failed to load autonomous operations."});}
  });

  router.patch("/schedule",async(req,res)=>{
    const body=req.body||{},patch={};
    const ranges={
      interval_minutes:[60,10080],daily_task_limit:[1,500],daily_ai_call_limit:[1,5000],
      daily_search_limit:[0,5000],max_runtime_seconds:[30,900],max_tasks_per_run:[1,100]
    };
    for(const [key,range] of Object.entries(ranges)){
      if(body[key]===undefined) continue;
      const n=Number(body[key]);
      if(!Number.isInteger(n)||n<range[0]||n>range[1]) return res.status(400).json({error:key+" outside allowed range."});
      patch[key]=n;
    }
    if(body.daily_budget_usd!==undefined){
      const n=Number(body.daily_budget_usd);
      if(!Number.isFinite(n)||n<0||n>1000) return res.status(400).json({error:"Daily spend cap must be between $0 and $1,000."});
      patch.daily_budget_usd=n;
    }
    if(body.allow_paid_models!==undefined){
      if(typeof body.allow_paid_models!=="boolean") return res.status(400).json({error:"allow_paid_models must be boolean."});
      patch.allow_paid_models=body.allow_paid_models;
    }
    if(body.enabled!==undefined){
      if(typeof body.enabled!=="boolean") return res.status(400).json({error:"enabled must be boolean."});
      if(body.enabled){
        const {data,error}=await getSupabaseClient().from("agent_definitions").select("agent_id").eq("enabled",true);
        if(error) return missingSchema(error)?unavailable(res,error):res.status(500).json({error:error.message});
        if(!data?.length) return res.status(400).json({error:"Enable at least one specialist agent before enabling the global schedule."});
        patch.next_run_at=new Date().toISOString();
      }
      patch.enabled=body.enabled;
    }
    try{
      if(patch.allow_paid_models===true){
        const {data,error}=await getSupabaseClient().from("agent_schedules").select("daily_budget_usd").eq("schedule_id","primary").single();
        if(error) return missingSchema(error)?unavailable(res,error):res.status(500).json({error:error.message});
        const budget=patch.daily_budget_usd??Number(data.daily_budget_usd||0);
        if(budget<=0) return res.status(400).json({error:"Set a positive daily spend cap before allowing paid models."});
      }
      patch.updated_at=new Date().toISOString();
      const {data,error}=await getSupabaseClient().from("agent_schedules").update(patch).eq("schedule_id","primary").select("*").single();
      if(error) return missingSchema(error)?unavailable(res,error):res.status(500).json({error:error.message});
      return res.json({schedule:data});
    }catch(error){return missingSchema(error)?unavailable(res,error):res.status(500).json({error:"Could not update schedule."});}
  });

  router.patch("/:agentId",async(req,res)=>{
    const {agentId}=req.params;
    if(!AGENTS.has(agentId)) return res.status(404).json({error:"Unknown specialist agent."});
    if(typeof req.body?.enabled!=="boolean") return res.status(400).json({error:"enabled must be boolean."});
    try{
      const {data,error}=await getSupabaseClient().from("agent_definitions")
        .update({enabled:req.body.enabled,updated_at:new Date().toISOString()})
        .eq("agent_id",agentId).select("*").single();
      if(error) return missingSchema(error)?unavailable(res,error):res.status(500).json({error:error.message});
      return res.json({agent:data});
    }catch(error){return missingSchema(error)?unavailable(res,error):res.status(500).json({error:"Could not update agent."});}
  });

  router.post("/tasks",async(req,res)=>{
    const body=req.body||{},agentId=String(body.agent_id||"");
    if(!AGENTS.has(agentId)) return res.status(400).json({error:"Choose one of the six specialist agents."});
    const payload=body.payload&&typeof body.payload==="object"&&!Array.isArray(body.payload)?body.payload:{};
    if(agentId==="discovery"&&!String(payload.query||[payload.industry,payload.location].filter(Boolean).join(" ")).trim()) return res.status(400).json({error:"Discovery requires query, industry or location."});
    if(agentId==="workbench"&&!String(payload.prompt||"").trim()) return res.status(400).json({error:"Workbench requires a prompt."});
    if(["research","lead_reviewer","outreach"].includes(agentId)){
      const leadId=payload.leadId||payload.lead_id;
      if(!leadId) return res.status(400).json({error:"This agent requires payload.leadId."});
      const lead=await getLeadById(leadId).catch(()=>null);
      if(!lead) return res.status(404).json({error:"Lead not found."});
      if(agentId==="outreach"&&lead.lead_status!=="qualified") return res.status(409).json({error:"Outreach is blocked until a human explicitly qualifies this lead."});
    }
    try{
      const db=getSupabaseClient();
      const [schedule,agent]=await Promise.all([
        db.from("agent_schedules").select("enabled").eq("schedule_id","primary").single(),
        db.from("agent_definitions").select("enabled").eq("agent_id",agentId).single()
      ]);
      const error=schedule.error||agent.error;
      if(error) return missingSchema(error)?unavailable(res,error):res.status(500).json({error:error.message});
      if(!schedule.data.enabled||!agent.data.enabled) return res.status(409).json({error:"Enable the global schedule and selected agent before queuing a task."});
      const key=String(body.idempotency_key||("manual:"+agentId+":"+crypto.randomUUID())).slice(0,200);
      const {data,error:insertError}=await db.from("agent_tasks").insert({
        agent_id:agentId,task_type:agentId,payload,priority:Math.min(1000,Math.max(1,Number(body.priority)||100)),idempotency_key:key
      }).select("*").single();
      if(insertError) return res.status(500).json({error:insertError.message});
      return res.status(201).json({task:data});
    }catch(error){return missingSchema(error)?unavailable(res,error):res.status(500).json({error:"Could not queue task."});}
  });

  router.get("/runs/:runId/logs",async(req,res)=>{
    try{
      const {data,error}=await getSupabaseClient().from("agent_run_logs").select("*").eq("run_id",req.params.runId).order("created_at",{ascending:true}).limit(500);
      if(error) return missingSchema(error)?unavailable(res,error):res.status(500).json({error:error.message});
      return res.json({logs:data||[]});
    }catch(error){return missingSchema(error)?unavailable(res,error):res.status(500).json({error:"Could not load run logs."});}
  });

  return router;
}
module.exports={createAgentsRouter};
