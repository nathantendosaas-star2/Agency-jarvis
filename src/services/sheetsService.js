const { findDuplicateLead, createLead, normalizeWebsite, normalizeEmail } = require("./leadsService");

function parseRow(rawRow) {
  if (!rawRow || typeof rawRow !== "object") return null;

  // Normalize column keys (e.g. "Business Name" -> "business_name", "business name" -> "business_name")
  const normalizedKeys = {};
  for (const [key, value] of Object.entries(rawRow)) {
    const cleanKey = key.toLowerCase().trim().replace(/[\s_-]+/g, "");
    normalizedKeys[cleanKey] = typeof value === "string" ? value.trim() : (value != null ? String(value).trim() : "");
  }

  const businessName =
    normalizedKeys.businessname ||
    normalizedKeys.companyname ||
    normalizedKeys.company ||
    normalizedKeys.name ||
    normalizedKeys.business ||
    "";

  if (!businessName) {
    return { valid: false, error: "Missing required Business Name." };
  }

  const website = normalizedKeys.website || normalizedKeys.url || normalizedKeys.site || "";
  const contactName =
    normalizedKeys.contactname ||
    normalizedKeys.contact ||
    normalizedKeys.owner ||
    normalizedKeys.person ||
    "";
  const email = normalizedKeys.email || normalizedKeys.mail || "";
  const phone = normalizedKeys.phone || normalizedKeys.telephone || normalizedKeys.mobile || "";
  const businessCategory =
    normalizedKeys.businesscategory ||
    normalizedKeys.category ||
    normalizedKeys.industry ||
    normalizedKeys.niche ||
    "";
  const location =
    normalizedKeys.location ||
    normalizedKeys.city ||
    normalizedKeys.address ||
    normalizedKeys.state ||
    "";
  const notes = normalizedKeys.notes || normalizedKeys.note || normalizedKeys.comments || "";

  return {
    valid: true,
    lead: {
      business_name: businessName,
      website: website || null,
      contact_name: contactName || null,
      email: email || null,
      phone: phone || null,
      business_category: businessCategory || null,
      location: location || null,
      notes: notes || null,
      source: "google_sheets"
    }
  };
}

async function fetchGoogleSheetsRows(scriptUrl, apiSecret) {
  if (!scriptUrl) {
    throw new Error("GOOGLE_SHEETS_SCRIPT_URL is not configured.");
  }

  const url = new URL(scriptUrl);
  if (apiSecret) {
    url.searchParams.set("secret", apiSecret);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Google Sheets endpoint responded with HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`Google Sheets error: ${data.error}`);
  }

  const rows = Array.isArray(data) ? data : (Array.isArray(data.leads) ? data.leads : data.rows);
  if (!Array.isArray(rows)) {
    throw new Error("Invalid response format: expected an array of lead rows or { leads: [...] }.");
  }

  return rows;
}

async function ingestFromGoogleSheets(options = {}) {
  const scriptUrl = options.scriptUrl || process.env.GOOGLE_SHEETS_SCRIPT_URL;
  const apiSecret = options.apiSecret || process.env.GOOGLE_SHEETS_API_SECRET;

  const stats = {
    rowsProcessed: 0,
    leadsImported: 0,
    duplicatesSkipped: 0,
    invalidRows: 0,
    errors: []
  };

  const rows = await fetchGoogleSheetsRows(scriptUrl, apiSecret);
  stats.rowsProcessed = rows.length;

  for (let i = 0; i < rows.length; i++) {
    const rawRow = rows[i];
    const parsed = parseRow(rawRow);

    if (!parsed || !parsed.valid) {
      stats.invalidRows++;
      stats.errors.push(`Row ${i + 1}: ${parsed ? parsed.error : "Malformed row data"}`);
      continue;
    }

    const { lead } = parsed;
    const normalizedWeb = normalizeWebsite(lead.website);
    const normalizedMail = normalizeEmail(lead.email);

    try {
      const duplicate = await findDuplicateLead({
        normalized_website: normalizedWeb,
        email: normalizedMail,
        business_name: lead.business_name
      });

      if (duplicate) {
        stats.duplicatesSkipped++;
        continue;
      }

      await createLead(lead);
      stats.leadsImported++;
    } catch (err) {
      stats.invalidRows++;
      stats.errors.push(`Row ${i + 1} (${lead.business_name}): ${err.message}`);
    }
  }

  return stats;
}

module.exports = {
  parseRow,
  fetchGoogleSheetsRows,
  ingestFromGoogleSheets
};
