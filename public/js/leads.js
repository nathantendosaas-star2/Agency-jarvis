"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const leadsTbody = document.getElementById("leads-tbody");
  const searchInput = document.getElementById("lead-search");
  const statusFilter = document.getElementById("filter-status");
  const researchFilter = document.getElementById("filter-research");
  const refreshBtn = document.getElementById("refresh-btn");

  const addLeadBtn = document.getElementById("add-lead-btn");
  const addLeadModal = document.getElementById("add-lead-modal");
  const addLeadClose = document.getElementById("add-lead-close");
  const addLeadCancel = document.getElementById("add-lead-cancel");
  const addLeadForm = document.getElementById("add-lead-form");

  const importBtn = document.getElementById("import-sheets-btn");
  const importModal = document.getElementById("import-modal");
  const importModalClose = document.getElementById("import-modal-close");
  const importCancelBtn = document.getElementById("import-cancel-btn");
  const importForm = document.getElementById("import-form");
  const importSubmitBtn = document.getElementById("import-submit-btn");
  const importStatusText = document.getElementById("import-status-text");
  const importBanner = document.getElementById("import-banner");

  const researchModal = document.getElementById("research-modal");
  const researchModalClose = document.getElementById("modal-close-btn");
  const modalTitle = document.getElementById("modal-title");
  const modalContent = document.getElementById("modal-content");

  let debounceTimer = null;

  async function loadLeads() {
    leadsTbody.innerHTML = `<tr><td colspan="6" class="state-message">Loading leads…</td></tr>`;

    const params = new URLSearchParams();
    if (searchInput && searchInput.value.trim()) params.append("search", searchInput.value.trim());
    if (statusFilter && statusFilter.value) params.append("status", statusFilter.value);
    if (researchFilter && researchFilter.value) params.append("research_status", researchFilter.value);

    try {
      const res = await fetch(`/api/leads?${params.toString()}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to load leads from database.");
      }
      const data = await res.json();
      renderLeads(data.leads || []);
    } catch (err) {
      leadsTbody.innerHTML = `<tr><td colspan="6" class="state-message error-message">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderLeads(leads) {
    if (leads.length === 0) {
      leadsTbody.innerHTML = `<tr><td colspan="6" class="state-message">No leads found matching criteria.</td></tr>`;
      return;
    }

    leadsTbody.innerHTML = "";
    leads.forEach((lead) => {
      const tr = document.createElement("tr");

      // Business Info
      const tdBiz = document.createElement("td");
      const nameEl = document.createElement("div");
      nameEl.className = "lead-name";
      nameEl.textContent = lead.business_name || lead.company_name || "Unnamed Business";

      const catEl = document.createElement("div");
      catEl.className = "lead-meta";
      catEl.textContent = [lead.business_category || lead.industry, lead.location].filter(Boolean).join(" • ") || "General";

      tdBiz.appendChild(nameEl);
      tdBiz.appendChild(catEl);

      if (lead.website) {
        const webLink = document.createElement("a");
        webLink.className = "lead-meta-link";
        webLink.href = lead.website.startsWith("http") ? lead.website : `https://${lead.website}`;
        webLink.target = "_blank";
        webLink.rel = "noopener noreferrer";
        webLink.textContent = lead.website.replace(/^https?:\/\//, "");
        tdBiz.appendChild(webLink);
      }
      tr.appendChild(tdBiz);

      // Contact Details
      const tdContact = document.createElement("td");
      tdContact.innerHTML = `<div>${escapeHtml(lead.contact_name || "—")}</div><div class="lead-meta">${escapeHtml(lead.email || "")}</div><div class="lead-meta">${escapeHtml(lead.phone || "")}</div>`;
      tr.appendChild(tdContact);

      // Score
      const tdScore = document.createElement("td");
      const score = lead.qualification_score;
      if (typeof score === "number" && score !== null) {
        const scoreBadge = document.createElement("span");
        let scoreClass = "score-low";
        if (score >= 75) scoreClass = "score-high";
        else if (score >= 45) scoreClass = "score-mid";
        scoreBadge.className = `score-badge ${scoreClass}`;
        scoreBadge.textContent = `${score}/100`;
        tdScore.appendChild(scoreBadge);
      } else {
        tdScore.textContent = "—";
      }
      tr.appendChild(tdScore);

      // Research Status
      const tdResearch = document.createElement("td");
      const researchBadge = document.createElement("span");
      researchBadge.className = `status-badge research-${lead.research_status || "pending"}`;
      researchBadge.textContent = (lead.research_status || "pending").replace("_", " ");
      tdResearch.appendChild(researchBadge);
      tr.appendChild(tdResearch);

      // Status dropdown for administrator changes
      const tdStatus = document.createElement("td");
      const statusSelect = document.createElement("select");
      statusSelect.className = `table-select status-${lead.lead_status || "new"}`;
      const statuses = ["new", "qualified", "needs_review", "contacted", "replied", "converted", "disqualified"];
      statuses.forEach((st) => {
        const opt = document.createElement("option");
        opt.value = st;
        opt.textContent = st.replace("_", " ").toUpperCase();
        if ((lead.lead_status || "new") === st) opt.selected = true;
        statusSelect.appendChild(opt);
      });
      statusSelect.addEventListener("change", async () => {
        try {
          await fetch(`/api/leads/${lead.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lead_status: statusSelect.value })
          });
          loadLeads();
        } catch (err) {
          alert(`Failed to update status: ${err.message}`);
        }
      });
      tdStatus.appendChild(statusSelect);
      tr.appendChild(tdStatus);

      // Actions
      const tdAction = document.createElement("td");
      tdAction.style.textAlign = "right";

      const actionGroup = document.createElement("div");
      actionGroup.className = "row-actions";

      if (lead.research_status === "completed") {
        const viewBtn = document.createElement("button");
        viewBtn.type = "button";
        viewBtn.className = "table-btn secondary";
        viewBtn.textContent = "View Review";
        viewBtn.addEventListener("click", () => showResearchModal(lead.id, lead.business_name));
        actionGroup.appendChild(viewBtn);
      }

      const reviewBtn = document.createElement("button");
      reviewBtn.type = "button";
      reviewBtn.className = "table-btn primary";
      reviewBtn.textContent = lead.research_status === "completed" ? "Re-qualify" : "AI Review";
      if (lead.research_status === "in_progress") {
        reviewBtn.disabled = true;
        reviewBtn.textContent = "Researching…";
      }

      reviewBtn.addEventListener("click", async () => {
        reviewBtn.disabled = true;
        reviewBtn.textContent = "Researching…";
        try {
          const res = await fetch(`/api/leads/${lead.id}/review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
          const result = await res.json();
          if (!res.ok) throw new Error(result.error || "Review failed");
          showResearchModal(lead.id, lead.business_name);
          loadLeads();
        } catch (err) {
          alert(`Research error: ${err.message}`);
          loadLeads();
        }
      });
      actionGroup.appendChild(reviewBtn);

      tdAction.appendChild(actionGroup);
      tr.appendChild(tdAction);

      leadsTbody.appendChild(tr);
    });
  }

  async function showResearchModal(leadId, businessName) {
    modalTitle.textContent = businessName || "Lead Research";
    modalContent.innerHTML = "<p class='state-message'>Loading qualification data…</p>";
    researchModal.classList.remove("hidden");

    try {
      const res = await fetch(`/api/leads/${leadId}/research`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Could not load research details.");
      }
      const data = await res.json();
      renderResearchContent(leadId, data);
    } catch (err) {
      modalContent.innerHTML = `<div class='notice error'><p>${escapeHtml(err.message)}</p></div>`;
    }
  }

  function renderResearchContent(leadId, research) {
    let scoreClass = "score-low";
    if (research.qualification_score >= 75) scoreClass = "score-high";
    else if (research.qualification_score >= 45) scoreClass = "score-mid";

    const servicesList = (research.services_offered || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("");
    const opportunitiesList = (research.marketing_opportunities || []).map((o) => `<li>${escapeHtml(o)}</li>`).join("");
    const limitationsList = (research.potential_limitations || []).map((l) => `<li>${escapeHtml(l)}</li>`).join("");
    const smmaList = (research.suggested_smma_services || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("");
    const sourcesList = (research.research_sources || [])
      .map((url) => `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a></li>`)
      .join("");

    modalContent.innerHTML = `
      <div class="review-score-banner ${scoreClass}">
        <div class="score-number">${research.qualification_score !== null ? research.qualification_score : "—"}<span>/100</span></div>
        <div class="score-detail">
          <h4>SMMA Qualification Score</h4>
          <p>${escapeHtml(research.qualification_reasoning || "No reasoning recorded.")}</p>
        </div>
      </div>

      <!-- Administrator Review Decision Buttons -->
      <div class="review-decision-bar">
        <span>Admin Decision:</span>
        <button class="table-btn primary" id="decide-qualify-btn">Qualify Lead</button>
        <button class="table-btn secondary" id="decide-review-btn">Flag for Review</button>
        <button class="table-btn secondary" style="color:#f87171" id="decide-disqualify-btn">Disqualify</button>
        <a href="/outreach.html" class="button-link" style="margin:0 0 0 auto;padding:6px 12px;font-size:11px">Prepare Outreach →</a>
      </div>

      <div class="review-section">
        <h3>Business Summary</h3>
        <p class="review-text">${escapeHtml(research.summary || "No summary available.")}</p>
      </div>

      <div class="review-grid">
        <div class="review-col">
          <h3>Services Identified</h3>
          <ul class="bullet-list">${servicesList || "<li class='muted'>None detected</li>"}</ul>
        </div>
        <div class="review-col">
          <h3>Target Market</h3>
          <p class="review-text">${escapeHtml(research.target_market || "Not specified.")}</p>
        </div>
      </div>

      <div class="review-section">
        <h3>Evidence of Active Business</h3>
        <p class="review-text">${escapeHtml(research.evidence_activity || "No direct activity evidence found.")}</p>
      </div>

      <div class="review-grid">
        <div class="review-col">
          <h3>Marketing Opportunities</h3>
          <ul class="bullet-list">${opportunitiesList || "<li class='muted'>None listed</li>"}</ul>
        </div>
        <div class="review-col">
          <h3>Potential Challenges</h3>
          <ul class="bullet-list">${limitationsList || "<li class='muted'>None noted</li>"}</ul>
        </div>
      </div>

      <div class="review-section">
        <h3>Recommended SMMA Services</h3>
        <ul class="bullet-list">${smmaList || "<li class='muted'>No specific recommendations</li>"}</ul>
      </div>

      <div class="review-section">
        <h3>Verified Research Sources</h3>
        <ul class="sources-list">${sourcesList || "<li class='muted'>No external sources linked</li>"}</ul>
      </div>
    `;

    document.getElementById("decide-qualify-btn").addEventListener("click", () => updateLeadStatus(leadId, "qualified"));
    document.getElementById("decide-review-btn").addEventListener("click", () => updateLeadStatus(leadId, "needs_review"));
    document.getElementById("decide-disqualify-btn").addEventListener("click", () => updateLeadStatus(leadId, "disqualified"));
  }

  async function updateLeadStatus(leadId, status) {
    try {
      await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_status: status })
      });
      researchModal.classList.add("hidden");
      loadLeads();
    } catch (err) {
      alert(`Status update error: ${err.message}`);
    }
  }

  function escapeHtml(text) {
    if (!text) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Filter Event Listeners
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(loadLeads, 300);
    });
  }
  if (statusFilter) statusFilter.addEventListener("change", loadLeads);
  if (researchFilter) researchFilter.addEventListener("change", loadLeads);
  if (refreshBtn) refreshBtn.addEventListener("click", loadLeads);

  // Add Lead Modal Listeners
  if (addLeadBtn) addLeadBtn.addEventListener("click", () => addLeadModal.classList.remove("hidden"));
  if (addLeadClose) addLeadClose.addEventListener("click", () => addLeadModal.classList.add("hidden"));
  if (addLeadCancel) addLeadCancel.addEventListener("click", () => addLeadModal.classList.add("hidden"));
  if (addLeadForm) {
    addLeadForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        business_name: document.getElementById("new-lead-name").value,
        website: document.getElementById("new-lead-website").value,
        contact_name: document.getElementById("new-lead-contact").value,
        email: document.getElementById("new-lead-email").value,
        business_category: document.getElementById("new-lead-category").value,
        location: document.getElementById("new-lead-location").value,
        notes: document.getElementById("new-lead-notes").value
      };
      try {
        const res = await fetch("/api/leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to create lead");
        }
        addLeadModal.classList.add("hidden");
        addLeadForm.reset();
        loadLeads();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  // Google Sheets Import Listeners
  if (importBtn) {
    importBtn.addEventListener("click", () => {
      importStatusText.textContent = "";
      importStatusText.className = "import-status-text hidden";
      importModal.classList.remove("hidden");
    });
  }
  if (importModalClose) importModalClose.addEventListener("click", () => importModal.classList.add("hidden"));
  if (importCancelBtn) importCancelBtn.addEventListener("click", () => importModal.classList.add("hidden"));
  if (importForm) {
    importForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      importSubmitBtn.disabled = true;
      importSubmitBtn.textContent = "Importing…";
      importStatusText.textContent = "Connecting to Google Sheets Web App…";
      importStatusText.className = "import-status-text";
      importStatusText.classList.remove("hidden");

      const scriptUrl = document.getElementById("import-script-url").value.trim();
      const apiSecret = document.getElementById("import-api-secret").value.trim();

      try {
        const res = await fetch("/api/leads/import/sheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scriptUrl: scriptUrl || undefined, apiSecret: apiSecret || undefined })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Import failed");

        const stats = data.stats;
        importStatusText.textContent = `Success: Processed ${stats.rowsProcessed} rows, imported ${stats.leadsImported} new leads, skipped ${stats.duplicatesSkipped} duplicates.`;
        importStatusText.classList.add("status-success");

        importBanner.className = "banner banner-success";
        importBanner.textContent = `Google Sheets Import complete: ${stats.leadsImported} imported, ${stats.duplicatesSkipped} duplicates skipped, ${stats.invalidRows} invalid.`;
        importBanner.classList.remove("hidden");

        setTimeout(() => {
          importModal.classList.add("hidden");
          loadLeads();
        }, 1200);
      } catch (err) {
        importStatusText.textContent = `Import error: ${err.message}`;
        importStatusText.classList.add("status-error");
      } finally {
        importSubmitBtn.disabled = false;
        importSubmitBtn.textContent = "Start Ingestion";
      }
    });
  }

  if (researchModalClose) researchModalClose.addEventListener("click", () => researchModal.classList.add("hidden"));

  loadLeads();
});
