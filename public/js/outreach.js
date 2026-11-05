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
  const filterOutreachChannel = document.getElementById("filter-outreach-channel");
  const refreshOutreachBtn = document.getElementById("refresh-outreach-btn");

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
    const fetchFn = window.apiFetch ? window.apiFetch : fetch;
    const response = await fetchFn("/api/leads", {
      method: "POST",
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
          email: document.getElementById("manual-recipient-email").value.trim(),
          outreach_channel: "gmail"
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
    const lines = text.replace(/\r/g, "").split("\n").filter((line) => line.trim());
    if (lines.length < 2) throw new Error("CSV must contain a header and at least one row.");
    const split = (line) => {
      const cells = [];
      let value = "", quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"' && quoted && line[i + 1] === '"') {
          value += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = !quoted;
        } else if (ch === "," && !quoted) {
          cells.push(value.trim());
          value = "";
        } else {
          value += ch;
        }
      }
      cells.push(value.trim());
      return cells;
    };
    const headers = split(lines.shift()).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
    return lines.map((line) => {
      const cells = split(line), row = {};
      headers.forEach((header, index) => { row[header] = cells[index] || ""; });
      return {
        business_name: row.businessname || row.company || row.companyname || row.business || "",
        email: row.email || row.emailaddress || "",
        contact_name: row.contactname || row.name || "",
        website: row.website || "",
        phone: row.phone || "",
        instagram: row.instagram || row.instagramhandle || row.handle || "",
        business_category: row.businesscategory || row.category || "",
        location: row.location || "",
        notes: row.notes || "",
        outreach_channel: row.outreachchannel || row.channel || "gmail"
      };
    }).filter((row) => row.business_name);
  }

  if (csvImportButton) {
    csvImportButton.addEventListener("click", async () => {
      const file = csvFileInput && csvFileInput.files[0];
      if (!file) { alert("Choose a CSV file first."); return; }
      csvImportButton.disabled = true;
      importStatus.textContent = "Importing…";
      try {
        const rows = parseRecipientsCsv(await file.text());
        if (!rows.length) throw new Error("No valid rows found in CSV.");
        let imported = 0, failed = 0;
        for (const row of rows) {
          try {
            await createRecipientLead(row);
            imported += 1;
          } catch {
            failed += 1;
          }
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
      const fetchFn = window.apiFetch ? window.apiFetch : fetch;
      const res = await fetchFn("/api/leads?limit=100");
      if (!res.ok) return;
      const data = await res.json();
      const leads = (data.leads || []).filter((l) => l.email || l.phone || l.instagram);

      leadSelect.innerHTML = `<option value="">-- Choose a prospect lead --</option>`;
      leads.forEach((l) => {
        const opt = document.createElement("option");
        opt.value = l.id;
        const channelLabel = (l.outreach_channel || "gmail").toUpperCase();
        opt.textContent = `${l.business_name || l.company_name} [${channelLabel}] - Score: ${l.qualification_score || "N/A"}`;
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
    generateDraftBtn.textContent = "Drafting with Gemini 3.5 Flash Lite…";

    try {
      const fetchFn = window.apiFetch ? window.apiFetch : fetch;
      const res = await fetchFn("/api/outreach/draft", {
        method: "POST",
        body: JSON.stringify({
          lead_id: leadId,
          email_brief: document.getElementById("email-brief")?.value.trim() || ""
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Draft generation failed");

      currentDraftId = data.id;
      subjectInput.value = data.subject || "";
      bodyTextarea.value = data.message_body || data.body || "";

      subjectChipsContainer.innerHTML = "";
      if (Array.isArray(data.alternative_subjects) && data.alternative_subjects.length) {
        data.alternative_subjects.forEach((subj) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "subject-chip";
          chip.textContent = subj;
          chip.addEventListener("click", () => {
            subjectInput.value = subj;
          });
          subjectChipsContainer.appendChild(chip);
        });
      }

      draftWorkspace.classList.remove("hidden");
      loadOutreachRecords();
    } catch (err) {
      alert(`Error generating draft: ${err.message}`);
    } finally {
      generateDraftBtn.disabled = false;
      generateDraftBtn.textContent = "Generate AI Outreach Draft";
    }
  });

  requestApprovalBtn.addEventListener("click", async () => {
    if (!currentDraftId) return;
    requestApprovalBtn.disabled = true;
    requestApprovalBtn.textContent = "Submitting…";

    try {
      const fetchFn = window.apiFetch ? window.apiFetch : fetch;
      const res = await fetchFn(`/api/outreach/${currentDraftId}/request-approval`, {
        method: "POST"
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to request approval");
      }
      alert("Outreach submitted for administrator approval! Check below or Dashboard.");
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
      const fetchFn = window.apiFetch ? window.apiFetch : fetch;
      const res = await fetchFn("/api/outreach?limit=100");
      if (!res.ok) throw new Error("Failed to load outreach records");
      const data = await res.json();
      renderOutreachRecords(data.records || []);
    } catch (err) {
      outreachTbody.innerHTML = `<tr><td colspan="5" class="state-message error-message">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderOutreachRecords(records) {
    const selectedChannel = filterOutreachChannel ? filterOutreachChannel.value : "";
    const filtered = selectedChannel
      ? records.filter((r) => (r.channel || "gmail").toLowerCase() === selectedChannel.toLowerCase())
      : records;

    if (filtered.length === 0) {
      outreachTbody.innerHTML = `<tr><td colspan="5" class="state-message">No outreach records matching criteria.</td></tr>`;
      return;
    }

    outreachTbody.innerHTML = "";
    filtered.forEach((rec) => {
      const tr = document.createElement("tr");
      const channel = (rec.channel || "gmail").toLowerCase();

      // Lead & Channel
      const tdRec = document.createElement("td");
      const chBadge = document.createElement("span");
      chBadge.className = "status-badge";
      chBadge.style.marginRight = "6px";
      chBadge.style.fontSize = "10px";
      if (channel === "instagram") {
        chBadge.style.background = "#3b1732";
        chBadge.style.color = "#f472b6";
        chBadge.textContent = "INSTAGRAM";
      } else if (channel === "whatsapp") {
        chBadge.style.background = "#142d20";
        chBadge.style.color = "#4ade80";
        chBadge.textContent = "WHATSAPP";
      } else {
        chBadge.style.background = "#1e293b";
        chBadge.style.color = "#93c5fd";
        chBadge.textContent = "GMAIL";
      }

      tdRec.appendChild(chBadge);
      const nameSpan = document.createElement("strong");
      nameSpan.textContent = rec.leads?.business_name || "Lead";
      tdRec.appendChild(nameSpan);

      const contactMeta = document.createElement("div");
      contactMeta.className = "lead-meta";
      contactMeta.textContent = rec.recipient || "No recipient address";
      tdRec.appendChild(contactMeta);
      tr.appendChild(tdRec);

      // Subject / Message
      const tdSub = document.createElement("td");
      if (rec.subject) {
        const subjDiv = document.createElement("div");
        subjDiv.style.fontWeight = "600";
        subjDiv.textContent = rec.subject;
        tdSub.appendChild(subjDiv);
      }
      const bodyDiv = document.createElement("div");
      bodyDiv.className = "lead-meta";
      bodyDiv.textContent = (rec.message_body || rec.body || "").slice(0, 95) + "…";
      tdSub.appendChild(bodyDiv);
      tr.appendChild(tdSub);

      // Approval & Model Metadata
      const tdStat = document.createElement("td");
      const isApproved = rec.approval_status === "approved" || rec.status === "approved" || rec.is_auto_approved;

      const badge = document.createElement("span");
      badge.className = `status-badge ${isApproved ? "status-approved" : "status-" + rec.status}`;
      badge.textContent = isApproved ? "APPROVED" : (rec.status || "DRAFT").toUpperCase();
      tdStat.appendChild(badge);

      if (rec.is_auto_approved) {
        const autoLabel = document.createElement("div");
        autoLabel.className = "lead-meta";
        autoLabel.style.color = "#a7f3d0";
        autoLabel.textContent = "⚡ Auto-approved";
        tdStat.appendChild(autoLabel);
      }

      const modelMeta = document.createElement("div");
      modelMeta.className = "lead-meta";
      modelMeta.textContent = rec.model_used || "gemini-3.5-flash-lite";
      tdStat.appendChild(modelMeta);
      tr.appendChild(tdStat);

      // Follow-up / Reply
      const tdReply = document.createElement("td");
      if (rec.reply_sentiment) {
        tdReply.innerHTML = `<span class="status-badge" style="background:#241d33;color:#d8b4fe">${escapeHtml(rec.reply_sentiment.toUpperCase())}</span><div class="lead-meta">${escapeHtml(rec.follow_up_recommendation || "")}</div>`;
      } else {
        tdReply.textContent = "—";
      }
      tr.appendChild(tdReply);

      // Actions
      const tdAct = document.createElement("td");
      tdAct.style.textAlign = "right";
      const actionGroup = document.createElement("div");
      actionGroup.className = "row-actions";
      actionGroup.style.justifyContent = "flex-end";

      // One-click Copy Message Button (for all channels)
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "table-btn secondary";
      copyBtn.textContent = "Copy Message";
      copyBtn.addEventListener("click", () => {
        const textToCopy = rec.message_body || rec.body || "";
        navigator.clipboard.writeText(textToCopy).then(() => {
          const original = copyBtn.textContent;
          copyBtn.textContent = "✓ Copied!";
          setTimeout(() => { copyBtn.textContent = original; }, 1800);
        }).catch(() => {
          alert("Could not copy message automatically.");
        });
      });
      actionGroup.appendChild(copyBtn);

      // Channel-specific Prefilled Action
      if (channel === "gmail") {
        const gmailBtn = document.createElement("button");
        gmailBtn.type = "button";
        gmailBtn.className = "table-btn primary";
        gmailBtn.textContent = "Open in Gmail";
        gmailBtn.addEventListener("click", () => openGmailCompose(rec));
        actionGroup.appendChild(gmailBtn);
      } else if (channel === "instagram") {
        const igBtn = document.createElement("button");
        igBtn.type = "button";
        igBtn.className = "table-btn primary";
        igBtn.textContent = "Open Instagram";
        igBtn.addEventListener("click", () => openInstagramProfile(rec));
        actionGroup.appendChild(igBtn);
      } else if (channel === "whatsapp") {
        const waBtn = document.createElement("button");
        waBtn.type = "button";
        waBtn.className = "table-btn primary";
        waBtn.textContent = "Open WhatsApp";
        waBtn.addEventListener("click", () => openWhatsAppChat(rec));
        actionGroup.appendChild(waBtn);
      }

      tdAct.appendChild(actionGroup);
      tr.appendChild(tdAct);
      outreachTbody.appendChild(tr);
    });
  }

  function openGmailCompose(record) {
    const recipient = String(record.recipient || "").trim();
    const subject = String(record.subject || "").trim();
    const body = String(record.message_body || record.body || "").trim();
    if (!recipient || !body) {
      alert("This outreach record is missing a recipient or message body.");
      return;
    }
    const params = new URLSearchParams({ view: "cm", fs: "1", to: recipient, su: subject, body });
    const link = document.createElement("a");
    link.href = "https://mail.google.com/mail/?" + params.toString();
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
  }

  function openInstagramProfile(record) {
    let handleOrUrl = String(record.recipient || record.leads?.instagram || "").trim();
    if (!handleOrUrl || handleOrUrl === "Instagram Lead") {
      alert("No Instagram handle or profile URL recorded for this lead. Use 'Copy Message' to send the DM manually.");
      return;
    }

    let url = handleOrUrl;
    if (!url.startsWith("http")) {
      const cleanHandle = handleOrUrl.replace(/^@/, "");
      url = `https://instagram.com/${cleanHandle}`;
    }

    // Copy message to clipboard first for convenience
    const body = record.message_body || record.body || "";
    if (body) {
      navigator.clipboard.writeText(body).catch(() => {});
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  function openWhatsAppChat(record) {
    const rawPhone = String(record.recipient || record.leads?.phone || "").trim();
    const cleanPhone = rawPhone.replace(/[^0-9]/g, "");
    if (!cleanPhone) {
      alert("No valid phone number recorded for this WhatsApp lead.");
      return;
    }

    const body = String(record.message_body || record.body || "").trim();
    const encodedText = encodeURIComponent(body);
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodedText}`;

    window.open(waUrl, "_blank", "noopener,noreferrer");
  }

  if (filterOutreachChannel) {
    filterOutreachChannel.addEventListener("change", loadOutreachRecords);
  }
  if (refreshOutreachBtn) {
    refreshOutreachBtn.addEventListener("click", loadOutreachRecords);
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
