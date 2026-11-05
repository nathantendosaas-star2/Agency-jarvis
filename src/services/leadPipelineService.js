const { getSupabaseClient, isSupabaseConfigured } = require("../config/supabase");
const { getLeadById, updateLead } = require("./leadsService");
const { saveLeadResearch, getResearchByLeadId } = require("./researchService");
const { researchBusinessWithTavily } = require("./tavilyService");
const { evaluateLeadWithOpenRouter } = require("./openrouterService");
const { generateOutreachDraft } = require("../agents/outreachAgent");
const { logActivity } = require("./activityService");

const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
let isQueueProcessing = false;
let queueTimeoutId = null;

/**
 * Enqueue a lead into the autonomous processing pipeline.
 */
async function enqueueLeadJob(leadId, stage = "research_pending") {
  if (!leadId) throw new Error("leadId is required to enqueue job.");

  // Update lead status in leads table
  await updateLead(leadId, {
    processing_stage: stage,
    processing_error: null
  });

  if (!isSupabaseConfigured()) {
    // In-memory / test fallback
    setImmediate(() => processNextLeadJob().catch((err) => console.error("Pipeline worker error:", err.message)));
    return { id: `mock-job-${Date.now()}`, lead_id: leadId, stage, status: "pending" };
  }

  const supabase = getSupabaseClient();
  // Check if job already pending for this lead
  const { data: existing } = await supabase
    .from("lead_pipeline_jobs")
    .select("id,status")
    .eq("lead_id", leadId)
    .in("status", ["pending", "processing"])
    .maybeSingle();

  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from("lead_pipeline_jobs")
    .insert({
      lead_id: leadId,
      stage,
      status: "pending",
      attempts: 0
    })
    .select()
    .single();

  if (error) throw error;

  await logActivity("pipeline_job_enqueued", `Enqueued lead ${leadId} for autonomous processing (${stage})`, {
    entityType: "leads",
    entityId: leadId,
    metadata: { stage, jobId: data.id }
  });

  // Trigger worker check
  triggerQueueWorker();
  return data;
}

/**
 * Triggers the background worker with debouncing
 */
function triggerQueueWorker() {
  if (queueTimeoutId) clearTimeout(queueTimeoutId);
  queueTimeoutId = setTimeout(() => {
    processNextLeadJob().catch((err) => console.error("Worker processing error:", err.message));
  }, 100);
}

/**
 * Recover any jobs that were abandoned or processing during a server restart.
 */
