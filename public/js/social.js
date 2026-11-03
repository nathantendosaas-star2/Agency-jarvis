"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const clientSelect = document.getElementById("client-select");
  const platformSelect = document.getElementById("platform-select");
  const objectiveInput = document.getElementById("campaign-objective");
  const generateBtn = document.getElementById("generate-content-btn");
  const socialTbody = document.getElementById("social-tbody");

  const addClientBtn = document.getElementById("add-client-btn");
  const clientModal = document.getElementById("client-modal");
  const clientCloseBtn = document.getElementById("client-close-btn");
  const clientCancelBtn = document.getElementById("client-cancel-btn");
  const clientForm = document.getElementById("client-form");

  const scheduleModal = document.getElementById("schedule-modal");
  const scheduleCloseBtn = document.getElementById("schedule-close-btn");
  const scheduleCancelBtn = document.getElementById("schedule-cancel-btn");
  const scheduleForm = document.getElementById("schedule-form");
  const schedulePostId = document.getElementById("schedule-post-id");
  const bufferChannelSelect = document.getElementById("buffer-channel-select");
  const scheduleDatetime = document.getElementById("schedule-datetime");

  async function init() {
    await Promise.all([loadClients(), loadSocialContent(), loadBufferChannels()]);
  }

  async function loadClients() {
    try {
      const res = await fetch("/api/clients");
      if (!res.ok) return;
      const data = await res.json();
      const clients = data.clients || [];

      clientSelect.innerHTML = `<option value="">-- Select Client --</option>`;
      clients.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = `${c.company} (${c.name})`;
        clientSelect.appendChild(opt);
      });
    } catch {
      clientSelect.innerHTML = `<option value="">Failed to load clients</option>`;
    }
  }

  async function loadBufferChannels() {
    try {
      const res = await fetch("/api/social/buffer-channels");
      if (!res.ok) return;
      const data = await res.json();
      const profiles = data.profiles || [];

      if (profiles.length === 0) {
        bufferChannelSelect.innerHTML = `<option value="">No Buffer channels connected (check Settings)</option>`;
      } else {
        bufferChannelSelect.innerHTML = `<option value="">-- Choose Channel --</option>`;
        profiles.forEach((p) => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = `${p.service.toUpperCase()}: ${p.service_username || p.formatted_username || p.id}`;
          bufferChannelSelect.appendChild(opt);
        });
      }
    } catch {
      bufferChannelSelect.innerHTML = `<option value="">Buffer unconfigured</option>`;
    }
  }

  generateBtn.addEventListener("click", async () => {
    generateBtn.disabled = true;
    generateBtn.textContent = "Generating Posts…";

    try {
      const res = await fetch("/api/social/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientSelect.value || undefined,
          platform: platformSelect.value,
          objective: objectiveInput.value.trim() || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate posts");

      alert(`Successfully generated ${(data.posts || []).length} post drafts! Review and submit for approval below.`);
      loadSocialContent();
    } catch (err) {
      alert(`Generation error: ${err.message}`);
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = "Generate Posts with OpenRouter";
    }
  });

  async function loadSocialContent() {
    try {
      const res = await fetch("/api/social?limit=50");
      if (!res.ok) throw new Error("Failed to load social posts");
      const data = await res.json();
      renderSocialPosts(data.content || []);
    } catch (err) {
      socialTbody.innerHTML = `<tr><td colspan="5" class="state-message error-message">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderSocialPosts(posts) {
    if (posts.length === 0) {
      socialTbody.innerHTML = `<tr><td colspan="5" class="state-message">No social content drafted or scheduled yet.</td></tr>`;
      return;
    }

    socialTbody.innerHTML = "";
    posts.forEach((p) => {
      const tr = document.createElement("tr");

      // Client
      const tdClient = document.createElement("td");
      tdClient.innerHTML = `<strong>${escapeHtml(p.clients?.company || "General Brand")}</strong><div class="lead-meta">${escapeHtml(p.clients?.name || "")}</div>`;
      tr.appendChild(tdClient);

      // Platform / Title
      const tdTitle = document.createElement("td");
      const platformName = (p.platforms && p.platforms[0]) || "social";
      tdTitle.innerHTML = `<span class="status-badge" style="background:#17283c;color:#93c5fd">${escapeHtml(platformName.toUpperCase())}</span><div style="font-weight:600;margin-top:4px">${escapeHtml(p.title)}</div>`;
      tr.appendChild(tdTitle);

      // Content snippet
      const tdContent = document.createElement("td");
      tdContent.innerHTML = `<div class="lead-meta" style="max-width:320px;white-space:pre-wrap">${escapeHtml(p.content.slice(0, 140))}…</div>`;
      tr.appendChild(tdContent);

      // Status
      const tdStatus = document.createElement("td");
      const badge = document.createElement("span");
      let statusClass = "status-new";
      if (p.status === "scheduled") statusClass = "status-contacted";
      if (p.status === "published") statusClass = "status-converted";
      if (p.status === "failed") statusClass = "status-disqualified";
      badge.className = `status-badge ${statusClass}`;
      badge.textContent = p.status.toUpperCase();
      tdStatus.appendChild(badge);
      tr.appendChild(tdStatus);

      // Actions
      const tdAction = document.createElement("td");
      tdAction.style.textAlign = "right";
      const actionGroup = document.createElement("div");
      actionGroup.className = "row-actions";

      if (p.status === "draft") {
        const apprBtn = document.createElement("button");
        apprBtn.className = "table-btn secondary";
        apprBtn.textContent = "Request Approval";
        apprBtn.addEventListener("click", () => requestApproval(p.id));
        actionGroup.appendChild(apprBtn);

        const schedBtn = document.createElement("button");
        schedBtn.className = "table-btn primary";
        schedBtn.textContent = "Schedule to Buffer";
        schedBtn.addEventListener("click", () => openScheduleModal(p.id));
        actionGroup.appendChild(schedBtn);
      }

      tdAction.appendChild(actionGroup);
      tr.appendChild(tdAction);
      socialTbody.appendChild(tr);
    });
  }

  async function requestApproval(id) {
    try {
      const res = await fetch(`/api/social/${id}/request-approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Approval request failed");
      }
      alert("Social post submitted for administrator approval! Approve it on the Dashboard before scheduling.");
    } catch (err) {
      alert(`Approval error: ${err.message}`);
    }
  }

  function openScheduleModal(id) {
    schedulePostId.value = id;
    scheduleModal.classList.remove("hidden");
  }

  if (addClientBtn) addClientBtn.addEventListener("click", () => clientModal.classList.remove("hidden"));
  if (clientCloseBtn) clientCloseBtn.addEventListener("click", () => clientModal.classList.add("hidden"));
  if (clientCancelBtn) clientCancelBtn.addEventListener("click", () => clientModal.classList.add("hidden"));
  if (clientForm) {
    clientForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const res = await fetch("/api/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: document.getElementById("new-client-name").value,
            company: document.getElementById("new-client-company").value,
            industry: document.getElementById("new-client-industry").value,
            website: document.getElementById("new-client-website").value,
            tier: document.getElementById("new-client-tier").value
          })
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to create client");
        }
        clientModal.classList.add("hidden");
        clientForm.reset();
        await loadClients();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  if (scheduleCloseBtn) scheduleCloseBtn.addEventListener("click", () => scheduleModal.classList.add("hidden"));
  if (scheduleCancelBtn) scheduleCancelBtn.addEventListener("click", () => scheduleModal.classList.add("hidden"));
  if (scheduleForm) {
    scheduleForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const postId = schedulePostId.value;
      const channelId = bufferChannelSelect.value;
      const dt = scheduleDatetime.value;

      if (!channelId) {
        alert("Please select a Buffer channel.");
        return;
      }

      try {
        const res = await fetch(`/api/social/${postId}/schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            buffer_profile_ids: [channelId],
            scheduled_at: dt || null
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Scheduling failed");

        alert("Post scheduled successfully through Buffer API!");
        scheduleModal.classList.add("hidden");
        loadSocialContent();
      } catch (err) {
        alert(`Scheduling error: ${err.message}`);
      }
    });
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

  init();
});
