const express = require("express");
const {
  listOutreachRecords,
  getOutreachById,
  draftOutreachForLead,
  requestOutreachApproval,
  recordAndClassifyReply
} = require("../services/outreachService");

function describeOutreachError(err) {
  if (err?.message === "fetch failed") {
    const cause = err.cause?.code ? ` (${err.cause.code})` : "";
    return `Network request failed${cause}. Check this PC's internet, DNS, and firewall, then use Settings > Test Supabase and Settings > Test Bird to identify which service cannot be reached.`;
  }
  return err?.message || "Unknown outreach error";
}

function createOutreachRouter() {
  const router = express.Router();

  router.get("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const result = await listOutreachRecords({
        status: req.query.status,
        lead_id: req.query.lead_id,
        limit: req.query.limit
      });
      return res.status(200).json(result);
    } catch (err) {
      console.error("List outreach error:", err.message);
      return res.status(500).json({ error: "Failed to list outreach records: " + err.message });
    }
  });

  router.post("/draft", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const { lead_id, email_brief } = req.body || {};
    if (!lead_id) return res.status(400).json({ error: "lead_id is required." });
    try {
      const draft = await draftOutreachForLead(lead_id, { emailBrief: email_brief });
      return res.status(201).json(draft);
    } catch (err) {
      console.error("Draft outreach error:", err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  router.post("/:id/request-approval", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const approval = await requestOutreachApproval(req.params.id);
      return res.status(200).json(approval);
    } catch (err) {
      console.error("Request approval error:", err.message, err.cause || "");
      return res.status(400).json({ error: describeOutreachError(err) });
    }
  });

  router.post("/:id/send", (req, res) => {
    res.set("Cache-Control", "no-store");
    return res.status(410).json({
      error: "Direct email sending is disabled. Open the approved draft in Gmail and send it manually."
    });
  });

  router.post("/:id/reply", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const { reply_content } = req.body || {};
    if (!reply_content) return res.status(400).json({ error: "reply_content is required." });
    try {
      const result = await recordAndClassifyReply(req.params.id, reply_content);
      return res.status(200).json(result);
    } catch (err) {
      console.error("Record reply error:", err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  router.get("/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const record = await getOutreachById(req.params.id);
      if (!record) return res.status(404).json({ error: "Outreach record not found." });
      return res.status(200).json(record);
    } catch (err) {
      console.error("Get outreach error:", err.message);
      return res.status(500).json({ error: "Failed to fetch outreach record." });
    }
  });

  return router;
}

module.exports = { createOutreachRouter };
