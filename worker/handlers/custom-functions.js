// ─── Custom Functions CRUD + Server-Side Sandbox ───
import { safeParseJSON } from '../utils.js';

export async function handleListCustomFunctions(env, url, jsonResponse) {
  const status = url.searchParams.get("status");
  const type = url.searchParams.get("type");
  let query = "SELECT * FROM custom_functions";
  const conditions = [];
  const params = [];
  if (status) { conditions.push("status = ?"); params.push(status); }
  if (type) { conditions.push("type = ?"); params.push(type); }
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY updated_at DESC";

  const { results } = await env.DB.prepare(query).bind(...params).all();
  const entries = (results || []).map((r) => ({
    ...r,
    inputs: safeParseJSON(r.inputs),
    outputs: safeParseJSON(r.outputs),
    meta: safeParseJSON(r.meta),
  }));
  return jsonResponse({ entries });
}

export async function handleCreateCustomFunction(env, body, jsonResponse) {
  const id = body.id || `fn_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const { name, description = "", type = "transform", inputs = {}, outputs = {}, code, status = "draft", meta = {} } = body;

  if (!name || !code) return jsonResponse({ _error: "name and code required" }, 400);

  await env.DB.prepare(
    `INSERT INTO custom_functions (id, name, description, type, version, inputs, outputs, code, status, meta, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(id, name, description, type, JSON.stringify(inputs), JSON.stringify(outputs), code, status, JSON.stringify(meta)).run();

  return jsonResponse({ id, success: true }, 201);
}

export async function handleGetCustomFunction(env, id, jsonResponse) {
  const row = await env.DB.prepare("SELECT * FROM custom_functions WHERE id = ?").bind(id).first();
  if (!row) return jsonResponse({ _error: "Custom function not found" }, 404);
  row.inputs = safeParseJSON(row.inputs);
  row.outputs = safeParseJSON(row.outputs);
  row.meta = safeParseJSON(row.meta);
  return jsonResponse(row);
}

export async function handleUpdateCustomFunction(env, id, body, jsonResponse) {
  const sets = [];
  const vals = [];
  const allowedFields = ["name", "description", "type", "code", "status", "last_run_at", "last_run_status"];

  for (const [key, val] of Object.entries(body)) {
    if (allowedFields.includes(key)) {
      sets.push(`${key} = ?`);
      vals.push(val);
    } else if (key === "inputs" || key === "outputs" || key === "meta") {
      sets.push(`${key} = ?`);
      vals.push(JSON.stringify(val));
    }
  }

  if (sets.length === 0) return jsonResponse({ _error: "No valid fields to update" }, 400);

  // Auto-increment version if code, inputs, or outputs changed
  if (body.code || body.inputs || body.outputs) {
    sets.push("version = version + 1");
  }
  sets.push("updated_at = datetime('now')");
  vals.push(id);

  await env.DB.prepare(`UPDATE custom_functions SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return jsonResponse({ success: true, id });
}

export async function handleDeleteCustomFunction(env, id, jsonResponse) {
  await env.DB.prepare("DELETE FROM custom_functions WHERE id = ?").bind(id).run();
  return jsonResponse({ success: true, id });
}

// ─── External API Proxy ───

/**
 * Proxy external API requests for custom functions.
 * Rate-limited, with domain allowlist validation and timeout.
 */
export async function handleExternalApiProxy(env, body, jsonResponse) {
  const { url, method = "GET", headers = {}, body: reqBody, transform_path } = body;

  if (!url) return jsonResponse({ _error: "url required" }, 400);

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return jsonResponse({ _error: "Invalid URL" }, 400);
  }

  // Block internal/private IPs
  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname.endsWith(".local")) {
    return jsonResponse({ _error: "Cannot proxy to local addresses" }, 400);
  }

  // Check domain allowlist (stored in connections table)
  let allowedDomains = [];
  try {
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'external_api_whitelist'").first();
    if (row?.value) {
      allowedDomains = JSON.parse(row.value);
    }
  } catch { /* no whitelist = allow all public domains */ }

  if (allowedDomains.length > 0) {
    const isAllowed = allowedDomains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
    if (!isAllowed) {
      return jsonResponse({ _error: `Domain "${hostname}" not in allowlist. Add it via connections settings.` }, 403);
    }
  }

  // Check for stored API key for this domain
  let storedHeaders = {};
  try {
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = ?").bind(`external_api:${hostname}`).first();
    if (row?.value) {
      const parsed = safeParseJSON(row.value);
      if (parsed.headers) storedHeaders = parsed.headers;
    }
  } catch { /* ignore */ }

  // Build fetch options
  const fetchOpts = {
    method: method.toUpperCase(),
    headers: {
      "Accept": "application/json",
      ...storedHeaders,
      ...headers,
    },
    signal: AbortSignal.timeout(10000), // 10-second timeout
  };

  if (reqBody && (method === "POST" || method === "PUT" || method === "PATCH")) {
    fetchOpts.headers["Content-Type"] = "application/json";
    fetchOpts.body = typeof reqBody === "string" ? reqBody : JSON.stringify(reqBody);
  }

  try {
    const res = await fetch(url, fetchOpts);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return jsonResponse({ _error: `API returned ${res.status}: ${errText.slice(0, 500)}` }, 502);
    }

    let data = await res.json();

    // Apply transform_path to drill into response
    if (transform_path) {
      const parts = transform_path.split(".");
      for (const part of parts) {
        if (data && typeof data === "object" && part in data) {
          data = data[part];
        } else {
          return jsonResponse({ _error: `transform_path "${transform_path}" not found in response` }, 422);
        }
      }
    }

    return jsonResponse({ data, source: hostname, fetched_at: new Date().toISOString() });
  } catch (err) {
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      return jsonResponse({ _error: "Request timed out (10s limit)" }, 504);
    }
    return jsonResponse({ _error: `Fetch failed: ${err.message}` }, 502);
  }
}

// ─── Server-Side Sandbox & Flow Executor ───

/** Whitelisted sandbox helpers (mirrored from client-side toolExecutor.js) */
const _srvSum = (arr) => { if (!Array.isArray(arr)) return 0; return arr.reduce((a, b) => a + (Number(b) || 0), 0); };
const _srvAvg = (arr) => { if (!Array.isArray(arr) || arr.length === 0) return 0; return _srvSum(arr) / arr.length; };
const _srvMin = (arr) => { const nums = (arr || []).map(Number).filter((n) => !isNaN(n)); return nums.length ? Math.min(...nums) : 0; };
const _srvMax = (arr) => { const nums = (arr || []).map(Number).filter((n) => !isNaN(n)); return nums.length ? Math.max(...nums) : 0; };
const _srvGroupBy = (arr, key) => { const groups = {}; for (const item of (arr || [])) { const k = String(item?.[key] ?? "_none"); (groups[k] = groups[k] || []).push(item); } return groups; };
const _srvSortBy = (arr, key, dir = "asc") => [...(arr || [])].sort((a, b) => { const va = a?.[key], vb = b?.[key]; const cmp = va < vb ? -1 : va > vb ? 1 : 0; return dir === "desc" ? -cmp : cmp; });
const _srvUnique = (arr, key) => [...new Set((arr || []).map((item) => (key ? item?.[key] : item)))].filter((v) => v != null);
const _srvRound = (n, d = 2) => { const factor = Math.pow(10, d); return Math.round((Number(n) || 0) * factor) / factor; };
const _srvDateAdd = (dateStr, days) => { const d = new Date(dateStr); d.setDate(d.getDate() + days); return d.toISOString().split("T")[0]; };
const _srvDateDiff = (dateStr1, dateStr2) => { const d1 = new Date(dateStr1); const d2 = new Date(dateStr2); return Math.round((d2 - d1) / (1000 * 60 * 60 * 24)); };
const _srvWeeksBetween = (dateStr1, dateStr2) => _srvRound(_srvDateDiff(dateStr1, dateStr2) / 7, 1);

/**
 * Execute JavaScript code in a server-side sandbox (V8 isolate `new Function()`).
 * Same interface as client-side executeSandbox.
 */
export function executeSandboxServer(code, datasets) {
  let fnBody;
  const trimmed = code.trim();
  if (trimmed.startsWith("(function") || trimmed.startsWith("(()")) {
    fnBody = `"use strict";\nreturn (${trimmed});`;
  } else if (trimmed.startsWith("function execute")) {
    fnBody = `"use strict";\n${trimmed}\nreturn execute(datasets);`;
  } else if (trimmed.includes("return ")) {
    fnBody = `"use strict";\n${trimmed}`;
  } else {
    fnBody = `"use strict";\nreturn (${trimmed});`;
  }

  let fn;
  try {
    fn = new Function(
      "datasets", "sum", "avg", "min", "max",
      "groupBy", "sortBy", "unique", "round",
      "dateAdd", "dateDiff", "weeksBetween",
      fnBody
    );
  } catch {
    fn = new Function(
      "datasets", "sum", "avg", "min", "max",
      "groupBy", "sortBy", "unique", "round",
      "dateAdd", "dateDiff", "weeksBetween",
      `"use strict";\n${trimmed}`
    );
  }

  const result = fn(
    datasets || {},
    _srvSum, _srvAvg, _srvMin, _srvMax,
    _srvGroupBy, _srvSortBy, _srvUnique, _srvRound,
    _srvDateAdd, _srvDateDiff, _srvWeeksBetween
  );

  return { success: true, result };
}

// ─── Extended Server Helpers (Plugins) ───

// Formatters
const _srvCurrency = (n, currency = "USD") => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n || 0); }
  catch { return `$${(Number(n) || 0).toFixed(2)}`; }
};
const _srvPercent = (n, decimals = 1) => (Number(n) || 0).toFixed(decimals) + "%";
const _srvCompact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return String(v);
};

// Collection
const _srvFlatten = (arr) => (arr || []).flat(Infinity);
const _srvPick = (obj, keys) => {
  const result = {};
  for (const k of (keys || [])) { if (obj?.[k] !== undefined) result[k] = obj[k]; }
  return result;
};
const _srvOmit = (obj, keys) => {
  const keySet = new Set(keys || []);
  const result = {};
  for (const [k, v] of Object.entries(obj || {})) { if (!keySet.has(k)) result[k] = v; }
  return result;
};
const _srvChunk = (arr, size) => {
  const chunks = [];
  for (let i = 0; i < (arr || []).length; i += (size || 1)) chunks.push(arr.slice(i, i + size));
  return chunks;
};
const _srvZip = (a, b) => (a || []).map((v, i) => [v, (b || [])[i]]);

// Text processing
const _srvTrim = (s) => String(s ?? "").trim();
const _srvUpper = (s) => String(s ?? "").toUpperCase();
const _srvLower = (s) => String(s ?? "").toLowerCase();
const _srvReplace = (s, find, replace) => String(s ?? "").replaceAll(find, replace);
const _srvSplit = (s, delim) => String(s ?? "").split(delim);
const _srvJoin = (arr, delim) => (arr || []).join(delim ?? ", ");
const _srvSlug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const _srvTruncateStr = (s, len) => { const str = String(s ?? ""); return str.length > len ? str.slice(0, len) + "..." : str; };
const _srvTemplate = (tmpl, data) => String(tmpl ?? "").replace(/\{\{(\w+)\}\}/g, (_, key) => data?.[key] ?? "");

// Date processing
const _srvNow = () => new Date().toISOString().split("T")[0];
const _srvParseDate = (s) => { try { return new Date(s).toISOString().split("T")[0]; } catch { return ""; } };
const _srvMonthsBetween = (d1, d2) => {
  const a = new Date(d1), b = new Date(d2);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
};
const _srvStartOfWeek = (dateStr) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().split("T")[0];
};
const _srvFormatDate = (dateStr, fmt) => {
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  if (fmt === "MM/DD/YYYY") return `${String(m+1).padStart(2,"0")}/${String(day).padStart(2,"0")}/${y}`;
  if (fmt === "MMM D, YYYY") return `${months[m]} ${day}, ${y}`;
  return d.toISOString().split("T")[0];
};

// ─── Plugin Code Validation (server-side) ───

export function validatePluginCodeServer(code) {
  const FORBIDDEN = [
    [/\beval\s*\(/, "eval()"], [/\bnew\s+Function\s*\(/, "new Function()"],
    [/\bimport\s*\(/, "import()"], [/\brequire\s*\(/, "require()"],
    [/\bwindow\b/, "window"], [/\bdocument\b/, "document"],
    [/\bglobalThis\b/, "globalThis"], [/\bprocess\b/, "process"],
    [/\b__proto__\b/, "__proto__"], [/\bconstructor\s*\[/, "constructor[]"],
  ];
  const errors = [];
  for (const [pattern, name] of FORBIDDEN) {
    if (pattern.test(code)) errors.push(`${name} is forbidden`);
  }
  return errors;
}

// ─── Plugin Sandbox (server-side) ───

export function executeSandboxPluginServer(code, datasets, manifest, config = {}) {
  const caps = new Set(manifest?.capabilities || []);

  const helperNames = [
    "sum", "avg", "min", "max", "groupBy", "sortBy", "unique", "round",
    "dateAdd", "dateDiff", "weeksBetween",
    "currency", "percent", "compact", "flatten", "pick", "omit", "chunk", "zip",
  ];
  const helperValues = [
    _srvSum, _srvAvg, _srvMin, _srvMax, _srvGroupBy, _srvSortBy, _srvUnique, _srvRound,
    _srvDateAdd, _srvDateDiff, _srvWeeksBetween,
    _srvCurrency, _srvPercent, _srvCompact, _srvFlatten, _srvPick, _srvOmit, _srvChunk, _srvZip,
  ];

  if (caps.has("text_processing")) {
    helperNames.push("trim", "upper", "lower", "replace", "split", "join", "slug", "truncate", "template");
    helperValues.push(_srvTrim, _srvUpper, _srvLower, _srvReplace, _srvSplit, _srvJoin, _srvSlug, _srvTruncateStr, _srvTemplate);
  }

  if (caps.has("date_processing")) {
    helperNames.push("now", "parseDate", "monthsBetween", "startOfWeek", "formatDate");
    helperValues.push(_srvNow, _srvParseDate, _srvMonthsBetween, _srvStartOfWeek, _srvFormatDate);
  }

  try {
    const trimmed = code.trim();
    let fnBody;
    if (trimmed.startsWith("(function") || trimmed.startsWith("(()")) {
      fnBody = `"use strict";\nreturn (${trimmed})(datasets, config);`;
    } else if (trimmed.startsWith("function execute")) {
      fnBody = `"use strict";\n${trimmed}\nreturn execute(datasets, config);`;
    } else if (trimmed.includes("return ")) {
      fnBody = `"use strict";\n${trimmed}`;
    } else {
      fnBody = `"use strict";\nreturn (${trimmed});`;
    }

    const fn = new Function("datasets", "config", ...helperNames, fnBody);
    let result = fn(datasets, config, ...helperValues);

    const maxRows = manifest?.permissions?.maxOutputRows || 1000;
    if (Array.isArray(result) && result.length > maxRows) result = result.slice(0, maxRows);
    if (result && typeof result === "object" && Array.isArray(result.data) && result.data.length > maxRows) {
      result.data = result.data.slice(0, maxRows);
    }

    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message, result: null };
  }
}
