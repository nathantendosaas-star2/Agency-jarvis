"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const workbenchForm = document.getElementById("workbench-form");
  const taskPrompt = document.getElementById("task-prompt");
  const taskTypeSelect = document.getElementById("task-type-select");
  const runTaskBtn = document.getElementById("run-task-btn");

  const deliverableCard = document.getElementById("deliverable-card");
  const deliverableTitle = document.getElementById("deliverable-title");
  const deliverableContent = document.getElementById("deliverable-content");
  const deliverablePreview = document.getElementById("deliverable-preview");
  const copyBtn = document.getElementById("copy-deliverable-btn");
  const downloadBtn = document.getElementById("download-deliverable-btn");

  const tasksTbody = document.getElementById("tasks-tbody");
  let activeDeliverableText = "";
  let activeDeliverableType = "markdown";
  let activeTaskId = null;

  async function loadTasks() {
    try {
      const res = await fetch("/api/workbench?limit=20");
      if (!res.ok) throw new Error("Failed to load workbench history");
      const data = await res.json();
      const tasks = data.tasks || [];
      renderTasks(tasks);
      if (activeTaskId) {
        const activeTask = tasks.find((task) => task.id === activeTaskId);
        if (activeTask?.status === "completed" && activeTask.result) {
          displayDeliverable(activeTask.task_type, activeTask.result, activeTask.metadata || {});
          activeTaskId = null;
          runTaskBtn.disabled = false;
          runTaskBtn.textContent = "Execute Task with Jarvis";
        } else if (activeTask?.status === "failed") {
          alert("Workbench task failed: " + (activeTask.error_message || "Unknown error"));
          activeTaskId = null;
          runTaskBtn.disabled = false;
          runTaskBtn.textContent = "Execute Task with Jarvis";
        }
      }
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
        viewBtn.addEventListener("click", () => displayDeliverable(t.task_type, t.result, t.metadata || {}));
        tdAction.appendChild(viewBtn);
      }
      tr.appendChild(tdAction);

      tasksTbody.appendChild(tr);
    });
  }

  function displayDeliverable(type, content, metadata = {}) {
    activeDeliverableText = content;
    activeDeliverableType = metadata.artifact_type === "html" || type === "landing_page" ? "html" : "markdown";
    deliverableTitle.textContent = activeDeliverableType === "html" ? "GENERATED HTML LANDING PAGE" : `${type.replace("_", " ").toUpperCase()} DELIVERABLE`;
    if (activeDeliverableType === "html") {
      deliverableContent.classList.add("hidden");
      deliverablePreview.classList.remove("hidden");
      deliverablePreview.srcdoc = content;
      downloadBtn.textContent = "Download HTML";
    } else {
      deliverablePreview.classList.add("hidden");
      deliverablePreview.srcdoc = "about:blank";
      deliverableContent.classList.remove("hidden");
      deliverableContent.textContent = content;
      downloadBtn.textContent = "Download Markdown";
    }
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
        displayDeliverable(data.task_type, data.result, data.metadata || {});
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
    const isHtml = activeDeliverableType === "html";
    const blob = new Blob([activeDeliverableText], { type: isHtml ? "text/html" : "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = isHtml ? `landing-page-${Date.now()}.html` : `deliverable-${Date.now()}.md`;
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
