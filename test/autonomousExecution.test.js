const test = require("node:test");
const assert = require("node:assert/strict");

test("runner rejects missing Supabase credentials", () => {
  const { validateConfig } = require("../scripts/agent-runner");
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    assert.throws(() => validateConfig(), /SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY/);
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});

test("runner rejects non-HTTPS Supabase URLs", () => {
  const { validateConfig } = require("../scripts/agent-runner");
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "http://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  try {
    assert.throws(() => validateConfig(), /HTTPS URL/);
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});
