const nodemailer = require("nodemailer");
const { logActivity } = require("./activityService");

function getSmtpConfig() {
  const port = Number(process.env.SMTP_PORT || 587);
  const config = {
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    fromEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER,
    fromName: process.env.SMTP_FROM_NAME || "Agency Jarvis"
  };
  return {
    ...config,
    isConfigured: Boolean(config.host && config.port && config.user && config.pass && config.fromEmail)
  };
}

function createTransport(config = getSmtpConfig()) {
  if (!config.isConfigured) {
    throw new Error("SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM_EMAIL in the server environment.");
  }
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });
}

async function testSmtpConnection() {
  const config = getSmtpConfig();
  if (!config.isConfigured) {
    return { connected: false, message: "SMTP is not configured. Add SMTP settings to the server environment." };
  }
  try {
    await createTransport(config).verify();
    return { connected: true, message: `SMTP connection verified for ${config.fromEmail}.` };
  } catch (err) {
    return { connected: false, message: `SMTP connection failed: ${err.message}` };
  }
}

async function sendOutboundEmail({ to, subject, html, text }) {
  const config = getSmtpConfig();
  const transporter = createTransport(config);
  const info = await transporter.sendMail({
    from: { name: config.fromName, address: config.fromEmail },
    to: Array.isArray(to) ? to.join(", ") : to,
    subject,
    text: text || "",
    ...(html ? { html } : {})
  });

  await logActivity("email_sent", `SMTP accepted email to ${to}: ${subject}`, {
    metadata: { to, subject, messageId: info.messageId, provider: "smtp", accepted: info.accepted, rejected: info.rejected }
  });

  if (info.rejected?.length && !info.accepted?.length) {
    throw new Error(`SMTP rejected the recipient: ${info.rejected.join(", ")}`);
  }

  return {
    success: true,
    simulated: false,
    provider: "smtp",
    messageId: info.messageId,
    status: info.rejected?.length ? "partially_accepted" : "accepted"
  };
}

module.exports = { getSmtpConfig, testSmtpConnection, sendOutboundEmail };
