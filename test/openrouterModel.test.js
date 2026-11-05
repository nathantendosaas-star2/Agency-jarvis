"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_OPENROUTER_MODEL,
  getSelectedOpenRouterModel,
  callOpenRouterProvider
} = require("../src/services/openrouterService");

test("OpenRouter defaults to openrouter/free and sends the resolved model", async (t) => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_MODEL;
  const originalFetch = global.fetch;

  t.after(() => {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = originalModel;
    global.fetch = originalFetch;
  });

  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  delete process.env.OPENROUTER_MODEL;

  assert.equal(DEFAULT_OPENROUTER_MODEL, "openrouter/free");
  assert.equal(getSelectedOpenRouterModel(), "openrouter/free");

  let requestBody;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "PONG" } }]
      })
    };
  };

  const response = await callOpenRouterProvider({
    messages: [{ role: "user", content: "Reply PONG" }],
    maxTokens: 10
  });

  assert.equal(response, "PONG");
  assert.equal(requestBody.model, "openrouter/free");
});

test("OpenRouter uses the configured model when explicitly set", () => {
  const previousModel = process.env.OPENROUTER_MODEL;
  process.env.OPENROUTER_MODEL = "openrouter/free";
  try {
    assert.equal(getSelectedOpenRouterModel(), "openrouter/free");
  } finally {
    if (previousModel === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = previousModel;
  }
});
