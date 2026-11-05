"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const leadSelect = document.getElementById("lead-select");
  const generateDraftBtn = document.getElementById("generate-draft-btn");
  const draftWorkspace = document.getElementById("draft-workspace");
  const subjectInput = document.getElementById("draft-subject");
  const subjectChipsContainer = document.getElementById("subject-options-container");
  const bodyTextarea = document.getElementById("draft-body");
  const requestApprovalBtn = document.getElementById("request-approval-btn");
  const outreachTbody = document.getElementById("outreach-tbody");

  const replyModal = document.getElementById("reply-modal");
  const replyCloseBtn = document.getElementById("reply-close-btn");
  const replyCancelBtn = document.getElementById("reply-cancel-btn");
  const replyForm = document.getElementById("reply-form");
  const replyOutreachId = document.getElementById("reply-outreach-id");
  const replyText = document.getElementById("reply-text");

  let currentDraftId = null;
  const manualRecipientForm = document.getElementById("manual-recipient-form");
  const csvFileInput = document.getElementById("recipient-csv-file");
  const csvImportButton = document.getElementById("import-recipient-csv-btn");
  const importStatus = document.getElementById("recipient-import-status");

  async function createRecipientLead(row) {
    const response = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not add recipient");
    return data;
  }

  if (manualRecipientForm) {
    manualRecipientForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = document.getElementById("manual-recipient-submit");
      button.disabled = true;
      try {
        const lead = await createRecipientLead({
          business_name: document.getElementById("manual-business-name").value.trim(),
          contact_name: document.getElementById("manual-contact-name").value.trim(),
          email: document.getElementById("manual-recipient-email").value.trim()
        });
        await loadLeadsForOutreach();
        leadSelect.value = lead.id;
        generateDraftBtn.disabled = false;
        manualRecipientForm.reset();
        alert("Recipient added. Generate the AI email draft when ready.");
      } catch (error) {
        alert("Could not add recipient: " + error.message);
      } finally {
        button.disabled = false;
      }
    });
  }

  function parseRecipientsCsv(text) {
    const lines = text.replace(/\\r/g, "").split("\\n").filter(line => line.trim());
    if (lines.length < 2) throw new Error("CSV must contain a header and at least one row.");
    const split = line => {
      const cells = []; let value = "", quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; }
        else if (ch === '"') quoted = !quoted;
        else if (ch === "," && !quoted) { cells.push(value.trim()); value = ""; }
        else value += ch;
      }
      cells.push(value.trim()); return cells;
    };
    const headers = split(lines.shift()).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
    return lines.map(line => {
      const cells = split(line), row = {};
      headers.forEach((header, index) => { row[header] = cells[index] || ""; });
      return {
        business_name: row.businessname || row.company || row.companyname || row.business || "",
        email: row.email || row.emailaddress || "",
        contact_name: row.contactname || row.name || "",
        website: row.website || "",
        phone: row.phone || "",
        business_category: row.businesscategory || row.category || "",
        location: row.location || "",
        notes: row.notes || ""
      };
    }).filter(row => row.business_name && row.email);
  }

  if (csvImportButton) {
    csvImportButton.addEventListener("click", async () => {
      const file = csvFileInput && csvFileInput.files[0];
      if (!file) { alert("Choose a CSV file first."); return; }
      csvImportButton.disabled = true;
      importStatus.textContent = "Importing…";
      try {
        const rows = parseRecipientsCsv(await file.text());
        if (!rows.length) throw new Error("No valid rows. Each row needs Business Name and Email.");
        let imported = 0, failed = 0;
        for (const row of rows) {
          try { await createRecipientLead(row); imported += 1; }
          catch { failed += 1; }
        }
        await loadLeadsForOutreach();
        importStatus.textContent = imported + " imported; " + failed + " failed.";
      } catch (error) {
        importStatus.textContent = error.message;
      } finally {
        csvImportButton.disabled = false;
      }
    });
  }


  async function init() {
    await Promise.all([loadLeadsForOutreach(), loadOutreachRecords()]);
  }

  async function loadLeadsForOutreach() {
    try {
      const res = await fetch("/api/leads?limit=100");
      if (!res.ok) return;
      const data = await res.json();
      const leads = (data.leads || []).filter((l) => l.email && l.email.trim());

      leadSelect.innerHTML = `<option value="">-- Choose a lead with email --</option>`;
      leads.forEach((l) => {
        const opt = document.createElement("option");
        opt.value = l.id;
        opt.textContent = `${l.business_name || l.company_name} (${l.email}) - Score: ${l.qualification_score || "N/A"}`;
        leadSelect.appendChild(opt);
      });

      leadSelect.addEventListener("change", () => {
        generateDraftBtn.disabled = !leadSelect.value;
      });
    } catch {
      leadSelect.innerHTML = `<option value="">Failed to load leads</option>`;
    }
  }

  generateDraftBtn.addEventListener("click", async () => {
    const leadId = leadSelect.value;
    if (!leadId) return;

    generateDraftBtn.disabled = true;
    generateDraftBtn.textContent = "Drafting with Gemini…";

    try {
      const res = await fetch("/api/outreach/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Draft generation failed");

      currentDraftId = data.id;
      subjectInput.value = data.subject;
      bodyTextarea.value = data.message_body;

      subjectChipsContainer.innerHTML = "";
      (data.alternative_subjects || []).forEach((subj) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "subject-chip";
        chip.textContent = subj;
        chip.addEventListener("click", () => {
          subjectInput.value = subj;
        });
        subjectChipsContainer.appendChild(chip);
      });

      draftWorkspace.classList.remove("hidden");
      loadOutreachRecords();
    } catch (err) {
      alert(`Error generating draft: ${err.message}`);
    } finally {
      generateDraftBtn.disabled = false;
      generateDraftBtn.textContent = "Generate AI Email Draft";
    }
  });

  requestApprovalBtn.addEventListener("click", async () => {
    if (!currentDraftId) return;
    requestApprovalBtn.disabled = true;
    requestApprovalBtn.textContent = "Requesting Approval…";

    try {
      const res = await fetch(`/api/outreach/${currentDraftId}/request-approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to request approval");
      }
      alert("Outreach submitted for administrator approval! Check Dashboard or below.");
      loadOutreachRecords();
    } catch (err) {
      alert(`Approval submission error: ${err.message}`);
    } finally {
      requestApprovalBtn.disabled = false;
      requestApprovalBtn.textContent = "Submit for Approval";
    }
  });

  async function loadOutreachRecords() {
    try {
      const res = await fetch("/api/outreach?limit=50");
      if (!res.ok) throw new Error("Failed to load outreach records");
      const data = await res.json();
      renderOutreachRecords(data.records || []);
    } catch (err) {
      outreachTbody.innerHTML = `<tr><td colspan="5" class="state-message error-message">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderOutreachRecords(records) {
    if (records.length === 0) {
      outreachTbody.innerHTML = `<tr><td colspan="5" class="state-message">No outreach drafted or sent yet.</td></tr>`;
      return;
    }

    outreachTbody.innerHTML = "";
    records.forEach((rec) => {
      const tr = document.createElement("tr");

      // Recipient info
      const tdRec = document.createElement("td");
      tdRec.innerHTML = `<strong>${escapeHtml(rec.leads?.business_name || "Lead")}</strong><div class="lead-meta">${escapeHtml(rec.recipient)}</div>`;
      tr.appendChild(tdRec);

      // Subject
      const tdSub = document.createElement("td");
      tdSub.innerHTML = `<div>${escapeHtml(rec.subject || "No subject")}</div><div class="lead-meta">${escapeHtml((rec.message_body || "").slice(0, 75))}…</div>`;
      tr.appendChild(tdSub);

      // Status
      const tdStat = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `status-badge status-${rec.status}`;
      badge.textContent = rec.status.toUpperCase();
      tdStat.appendChild(badge);
      if (rec.sent_at) {
        const sentTime = document.createElement("div");
        sentTime.className = "lead-meta";
        sentTime.textContent = new Date(rec.sent_at).toLocaleDateString();
        tdStat.appendChild(sentTime);
      }
      tr.appendChild(tdStat);

      // Follow-up / Reply
      const tdReply = document.createElement("td");
      if (rec.reply_sentiment) {
        tdReply.innerHTML = `<span class="status-badge" style="background:#241d33;color:#d8b4fe">${escapeHtml(rec.reply_sentiment.toUpperCase())}</span><div class="lead-meta">${escapeHtml(rec.follow_up_recommendation || "")}</div>`;
      } else {
        tdReply.textContent = "No reply yet";
      }
      tr.appendChild(tdReply);

      // Actions
      const tdAct = document.createElement("td");
      tdAct.style.textAlign = "right";
      const actionGroup = document.createElement("div");
      actionGroup.className = "row-actions";

      if (rec.status === "draft") {
        const sendBtn = document.createElement("button");
        sendBtn.className = "table-btn primary";
        sendBtn.textContent = "Send via SMTP";
        sendBtn.addEventListener("click", () => sendEmail(rec.id));
        actionGroup.appendChild(sendBtn);
      }

      if (rec.status === "sent") {
        const replyBtn = document.createElement("button");
        replyBtn.className = "table-btn secondary";
        replyBtn.textContent = "Record Reply";
        replyBtn.addEventListener("click", () => openReplyModal(rec.id));
        actionGroup.appendChild(replyBtn);
      }

      tdAct.appendChild(actionGroup);
      tr.appendChild(tdAct);
      outreachTbody.appendChild(tr);
    });
  }

  async function sendEmail(outreachId) {
    if (!confirm("Send this email through the configured SMTP server? (Requires administrator approval)")) return;
    try {
      const res = await fetch(`/api/outreach/${outreachId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sending email failed");
      alert(data.sendResult?.simulated ? "Simulated email sent successfully (Sandbox Mode)!" : "Email dispatched successfully!");
      loadOutreachRecords();
    } catch (err) {
      alert(`Send failed: ${err.message}`);
    }
  }

  function openReplyModal(id) {
    replyOutreachId.value = id;
    replyText.value = "";
    replyModal.classList.remove("hidden");
  }

  if (replyCloseBtn) replyCloseBtn.addEventListener("click", () => replyModal.classList.add("hidden"));
  if (replyCancelBtn) replyCancelBtn.addEventListener("click", () => replyModal.classList.add("hidden"));
  if (replyForm) {
    replyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = replyOutreachId.value;
      const content = replyText.value.trim();
      if (!content) return;

      try {
        const res = await fetch(`/api/outreach/${id}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply_content: content })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to classify reply");
        alert(`Reply Classified as: ${data.analysis.classification.toUpperCase()}\n\nRecommended Action:\n${data.analysis.recommended_action}`);
        replyModal.classList.add("hidden");
        loadOutreachRecords();
      } catch (err) {
        alert(err.message);
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
