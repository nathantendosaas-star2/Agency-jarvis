// These tests mock OpenRouter responses; do not use the production Gemini default.
process.env.AI_PROVIDER = "openrouter";

const test = require("node:test");
const assert = require("node:assert");
const { generateSocialContent } = require("../src/agents/socialAgent");
const { scheduleApprovedSocialPost } = require("../src/services/socialService");
const { setSupabaseClient } = require("../src/config/supabase");

test("Social Studio and Publishing Tests", async (t) => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "mock-openrouter-key";

  t.after(() => {
    global.fetch = originalFetch;
    process.env.OPENROUTER_API_KEY = originalKey;
    setSupabaseClient(null);
  });

  await t.test("generates platform-specific social concepts", async () => {
    global.fetch = async () => ({
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  content_ideas: [
                    {
                      title: "3 signs your business is losing leads",
                      platform: "linkedin",
                      objective: "lead_generation",
                      hook: "Are you losing 40% of dental inquiries?",
                      caption: "Full caption copy...",
                      hashtags: ["#DentalMarketing", "#SMMA"],
                      media_description: "Chart image"
                    }
                  ],
                  strategy_notes: "Focus on authority hooks."
                })
              }
            }
          ]
        };
      }
    });

    const res = await generateSocialContent({ company: "Apex Dental", industry: "Dentistry" }, "Lead Gen", "linkedin");
    assert.strictEqual(res.content_ideas.length, 1);
    assert.strictEqual(res.content_ideas[0].platform, "linkedin");
    assert.ok(res.content_ideas[0].hashtags.includes("#DentalMarketing"));
  });

  await t.test("backend prevents scheduling without administrator approval", async () => {
    setSupabaseClient({
      from(table) {
        if (table === "social_content") {
          return {
            select(_fields) {
              return {
                eq(_col, _val) {
                  return {
                    maybeSingle: async () => ({
                      data: {
                        id: "social-post-1",
                        title: "Post",
                        content: "Social content",
                        status: "draft"
                      },
                      error: null
                    })
                  };
                }
              };
            }
          };
        }
        if (table === "approvals") {
          return {
            select(_fields) {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        eq() {
                          return {
                            order() {
                              return {
                                limit() {
                                  return {
                                    maybeSingle: async () => ({
                                      data: { id: "appr-soc-1", status: "rejected" },
                                      error: null
                                    })
                                  };
                                }
                              };
                            }
                          };
                        }
                      };
                    }
                  };
                }
              };
            }
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      }
    });

    await assert.rejects(
      async () => {
        await scheduleApprovedSocialPost("social-post-1", ["buffer-profile-1"]);
      },
      /Backend Approval Error/
    );
  });
});
