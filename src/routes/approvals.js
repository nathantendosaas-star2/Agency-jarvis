const express = require("express");
const { listApprovals, getApprovalById, updateApprovalDecision } = require("../services/approvalService");

function createApprovalsRouter() {
  const router = express.Router();

  router.get("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const filters = {
        status: req.query.status,
        entity_type: req.query.entity_type,
        limit: req.query.limit
      };
      const result = await listApprovals(filters);
      return res.status(200).json(result);
    } catch (err) {
      console.error("List approvals error:", err.message);
      return res.status(500).json({ error: "Failed to list approvals: " + err.message });
    }
  });

  router.get("/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const approval = await getApprovalById(req.params.id);
      if (!approval) return res.status(404).json({ error: "Approval request not found." });
      return res.status(200).json(approval);
    } catch (err) {
      console.error("Get approval error:", err.message);
      return res.status(500).json({ error: "Failed to fetch approval." });
    }
  });

  router.post("/:id/decide", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const { decision, decision_notes } = req.body || {};
    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ error: "Decision must be 'approved' or 'rejected'." });
    }
    try {
      const updated = await updateApprovalDecision(req.params.id, decision, decision_notes);
      return res.status(200).json(updated);
    } catch (err) {
      console.error("Decide approval error:", err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createApprovalsRouter };
