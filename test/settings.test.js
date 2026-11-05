const test = require("node:test");
const assert = require("node:assert");
const { testBirdConnection, getBirdConfig } = require("../src/services/smtpService");
const { testBufferConnection, getBufferConfig } = require("../src/services/bufferService");
const { createClient } = require("../src/services/clientsService");
const { setSupabaseClient } = require("../src/config/supabase");

test("Integration Services, Clients and Settings Health", async (t) => {
  t.after(() => {
    setSupabaseClient(null);
  });

  await t.test("reports unconfigured status safely when environment variables are missing", async () => {
    const bird = getBirdConfig();
    assert.strictEqual(typeof bird.isConfigured, "boolean");

    const buffer = getBufferConfig();
    assert.strictEqual(typeof buffer.isConfigured, "boolean");
  });

  await t.test("returns graceful connection test results without crashing", async () => {
    // Keep this test deterministic and prevent it from making a live Bird API call.
    const previousBirdApiKey = process.env.BIRD_API_KEY;
    const previousBirdFromEmail = process.env.BIRD_FROM_EMAIL;
    delete process.env.BIRD_API_KEY;
    delete process.env.BIRD_FROM_EMAIL;

    try {
      const birdTest = await testBirdConnection();
      assert.strictEqual(birdTest.connected, false);
      assert.strictEqual(typeof birdTest.message, "string");
      assert.match(birdTest.message, /Bird is not fully configured/i);
    } finally {
      if (previousBirdApiKey === undefined) delete process.env.BIRD_API_KEY;
      else process.env.BIRD_API_KEY = previousBirdApiKey;

      if (previousBirdFromEmail === undefined) delete process.env.BIRD_FROM_EMAIL;
      else process.env.BIRD_FROM_EMAIL = previousBirdFromEmail;
    }

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
