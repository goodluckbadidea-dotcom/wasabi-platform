// ─── Wasabi API Client ───
// Centralized fetch wrapper with X-Wasabi-Key auth.
// All backend calls go through here.

const STORAGE_KEY = "wasabi_connection";

/**
 * Get saved connection info (worker URL + secret).
 */
export function getConnection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Save connection info.
 */
export function saveConnection(workerUrl, secret) {
  const conn = { workerUrl: workerUrl.replace(/\/+$/, ""), secret };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
  return conn;
}

/**
 * Clear connection info.
 */
export function clearConnection() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Core fetch wrapper — adds auth header + handles errors.
 */
async function apiFetch(path, options = {}) {
  const conn = getConnection();
  if (!conn?.workerUrl) {
    throw new Error("Not connected — complete setup first");
  }

  const url = `${conn.workerUrl}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(conn.secret ? { "X-Wasabi-Key": conn.secret } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(url, {
    ...options,
    headers,
    body: options.body ? (typeof options.body === "string" ? options.body : JSON.stringify(options.body)) : undefined,
  });

  const data = await res.json().catch(() => ({ _error: `HTTP ${res.status}` }));

  if (!res.ok || data._error) {
    const err = new Error(data._error || `API error: ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

// ─── Health & Init ───

export async function checkHealth() {
  return apiFetch("/health", { method: "GET" });
}

export async function initDatabase() {
  return apiFetch("/init", { method: "POST" });
}

// ─── Connections ───

export async function getConnections() {
  return apiFetch("/connections", { method: "GET" });
}

export async function setConnection(key, value, metadata = {}) {
  return apiFetch("/connections", {
    method: "POST",
    body: { key, value, metadata },
  });
}

export async function deleteConnection(key) {
  return apiFetch(`/connections/${key}`, { method: "DELETE" });
}

// ─── Page Config CRUD ───

export async function listPages() {
  return apiFetch("/pages", { method: "GET" });
}

export async function createPageConfig(pageConfig) {
  return apiFetch("/pages", { method: "POST", body: pageConfig });
}

export async function getPageConfig(id) {
  return apiFetch(`/pages/${id}`, { method: "GET" });
}

export async function updatePageConfig(id, updates) {
  return apiFetch(`/pages/${id}`, { method: "PATCH", body: updates });
}

export async function deletePageConfig(id) {
  return apiFetch(`/pages/${id}`, { method: "DELETE" });
}

// ─── Table Schema ───

export async function getTableSchema(id) {
  return apiFetch(`/pages/${id}/schema`, { method: "GET" });
}

export async function updateTableSchema(id, columns) {
  return apiFetch(`/pages/${id}/schema`, { method: "PATCH", body: { columns } });
}

// ─── Table Rows ───

export async function listRows(tableId, { limit, offset, archived } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set("limit", limit);
  if (offset) params.set("offset", offset);
  if (archived) params.set("archived", "true");
  const qs = params.toString();
  return apiFetch(`/tables/${tableId}/rows${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export async function createRows(tableId, rows) {
  return apiFetch(`/tables/${tableId}/rows`, {
    method: "POST",
    body: { rows: Array.isArray(rows) ? rows : [rows] },
  });
}

export async function updateRow(tableId, rowId, updates) {
  // Default to merge mode for cell updates (partial cell updates)
  const body = { ...updates };
  if (body.cells && body.merge_cells === undefined) {
    body.merge_cells = true;
  }
  return apiFetch(`/tables/${tableId}/rows/${rowId}`, { method: "PATCH", body });
}

export async function deleteRow(tableId, rowId) {
  return apiFetch(`/tables/${tableId}/rows/${rowId}`, { method: "DELETE" });
}

export async function queryTable(tableId, { filters, sorts, limit, offset } = {}) {
  return apiFetch(`/tables/${tableId}/query`, {
    method: "POST",
    body: { filters, sorts, limit, offset },
  });
}

// ─── Notion Proxy (backward compat) ───
// These maintain the existing API surface so current code keeps working.

export async function notionProxy(path, method, body, notionKey) {
  const headers = {};
  if (notionKey) headers["Authorization"] = `Bearer ${notionKey}`;
  return apiFetch(path, { method, body, headers });
}

// ─── Claude Proxy (backward compat) ───

export async function claudeProxy(body, claudeKey) {
  const headers = {};
  if (claudeKey) headers["X-Claude-Key"] = claudeKey;
  return apiFetch("/claude", { method: "POST", body, headers });
}
