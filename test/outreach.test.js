// Outreach now uses Gemini directly; keep tests isolated with a mocked Gemini API.
process.env.AI_PROVIDER = "gemini";

const test = require("node:test");
const assert = require("node:assert");
const { generateOutreachDraft, classifyProspectReply } = require("../src/agents/outreachAgent");
const { sendApprovedOutreach } = require("../src/services/outreachService");
const { setSupabaseClient } = require("../src/config/supabase");

test("Outreach and Reply Classification Workflow", async (t) => {
  const originalFetch = global.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "mock-gemini-key";

  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    setSupabaseClient(null);
  });

  await t.test("generates cold outreach email with subject lines and angle", async () => {
    global.fetch = async () => ({
      ok: true,
      async json() {
        return {
          candidates: [{ content: { parts: [{ text: JSON.stringify({
                  subject_lines: ["Quick question regarding dental marketing", "Idea for Apex Dental", "Patient booking opportunity"],
                  selected_subject: "Idea for Apex Dental",
                  email_body: "Hi Dr. Vance, noticed your new clinic in Dallas. We help dental practices add 15-20 implant cases monthly.",
                  angle_used: "High ticket dental implants"
                }) }] } }]
        };
      }
    });

    const draft = await generateOutreachDraft(
      { business_name: "Apex Dental", contact_name: "Dr. Vance", email: "vance@apexdental.com" },
      { summary: "Cosmetic dentistry in Dallas", marketing_opportunities: ["Implants"], suggested_smma_services: ["Meta Ads"] }
    );

    assert.strictEqual(draft.subject, "Idea for Apex Dental");
    assert.strictEqual(draft.subject_lines.length, 3);
    assert.ok(draft.body.includes("Dr. Vance"));
  });

  await t.test("classifies prospect reply sentiment accurately", async () => {
    global.fetch = async () => ({
      ok: true,
      async json() {
        return {
          candidates: [{ content: { parts: [{ text: JSON.stringify({
                  classification: "interested",
                  sentiment_summary: "Prospect wants a call next Tuesday.",
                  recommended_action: "Schedule 15 min discovery call",
                  suggested_follow_up: "Sounds great! Would 2pm Tuesday work for you?"
                }) }] } }]
        };
      }
    });

    const analysis = await classifyProspectReply(
      { subject: "Idea for Apex Dental", message_body: "..." },
      "Hey Jules, we might be interested. Are you free next Tuesday?"
    );

    assert.strictEqual(analysis.classification, "interested");
    assert.ok(analysis.recommended_action.includes("Schedule"));
  });

  await t.test("backend prevents sending email without explicit administrator approval", async () => {
    setSupabaseClient({
      from(table) {
        if (table === "outreach_records") {
          return {
            select(_fields) {
              return {
                eq(_col, _val) {
                  return {
                    maybeSingle: async () => ({
                      data: {
                        id: "outreach-123",
                        recipient: "test@example.com",
                        subject: "Hello",
                        message_body: "Body",
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
                                      data: { id: "appr-1", status: "pending" },
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
        await sendApprovedOutreach("outreach-123");
      },
      /Backend Approval Error/
    );
  });
});
