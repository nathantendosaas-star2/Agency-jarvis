const { getSupabaseClient } = require("../config/supabase");

const LOCK_ID = "agency-jarvis-scheduler";

async function writeLog({ runId = null, agentId = null, taskId = null, severity = "info", eventType, message, metadata = {} }) {
  const { error } = await getSupabaseClient().from("agent_run_logs").insert({
    run_id: runId, agent_id: agentId, task_id: taskId, severity, event_type: eventType, message, metadata
  });
  if (error) throw error;
}

async function getSchedule() {
  const { data, error } = await getSupabaseClient().from("agent_schedules")
    .select("*").eq("schedule_id", "primary").single();
  if (error) throw error;
  return data;
}

async function acquireLock(owner, leaseSeconds = 600) {
  const { data, error } = await getSupabaseClient().rpc("acquire_agent_lock", {
    p_lock_id: LOCK_ID, p_owner: owner, p_lease_seconds: leaseSeconds
  });
  if (error) throw error;
  return data === true;
}

async function releaseLock(owner) {
  const { error } = await getSupabaseClient().rpc("release_agent_lock", {
    p_lock_id: LOCK_ID, p_owner: owner
  });
  if (error) throw error;
}

async function claimTask(workerId, leaseSeconds = 300) {
  const { data, error } = await getSupabaseClient().rpc("claim_agent_task", {
    p_worker: workerId, p_lease_seconds: leaseSeconds
  });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : data;
}

async function finishTask(task, workerId, output) {
  const { data, error } = await getSupabaseClient().from("agent_tasks").update({
    status: "completed", output, error: null, completed_at: new Date().toISOString(),
    locked_at: null, locked_by: null, lease_expires_at: null, updated_at: new Date().toISOString()
  }).eq("id", task.id).eq("status", "running").eq("locked_by", workerId).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Task lease lost before completion could be persisted.");
}

async function failTask(task, workerId, err) {
  const exhausted = Number(task.attempts) >= Number(task.max_attempts);
  const delaySeconds = Math.min(3600, 15 * (2 ** Math.min(Number(task.attempts) || 1, 8)));
  const { error } = await getSupabaseClient().from("agent_tasks").update({
    status: exhausted ? "failed" : "pending",
    error: String(err.message || err).slice(0, 4000),
    next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
    locked_at: null, locked_by: null, lease_expires_at: null, updated_at: new Date().toISOString()
  }).eq("id", task.id).eq("status", "running").eq("locked_by", workerId);
  if (error) throw error;
}

module.exports = { LOCK_ID, writeLog, getSchedule, acquireLock, releaseLock, claimTask, finishTask, failTask };
