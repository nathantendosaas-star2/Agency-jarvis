const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyApprovalGranted, claimApprovalForExecution } = require("../src/services/approvalService");
const { setSupabaseClient } = require("../src/config/supabase");

test("external actions fail closed without a persistent approval database", async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  setSupabaseClient(null);
  try {
    assert.equal(await verifyApprovalGranted("outreach", "record-1", "send_email"), false);
    assert.equal(await claimApprovalForExecution("outreach", "record-1", "send_email"), null);
  } finally {
    if (url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = url;
    if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    setSupabaseClient(null);
  }
});
