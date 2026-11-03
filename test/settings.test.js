const test = require("node:test");
const assert = require("node:assert");
const { testSmtpConnection, getSmtpConfig } = require("../src/services/smtpService");
const { testBufferConnection, getBufferConfig } = require("../src/services/bufferService");
const { listClients, createClient } = require("../src/services/clientsService");
const { setSupabaseClient } = require("../src/config/supabase");

test("Integration Services, Clients and Settings Health", async (t) => {
  t.after(() => {
    setSupabaseClient(null);
  });

  await t.test("reports unconfigured status safely when environment variables are missing", async () => {
    const smtp = getSmtpConfig();
    assert.strictEqual(typeof smtp.isConfigured, "boolean");

    const buffer = getBufferConfig();
    assert.strictEqual(typeof buffer.isConfigured, "boolean");
  });

  await t.test("returns graceful connection test results without crashing", async () => {
    const smtpTest = await testSmtpConnection();
    assert.strictEqual(typeof smtpTest.connected, "boolean");
    assert.strictEqual(typeof smtpTest.message, "string");

    const bufTest = await testBufferConnection();
    assert.strictEqual(typeof bufTest.connected, "boolean");
    assert.strictEqual(typeof bufTest.message, "string");
  });

  await t.test("client validation rejects missing name or company", async () => {
    await assert.rejects(
      async () => {
        await createClient({ name: "" });
      },
      /Client name and company are required/
    );
  });
});
