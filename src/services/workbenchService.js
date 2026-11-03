const { getSupabaseClient, isSupabaseConfigured } = require("../config/supabase");
const { classifyTaskPrompt, executeTask } = require("../agents/orchestrator");
const { logActivity } = require("./activityService");

async function listWorkbenchTasks(limit = 20) {
  if (!isSupabaseConfigured()) {
    return { tasks: [], total: 0 };
  }

  const { data, error, count } = await getSupabaseClient()
    .from("workbench_tasks")
    .select("*, clients(name, company)", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return { tasks: data || [], total: count || 0 };
}

async function getWorkbenchTaskById(id) {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient().from("workbench_tasks").select("*, clients(*)").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function runWorkbenchTask({ prompt, taskType, clientId = null, leadId = null }) {
  if (!prompt || !prompt.trim()) {
    throw new Error("Task prompt cannot be empty.");
  }

  // Auto-classify task type if not specified
  let resolvedType = taskType;
  if (!resolvedType) {
    try {
      const classification = await classifyTaskPrompt(prompt);
      resolvedType = classification.task_type || "smma_proposal";
    } catch {
      resolvedType = "marketing_strategy";
    }
  }

  const initialRecord = {
    task_type: resolvedType,
    prompt: prompt.trim(),
    client_id: clientId || null,
    lead_id: leadId || null,
    status: "running"
  };

  let savedTask = null;
  if (isSupabaseConfigured()) {
    const { data } = await getSupabaseClient().from("workbench_tasks").insert(initialRecord).select().single();
    savedTask = data;
  } else {
    savedTask = { id: "mock-task-" + Date.now(), ...initialRecord, created_at: new Date().toISOString() };
  }

  try {
    const { result } = await executeTask({
      taskType: resolvedType,
      prompt,
      clientId,
      leadId
    });

    const updatePayload = {
      status: "completed",
      result: result
    };

    if (isSupabaseConfigured() && savedTask?.id) {
      const { data } = await getSupabaseClient()
        .from("workbench_tasks")
        .update(updatePayload)
        .eq("id", savedTask.id)
        .select()
        .single();
      savedTask = data;
    } else {
      savedTask = { ...savedTask, ...updatePayload };
    }

    await logActivity("workbench_task_completed", `Completed Workbench task: ${resolvedType}`, {
      entityType: "workbench",
      entityId: savedTask.id,
      metadata: { taskType: resolvedType }
    });

    return savedTask;
  } catch (err) {
    if (isSupabaseConfigured() && savedTask?.id) {
      await getSupabaseClient()
        .from("workbench_tasks")
        .update({ status: "failed", error_message: err.message })
        .eq("id", savedTask.id);
    }
    throw err;
  }
}

module.exports = {
  listWorkbenchTasks,
  getWorkbenchTaskById,
  runWorkbenchTask
};
