"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const workbenchForm = document.getElementById("workbench-form");
  const taskPrompt = document.getElementById("task-prompt");
  const taskTypeSelect = document.getElementById("task-type-select");
  const runTaskBtn = document.getElementById("run-task-btn");

  const deliverableCard = document.getElementById("deliverable-card");
  const deliverableTitle = document.getElementById("deliverable-title");
  const deliverableContent = document.getElementById("deliverable-content");
  const copyBtn = document.getElementById("copy-deliverable-btn");
  const downloadBtn = document.getElementById("download-deliverable-btn");

  const tasksTbody = document.getElementById("tasks-tbody");
  let activeDeliverableText = "";

  async function loadTasks() {
    try {
      const res = await fetch("/api/workbench?limit=20");
      if (!res.ok) throw new Error("Failed to load workbench history");
      const data = await res.json();
      renderTasks(data.tasks || []);
    } catch (err) {
      tasksTbody.innerHTML = `<tr><td colspan="5" class="state-message error-message">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderTasks(tasks) {
    if (tasks.length === 0) {
      tasksTbody.innerHTML = `<tr><td colspan="5" class="state-message">No workbench tasks executed yet.</td></tr>`;
      return;
    }

    tasksTbody.innerHTML = "";
    tasks.forEach((t) => {
      const tr = document.createElement("tr");

      const tdType = document.createElement("td");
      tdType.innerHTML = `<strong>${escapeHtml(t.task_type.replace("_", " ").toUpperCase())}</strong>`;
      tr.appendChild(tdType);

      const tdPrompt = document.createElement("td");
      tdPrompt.innerHTML = `<div>${escapeHtml(t.prompt.slice(0, 100))}…</div>`;
      tr.appendChild(tdPrompt);

      const tdStatus = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `status-badge status-${t.status === "completed" ? "converted" : "new"}`;
      badge.textContent = t.status.toUpperCase();
      tdStatus.appendChild(badge);
      tr.appendChild(tdStatus);

      const tdTime = document.createElement("td");
      tdTime.textContent = new Date(t.created_at).toLocaleString();
      tr.appendChild(tdTime);

      const tdAction = document.createElement("td");
      tdAction.style.textAlign = "right";

      if (t.result) {
        const viewBtn = document.createElement("button");
        viewBtn.className = "table-btn secondary";
        viewBtn.textContent = "View Deliverable";
        viewBtn.addEventListener("click", () => displayDeliverable(t.task_type, t.result));
        tdAction.appendChild(viewBtn);
      }
      tr.appendChild(tdAction);

      tasksTbody.appendChild(tr);
    });
  }

  function displayDeliverable(type, markdownText) {
    activeDeliverableText = markdownText;
    deliverableTitle.textContent = `${type.replace("_", " ").toUpperCase()} DELIVERABLE`;
    deliverableContent.textContent = markdownText;
    deliverableCard.classList.remove("hidden");
    deliverableCard.scrollIntoView({ behavior: "smooth" });
  }

  workbenchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const prompt = taskPrompt.value.trim();
    if (!prompt) return;

    runTaskBtn.disabled = true;
    runTaskBtn.textContent = "Routing & Generating…";

    try {
      const res = await fetch("/api/workbench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          task_type: taskTypeSelect.value || undefined
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Execution failed");

      if (data.result) {
        displayDeliverable(data.task_type, data.result);
      }
      loadTasks();
    } catch (err) {
      alert(`Task execution error: ${err.message}`);
    } finally {
      runTaskBtn.disabled = false;
      runTaskBtn.textContent = "Execute Task with Jarvis";
    }
  });

  copyBtn.addEventListener("click", () => {
    if (!activeDeliverableText) return;
    navigator.clipboard.writeText(activeDeliverableText);
    copyBtn.textContent = "Copied!";
    setTimeout(() => { copyBtn.textContent = "Copy Text"; }, 1500);
  });

  downloadBtn.addEventListener("click", () => {
    if (!activeDeliverableText) return;
    const blob = new Blob([activeDeliverableText], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `deliverable-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  });

  function escapeHtml(text) {
    if (!text) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  loadTasks();
});
