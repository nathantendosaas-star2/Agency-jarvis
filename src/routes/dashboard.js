const express = require("express");
const { getSupabaseClient, isSupabaseConfigured } = require("../config/supabase");
const { listApprovals } = require("../services/approvalService");
const { listActivities } = require("../services/activityService");

function createDashboardRouter() {
  const router = express.Router();

  router.get("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!isSupabaseConfigured()) {
      return res.status(200).json({
        totalLeads: 0,
        qualifiedLeads: 0,
        leadsAwaitingReview: 0,
        activeClients: 0,
        outreachCount: 0,
        pendingApprovals: 0,
        scheduledPosts: 0,
        recentActivity: []
      });
    }

    try {
      const supabase = getSupabaseClient();

      const [
        leadsRes,
        qualifiedRes,
        pendingReviewRes,
        clientsRes,
        outreachRes,
        approvalsRes,
        scheduledSocialRes,
        recentActivity
      ] = await Promise.all([
        supabase.from("leads").select("id", { count: "exact", head: true }),
        supabase.from("leads").select("id", { count: "exact", head: true }).or("qualification_score.gte.60,lead_status.eq.qualified"),
        supabase.from("leads").select("id", { count: "exact", head: true }).or("research_status.eq.completed,lead_status.eq.needs_review").eq("lead_status", "new"),
        supabase.from("clients").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("outreach_records").select("id", { count: "exact", head: true }),
        listApprovals({ status: "pending", limit: 10 }),
        supabase.from("social_content").select("id", { count: "exact", head: true }).eq("status", "scheduled"),
        listActivities(8)
      ]);

      return res.status(200).json({
        totalLeads: leadsRes.count || 0,
        qualifiedLeads: qualifiedRes.count || 0,
        leadsAwaitingReview: pendingReviewRes.count || 0,
        activeClients: clientsRes.count || 0,
        outreachCount: outreachRes.count || 0,
        pendingApprovals: approvalsRes.total || 0,
        scheduledPosts: scheduledSocialRes.count || 0,
        pendingApprovalList: approvalsRes.approvals || [],
        recentActivity
      });
    } catch (err) {
      console.error("Dashboard metrics error:", err.message);
      return res.status(500).json({ error: "Failed to load dashboard metrics: " + err.message });
    }
  });

  return router;
}

module.exports = { createDashboardRouter };
