const express = require("express");
const {
  listSocialContent,
  getSocialContentById,
  generateSocialPostsForClient,
  requestSocialPostApproval,
  scheduleApprovedSocialPost
} = require("../services/socialService");
const { getBufferProfiles } = require("../services/bufferService");

function createSocialRouter() {
  const router = express.Router();

  router.get("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const result = await listSocialContent({
        status: req.query.status,
        client_id: req.query.client_id,
        limit: req.query.limit
      });
      return res.status(200).json(result);
    } catch (err) {
      console.error("List social error:", err.message);
      return res.status(500).json({ error: "Failed to list social content: " + err.message });
    }
  });

  router.get("/buffer-channels", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const profiles = await getBufferProfiles();
      return res.status(200).json({ profiles });
    } catch (err) {
      return res.status(200).json({ profiles: [], message: err.message });
    }
  });

  router.post("/generate", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const { client_id, objective, platform } = req.body || {};
    try {
      const result = await generateSocialPostsForClient(client_id, objective, platform);
      return res.status(201).json(result);
    } catch (err) {
      console.error("Generate social error:", err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  router.post("/:id/request-approval", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const approval = await requestSocialPostApproval(req.params.id);
      return res.status(200).json(approval);
    } catch (err) {
      console.error("Social approval request error:", err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  router.post("/:id/schedule", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const { buffer_profile_ids, scheduled_at } = req.body || {};
    if (!Array.isArray(buffer_profile_ids) || buffer_profile_ids.length === 0) {
      return res.status(400).json({ error: "buffer_profile_ids array is required." });
    }
    try {
      const result = await scheduleApprovedSocialPost(req.params.id, buffer_profile_ids, scheduled_at);
      return res.status(200).json(result);
    } catch (err) {
      console.error("Social schedule error:", err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  router.get("/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const post = await getSocialContentById(req.params.id);
      if (!post) return res.status(404).json({ error: "Social post not found." });
      return res.status(200).json(post);
    } catch (err) {
      console.error("Get social post error:", err.message);
      return res.status(500).json({ error: "Failed to fetch post." });
    }
  });

  return router;
}

module.exports = { createSocialRouter };
