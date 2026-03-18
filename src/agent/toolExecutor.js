// ─── Wasabi Tool Executor ───
// Routes tool calls to the appropriate data source functions.
// Supports D1 tables, D1 sheets, linked Notion, linked Monday, and linked Google Sheets.

import * as client from "../notion/client.js";
import { queryAll } from "../notion/pagination.js";
import { detectSchema, autoDetectViews, schemaToText, suggestViewMappings } from "../notion/schema.js";
import { writeKB, searchKB, kbResultsToText } from "./memory.js";
import { extractProperties, getPageTitle } from "../notion/properties.js";
import * as api from "../lib/api.js";
import { savePageConfig } from "../config/pageConfig.js";
import { fetchSheetData } from "../sheets/sheetClient.js";
import { fetchBoardItems, fetchBoardColumns } from "../monday/client.js";
import { mondayColumnsToSchema, mondayItemToPage } from "../monday/schema.js";

// ─── Sandbox Execution Engine ───

/** Whitelisted helpers available inside the sandbox. */
const _sbSum = (arr) => {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
};
const _sbAvg = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  return _sbSum(arr) / arr.length;
};
const _sbMin = (arr) => {
  const nums = (arr || []).map(Number).filter((n) => !isNaN(n));
  return nums.length ? Math.min(...nums) : 0;
};
const _sbMax = (arr) => {
  const nums = (arr || []).map(Number).filter((n) => !isNaN(n));
  return nums.length ? Math.max(...nums) : 0;
};
const _sbGroupBy = (arr, key) => {
  const groups = {};
  for (const item of (arr || [])) {
    const k = String(item?.[key] ?? "_none");
    (groups[k] = groups[k] || []).push(item);
  }
  return groups;
};
const _sbSortBy = (arr, key, dir = "asc") =>
  [...(arr || [])].sort((a, b) => {
    const va = a?.[key], vb = b?.[key];
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return dir === "desc" ? -cmp : cmp;
  });
const _sbUnique = (arr, key) =>
  [...new Set((arr || []).map((item) => (key ? item?.[key] : item)))].filter((v) => v != null);
const _sbRound = (n, d = 2) => {
  const factor = Math.pow(10, d);
  return Math.round((Number(n) || 0) * factor) / factor;
};
const _sbDateAdd = (dateStr, days) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
};
const _sbDateDiff = (dateStr1, dateStr2) => {
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
};
const _sbWeeksBetween = (dateStr1, dateStr2) => {
  return _sbRound(_sbDateDiff(dateStr1, dateStr2) / 7, 1);
};

// ─── Extended Sandbox Helpers (Plugins) ───

// Formatters (always available for plugins)
const _sbCurrency = (n, currency = "USD") => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n || 0); }
  catch { return `$${(Number(n) || 0).toFixed(2)}`; }
};
const _sbPercent = (n, decimals = 1) => (Number(n) || 0).toFixed(decimals) + "%";
const _sbCompact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return String(v);
};

// Collection helpers (always available for plugins)
const _sbFlatten = (arr) => (arr || []).flat(Infinity);
const _sbPick = (obj, keys) => {
  const result = {};
  for (const k of (keys || [])) { if (obj?.[k] !== undefined) result[k] = obj[k]; }
  return result;
};
const _sbOmit = (obj, keys) => {
  const keySet = new Set(keys || []);
  const result = {};
  for (const [k, v] of Object.entries(obj || {})) { if (!keySet.has(k)) result[k] = v; }
  return result;
};
const _sbChunk = (arr, size) => {
  const chunks = [];
  for (let i = 0; i < (arr || []).length; i += (size || 1)) chunks.push(arr.slice(i, i + size));
  return chunks;
};
const _sbZip = (a, b) => (a || []).map((v, i) => [v, (b || [])[i]]);

// Text processing helpers (gated by text_processing capability)
const _sbTrim = (s) => String(s ?? "").trim();
const _sbUpper = (s) => String(s ?? "").toUpperCase();
const _sbLower = (s) => String(s ?? "").toLowerCase();
const _sbReplace = (s, find, replace) => String(s ?? "").replaceAll(find, replace);
const _sbSplit = (s, delim) => String(s ?? "").split(delim);
const _sbJoin = (arr, delim) => (arr || []).join(delim ?? ", ");
const _sbSlug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const _sbTruncate = (s, len) => {
  const str = String(s ?? "");
  return str.length > len ? str.slice(0, len) + "..." : str;
};
const _sbTemplate = (tmpl, data) => {
  return String(tmpl ?? "").replace(/\{\{(\w+)\}\}/g, (_, key) => data?.[key] ?? "");
};

// ─── Smart Matching Helpers (always available) ───

/** Normalize a string for comparison: lowercase, strip non-alphanumeric, collapse whitespace */
const _sbNormalize = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();

/** Dice coefficient similarity between two strings (0–1). Good for fuzzy name matching. */
const _sbSimilarity = (a, b) => {
  const sa = String(a ?? "").toLowerCase(), sb = String(b ?? "").toLowerCase();
  if (sa === sb) return 1;
  if (sa.length < 2 || sb.length < 2) return 0;
  const bigrams = (s) => { const b = new Map(); for (let i = 0; i < s.length - 1; i++) { const bi = s.slice(i, i + 2); b.set(bi, (b.get(bi) || 0) + 1); } return b; };
  const bg1 = bigrams(sa), bg2 = bigrams(sb);
  let intersection = 0;
  for (const [bi, count] of bg1) { intersection += Math.min(count, bg2.get(bi) || 0); }
  return (2 * intersection) / (sa.length - 1 + sb.length - 1);
};

/** Check if two strings are a fuzzy match (normalized equality OR similarity >= threshold) */
const _sbFuzzyMatch = (a, b, threshold = 0.6) => {
  if (_sbNormalize(a) === _sbNormalize(b)) return true;
  // Also check if one contains the other (handles "D20-CH" matching "D20-CH-TIN-GMO-OR")
  const na = _sbNormalize(a), nb = _sbNormalize(b);
  if (na.includes(nb) || nb.includes(na)) return true;
  return _sbSimilarity(a, b) >= threshold;
};

/** Find the best matching item from an array. Returns { item, score, index } or null. */
const _sbBestMatch = (needle, haystack, key) => {
  if (!needle || !Array.isArray(haystack) || haystack.length === 0) return null;
  const needleNorm = _sbNormalize(needle);
  let best = null, bestScore = 0, bestIdx = -1;
  for (let i = 0; i < haystack.length; i++) {
    const candidate = key ? haystack[i]?.[key] : haystack[i];
    const candNorm = _sbNormalize(candidate);
    // Exact normalized match is best
    if (needleNorm === candNorm) return { item: haystack[i], score: 1, index: i };
    // Containment check
    let score = 0;
    if (needleNorm.includes(candNorm) || candNorm.includes(needleNorm)) {
      score = Math.min(needleNorm.length, candNorm.length) / Math.max(needleNorm.length, candNorm.length);
      score = Math.max(score, 0.8); // containment is high confidence
    } else {
      score = _sbSimilarity(needle, candidate);
    }
    if (score > bestScore) { best = haystack[i]; bestScore = score; bestIdx = i; }
  }
  return bestScore >= 0.4 ? { item: best, score: bestScore, index: bestIdx } : null;
};

/**
 * Join two arrays by fuzzy-matching a key field.
 * Returns source rows enriched with matched target row fields.
 * matchRows(inventory, sellThru, "Product", "SKU", 0.6)
 */
const _sbMatchRows = (sourceRows, targetRows, sourceKey, targetKey, threshold = 0.6) => {
  if (!Array.isArray(sourceRows) || !Array.isArray(targetRows)) return sourceRows || [];
  // Pre-build normalized lookup for targets
  const targetMap = [];
  for (const row of targetRows) {
    const val = row?.[targetKey];
    if (val != null) targetMap.push({ norm: _sbNormalize(val), raw: val, row });
  }
  return sourceRows.map((srcRow) => {
    const srcVal = srcRow?.[sourceKey];
    if (srcVal == null) return { ...srcRow, _matched: false };
    const srcNorm = _sbNormalize(srcVal);
    // Try exact normalized match first
    let match = targetMap.find((t) => t.norm === srcNorm);
    // Try containment
    if (!match) match = targetMap.find((t) => srcNorm.includes(t.norm) || t.norm.includes(srcNorm));
    // Try similarity
    if (!match) {
      let bestScore = 0, bestMatch = null;
      for (const t of targetMap) {
        const score = _sbSimilarity(srcVal, t.raw);
        if (score > bestScore) { bestScore = score; bestMatch = t; }
      }
      if (bestScore >= threshold) match = bestMatch;
    }
    if (match) {
      const merged = { ...srcRow };
      for (const [k, v] of Object.entries(match.row)) {
        if (k !== targetKey && merged[k] === undefined) merged[k] = v;
        else if (k !== targetKey) merged[`_target_${k}`] = v;
      }
      merged._matched = true;
      merged._matchedKey = match.raw;
      return merged;
    }
    return { ...srcRow, _matched: false };
  });
};

// Date processing helpers (gated by date_processing capability)
const _sbNow = () => new Date().toISOString().split("T")[0];
const _sbParseDate = (s) => { try { return new Date(s).toISOString().split("T")[0]; } catch { return ""; } };
const _sbMonthsBetween = (d1, d2) => {
  const a = new Date(d1), b = new Date(d2);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
};
const _sbStartOfWeek = (dateStr) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().split("T")[0];
};
const _sbFormatDate = (dateStr, fmt) => {
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  if (fmt === "MM/DD/YYYY") return `${String(m+1).padStart(2,"0")}/${String(day).padStart(2,"0")}/${y}`;
  if (fmt === "MMM D, YYYY") return `${months[m]} ${day}, ${y}`;
  return d.toISOString().split("T")[0]; // Default: YYYY-MM-DD
};

// ─── Plugin Sandbox Executor ───

/**
 * Code safety validation for plugins. Rejects dangerous patterns.
 * @param {string} code
 * @returns {string[]} Array of error messages (empty = safe)
 */
