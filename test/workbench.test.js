// These tests mock OpenRouter responses; do not use the production Gemini default.
process.env.AI_PROVIDER = "openrouter";

const test = require("node:test");
const assert = require("node:assert");
const { classifyTaskPrompt } = require("../src/agents/orchestrator");
const { runWorkbenchTask } = require("../src/services/workbenchService");
const { setSupabaseClient } = require("../src/config/supabase");

test("Workbench Task Orchestration", async (t) => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "mock-openrouter-key";

  t.after(() => {
    global.fetch = originalFetch;
    process.env.OPENROUTER_API_KEY = originalKey;
    setSupabaseClient(null);
  });

  await t.test("classifies natural language prompts into valid task types", async () => {
    global.fetch = async () => ({
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  task_type: "smma_proposal",
                  reasoning: "Prompt explicitly asks for retainer and pricing proposal.",
                  target_name: "Apex Solar"
                })
              }
            }
          ]
        };
      }
    });

    const result = await classifyTaskPrompt("Draft a 3-tier monthly retainer proposal for Apex Solar");
    assert.strictEqual(result.task_type, "smma_proposal");
  });

  await t.test("executes and saves workbench tasks", async () => {
    global.fetch = async () => ({
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: "# Website Redesign Brief\n\n## Goals\nIncrease conversion."
              }
            }
          ]
        };
      }
    });

    const task = await runWorkbenchTask({
      prompt: "Redesign brief for local dental clinic",
      taskType: "redesign_brief"
    });

    assert.strictEqual(task.status, "completed");
    assert.ok(task.result.includes("Website Redesign Brief"));
  });
});
