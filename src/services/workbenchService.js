const { getSupabaseClient, isSupabaseConfigured } = require("../config/supabase");
const { classifyTaskPrompt, executeTask } = require("../agents/orchestrator");
const { logActivity } = require("./activityService");

const WORKER_ID = `workbench-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const POLL_INTERVAL_MS = 5000;
const STALE_AFTER_MS = 2 * 60 * 1000;
let workerTimer = null;
let workerBusy = false;

async function listWorkbenchTasks(limit = 20) {
  if (!isSupabaseConfigured()) return { tasks: [], total: 0 };
  const { data, error, count } = await getSupabaseClient()
    .from("workbench_tasks")
    .select("*, clients(name, company)", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 100));
  if (error) throw error;
  return { tasks: data || [], total: count || 0 };
}

async function getWorkbenchTaskById(id) {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient().from("workbench_tasks")
    .select("*, clients(*)").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

// Enqueue only. AI classification and execution happen in the backend worker.
async function runWorkbenchTask({ prompt, taskType, clientId = null, leadId = null }) {
  if (!prompt || !prompt.trim()) throw new Error("Task prompt cannot be empty.");
  if (!isSupabaseConfigured()) {
    throw new Error("Persistent background tasks require Supabase to be configured.");
  }
  const initialRecord = {
    task_type: taskType || "marketing_strategy",
    prompt: prompt.trim(),
    client_id: clientId || null,
    lead_id: leadId || null,
    status: "pending",
    attempts: 0
  };
  const { data, error } = await getSupabaseClient()
    .from("workbench_tasks").insert(initialRecord).select().single();
  if (error) throw error;
  await logActivity("workbench_task_queued", `Queued Workbench task: ${initialRecord.task_type}`, {
    entityType: "workbench", entityId: data.id
  });
  kickWorkbenchWorker();
  return data;
}

async function claimNextWorkbenchTask() {
  const supabase = getSupabaseClient();
  const { data: candidates, error } = await supabase.from("workbench_tasks")
    .select("id, task_type, prompt, client_id, lead_id, attempts")
    .eq("status", "pending").order("created_at", { ascending: true }).limit(1);
  if (error) throw error;
  if (!candidates?.length) return null;
  const candidate = candidates[0];
  const { data: claimed, error: claimError } = await supabase.from("workbench_tasks")
    .update({ status: "running", locked_at: new Date().toISOString(), locked_by: WORKER_ID,
      attempts: (candidate.attempts || 0) + 1 })
    .eq("id", candidate.id).eq("status", "pending").select().maybeSingle();
  if (claimError) throw claimError;
  return claimed || null;
}

async function executeWorkbenchTask(task) {
  const supabase = getSupabaseClient();
  try {
    let resolvedType = task.task_type;
    if (!resolvedType || resolvedType === "auto") {
      try {
        const classification = await classifyTaskPrompt(task.prompt);
        resolvedType = classification.task_type || "smma_proposal";
      } catch {
        resolvedType = "marketing_strategy";
      }
    }
    const { result, artifact } = await executeTask({
      taskType: resolvedType, prompt: task.prompt,
      clientId: task.client_id, leadId: task.lead_id
    });
    const updatePayload = {
      task_type: resolvedType,
      status: "completed",
      result,
      error_message: null,
      locked_at: null,
      locked_by: null,
      metadata: artifact ? { artifact_type: artifact.type, artifact_path: artifact.path,
        artifact_note: artifact.note || "" } : {}
    };
    const { error } = await supabase.from("workbench_tasks").update(updatePayload).eq("id", task.id);
    if (error) throw error;
    await logActivity("workbench_task_completed", `Completed Workbench task: ${resolvedType}`, {
      entityType: "workbench", entityId: task.id, metadata: { taskType: resolvedType }
    });
  } catch (err) {
    await supabase.from("workbench_tasks").update({
      status: "failed", error_message: err.message, locked_at: null, locked_by: null
    }).eq("id", task.id);
    await logActivity("workbench_task_failed", `Workbench task failed: ${err.message}`, {
      entityType: "workbench", entityId: task.id
    });
    console.error(`Workbench task ${task.id} failed:`, err.message);
  }
}

async function processWorkbenchQueue() {
  if (workerBusy || !isSupabaseConfigured()) return;
  workerBusy = true;
  try {
    const task = await claimNextWorkbenchTask();
    if (task) await executeWorkbenchTask(task);
  } catch (err) {
    console.error("Workbench worker error:", err.message);
  } finally {
    workerBusy = false;
  }
}

async function recoverWorkbenchTasks() {
  if (!isSupabaseConfigured()) return;
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const { error } = await getSupabaseClient().from("workbench_tasks")
    .update({ status: "pending", locked_at: null, locked_by: null })
    .eq("status", "running").lt("locked_at", cutoff);
  if (error) console.warn("Could not recover interrupted Workbench tasks:", error.message);
}

function kickWorkbenchWorker() {
  if (workerTimer) return;
  workerTimer = setTimeout(() => {
    workerTimer = null;
    processWorkbenchQueue();
  }, 50);
}

function startWorkbenchWorker() {
  if (workerTimer) return;
  recoverWorkbenchTasks().finally(() => {
    workerTimer = setInterval(processWorkbenchQueue, POLL_INTERVAL_MS);
    if (typeof workerTimer.unref === "function") workerTimer.unref();
    processWorkbenchQueue();
  });
}

module.exports = {
  listWorkbenchTasks,
  getWorkbenchTaskById,
  runWorkbenchTask,
  startWorkbenchWorker,
  recoverWorkbenchTasks,
  processWorkbenchQueue
};
