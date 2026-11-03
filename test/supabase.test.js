const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getSupabaseClient,
  isSupabaseConfigured,
  setSupabaseClient
} = require("../src/config/supabase");
const {
  normalizeWebsite,
  normalizeEmail,
  findDuplicateLead,
  createLead,
  listLeads
} = require("../src/services/leadsService");
const { saveLeadResearch, getResearchByLeadId } = require("../src/services/researchService");

test("Supabase client configuration and helpers", async (t) => {
  const origUrl = process.env.SUPABASE_URL;
  const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  t.after(() => {
    process.env.SUPABASE_URL = origUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
    setSupabaseClient(null);
  });

  await t.test("throws error when Supabase environment variables are missing", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    setSupabaseClient(null);

    assert.strictEqual(isSupabaseConfigured(), false);
    assert.throws(() => getSupabaseClient(), /Supabase configuration missing/);
  });

  await t.test("normalizes website strings accurately", () => {
    assert.strictEqual(normalizeWebsite("https://www.example.com/"), "example.com");
    assert.strictEqual(normalizeWebsite("http://acme.org/about?ref=1"), "acme.org");
    assert.strictEqual(normalizeWebsite("  subdomain.target.io/contact#top "), "subdomain.target.io");
    assert.strictEqual(normalizeWebsite(""), null);
    assert.strictEqual(normalizeWebsite(null), null);
  });

  await t.test("normalizes email addresses accurately", () => {
    assert.strictEqual(normalizeEmail("  John.Doe@Example.COM "), "john.doe@example.com");
    assert.strictEqual(normalizeEmail(""), null);
    assert.strictEqual(normalizeEmail(null), null);
  });
});

test("Leads and Research repository functions with mock client", async (t) => {
  const mockDb = {
    leads: [],
    research: []
  };

  const mockSupabase = {
    from(tableName) {
      if (tableName === "leads") {
        return {
          select(fields, opts) {
            let filtered = [...mockDb.leads];
            const builder = {
              eq(field, val) {
                filtered = filtered.filter((row) => row[field] === val);
                return builder;
              },
              or(expr) {
                return builder;
              },
              ilike(field, val) {
                filtered = filtered.filter((row) => (row[field] || "").toLowerCase() === (val || "").toLowerCase());
                return builder;
              },
              order() {
                return builder;
              },
              range(start, end) {
                filtered = filtered.slice(start, end + 1);
                return builder;
              },
              async maybeSingle() {
                return { data: filtered[0] || null, error: null };
              },
              then(resolve) {
                resolve({ data: filtered, count: mockDb.leads.length, error: null });
              }
            };
            return builder;
          },
          insert(record) {
            const newRecord = { id: `mock-${Date.now()}`, ...record, created_at: new Date().toISOString() };
            mockDb.leads.push(newRecord);
            return {
              select() {
                return {
                  single: async () => ({ data: newRecord, error: null })
                };
              }
            };
          },
          update(updates) {
            return {
              eq(field, val) {
                const item = mockDb.leads.find((r) => r[field] === val);
                if (item) Object.assign(item, updates);
                return {
                  select() {
                    return {
                      single: async () => ({ data: item, error: null })
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
            const newRecord = { id: `mock-res-${Date.now()}`, ...record, created_at: new Date().toISOString() };
            mockDb.research.push(newRecord);
            return {
              select() {
                return {
                  single: async () => ({ data: newRecord, error: null })
                };
              }
            };
          },
          select() {
            let filtered = [...mockDb.research];
            const builder = {
              eq(field, val) {
                filtered = filtered.filter((r) => r[field] === val);
                return builder;
              },
              order() {
                return builder;
              },
              limit() {
                return builder;
              },
              async maybeSingle() {
                return { data: filtered[0] || null, error: null };
              }
            };
            return builder;
          }
        };
      }

      throw new Error(`Unknown table: ${tableName}`);
    }
  };

  setSupabaseClient(mockSupabase);

  t.after(() => {
    setSupabaseClient(null);
  });

  await t.test("can create a lead and find duplicate by website", async () => {
    const created = await createLead({
      business_name: "Apex Dental",
      website: "https://www.apexdental.com",
      email: "info@apexdental.com"
    });

    assert.ok(created.id);
    assert.strictEqual(created.business_name, "Apex Dental");
    assert.strictEqual(created.normalized_website, "apexdental.com");

    const dup = await findDuplicateLead({ normalized_website: "apexdental.com" });
    assert.ok(dup);
    assert.strictEqual(dup.id, created.id);
  });

  await t.test("can save and fetch lead research", async () => {
    const research = await saveLeadResearch("test-lead-123", {
      summary: "A high-end dental clinic.",
      qualification_score: 85,
      qualification_reasoning: "Active clinic with high-ticket procedures and weak social presence.",
      research_sources: ["https://apexdental.com"]
    });

    assert.ok(research.id);
    assert.strictEqual(research.qualification_score, 85);

    const fetched = await getResearchByLeadId("test-lead-123");
    assert.ok(fetched);
    assert.strictEqual(fetched.summary, "A high-end dental clinic.");
  });
});
