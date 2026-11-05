const { logActivity } = require("./activityService");

function getBirdConfig() {
  return {
    apiKey: process.env.BIRD_API_KEY,
    fromEmail: process.env.BIRD_FROM_EMAIL,
    fromName: process.env.BIRD_FROM_NAME || "Agency Jarvis",
    isConfigured: Boolean(process.env.BIRD_API_KEY && process.env.BIRD_FROM_EMAIL)
  };
}

let birdClientPromise;

async function getBirdClient() {
  const config = getBirdConfig();
  if (!config.apiKey) {
    throw new Error("Bird is not configured. Set BIRD_API_KEY in the server environment.");
  }

  if (!birdClientPromise) {
    birdClientPromise = import("@messagebird/sdk").then(({ BirdClient }) => {
      return new BirdClient({ apiKey: config.apiKey });
    }).catch((error) => {
      birdClientPromise = null;
      throw error;
    });
  }

  return birdClientPromise;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToHtml(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line ? `<p>${escapeHtml(line)}</p>` : "")
    .join("");
}

async function testBirdConnection() {
  const config = getBirdConfig();
  if (!config.isConfigured) {
    return {
      connected: false,
      message: "Bird is not fully configured (set BIRD_API_KEY and BIRD_FROM_EMAIL)."
    };
  }

  try {
    const bird = await getBirdClient();
    await bird.email.list();
    return { connected: true, message: "Bird API connection verified successfully." };
  } catch (err) {
    return { connected: false, message: `Bird API verification failed: ${err.message}` };
  }
}

async function sendOutboundEmail({ to, subject, html, text }) {
  const config = getBirdConfig();
  const isDev = process.env.NODE_ENV !== "production";

  // Preserve the existing safe local-development behavior: never send real email in dev mode.
  if (process.env.BIRD_DEV_MODE === "true" || (!config.isConfigured && isDev)) {
    console.log(`[BIRD DEV MODE] Simulated email to ${to}: "${subject}"`);
    await logActivity("email_sent_simulated", `Simulated email to ${to}: ${subject}`, {
      metadata: { to, subject, provider: "bird" }
    });
    return {
      success: true,
      simulated: true,
      provider: "bird",
      messageId: `sim-${Date.now()}@agencyjarvis.local`,
      status: "simulated"
    };
  }

  if (!config.isConfigured) {
    throw new Error("Bird is not configured. Set BIRD_API_KEY and BIRD_FROM_EMAIL on the server.");
  }

  const bird = await getBirdClient();
  const message = await bird.email.send({
    from: { email: config.fromEmail, name: config.fromName },
    to: Array.isArray(to) ? to : [to],
    subject,
    html: html || textToHtml(text || "")
  });

  await logActivity("email_sent", `Bird accepted email to ${to}: ${subject}`, {
    metadata: { to, subject, messageId: message.id, provider: "bird", providerStatus: message.status }
  });

  return {
    success: true,
    simulated: false,
    provider: "bird",
    messageId: message.id,
    status: message.status
  };
}

module.exports = {
  getBirdConfig,
  testBirdConnection,
  sendOutboundEmail
};
