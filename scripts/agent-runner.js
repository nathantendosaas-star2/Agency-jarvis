require("dotenv").config();

const crypto = require("node:crypto");
const { getSupabaseClient } = require("../src/config/supabase");
const {
  writeLog, getSchedule, acquireLock, releaseLock, claimTask, recoverExpiredTasks, finishTask, failTask
} = require("../src/services/autonomousExecutionService");

const WORKER_ID = `gha-${process.env.GITHUB_RUN_ID || "manual"}-${crypto.randomUUID()}`;
const MAX_RUNTIME_SECONDS = Math.max(30, Math.min(Number(process.env.AGENT_MAX_RUNTIME_SECONDS || 420), 900));
const MAX_TASKS = Math.max(1, Math.min(Number(process.env.AGENT_MAX_TASKS || 10), 100));
let stopping = false;

function validateConfig() {
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required runner configuration: ${missing.join(", ")}`);
  if (!/^https:\/\//.test(process.env.SUPABASE_URL)) throw new Error("SUPABASE_URL must be an HTTPS URL.");
}

async function recoverAndSyncLegacyQueues() {
  const db=getSupabaseClient();
  const stale=new Date(Date.now()-15*60*1000).toISOString();
  const recovery=await Promise.all([
    db.from("workbench_tasks").update({status:"pending",locked_at:null,locked_by:null}).eq("status","running").lt("locked_at",stale),
    db.from("workbench_tasks").update({status:"pending",locked_at:null,locked_by:null}).eq("status","running").is("locked_at",null),
    db.from("lead_pipeline_jobs").update({status:"pending",locked_at:null,locked_by:null}).eq("status","processing").lt("locked_at",stale),
    db.from("lead_pipeline_jobs").update({status:"pending",locked_at:null,locked_by:null}).eq("status","processing").is("locked_at",null)
  ]);
  const recoveryError=recovery.find(x=>x.error);
  if(recoveryError) throw recoveryError.error;

  const [workbench,leads]=await Promise.all([
    db.from("workbench_tasks").select("id,task_type,prompt,client_id,lead_id,attempts,status")
      .eq("status","pending").order("created_at",{ascending:true}).limit(50),
    db.from("lead_pipeline_jobs").select("id,lead_id,stage,attempts,status")
      .eq("status","pending").order("created_at",{ascending:true}).limit(50)
  ]);
  if(workbench.error) throw workbench.error;
  if(leads.error) throw leads.error;
  const tasks=[];
  for(const row of workbench.data||[]) tasks.push({
    agent_id:"workbench",task_type:"workbench",
    payload:{prompt:row.prompt,taskType:row.task_type,clientId:row.client_id,leadId:row.lead_id},
    priority:100,attempts:Math.min(Number(row.attempts)||0,2),max_attempts:3,
    source_queue:"workbench_tasks",source_task_id:row.id,
    idempotency_key:"legacy:workbench:"+row.id
  });
  for(const row of leads.data||[]) {
    const agentId=["draft_generation_pending","generating_draft"].includes(row.stage)
      ?"outreach":row.stage==="review_completed"?"lead_reviewer":"research";
    tasks.push({
      agent_id:agentId,task_type:agentId,
      payload:{leadId:row.lead_id,stage:row.stage,leadPipelineJobId:row.id},
      priority:100,attempts:Math.min(Number(row.attempts)||0,2),max_attempts:3,
      source_queue:"lead_pipeline_jobs",source_task_id:row.id,
      idempotency_key:"legacy:lead:"+row.id
    });
  }
  if(tasks.length) {
    const {error}=await db.from("agent_tasks").upsert(tasks,{onConflict:"idempotency_key",ignoreDuplicates:true});
    if(error) throw error;
  }

  const {data:terminal,error:terminalError}=await db.from("agent_tasks")
    .select("id,source_queue,source_task_id,status,output,error,payload,task_type")
    .in("status",["completed","failed"]).not("source_queue","is",null)
    .order("updated_at",{ascending:false}).limit(100);
  if(terminalError) throw terminalError;
  for(const task of terminal||[]) await updateLegacyTask(task,task.status,task.output,task.error);
  return tasks.length;
}

async function updateLegacyTask(task,status,output=null,errorMessage=null) {
  const db=getSupabaseClient();
  if(task.source_queue==="workbench_tasks"&&task.source_task_id) {
    const patch={status,locked_at:null,locked_by:null};
    if(status==="running") {patch.locked_at=new Date().toISOString();patch.locked_by=WORKER_ID;}
    if(status==="completed") {
      patch.result=output?.result||"";
      patch.task_type=output?.taskType||task.payload?.taskType||"research";
      patch.error_message=null;
      patch.metadata=output?.artifact?{
        artifact_type:output.artifact.type,
        artifact_path:output.artifact.path,
        artifact_note:output.artifact.note||""
      }:{};
    } else if(errorMessage) patch.error_message=errorMessage;
    const {error}=await db.from("workbench_tasks").update(patch).eq("id",task.source_task_id);
    if(error) throw error;
  }
  if(task.source_queue==="lead_pipeline_jobs"&&task.source_task_id) {
    const legacyStatus=status==="completed"?"completed":status==="failed"?"failed":status==="running"?"processing":"pending";
    const patch={status:legacyStatus,locked_at:null,locked_by:null,error_message:errorMessage};
    if(status==="completed"&&output?.needsReview) patch.stage="review_completed";
    if(status==="running") {patch.locked_at=new Date().toISOString();patch.locked_by=WORKER_ID;}
    const {error}=await db.from("lead_pipeline_jobs").update(patch).eq("id",task.source_task_id);
    if(error) throw error;
  }
}

async function runTask(task,runId) {
  const oldRun=process.env.AGENT_RUN_ID;
  const oldAgent=process.env.AGENT_ID;
  process.env.AGENT_RUN_ID=runId;
  process.env.AGENT_ID=task.agent_id;
  try {
    const {installUsageTrackingFetch}=require("../src/services/agentUsageService");
    installUsageTrackingFetch();
    const {runSpecialistTask}=require("../src/agents/specialistAgents");
    return await runSpecialistTask(task);
  } finally {
    if(oldRun===undefined) delete process.env.AGENT_RUN_ID; else process.env.AGENT_RUN_ID=oldRun;
    if(oldAgent===undefined) delete process.env.AGENT_ID; else process.env.AGENT_ID=oldAgent;
  }
}

async function run() {
  validateConfig();
  const supabase = getSupabaseClient();
  const started = Date.now();
  const schedule = await getSchedule();
  if (!schedule.enabled) {
    console.log("Autonomous system is paused; exiting without processing.");
    return { skipped: true, disabled: true };
  }
  if (process.env.AGENT_FORCE_RUN !== "true" && new Date(schedule.next_run_at).getTime() > Date.now()) {
    console.log("No autonomous cycle due; exiting without processing.");
    return { skipped: true };
  }

  const locked = await acquireLock(WORKER_ID, Math.ceil(MAX_RUNTIME_SECONDS + 120));
  if (!locked) {
    console.log("Another runner owns the scheduler lease; exiting.");
    return { skipped: true, locked: true };
  }

  let runRecord;
  let processed = 0, completed = 0, failed = 0;
  try {
    const { data, error } = await supabase.from("agent_runs").insert({
      trigger_type: process.env.AGENT_TRIGGER === "workflow_dispatch" || process.env.AGENT_TRIGGER === "manual" || process.env.AGENT_FORCE_RUN === "true" ? "manual" : "schedule",
      status: "running",
      metadata: { worker_id: WORKER_ID, github_run_id: process.env.GITHUB_RUN_ID || null }
    }).select().single();
    if (error) throw error;
    runRecord = data;

    await writeLog({ runId: runRecord.id, eventType: "run_started", message: "Autonomous execution cycle started.", metadata: { workerId: WORKER_ID } });
    const recovered = await recoverExpiredTasks();
    if (recovered) await writeLog({ runId: runRecord.id, severity: "warn", eventType: "tasks_recovered", message: "Recovered " + recovered + " expired task lease(s)." });
    const bridged = await recoverAndSyncLegacyQueues();
    if (bridged) await writeLog({runId:runRecord.id,eventType:"legacy_queues_bridged",message:"Mirrored "+bridged+" legacy task(s) into autonomous execution."});

    while (!stopping && processed < Math.min(MAX_TASKS, Number(schedule.max_tasks_per_run || MAX_TASKS))
      && (Date.now() - started) < Math.min(MAX_RUNTIME_SECONDS, Number(schedule.max_runtime_seconds || MAX_RUNTIME_SECONDS)) * 1000) {
      const task = await claimTask(WORKER_ID, Math.ceil(MAX_RUNTIME_SECONDS + 120));
      if (!task) break;
      processed += 1;
      try {
        await writeLog({ runId: runRecord.id, agentId: task.agent_id, taskId: task.id, eventType: "task_started", message: `Started ${task.task_type} task.` });
        const {error:runLinkError}=await getSupabaseClient().from("agent_tasks")
          .update({run_id:runRecord.id,updated_at:new Date().toISOString()})
          .eq("id",task.id).eq("status","running").eq("locked_by",WORKER_ID);
        if(runLinkError) throw runLinkError;
        task.run_id=runRecord.id;
        await updateLegacyTask(task,"running");
        const output = await runTask(task, runRecord.id);
        await finishTask(task, WORKER_ID, output);
        completed += 1;
        try {
          await updateLegacyTask(task,"completed",output);
        } catch (mirrorError) {
          await writeLog({runId:runRecord.id,agentId:task.agent_id,taskId:task.id,severity:"warn",eventType:"legacy_queue_sync_failed",message:String(mirrorError.message||mirrorError).slice(0,500)});
        }
        await writeLog({ runId: runRecord.id, agentId: task.agent_id, taskId: task.id, eventType: "task_completed", message: "Task completed." });
      } catch (err) {
        failed += 1;
        await failTask(task, WORKER_ID, err);
        try {
          await updateLegacyTask(task,Number(task.attempts)>=Number(task.max_attempts)?"failed":"pending",null,String(err.message||err).slice(0,1000));
        } catch (mirrorError) {
          console.warn("Legacy queue mirror update failed:",mirrorError.message);
        }
        await writeLog({ runId: runRecord.id, agentId: task.agent_id, taskId: task.id, severity: "error", eventType: "task_failed", message: String(err.message || err).slice(0, 1000) });
      }
    }

    const status = failed === 0 ? "completed" : (completed > 0 ? "partial" : "failed");
    const finishedAt = new Date().toISOString();
    const { error: updateError } = await supabase.from("agent_runs").update({
      status, finished_at: finishedAt, tasks_processed: processed, tasks_completed: completed, tasks_failed: failed,
      error_summary: failed ? `${failed} task(s) failed; see run logs.` : null
    }).eq("id", runRecord.id);
    if (updateError) throw updateError;

    if (process.env.AGENT_FORCE_RUN !== "true") {
      const interval = Math.max(60, Number(schedule.interval_minutes || 300));
      const { error: scheduleError } = await supabase.from("agent_schedules").update({
        last_run_at: finishedAt, next_run_at: new Date(Date.now() + interval * 60000).toISOString()
      }).eq("schedule_id", "primary");
      if (scheduleError) throw scheduleError;
    }
    console.log(JSON.stringify({ runId: runRecord.id, status, processed, completed, failed }));
    if (failed > 0 && completed === 0) process.exitCode = 1;
    return { runId: runRecord.id, status, processed, completed, failed };
  } finally {
    await releaseLock(WORKER_ID);
  }
}

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

if (require.main === module) {
  run().catch((err) => {
    console.error("Autonomous runner failed:", String(err.message || err).replace(/(key|token|secret)=?[^\s]*/gi, "$1=[REDACTED]"));
    process.exitCode = 1;
  });
}

module.exports = { run, validateConfig, recoverAndSyncLegacyQueues, updateLegacyTask };
