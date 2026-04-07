// ─── Shared utilities for Wasabi worker modules ───

/**
 * Creates a per-request jsonResponse helper pre-bound to the request's CORS headers.
 *
 * Usage in worker.js fetch handler (once per request):
 *   const cors = getCorsHeaders(request, env);
 *   const jsonResponse = createJsonResponse(cors);
 *
 * Each handler receives jsonResponse as its last parameter.
 * Internal handler calls to jsonResponse(data, status, headers) are unchanged.
 * jsonResponse.cors exposes the raw CORS header object for handlers that build
 * non-JSON responses (e.g. HTML, binary) and need CORS headers directly.
 */
export function createJsonResponse(cors) {
  const fn = (data, status = 200, extraHeaders = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json", ...extraHeaders },
    });
  fn.cors = cors;
  return fn;
}

export function safeParseJSON(str) {
  if (!str) return {};
  if (typeof str === "object") return str;
  try { return JSON.parse(str); }
  catch { return {}; }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function resolveRecordTitle(env, tableId, cells) {
  if (!cells || typeof cells !== "object") return "Untitled";
  // Try schema lookup — title column is first column or type === "title"
  try {
    const schema = await env.DB.prepare("SELECT columns FROM table_schemas WHERE id = ?").bind(tableId).first();
    if (schema?.columns) {
      let cols;
      try {
        cols = JSON.parse(schema.columns);
      } catch (parseErr) {
        console.error(`[resolveRecordTitle] Corrupted schema for table ${tableId}:`, parseErr.message);
        // Fall through to fallback patterns
        cols = null;
      }
      if (cols) {
        const titleCol = cols.find((c) => c.type === "title") || cols[0];
        if (titleCol?.name && cells[titleCol.name]) return String(cells[titleCol.name]).slice(0, 200);
      }
    }
  } catch (err) {
    console.error(`[resolveRecordTitle] DB error for table ${tableId}:`, err.message);
  }
  // Fallback: scan common field name patterns (case-insensitive)
  const keys = Object.keys(cells);
  for (const pattern of ["task", "title", "name", "project name", "project", "subject", "item"]) {
    const match = keys.find((k) => k.toLowerCase() === pattern);
    if (match && cells[match]) return String(cells[match]);
  }
  // Last resort: first non-empty string value
  for (const k of keys) {
    if (typeof cells[k] === "string" && cells[k].trim()) return cells[k];
  }
  return "";
}
