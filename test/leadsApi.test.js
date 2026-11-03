const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const cookieSession = require("cookie-session");

const TEST_PASSWORD = "correct-admin-password-123";
const TEST_PASSWORD_HASH = "$2a$10$CI/u11k3hC56csiN3YIGheQoFgx80bNsXGN9ifGcZeYc.a82vkNHe";
const TEST_SESSION_SECRET = "test-session-secret-must-be-at-least-32-chars-long";

process.env.ADMIN_PASSWORD_HASH = TEST_PASSWORD_HASH;
process.env.SESSION_SECRET = TEST_SESSION_SECRET;
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://mock.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-role-key";

const { createAuthRouter } = require("../src/routes/auth");
const { createLeadsRouter } = require("../src/routes/leads");
const { requireAdmin } = require("../src/middleware/auth");
const { setSupabaseClient } = require("../src/config/supabase");

function buildApp() {
  const app = express();
  const publicDirectory = path.join(__dirname, "..", "public");

  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "20kb" }));
  app.use(express.urlencoded({ extended: false, limit: "20kb" }));

  app.use(
    cookieSession({
      name: "agency_jarvis_session",
      keys: [process.env.SESSION_SECRET],
      maxAge: 8 * 60 * 60 * 1000,
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      path: "/"
    })
  );

  app.get("/health", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.status(200).json({ status: "ok", service: "agency-jarvis" });
  });

  app.use("/api/auth", createAuthRouter());

  app.use(requireAdmin);
  app.use("/api/leads", createLeadsRouter());
  app.use(
    express.static(publicDirectory, {
      extensions: ["html"],
      index: "index.html",
      setHeaders: (res) => res.set("Cache-Control", "no-store")
    })
  );

  return app;
}

test("Protected leads API endpoints and authentication", async (t) => {
  const mockLeads = [
    {
      id: "uuid-1",
      business_name: "Mock Company",
      website: "https://mock.com",
      normalized_website: "mock.com",
      contact_name: "Alice",
      email: "alice@mock.com",
      lead_status: "new",
      research_status: "pending",
      qualification_score: null,
      created_at: new Date().toISOString()
    }
  ];

  const mockSupabase = {
    from(tableName) {
      if (tableName === "leads") {
        return {
          select() {
            return {
              or() { return this; },
              eq(f, v) { return this; },
              order() { return this; },
              range() { return this; },
              async maybeSingle() { return { data: mockLeads[0], error: null }; },
              then(resolve) { resolve({ data: mockLeads, count: mockLeads.length, error: null }); }
            };
          },
          insert(rec) {
            const inserted = { id: "uuid-new", ...rec };
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
      throw new Error(`Unexpected table ${tableName}`);
    }
  };

  setSupabaseClient(mockSupabase);

  const app = buildApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  t.after(() => {
    server.close();
    setSupabaseClient(null);
  });

  await t.test("unauthenticated access to /api/leads is rejected with 401", async () => {
    const res = await fetch(`${baseUrl}/api/leads`, {
      headers: { Accept: "application/json" }
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.error, "Authentication required.");
  });

  await t.test("authenticated access can list leads and create a lead", async () => {
    // 1. Authenticate
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ password: TEST_PASSWORD })
    });
    assert.strictEqual(loginRes.status, 200);
    const cookieHeader = loginRes.headers.get("set-cookie");
    const cookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [cookieHeader];
    const cookieString = cookies.map((c) => c.split(";")[0]).join("; ");

    // 2. GET /api/leads
    const leadsRes = await fetch(`${baseUrl}/api/leads`, {
      headers: { Cookie: cookieString, Accept: "application/json" }
    });
    assert.strictEqual(leadsRes.status, 200);
    const leadsData = await leadsRes.json();
    assert.strictEqual(Array.isArray(leadsData.leads), true);
    assert.strictEqual(leadsData.leads.length, 1);
    assert.strictEqual(leadsData.leads[0].business_name, "Mock Company");

    // 3. POST /api/leads validation failure
    const badCreateRes = await fetch(`${baseUrl}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieString },
      body: JSON.stringify({ business_name: "" })
    });
    assert.strictEqual(badCreateRes.status, 400);

    // 4. POST /api/leads success
    const createRes = await fetch(`${baseUrl}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieString },
      body: JSON.stringify({ business_name: "New Corp", website: "https://newcorp.com" })
    });
    assert.strictEqual(createRes.status, 201);
    const createdData = await createRes.json();
    assert.strictEqual(createdData.business_name, "New Corp");
  });
});
