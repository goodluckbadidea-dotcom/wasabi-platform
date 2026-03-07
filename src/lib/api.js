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
