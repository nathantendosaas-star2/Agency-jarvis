const express = require("express");
const { listLeads, getLeadById, createLead, updateLead } = require("../services/leadsService");
const { ingestFromGoogleSheets } = require("../services/sheetsService");
const { reviewAndQualifyLead } = require("../services/leadReviewService");
const { importLeadsFromCsv, VALID_CHANNELS } = require("../services/csvImportService");
const { enqueueLeadJob, retryFailedLead, getPipelineStatusSummary } = require("../services/leadPipelineService");
const { getResearchByLeadId } = require("../services/researchService");
const { isSupabaseConfigured } = require("../config/supabase");
const { logActivity } = require("../services/activityService");

function createLeadsRouter() {
  const router = express.Router();

  // Middleware to ensure Supabase is configured
  router.use((_req, res, next) => {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        error: "Supabase database is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
      });
    }
    next();
  });

  // GET /api/leads - List and filter leads
  router.get("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const filters = {
        status: req.query.status,
        research_status: req.query.research_status,
        search: req.query.search,
        limit: req.query.limit,
        offset: req.query.offset
      };
      const result = await listLeads(filters);
      return res.status(200).json(result);
    } catch (err) {
      console.error("Failed to list leads:", err.message);
      return res.status(500).json({ error: "Failed to retrieve leads." });
    }
  });

  // GET /api/leads/pipeline/status - Get pipeline metrics and summary
  router.get("/pipeline/status", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const summary = await getPipelineStatusSummary();
      return res.status(200).json(summary);
    } catch (err) {
      console.error("Pipeline status error:", err.message);
      return res.status(500).json({ error: "Failed to fetch pipeline status: " + err.message });
    }
  });

  // POST /api/leads - Create single lead
  router.post("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const {
      business_name,
      website,
      contact_name,
      email,
      phone,
      instagram,
      business_category,
      location,
      notes,
      outreach_channel
    } = req.body || {};

    if (!business_name || typeof business_name !== "string" || !business_name.trim()) {
      return res.status(400).json({ error: "Business name is required." });
    }

    const channel = (outreach_channel || "gmail").toLowerCase().trim();
    if (channel && !VALID_CHANNELS.includes(channel)) {
      return res.status(400).json({ error: `Invalid outreach_channel. Must be one of: ${VALID_CHANNELS.join(", ")}` });
    }

    try {
      const lead = await createLead({
        business_name,
        website,
        contact_name,
        email,
        phone,
        instagram,
        business_category,
        location,
        notes,
        outreach_channel: channel || "gmail",
        source: "manual"
      });
      await logActivity("lead_created", `Created lead: ${business_name} (${channel || "gmail"})`, { entityType: "leads", entityId: lead.id });
      return res.status(201).json(lead);
    } catch (err) {
      console.error("Failed to create lead:", err.message);
      return res.status(500).json({ error: "Failed to create lead: " + err.message });
    }
  });

  // POST /api/leads/import/csv - Ingest leads via CSV and trigger autonomous pipeline
  router.post("/import/csv", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const { csv, channel } = req.body || {};

    if (!csv || typeof csv !== "string" || !csv.trim()) {
      return res.status(400).json({ error: "CSV content is required." });
    }

    const defaultChannel = (channel || "gmail").toLowerCase().trim();
    if (!VALID_CHANNELS.includes(defaultChannel)) {
      return res.status(400).json({ error: `Invalid default channel. Must be one of: ${VALID_CHANNELS.join(", ")}` });
    }

    try {
      const stats = await importLeadsFromCsv(csv, { defaultChannel });
      await logActivity("leads_csv_imported", `CSV import: ${stats.imported} queued, ${stats.duplicatesSkipped} duplicates, ${stats.invalidRows} invalid`, {
        metadata: {
          imported: stats.imported,
          duplicates: stats.duplicatesSkipped,
          invalid: stats.invalidRows,
          failed: stats.failed,
          channel: defaultChannel
        }
      });
      return res.status(200).json({ success: true, stats });
    } catch (err) {
      console.error("CSV import error:", err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  // POST /api/leads/import/sheets - Ingest leads from Google Sheets
  router.post("/import/sheets", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const { scriptUrl, apiSecret } = req.body || {};

    try {
      const stats = await ingestFromGoogleSheets({ scriptUrl, apiSecret });
      await logActivity("leads_imported", `Google Sheets import: ${stats.leadsImported} added, ${stats.duplicatesSkipped} duplicates`, {
        metadata: stats
      });
      return res.status(200).json({
        success: true,
        stats
      });
    } catch (err) {
      console.error("Failed to import leads from Google Sheets:", err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  // GET /api/leads/:id - Get single lead
  router.get("/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const lead = await getLeadById(req.params.id);
      if (!lead) {
        return res.status(404).json({ error: "Lead not found." });
      }
      return res.status(200).json(lead);
    } catch (err) {
      console.error("Failed to get lead:", err.message);
      return res.status(500).json({ error: "Failed to retrieve lead." });
    }
  });

  // POST /api/leads/:id/retry - Retry failed pipeline stage
  router.post("/:id/retry", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const job = await retryFailedLead(req.params.id);
      await logActivity("lead_pipeline_retried", `Retried autonomous pipeline for lead ${req.params.id}`, {
        entityType: "leads",
        entityId: req.params.id
      });
      return res.status(200).json({ success: true, job });
    } catch (err) {
      console.error("Retry pipeline failed:", err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  // PATCH /api/leads/:id - Update lead details / status / decision
  router.patch("/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const updates = req.body || {};
    if (updates.outreach_channel) {
      const channel = updates.outreach_channel.toLowerCase().trim();
      if (!VALID_CHANNELS.includes(channel)) {
        return res.status(400).json({ error: `Invalid outreach_channel. Must be one of: ${VALID_CHANNELS.join(", ")}` });
      }
      updates.outreach_channel = channel;
    }
    try {
      const updated = await updateLead(req.params.id, updates);
      await logActivity("lead_updated", `Updated lead ${updated.business_name}: status ${updated.lead_status}`, {
        entityType: "leads",
        entityId: req.params.id,
        metadata: { lead_status: updated.lead_status, outreach_channel: updated.outreach_channel }
      });
      return res.status(200).json(updated);
    } catch (err) {
      console.error("Failed to update lead:", err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  // GET /api/leads/:id/research - Get research result for a lead
  router.get("/:id/research", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const research = await getResearchByLeadId(req.params.id);
      if (!research) {
        return res.status(404).json({ error: "Research not found for this lead." });
      }
      return res.status(200).json(research);
    } catch (err) {
      console.error("Failed to get research for lead:", err.message);
      return res.status(500).json({ error: "Failed to retrieve lead research." });
    }
  });

  // POST /api/leads/:id/review - Trigger AI Lead Review (Tavily + OpenRouter)
  router.post("/:id/review", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const result = await reviewAndQualifyLead(req.params.id);
      await logActivity("lead_reviewed", `AI Lead Review completed for ${result.lead.business_name} (Score: ${result.lead.qualification_score}/100)`, {
        entityType: "leads",
        entityId: req.params.id,
        metadata: { score: result.lead.qualification_score }
      });
      return res.status(200).json(result);
    } catch (err) {
      console.error("Lead review failed:", err.message);
      return res.status(500).json({ error: "Lead review failed: " + err.message });
    }
  });

  return router;
}

module.exports = { createLeadsRouter };
