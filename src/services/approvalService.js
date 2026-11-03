const { getSupabaseClient, isSupabaseConfigured } = require("../config/supabase");
const { logActivity } = require("./activityService");

async function createApprovalRequest({ action_type, entity_type, entity_id, title, summary, payload }) {
  if (!action_type || !entity_type || !entity_id || !title) throw new Error("Missing required approval request fields.");
  const record = { action_type, entity_type, entity_id, title, summary: summary || "", payload: payload || {}, status: "pending" };
  if (!isSupabaseConfigured()) return { id: "mock-approval-" + Date.now(), ...record, created_at: new Date().toISOString() };
  const { data, error } = await getSupabaseClient().from("approvals").insert(record).select().single();
  if (error) throw error;
  await logActivity("approval_created", `Approval requested: ${title}`, { entityType: entity_type, entityId: entity_id, metadata: { approvalId: data.id, actionType: action_type } });
  return data;
}
async function listApprovals(filters = {}) {
  if (!isSupabaseConfigured()) return { approvals: [], total: 0 };
  let query = getSupabaseClient().from("approvals").select("*", { count: "exact" });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.entity_type) query = query.eq("entity_type", filters.entity_type);
  query = query.order("created_at", { ascending: false }).limit(Math.min(Number(filters.limit) || 50, 100));
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
  if (!["approved", "rejected"].includes(decision)) throw new Error("Decision must be either 'approved' or 'rejected'.");
  if (!isSupabaseConfigured()) throw new Error("Approval decisions require a configured database.");
  const { data, error } = await getSupabaseClient().from("approvals")
    .update({ status: decision, decision_notes: decisionNotes || null, decided_at: new Date().toISOString() })
    .eq("id", id).eq("status", "pending").select().maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Approval is no longer pending and cannot be changed.");
  await logActivity(`approval_${decision}`, `Approval ${decision}: ${data.title}`, { entityType: data.entity_type, entityId: data.entity_id, metadata: { approvalId: id, decision } });
  return data;
}
// Compare-and-set prevents concurrent requests from using the same approval.
async function claimApprovalForExecution(entityType, entityId, actionType) {
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseClient();
  const { data: candidate, error: readError } = await client.from("approvals").select("id")
    .eq("entity_type", entityType).eq("entity_id", entityId).eq("action_type", actionType)
    .eq("status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (readError) throw readError;
  if (!candidate) return null;
  const { data, error } = await client.from("approvals").update({ status: "executing" })
    .eq("id", candidate.id).eq("status", "approved").select().maybeSingle();
  if (error) throw error;
  return data || null;
}
async function markApprovalExecuted(id, executionResult = {}) {
  if (!isSupabaseConfigured()) throw new Error("Cannot record external action without a configured database.");
  const { data, error } = await getSupabaseClient().from("approvals")
    .update({ status: "executed", executed_at: new Date().toISOString(), execution_result: executionResult })
    .eq("id", id).eq("status", "executing").select().maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Approval execution claim was lost; manual reconciliation is required.");
  return data;
}
async function verifyApprovalGranted(entityType, entityId, actionType) {
  if (!isSupabaseConfigured()) return false;
  const { data, error } = await getSupabaseClient().from("approvals").select("id")
    .eq("entity_type", entityType).eq("entity_id", entityId).eq("action_type", actionType)
    .eq("status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
module.exports = { createApprovalRequest, listApprovals, getApprovalById, updateApprovalDecision, claimApprovalForExecution, markApprovalExecuted, verifyApprovalGranted };