async function recoverPendingJobs() {
  if (!isSupabaseConfigured()) return { recovered: 0 };
  const supabase = getSupabaseClient();

  // Reset jobs that were locked/processing for over 5 minutes or uncompleted
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("lead_pipeline_jobs")
    .update({
      status: "pending",
      locked_at: null,
      locked_by: null
    })
    .eq("status", "processing")
    .lt("locked_at", fiveMinutesAgo)
    .select();

  if (error) {
    console.warn("Could not recover stale processing jobs:", error.message);
    return { recovered: 0 };
  }

  // Check if any pending jobs exist that need processing
  const { count: pendingCount } = await supabase
    .from("lead_pipeline_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const recoveredCount = data ? data.length : 0;
  if (recoveredCount > 0 || (pendingCount && pendingCount > 0)) {
    console.log(`Recovered ${recoveredCount} interrupted jobs (${pendingCount || 0} pending in queue).`);
    triggerQueueWorker();
  }
  return { recovered: recoveredCount };
}

/**
 * Claim the next available job atomically using compare-and-set locking
 */
async function claimNextJob() {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();

  // Find candidate pending job
  const { data: candidates, error: candidateError } = await supabase
    .from("lead_pipeline_jobs")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (candidateError || !candidates || candidates.length === 0) return null;
  const candidate = candidates[0];

  // Try to lock it
  const { data: locked, error: lockError } = await supabase
    .from("lead_pipeline_jobs")
    .update({
      status: "processing",
      locked_at: now,
      locked_by: WORKER_ID,
      attempts: (candidate.attempts || 0) + 1
    })
    .eq("id", candidate.id)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (lockError || !locked) return null;
  return locked;
}

/**
 * Execute the autonomous pipeline stages for a lead
 */
async function processLeadAutonomousWorkflow(leadId, currentStage = "research_pending") {
  const lead = await getLeadById(leadId);
  if (!lead) throw new Error(`Lead ${leadId} not found.`);

  // Stage 1 & 2: Research
  let research = await getResearchByLeadId(leadId);
  if (!research || currentStage === "research_pending" || currentStage === "researching") {
    await updateLead(leadId, {
      processing_stage: "researching",
      research_status: "in_progress",
      processing_error: null
    });
    await logActivity("pipeline_stage_started", `Starting research for ${lead.business_name}`, {
      entityType: "leads",
      entityId: leadId,
      metadata: { stage: "researching" }
    });

    const searchQuery = [
      lead.business_name,
      lead.website || "",
      lead.location || "",
      lead.business_category || lead.industry || ""
    ].filter(Boolean).join(" ");

    const researchData = await researchBusinessWithTavily(searchQuery);

    // Stage 3 & 4: Review and qualification
    await updateLead(leadId, {
      processing_stage: "reviewing",
      processing_error: null
    });
    await logActivity("pipeline_stage_started", `Reviewing and qualifying ${lead.business_name}`, {
      entityType: "leads",
      entityId: leadId,
      metadata: { stage: "reviewing" }
    });

    const evaluation = await evaluateLeadWithOpenRouter(lead, researchData);

    // Save complete research and evaluation
    research = await saveLeadResearch(leadId, {
      ...evaluation,
      raw_research: researchData
    });

    await updateLead(leadId, {
      research_status: "completed",
      qualification_score: evaluation.qualification_score,
      lead_status: evaluation.qualification_score >= 60 ? "qualified" : "researched",
      processing_stage: "review_completed",
      processing_error: null
    });
    await logActivity("pipeline_stage_completed", `Completed review for ${lead.business_name} (Score: ${evaluation.qualification_score})`, {
      entityType: "leads",
      entityId: leadId,
      metadata: { score: evaluation.qualification_score }
    });
  }

  // Stage 5 & 6: Tailored Outreach Draft Generation
  await updateLead(leadId, {
    processing_stage: "generating_draft",
    processing_error: null
  });
  await logActivity("pipeline_stage_started", `Generating tailored outreach for ${lead.business_name} via ${lead.outreach_channel || "gmail"}`, {
    entityType: "leads",
    entityId: leadId,
    metadata: { channel: lead.outreach_channel || "gmail" }
  });

  const outreachChannel = (lead.outreach_channel || "gmail").toLowerCase().trim();
  const draft = await generateOutreachDraft(lead, research, "", { channel: outreachChannel });

  if (!draft || !draft.body || !draft.body.trim()) {
    throw new Error("Failed to generate non-empty outreach draft from AI.");
  }

  // Determine recipient identifier based on channel
  let recipient = lead.email || "";
  if (outreachChannel === "instagram") {
    recipient = lead.instagram || lead.instagram_handle || lead.business_name || "Instagram Lead";
  } else if (outreachChannel === "whatsapp") {
    recipient = lead.phone || lead.business_name || "WhatsApp Lead";
  }
  if (!recipient && lead.email) recipient = lead.email;

  const now = new Date().toISOString();
  const modelUsed = draft.model_used || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

  // Stage 7: Save Approved Draft & Record Automatic Approval
  let outreachRecordId = null;
  if (isSupabaseConfigured()) {
    const supabase = getSupabaseClient();
    const { data: outreachRecord, error: outreachErr } = await supabase
      .from("outreach_records")
      .insert({
        lead_id: leadId,
        channel: outreachChannel,
        recipient: recipient || "Unknown Recipient",
        subject: draft.subject || null,
        body: draft.body,
        message_body: draft.body,
        status: "draft",
        model_used: modelUsed,
        generation_timestamp: now,
        is_auto_approved: true,
        auto_approved_at: now
      })
      .select()
      .single();

    if (outreachErr) throw outreachErr;
    outreachRecordId = outreachRecord.id;

    // Create approval record in approvals table marked as approved
    const { error: approvalErr } = await supabase.from("approvals").insert({
      action_type: outreachChannel === "gmail" ? "send_email" : `send_${outreachChannel}`,
      entity_type: "outreach",
      entity_id: outreachRecord.id,
      status: "approved",
      title: `Auto-approved outreach for ${lead.business_name} (${outreachChannel})`,
      summary: draft.subject ? `Subject: "${draft.subject}"` : `Direct message via ${outreachChannel}`,
      payload: {
        to: recipient,
        channel: outreachChannel,
        subject: draft.subject || null,
        body: draft.body
      },
      decision_notes: "Automatically approved by autonomous pipeline",
      decided_at: now
    });
    if (approvalErr) console.warn("Could not insert approval record:", approvalErr.message);
  }

  await updateLead(leadId, {
    processing_stage: "draft_approved",
    processing_error: null
  });

  await logActivity("pipeline_completed", `Autonomous pipeline complete for ${lead.business_name}: draft approved on ${outreachChannel}`, {
    entityType: "leads",
    entityId: leadId,
    metadata: { outreachId: outreachRecordId, channel: outreachChannel }
  });

  return { success: true, leadId, outreachChannel, draft };
}

/**
 * Process next job from queue with controlled sequential execution to avoid rate limits
 */
async function processNextLeadJob() {
  if (isQueueProcessing) return;
  isQueueProcessing = true;
  let jobWasProcessed = false;

  try {
    const job = await claimNextJob();
    if (!job) {
      isQueueProcessing = false;
      return;
    }

    jobWasProcessed = true;
    const { id: jobId, lead_id: leadId, stage } = job;
    try {
      await processLeadAutonomousWorkflow(leadId, stage);

      if (isSupabaseConfigured()) {
        await getSupabaseClient()
          .from("lead_pipeline_jobs")
          .update({
            status: "completed",
            stage: "draft_approved",
            error_message: null
          })
          .eq("id", jobId);
      }
    } catch (err) {
      console.error(`Pipeline failure for lead ${leadId} at stage ${stage}:`, err.message);

      await updateLead(leadId, {
        processing_stage: "failed",
        processing_error: err.message
      });

      if (isSupabaseConfigured()) {
        await getSupabaseClient()
          .from("lead_pipeline_jobs")
          .update({
            status: "failed",
            error_message: err.message
          })
          .eq("id", jobId);
      }

      await logActivity("pipeline_failed", `Pipeline failed for lead ${leadId}: ${err.message}`, {
        entityType: "leads",
        entityId: leadId,
        metadata: { error: err.message, stage }
      });
    }

    // Small controlled delay between consecutive jobs to avoid API rate limits
    if (process.env.NODE_ENV !== "test") {
      await new Promise((r) => setTimeout(r, 800));
    }
  } finally {
    isQueueProcessing = false;
    // Continue draining the queue if a job was claimed
    if (jobWasProcessed) {
      triggerQueueWorker();
    }
  }
}

/**
 * Retry a failed lead stage
 */
async function retryFailedLead(leadId) {
  const lead = await getLeadById(leadId);
  if (!lead) throw new Error("Lead not found.");

  let resumeStage = "research_pending";
  if (lead.research_status === "completed") {
    resumeStage = "draft_generation_pending";
  }

  return await enqueueLeadJob(leadId, resumeStage);
}

/**
 * Get aggregate pipeline status counts
 */
async function getPipelineStatusSummary() {
  if (!isSupabaseConfigured()) {
    return {
      total: 0,
      processed: 0,
      waiting: 0,
      failed: 0,
      approved_drafts: 0,
      recent_activity: []
    };
  }

  const supabase = getSupabaseClient();
  const { data: leads, error } = await supabase.from("leads").select("id, processing_stage, processing_error");
  if (error) throw error;

  let total = leads.length;
  let processed = 0;
  let waiting = 0;
  let failed = 0;
  let approvedDrafts = 0;

  for (const lead of leads) {
    const stage = lead.processing_stage || "imported";
    if (stage === "draft_approved") {
      approvedDrafts += 1;
      processed += 1;
    } else if (stage === "failed") {
      failed += 1;
    } else if (["imported", "research_pending", "researching", "review_pending", "reviewing", "draft_generation_pending", "generating_draft"].includes(stage)) {
      waiting += 1;
    }
  }

  // Get recent pipeline activity
  const { data: activity } = await supabase
    .from("activity_logs")
    .select("*")
    .like("event_type", "pipeline_%")
    .order("created_at", { ascending: false })
    .limit(15);

  return {
    total,
    processed,
    waiting,
    failed,
    approved_drafts: approvedDrafts,
    recent_activity: activity || []
  };
}

module.exports = {
  enqueueLeadJob,
  processLeadAutonomousWorkflow,
  processNextLeadJob,
  recoverPendingJobs,
  retryFailedLead,
  getPipelineStatusSummary,
  triggerQueueWorker
};
