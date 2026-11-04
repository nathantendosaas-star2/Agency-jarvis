process.env.AI_PROVIDER = "openrouter";

const test = require("node:test");
const assert = require("node:assert");
const { executeTask } = require("../src/agents/orchestrator");

test("research returns detailed synthesis and a source appendix from multiple Tavily searches", async (t) => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "mock-openrouter-key";
  const tavilyQueries = [];

  t.after(() => {
    global.fetch = originalFetch;
    process.env.OPENROUTER_API_KEY = originalKey;
  });

  global.fetch = async (url, options = {}) => {
    if (String(url).includes("openrouter.ai")) {
      const payload = JSON.parse(options.body);
      const isPlanner = payload.messages.some((message) => String(message.content).includes("Plan comprehensive web searches"));
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: isPlanner
            ? JSON.stringify({ queries: ["Kampala dental clinics contact details", "Kampala skin clinics Instagram Facebook", "Kampala premium salons spas contacts", "Kampala private medical clinics directory"] })
            : "# Detailed Findings\\n\\n## Lead 1\\nVerified business evidence and full analysis." } } }] };
        }
      };
    }

    if (String(url).includes("api.tavily.com")) {
      const body = JSON.parse(options.body);
      tavilyQueries.push(body.query);
      return {
        ok: true,
        async json() {
          return { results: [{ title: `Result for ${body.query}`, url: `https://example.com/${encodeURIComponent(body.query.slice(0, 12))}`, content: "Detailed extracted business evidence.", raw_content: "Full extracted page content with contact and operating details.", score: 0.9 }] };
        }
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await executeTask({
    taskType: "research",
    prompt: "Find and qualify 50 real SMMA leads in Kampala across dental, medical, aesthetic and salon niches. Include contact data, qualification, top 15 and outreach."
  });

  assert.strictEqual(tavilyQueries.length, 4);
  assert.ok(result.result.includes("# Detailed Findings"));
  assert.ok(result.result.includes("## Retrieved source evidence"));
  assert.ok(result.result.includes("Full extracted page content"));
  assert.ok(result.result.includes("## Search plan"));
});
