# Google Sheets Lead Ingestion Setup Guide

Agency Jarvis can ingest leads from a Google Sheet via a Google Apps Script Web App.

## 1. Expected Google Sheet Structure

Ensure your Google Sheet contains a header row with the following column names (case-insensitive, spaces or underscores permitted):

| Header Column | Description | Example |
| :--- | :--- | :--- |
| `Business Name` | Name of the prospective company (Required) | Acme Digital Labs |
| `Website` | Company website URL | https://acmedigital.example.com |
| `Contact Name` | Primary contact or owner name | John Doe |
| `Email` | Business or contact email address | john@acmedigital.example.com |
| `Phone` | Business or mobile phone number | +1 (555) 234-5678 |
| `Business Category` | Industry or niche | Dental Clinic |
| `Location` | City, State or Country | Austin, TX |
| `Notes` | Additional context or initial observations | High social engagement, outdated website |

## 2. Google Apps Script Code

1. Open your Google Sheet.
2. In the menu, go to **Extensions** → **Apps Script**.
3. Replace any default code in the editor with:

```javascript
/**
 * Agency Jarvis - Google Sheets Exporter
 */
const API_SECRET = "CHANGE_THIS_TO_A_SECURE_RANDOM_SECRET";

function doGet(e) {
  try {
    const authHeader = (e && e.parameter && e.parameter.secret) || "";
    if (API_SECRET && authHeader !== API_SECRET) {
      return ContentService.createTextOutput(JSON.stringify({
        error: "Unauthorized: Invalid or missing secret."
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const rows = sheet.getDataRange().getValues();

    if (rows.length < 2) {
      return ContentService.createTextOutput(JSON.stringify({
        leads: [],
        total: 0
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const headers = rows[0].map(h => String(h).trim().toLowerCase());
    const leads = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      // Skip completely empty rows
      if (!row.some(cell => String(cell).trim() !== "")) continue;

      const lead = {};
      headers.forEach((header, index) => {
        lead[header] = row[index];
      });
      leads.push(lead);
    }

    return ContentService.createTextOutput(JSON.stringify({
      leads: leads,
      total: leads.length
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      error: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
```

## 3. Deploying as a Web App

1. Click **Deploy** (top right) → **New deployment**.
2. Select type: **Web app**.
3. Set:
   - **Execute as**: *Me*
   - **Who has access**: *Anyone* (the secret token protects the endpoint).
4. Click **Deploy** and authorize permissions when prompted.
5. Copy the generated **Web App URL** (e.g., `https://script.google.com/macros/s/XXXXX/exec`).

## 4. Configuring Agency Jarvis

In your `.env` file (or Render dashboard):

```env
GOOGLE_SHEETS_SCRIPT_URL=https://script.google.com/macros/s/XXXXX/exec
GOOGLE_SHEETS_API_SECRET=your_configured_secret
```

Agency Jarvis will now be able to query this endpoint, normalize leads, check for duplicates against Supabase, and import valid leads.
