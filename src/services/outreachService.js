const { getSupabaseClient, isSupabaseConfigured } = require("../config/supabase");
const { generateOutreachDraft, classifyProspectReply } = require("../agents/outreachAgent");
const { getLeadById, updateLead } = require("./leadsService");
const { getResearchByLeadId } = require("./researchService");
const { createApprovalRequest, claimApprovalForExecution, markApprovalExecuted } = require("./approvalService");
const { sendOutboundEmail } = require("./smtpService");
const { logActivity } = require("./activityService");

async function listOutreachRecords(filters = {}) {
  if (!isSupabaseConfigured()) {
    return { records: [], total: 0 };
  }

  let query = getSupabaseClient().from("outreach_records").select("*, leads(business_name, contact_name, email)", { count: "exact" });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.lead_id) query = query.eq("lead_id", filters.lead_id);

  const limit = Math.min(Number(filters.limit) || 50, 100);
  query = query.order("created_at", { ascending: false }).limit(limit);

  const { data, error, count } = await query;
  if (error) throw error;
  return { records: data || [], total: count || 0 };
}

async function getOutreachById(id) {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient().from("outreach_records").select("*, leads(*)").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

async function draftOutreachForLead(leadId, options = {}) {
  const lead = await getLeadById(leadId);
  if (!lead) throw new Error("Lead not found.");
  if (!lead.email) throw new Error("Lead does not have an email address specified.");

  const research = await getResearchByLeadId(leadId);
  const emailBrief = typeof options.emailBrief === "string" ? options.emailBrief.trim() : "";\n  const draft = await generateOutreachDraft(lead, research, emailBrief);

  const recordPayload = {
    lead_id: leadId,
    channel: "email",
    recipient: lead.email,
    subject: draft.subject,
    message_body: draft.body,
    email_brief: emailBrief || null,
    status: "draft"
  };

  if (!isSupabaseConfigured()) {
    return { id: "mock-outreach-" + Date.now(), ...recordPayload, ...draft, created_at: new Date().toISOString() };
  }

  const { data, error } = await getSupabaseClient()
    .from("outreach_records")
    .insert(recordPayload)
    .select()
    .single();

  if (error) throw error;

  await logActivity("outreach_drafted", `Drafted outreach for ${lead.business_name} (${lead.email})`, {
    entityType: "outreach",
    entityId: data.id,
    metadata: { leadId, subject: draft.subject }
  });

  return { ...data, alternative_subjects: draft.subject_lines, angle: draft.angle };
}

async function requestOutreachApproval(outreachId) {
  const record = await getOutreachById(outreachId);
  if (!record) throw new Error("Outreach record not found.");
  if (record.status === "sent") throw new Error("This email has already been sent.");

  const approval = await createApprovalRequest({
    action_type: "send_email",
    entity_type: "outreach",
    entity_id: outreachId,
    title: `Send Cold Outreach to ${record.recipient}`,
    summary: `Subject: "${record.subject}" for lead ${record.leads?.business_name || record.lead_id}`,
    payload: {
      to: record.recipient,
      subject: record.subject,
      body: record.message_body
    }
  });

  if (isSupabaseConfigured()) {
    await getSupabaseClient()
      .from("outreach_records")
      .update({ status: "draft" })
      .eq("id", outreachId);
  }

  return approval;
}

async function sendApprovedOutreach(outreachId) {
  const record = await getOutreachById(outreachId);
  if (!record) throw new Error("Outreach record not found.");

  // Duplicate-send protection
  if (record.status === "sent") {
    throw new Error("Duplicate send prevented: This email was already marked as sent.");
  }

  // Atomically consume the approved decision before calling SMTP.
  const approval = await claimApprovalForExecution("outreach", outreachId, "send_email", { to: record.recipient, subject: record.subject, body: record.message_body });
  if (!approval) throw new Error("Backend Approval Error: no current, matching administrator approval exists for this email.");

  try {
    const sendResult = await sendOutboundEmail({
      to: record.recipient,
      subject: record.subject,
      text: record.message_body
    });

    const now = new Date().toISOString();
    let updatedRecord = record;

    if (isSupabaseConfigured()) {
      const { data, error } = await getSupabaseClient()
        .from("outreach_records")
        .update({
          status: "sent",
          sent_at: now
        })
        .eq("id", outreachId)
        .select()
        .single();
      if (error) throw error;
      updatedRecord = data;

      // Update lead status to contacted
      await updateLead(record.lead_id, { lead_status: "contacted" });

      await markApprovalExecuted(approval.id, sendResult);
    }

    return {
      success: true,
      record: updatedRecord,
      sendResult
    };
  } catch (err) {
    if (isSupabaseConfigured()) {
      // Keep the approval claim locked: SMTP may have accepted the message before a timeout.
      await getSupabaseClient().from("outreach_records").update({ status: "failed", error_message: err.message }).eq("id", outreachId);
    }
    throw err;
  }
}

async function recordAndClassifyReply(outreachId, replyContent) {
  const record = await getOutreachById(outreachId);
  if (!record) throw new Error("Outreach record not found.");
  if (!replyContent || !replyContent.trim()) throw new Error("Reply content cannot be empty.");

  const analysis = await classifyProspectReply(record, replyContent.trim());
  const now = new Date().toISOString();

  const updates = {
    status: "replied",
    reply_content: replyContent.trim(),
    reply_sentiment: analysis.classification,
    reply_received_at: now,
    follow_up_recommendation: analysis.suggested_follow_up || analysis.recommended_action
  };

  let updatedRecord = { ...record, ...updates };

  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabaseClient()
      .from("outreach_records")
      .update(updates)
      .eq("id", outreachId)
      .select()
      .single();
    if (error) throw error;
    updatedRecord = data;

    await updateLead(record.lead_id, {
      lead_status: analysis.classification === "not_interested" ? "disqualified" : "replied"
    });

    await logActivity("prospect_replied", `Reply recorded from ${record.recipient} (${analysis.classification})`, {
      entityType: "outreach",
      entityId: outreachId,
      metadata: { classification: analysis.classification }
    });
  }

  return {
    record: updatedRecord,
    analysis
  };
}

module.exports = {
  listOutreachRecords,
  getOutreachById,
  draftOutreachForLead,
  requestOutreachApproval,
  sendApprovedOutreach,
  recordAndClassifyReply
};
