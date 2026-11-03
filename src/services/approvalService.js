const { getSupabaseClient, isSupabaseConfigured } = require("../config/supabase");
const { logActivity } = require("./activityService");

async function createApprovalRequest({ action_type, entity_type, entity_id, title, summary, payload }) {
  if (!action_type || !entity_type || !entity_id || !title) {
    throw new Error("Missing required approval request fields.");
  }

  const record = {
    action_type,
    entity_type,
    entity_id,
    title,
    summary: summary || "",
    payload: payload || {},
    status: "pending"
  };

  if (!isSupabaseConfigured()) {
    return {
      id: "mock-approval-" + Date.now(),
      ...record,
      created_at: new Date().toISOString()
    };
  }

  const { data, error } = await getSupabaseClient()
    .from("approvals")
    .insert(record)
    .select()
    .single();

  if (error) throw error;

  await logActivity("approval_created", `Approval requested: ${title}`, {
    entityType: entity_type,
    entityId: entity_id,
    metadata: { approvalId: data.id, actionType: action_type }
  });

  return data;
}

async function listApprovals(filters = {}) {
  if (!isSupabaseConfigured()) {
    return { approvals: [], total: 0 };
  }

  let query = getSupabaseClient().from("approvals").select("*", { count: "exact" });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.entity_type) query = query.eq("entity_type", filters.entity_type);

  const limit = Math.min(Number(filters.limit) || 50, 100);
  query = query.order("created_at", { ascending: false }).limit(limit);

  const { data, error, count } = await query;
  if (error) throw error;
  return { approvals: data || [], total: count || (data ? data.length : 0) };
}

async function getApprovalById(id) {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient().from("approvals").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function updateApprovalDecision(id, decision, decisionNotes = "") {
  if (!["approved", "rejected"].includes(decision)) {
    throw new Error("Decision must be either 'approved' or 'rejected'.");
  }

  const updates = {
    status: decision,
    decision_notes: decisionNotes || null,
    decided_at: new Date().toISOString()
  };

  if (!isSupabaseConfigured()) {
    return { id, ...updates };
  }

  const { data, error } = await getSupabaseClient()
    .from("approvals")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  await logActivity(`approval_${decision}`, `Approval ${decision}: ${data.title}`, {
    entityType: data.entity_type,
    entityId: data.entity_id,
    metadata: { approvalId: id, decision }
  });

  return data;
}

async function markApprovalExecuted(id, executionResult = {}) {
  const updates = {
    status: "executed",
    executed_at: new Date().toISOString(),
    execution_result: executionResult
  };

  if (!isSupabaseConfigured()) {
    return { id, ...updates };
  }

  const { data, error } = await getSupabaseClient()
    .from("approvals")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Backend check: Checks whether an entity has explicit approval
async function verifyApprovalGranted(entityType, entityId, actionType) {
  if (!isSupabaseConfigured()) {
    return true; // When Supabase not configured in development, bypass or mock
  }

  const { data, error } = await getSupabaseClient()
    .from("approvals")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("action_type", actionType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return false;
  return data.status === "approved" || data.status === "executed";
}

module.exports = {
  createApprovalRequest,
  listApprovals,
  getApprovalById,
  updateApprovalDecision,
  markApprovalExecuted,
  verifyApprovalGranted
};
