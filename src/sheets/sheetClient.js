// ─── Sheet Client ───
// Client-side API for the Linked Sheet feature.
// Pure functions — no React dependencies.

import { getConnection } from "../lib/api.js";

/**
 * Detect the type of sheet URL.
 * Returns: "google_sheets" | "csv" | "unsupported" | null
 */
export function detectSheetType(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    // Google Sheets
    if (host.includes("docs.google.com") && u.pathname.includes("/spreadsheets/")) {
      return "google_sheets";
    }
    // Excel Online (flagged for future)
    if (host.includes("onedrive.live.com") || host.includes("sharepoint.com") || host.includes("office.com")) {
      return "unsupported";
    }
    // Airtable (flagged for future)
    if (host.includes("airtable.com")) {
      return "unsupported";
    }
    // Treat any other HTTPS URL as CSV
    if (u.protocol === "https:") return "csv";
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract the Google Sheet ID from a URL.
 */
export function extractGoogleSheetId(url) {
  if (!url) return null;
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Validate a sheet URL for the Link Sheet dialog.
 * Returns: { valid: boolean, type: string|null, error: string|null }
 */
export function validateSheetUrl(url) {
  if (!url || !url.trim()) return { valid: false, type: null, error: null };
  const type = detectSheetType(url);
  if (!type) return { valid: false, type: null, error: "Enter a valid HTTPS URL" };
  if (type === "unsupported") {
    const host = new URL(url).hostname;
    const provider = host.includes("airtable") ? "Airtable" : "Excel Online";
    return { valid: false, type: "unsupported", error: `${provider} is not yet supported` };
  }
  return { valid: true, type, error: null };
}

/**
 * Fetch sheet data from the worker proxy.
 * Returns: { columns: string[], rows: string[][], cachedAt: number, sheetType: string, truncated?: boolean }
 */
export async function fetchSheetData(workerUrl, sheetUrl) {
  const conn = getConnection();
  const headers = { "Content-Type": "application/json" };
  if (conn?.secret) headers["X-Wasabi-Key"] = conn.secret;

  const res = await fetch(`${workerUrl}/sheets/fetch`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: sheetUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err._error || `Failed to fetch sheet data (${res.status})`);
  }
  return res.json();
}

/**
 * Get a display label for the source link.
 */
export function getSourceLabel(sheetType) {
  switch (sheetType) {
    case "google_sheets": return "View in Google Sheets";
    case "csv": return "View source";
    default: return "View source";
  }
}

/**
 * Detect column types from sheet data.
 * Samples first 50 non-empty values per column.
 * Returns: { [columnName]: "number"|"date"|"url"|"checkbox"|"text" }
 */
export function detectColumnTypes(columns, rows) {
  const types = {};
  const SAMPLE_SIZE = 50;

  for (let colIdx = 0; colIdx < columns.length; colIdx++) {
    const name = columns[colIdx];
    const values = [];
    for (let r = 0; r < rows.length && values.length < SAMPLE_SIZE; r++) {
      const v = (rows[r][colIdx] || "").trim();
      if (v.length > 0) values.push(v);
    }

    if (values.length === 0) {
      types[name] = "text";
      continue;
    }

    // Check if all values are numbers
    if (values.every((v) => !isNaN(parseFloat(v)) && isFinite(v))) {
      types[name] = "number";
      continue;
    }

    // Check if all values are URLs
    if (values.every((v) => /^https?:\/\//i.test(v))) {
      types[name] = "url";
      continue;
    }

    // Check if all values are booleans
    const BOOLS = new Set(["true", "false", "yes", "no", "1", "0"]);
    if (values.every((v) => BOOLS.has(v.toLowerCase()))) {
      types[name] = "checkbox";
      continue;
    }

    // Check if all values look like dates
    const DATE_PATTERNS = [
      /^\d{4}-\d{1,2}-\d{1,2}/,           // ISO: 2024-01-15
      /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,      // US/EU: 01/15/2024 or 15/01/2024
      /^\d{1,2}\.\d{1,2}\.\d{2,4}$/,      // EU dot: 15.01.2024
      /^\d{1,2}-\d{1,2}-\d{2,4}$/,        // US dash: 01-15-2024
    ];
    if (values.every((v) => DATE_PATTERNS.some((p) => p.test(v)) && !isNaN(Date.parse(v)))) {
      types[name] = "date";
      continue;
    }

    types[name] = "text";
  }

  return types;
}
