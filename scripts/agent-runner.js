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

async function runTask(task, runId) {
  const agentId = task.agent_id;
  if (task.task_type === "workbench") {
    const { executeTask, classifyTaskPrompt } = require("../src/agents/orchestrator");
    const payload = task.payload || {};
    const prompt = String(payload.prompt || "");
    if (!prompt.trim()) throw new Error("Workbench task payload.prompt is required.");
    let taskType = payload.taskType || payload.task_type || "auto";
    if (taskType === "auto") {
      const classified = await classifyTaskPrompt(prompt);
      taskType = classified.task_type;
    }
    const result = await executeTask({ taskType, prompt, clientId: payload.clientId || null, leadId: payload.leadId || null });
    return { taskType, result: result.result, artifact: result.artifact || null };
  }
  if (task.task_type === "lead_pipeline") {
    const { processLeadAutonomousWorkflow } = require("../src/services/leadPipelineService");
    const leadId = task.payload && task.payload.leadId;
    if (!leadId) throw new Error("lead_pipeline payload.leadId is required.");
    return await processLeadAutonomousWorkflow(leadId, task.payload.stage || "research_pending");
  }
  if (task.task_type === "health_check") {
    const { data, error } = await getSupabaseClient().from("agent_definitions").select("agent_id,enabled");
    if (error) throw error;
    return { agents: data || [], checked_at: new Date().toISOString() };
  }
  throw new Error(`Unsupported autonomous task type "${task.task_type}" for agent "${agentId}".`);
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

    while (!stopping && processed < Math.min(MAX_TASKS, Number(schedule.max_tasks_per_run || MAX_TASKS))
      && (Date.now() - started) < Math.min(MAX_RUNTIME_SECONDS, Number(schedule.max_runtime_seconds || MAX_RUNTIME_SECONDS)) * 1000) {
      const task = await claimTask(WORKER_ID, Math.ceil(MAX_RUNTIME_SECONDS + 120));
      if (!task) break;
      processed += 1;
      try {
        await writeLog({ runId: runRecord.id, agentId: task.agent_id, taskId: task.id, eventType: "task_started", message: `Started ${task.task_type} task.` });
        const output = await runTask(task, runRecord.id);
        await finishTask(task, WORKER_ID, output);
        completed += 1;
        await writeLog({ runId: runRecord.id, agentId: task.agent_id, taskId: task.id, eventType: "task_completed", message: "Task completed." });
      } catch (err) {
        failed += 1;
        await failTask(task, WORKER_ID, err);
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

module.exports = { run, validateConfig };
