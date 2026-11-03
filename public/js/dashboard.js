"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const leadsCountEl = document.getElementById("stat-leads-count");
  const researchedCountEl = document.getElementById("stat-researched-count");

  try {
    const res = await fetch("/api/leads?limit=100");
    if (!res.ok) return;
    const data = await res.json();
    const leads = data.leads || [];

    if (leadsCountEl) {
      leadsCountEl.textContent = leads.length;
    }
    if (researchedCountEl) {
      const researched = leads.filter((l) => l.research_status === "completed").length;
      researchedCountEl.textContent = researched;
    }
  } catch {
    // Ignore error if Supabase is not yet configured or leads cannot be loaded on initial dashboard
  }
});
