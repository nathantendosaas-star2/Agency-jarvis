process.env.AI_PROVIDER = "gemini";
process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";

const test = require("node:test");
const assert = require("node:assert");
const { parseCsvText, mapRowToLead, importLeadsFromCsv } = require("../src/services/csvImportService");
const { generateOutreachDraft } = require("../src/agents/outreachAgent");
const {
  processLeadAutonomousWorkflow,
  enqueueLeadJob,
  recoverPendingJobs,
  retryFailedLead
} = require("../src/services/leadPipelineService");
const { setSupabaseClient } = require("../src/config/supabase");

test("Autonomous Lead-to-Outreach Pipeline Suite", async (t) => {
  const originalFetch = global.fetch;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalTavilyKey = process.env.TAVILY_API_KEY;

  process.env.GEMINI_API_KEY = "mock-gemini-key";
  process.env.TAVILY_API_KEY = "mock-tavily-key";

  t.after(() => {
    global.fetch = originalFetch;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;

    if (originalTavilyKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = originalTavilyKey;

    setSupabaseClient(null);
  });

  await t.test("1. CSV import parses multiple leads and maps fields correctly", () => {
    const csvData = `Business Name,Contact Name,Email,Phone,Website,Instagram,Location,Industry,Outreach Channel
Apex Dental,Dr. Sarah Vance,vance@apexdental.com,+15125550199,https://apexdental.com,@apexdental,Austin TX,Dentistry,gmail
Luxe Aesthetics,Elena Rostova,elena@luxeaesthetics.com,+15125550288,https://luxeaesthetics.com,@luxeaesthetics,Austin TX,MedSpa,instagram
Elevate Fitness,Marcus Cole,marcus@elevatefit.com,+15125550377,https://elevatefit.com,@elevatefit,Dallas TX,Fitness,whatsapp`;

    const rows = parseCsvText(csvData);
    assert.strictEqual(rows.length, 3);

    const lead1 = mapRowToLead(rows[0]);
    assert.strictEqual(lead1.business_name, "Apex Dental");
    assert.strictEqual(lead1.contact_name, "Dr. Sarah Vance");
    assert.strictEqual(lead1.email, "vance@apexdental.com");
    assert.strictEqual(lead1.phone, "+15125550199");
    assert.strictEqual(lead1.instagram, "@apexdental");
    assert.strictEqual(lead1.outreach_channel, "gmail");

    const lead2 = mapRowToLead(rows[1]);
    assert.strictEqual(lead2.outreach_channel, "instagram");

    const lead3 = mapRowToLead(rows[2]);
    assert.strictEqual(lead3.outreach_channel, "whatsapp");
  });

  await t.test("2. Duplicate lead detection skips existing leads during CSV import", async () => {
    const memoryLeads = [
      { id: "lead-existing", business_name: "Apex Dental", normalized_website: "apexdental.com", email: "vance@apexdental.com" }
    ];

    setSupabaseClient({
      from(table) {
        if (table === "leads") {
          return {
            select() {
              return {
                eq(_col, val) {
                  return {
                    maybeSingle: async () => ({
                      data: memoryLeads.find((l) => l.normalized_website === val || l.email === val) || null,
                      error: null
                    })
                  };
                },
                ilike(_col, val) {
                  return {
                    maybeSingle: async () => ({
                      data: memoryLeads.find((l) => l.business_name.toLowerCase() === String(val).toLowerCase()) || null,
                      error: null
                    })
                  };
                }
              };
            },
            insert(record) {
              const inserted = { id: `lead-${Date.now()}`, ...record };
              memoryLeads.push(inserted);
              return { select: () => ({ single: async () => ({ data: inserted, error: null }) }) };
            },
            update() {
              return { eq: () => ({ select: () => ({ single: async () => ({ data: {}, error: null }) }) }) };
            }
          };
        }
        if (table === "lead_pipeline_jobs") {
          return {
            select() {
              return {
                eq() {
                  return {
                    in() {
                      return { maybeSingle: async () => ({ data: null, error: null }) };
                    }
                  };
                }
              };
            },
            insert(job) {
              return { select: () => ({ single: async () => ({ data: { id: "job-1", ...job }, error: null }) }) };
            }
          };
        }
        if (table === "activity_logs") {
          return { insert: async () => ({ error: null }) };
        }
        return {};
      }
    });

    const csvData = `Business Name,Email,Website
Apex Dental,vance@apexdental.com,https://apexdental.com
Brand New Business,owner@newbiz.com,https://newbiz.com`;

    const stats = await importLeadsFromCsv(csvData, { defaultChannel: "gmail" });
    assert.strictEqual(stats.totalRows, 2);
    assert.strictEqual(stats.duplicatesSkipped, 1);
    assert.strictEqual(stats.imported, 1);
    assert.strictEqual(stats.leads[0].business_name, "Brand New Business");
  });

  await t.test("3. Outreach channel persistence and validation", () => {
    const raw = {
      businessname: "Zenith Solar",
      channel: "WHATSAPP"
    };
    const lead = mapRowToLead(raw, "gmail");
    assert.strictEqual(lead.outreach_channel, "whatsapp");

    const fallbackRaw = {
      businessname: "Zenith Solar",
      channel: "invalid_channel"
    };
    const fallbackLead = mapRowToLead(fallbackRaw, "instagram");
    assert.strictEqual(fallbackLead.outreach_channel, "instagram");
  });

  await t.test("4. Gemini outreach generation uses configured gemini-3.5-flash-lite model and formats channel properly", async () => {
    let capturedModel = null;
    let capturedSystemInstruction = null;

    global.fetch = async (url, options) => {
      if (url.includes("generativelanguage.googleapis.com")) {
        const body = JSON.parse(options.body);
        capturedModel = url;
        capturedSystemInstruction = body.systemInstruction?.parts?.[0]?.text;

        if (capturedSystemInstruction.includes("Instagram")) {
          return {
            ok: true,
            json: async () => ({
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      message_body: "Hey Marcus, noticed Elevate Fitness's new Dallas branch. Loved your community transformation posts! Have an idea for boosting your member signups if you're open to a quick chat?",
                      angle_used: "Community growth"
                    })
                  }]
                }
              }]
            })
          };
        } else if (capturedSystemInstruction.includes("WhatsApp")) {
          return {
            ok: true,
            json: async () => ({
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      message_body: "Hi Marcus, saw Elevate Fitness's recent Dallas expansion. Quick question: are you currently taking on new personal training clients this month? Had a marketing thought that might help.",
                      angle_used: "Direct lead gen"
                    })
                  }]
                }
              }]
            })
          };
        } else {
          return {
            ok: true,
            json: async () => ({
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subject_lines: ["Quick question for Apex Dental", "Dental patient opportunity in Dallas", "Idea for Dr. Vance"],
                      selected_subject: "Quick question for Apex Dental",
                      message_body: "Hi Dr. Vance, noticed your clinic in Dallas. We help dental practices add 15-20 high-value implant patients monthly. Would you be open to a 5-minute chat?",
                      angle_used: "Implant cases"
                    })
                  }]
                }
              }]
            })
          };
        }
      }
      return { ok: true, json: async () => ({}) };
    };

    // Instagram generation
    const igDraft = await generateOutreachDraft(
      { business_name: "Elevate Fitness", contact_name: "Marcus", outreach_channel: "instagram" },
      { summary: "Fitness gym in Dallas", marketing_opportunities: ["Local SEO"] },
      "",
      { channel: "instagram" }
    );
    assert.strictEqual(igDraft.channel, "instagram");
    assert.strictEqual(igDraft.model_used, "gemini-3.5-flash-lite");
    assert.strictEqual(igDraft.subject, null);
    assert.ok(igDraft.body.includes("Marcus"));

    // WhatsApp generation
    const waDraft = await generateOutreachDraft(
      { business_name: "Elevate Fitness", contact_name: "Marcus", phone: "+15125550377", outreach_channel: "whatsapp" },
      { summary: "Fitness gym in Dallas" },
      "",
      { channel: "whatsapp" }
    );
    assert.strictEqual(waDraft.channel, "whatsapp");
    assert.strictEqual(waDraft.subject, null);
    assert.ok(waDraft.body.includes("Elevate Fitness"));

    // Gmail generation
    const gmailDraft = await generateOutreachDraft(
      { business_name: "Apex Dental", contact_name: "Dr. Vance", email: "vance@apexdental.com", outreach_channel: "gmail" },
      { summary: "Dental office" },
      "",
      { channel: "gmail" }
    );
    assert.strictEqual(gmailDraft.channel, "gmail");
    assert.strictEqual(gmailDraft.subject, "Quick question for Apex Dental");
    assert.strictEqual(gmailDraft.subject_lines.length, 3);
  });

  await t.test("5. Autonomous pipeline runs end-to-end and automatically approves valid draft", async () => {
    const memory = {
      lead: {
        id: "lead-auto-1",
        business_name: "Apex Dental",
        website: "https://apexdental.com",
        email: "vance@apexdental.com",
        outreach_channel: "gmail",
        processing_stage: "research_pending"
      },
      research: null,
      outreach: [],
      approvals: []
    };

    setSupabaseClient({
      from(table) {
        if (table === "leads") {
          return {
            select() {
              return {
                eq(_col, val) {
                  return {
                    maybeSingle: async () => ({
                      data: memory.lead.id === val ? memory.lead : null,
                      error: null
                    })
                  };
                }
              };
            },
            update(updates) {
              Object.assign(memory.lead, updates);
              return {
                eq: () => ({
                  select: () => ({
                    single: async () => ({ data: memory.lead, error: null })
                  })
                })
              };
            }
          };
        }
        if (table === "lead_research") {
          return {
            select() {
              return {
                eq() {
                  return {
                    order() {
                      return {
                        limit() {
                          return {
                            maybeSingle: async () => ({ data: memory.research, error: null })
                          };
                        }
                      };
                    }
                  };
                }
              };
            },
            insert(record) {
              memory.research = { id: "res-1", ...record };
              return {
                select: () => ({
                  single: async () => ({ data: memory.research, error: null })
                })
              };
            }
          };
        }
        if (table === "outreach_records") {
          return {
            insert(record) {
              const rec = { id: `out-${Date.now()}`, ...record };
              memory.outreach.push(rec);
              return {
                select: () => ({
                  single: async () => ({ data: rec, error: null })
                })
              };
            }
          };
        }
        if (table === "approvals") {
          return {
            insert(record) {
              const appr = { id: `appr-${Date.now()}`, ...record };
              memory.approvals.push(appr);
              return {
                select: () => ({
                  single: async () => ({ data: appr, error: null })
                }),
                then: (resolve) => resolve({ data: appr, error: null })
              };
            }
          };
        }
        if (table === "activity_logs") {
          return { insert: async () => ({ error: null }) };
        }
        return {};
      }
    });

    global.fetch = async (url) => {
      // Tavily mock
      if (url.includes("api.tavily.com")) {
        return {
          ok: true,
          json: async () => ({
            query: "Apex Dental",
            answer: "Apex Dental is a premier cosmetic clinic in Dallas.",
            results: [{ title: "Apex Dental", url: "https://apexdental.com", content: "Family and cosmetic dental care." }]
          })
        };
      }
      // Gemini AI mock for review and draft
      if (url.includes("generativelanguage.googleapis.com")) {
        return {
          ok: true,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    // Review evaluation
                    summary: "High quality dental practice in Dallas.",
                    qualification_score: 85,
                    qualification_reasoning: "Verified active practice with marketing opportunity.",
                    services_offered: ["Implants", "Whitening"],
                    marketing_opportunities: ["Google Ads"],
                    // Draft fields
                    subject_lines: ["Dental growth idea"],
                    selected_subject: "Dental growth idea",
                    message_body: "Hi Dr. Vance, noticed your clinic in Dallas. We can help with your implant marketing.",
                    angle_used: "Implants"
                  })
                }]
              }
            }]
          })
        };
      }
      return { ok: true, json: async () => ({}) };
    };

    const result = await processLeadAutonomousWorkflow(memory.lead.id);
    assert.strictEqual(result.success, true);
    assert.strictEqual(memory.lead.processing_stage, "draft_approved");
    assert.strictEqual(memory.lead.qualification_score, 85);

    // Verify outreach record was created with auto-approval metadata
    assert.strictEqual(memory.outreach.length, 1);
    const savedOutreach = memory.outreach[0];
    assert.strictEqual(savedOutreach.is_auto_approved, true);
    assert.strictEqual(savedOutreach.channel, "gmail");
    assert.strictEqual(savedOutreach.model_used, "gemini-3.5-flash-lite");

    // Verify approval record was created and pre-approved
    assert.strictEqual(memory.approvals.length, 1);
    assert.strictEqual(memory.approvals[0].status, "approved");
    assert.strictEqual(memory.approvals[0].decision_notes, "Automatically approved by autonomous pipeline");
  });

  await t.test("6. Failed outreach generation does not approve an incomplete draft and sets failed stage", async () => {
    const memory = {
      lead: {
        id: "lead-fail-1",
        business_name: "Broken Lead",
        processing_stage: "draft_generation_pending",
        research_status: "completed"
      },
      research: { summary: "Some summary" },
      outreach: [],
      approvals: []
    };

    setSupabaseClient({
      from(table) {
        if (table === "leads") {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: memory.lead, error: null }) }) }),
            update: (updates) => {
              Object.assign(memory.lead, updates);
              return { eq: () => ({ select: () => ({ single: async () => ({ data: memory.lead, error: null }) }) }) };
            }
          };
        }
        if (table === "lead_research") {
          return {
            select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: memory.research, error: null }) }) }) }) })
          };
        }
        if (table === "outreach_records") {
          return { insert: (r) => { memory.outreach.push(r); return { select: () => ({ single: async () => ({ data: r, error: null }) }) }; } };
        }
        if (table === "approvals") {
          return { insert: (a) => { memory.approvals.push(a); return { select: () => ({ single: async () => ({ data: a, error: null }) }) }; } };
        }
        if (table === "activity_logs") {
          return { insert: async () => ({ error: null }) };
        }
        return {};
      }
    });

    global.fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "Gemini server overloaded" } })
    });

    await assert.rejects(async () => {
      await processLeadAutonomousWorkflow(memory.lead.id, "draft_generation_pending");
    });

    // Outreach draft should not have been saved or approved
    assert.strictEqual(memory.outreach.length, 0);
    assert.strictEqual(memory.approvals.length, 0);
  });

  await t.test("7. Retry mechanism safely re-enqueues failed lead", async () => {
    let leadStage = "failed";
    setSupabaseClient({
      from(table) {
        if (table === "leads") {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "lead-retry", business_name: "Apex", research_status: "completed", processing_stage: leadStage }, error: null }) }) }),
            update: (updates) => {
              leadStage = updates.processing_stage;
              return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: "lead-retry" }, error: null }) }) }) };
            }
          };
        }
        if (table === "lead_pipeline_jobs") {
          return {
            select: () => ({ eq: () => ({ in: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
            insert: (j) => ({ select: () => ({ single: async () => ({ data: { id: "job-retry", ...j }, error: null }) }) })
          };
        }
        if (table === "activity_logs") return { insert: async () => ({ error: null }) };
        return {};
      }
    });

    const job = await retryFailedLead("lead-retry");
    assert.strictEqual(job.stage, "draft_generation_pending");
    assert.strictEqual(leadStage, "draft_generation_pending");
  });

  await t.test("8. Restart recovery recovers stale/processing jobs safely", async () => {
    let recoveredCount = 0;
    setSupabaseClient({
      from(table) {
        if (table === "lead_pipeline_jobs") {
          return {
            update() {
              return {
                eq() {
                  return {
                    lt() {
                      return {
                        select: async () => {
                          recoveredCount = 2;
                          return { data: [{ id: "job-1" }, { id: "job-2" }], error: null };
                        }
                      };
                    }
                  };
                }
              };
            },
            select() {
              return {
                eq() {
                  return Promise.resolve({ count: 0, error: null });
                }
              };
            }
          };
        }
        return {};
      }
    });

    const result = await recoverPendingJobs();
    assert.strictEqual(result.recovered, 2);
  });
});
