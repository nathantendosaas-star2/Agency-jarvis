const test = require("node:test");
const assert = require("node:assert");

test("Outreach Channel Click-to-Chat & Compose URL Generation", () => {
  // 1. Gmail Compose URL
  const leadEmail = "dr.vance@apexdental.com";
  const subject = "Idea for Apex Dental";
  const body = "Hi Dr. Vance, noticed your new clinic in Dallas. We can help with your implant marketing.";
  const gmailParams = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: leadEmail,
    su: subject,
    body
  });
  const gmailUrl = `https://mail.google.com/mail/?${gmailParams.toString()}`;
  assert.ok(gmailUrl.includes("mail.google.com/mail/?"));
  assert.ok(gmailUrl.includes("to=dr.vance%40apexdental.com"));
  assert.ok(gmailUrl.includes("su=Idea+for+Apex+Dental"));

  // 2. WhatsApp Click-to-Chat URL with International Phone Normalization
  const rawPhone = "+1 (512) 555-0199";
  const cleanPhone = rawPhone.replace(/[^0-9]/g, "");
  assert.strictEqual(cleanPhone, "15125550199");
  const waMsg = "Hi Dr. Vance, saw Apex Dental's expansion. Quick question: are you taking new implant patients?";
  const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;
  assert.ok(waUrl.startsWith("https://wa.me/15125550199?text="));
  assert.ok(waUrl.includes("taking%20new%20implant%20patients%3F") || waUrl.includes("taking+new+implant+patients"));

  // 3. Instagram Profile URL Normalization
  const handleWithAt = "@apexdental";
  const cleanHandle = handleWithAt.replace(/^@/, "");
  const igUrl = `https://instagram.com/${cleanHandle}`;
  assert.strictEqual(igUrl, "https://instagram.com/apexdental");
});
