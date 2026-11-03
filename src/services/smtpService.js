const nodemailer = require("nodemailer");
const { logActivity } = require("./activityService");

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM || user;

  const isConfigured = Boolean(host && user && pass);
  return { host, port, user, pass, from, isConfigured };
}

function createTransporter(config = getSmtpConfig()) {
  if (!config.isConfigured) {
    return null;
  }
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });
}

async function testSmtpConnection() {
  const config = getSmtpConfig();
  if (!config.isConfigured) {
    return {
      connected: false,
      message: "SMTP is not fully configured (missing SMTP_HOST, SMTP_USER, or SMTP_PASSWORD)."
    };
  }

  const transporter = createTransporter(config);
  try {
    await transporter.verify();
    return { connected: true, message: "SMTP connection established successfully." };
  } catch (err) {
    return { connected: false, message: `SMTP verification failed: ${err.message}` };
  }
}

async function sendOutboundEmail({ to, subject, html, text }) {
  const config = getSmtpConfig();
  const isDev = process.env.NODE_ENV !== "production";

  // Prevent real emails if configured in test/dev mode or unconfigured
  if (process.env.SMTP_DEV_MODE === "true" || (!config.isConfigured && isDev)) {
    console.log(`[SMTP DEV MODE] Simulated email sent to ${to}: "${subject}"`);
    await logActivity("email_sent_simulated", `Simulated email to ${to}: ${subject}`, {
      metadata: { to, subject }
    });
    return {
      success: true,
      simulated: true,
      messageId: `sim-${Date.now()}@agencyjarvis.local`
    };
  }

  if (!config.isConfigured) {
    throw new Error("SMTP is not configured on the server. Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD.");
  }

  const transporter = createTransporter(config);
  const info = await transporter.sendMail({
    from: config.from,
    to,
    subject,
    text,
    html: html || text
  });

  await logActivity("email_sent", `Sent email to ${to}: ${subject}`, {
    metadata: { to, subject, messageId: info.messageId }
  });

  return {
    success: true,
    simulated: false,
    messageId: info.messageId
  };
}

module.exports = {
  getSmtpConfig,
  testSmtpConnection,
  sendOutboundEmail
};
