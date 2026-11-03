const express = require("express");
const { listLeads, getLeadById, createLead, updateLead } = require("../services/leadsService");
const { ingestFromGoogleSheets } = require("../services/sheetsService");
const { reviewAndQualifyLead } = require("../services/leadReviewService");
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

  // POST /api/leads - Create single lead
  router.post("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const { business_name, website, contact_name, email, phone, business_category, location, notes } = req.body || {};

    if (!business_name || typeof business_name !== "string" || !business_name.trim()) {
      return res.status(400).json({ error: "Business name is required." });
    }

    try {
      const lead = await createLead({
        business_name,
        website,
        contact_name,
        email,
        phone,
        business_category,
        location,
        notes,
        source: "manual"
      });
      await logActivity("lead_created", `Created lead: ${business_name}`, { entityType: "leads", entityId: lead.id });
      return res.status(201).json(lead);
    } catch (err) {
      console.error("Failed to create lead:", err.message);
      return res.status(500).json({ error: "Failed to create lead: " + err.message });
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

  // PATCH /api/leads/:id - Update lead details / status / decision
  router.patch("/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const updated = await updateLead(req.params.id, req.body || {});
      await logActivity("lead_updated", `Updated lead ${updated.business_name}: status ${updated.lead_status}`, {
        entityType: "leads",
        entityId: req.params.id,
        metadata: { lead_status: updated.lead_status }
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
