const express = require("express");
const { listClients, getClientById, createClient, updateClient } = require("../services/clientsService");

function createClientsRouter() {
  const router = express.Router();

  router.get("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const filters = {
        status: req.query.status,
        search: req.query.search,
        limit: req.query.limit
      };
      const result = await listClients(filters);
      return res.status(200).json(result);
    } catch (err) {
      console.error("List clients error:", err.message);
      return res.status(500).json({ error: "Failed to list clients: " + err.message });
    }
  });

  router.post("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const { name, company, email, phone, website, industry, tier, notes, lead_id } = req.body || {};
    try {
      const client = await createClient({ name, company, email, phone, website, industry, tier, notes, lead_id });
      return res.status(201).json(client);
    } catch (err) {
      console.error("Create client error:", err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  router.get("/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const client = await getClientById(req.params.id);
      if (!client) return res.status(404).json({ error: "Client not found." });
      return res.status(200).json(client);
    } catch (err) {
      console.error("Get client error:", err.message);
      return res.status(500).json({ error: "Failed to fetch client." });
    }
  });

  router.patch("/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const updated = await updateClient(req.params.id, req.body || {});
      return res.status(200).json(updated);
    } catch (err) {
      console.error("Update client error:", err.message);
      return res.status(400).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createClientsRouter };