export function validatePluginCode(code) {
  const FORBIDDEN = [
    [/\beval\s*\(/, "eval() is forbidden"],
    [/\bnew\s+Function\s*\(/, "new Function() is forbidden"],
    [/\bimport\s*\(/, "dynamic import() is forbidden"],
    [/\brequire\s*\(/, "require() is forbidden"],
    [/\bwindow\b/, "window access is forbidden"],
    [/\bdocument\b/, "document access is forbidden"],
    [/\bglobalThis\b/, "globalThis access is forbidden"],
    [/\bprocess\b/, "process access is forbidden"],
    [/\b__proto__\b/, "__proto__ access is forbidden"],
    [/\bconstructor\s*\[/, "constructor bracket access is forbidden"],
  ];
  const errors = [];
  for (const [pattern, msg] of FORBIDDEN) {
    if (pattern.test(code)) errors.push(msg);
  }
  return errors;
}

/**
 * Execute plugin code with capability-gated extended helpers.
 * @param {string} code - JavaScript code
 * @param {object} datasets - Named data objects
 * @param {object} manifest - Plugin manifest with capabilities
 * @param {object} config - Runtime config (merged from configSchema defaults + overrides)
 * @param {string} [description] - Description for metadata
 * @returns {{ success: boolean, result: any, error?: string }}
 */
export function executePluginSandbox(code, datasets, manifest, config = {}, description = "Plugin executed") {
  const caps = new Set(manifest?.capabilities || []);

  // Build helper injection lists
  const helperNames = [
    // Standard helpers
    "sum", "avg", "min", "max", "groupBy", "sortBy", "unique", "round",
    "dateAdd", "dateDiff", "weeksBetween",
    // Smart matching (always available)
    "normalize", "similarity", "fuzzyMatch", "bestMatch", "matchRows",
    // Extended formatters + collection (always available for plugins)
    "currency", "percent", "compact", "flatten", "pick", "omit", "chunk", "zip",
  ];
  const helperValues = [
    _sbSum, _sbAvg, _sbMin, _sbMax, _sbGroupBy, _sbSortBy, _sbUnique, _sbRound,
    _sbDateAdd, _sbDateDiff, _sbWeeksBetween,
    _sbNormalize, _sbSimilarity, _sbFuzzyMatch, _sbBestMatch, _sbMatchRows,
    _sbCurrency, _sbPercent, _sbCompact, _sbFlatten, _sbPick, _sbOmit, _sbChunk, _sbZip,
  ];

  // Conditionally add text helpers
  if (caps.has("text_processing")) {
    helperNames.push("trim", "upper", "lower", "replace", "split", "join", "slug", "truncate", "template");
    helperValues.push(_sbTrim, _sbUpper, _sbLower, _sbReplace, _sbSplit, _sbJoin, _sbSlug, _sbTruncate, _sbTemplate);
  }

  // Conditionally add date helpers
  if (caps.has("date_processing")) {
    helperNames.push("now", "parseDate", "monthsBetween", "startOfWeek", "formatDate");
    helperValues.push(_sbNow, _sbParseDate, _sbMonthsBetween, _sbStartOfWeek, _sbFormatDate);
  }

  try {
    const trimmed = code.trim();
    let fnBody;
    if (trimmed.startsWith("(function") || trimmed.startsWith("(()")) {
      fnBody = `return (${trimmed})(datasets, config);`;
    } else if (trimmed.startsWith("function execute")) {
      fnBody = `${trimmed}\nreturn execute(datasets, config);`;
    } else if (trimmed.includes("return ")) {
      fnBody = trimmed;
    } else {
      fnBody = `return ${trimmed};`;
    }

    const fn = new Function("datasets", "config", ...helperNames, `"use strict";\n${fnBody}`);
    let result = fn(datasets, config, ...helperValues);

    // Enforce output row limit
    const maxRows = manifest?.permissions?.maxOutputRows || 1000;
    if (Array.isArray(result) && result.length > maxRows) {
      result = result.slice(0, maxRows);
    }
    if (result && typeof result === "object" && Array.isArray(result.data) && result.data.length > maxRows) {
      result.data = result.data.slice(0, maxRows);
    }

    return { success: true, result, description };
  } catch (err) {
    return { success: false, error: err.message, result: null };
  }
}

/**
 * Execute JavaScript code in a sandboxed new Function() with whitelisted helpers.
 * Shared by run_calculation and run_custom_function.
 *
 * @param {string} code - JavaScript code to execute
 * @param {object} datasets - named data objects available as `datasets` parameter
 * @param {string} [description] - human-readable description for result metadata
 * @returns {{ success: boolean, result: any, truncated?: boolean, totalRows?: number, description?: string }}
 */
export function executeSandbox(code, datasets, description = "Calculation completed") {
  let fnBody;
  const trimmed = code.trim();
  if (trimmed.startsWith("(function") || trimmed.startsWith("(()")) {
    fnBody = `"use strict";\nreturn (${trimmed});`;
  } else if (trimmed.startsWith("function execute")) {
    // Custom function format: function execute({ sales, inventory }) { ... }
    fnBody = `"use strict";\n${trimmed}\nreturn execute(datasets);`;
  } else if (trimmed.includes("return ")) {
    fnBody = `"use strict";\n${trimmed}`;
  } else {
    fnBody = `"use strict";\nreturn (${trimmed});`;
  }

  let fn;
  const helperNames = [
    "sum", "avg", "min", "max",
    "groupBy", "sortBy", "unique", "round",
    "dateAdd", "dateDiff", "weeksBetween",
    "normalize", "similarity", "fuzzyMatch", "bestMatch", "matchRows",
  ];
  const helperVals = [
    _sbSum, _sbAvg, _sbMin, _sbMax,
    _sbGroupBy, _sbSortBy, _sbUnique, _sbRound,
    _sbDateAdd, _sbDateDiff, _sbWeeksBetween,
    _sbNormalize, _sbSimilarity, _sbFuzzyMatch, _sbBestMatch, _sbMatchRows,
  ];
  try {
    fn = new Function("datasets", ...helperNames, fnBody);
  } catch {
    fn = new Function("datasets", ...helperNames, `"use strict";\n${trimmed}`);
  }

  const result = fn(datasets || {}, ...helperVals);

  const serialized = JSON.stringify(result);
  const maxOutputBytes = 200000; // 200KB — generous for function outputs
  const maxOutputRows = 1000;
  const isTruncated = serialized && serialized.length > maxOutputBytes;

  if (isTruncated && Array.isArray(result)) {
    const subset = result.slice(0, Math.min(result.length, maxOutputRows));
    return {
      success: true, description, result: subset,
      totalRows: result.length, truncated: true,
      note: `Result had ${result.length} rows. Showing first ${subset.length}.`,
    };
  }

  return { success: true, description, result, truncated: !!isTruncated };
}

/**
 * Validate that function output matches declared schema.
 * @returns {string[]} Array of error strings (empty = valid).
 */
function validateOutputSchema(result, outputs) {
  const errors = [];
  if (!outputs) return errors;
  const { type, schema } = outputs;

  if (type === "number") {
    if (typeof result !== "number") errors.push(`Expected output type "number", got "${typeof result}"`);
    return errors;
  }

  if (type === "table") {
    if (!Array.isArray(result)) {
      errors.push(`Expected output type "table" (array), got "${typeof result}"`);
      return errors;
    }
    if (result.length === 0 || !schema) return errors;

    const sample = result.slice(0, 5);
    for (const [fieldName, fieldType] of Object.entries(schema)) {
      for (let i = 0; i < sample.length; i++) {
        const val = sample[i][fieldName];
        if (val === undefined) { errors.push(`Row ${i}: missing field "${fieldName}"`); break; }
        if (fieldType === "number" && typeof val !== "number") { errors.push(`Field "${fieldName}" should be number, got "${typeof val}"`); break; }
        if (fieldType === "string" && typeof val !== "string") { errors.push(`Field "${fieldName}" should be string, got "${typeof val}"`); break; }
      }
    }
    return errors;
  }

  if (type === "chart_config") {
    if (typeof result !== "object" || Array.isArray(result)) errors.push(`Expected "chart_config" (object), got "${typeof result}"`);
  }

  return errors;
}

/**
 * Basic sanity checks on output values. Non-blocking warnings.
 * @returns {string[]} Array of warning strings.
 */
function runSanityChecks(result, outputs) {
  const warnings = [];
  if (!result || !outputs?.schema) return warnings;

  const rows = Array.isArray(result) ? result.slice(0, 50) : [result];

  for (const [field, fieldType] of Object.entries(outputs.schema)) {
    if (fieldType !== "number") continue;
    for (const row of rows) {
      const val = row[field];
      if (typeof val !== "number") continue;
      if (!isFinite(val)) { warnings.push(`Field "${field}" contains non-finite value (Infinity/NaN)`); break; }
      if ((field.toLowerCase().includes("percent") || field.toLowerCase().includes("rate")) && (val < 0 || val > 100)) {
        warnings.push(`Field "${field}" has value ${val} — expected 0-100 for percentages`); break;
      }
      if ((field.toLowerCase().includes("qty") || field.toLowerCase().includes("quantity") || field.toLowerCase().includes("count")) && val < 0) {
        warnings.push(`Field "${field}" has negative value ${val}`); break;
      }
    }
  }

  return warnings;
}

// ─── Source Resolution Helpers ───

/** Fetch and cache page config for an ID. Returns full config or null. */
async function getFullPageConfig(id) {
  try {
    return await api.getPageConfig(id);
  } catch {
    return null;
  }
}

/** Get the page_type for an ID, or null if not found. */
async function getPageType(id) {
  const cfg = await getFullPageConfig(id);
  return cfg?.page_type || null;
}

/** Check if a database_id refers to a D1 standalone table or sheet (vs Notion DB). */
async function isD1Table(id) {
  const pt = await getPageType(id);
  return pt === "database" || pt === "sheet";
}

/**
 * Fetch rows from a linked Google Sheet page.
 * Returns array of { [columnName]: value } objects.
 */
async function fetchLinkedSheetRows(pageConfig, workerUrl) {
  // Find sheetUrl from views config
  const sheetView = pageConfig.views?.find((v) => v.type === "linked_sheet");
  const sheetUrl = sheetView?.config?.sheetUrl || pageConfig.sheetUrl;
  if (!sheetUrl || !workerUrl) return [];

  const data = await fetchSheetData(workerUrl, sheetUrl);
  if (!data?.columns?.length || !data?.rows?.length) return [];

  // Convert 2D array to row objects
  return data.rows.map((row, idx) => {
    const obj = { _row: idx + 2 };
    data.columns.forEach((col, i) => {
      if (row[i] !== undefined && row[i] !== null && row[i] !== "") {
        obj[col] = row[i];
      }
    });
    return obj;
  });
}

/**
 * Fetch rows from a linked Monday.com board.
 * Returns array of flat { [columnTitle]: value } objects.
 */
async function fetchLinkedMondayRows(pageConfig, mondayKey) {
  const boardId = pageConfig.mondayBoardId;
  if (!boardId || !mondayKey) return [];

  const [columns, items] = await Promise.all([
    fetchBoardColumns(mondayKey, boardId),
    fetchBoardItems(mondayKey, boardId),
  ]);

  // Convert Monday items to flat row objects
  return items.map((item) => {
    const row = { _id: item.id, Name: item.name };
    if (item.group?.title) row._group = item.group.title;
    for (const cv of (item.column_values || [])) {
      const col = columns.find((c) => c.id === cv.id);
      const label = col?.title || cv.id;
      if (cv.text) row[label] = cv.text;
    }
    return row;
  });
}

/**
 * Convert sheet grid cells { "A1": {v:...}, "B2": {v:...} } into row objects with headers.
 * Detects whether row 1 contains headers or data values.
 * Always collects all numeric values into _allCellValues for easy aggregation.
 */
function sheetCellsToRows(cells, colCount = 26) {
  if (!cells || typeof cells !== "object") return [];

  // Build column labels (A, B, C, ...)
  const colLabels = [];
  for (let i = 0; i < colCount; i++) {
    let label = "";
    let n = i + 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      label = String.fromCharCode(65 + rem) + label;
      n = Math.floor((n - 1) / 26);
    }
    colLabels.push(label);
  }

  // Find the max row number present in cells
  let maxRow = 0;
  for (const key of Object.keys(cells)) {
    const rowNum = parseInt(key.replace(/^[A-Z]+/, ""), 10);
    if (rowNum > maxRow) maxRow = rowNum;
  }
  if (maxRow === 0) return [];

  // Read row 1 values
  const row1Values = {};
  let row1Count = 0;
  let row1NumericCount = 0;
  for (const col of colLabels) {
    const cell = cells[`${col}1`];
    const val = cell && typeof cell === "object" ? cell.v : cell;
    if (val !== undefined && val !== null && val !== "") {
      row1Values[col] = val;
      row1Count++;
      const num = Number(val);
      if (!isNaN(num) && String(val).trim() !== "") row1NumericCount++;
    }
  }

  // Detect if row 1 is headers or data:
  // If most row 1 values are numeric, treat as data (not headers)
  const row1IsData = row1Count > 0 && (row1NumericCount / row1Count) > 0.5;

  // Build headers (only if row 1 looks like headers)
  const headers = {};
  if (!row1IsData) {
    for (const [col, val] of Object.entries(row1Values)) {
      headers[col] = String(val).trim();
    }
  }

  // Collect ALL numeric values across the entire sheet for easy aggregation
  const allCellValues = [];
  for (const key of Object.keys(cells)) {
    if (key === "_meta") continue;
    const cell = cells[key];
    const val = cell && typeof cell === "object" ? cell.v : cell;
    if (val === undefined || val === null || val === "") continue;
    const num = Number(val);
    if (!isNaN(num) && String(val).trim() !== "") allCellValues.push(num);
  }

  // Build rows (start from row 1 if it's data, row 2 if it's headers)
  const startRow = row1IsData ? 1 : 2;
  const rows = [];
  for (let r = startRow; r <= maxRow; r++) {
    const row = {};
    // _row is non-enumerable so it doesn't pollute Object.values()/entries() sums
    Object.defineProperty(row, "_row", { value: r, enumerable: false });
    let hasData = false;
    for (const col of colLabels) {
      const cell = cells[`${col}${r}`];
      const val = cell && typeof cell === "object" ? cell.v : cell;
      const header = headers[col] || col;
      if (val !== undefined && val !== null && val !== "") {
        row[header] = val;
        hasData = true;
      }
    }
    if (hasData) rows.push(row);
  }

  // Attach metadata for aggregation helpers
  rows._allCellValues = allCellValues;
  rows._row1IsData = row1IsData;
  return rows;
}

/** Convert Notion-format properties to flat D1 cells. */
function notionPropsToD1Cells(props) {
  const cells = {};
  for (const [key, val] of Object.entries(props)) {
    if (val?.title)
      cells[key] = val.title.map((t) => t.text?.content || t.plain_text || "").join("");
    else if (val?.rich_text)
      cells[key] = val.rich_text.map((t) => t.text?.content || t.plain_text || "").join("");
    else if (val?.number != null) cells[key] = val.number;
    else if (val?.select) cells[key] = val.select.name || val.select;
    else if (val?.date) cells[key] = val.date.start || "";
    else if (val?.checkbox != null) cells[key] = val.checkbox;
    else if (val?.url) cells[key] = val.url;
    else if (val?.email) cells[key] = val.email;
    else if (typeof val === "string") cells[key] = val;
    else cells[key] = val;
  }
  return cells;
}

/**
 * Create a tool executor bound to a specific user's credentials and platform config.
 *
 * @param {object} opts
 * @param {string} opts.workerUrl
 * @param {string} opts.notionKey
 * @param {string} opts.mondayKey - Monday.com API key (optional)
 * @param {string} opts.parentPageId - Root Wasabi page in user's Notion
 * @param {string} opts.kbDbId - Knowledge Base database ID
 * @param {string} opts.notifDbId - Notifications database ID
 * @param {string} opts.configDbId - Page Config database ID
 * @param {string} opts.rulesDbId - Automation Rules database ID
 * @param {Function} opts.onPageCreated - Callback when a new page config is created
 * @returns {Function} executeTool(toolName, toolInput) => string
 */
export function createToolExecutor({
  workerUrl,
  notionKey,
  mondayKey,
  parentPageId,
  kbDbId,
  notifDbId,
  configDbId,
  rulesDbId,
  onPageCreated,
  claudeKey,
}) {
  return async function executeTool(toolName, toolInput) {
    switch (toolName) {
      // ─── Database Operations ───
      case "query_database": {
        const qCfg = await getFullPageConfig(toolInput.database_id);
        const pageType = qCfg?.page_type || null;

        // Functions pass _maxRows to get full datasets (default: chat-friendly limits)
        const maxRows = toolInput._maxRows || 0;
        const chatLimit = maxRows > 0 ? maxRows : 200;
        const notionChatLimit = maxRows > 0 ? maxRows : 5000; // Notion queries are already paginated; give functions the full dataset

        // D1 sheet path — grid cells converted to rows
        if (pageType === "sheet") {
          try {
            const sheet = await api.getSheet(toolInput.database_id);
            const rows = sheetCellsToRows(sheet.cells, sheet.col_count || 26);
            const cap = maxRows > 0 ? maxRows : 200;
            return JSON.stringify({
              count: rows.length,
              results: rows.slice(0, cap),
              truncated: rows.length > cap,
              storage: "sheet",
              _allCellValues: rows._allCellValues || [],
              _row1IsData: rows._row1IsData || false,
            });
          } catch (err) {
            return JSON.stringify({ error: `Failed to read sheet: ${err.message}`, storage: "sheet" });
          }
        }

        // D1 standalone table path
        if (pageType === "database") {
          const queryBody = {};
          if (toolInput.filter) queryBody.filters = toolInput.filter;
          if (toolInput.sorts) queryBody.sorts = toolInput.sorts;
          queryBody.limit = chatLimit;

          let rows;
          try {
            const res = await api.queryTable(toolInput.database_id, queryBody);
            rows = res?.rows || [];
          } catch {
            const res = await api.listRows(toolInput.database_id, { limit: chatLimit });
            rows = res?.rows || [];
          }
          return JSON.stringify({
            count: rows.length,
            results: rows.slice(0, chatLimit),
            truncated: rows.length > chatLimit,
            storage: "d1",
          });
        }

        // Linked Google Sheet — read-only via worker proxy
        if (pageType === "linked_sheet") {
          try {
            const rows = await fetchLinkedSheetRows(qCfg, workerUrl);
            return JSON.stringify({
              count: rows.length,
              results: rows.slice(0, chatLimit),
              truncated: rows.length > chatLimit,
              storage: "linked_sheet",
              readOnly: true,
            });
          } catch (err) {
            return JSON.stringify({ error: `Failed to read linked sheet: ${err.message}`, storage: "linked_sheet" });
          }
        }

        // Linked Monday.com board — read/write via GraphQL proxy
        if (pageType === "linked_monday") {
          try {
            const rows = await fetchLinkedMondayRows(qCfg, mondayKey);
            return JSON.stringify({
              count: rows.length,
              results: rows.slice(0, chatLimit),
              truncated: rows.length > chatLimit,
              storage: "linked_monday",
            });
          } catch (err) {
            return JSON.stringify({ error: `Failed to read Monday board: ${err.message}`, storage: "linked_monday" });
          }
        }

        // Linked Notion — use databaseIds from page config
        if (pageType === "linked_notion" && qCfg?.databaseIds?.length) {
          const allData = [];
          for (const dbId of qCfg.databaseIds) {
            try {
              const results = await queryAll(workerUrl, notionKey, dbId, toolInput.filter, toolInput.sorts);
              const mapped = results.map((page) => ({ id: page.id, ...extractProperties(page), _databaseId: dbId }));
              allData.push(...mapped);
            } catch (err) {
              allData.push({ _error: `Failed to query ${dbId}: ${err.message}` });
            }
          }
          return JSON.stringify({
            count: allData.length,
            results: allData.slice(0, notionChatLimit),
            truncated: allData.length > notionChatLimit,
            storage: "linked_notion",
          });
        }

        // Direct Notion database path (fallback — raw Notion DB ID)
        const results = await queryAll(
          workerUrl, notionKey,
          toolInput.database_id,
          toolInput.filter,
          toolInput.sorts
        );
        const summary = results.map((page) => {
          const props = extractProperties(page);
          return { id: page.id, ...props };
        });
        const directCap = maxRows > 0 ? maxRows : 200;
        return JSON.stringify({
          count: summary.length,
          results: summary.slice(0, directCap),
          truncated: summary.length > directCap,
        });
      }

      case "get_page": {
        const page = await client.getPage(workerUrl, notionKey, toolInput.page_id);
        const props = extractProperties(page);
        return JSON.stringify({ id: page.id, ...props });
      }

      case "create_page": {
        // D1 standalone table — create a row
        if (await isD1Table(toolInput.database_id)) {
          const cells = notionPropsToD1Cells(toolInput.properties);
          const res = await api.createRows(toolInput.database_id, [cells]);
          const newId = res?.ids?.[0] || res?.id || "created";
          return JSON.stringify({ id: newId, success: true, storage: "d1" });
        }
        // Notion path
        const page = await client.createPage(
          workerUrl, notionKey,
          toolInput.database_id,
          toolInput.properties
        );
        return JSON.stringify({ id: page.id, url: page.url, success: true });
      }

      case "update_page": {
        // D1 row update: page_id format is "tableId:rowId" or we check if it's a D1 row
        const pageId = toolInput.page_id;
        if (pageId && pageId.includes(":")) {
          // Explicit D1 format — "tableId:rowId"
          const [tableId, rowId] = pageId.split(":");
          const cells = notionPropsToD1Cells(toolInput.properties);
          await api.updateRow(tableId, rowId, { cells });
          return JSON.stringify({ success: true, page_id: pageId, storage: "d1" });
        }

        // Check if it looks like a D1 row ID (and a database_id hint is provided)
        if (toolInput.database_id && await isD1Table(toolInput.database_id)) {
          const cells = notionPropsToD1Cells(toolInput.properties);
          await api.updateRow(toolInput.database_id, pageId, { cells });
          return JSON.stringify({ success: true, page_id: pageId, storage: "d1" });
        }

        // Notion path
        await client.updatePage(
          workerUrl, notionKey,
          pageId,
          toolInput.properties
        );
        return JSON.stringify({ success: true, page_id: pageId });
      }

      // ─── Cross-Database Query ───
      case "cross_database_query": {
        const queries = toolInput.queries || [];
        const allResults = {};
        for (const q of queries.slice(0, 5)) {
          const label = q.label || q.database_id;
          try {
            const xCfg = await getFullPageConfig(q.database_id);
            const xType = xCfg?.page_type || null;

            if (xType === "sheet") {
              const sheet = await api.getSheet(q.database_id);
              const rows = sheetCellsToRows(sheet.cells, sheet.col_count || 26);
              allResults[label] = { count: rows.length, results: rows.slice(0, 100), truncated: rows.length > 100, storage: "sheet" };
            } else if (xType === "database") {
              const queryBody = { limit: 100 };
              if (q.filter) queryBody.filters = q.filter;
              if (q.sorts) queryBody.sorts = q.sorts;
              let rows;
              try { rows = (await api.queryTable(q.database_id, queryBody))?.rows || []; }
              catch { rows = (await api.listRows(q.database_id, { limit: 100 }))?.rows || []; }
              allResults[label] = { count: rows.length, results: rows.slice(0, 100), truncated: rows.length > 100, storage: "d1" };
            } else if (xType === "linked_sheet") {
              const rows = await fetchLinkedSheetRows(xCfg, workerUrl);
              allResults[label] = { count: rows.length, results: rows.slice(0, 100), truncated: rows.length > 100, storage: "linked_sheet", readOnly: true };
            } else if (xType === "linked_monday") {
              const rows = await fetchLinkedMondayRows(xCfg, mondayKey);
              allResults[label] = { count: rows.length, results: rows.slice(0, 100), truncated: rows.length > 100, storage: "linked_monday" };
            } else if (xType === "linked_notion" && xCfg?.databaseIds?.length) {
              const allData = [];
              for (const dbId of xCfg.databaseIds) {
                const res = await queryAll(workerUrl, notionKey, dbId, q.filter, q.sorts);
                allData.push(...res.map((p) => ({ id: p.id, ...extractProperties(p) })));
              }
              allResults[label] = { count: allData.length, results: allData.slice(0, 100), truncated: allData.length > 100, storage: "linked_notion" };
            } else {
              // Direct Notion DB ID
              const res = await queryAll(workerUrl, notionKey, q.database_id, q.filter, q.sorts);
              const mapped = res.map((p) => ({ id: p.id, ...extractProperties(p) }));
              allResults[label] = { count: mapped.length, results: mapped.slice(0, 30), truncated: mapped.length > 30 };
            }
          } catch (err) {
            allResults[label] = { error: err.message };
          }
        }
        return JSON.stringify(allResults);
      }

      // ─── Database Schema Update ───
      case "update_database": {
        const payload = {};

        // Title update
        if (toolInput.title) {
          payload.title = [{ type: "text", text: { content: toolInput.title } }];
        }

        // Build properties update
        const propUpdates = {};

        // Add new properties
        if (toolInput.add_properties) {
          for (const field of toolInput.add_properties) {
            const propDef = {};
            switch (field.type) {
              case "rich_text": propDef.rich_text = {}; break;
              case "number": propDef.number = { format: field.format || "number" }; break;
              case "select":
                propDef.select = { options: (field.options || []).map((o) => typeof o === "string" ? { name: o } : o) };
                break;
              case "status":
                propDef.status = { options: (field.options || []).map((o) => typeof o === "string" ? { name: o } : o) };
                break;
              case "multi_select":
                propDef.multi_select = { options: (field.options || []).map((o) => typeof o === "string" ? { name: o } : o) };
                break;
              case "date": propDef.date = {}; break;
              case "checkbox": propDef.checkbox = {}; break;
              case "url": propDef.url = {}; break;
              case "email": propDef.email = {}; break;
              case "phone_number": propDef.phone_number = {}; break;
              case "relation": {
                const relDef = { database_id: field.database_id };
                if (field.synced_property_name) {
                  relDef.type = "dual_property";
                  relDef.dual_property = { synced_property_name: field.synced_property_name };
                } else {
                  relDef.type = "single_property";
                  relDef.single_property = {};
                }
                propDef.relation = relDef;
                break;
              }
              default: propDef.rich_text = {};
            }
            propUpdates[field.name] = propDef;
          }
        }

        // Rename properties
        if (toolInput.rename_properties) {
          for (const [oldName, newName] of Object.entries(toolInput.rename_properties)) {
            propUpdates[oldName] = { name: newName };
          }
        }

        // Remove properties (set to null in Notion API)
        if (toolInput.remove_properties) {
          for (const name of toolInput.remove_properties) {
            propUpdates[name] = null;
          }
        }

        if (Object.keys(propUpdates).length > 0) {
          payload.properties = propUpdates;
        }

        const result = await client.updateDatabase(workerUrl, notionKey, toolInput.database_id, payload);
        return JSON.stringify({ success: true, database_id: toolInput.database_id, title: toolInput.title || result.title?.[0]?.plain_text });
      }

      // ─── Database Creation ───
      case "create_database": {
        // Ensure root page is active (auto-unarchive if needed)
        if (parentPageId) {
          await client.ensurePageActive(workerUrl, notionKey, parentPageId);
        }
        const db = await client.createDatabase(
          workerUrl, notionKey,
          parentPageId,
          toolInput.title,
          toolInput.schema
        );
        return JSON.stringify({ database_id: db.id, title: toolInput.title, success: true });
      }

      // ─── Schema Detection ───
      case "detect_schema": {
        const sCfg = await getFullPageConfig(toolInput.database_id);
        const schemaPageType = sCfg?.page_type || null;

        // D1 sheet — read headers from row 1
        if (schemaPageType === "sheet") {
          try {
            const sheet = await api.getSheet(toolInput.database_id);
            const colLabels = [];
            for (let i = 0; i < (sheet.col_count || 26); i++) {
              let label = "";
              let n = i + 1;
              while (n > 0) { const rem = (n - 1) % 26; label = String.fromCharCode(65 + rem) + label; n = Math.floor((n - 1) / 26); }
              colLabels.push(label);
            }
            const columns = [];
            for (const col of colLabels) {
              const cell = sheet.cells?.[`${col}1`];
              const val = cell && typeof cell === "object" ? cell.v : cell;
              if (val) columns.push({ name: String(val).trim(), column: col, type: "text" });
            }
            const text = columns.map((c) => `- ${c.name} (column ${c.column}, text)`).join("\n");
            return JSON.stringify({ schema: text, fieldCount: columns.length, raw: { columns, storage: "sheet" }, suggestedViews: [] });
          } catch (err) {
            return JSON.stringify({ error: `Failed to detect sheet schema: ${err.message}` });
          }
        }

        // D1 standalone table
        if (schemaPageType === "database") {
          try {
            const d1Schema = await api.getTableSchema(toolInput.database_id);
            const columns = d1Schema?.columns || [];
            const text = columns.map((c) =>
              `- ${c.name} (${c.type}${c.options?.length ? `: ${c.options.join(", ")}` : ""})`
            ).join("\n");
            return JSON.stringify({ schema: text, fieldCount: columns.length, raw: { columns, storage: "d1" }, suggestedViews: [] });
          } catch (err) {
            return JSON.stringify({ error: `Failed to detect D1 schema: ${err.message}` });
          }
        }

        // Linked Google Sheet — detect columns from fetched data
        if (schemaPageType === "linked_sheet") {
          try {
            const rows = await fetchLinkedSheetRows(sCfg, workerUrl);
            const colNames = rows.length > 0 ? Object.keys(rows[0]).filter((k) => k !== "_row") : [];
            const text = colNames.map((c) => `- ${c} (text)`).join("\n");
            return JSON.stringify({ schema: text, fieldCount: colNames.length, raw: { columns: colNames, storage: "linked_sheet" }, suggestedViews: [] });
          } catch (err) {
            return JSON.stringify({ error: `Failed to detect linked sheet schema: ${err.message}` });
          }
        }

        // Linked Monday — detect columns from board definition
        if (schemaPageType === "linked_monday") {
          try {
            const columns = await fetchBoardColumns(mondayKey, sCfg.mondayBoardId);
            const text = columns.map((c) => `- ${c.title} (${c.type})`).join("\n");
            return JSON.stringify({ schema: text, fieldCount: columns.length, raw: { columns, storage: "linked_monday" }, suggestedViews: [] });
          } catch (err) {
            return JSON.stringify({ error: `Failed to detect Monday schema: ${err.message}` });
          }
        }

        // Linked Notion — detect schema from first databaseId
        if (schemaPageType === "linked_notion" && sCfg?.databaseIds?.length) {
          const schema = await detectSchema(workerUrl, notionKey, sCfg.databaseIds[0]);
          const views = autoDetectViews(schema);
          const text = schemaToText(schema);
          return JSON.stringify({ schema: text, suggestedViews: views, fieldCount: schema.allFields.length, raw: schema });
        }

        // Direct Notion DB ID fallback
        const schema = await detectSchema(workerUrl, notionKey, toolInput.database_id);
        const views = autoDetectViews(schema);
        const text = schemaToText(schema);
        return JSON.stringify({ schema: text, suggestedViews: views, fieldCount: schema.allFields.length, raw: schema });
      }

      // ─── Page Config Creation ───
      case "create_page_config": {
        const { name, icon, databaseIds, views, agentPrompt, columns } = toolInput;
        const pageType = toolInput.page_type || "database";
        const pageConfig = {
          name,
          icon: icon || (pageType === "document" ? "page" : "table"),
          parentId: toolInput.parent_id || null,
          page_type: pageType,
          pageType: pageType,
          databaseIds: databaseIds || [],
          agentConfig: {
            model: "claude-haiku-4-5-20251001",
            prompt: agentPrompt || `You are a helpful assistant for the "${name}" page.`,
            tools: ["query_database", "get_page", "create_page", "update_page", "post_notification", "escalate_to_wasabi"],
            databases: databaseIds || [],
          },
          views: (views || []).map((v) => ({
            type: v.type,
            label: v.label || v.type,
            position: v.position || "main",
            config: v.config || {},
          })),
          createdAt: new Date().toISOString(),
        };

        // For standalone D1 tables, include column definitions so the worker creates the schema
        // Default to a basic Name column if the LLM omits columns
        const resolvedColumns = (columns && columns.length > 0)
          ? columns
          : (pageType === "database" ? [{ name: "Name", type: "text" }] : null);
        if (pageType === "database" && resolvedColumns) {
          pageConfig.columns = resolvedColumns.map((c) => ({
            name: c.name,
            type: c.type || "text",
            id: c.id || c.name.toLowerCase().replace(/\s+/g, "_"),
            ...(c.options ? { options: c.options } : {}),
          }));
        }

        // Save to D1 (primary path — works without Notion)
        const pageId = await savePageConfig(pageConfig);
        pageConfig.id = pageId;

        // Notify the UI to add this page
        if (onPageCreated) onPageCreated(pageConfig);

        return JSON.stringify({ success: true, pageId, name });
      }

      // ─── Knowledge Base ───
      case "update_knowledge_base": {
        await writeKB(workerUrl, notionKey, kbDbId, {
          key: toolInput.key,
          category: toolInput.category,
          content: toolInput.content,
        });
        return JSON.stringify({ success: true, key: toolInput.key });
      }

      case "search_knowledge_base": {
        const results = await searchKB(workerUrl, notionKey, kbDbId, {
          query: toolInput.query,
          category: toolInput.category,
        });
        return kbResultsToText(results);
      }

      // ─── Notifications ───
      case "post_notification": {
        const notifPayload = {
          message: toolInput.message,
          type: toolInput.type || "notification",
          source: toolInput.source || "wasabi",
          record_id: toolInput.record_id || "",
          record_name: toolInput.record_name || "",
          page_config_id: toolInput.page_config_id || "",
          page_name: toolInput.page_name || "",
        };
        // D1 path (preferred) — no notifDbId needed
        if (!notifDbId || notifDbId === "d1") {
          await api.createNotification(notifPayload);
        } else {
          // Legacy Notion path
          await client.postNotification(workerUrl, notionKey, notifDbId, notifPayload);
        }
        return JSON.stringify({ success: true });
      }

      // ─── Automation Rule Creation ───
      case "create_automation_rule": {
        // D1 path (preferred)
        const ruleResult = await api.createRule({
          name: toolInput.name || "Untitled Rule",
          description: toolInput.description || "",
          trigger_type: toolInput.trigger,
          trigger_config: toolInput.trigger_config || {},
          action_config: {
            instruction: toolInput.instruction || "",
            database_id: toolInput.database_id || "",
            owner_page: toolInput.owner_page || "",
          },
          enabled: true,
          scope_table_id: toolInput.database_id || null,
        });
        return JSON.stringify({ success: true, rule_id: ruleResult.id, name: toolInput.name });
      }

      // ─── File Processing ───
      case "process_uploaded_files": {
        const { files: inputFiles, action, target_database_id } = toolInput;
        if (!inputFiles?.length) {
          return JSON.stringify({ error: "No files provided." });
        }

        if (action === "analyze") {
          // Parse and summarize each file
          const summaries = inputFiles.map((f) => {
            const lines = (f.text || "").split("\n");
            const isCSV = f.type === "csv" || f.type === "tsv" || f.name?.endsWith(".csv") || f.name?.endsWith(".tsv");
            let summary = { name: f.name, type: f.type, lineCount: lines.length };

            if (isCSV && lines.length > 0) {
              // Parse CSV headers and sample data
              const headers = lines[0].split(/[,\t]/);
              summary.headers = headers.map((h) => h.trim().replace(/^"|"$/g, ""));
              summary.rowCount = lines.length - 1;
              summary.sampleRows = lines.slice(1, 4).map((row) => row.substring(0, 200));
            } else if (f.type === "json") {
              try {
                const parsed = JSON.parse(f.text);
                if (Array.isArray(parsed)) {
                  summary.recordCount = parsed.length;
                  summary.sampleKeys = parsed.length > 0 ? Object.keys(parsed[0]) : [];
                } else {
                  summary.keys = Object.keys(parsed);
                }
              } catch {
                summary.parseError = true;
              }
            } else {
              summary.preview = (f.text || "").substring(0, 500);
            }

            return summary;
          });

          return JSON.stringify({ action: "analyze", files: summaries });
        }

        if (action === "create_records" && target_database_id) {
          // Parse CSV/JSON files into records and attempt bulk D1 insert
          const created = [];
          const errors = [];
          let isD1 = false;
          try {
            const cfg = await api.getPageConfig(target_database_id);
            isD1 = cfg && cfg.page_type === "database";
          } catch { /* not D1 */ }

          for (const f of inputFiles) {
            try {
              const isCSV = f.type === "csv" || f.type === "tsv" || f.name?.endsWith(".csv") || f.name?.endsWith(".tsv");
              let records = [];

              if (isCSV) {
                const lines = (f.text || "").split("\n").filter((l) => l.trim());
                if (lines.length < 2) continue;
                const sep = f.type === "tsv" || f.name?.endsWith(".tsv") ? "\t" : ",";
                const headers = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, ""));
                for (let i = 1; i < lines.length; i++) {
                  const vals = lines[i].split(sep).map((v) => v.trim().replace(/^"|"$/g, ""));
                  const record = {};
                  headers.forEach((h, j) => { if (vals[j]) record[h] = vals[j]; });
                  records.push(record);
                }
              } else if (f.type === "json") {
                const parsed = JSON.parse(f.text);
                records = Array.isArray(parsed) ? parsed : [parsed];
              }

              // If D1 table, bulk insert directly
              if (isD1 && records.length > 0) {
                let totalInserted = 0;
                for (let i = 0; i < records.length; i += 25) {
                  const batch = records.slice(i, i + 25);
                  await api.createRows(target_database_id, batch);
                  totalInserted += batch.length;
                }
                created.push({
                  file: f.name,
                  recordCount: records.length,
                  inserted: totalInserted,
                  storage: "d1",
                  sampleRecord: records[0] || null,
                });
              } else {
                created.push({
                  file: f.name,
                  recordCount: records.length,
                  sampleRecord: records[0] || null,
                  records: records.slice(0, 50),
                });
              }
            } catch (err) {
              errors.push({ file: f.name, error: err.message });
            }
          }

          return JSON.stringify({
            action: "create_records",
            target_database_id,
            parsed: created,
            errors,
            note: isD1
              ? `Records bulk-inserted into D1 table. ${created.reduce((s, c) => s + (c.inserted || 0), 0)} total rows created.`
              : "Records parsed. Use create_page tool to insert each record into the target database.",
          });
        }

        if (action === "index_to_kb") {
          if (!kbDbId) {
            return JSON.stringify({ error: "Knowledge base not configured." });
          }

          const indexed = [];
          for (const f of inputFiles) {
            const content = (f.text || "").substring(0, 1800); // KB entries have a size limit
            try {
              await writeKB(workerUrl, notionKey, kbDbId, {
                key: `upload:${f.name}`,
                category: "business_context",
                content: `[Uploaded file: ${f.name}]\n${content}`,
                source: "upload",
              });
              indexed.push(f.name);
            } catch (err) {
              indexed.push(`${f.name} (failed: ${err.message})`);
            }
          }

          return JSON.stringify({ action: "index_to_kb", indexed });
        }

        return JSON.stringify({ error: `Unknown action: ${action}` });
      }

      // ─── Smart Match Records ───
      case "smart_match_records": {
        const { database_id, search_terms, match_field } = toolInput;
        if (!database_id || !search_terms?.length) {
          return JSON.stringify({ error: "database_id and search_terms are required." });
        }

        const matches = [];
        const smCfg = await getFullPageConfig(database_id);
        const smPageType = smCfg?.page_type || null;

        // Load rows from any source into flat row objects for fuzzy matching
        let allRows = null;
        try {
          if (smPageType === "sheet") {
            const sheet = await api.getSheet(database_id);
            allRows = sheetCellsToRows(sheet.cells, sheet.col_count || 26);
          } else if (smPageType === "database") {
            const res = await api.listRows(database_id, { limit: 500 });
            allRows = (res?.rows || []).map((r) => ({ id: r.id, ...(r.cells || r) }));
          } else if (smPageType === "linked_sheet") {
            allRows = await fetchLinkedSheetRows(smCfg, workerUrl);
          } else if (smPageType === "linked_monday") {
            allRows = await fetchLinkedMondayRows(smCfg, mondayKey);
          } else if (smPageType === "linked_notion" && smCfg?.databaseIds?.length) {
            const res = await queryAll(workerUrl, notionKey, smCfg.databaseIds[0]);
            allRows = res.map((p) => ({ id: p.id, ...extractProperties(p) }));
          }
        } catch { /* fall through to Notion path */ }

        if (allRows !== null) {
          // Fuzzy match across flat rows
          for (const term of search_terms.slice(0, 10)) {
            const termLower = term.toLowerCase();
            const matched = allRows
              .map((row) => {
                let score = 0;
                for (const val of Object.values(row)) {
                  if (String(val).toLowerCase().includes(termLower)) score++;
                }
                return { ...row, _matchScore: score };
              })
              .filter((r) => r._matchScore > 0)
              .sort((a, b) => b._matchScore - a._matchScore)
              .slice(0, 5);
            if (matched.length > 0) matches.push({ term, matches: matched });
          }
        } else {
          // Direct Notion DB ID fallback
          for (const term of search_terms.slice(0, 10)) {
            try {
              const filter = match_field ? { property: match_field, rich_text: { contains: term } } : undefined;
              const results = await queryAll(workerUrl, notionKey, database_id, filter);
              const matched = results
                .map((page) => {
                  const props = extractProperties(page);
                  const termLower = term.toLowerCase();
                  let score = 0;
                  for (const [, val] of Object.entries(props)) {
                    if (String(val).toLowerCase().includes(termLower)) score++;
                  }
                  return { id: page.id, ...props, _matchScore: score };
                })
                .filter((r) => r._matchScore > 0)
                .sort((a, b) => b._matchScore - a._matchScore)
                .slice(0, 5);
              if (matched.length > 0) matches.push({ term, matches: matched });
            } catch (err) {
              matches.push({ term, error: err.message });
            }
          }
        }

        return JSON.stringify({
          search_terms,
          database_id,
          results: matches,
          totalMatches: matches.reduce((sum, m) => sum + (m.matches?.length || 0), 0),
        });
      }

      // ─── Neuron Operations ───

      case "query_neurons": {
        try {
          if (toolInput.node_id) {
            const res = await api.getNeuronsByNode(toolInput.node_id);
            return JSON.stringify({
              count: (res.neurons || []).length,
              neurons: res.neurons || [],
            });
          }
          const res = await api.getNeuronGraph();
          return JSON.stringify({
            count: (res.neurons || []).length,
            neurons: (res.neurons || []).slice(0, 50),
            truncated: (res.neurons || []).length > 50,
          });
        } catch (err) {
          return JSON.stringify({ error: err.message });
        }
      }

      case "create_neuron": {
        try {
          const res = await api.createNeuronAPI(toolInput.name || "", toolInput.nodes || []);
          return JSON.stringify({ success: true, neuron_id: res.id, node_count: (toolInput.nodes || []).length });
        } catch (err) {
          return JSON.stringify({ error: err.message });
        }
      }

      // ─── Calculation Sandbox ───

      case "run_calculation": {
        const { datasets, code, description } = toolInput;
        if (!code) return JSON.stringify({ error: "No code provided." });
        try {
          return JSON.stringify(executeSandbox(code, datasets, description || "Calculation completed"));
        } catch (err) {
          return JSON.stringify({
            error: `Calculation failed: ${err.message}`,
            description: description || "",
            hint: "Check your code syntax. Use an IIFE: (function() { ... return result; })()",
          });
        }
      }

      // ─── Custom Functions ───

      case "save_custom_function": {
        const { id: fnId, name, description: fnDesc, type: fnType, inputs, outputs, code, write_back, _confirmed } = toolInput;
        if (!name || !code) return JSON.stringify({ error: "name and code are required." });

        // Step 1: Syntax check
        try {
          new Function("datasets", `"use strict";\n${code.trim()}\nreturn typeof execute === 'function' ? execute(datasets) : undefined;`);
        } catch (syntaxErr) {
          return JSON.stringify({ error: `Syntax error: ${syntaxErr.message}`, step: "syntax_check" });
        }

        // Step 2: Dry run with real data
        let dryRunResult;
        try {
          const datasets = {};
          for (const [key, inputDef] of Object.entries(inputs || {})) {
            if (inputDef.source === "query_database" && inputDef.database_id) {
              const queryInput = { database_id: inputDef.database_id, _maxRows: 5000 };
              if (inputDef.filter) queryInput.filter = inputDef.filter;
              if (inputDef.sorts) queryInput.sorts = inputDef.sorts;
              const raw = await executeTool("query_database", queryInput);
              const parsed = JSON.parse(raw);
              if (parsed.error || parsed._error) throw new Error(`Input "${key}": ${parsed.error || parsed._error}`);
              let rows = parsed.results || [];
              if (inputDef.columns?.length) {
                const colSet = new Set(inputDef.columns);
                rows = rows.map((row) => {
                  const filtered = { id: row.id };
                  for (const col of colSet) { if (row[col] !== undefined) filtered[col] = row[col]; }
                  return filtered;
                });
              }
              // Attach sheet metadata for easy aggregation (e.g. sum all values)
              if (parsed.storage === "sheet" && parsed._allCellValues?.length) {
                rows._allCellValues = parsed._allCellValues;
                rows._row1IsData = parsed._row1IsData || false;
              }
              datasets[key] = rows;
            } else if (inputDef.source === "external_api" && inputDef.url) {
              const proxyBody = {
                url: inputDef.url,
                method: inputDef.method || "GET",
                headers: inputDef.headers || {},
                transform_path: inputDef.transform_path || null,
              };
              const proxyRes = await api.proxyExternalApi(proxyBody);
              if (proxyRes?._error) throw new Error(`External API "${key}": ${proxyRes._error}`);
              datasets[key] = proxyRes?.data || proxyRes;
            }
          }
          dryRunResult = executeSandbox(code, datasets, `Dry run: ${name}`);
        } catch (dryErr) {
          return JSON.stringify({ error: `Dry run failed: ${dryErr.message}`, step: "dry_run" });
        }

        // Step 3: Schema validation
        if (outputs?.schema && dryRunResult.result) {
          const schemaErrors = validateOutputSchema(dryRunResult.result, outputs);
          if (schemaErrors.length > 0) {
            return JSON.stringify({
              error: "Output schema mismatch", step: "schema_validation",
              issues: schemaErrors,
              actualSample: Array.isArray(dryRunResult.result) ? dryRunResult.result.slice(0, 3) : dryRunResult.result,
            });
          }
        }

        // Step 4: Sanity checks
        const sanityWarnings = runSanityChecks(dryRunResult.result, outputs);

        // Build meta from write_back config
        const meta = {};
        if (write_back?.target_database_id) meta.write_back = write_back;

        // If user confirmed, persist to D1
        if (_confirmed || toolInput.status === "active") {
          try {
            if (fnId) {
              await api.updateCustomFunction(fnId, { name, description: fnDesc, type: fnType, inputs, outputs, code, status: "active", meta });
              return JSON.stringify({ success: true, id: fnId, action: "updated", version: "incremented" });
            } else {
              const result = await api.createCustomFunction({ name, description: fnDesc, type: fnType, inputs, outputs, code, status: "active", meta });
              return JSON.stringify({ success: true, id: result.id, action: "created" });
            }
          } catch (saveErr) {
            return JSON.stringify({ error: `Failed to save: ${saveErr.message}`, step: "save" });
          }
        }

        // Not confirmed — return preview for user approval
        return JSON.stringify({
          __validationPreview: true, name, type: fnType,
          dryRunResult: {
            success: true,
            sampleOutput: Array.isArray(dryRunResult.result) ? dryRunResult.result.slice(0, 10) : dryRunResult.result,
            totalRows: dryRunResult.totalRows || (Array.isArray(dryRunResult.result) ? dryRunResult.result.length : 1),
          },
          sanityWarnings,
          message: "Validation passed. Present these results to the user and ask for approval. Then call save_custom_function again with the same parameters plus _confirmed: true to save.",
        });
      }

      case "list_custom_functions": {
        try {
          const result = await api.listCustomFunctions({ status: toolInput.status, type: toolInput.type });
          const entries = result.entries || [];
          if (entries.length === 0) return JSON.stringify({ count: 0, functions: [], message: "No custom functions found." });
          const summaries = entries.map((fn) => ({
            id: fn.id, name: fn.name, description: fn.description,
            type: fn.type, status: fn.status, version: fn.version,
            inputSources: Object.keys(fn.inputs || {}),
            outputType: fn.outputs?.type || "unknown",
            last_run_at: fn.last_run_at, last_run_status: fn.last_run_status,
          }));
          return JSON.stringify({ count: summaries.length, functions: summaries });
        } catch (err) {
          return JSON.stringify({ error: `Failed to list functions: ${err.message}` });
        }
      }

      case "run_custom_function": {
        const { function_id, overrides } = toolInput;
        if (!function_id) return JSON.stringify({ error: "function_id is required." });

        const execStart = Date.now();
        let fn;
        try {
          // Fetch function definition
          fn = await api.getCustomFunction(function_id);
          if (!fn || fn._error) return JSON.stringify({ error: `Function not found: ${function_id}` });
          if (fn.status === "disabled") return JSON.stringify({ error: `Function "${fn.name}" is disabled.` });

          // Auto-gather inputs — functions get full datasets (up to 5000 rows)
          const datasets = {};
          for (const [key, inputDef] of Object.entries(fn.inputs || {})) {
            if (overrides?.[key]) { datasets[key] = overrides[key]; continue; }
            if (inputDef.source === "query_database" && inputDef.database_id) {
              const queryInput = { database_id: inputDef.database_id, _maxRows: 5000 };
              if (inputDef.filter) queryInput.filter = inputDef.filter;
              if (inputDef.sorts) queryInput.sorts = inputDef.sorts;
              const raw = await executeTool("query_database", queryInput);
              const parsed = JSON.parse(raw);
              if (parsed.error || parsed._error) throw new Error(`Input "${key}": ${parsed.error || parsed._error}`);
              let rows = parsed.results || [];
              if (inputDef.columns?.length) {
                const colSet = new Set(inputDef.columns);
                rows = rows.map((row) => {
                  const filtered = { id: row.id };
                  for (const col of colSet) { if (row[col] !== undefined) filtered[col] = row[col]; }
                  return filtered;
                });
              }
              // Attach sheet metadata for easy aggregation (e.g. sum all values)
              if (parsed.storage === "sheet" && parsed._allCellValues?.length) {
                rows._allCellValues = parsed._allCellValues;
                rows._row1IsData = parsed._row1IsData || false;
              }
              datasets[key] = rows;
            } else if (inputDef.source === "external_api" && inputDef.url) {
              // Fetch data from external API via worker proxy
              const proxyBody = {
                url: inputDef.url,
                method: inputDef.method || "GET",
                headers: inputDef.headers || {},
                transform_path: inputDef.transform_path || null,
              };
              const proxyRes = await api.proxyExternalApi(proxyBody);
              if (proxyRes?._error) throw new Error(`External API "${key}": ${proxyRes._error}`);
              datasets[key] = proxyRes?.data || proxyRes;
            }
          }

          // Execute in sandbox (use plugin sandbox for plugin type)
          let result;
          if (fn.type === "plugin" && fn.meta?.manifest) {
            const pluginConfig = {};
            const configSchema = fn.meta.manifest.ui?.configSchema;
            if (configSchema) {
              for (const [k, v] of Object.entries(configSchema)) pluginConfig[k] = v.default ?? null;
            }
            // Merge runtime overrides from tool input
            if (toolInput.config) Object.assign(pluginConfig, toolInput.config);
            result = executePluginSandbox(fn.code, datasets, fn.meta.manifest, pluginConfig, fn.description || fn.name);
          } else {
            result = executeSandbox(fn.code, datasets, fn.description || fn.name);
          }
          const durationMs = Date.now() - execStart;

          // Update last_run metadata (non-critical)
          try {
            await api.updateCustomFunction(function_id, {
              last_run_at: new Date().toISOString(),
              last_run_status: result.success ? "success" : "error",
            });
          } catch { /* ignore */ }

          // Log execution to audit trail (non-blocking)
          try {
            const inputKeys = Object.keys(datasets);
            const outputPreview = result.success
              ? (Array.isArray(result.result) ? `${result.result.length} rows` : typeof result.result)
              : "error";
            api.createFunctionExecution({
              function_id, function_name: fn.name || "",
              trigger_source: "chat",
              status: result.success ? "success" : "error",
              input_summary: JSON.stringify({ datasets: inputKeys }),
              output_summary: JSON.stringify({ preview: outputPreview }),
              duration_ms: durationMs,
              error: result.success ? "" : (result.error || "execution failed"),
            }).catch(() => {});
          } catch { /* ignore audit log failures */ }

          if (!result.success) return JSON.stringify({ error: `Function "${fn.name}" failed`, function_id });

          // Build response
          const response = {
            success: true, function_id, function_name: fn.name,
            function_type: fn.type, version: fn.version, ...result,
          };

          // Handle plugin data+view output
          if (fn.type === "plugin" && result.result && typeof result.result === "object" && result.result.viewSpec) {
            response.__viewSpec = result.result.viewSpec;
            response.result = result.result.data ?? result.result;
          }

          // Include write-back suggestion if configured
          const writeBack = fn.meta?.write_back;
          if (writeBack?.target_database_id && Array.isArray(result.result)) {
            const preview = result.result.slice(0, 5).map((row) => {
              const mapped = {};
              for (const [outField, dbCol] of Object.entries(writeBack.column_mapping || {})) {
                mapped[dbCol] = row[outField];
              }
              return mapped;
            });
            response.__writeBackSuggestion = {
              target_database_id: writeBack.target_database_id,
              mode: writeBack.mode || "create",
              match_key: writeBack.match_key || null,
              column_mapping: writeBack.column_mapping || {},
              preview,
              total_rows: result.result.length,
            };
          }

          return JSON.stringify(response);
        } catch (err) {
          // Log failed execution
          try {
            api.createFunctionExecution({
              function_id, function_name: fn?.name || "",
              trigger_source: "chat", status: "error",
              duration_ms: Date.now() - execStart,
              error: err.message,
            }).catch(() => {});
          } catch { /* ignore */ }
          return JSON.stringify({ error: `Failed to run function: ${err.message}`, function_id });
        }
      }

      case "delete_custom_function": {
        const { function_id } = toolInput;
        if (!function_id) return JSON.stringify({ error: "function_id is required." });
        try {
          await api.deleteCustomFunction(function_id);
          return JSON.stringify({ success: true, id: function_id });
        } catch (err) {
          return JSON.stringify({ error: `Failed to delete: ${err.message}` });
        }
      }

      // ─── Custom Views ───

      case "save_custom_view": {
        const { id: viewId, name, description: viewDesc, view_spec, code, inputs, _confirmed } = toolInput;
        if (!name || !view_spec) return JSON.stringify({ error: "name and view_spec are required." });

        // Validate view spec structure
        const VALID_WIDGET_TYPES = new Set(["metric", "chart", "table", "text", "progress", "list", "html"]);
        const VALID_DS_TYPES = new Set(["query", "function_result", "static", "inline_html"]);
        if (!view_spec.widgets || !Array.isArray(view_spec.widgets)) {
          return JSON.stringify({ error: "view_spec must contain a widgets array.", step: "validation" });
        }
        for (const w of view_spec.widgets) {
          if (!w.id) return JSON.stringify({ error: `Widget missing "id" field.`, step: "validation" });
          if (!VALID_WIDGET_TYPES.has(w.type)) {
            return JSON.stringify({ error: `Invalid widget type "${w.type}". Valid: ${[...VALID_WIDGET_TYPES].join(", ")}`, step: "validation" });
          }
          if (w.dataSource && !VALID_DS_TYPES.has(w.dataSource.type)) {
            return JSON.stringify({ error: `Widget "${w.id}" has invalid dataSource type "${w.dataSource.type}".`, step: "validation" });
          }
          if (w.dataSource?.type === "inline_html" && typeof w.dataSource.content !== "string") {
            return JSON.stringify({ error: `Widget "${w.id}" has inline_html dataSource but "content" is not a string.`, step: "validation" });
          }
        }

        // Validate optional code
        if (code) {
          try {
            new Function("datasets", `"use strict";\n${code.trim()}\nreturn typeof execute === 'function' ? execute(datasets) : undefined;`);
          } catch (syntaxErr) {
            return JSON.stringify({ error: `Code syntax error: ${syntaxErr.message}`, step: "syntax_check" });
          }
        }

        if (_confirmed) {
          try {
            const outputs = { type: "view_spec", spec: view_spec };
            if (viewId) {
              await api.updateCustomFunction(viewId, { name, description: viewDesc, type: "view", inputs: inputs || {}, outputs, code: code || "", status: "active" });
              return JSON.stringify({ success: true, id: viewId, action: "updated", type: "view", message: `View "${name}" updated. Add to a page with: create_page_config view type "customView" with config.functionId = "${viewId}"` });
            } else {
              const result = await api.createCustomFunction({ name, description: viewDesc, type: "view", inputs: inputs || {}, outputs, code: code || "", status: "active" });
              return JSON.stringify({ success: true, id: result.id, action: "created", type: "view", message: `View "${name}" created. Add to a page with: create_page_config view type "customView" with config.functionId = "${result.id}"` });
            }
          } catch (saveErr) {
            return JSON.stringify({ error: `Failed to save view: ${saveErr.message}`, step: "save" });
          }
        }

        // Preview
        return JSON.stringify({
          __validationPreview: true, name, type: "view",
          widgetCount: view_spec.widgets.length,
          widgetTypes: view_spec.widgets.map(w => `${w.type}${w.title ? ` ("${w.title}")` : ""}`),
          layout: view_spec.layout || "grid",
          message: "View spec validated. Present the widget summary to the user and ask for approval. Then call save_custom_view again with _confirmed: true to save.",
        });
      }

      // ─── One-step HTML View Creator ───

      case "create_html_view": {
        const { name, html, page_id, height, description: htmlDesc } = toolInput;
        if (!name || !html) return JSON.stringify({ error: "name and html are required." });
        if (typeof html !== "string") return JSON.stringify({ error: "html must be a string containing HTML/SVG/CSS content." });

        try {
          // Build a viewSpec with a single full-span HTML widget using inline_html
          const viewSpec = {
            version: 1,
            title: name,
            layout: "stack",
            columns: 1,
            widgets: [{
              id: "w1",
              type: "html",
              title: name,
              span: 1,
              height: height || 400,
              dataSource: { type: "inline_html", content: html },
            }],
          };

          // Save as a custom function with type "view"
          const outputs = { type: "view_spec", spec: viewSpec };
          const fn = await api.createCustomFunction({
            name,
            description: htmlDesc || `HTML view: ${name}`,
            type: "view",
            inputs: {},
            outputs,
            code: "",
            status: "active",
          });

          // If page_id provided, add the view to that page
          if (page_id) {
            try {
              const existingPage = await api.getPageConfig(page_id);
              const views = existingPage?.views || [];
              views.push({ type: "customView", position: "main", config: { functionId: fn.id } });
              await savePageConfig({ ...existingPage, views });
            } catch (pageErr) {
              return JSON.stringify({ success: true, functionId: fn.id, warning: `View saved but could not add to page: ${pageErr.message}. Add manually with type "customView" config.functionId="${fn.id}"` });
            }
          }

          return JSON.stringify({
            success: true,
            functionId: fn.id,
            pageId: page_id || null,
            message: page_id
              ? `HTML view "${name}" created and added to page.`
              : `HTML view "${name}" created. Add to a page with: create_page_config view type "customView" with config.functionId = "${fn.id}"`,
          });
        } catch (err) {
          return JSON.stringify({ error: `Failed to create HTML view: ${err.message}` });
        }
      }

      // ─── Micro-Plugins ───

      case "save_plugin": {
        const { id: pluginId, name, description: pluginDesc, manifest, inputs, outputs, code, _confirmed } = toolInput;
        if (!name || !code || !manifest) return JSON.stringify({ error: "name, manifest, and code are required." });

        // Validate manifest
        const VALID_CAPABILITIES = new Set(["read_data", "compute", "generate_view", "write_back", "external_api", "text_processing", "date_processing"]);
        const caps = manifest.capabilities || [];
        for (const cap of caps) {
          if (!VALID_CAPABILITIES.has(cap)) {
            return JSON.stringify({ error: `Invalid capability "${cap}". Valid: ${[...VALID_CAPABILITIES].join(", ")}`, step: "manifest_validation" });
          }
        }

        // Code safety scan
        const codeErrors = validatePluginCode(code);
        if (codeErrors.length > 0) {
          return JSON.stringify({ error: "Code safety violation", step: "code_safety", issues: codeErrors });
        }

        // Syntax check
        try {
          new Function("datasets", "config", `"use strict";\n${code.trim()}\nreturn typeof execute === 'function' ? execute(datasets, config) : undefined;`);
        } catch (syntaxErr) {
          return JSON.stringify({ error: `Syntax error: ${syntaxErr.message}`, step: "syntax_check" });
        }

        // Dry run with real data
        let dryRunResult;
        try {
          const datasets = {};
          for (const [key, inputDef] of Object.entries(inputs || {})) {
            if (inputDef.source === "query_database" && inputDef.database_id) {
              const queryInput = { database_id: inputDef.database_id };
              if (inputDef.filter) queryInput.filter = inputDef.filter;
              if (inputDef.sorts) queryInput.sorts = inputDef.sorts;
              const raw = await executeTool("query_database", queryInput);
              const parsed = JSON.parse(raw);
              if (parsed.error || parsed._error) throw new Error(`Input "${key}": ${parsed.error || parsed._error}`);
              let rows = parsed.results || [];
              if (inputDef.columns?.length) {
                const colSet = new Set(inputDef.columns);
                rows = rows.map((row) => {
                  const filtered = { id: row.id };
                  for (const col of colSet) { if (row[col] !== undefined) filtered[col] = row[col]; }
                  return filtered;
                });
              }
              if (parsed.storage === "sheet" && parsed._allCellValues?.length) {
                rows._allCellValues = parsed._allCellValues;
                rows._row1IsData = parsed._row1IsData || false;
              }
              datasets[key] = rows;
            } else if (inputDef.source === "external_api" && inputDef.url) {
              const proxyBody = { url: inputDef.url, method: inputDef.method || "GET", headers: inputDef.headers || {}, transform_path: inputDef.transform_path || null };
              const proxyRes = await api.proxyExternalApi(proxyBody);
              if (proxyRes?._error) throw new Error(`External API "${key}": ${proxyRes._error}`);
              datasets[key] = proxyRes?.data || proxyRes;
            }
          }

          // Build default config from manifest
          const defaultConfig = {};
          if (manifest.ui?.configSchema) {
            for (const [k, v] of Object.entries(manifest.ui.configSchema)) {
              defaultConfig[k] = v.default ?? null;
            }
          }

          dryRunResult = executePluginSandbox(code, datasets, manifest, defaultConfig, `Dry run: ${name}`);
        } catch (dryErr) {
          return JSON.stringify({ error: `Dry run failed: ${dryErr.message}`, step: "dry_run" });
        }

        if (!dryRunResult.success) {
          return JSON.stringify({ error: `Plugin execution failed: ${dryRunResult.error}`, step: "dry_run" });
        }

        // Check output
        const outputType = manifest.ui?.outputType || "data";
        const result = dryRunResult.result;
        const hasViewSpec = result && typeof result === "object" && result.viewSpec;

        if (_confirmed) {
          try {
            const meta = { manifest };
            if (pluginId) {
              await api.updateCustomFunction(pluginId, { name, description: pluginDesc, type: "plugin", inputs: inputs || {}, outputs: outputs || {}, code, status: "active", meta });
              return JSON.stringify({ success: true, id: pluginId, action: "updated", type: "plugin" });
            } else {
              const res = await api.createCustomFunction({ name, description: pluginDesc, type: "plugin", inputs: inputs || {}, outputs: outputs || {}, code, status: "active", meta });
              return JSON.stringify({ success: true, id: res.id, action: "created", type: "plugin" });
            }
          } catch (saveErr) {
            return JSON.stringify({ error: `Failed to save plugin: ${saveErr.message}`, step: "save" });
          }
        }

        // Preview
        const preview = {
          __validationPreview: true, name, type: "plugin",
          capabilities: caps,
          outputType,
          hasViewSpec,
          dryRunResult: {
            success: true,
            sampleOutput: hasViewSpec
              ? { data: Array.isArray(result.data) ? result.data.slice(0, 5) : result.data, viewWidgets: result.viewSpec?.widgets?.length || 0 }
              : (Array.isArray(result) ? result.slice(0, 5) : result),
            totalRows: Array.isArray(hasViewSpec ? result.data : result) ? (hasViewSpec ? result.data : result).length : 1,
          },
          message: "Plugin validation passed. Present results to the user and ask for approval. Then call save_plugin again with _confirmed: true.",
        };
        return JSON.stringify(preview);
      }

      // ─── Interpret Automation Nodes ───

      case "interpret_automation_nodes": {
        const interpretations = toolInput.interpretations || [];
        if (!interpretations.length) return JSON.stringify({ error: "No interpretations provided." });

        // Validate each interpretation
        const validated = [];
        for (const interp of interpretations) {
          if (!interp.node_id) continue;

          const entry = { node_id: interp.node_id };

          // Validate trigger type for "when" nodes
          if (interp.trigger_type) {
            const validTriggers = new Set(["schedule", "status_change", "field_change", "page_created", "manual"]);
            if (!validTriggers.has(interp.trigger_type)) {
              entry.error = `Invalid trigger_type: ${interp.trigger_type}`;
            } else {
              entry.trigger_type = interp.trigger_type;
              entry.trigger_config = interp.trigger_config || {};
            }
          }

          // Pass through action config
          if (interp.config) {
            entry.config = interp.config;
          }

          validated.push(entry);
        }

        return JSON.stringify({
          success: true,
          interpretations: validated,
          count: validated.length,
        });
      }

      // ─── Batch Operations ───

      case "batch_operations": {
        const ops = (toolInput.operations || []).slice(0, 50);
        if (!ops.length) return JSON.stringify({ error: "No operations provided." });

        const results = [];
        for (const op of ops) {
          try {
            const result = await executeTool(op.action, op.params);
            results.push({ action: op.action, success: true, result: typeof result === "string" ? JSON.parse(result) : result });
          } catch (err) {
            results.push({ action: op.action, success: false, error: err.message });
          }
        }
        const succeeded = results.filter((r) => r.success).length;
        return JSON.stringify({
          success: true,
          total: results.length,
          succeeded,
          failed: results.length - succeeded,
          results,
        });
      }

      // ─── Export Report ───

      case "export_report": {
        // Return structured data for the frontend to handle (Blob download / print dialog)
        return JSON.stringify({
          __exportAction: true,
          format: toolInput.format,
          title: toolInput.title,
          headers: toolInput.headers,
          rows: toolInput.rows,
          summary: toolInput.summary || "",
        });
      }

      // ─── Delegate Task (Sub-Agents) ───

      case "delegate_task": {
        if (!claudeKey) return JSON.stringify({ error: "delegate_task requires API key configuration." });

        const tasks = (toolInput.tasks || []).slice(0, 5);
        if (!tasks.length) return JSON.stringify({ error: "No tasks provided." });

        try {
          const { runAgent } = await import("./runAgent.js");
          const { SONNET } = await import("./aiRouter.js");
          const { WASABI_TOOLS: allTools } = await import("./tools.js");

          // Sub-agents get read-only tools only
          const readOnlyNames = new Set(["query_database", "search_knowledge_base", "run_calculation"]);
          const subAgentTools = allTools.filter((t) => readOnlyNames.has(t.name));

          // Create a read-only sub-executor (no claudeKey — prevents recursive delegation)
          const subExecutor = createToolExecutor({
            workerUrl, notionKey, mondayKey, parentPageId,
            kbDbId, notifDbId, configDbId, rulesDbId,
          });

          const results = await Promise.all(
            tasks.map(async (task) => {
              try {
                const messages = [{
                  role: "user",
                  content: `${task.instruction}\n\n${task.context ? `Context:\n${task.context}` : ""}`,
                }];
                const systemPrompt = "You are a focused analysis sub-agent. Answer the specific question using the tools available. Be precise with numbers — report EXACTLY what tools return, do not round, estimate, or summarize counts unless asked. Cite specific records.";
                const result = await runAgent({
                  messages,
                  tools: subAgentTools,
                  systemPrompt,
                  model: SONNET,
                  workerUrl,
                  claudeKey,
                  executeTool: subExecutor,
                  maxIterations: 3,
                });
                return { label: task.label, success: true, result: result.text };
              } catch (err) {
                return { label: task.label, success: false, error: err.message };
              }
            })
          );

          const succeeded = results.filter((r) => r.success).length;
          const formatted = results.map((r) =>
            `### ${r.label}\n${r.success ? r.result : `Error: ${r.error}`}`
          ).join("\n\n");

          return `Sub-agent results (${succeeded}/${results.length} completed):\n\n${formatted}`;
        } catch (err) {
          return JSON.stringify({ error: `delegate_task failed: ${err.message}` });
        }
      }

      // ── Gmail Tools ──
      case "search_emails": {
        const result = await api.searchEmails(input.query || "", input.max_results || 10, input.label);
        return JSON.stringify(result);
      }
      case "get_email": {
        const result = await api.getEmail(input.message_id);
        return JSON.stringify(result);
      }
      case "send_email": {
        const result = await api.sendEmail({
          to: input.to,
          subject: input.subject,
          bodyText: input.body,
          threadId: input.thread_id,
        });
        return JSON.stringify(result);
      }
      case "modify_email": {
        const result = await api.modifyEmail(input.message_id, input.action);
        return JSON.stringify(result);
      }
      case "create_draft": {
        const result = await api.createDraft({
          to: input.to,
          subject: input.subject,
          bodyText: input.body,
        });
        return JSON.stringify(result);
      }

      // ── Calendar Tools ──
      case "list_calendar_events": {
        const result = await api.listCalendarEvents(input.start_date, input.end_date, input.max_results);
        return JSON.stringify(result);
      }
      case "create_calendar_event": {
        const result = await api.createCalendarEvent({
          summary: input.summary,
          start: input.start,
          end: input.end,
          description: input.description,
          location: input.location,
          attendees: input.attendees,
        });
        return JSON.stringify(result);
      }
      case "update_calendar_event": {
        const { event_id, ...updates } = input;
        const result = await api.updateCalendarEvent(event_id, updates);
        return JSON.stringify(result);
      }
      case "delete_calendar_event": {
        const result = await api.deleteCalendarEvent(input.event_id);
        return JSON.stringify(result);
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  };
}
