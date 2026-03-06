// ─── File Processing Utilities ───
// Handles CSV/JSON parsing for data import.
// Returns rows as objects ready for Notion page creation.

/**
 * Parse a CSV string into an array of objects using the header row as keys.
 * Handles quoted fields, newlines inside quotes, and comma escaping.
 */
export function parseCSV(text) {
  if (!text || !text.trim()) return { headers: [], rows: [] };

  const lines = splitCSVLines(text.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCSVRow(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVRow(lines[i]);
    if (values.every((v) => !v.trim())) continue; // skip blank rows
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = values[j] ?? "";
    }
    rows.push(obj);
  }

  return { headers, rows };
}

/** Split CSV text into lines, respecting quoted newlines. */
function splitCSVLines(text) {
  const lines = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (current.trim()) lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

/** Parse a single CSV row into an array of values. */
function parseCSVRow(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

/**
 * Parse JSON text into an array of objects.
 * Supports: raw array, object with a top-level array property, or newline-delimited JSON.
 */
export function parseJSON(text) {
  if (!text || !text.trim()) return { rows: [] };

  // Try standard JSON parse
  try {
    const data = JSON.parse(text);

    // Direct array
    if (Array.isArray(data)) {
      return { rows: data, headers: data.length > 0 ? Object.keys(data[0]) : [] };
    }

    // Object with an array property (e.g. { "results": [...] })
    if (typeof data === "object") {
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key]) && data[key].length > 0 && typeof data[key][0] === "object") {
          return { rows: data[key], headers: Object.keys(data[key][0]) };
        }
      }
      // Single object — wrap in array
      return { rows: [data], headers: Object.keys(data) };
    }
  } catch {
    // Try newline-delimited JSON (NDJSON)
  }

  // NDJSON
  const lines = text.trim().split("\n");
  const rows = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line.trim());
      if (typeof obj === "object" && !Array.isArray(obj)) {
        rows.push(obj);
      }
    } catch {
      // skip invalid lines
    }
  }

  return { rows, headers: rows.length > 0 ? Object.keys(rows[0]) : [] };
}

/**
 * Detect the type of a column by sampling values.
 * Returns a Notion-compatible type: title, rich_text, number, date, checkbox, url, email, select.
 */
export function detectColumnType(values) {
  const nonEmpty = values.filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
  if (nonEmpty.length === 0) return "rich_text";

  const sample = nonEmpty.slice(0, 50);

  // Check for numbers
  const numCount = sample.filter((v) => !isNaN(Number(v))).length;
  if (numCount / sample.length > 0.8) return "number";

  // Check for dates (ISO or common formats)
  const dateRegex = /^\d{4}-\d{2}-\d{2}|^\d{1,2}\/\d{1,2}\/\d{2,4}/;
  const dateCount = sample.filter((v) => dateRegex.test(String(v))).length;
  if (dateCount / sample.length > 0.7) return "date";

  // Check for booleans
  const boolVals = new Set(["true", "false", "yes", "no", "1", "0"]);
  const boolCount = sample.filter((v) => boolVals.has(String(v).toLowerCase())).length;
  if (boolCount / sample.length > 0.8) return "checkbox";

  // Check for URLs
  const urlCount = sample.filter((v) => /^https?:\/\//.test(String(v))).length;
  if (urlCount / sample.length > 0.7) return "url";

  // Check for emails
  const emailCount = sample.filter((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))).length;
  if (emailCount / sample.length > 0.7) return "email";

  // Check for select (low cardinality)
  const uniqueVals = new Set(sample.map((v) => String(v)));
  if (uniqueVals.size <= 10 && sample.length >= 5) return "select";

  return "rich_text";
}

/**
 * Auto-detect schema from parsed data rows.
 * Returns an array of field definitions for createDatabase.
 */
export function autoDetectSchema(headers, rows) {
  return headers.map((header, idx) => {
    const values = rows.map((r) => r[header]);
    const type = idx === 0 ? "title" : detectColumnType(values);

    const field = { name: header, type };

    // Add options for select fields
    if (type === "select") {
      const unique = [...new Set(values.filter(Boolean).map(String))];
      field.options = unique.slice(0, 25);
    }

    return field;
  });
}
