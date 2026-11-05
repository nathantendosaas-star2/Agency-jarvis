const { createLead, findDuplicateLead, normalizeWebsite, normalizeEmail } = require("./leadsService");
const { enqueueLeadJob } = require("./leadPipelineService");

const VALID_CHANNELS = ["gmail", "instagram", "whatsapp"];

/**
 * Parses raw CSV text into array of objects with header normalization.
 */
function parseCsvText(csvText) {
  if (!csvText || typeof csvText !== "string") {
    throw new Error("CSV input must be non-empty text.");
  }

  // Handle CRLF and LF
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("CSV must include a header row and at least one data row.");
  }

  const parseRow = (line) => {
    const fields = [];
    let cur = "";
    let insideQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (insideQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (c === "," && !insideQuotes) {
        fields.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    fields.push(cur.trim());
    return fields;
  };

  const headerLine = lines[0];
  const rawHeaders = parseRow(headerLine);
  const normalizedHeaders = rawHeaders.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    const rowObj = {};
    normalizedHeaders.forEach((header, idx) => {
      rowObj[header] = values[idx] || "";
    });
    rowObj.__raw_line = lines[i];
    rowObj.__row_index = i + 1;
    rows.push(rowObj);
  }

  return rows;
}

/**
 * Intelligent field mapping for common lead CSV headers.
 */
function mapRowToLead(row, defaultChannel = "gmail") {
  const businessName = (
    row.businessname ||
    row.companyname ||
    row.company ||
    row.business ||
    row.name ||
    row.prospect ||
    ""
  ).trim();

  const contactName = (
    row.contactname ||
    row.contact ||
    row.owner ||
    row.founder ||
    row.person ||
    ""
  ).trim();

  const email = (
    row.email ||
    row.emailaddress ||
    row.mail ||
    ""
  ).trim();

  const phone = (
    row.phone ||
    row.phonenumber ||
    row.mobile ||
    row.telephone ||
    ""
  ).trim();

  const website = (
    row.website ||
    row.url ||
    row.web ||
    row.domain ||
    ""
  ).trim();

  const instagram = (
    row.instagram ||
    row.instagramurl ||
    row.instagramhandle ||
    row.handle ||
    row.ig ||
    ""
  ).trim();

  const location = (
    row.location ||
    row.city ||
    row.address ||
    row.state ||
    ""
  ).trim();

  const category = (
    row.businesscategory ||
    row.category ||
    row.industry ||
    row.niche ||
    ""
  ).trim();

  const notes = (
    row.notes ||
    row.note ||
    row.description ||
    ""
  ).trim();

  let outreachChannel = (
    row.outreachchannel ||
    row.channel ||
    defaultChannel
  ).toLowerCase().trim();

  if (outreachChannel === "email") outreachChannel = "gmail";
  if (!VALID_CHANNELS.includes(outreachChannel)) {
    outreachChannel = defaultChannel;
  }

  return {
    business_name: businessName,
    contact_name: contactName || null,
    email: email || null,
    phone: phone || null,
    website: website || null,
    instagram: instagram || null,
    location: location || null,
    business_category: category || null,
    notes: notes || null,
    outreach_channel: outreachChannel,
    __row_index: row.__row_index
  };
}

/**
 * Process uploaded CSV text: parse, validate, deduplicate, insert, and enqueue into autonomous pipeline.
 */
async function importLeadsFromCsv(csvText, options = {}) {
  const defaultChannel = VALID_CHANNELS.includes(options.defaultChannel) ? options.defaultChannel : "gmail";
  const rawRows = parseCsvText(csvText);

  const stats = {
    totalRows: rawRows.length,
    imported: 0,
    duplicatesSkipped: 0,
    invalidRows: 0,
    failed: 0,
    leads: [],
    errors: []
  };

  for (const rawRow of rawRows) {
    const leadData = mapRowToLead(rawRow, defaultChannel);

    // Business name is mandatory
    if (!leadData.business_name) {
      stats.invalidRows += 1;
      stats.errors.push({
        row: leadData.__row_index,
        reason: "Missing business name."
      });
      continue;
    }

    try {
      // Duplicate detection
      const duplicate = await findDuplicateLead({
        normalized_website: normalizeWebsite(leadData.website),
        email: normalizeEmail(leadData.email),
        business_name: leadData.business_name
      });

      if (duplicate) {
        stats.duplicatesSkipped += 1;
        continue;
      }

      // Create lead
      const created = await createLead({
        ...leadData,
        source: "csv_import",
        lead_status: "new",
        processing_stage: "imported"
      });

      // Enqueue autonomous pipeline job
      await enqueueLeadJob(created.id, "research_pending");

      stats.imported += 1;
      stats.leads.push(created);
    } catch (err) {
      stats.failed += 1;
      stats.errors.push({
        row: leadData.__row_index,
        business_name: leadData.business_name,
        reason: err.message
      });
    }
  }

  return stats;
}

module.exports = {
  VALID_CHANNELS,
  parseCsvText,
  mapRowToLead,
  importLeadsFromCsv
};
