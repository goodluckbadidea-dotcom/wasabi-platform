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

// ─── Sheets ───

export async function getSheet(id) {
  return apiFetch(`/sheets/${id}`, { method: "GET" });
}

export async function updateSheet(id, updates) {
  return apiFetch(`/sheets/${id}`, { method: "PATCH", body: updates });
}

export async function sheetFormula(id, fn, range, target) {
  return apiFetch(`/sheets/${id}/formula`, {
    method: "POST",
    body: { fn, range, target },
  });
}

export async function resizeSheet(id, dimensions) {
  return apiFetch(`/sheets/${id}/resize`, {
    method: "POST",
    body: dimensions,
  });
}

// ─── Documents (R2) ───

export async function getDocument(id) {
  return apiFetch(`/docs/${id}`, { method: "GET" });
}

export async function saveDocument(id, content) {
  return apiFetch(`/docs/${id}`, { method: "PUT", body: { content } });
}

export async function updateDocBlocks(id, updates) {
  return apiFetch(`/docs/${id}/blocks`, {
    method: "PATCH",
    body: { updates },
  });
}

export async function exportDocNotion(id) {
  return apiFetch(`/docs/${id}/export/notion`, { method: "GET" });
}

// ─── Automation Rules ───

export async function listRules({ enabled } = {}) {
  const params = new URLSearchParams();
  if (enabled !== undefined) params.set("enabled", enabled);
  const qs = params.toString();
  return apiFetch(`/d1/rules${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export async function createRule(rule) {
  return apiFetch("/d1/rules", { method: "POST", body: rule });
}

export async function getRule(id) {
  return apiFetch(`/d1/rules/${id}`, { method: "GET" });
}

export async function updateRule(id, updates) {
  return apiFetch(`/d1/rules/${id}`, { method: "PATCH", body: updates });
}

export async function deleteRule(id) {
  return apiFetch(`/d1/rules/${id}`, { method: "DELETE" });
}

// ─── Notifications ───

export async function listNotifications({ status, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (limit) params.set("limit", limit);
  if (offset) params.set("offset", offset);
  const qs = params.toString();
  return apiFetch(`/d1/notifications${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export async function createNotification({ message, type, source }) {
  return apiFetch("/d1/notifications", {
    method: "POST",
    body: { message, type, source },
  });
}

export async function updateNotification(id, updates) {
  return apiFetch(`/d1/notifications/${id}`, { method: "PATCH", body: updates });
}

export async function deleteNotification(id) {
  return apiFetch(`/d1/notifications/${id}`, { method: "DELETE" });
}

// ─── Knowledge Base ───

export async function listKB({ category } = {}) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  const qs = params.toString();
  return apiFetch(`/d1/kb${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export async function createKBEntry({ key, category, content, source, related_pages }) {
  return apiFetch("/d1/kb", {
    method: "POST",
    body: { key, category, content, source, related_pages },
  });
}

export async function updateKBEntry(id, updates) {
  return apiFetch(`/d1/kb/${id}`, { method: "PATCH", body: updates });
}

export async function deleteKBEntry(id) {
  return apiFetch(`/d1/kb/${id}`, { method: "DELETE" });
}

export async function searchKB(query, category) {
  return apiFetch("/d1/kb/search", {
    method: "POST",
    body: { query, category },
  });
}

// ─── Notion Sync ───

export async function configureSyncNotionDB(tableId, { notion_db_id, direction, field_mapping }) {
  return apiFetch(`/sync/${tableId}/configure`, {
    method: "POST",
    body: { notion_db_id, direction, field_mapping },
  });
}

export async function syncPush(tableId) {
  return apiFetch(`/sync/${tableId}/push`, { method: "POST" });
}

export async function syncPull(tableId) {
  return apiFetch(`/sync/${tableId}/pull`, { method: "POST" });
}

export async function getSyncStatus(tableId) {
  return apiFetch(`/sync/${tableId}/status`, { method: "GET" });
}

export async function deleteSync(tableId) {
  return apiFetch(`/sync/${tableId}`, { method: "DELETE" });
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
