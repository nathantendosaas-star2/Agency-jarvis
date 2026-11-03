const test = require("node:test");
const assert = require("node:assert/strict");

const { parseRow, ingestFromGoogleSheets } = require("../src/services/sheetsService");
const { setSupabaseClient } = require("../src/config/supabase");

test("Google Sheets row parsing", async (t) => {
  await t.test("parses valid row with multiple column variations", () => {
    const row = {
      "Business Name": "Bright Spark Solar",
      "Website": "https://brightspark.com",
      "Contact Name": "Sarah Jenkins",
      "Email": "sarah@brightspark.com",
      "Phone": "555-1234",
      "Business Category": "Renewable Energy",
      "Location": "Phoenix, AZ",
      "Notes": "Great online presence"
    };

    const res = parseRow(row);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.lead.business_name, "Bright Spark Solar");
    assert.strictEqual(res.lead.website, "https://brightspark.com");
    assert.strictEqual(res.lead.contact_name, "Sarah Jenkins");
    assert.strictEqual(res.lead.email, "sarah@brightspark.com");
    assert.strictEqual(res.lead.phone, "555-1234");
    assert.strictEqual(res.lead.business_category, "Renewable Energy");
    assert.strictEqual(res.lead.location, "Phoenix, AZ");
    assert.strictEqual(res.lead.notes, "Great online presence");
    assert.strictEqual(res.lead.source, "google_sheets");
  });

  await t.test("rejects row without business name", () => {
    const row = {
      "Website": "https://noname.com",
      "Email": "info@noname.com"
    };

    const res = parseRow(row);
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /Missing required Business Name/);
  });

  await t.test("handles malformed row input gracefully", () => {
    assert.strictEqual(parseRow(null), null);
    assert.strictEqual(parseRow("string"), null);
  });
});

test("Google Sheets ingestion workflow with mock fetch and database", async (t) => {
  const originalFetch = global.fetch;
  const mockLeadsDb = [];

  const mockSupabase = {
    from(tableName) {
      if (tableName === "leads") {
        return {
          select() {
            let filtered = [...mockLeadsDb];
            const builder = {
              eq(field, val) {
                filtered = filtered.filter((row) => row[field] === val);
                return builder;
              },
              ilike(field, val) {
                filtered = filtered.filter((row) => (row[field] || "").toLowerCase() === (val || "").toLowerCase());
                return builder;
              },
              async maybeSingle() {
                return { data: filtered[0] || null, error: null };
              }
            };
            return builder;
          },
          insert(record) {
            const inserted = { id: `lead-${Date.now()}-${Math.random()}`, ...record };
            mockLeadsDb.push(inserted);
            return {
              select() {
                return {
                  single: async () => ({ data: inserted, error: null })
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

  await t.test("imports valid rows and skips duplicates", async () => {
    global.fetch = async (url) => {
      assert.match(url.toString(), /script\.google\.com/);
      return {
        ok: true,
        async json() {
          return {
            leads: [
              {
                "Business Name": "Alpha Physio",
                "Website": "https://alphaphysio.com",
                "Email": "admin@alphaphysio.com"
              },
              {
                "Business Name": "Beta Legal",
                "Website": "https://betalegal.com",
                "Email": "info@betalegal.com"
              },
              {
                // Duplicate of Alpha Physio by normalized website
                "Business Name": "Alpha Physio Clinic",
                "Website": "http://alphaphysio.com/",
                "Email": "reception@alphaphysio.com"
              },
              {
                // Invalid missing business name
                "Website": "https://noname.com"
              }
            ]
          };
        }
      };
    };

    const stats = await ingestFromGoogleSheets({
      scriptUrl: "https://script.google.com/macros/s/test/exec",
      apiSecret: "secret123"
    });

    assert.strictEqual(stats.rowsProcessed, 4);
    assert.strictEqual(stats.leadsImported, 2);
    assert.strictEqual(stats.duplicatesSkipped, 1);
    assert.strictEqual(stats.invalidRows, 1);
  });

  await t.test("throws error if Google Sheets endpoint returns failure status", async () => {
    global.fetch = async () => ({
      ok: false,
      status: 500
    });

    await assert.rejects(
      async () => {
        await ingestFromGoogleSheets({
          scriptUrl: "https://script.google.com/macros/s/fail/exec"
        });
      },
      /Google Sheets endpoint responded with HTTP 500/
    );
  });
});
