const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const cookieSession = require("cookie-session");

const TEST_PASSWORD = "correct-admin-password-123";
// Hash for TEST_PASSWORD
const TEST_PASSWORD_HASH = "$2a$10$CI/u11k3hC56csiN3YIGheQoFgx80bNsXGN9ifGcZeYc.a82vkNHe";
const TEST_SESSION_SECRET = "test-session-secret-must-be-at-least-32-chars-long";

process.env.ADMIN_PASSWORD_HASH = TEST_PASSWORD_HASH;
process.env.SESSION_SECRET = TEST_SESSION_SECRET;
process.env.NODE_ENV = "test";

const { createAuthRouter } = require("../src/routes/auth");
const { requireAdmin } = require("../src/middleware/auth");

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

  app.get(["/login", "/login.html"], (req, res) => {
    if (req.session && req.session.isAdmin === true) return res.redirect("/");
    res.set("Cache-Control", "no-store");
    return res.sendFile(path.join(publicDirectory, "login.html"));
  });

  app.get("/css/style.css", (_req, res) => {
    res.sendFile(path.join(publicDirectory, "css", "style.css"));
  });
  app.get("/js/login.js", (_req, res) => {
    res.sendFile(path.join(publicDirectory, "js", "login.js"));
  });

  app.use("/api/auth", createAuthRouter());

  app.use(requireAdmin);
  app.use(
    express.static(publicDirectory, {
      extensions: ["html"],
      index: "index.html",
      setHeaders: (res) => res.set("Cache-Control", "no-store")
    })
  );

  app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found." }));
  app.use((_req, res) => res.status(404).sendFile(path.join(publicDirectory, "404.html")));

  return app;
}

test("Agency Jarvis authentication and routing checklist", async (t) => {
  const app = buildApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
  });

  await t.test("Dashboard redirects to login when logged out.", async () => {
    const res = await fetch(`${baseUrl}/`, {
      redirect: "manual"
    });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get("location"), "/login");
  });

  await t.test("Incorrect password is rejected.", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: JSON.stringify({ password: "wrong-password" })
    });

    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.error, "Incorrect password.");
  });

  await t.test("Correct password opens the dashboard.", async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: JSON.stringify({ password: TEST_PASSWORD })
    });

    assert.strictEqual(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.strictEqual(loginData.authenticated, true);

    const cookieHeader = loginRes.headers.get("set-cookie");
    assert.ok(cookieHeader, "Session cookie should be set");

    // Extract cookies to pass with subsequent request
    const cookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [cookieHeader];
    const cookieString = cookies.map((c) => c.split(";")[0]).join("; ");

    // Dashboard GET request with session cookie
    const dashRes = await fetch(`${baseUrl}/`, {
      headers: {
        Cookie: cookieString
      },
      redirect: "manual"
    });

    assert.strictEqual(dashRes.status, 200);
    const dashBody = await dashRes.text();
    assert.match(dashBody, /Agency Jarvis/i);
  });

  await t.test("Leads, Outreach, Workbench and Social require authentication.", async () => {
    const protectedRoutes = ["/leads", "/outreach", "/workbench", "/social"];

    for (const route of protectedRoutes) {
      const res = await fetch(`${baseUrl}${route}`, {
        redirect: "manual"
      });
      assert.strictEqual(res.status, 302, `Expected 302 redirect for ${route}`);
      assert.strictEqual(res.headers.get("location"), "/login", `Expected redirect to /login for ${route}`);
    }

    // Authenticated access should succeed
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: JSON.stringify({ password: TEST_PASSWORD })
    });
    const cookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get("set-cookie")];
    const cookieString = cookies.map((c) => c.split(";")[0]).join("; ");

    for (const route of protectedRoutes) {
      const res = await fetch(`${baseUrl}${route}`, {
        headers: {
          Cookie: cookieString
        },
        redirect: "manual"
      });
      assert.strictEqual(res.status, 200, `Expected 200 for authenticated access to ${route}`);
    }
  });

  await t.test("Logout returns you to login.", async () => {
    // 1. Log in first
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: JSON.stringify({ password: TEST_PASSWORD })
    });
    assert.strictEqual(loginRes.status, 200);
    const cookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get("set-cookie")];
    const cookieString = cookies.map((c) => c.split(";")[0]).join("; ");

    // 2. Perform logout
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl,
        Cookie: cookieString
      }
    });
    assert.strictEqual(logoutRes.status, 200);
    const logoutData = await logoutRes.json();
    assert.strictEqual(logoutData.authenticated, false);

    const logoutCookies = logoutRes.headers.getSetCookie ? logoutRes.headers.getSetCookie() : [logoutRes.headers.get("set-cookie")];
    const logoutCookieString = logoutCookies.map((c) => c.split(";")[0]).join("; ");

    // 3. Attempting to visit dashboard after logout returns redirect to /login
    const afterLogoutRes = await fetch(`${baseUrl}/`, {
      headers: {
        Cookie: logoutCookieString
      },
      redirect: "manual"
    });
    assert.strictEqual(afterLogoutRes.status, 302);
    assert.strictEqual(afterLogoutRes.headers.get("location"), "/login");
  });

  await t.test("Health endpoint responds at /health.", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.deepStrictEqual(data, {
      status: "ok",
      service: "agency-jarvis"
    });
  });
});
