"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const badgeSupabase = document.getElementById("badge-supabase");
  const badgeAI = document.getElementById("badge-ai");
  const badgeTavily = document.getElementById("badge-tavily");
  const badgeSmtp = document.getElementById("badge-smtp");
  const badgeBuffer = document.getElementById("badge-buffer");
  const badgeSheets = document.getElementById("badge-sheets");

  const testSupabaseBtn = document.getElementById("test-supabase-btn");
  const testAIButton = document.getElementById("test-ai-btn");
  const testTavilyBtn = document.getElementById("test-tavily-btn");
  const testSmtpBtn = document.getElementById("test-smtp-btn");
  const testBufferBtn = document.getElementById("test-buffer-btn");

  const resSupabase = document.getElementById("res-supabase");
  const resAI = document.getElementById("res-ai");
  const resTavily = document.getElementById("res-tavily");
  const resSmtp = document.getElementById("res-smtp");
  const resBuffer = document.getElementById("res-buffer");

  async function loadConfigStatus() {
    try {
      const res = await fetch("/api/settings/status");
      if (!res.ok) throw new Error("Could not load configuration status");
      const data = await res.json();

      updateBadge(badgeSupabase, data.supabase?.configured);
      updateBadge(badgeAI, data.ai?.configured);
      updateBadge(badgeTavily, data.tavily?.configured);
      updateBadge(badgeSmtp, data.smtp?.configured);
      updateBadge(badgeBuffer, data.buffer?.configured);
      updateBadge(badgeSheets, data.googleSheets?.configured);
    } catch {
      // Failed to load status
    }
  }

  function updateBadge(el, isConfigured) {
    if (!el) return;
    if (isConfigured) {
      el.className = "status-badge status-converted";
      el.textContent = "CONFIGURED";
    } else {
      el.className = "status-badge status-disqualified";
      el.textContent = "UNCONFIGURED";
    }
  }

  function bindTest(btn, resultEl, endpoint) {
    if (!btn) return;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      resultEl.textContent = "Testing…";
      resultEl.className = "test-result-text";

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        });
        const data = await res.json();
        resultEl.textContent = data.message || (data.success ? "Success" : "Failed");
        resultEl.className = `test-result-text ${data.success ? "status-success" : "status-error"}`;
      } catch (err) {
        resultEl.textContent = `Error: ${err.message}`;
        resultEl.className = "test-result-text status-error";
      } finally {
        btn.disabled = false;
      }
    });
  }

  bindTest(testSupabaseBtn, resSupabase, "/api/settings/test/supabase");
  bindTest(testAIButton, resAI, "/api/settings/test/ai");
  bindTest(testTavilyBtn, resTavily, "/api/settings/test/tavily");
  bindTest(testSmtpBtn, resSmtp, "/api/settings/test/smtp");
  bindTest(testBufferBtn, resBuffer, "/api/settings/test/buffer");

  loadConfigStatus();
});
