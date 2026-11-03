"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const leadsTbody = document.getElementById("leads-tbody");
  const leadsTable = document.getElementById("leads-table");
  const loadingState = document.getElementById("loading-state");
  const emptyState = document.getElementById("empty-state");
  const errorState = document.getElementById("error-state");
  const importBanner = document.getElementById("import-banner");

  const searchInput = document.getElementById("lead-search");
  const statusFilter = document.getElementById("status-filter");
  const researchFilter = document.getElementById("research-filter");
  const refreshBtn = document.getElementById("refresh-btn");

  const importBtn = document.getElementById("import-sheets-btn");
  const importModal = document.getElementById("import-modal");
  const importModalClose = document.getElementById("import-modal-close");
  const importCancelBtn = document.getElementById("import-cancel-btn");
  const importForm = document.getElementById("import-form");
  const importStatusText = document.getElementById("import-status-text");
  const importSubmitBtn = document.getElementById("import-submit-btn");

  const researchModal = document.getElementById("research-modal");
  const researchModalClose = document.getElementById("modal-close");
  const modalTitle = document.getElementById("modal-title");
  const modalContent = document.getElementById("modal-content");

  let debounceTimer = null;

  async function loadLeads() {
    leadsTable.classList.add("hidden");
    emptyState.classList.add("hidden");
    errorState.classList.add("hidden");
    loadingState.classList.remove("hidden");

    const params = new URLSearchParams();
    if (searchInput && searchInput.value.trim()) params.set("search", searchInput.value.trim());
    if (statusFilter && statusFilter.value) params.set("status", statusFilter.value);
    if (researchFilter && researchFilter.value) params.set("research_status", researchFilter.value);

    try {
      const res = await fetch(`/api/leads?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to fetch leads (${res.status})`);
      }

      const data = await res.json();
      renderLeads(data.leads || []);
    } catch (err) {
      loadingState.classList.add("hidden");
      errorState.textContent = err.message;
      errorState.classList.remove("hidden");
    }
  }

  function renderLeads(leads) {
    loadingState.classList.add("hidden");
    leadsTbody.innerHTML = "";

    if (!leads || leads.length === 0) {
      emptyState.classList.remove("hidden");
      leadsTable.classList.add("hidden");
      return;
    }

    leadsTable.classList.remove("hidden");
    leads.forEach((lead) => {
      const tr = document.createElement("tr");

      // Business
      const tdBusiness = document.createElement("td");
      const busName = document.createElement("div");
      busName.className = "lead-name";
      busName.textContent = lead.business_name;
      tdBusiness.appendChild(busName);

      if (lead.website) {
        const webLink = document.createElement("a");
        webLink.href = lead.website.startsWith("http") ? lead.website : `https://${lead.website}`;
        webLink.target = "_blank";
        webLink.rel = "noopener noreferrer";
        webLink.className = "lead-meta-link";
        webLink.textContent = lead.website.replace(/^https?:\/\//, "");
        tdBusiness.appendChild(webLink);
      }
      tr.appendChild(tdBusiness);

      // Contact
      const tdContact = document.createElement("td");
      const contactText = document.createElement("div");
      contactText.textContent = lead.contact_name || "—";
      tdContact.appendChild(contactText);
      if (lead.email) {
        const emailDiv = document.createElement("div");
        emailDiv.className = "lead-meta";
        emailDiv.textContent = lead.email;
        tdContact.appendChild(emailDiv);
      }
      tr.appendChild(tdContact);

      // Category / Location
      const tdCategory = document.createElement("td");
      const catText = document.createElement("div");
      catText.textContent = lead.business_category || "General";
      tdCategory.appendChild(catText);
      if (lead.location) {
        const locDiv = document.createElement("div");
        locDiv.className = "lead-meta";
        locDiv.textContent = lead.location;
        tdCategory.appendChild(locDiv);
      }
      tr.appendChild(tdCategory);

      // Score
      const tdScore = document.createElement("td");
      if (typeof lead.qualification_score === "number") {
        const scoreBadge = document.createElement("span");
        const score = lead.qualification_score;
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

      // Status
      const tdStatus = document.createElement("td");
      const statusBadge = document.createElement("span");
      statusBadge.className = `status-badge status-${lead.lead_status || "new"}`;
      statusBadge.textContent = lead.lead_status || "new";
      tdStatus.appendChild(statusBadge);
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
      renderResearchContent(data);
    } catch (err) {
      modalContent.innerHTML = `<div class='notice error'><p>${err.message}</p></div>`;
    }
  }

  function renderResearchContent(research) {
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

  // Event Listeners for Filters
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(loadLeads, 300);
    });
  }

  if (statusFilter) statusFilter.addEventListener("change", loadLeads);
  if (researchFilter) researchFilter.addEventListener("change", loadLeads);
  if (refreshBtn) refreshBtn.addEventListener("click", loadLeads);

  // Modal Closures
  if (researchModalClose) {
    researchModalClose.addEventListener("click", () => researchModal.classList.add("hidden"));
  }
  if (researchModal) {
    researchModal.addEventListener("click", (e) => {
      if (e.target === researchModal) researchModal.classList.add("hidden");
    });
  }

  // Import Modal Handlers
  if (importBtn) {
    importBtn.addEventListener("click", () => {
      importStatusText.textContent = "";
      importStatusText.className = "import-status-text hidden";
      importModal.classList.remove("hidden");
    });
  }

  if (importModalClose) {
    importModalClose.addEventListener("click", () => importModal.classList.add("hidden"));
  }
  if (importCancelBtn) {
    importCancelBtn.addEventListener("click", () => importModal.classList.add("hidden"));
  }
  if (importModal) {
    importModal.addEventListener("click", (e) => {
      if (e.target === importModal) importModal.classList.add("hidden");
    });
  }

  if (importForm) {
    importForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      importSubmitBtn.disabled = true;
      importSubmitBtn.textContent = "Importing…";
      importStatusText.textContent = "Connecting to Google Sheets…";
      importStatusText.className = "import-status-text";
      importStatusText.classList.remove("hidden");

      const scriptUrl = document.getElementById("import-script-url").value.trim();
      const apiSecret = document.getElementById("import-api-secret").value.trim();

      try {
        const res = await fetch("/api/leads/import/sheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scriptUrl: scriptUrl || undefined,
            apiSecret: apiSecret || undefined
          })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Import failed");
        }

        const stats = data.stats;
        importStatusText.textContent = `Success: Processed ${stats.rowsProcessed} rows, imported ${stats.leadsImported} new leads, skipped ${stats.duplicatesSkipped} duplicates.`;
        importStatusText.classList.add("status-success");

        // Display banner on main page
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

  // Initial load
  loadLeads();
});
