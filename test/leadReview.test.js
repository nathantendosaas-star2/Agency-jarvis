const test = require("node:test");
const assert = require("node:assert/strict");

const { researchBusinessWithTavily } = require("../src/services/tavilyService");
const {
  validateEvaluation,
  sanitizeJsonResponse,
  evaluateLeadWithOpenRouter
} = require("../src/services/openrouterService");
const { reviewAndQualifyLead } = require("../src/services/leadReviewService");
const { setSupabaseClient } = require("../src/config/supabase");

test("OpenRouter response parsing and validation", async (t) => {
  await t.test("sanitizes markdown fenced JSON blocks", () => {
    const raw = "```json\n{\"summary\": \"Test summary\"}\n```";
    assert.strictEqual(sanitizeJsonResponse(raw), '{"summary": "Test summary"}');
  });

  await t.test("validates valid qualification payload", () => {
    const validData = {
      summary: "Established roofing contractor in Denver.",
      services_offered: ["Roof Replacement", "Storm Repair"],
      target_market: "Residential homeowners in Denver metro",
      evidence_activity: "Recent 5-star Google reviews from last month",
      marketing_opportunities: ["Lack of video ad campaigns", "No Google Local Services ads"],
      potential_limitations: ["Small service radius"],
      suggested_smma_services: ["Meta Video Ads", "Local SEO"],
      qualification_score: 78,
      qualification_reasoning: "High-ticket service with strong customer satisfaction but zero active paid ad strategy.",
      research_sources: ["https://denverroofing.example.com"]
    };

    const validated = validateEvaluation(validData);
    assert.strictEqual(validated.summary, validData.summary);
    assert.strictEqual(validated.qualification_score, 78);
    assert.strictEqual(validated.suggested_smma_services.length, 2);
  });

  await t.test("throws error if qualification score is invalid or missing", () => {
    assert.throws(
      () => validateEvaluation({ summary: "Test", qualification_score: 150 }),
      /Missing or invalid qualification_score/
    );
    assert.throws(
      () => validateEvaluation({ summary: "Test", qualification_score: -5 }),
      /Missing or invalid qualification_score/
    );
    assert.throws(
      () => validateEvaluation({ summary: "Test", qualification_score: "high" }),
      /Missing or invalid qualification_score/
    );
  });
});

test("Tavily service with mock network", async (t) => {
  const originalFetch = global.fetch;

  t.after(() => {
    global.fetch = originalFetch;
  });

  await t.test("handles search results from Tavily", async () => {
    global.fetch = async (url, opts) => {
      assert.match(url.toString(), /api\.tavily\.com/);
      const reqBody = JSON.parse(opts.body);
      assert.strictEqual(reqBody.query, "Denver Roofing");
      return {
        ok: true,
        async json() {
          return {
            query: "Denver Roofing",
            answer: "Denver Roofing is a licensed contractor.",
            results: [
              {
                title: "Denver Roofing Company",
                url: "https://denverroofing.example.com",
                content: "Providing roofing services for over 15 years."
              }
            ]
          };
        }
      };
    };

    const res = await researchBusinessWithTavily("Denver Roofing", { apiKey: "test-tavily-key" });
    assert.strictEqual(res.query, "Denver Roofing");
    assert.strictEqual(res.sources.length, 1);
    assert.strictEqual(res.sources[0].url, "https://denverroofing.example.com");
  });

  await t.test("handles Tavily error response", async () => {
    global.fetch = async () => ({
      ok: false,
      status: 401,
      async json() {
        return { message: "Invalid API key" };
      }
    });

    await assert.rejects(
      async () => researchBusinessWithTavily("Test", { apiKey: "bad-key" }),
      /Tavily search failed \(401\)/
    );
  });
});

test("Lead Review orchestration workflow with mock db and APIs", async (t) => {
  const originalFetch = global.fetch;

  const mockDb = {
    leads: [
      {
        id: "lead-abc-123",
        business_name: "Bright Dental",
        website: "https://brightdental.com",
        location: "Dallas, TX",
        business_category: "Dentist",
        lead_status: "new",
        research_status: "pending"
      }
    ],
    research: []
  };

  const mockSupabase = {
    from(tableName) {
      if (tableName === "leads") {
        return {
          select() {
            return {
              eq(f, v) {
                const lead = mockDb.leads.find((l) => l[f] === v);
                return {
                  async maybeSingle() {
                    return { data: lead || null, error: null };
                  }
                };
              }
            };
          },
          update(updates) {
            return {
              eq(f, v) {
                const lead = mockDb.leads.find((l) => l[f] === v);
                if (lead) Object.assign(lead, updates);
                return {
                  select() {
                    return {
                      single: async () => ({ data: lead, error: null })
                    };
                  }
                };
              }
            };
          }
        };
      }

      if (tableName === "lead_research") {
        return {
          insert(record) {
            const row = { id: `res-${Date.now()}`, ...record };
            mockDb.research.push(row);
            return {
              select() {
                return {
                  single: async () => ({ data: row, error: null })
                };
              }
            };
          }
        };
      }
      throw new Error(`Unexpected table: ${tableName}`);
    }
  };

  setSupabaseClient(mockSupabase);

  t.after(() => {
    global.fetch = originalFetch;
    setSupabaseClient(null);
  });

  await t.test("orchestrates Tavily and OpenRouter to qualify lead and update status", async () => {
    global.fetch = async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("tavily.com")) {
        return {
          ok: true,
          async json() {
            return {
              query: "Bright Dental",
              answer: "Bright Dental operates in Dallas with 3 dentists.",
              results: [{ title: "Bright Dental Dallas", url: "https://brightdental.com", content: "General and cosmetic dentistry." }]
            };
          }
        };
      }

      if (urlStr.includes("openrouter.ai")) {
        return {
          ok: true,
          async json() {
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      summary: "Cosmetic and family dental practice in Dallas.",
                      services_offered: ["Invisalign", "Teeth Whitening", "Implants"],
                      target_market: "Families and cosmetic patients in Dallas",
                      evidence_activity: "Active practice with current patient scheduling",
                      marketing_opportunities: ["Implants campaign", "Google Ads optimization"],
                      potential_limitations: ["Single location"],
                      suggested_smma_services: ["Meta Lead Ads", "Google Ads"],
                      qualification_score: 82,
                      qualification_reasoning: "High procedure value with clear ads expansion potential.",
                      research_sources: ["https://brightdental.com"]
                    })
                  }
                }
              ]
            };
          }
        };
      }

      throw new Error(`Unhandled fetch url: ${urlStr}`);
    };

    const result = await reviewAndQualifyLead("lead-abc-123", {
      tavilyOptions: { apiKey: "mock-tavily" },
      openrouterOptions: { apiKey: "mock-openrouter" }
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.lead.research_status, "completed");
    assert.strictEqual(result.lead.qualification_score, 82);
    assert.strictEqual(result.lead.lead_status, "researched");
    assert.strictEqual(result.research.qualification_score, 82);
  });
});
