"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const leadsCountEl = document.getElementById("stat-leads-count");
  const qualifiedCountEl = document.getElementById("stat-qualified-count");
  const clientsCountEl = document.getElementById("stat-clients-count");
  const approvalsCountEl = document.getElementById("stat-approvals-count");
  const approvalsContainer = document.getElementById("approvals-container");
  const activityContainer = document.getElementById("activity-container");

  async function loadDashboard() {
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to load dashboard metrics");
      const data = await res.json();

      if (leadsCountEl) leadsCountEl.textContent = data.totalLeads;
      if (qualifiedCountEl) qualifiedCountEl.textContent = data.qualifiedLeads;
      if (clientsCountEl) clientsCountEl.textContent = data.activeClients;
      if (approvalsCountEl) approvalsCountEl.textContent = data.pendingApprovals;

      renderApprovals(data.pendingApprovalList || []);
      renderActivities(data.recentActivity || []);
    } catch (err) {
      if (approvalsContainer) {
        approvalsContainer.innerHTML = `<p class="state-message error-message">Could not load dashboard data: ${err.message}</p>`;
      }
    }
  }

  function renderApprovals(approvals) {
    if (!approvalsContainer) return;
    if (approvals.length === 0) {
      approvalsContainer.innerHTML = "<p class='state-message'>No consequential actions awaiting administrator approval.</p>";
      return;
    }

    const table = document.createElement("table");
    table.className = "data-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Action</th>
          <th>Summary</th>
          <th>Created</th>
          <th style="text-align:right">Decision</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");
    approvals.forEach((appr) => {
      const tr = document.createElement("tr");

      const tdAction = document.createElement("td");
      tdAction.innerHTML = `<strong>${escapeHtml(appr.action_type.replace("_", " ").toUpperCase())}</strong><div class="lead-meta">${escapeHtml(appr.entity_type)}</div>`;
      tr.appendChild(tdAction);

      const tdSummary = document.createElement("td");
      tdSummary.innerHTML = `<div>${escapeHtml(appr.title)}</div><div class="lead-meta">${escapeHtml(appr.summary || "")}</div>`;
      tr.appendChild(tdSummary);

      const tdCreated = document.createElement("td");
      tdCreated.textContent = new Date(appr.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      tr.appendChild(tdCreated);

      const tdActions = document.createElement("td");
      tdActions.style.textAlign = "right";

      const btnGroup = document.createElement("div");
      btnGroup.className = "row-actions";

      const approveBtn = document.createElement("button");
      approveBtn.className = "table-btn primary";
      approveBtn.textContent = "Approve";
      approveBtn.addEventListener("click", () => decideApproval(appr.id, "approved"));

      const rejectBtn = document.createElement("button");
      rejectBtn.className = "table-btn secondary";
      rejectBtn.textContent = "Reject";
      rejectBtn.addEventListener("click", () => decideApproval(appr.id, "rejected"));

      btnGroup.appendChild(approveBtn);
      btnGroup.appendChild(rejectBtn);
      tdActions.appendChild(btnGroup);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    });

    approvalsContainer.innerHTML = "";
    approvalsContainer.appendChild(table);
  }

  async function decideApproval(id, decision) {
    const notes = prompt(`Enter optional decision notes for ${decision}:`) || "";
    try {
      const res = await fetch(`/api/approvals/${id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, decision_notes: notes })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to submit decision");
      }
      loadDashboard();
    } catch (err) {
      alert(`Approval error: ${err.message}`);
    }
  }

  function renderActivities(activities) {
    if (!activityContainer) return;
    if (activities.length === 0) {
      activityContainer.innerHTML = "<p class='state-message'>No activity logged yet.</p>";
      return;
    }

    activityContainer.innerHTML = activities.map((act) => `
      <div class="activity-item">
        <span class="activity-dot"></span>
        <div class="activity-content">
          <p class="activity-desc">${escapeHtml(act.description)}</p>
          <span class="activity-time">${new Date(act.created_at).toLocaleString()}</span>
        </div>
      </div>
    `).join("");
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

  loadDashboard();
});
