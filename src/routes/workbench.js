const express = require("express");
const { listWorkbenchTasks, getWorkbenchTaskById, runWorkbenchTask } = require("../services/workbenchService");

function createWorkbenchRouter() {
  const router = express.Router();

  router.get("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const limit = Number(req.query.limit) || 20;
      const tasks = await listWorkbenchTasks(limit);
      return res.status(200).json(tasks);
    } catch (err) {
      console.error("List workbench tasks error:", err.message);
      return res.status(500).json({ error: "Failed to list workbench tasks: " + err.message });
    }
  });

  router.post("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const { prompt, task_type, client_id, lead_id } = req.body || {};
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ error: "Prompt is required." });
    }
    try {
      const task = await runWorkbenchTask({
        prompt,
        taskType: task_type,
        clientId: client_id,
        leadId: lead_id
      });
      return res.status(201).json(task);
    } catch (err) {
      console.error("Execute workbench task error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  router.get("/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const task = await getWorkbenchTaskById(req.params.id);
      if (!task) return res.status(404).json({ error: "Task not found." });
      return res.status(200).json(task);
    } catch (err) {
      console.error("Get workbench task error:", err.message);
      return res.status(500).json({ error: "Failed to fetch workbench task." });
    }
  });

  return router;
}

module.exports = { createWorkbenchRouter };
