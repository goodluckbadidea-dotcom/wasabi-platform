// ─── Wasabi Platform Cloudflare Worker ───
// Backend with D1 storage, optional Notion + Claude proxy.
// Auth via shared secret (X-Wasabi-Key header).

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const CLAUDE_API = "https://api.anthropic.com/v1/messages";

// ─── CORS with Origin Whitelist ───
// Checks request Origin against CORS_ORIGINS env var (comma-separated).
// Falls back to allowing localhost dev origins if not set.
const DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173";

function getCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env?.CORS_ORIGINS || DEFAULT_CORS_ORIGINS)
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  // Allow if origin matches whitelist, or if no origin (same-origin / non-browser)
  const allowOrigin = !origin || allowed.includes(origin) ? origin || "*" : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Claude-Key, X-Wasabi-Key, X-Wasabi-Pin-Token",
    "Access-Control-Allow-Credentials": "true",
    ...(allowOrigin && allowOrigin !== "*" ? { "Vary": "Origin" } : {}),
  };
}

// Legacy reference — used by jsonResponse and other helpers.
// Initialized per-request in the fetch handler.
let CORS = {};

// ─── D1 Schema ───
const D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS connections (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS page_configs (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  title TEXT NOT NULL,
  icon TEXT DEFAULT '',
  page_type TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  config TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS table_schemas (
  id TEXT PRIMARY KEY,
  columns TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS table_rows (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  cells TEXT NOT NULL,
  cell_versions TEXT DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  sync_dirty INTEGER DEFAULT 0,
  sync_retry_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS sheet_data (
  id TEXT PRIMARY KEY,
  col_count INTEGER DEFAULT 26,
  row_count INTEGER DEFAULT 100,
  cells TEXT NOT NULL DEFAULT '{}',
  col_widths TEXT DEFAULT '{}',
  row_heights TEXT DEFAULT '{}',
  frozen TEXT DEFAULT '{}',
  cell_styles TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  word_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  trigger_type TEXT NOT NULL,
  trigger_config TEXT DEFAULT '{}',
  action_config TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 0,
  scope_table_id TEXT,
  fire_count INTEGER DEFAULT 0,
  last_fired_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Untitled',
  description TEXT DEFAULT '',
  flow_data TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 0,
  run_count INTEGER DEFAULT 0,
  last_run TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'notification',
  status TEXT DEFAULT 'unread',
  source TEXT DEFAULT '',
  target_user_id TEXT DEFAULT 'all',
  record_id TEXT DEFAULT '',
  record_name TEXT DEFAULT '',
  page_config_id TEXT DEFAULT '',
  page_name TEXT DEFAULT '',
  actor_name TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_base (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  category TEXT DEFAULT 'business_context',
  content TEXT NOT NULL,
  source TEXT DEFAULT 'conversation',
  related_pages TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cell_links (
  id TEXT PRIMARY KEY,
  source_page_id TEXT NOT NULL,
  source_view_idx INTEGER,
  source_ref TEXT NOT NULL,
  target_page_id TEXT NOT NULL,
  target_view_idx INTEGER,
  target_ref TEXT NOT NULL,
  direction TEXT DEFAULT 'one_way',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  source_field_type TEXT DEFAULT '',
  target_field_type TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_cell_links_target ON cell_links(target_page_id, target_view_idx);
CREATE INDEX IF NOT EXISTS idx_cell_links_source ON cell_links(source_page_id);

CREATE TABLE IF NOT EXISTS sync_configs (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  notion_db_id TEXT NOT NULL,
  direction TEXT DEFAULT 'app_to_notion',
  field_mapping TEXT DEFAULT '{}',
  last_synced_at TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS data_summary_cache (
  page_id TEXT PRIMARY KEY,
  summary TEXT NOT NULL DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS record_notes (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  page_config_id TEXT NOT NULL,
  content TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS record_comments (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  page_config_id TEXT NOT NULL,
  user_id TEXT DEFAULT 'default',
  user_name TEXT DEFAULT 'User',
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS neurons (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS neuron_nodes (
  id TEXT PRIMARY KEY,
  neuron_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_label TEXT DEFAULT '',
  page_config_id TEXT DEFAULT '',
  meta TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime_type TEXT DEFAULT 'application/octet-stream',
  size INTEGER DEFAULT 0,
  page_id TEXT DEFAULT '',
  record_id TEXT DEFAULT '',
  meta TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rule_snapshots (
  rule_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  value_hash TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (rule_id, record_id, field_name)
);

CREATE TABLE IF NOT EXISTS custom_functions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT DEFAULT 'transform',
  version INTEGER DEFAULT 1,
  inputs TEXT DEFAULT '{}',
  outputs TEXT DEFAULT '{}',
  code TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  created_by TEXT DEFAULT 'wasabi',
  last_run_at TEXT,
  last_run_status TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS function_executions (
  id TEXT PRIMARY KEY,
  function_id TEXT NOT NULL,
  function_name TEXT DEFAULT '',
  trigger_source TEXT DEFAULT 'chat',
  status TEXT DEFAULT 'success',
  input_summary TEXT DEFAULT '{}',
  output_summary TEXT DEFAULT '{}',
  mutations_count INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  error TEXT DEFAULT '',
  executed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS flow_executions (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  flow_name TEXT DEFAULT '',
  trigger_source TEXT DEFAULT 'manual',
  status TEXT DEFAULT 'running',
  node_states TEXT DEFAULT '{}',
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  error TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS task_activity (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  source TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  UNIQUE(task_id, source)
);

CREATE TABLE IF NOT EXISTS task_interactions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  source TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'default',
  interaction_type TEXT NOT NULL DEFAULT 'view',
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  invite_code TEXT UNIQUE,
  password_hash TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_login_at TEXT,
  invite_expires_at TEXT
);

CREATE TABLE IF NOT EXISTS user_connections (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS user_state (
  user_id TEXT PRIMARY KEY,
  last_page TEXT,
  zen_tasks_table_id TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_dashboards (
  user_id TEXT PRIMARY KEY,
  widgets TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS record_views (
  user_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  last_viewed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, record_id)
);
`;

const D1_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_rows_table ON table_rows(table_id, archived);
CREATE INDEX IF NOT EXISTS idx_notif_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_record_notes_lookup ON record_notes(record_id, page_config_id);
CREATE INDEX IF NOT EXISTS idx_record_comments_lookup ON record_comments(record_id, page_config_id);
CREATE INDEX IF NOT EXISTS idx_nn_neuron ON neuron_nodes(neuron_id);
CREATE INDEX IF NOT EXISTS idx_nn_nodeid ON neuron_nodes(node_id);
CREATE INDEX IF NOT EXISTS idx_files_page ON files(page_id);
CREATE INDEX IF NOT EXISTS idx_files_record ON files(record_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_rule ON rule_snapshots(rule_id);
CREATE INDEX IF NOT EXISTS idx_custom_fn_status ON custom_functions(status);
CREATE INDEX IF NOT EXISTS idx_fn_exec_fn ON function_executions(function_id, executed_at);
CREATE INDEX IF NOT EXISTS idx_flow_exec_flow ON flow_executions(flow_id, started_at);
CREATE INDEX IF NOT EXISTS idx_task_activity_lookup ON task_activity(task_id, source);
CREATE INDEX IF NOT EXISTS idx_task_interactions_lookup ON task_interactions(task_id, source);
CREATE INDEX IF NOT EXISTS idx_task_interactions_user ON task_interactions(user_id, source);
CREATE INDEX IF NOT EXISTS idx_sync_dirty ON table_rows(sync_dirty) WHERE sync_dirty = 1;
CREATE INDEX IF NOT EXISTS idx_users_invite ON users(invite_code);
CREATE INDEX IF NOT EXISTS idx_user_conn ON user_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_record_views_user ON record_views(user_id);
`;

// ─── JWT Utilities (HS256 via Web Crypto) ───
const REFRESH_TOKEN_DAYS = 7;       // Refresh token (HttpOnly cookie): 7 days
const ACCESS_TOKEN_MINS = 15;        // Access token (in-memory): 15 minutes

function base64UrlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getJwtKey(env) {
  // Use WASABI_SECRET as the HMAC key material; fall back to a default for dev
  const secret = env.WASABI_SECRET || "wasabi-dev-secret";
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signJwt(payload, env, ttlSecs = ACCESS_TOKEN_MINS * 60) {
  const key = await getJwtKey(env);
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + ttlSecs };
  const segments = [
    base64UrlEncode(new TextEncoder().encode(JSON.stringify(header))),
    base64UrlEncode(new TextEncoder().encode(JSON.stringify(fullPayload))),
  ];
  const sigInput = new TextEncoder().encode(segments.join("."));
  const sig = await crypto.subtle.sign("HMAC", key, sigInput);
  segments.push(base64UrlEncode(sig));
  return segments.join(".");
}

async function verifyJwt(token, env) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const key = await getJwtKey(env);
    const sigInput = new TextEncoder().encode(parts[0] + "." + parts[1]);
    const sig = base64UrlDecode(parts[2]);
    const valid = await crypto.subtle.verify("HMAC", key, sig, sigInput);
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// Build Set-Cookie header for JWT (HttpOnly, Secure, SameSite=None for cross-origin)
function buildAuthCookie(token, maxAgeSecs = 7 * 24 * 60 * 60) {
  return `wasabi_jwt=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAgeSecs}`;
}
function buildClearAuthCookie() {
  return "wasabi_jwt=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0";
}

// Extract user from JWT in Authorization header OR HttpOnly cookie (returns null if no JWT)
// Also validates session hasn't been revoked (multi-device session management)
async function extractUser(request, env) {
  // Prefer Authorization header, fall back to cookie
  let token = null;
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (match) {
    token = match[1];
  } else {
    // Check cookie
    const cookies = request.headers.get("Cookie") || "";
    const cookieMatch = cookies.match(/(?:^|;\s*)wasabi_jwt=([^;]+)/);
    if (cookieMatch) token = cookieMatch[1];
  }
  if (!token) return null;
  // Skip if it looks like a Notion API key (ntn_ prefix)
  if (token.startsWith("ntn_") || token.startsWith("secret_")) return null;
  const payload = await verifyJwt(token, env);
  if (!payload) return null;
  // Check session revocation (jti present = multi-device aware token)
  if (payload.jti) {
    try {
      const session = await env.DB.prepare(
        "SELECT revoked_at FROM active_sessions WHERE id = ?"
      ).bind(payload.jti).first();
      if (session?.revoked_at) return null; // Session revoked
      // Debounced last_seen_at update (only if >60s since last update)
      // Fire-and-forget to avoid blocking the request
      env.DB.prepare(
        "UPDATE active_sessions SET last_seen_at = datetime('now') WHERE id = ? AND last_seen_at < datetime('now', '-60 seconds')"
      ).bind(payload.jti).run().catch(() => {});
    } catch (_) {
      // If active_sessions table doesn't exist yet (pre-migration), skip check
    }
  }
  return payload;
}

// ─── Rate Limiting (in-memory, resets on cold start) ───
/**
 * D1-backed rate limiter — persists across worker isolates.
 * Stores individual timestamps in `rate_limits` table so we can count
 * attempts within a sliding window.
 */
async function checkRateLimit(db, key, maxAttempts = 5, windowSecs = 900) {
  const nowSecs = Math.floor(Date.now() / 1000);
  const windowStart = nowSecs - windowSecs;
  try {
    const { results } = await db
      .prepare("SELECT ts FROM rate_limits WHERE key = ? AND ts > ? ORDER BY ts ASC")
      .bind(key, windowStart)
      .all();
    if (results.length >= maxAttempts) {
      const oldestInWindow = results[0].ts;
      const retryAfter = oldestInWindow + windowSecs - nowSecs;
      return { limited: true, retryAfter: Math.max(retryAfter, 1) };
    }
    // Don't record here — caller records only on failure via recordRateLimitAttempt()
    return { limited: false };
  } catch (_) {
    // If the table doesn't exist yet (pre-migration), allow the request
    return { limited: false };
  }
}

// Record a failed auth attempt for rate limiting (only call on failure)
async function recordRateLimitAttempt(db, key) {
  const nowSecs = Math.floor(Date.now() / 1000);
  try {
    await db.prepare("INSERT INTO rate_limits (key, ts) VALUES (?, ?)").bind(key, nowSecs).run();
  } catch (_) {}
}

// Clear rate limit entries on successful login (reset the window)
async function clearRateLimit(db, key) {
  try {
    await db.prepare("DELETE FROM rate_limits WHERE key = ?").bind(key).run();
  } catch (_) {}
}

// ─── Auth Middleware ───
// Accepts either X-Wasabi-Key (MCP server, backward compat) or a valid JWT (browser clients).
async function authenticate(request, env) {
  const secret = env.WASABI_SECRET;
  // If no secret is configured, allow all requests (first-time setup)
  if (!secret) return true;
  // Check X-Wasabi-Key (MCP server / server-to-server)
  const provided = request.headers.get("X-Wasabi-Key");
  if (provided === secret) return true;
  // Check JWT (browser clients)
  const user = await extractUser(request, env);
  if (user) return true;
  return false;
}

// Role permission levels
const ROLE_LEVEL = { admin: 3, editor: 2, viewer: 1 };

function requireRole(user, minRole) {
  if (!user) return true; // single-user mode: no JWT = full access
  return (ROLE_LEVEL[user.role] || 0) >= (ROLE_LEVEL[minRole] || 99);
}

// ─── Record title resolution ───
// Finds the display title from a row's cells by checking the schema's title column,
// then falling back to common field name patterns.
async function resolveRecordTitle(env, tableId, cells) {
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

// ─── Route Permission Map (first match wins) ───
// minRole: "admin" | "editor" | "viewer" | null (null = no role check, any authenticated user)
const ROUTE_PERMISSIONS = [
  // Auth — no role check (login/register work without JWT)
  { pattern: /^\/auth\//, method: "*", minRole: null },
  // Init — no role check (first-time setup)
  { pattern: "/init", method: "POST", minRole: null, exact: true },
  // PIN verify — any user, PIN set — admin
  { pattern: "/pin/verify", method: "POST", minRole: null, exact: true },
  { pattern: "/pin/set", method: "POST", minRole: "admin", exact: true },
  // Sessions — own data, no role check
  { pattern: /^\/sessions/, method: "*", minRole: null },
  // Per-user state — own data, no role check
  { pattern: /^\/user-state/, method: "*", minRole: null },
  { pattern: /^\/user-dashboard/, method: "*", minRole: null },
  { pattern: /^\/record-views/, method: "*", minRole: null },
  { pattern: /^\/d1\/notifications\/preferences/, method: "*", minRole: null },
  { pattern: /^\/d1\/notifications\/unread-count$/, method: "GET", minRole: null },
  { pattern: /^\/d1\/notifications\/mark-all-read$/, method: "POST", minRole: null },
  // User directory — any authenticated user (lightweight, read-only)
  { pattern: "/users/directory", method: "GET", minRole: null, exact: true },
  // User management — admin only
  { pattern: /^\/users/, method: "*", minRole: "admin" },
  // Connections — admin for mutations, open for reads
  { pattern: "/connections", method: "GET", minRole: null, exact: true },
  { pattern: "/connections", method: "*", minRole: "admin" },
  // Google reads — no role check
  { pattern: /^\/google\//, method: "GET", minRole: null },
  // Google mutations — editor
  { pattern: /^\/google\//, method: "*", minRole: "editor" },
  // Badge counts — read operation (POST but idempotent query)
  { pattern: "/records/badge-counts", method: "POST", minRole: null, exact: true },
  // Page titles — read operation (POST but idempotent query)
  { pattern: "/pages/titles", method: "POST", minRole: null, exact: true },
  // Page reorder — admin
  { pattern: "/pages/reorder", method: "POST", minRole: "admin", exact: true },
  // Summary cache — editor for writes
  { pattern: /^\/pages\/[^/]+\/summary$/, method: "PUT", minRole: "editor" },
  // Schema — admin for mutations
  { pattern: /^\/pages\/[^/]+\/schema$/, method: "PATCH", minRole: "admin" },
  // Page config — admin for create/update/delete
  { pattern: "/pages", method: "POST", minRole: "admin", exact: true },
  { pattern: /^\/pages\/[^/]+$/, method: "PATCH", minRole: "admin" },
  { pattern: /^\/pages\/[^/]+$/, method: "DELETE", minRole: "admin" },
  // Table row mutations — editor
  { pattern: /^\/tables\//, method: "POST", minRole: "editor" },
  { pattern: /^\/tables\//, method: "PATCH", minRole: "editor" },
  { pattern: /^\/tables\//, method: "DELETE", minRole: "editor" },
  // Record notes/comments — editor for mutations
  { pattern: /^\/records\//, method: "PUT", minRole: "editor" },
  { pattern: /^\/records\//, method: "POST", minRole: "editor" },
  { pattern: /^\/records\//, method: "DELETE", minRole: "editor" },
  // Task activity/interactions — editor for mutations
  { pattern: /^\/task-activity/, method: "PUT", minRole: "editor" },
  { pattern: /^\/task-interactions$/, method: "POST", minRole: "editor" },
  // Sheets — editor for mutations
  { pattern: /^\/sheets\/fetch$/, method: "POST", minRole: "editor" },
  { pattern: /^\/sheets\//, method: "POST", minRole: "editor" },
  { pattern: /^\/sheets\//, method: "PATCH", minRole: "editor" },
  // Docs — editor for mutations
  { pattern: /^\/docs\//, method: "PUT", minRole: "editor" },
  { pattern: /^\/docs\//, method: "PATCH", minRole: "editor" },
  // Rules & flows — admin for mutations
  { pattern: /^\/d1\/rules/, method: "POST", minRole: "admin" },
  { pattern: /^\/d1\/rules/, method: "PATCH", minRole: "admin" },
  { pattern: /^\/d1\/rules/, method: "DELETE", minRole: "admin" },
  { pattern: /^\/d1\/flows/, method: "POST", minRole: "admin" },
  { pattern: /^\/d1\/flows/, method: "PATCH", minRole: "admin" },
  { pattern: /^\/d1\/flows/, method: "DELETE", minRole: "admin" },
  // Flow/function executions — editor for mutations
  { pattern: /^\/d1\/flow-executions/, method: "POST", minRole: "editor" },
  { pattern: /^\/d1\/flow-executions/, method: "PATCH", minRole: "editor" },
  { pattern: /^\/d1\/function-executions/, method: "POST", minRole: "editor" },
  // Notifications — editor for create, admin for delete
  { pattern: "/d1/notifications", method: "POST", minRole: "editor", exact: true },
  { pattern: /^\/d1\/notifications\/[^/]+$/, method: "PATCH", minRole: "editor" },
  { pattern: /^\/d1\/notifications\/[^/]+$/, method: "DELETE", minRole: "admin" },
  // Knowledge base — admin for mutations
  { pattern: /^\/d1\/kb/, method: "POST", minRole: "admin" },
  { pattern: /^\/d1\/kb/, method: "PATCH", minRole: "admin" },
  { pattern: /^\/d1\/kb/, method: "DELETE", minRole: "admin" },
  // Custom functions — admin for mutations
  { pattern: /^\/d1\/custom-functions/, method: "POST", minRole: "admin" },
  { pattern: /^\/d1\/custom-functions/, method: "PATCH", minRole: "admin" },
  { pattern: /^\/d1\/custom-functions/, method: "DELETE", minRole: "admin" },
  // Neurons — admin for mutations
  { pattern: /^\/neurons/, method: "POST", minRole: "admin" },
  { pattern: /^\/neurons/, method: "PATCH", minRole: "admin" },
  { pattern: /^\/neurons/, method: "DELETE", minRole: "admin" },
  // Cell links — admin for mutations
  { pattern: /^\/links/, method: "POST", minRole: "admin" },
  { pattern: /^\/links/, method: "PATCH", minRole: "admin" },
  { pattern: /^\/links/, method: "DELETE", minRole: "admin" },
  // Sync — admin for all mutations
  { pattern: /^\/sync\//, method: "POST", minRole: "admin" },
  { pattern: /^\/sync\//, method: "DELETE", minRole: "admin" },
  // Disconnect & Sync Backup — admin only
  { pattern: /^\/pages\/[^/]+\/disconnect$/, method: "POST", minRole: "admin" },
  { pattern: /^\/pages\/[^/]+\/sync-backup$/, method: "POST", minRole: "admin" },
  // Files — editor for mutations
  { pattern: "/files", method: "POST", minRole: "editor", exact: true },
  { pattern: /^\/files\/[^/]+$/, method: "DELETE", minRole: "editor" },
  // Monday proxy — editor
  { pattern: "/monday/graphql", method: "POST", minRole: "editor", exact: true },
  // Notion proxy — editor for mutations, open for reads
  { pattern: "/page", method: "POST", minRole: "editor", exact: true },
  { pattern: /^\/page\//, method: "PATCH", minRole: "editor" },
  { pattern: /^\/block\//, method: "PATCH", minRole: "editor" },
  { pattern: /^\/block\//, method: "DELETE", minRole: "editor" },
  { pattern: /^\/blocks\//, method: "PATCH", minRole: "editor" },
  { pattern: "/create-database", method: "POST", minRole: "editor", exact: true },
  { pattern: /^\/database\//, method: "PATCH", minRole: "editor" },
  { pattern: "/query", method: "POST", minRole: null, exact: true },
  { pattern: "/search", method: "POST", minRole: null, exact: true },
  // Claude API — editor
  { pattern: "/claude", method: "POST", minRole: "editor", exact: true },
  // File proxy & external API — editor
  { pattern: "/fetch-file", method: "POST", minRole: "editor", exact: true },
  { pattern: "/proxy/external-api", method: "POST", minRole: "editor", exact: true },
  // Factory reset — admin
  { pattern: "/factory-reset", method: "POST", minRole: "admin", exact: true },
];

function checkRoutePermission(path, method, user) {
  if (!user) return true; // single-user / MCP server — full access
  for (const rule of ROUTE_PERMISSIONS) {
    if (rule.method !== "*" && rule.method !== method) continue;
    const match = rule.pattern instanceof RegExp
      ? rule.pattern.test(path)
      : (rule.exact ? path === rule.pattern : path.startsWith(rule.pattern));
    if (match) {
      if (rule.minRole === null) return true;
      return requireRole(user, rule.minRole);
    }
  }
  // Default fallback: GETs are open, all other mutations require editor
  return method === "GET" ? true : requireRole(user, "editor");
}

// ─── Fresh Role Lookup ───
// JWT role can become stale after demotion. Use this for data-scoping decisions.
async function getFreshRole(env, user) {
  if (!user?.sub) return null;
  const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(user.sub).first();
  return row?.role || user.role;
}

// ─── Tier 2: Page-Level Permission Check ───
const PERM_LEVEL = { owner: 4, editor: 3, viewer: 2, none: 0 };

async function checkPagePermission(env, user, pageId, requiredLevel) {
  if (!user) return true;                    // single-user / MCP — full access
  const role = await getFreshRole(env, user);
  if (role === "admin") return true;         // admin bypasses page permissions
  // Shared workspace: all authenticated users with sufficient route-level role
  // can read/write pages. Page-level permission records are optional overrides.
  const perm = await env.DB.prepare(
    "SELECT permission FROM page_permissions WHERE page_id = ? AND user_id = ?"
  ).bind(pageId, user.sub).first();
  if (perm) {
    // Explicit permission record exists — enforce it
    return (PERM_LEVEL[perm.permission] || 0) >= (PERM_LEVEL[requiredLevel] || 99);
  }
  // No explicit permission record — grant access based on route-level role
  // Editors can edit, viewers can view
  return (PERM_LEVEL[role] || 0) >= (PERM_LEVEL[requiredLevel] || 99);
}

// ─── Tier 2b: PIN Protection Check ───
// Enforces server-side PIN verification for protected pages.
// Admin bypasses, non-protected pages pass, otherwise requires valid pin_sessions token.
async function checkPinProtection(env, user, request, tableId) {
  if (!user) return true;                      // single-user / MCP — no PIN needed
  const role = await getFreshRole(env, user);
  if (role === "admin") return true;            // admin bypasses PIN
  const page = await env.DB.prepare(
    "SELECT pin_protected FROM page_configs WHERE id = ?"
  ).bind(tableId).first();
  if (!page || !page.pin_protected) return true; // not protected
  const token = request.headers.get("X-Wasabi-Pin-Token");
  if (!token) return false;
  const session = await env.DB.prepare(
    "SELECT 1 FROM pin_sessions WHERE token = ? AND user_id = ? AND page_id = ? AND expires_at > datetime('now')"
  ).bind(token, user.sub, tableId).first();
  return !!session;
}

// ─── Tier 3: Audit Logger ───
async function auditLog(env, user, action, resourceType, resourceId, details) {
  try {
    const id = crypto.randomUUID();
    const userId = user?.sub || "system";
    const userName = user?.name || "";
    await env.DB.prepare(
      "INSERT INTO audit_log (id, user_id, user_name, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, userId, userName, action, resourceType, resourceId || "", JSON.stringify(details || {})).run();
  } catch (_) {} // never break the request
}

// Legacy SHA-256 hash (kept for backward-compat migration detection)
async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(hash);
}

// ─── PBKDF2 Password Hashing ───
// Replaces plain SHA-256. Stores as "salt:hash" (both base64url-encoded).
// 100k iterations, SHA-256, 16-byte salt.
async function hashPassword(text) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(text), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return base64UrlEncode(salt) + ":" + base64UrlEncode(bits);
}

async function verifyPassword(text, stored) {
  // Detect legacy format: no ":" means old unsalted SHA-256
  if (!stored.includes(":")) {
    return (await sha256(text)) === stored;
  }
  const [saltB64, hashB64] = stored.split(":");
  const salt = base64UrlDecode(saltB64);
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(text), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return base64UrlEncode(bits) === hashB64;
}

// ─── Get Notion key: from D1 connections or request header ───
async function getNotionKey(request, env) {
  // First try the request header (backward compat)
  const headerKey = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (headerKey) return headerKey;
  // Then try D1 connections table
  try {
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'notion'").first();
    return row?.value || null;
  } catch {
    return null;
  }
}

// ─── Get Claude key: from D1 connections or request header ───
async function getClaudeKey(request, body, env) {
  // First try the request header/body (backward compat)
  const headerKey = request.headers.get("X-Claude-Key") || body?.claudeKey;
  if (headerKey) return headerKey;
  // Then try D1 connections table
  try {
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'claude'").first();
    return row?.value || null;
  } catch {
    return null;
  }
}

// ─── Get Monday.com key: from D1 connections ───
async function getMondayKey(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'monday'").first();
    return row?.value || null;
  } catch {
    return null;
  }
}

export default {
  // ─── Server-Side Cron (automations + sync flush + cleanup) ───
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutomationTick(env));
    ctx.waitUntil(runSyncFlushTick(env));
    // Clean up expired PIN sessions
    ctx.waitUntil(
      env.DB.prepare("DELETE FROM pin_sessions WHERE expires_at < datetime('now')").run().catch(() => {})
    );
    // Clean up stale sessions (revoked or inactive >30 days)
    ctx.waitUntil(
      env.DB.prepare("DELETE FROM active_sessions WHERE revoked_at IS NOT NULL OR last_seen_at < datetime('now', '-30 days')").run().catch(() => {})
    );
    // Clean up expired rate limit entries (older than 15 min)
    ctx.waitUntil(
      env.DB.prepare("DELETE FROM rate_limits WHERE ts < ?").bind(Math.floor(Date.now() / 1000) - 900).run().catch(() => {})
    );
  },

  async fetch(request, env, ctx) {
    // Set CORS headers for this request (origin-checked)
    CORS = getCorsHeaders(request, env);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ─── Public Routes (no auth required) ───

      // Health check
      if (path === "/health" && request.method === "GET") {
        return await handleHealth(env);
      }

      // Google OAuth callback (browser redirect — no auth header)
      if (path === "/google/callback" && request.method === "GET") {
        return await handleGoogleCallback(request, env);
      }

      // ─── WebSocket Upgrade (real-time collaboration) ───
      const wsMatch = path.match(/^\/ws\/table\/(.+)$/);
      if (wsMatch && request.headers.get("Upgrade") === "websocket") {
        // Auth via query param — JWT token (primary) or X-Wasabi-Key (MCP/backward compat)
        const wsToken = url.searchParams.get("token");
        const wsKey = url.searchParams.get("key");
        if (!(wsKey && wsKey === env.WASABI_SECRET)) {
          if (!wsToken) return new Response("Unauthorized", { status: 401 });
          const wsUser = await verifyJwt(wsToken, env);
          if (!wsUser) return new Response("Unauthorized", { status: 401 });
        }
        const tableId = wsMatch[1];
        const roomId = env.TABLE_ROOMS.idFromName(tableId);
        const room = env.TABLE_ROOMS.get(roomId);
        return room.fetch(request);
      }

      // ─── WebSocket Upgrade (multi-device user sync) ───
      const wsUserMatch = path.match(/^\/ws\/user\/(.+)$/);
      if (wsUserMatch && request.headers.get("Upgrade") === "websocket") {
        const wsToken = url.searchParams.get("token");
        const wsKey = url.searchParams.get("key");
        if (!(wsKey && wsKey === env.WASABI_SECRET)) {
          if (!wsToken) return new Response("Unauthorized", { status: 401 });
          const wsUser = await verifyJwt(wsToken, env);
          if (!wsUser) return new Response("Unauthorized", { status: 401 });
          // Only connect to own room
          if (wsUser.sub !== wsUserMatch[1]) return new Response("Forbidden", { status: 403 });
        }
        const userId = wsUserMatch[1];
        const roomId = env.USER_ROOMS.idFromName(`user:${userId}`);
        const room = env.USER_ROOMS.get(roomId);
        // Pass session ID and device info via query params
        const wsUrl = new URL(request.url);
        const wsUserPayload = wsToken ? await verifyJwt(wsToken, env) : null;
        wsUrl.searchParams.set("sid", wsUserPayload?.jti || "");
        wsUrl.searchParams.set("device", request.headers.get("User-Agent")?.slice(0, 100) || "");
        return room.fetch(new Request(wsUrl.toString(), request));
      }

      // ─── D1 Bootstrap (always unauthenticated — tells frontend if login is needed) ───
      if (path === "/init" && request.method === "POST") {
        return await handleInit(env);
      }

      // ─── Auth Endpoints (before auth gate — users can't auth to reach auth) ───
      if ((path === "/auth/register" || path === "/auth/login") && request.method === "POST") {
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const rlKey = `auth:${ip}`;
        const rl = await checkRateLimit(env.DB, rlKey);
        if (rl.limited) {
          return jsonResponse(
            { _error: "Too many attempts. Please try again later." },
            429,
            { "Retry-After": String(rl.retryAfter) }
          );
        }
        const body = await request.json();
        const result = path === "/auth/register"
          ? await handleAuthRegister(env, body)
          : await handleAuthLogin(env, body);
        // Only record failed attempts; clear on success
        if (result.status >= 400 && result.status !== 429) {
          await recordRateLimitAttempt(env.DB, rlKey);
        } else if (result.status === 200) {
          await clearRateLimit(env.DB, rlKey);
        }
        return result;
      }

      // ─── Session restore endpoints (before auth gate — need refresh token access) ───
      if (path === "/auth/me" && request.method === "GET") {
        const user = await extractUser(request, env);
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleAuthMe(env, user);
      }
      if (path === "/auth/refresh" && request.method === "POST") {
        const user = await extractUser(request, env);
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleAuthRefresh(env, user);
      }

      // ─── Auth Gate ───
      if (!(await authenticate(request, env))) {
        return jsonResponse({ _error: "Unauthorized" }, 401);
      }

      // ─── Role Gate (centralized permission check) ───
      const user = await extractUser(request, env);
      if (!checkRoutePermission(path, request.method, user)) {
        return jsonResponse({ _error: "Insufficient permissions" }, 403);
      }

      // ─── User Directory (any authenticated user) ───
      if (path === "/users/directory" && request.method === "GET") {
        return await handleUserDirectory(env);
      }

      // ─── User Management (admin only — role enforced by middleware) ───
      if (path === "/users/invite" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateInvite(env, body);
      }
      if (path === "/users" && request.method === "GET") {
        return await handleListUsers(env);
      }
      if (path.match(/^\/users\/[^/]+$/) && request.method === "DELETE") {
        const userId = path.split("/users/")[1];
        const result = await handleDeleteUser(env, userId, user);
        if (result.status === 200) await auditLog(env, user, "delete_user", "user", userId, {});
        return result;
      }
      if (path.match(/^\/users\/[^/]+$/) && request.method === "PATCH") {
        const userId = path.split("/users/")[1];
        const body = await request.json();
        const result = await handleUpdateUser(env, userId, body);
        if (result.status === 200) await auditLog(env, user, "update_user", "user", userId, { changes: body });
        return result;
      }
      if (path.match(/^\/users\/[^/]+\/restore$/) && request.method === "POST") {
        const userId = path.split("/users/")[1].split("/restore")[0];
        const result = await handleRestoreUser(env, userId);
        if (result.status === 200) await auditLog(env, user, "restore_user", "user", userId, {});
        return result;
      }
      if (path.match(/^\/users\/[^/]+\/hard-delete$/) && request.method === "POST") {
        const userId = path.split("/users/")[1].split("/hard-delete")[0];
        const body = await request.json();
        const result = await handleHardDeleteUser(env, userId, body);
        if (result.status === 200) await auditLog(env, user, "hard_delete_user", "user", userId, { transfer_to: body?.transfer_to });
        return result;
      }
      if (path.match(/^\/users\/[^/]+\/reset$/) && request.method === "POST") {
        const userId = path.split("/users/")[1].split("/reset")[0];
        const result = await handleResetUserPassword(env, userId);
        if (result.status === 200) await auditLog(env, user, "reset_password", "user", userId, {});
        return result;
      }

      // ─── PIN Lock (role enforced by middleware) ───
      if (path === "/pin/set" && request.method === "POST") {
        const body = await request.json();
        const result = await handleSetPin(env, body);
        if (result.status === 200) await auditLog(env, user, "set_pin", "system", "", {});
        return result;
      }
      if (path === "/pin/verify" && request.method === "POST") {
        const body = await request.json();
        return await handleVerifyPin(env, body, user);
      }

      // ─── Session Management (multi-device) ───
      if (path === "/sessions" && request.method === "GET") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleListSessions(env, user);
      }
      if (path.match(/^\/sessions\/[^/]+$/) && request.method === "DELETE") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        const sessionId = path.split("/sessions/")[1];
        return await handleRevokeSession(env, user, sessionId);
      }
      if (path === "/sessions/logout-all" && request.method === "POST") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleLogoutOtherSessions(env, user);
      }
      if (path === "/sessions/logout-all-devices" && request.method === "POST") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleLogoutAllDevices(env, user);
      }

      // ─── Per-User State ───
      if (path === "/user-state" && request.method === "GET") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleGetUserState(env, user);
      }
      if (path === "/user-state" && request.method === "PUT") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        const body = await request.json();
        return await handlePutUserState(env, user, body);
      }

      // ─── Per-User Dashboard ───
      if (path === "/user-dashboard" && request.method === "GET") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleGetUserDashboard(env, user);
      }
      if (path === "/user-dashboard" && request.method === "PUT") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        const body = await request.json();
        return await handlePutUserDashboard(env, user, body);
      }

      // ─── Record Views ───
      if (path.match(/^\/record-views\/[^/]+$/) && request.method === "PUT") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        const recordId = path.split("/record-views/")[1];
        return await handlePutRecordView(env, user, recordId);
      }
      if (path === "/record-views" && request.method === "GET") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleGetRecordViews(env, user, url);
      }

      // ─── Connections CRUD ───
      if (path === "/connections" && request.method === "GET") {
        return await handleGetConnections(env);
      }
      if (path === "/connections" && request.method === "POST") {
        const body = await request.json();
        return await handleSetConnection(env, body);
      }
      if (path.startsWith("/connections/") && request.method === "DELETE") {
        const key = path.split("/connections/")[1];
        return await handleDeleteConnection(env, key);
      }

      // ─── Google OAuth + API Proxy (per-user) ───
      if (path === "/google/auth-url" && request.method === "GET") {
        return handleGoogleAuthUrl(request, env, user?.sub);
      }
      if (path === "/google/status" && request.method === "GET") {
        return await handleGoogleStatus(env, user?.sub);
      }
      if (path === "/google/disconnect" && request.method === "POST") {
        return await handleGoogleDisconnect(env, user?.sub);
      }
      // Gmail proxy (per-user — role enforced by middleware)
      {
        const gUid = user?.sub;
        if (path === "/google/gmail/summary" && request.method === "GET") {
          return await handleGmailSummary(env, gUid);
        }
        if (path === "/google/gmail/messages" && request.method === "POST") {
          const body = await request.json();
          return await handleGmailSearch(env, body, gUid);
        }
        if (path.match(/^\/google\/gmail\/messages\/[^/]+$/) && request.method === "GET") {
          const msgId = path.split("/google/gmail/messages/")[1];
          return await handleGmailGetMessage(env, msgId, gUid);
        }
        if (path === "/google/gmail/send" && request.method === "POST") {
          const body = await request.json();
          return await handleGmailSend(env, body, gUid);
        }
        if (path.match(/^\/google\/gmail\/threads\/[^/]+$/) && request.method === "GET") {
          const threadId = path.split("/google/gmail/threads/")[1];
          return await handleGmailGetThread(env, threadId, gUid);
        }
        if (path === "/google/gmail/drafts" && request.method === "POST") {
          const body = await request.json();
          return await handleGmailCreateDraft(env, body, gUid);
        }
        if (path.match(/^\/google\/gmail\/drafts\/[^/]+$/) && request.method === "PUT") {
          const draftId = path.split("/google/gmail/drafts/")[1];
          const body = await request.json();
          return await handleGmailUpdateDraft(env, draftId, body, gUid);
        }
        if (path.match(/^\/google\/gmail\/modify\/[^/]+$/) && request.method === "POST") {
          const msgId = path.split("/google/gmail/modify/")[1];
          const body = await request.json();
          return await handleGmailModify(env, msgId, body, gUid);
        }
        // Calendar proxy (per-user)
        if (path === "/google/calendar/list" && request.method === "GET") {
          return await handleCalendarList(env, gUid);
        }
        if (path === "/google/calendar/summary" && request.method === "GET") {
          return await handleCalendarSummary(env, gUid);
        }
        if (path === "/google/calendar/events" && request.method === "GET") {
          const params = Object.fromEntries(url.searchParams);
          return await handleCalendarListEvents(env, params, gUid);
        }
        if (path === "/google/calendar/events" && request.method === "POST") {
          const body = await request.json();
          return await handleCalendarCreateEvent(env, body, gUid);
        }
        if (path.match(/^\/google\/calendar\/events\/[^/]+$/) && request.method === "PATCH") {
          const eventId = path.split("/google/calendar/events/")[1];
          const body = await request.json();
          return await handleCalendarUpdateEvent(env, eventId, body, gUid);
        }
        if (path.match(/^\/google\/calendar\/events\/[^/]+$/) && request.method === "DELETE") {
          const eventId = path.split("/google/calendar/events/")[1];
          return await handleCalendarDeleteEvent(env, eventId, gUid);
        }
        if (path === "/google/calendar/freebusy" && request.method === "POST") {
          const body = await request.json();
          return await handleCalendarFreeBusy(env, body, gUid);
        }
      }

      // ─── Page Config CRUD ───
      // Summary cache route matched before single-page routes
      const summaryMatch = path.match(/^\/pages\/([^/]+)\/summary$/);
      if (summaryMatch && request.method === "GET") {
        return await handleGetSummaryCache(env, summaryMatch[1]);
      }
      if (summaryMatch && request.method === "PUT") {
        const body = await request.json();
        return await handleSetSummaryCache(env, summaryMatch[1], body);
      }

      // Schema routes matched before single-page routes to avoid ID collision
      const schemaMatch = path.match(/^\/pages\/([^/]+)\/schema$/);
      if (schemaMatch) {
        const id = schemaMatch[1];
        if (request.method === "GET") return await handleGetSchema(env, id);
        if (request.method === "PATCH") {
          if (!await checkPagePermission(env, user, id, "owner")) {
            return jsonResponse({ _error: "You don't have permission to edit this schema" }, 403);
          }
          const body = await request.json();
          return await handleUpdateSchema(env, id, body);
        }
      }

      if (path === "/pages" && request.method === "GET") {
        return await handleListPages(env, user);
      }
      if (path === "/pages" && request.method === "POST") {
        const body = await request.json();
        return await handleCreatePage(env, body, user);
      }
      const pageConfigMatch = path.match(/^\/pages\/([^/]+)$/);
      if (pageConfigMatch) {
        const id = pageConfigMatch[1];
        if (request.method === "GET") return await handleGetPage(env, id);
        if (request.method === "PATCH") {
          if (!await checkPagePermission(env, user, id, "owner")) {
            return jsonResponse({ _error: "You don't have permission to edit this page" }, 403);
          }
          const body = await request.json();
          return await handleUpdatePage(env, id, body);
        }
        if (request.method === "DELETE") {
          if (!await checkPagePermission(env, user, id, "owner")) {
            return jsonResponse({ _error: "You don't have permission to delete this page" }, 403);
          }
          return await handleDeletePage(env, id);
        }
      }

      // ─── Batch Reorder Pages ───
      if (path === "/pages/reorder" && request.method === "POST") {
        const body = await request.json();
        return await handleReorderPages(env, body);
      }

      // ─── Table Row CRUD ───
      // Single-row routes matched before collection routes
      const rowMatch = path.match(/^\/tables\/([^/]+)\/rows\/([^/]+)$/);
      if (rowMatch) {
        const [, tableId, rowId] = rowMatch;
        if (request.method === "PATCH") {
          if (!await checkPagePermission(env, user, tableId, "editor")) {
            return jsonResponse({ _error: "You don't have permission to edit rows in this table" }, 403);
          }
          if (!await checkPinProtection(env, user, request, tableId)) {
            return jsonResponse({ _error: "PIN verification required", pin_required: true }, 403);
          }
          const body = await request.json();
          return await handleUpdateRow(env, tableId, rowId, body, user);
        }
        if (request.method === "DELETE") {
          if (!await checkPagePermission(env, user, tableId, "editor")) {
            return jsonResponse({ _error: "You don't have permission to delete rows in this table" }, 403);
          }
          if (!await checkPinProtection(env, user, request, tableId)) {
            return jsonResponse({ _error: "PIN verification required", pin_required: true }, 403);
          }
          return await handleDeleteRow(env, tableId, rowId, url.searchParams.get("cascade"));
        }
      }

      const tableRowsMatch = path.match(/^\/tables\/([^/]+)\/rows$/);
      if (tableRowsMatch) {
        const tableId = tableRowsMatch[1];
        if (request.method === "GET") {
          if (!await checkPagePermission(env, user, tableId, "viewer")) {
            return jsonResponse({ _error: "You don't have access to this table" }, 403);
          }
          return await handleListRows(env, tableId, url);
        }
        if (request.method === "POST") {
          if (!await checkPagePermission(env, user, tableId, "editor")) {
            return jsonResponse({ _error: "You don't have permission to add rows to this table" }, 403);
          }
          if (!await checkPinProtection(env, user, request, tableId)) {
            return jsonResponse({ _error: "PIN verification required", pin_required: true }, 403);
          }
          const body = await request.json();
          return await handleCreateRows(env, tableId, body, user);
        }
      }

      const queryMatch = path.match(/^\/tables\/([^/]+)\/query$/);
      if (queryMatch && request.method === "POST") {
        const tableId = queryMatch[1];
        const body = await request.json();
        return await handleQueryTable(env, tableId, body);
      }

      // ─── Record Notes & Comments ───
      const noteMatch = path.match(/^\/records\/([^/]+)\/notes$/);
      if (noteMatch) {
        const recordId = noteMatch[1];
        if (request.method === "GET") {
          const pageConfigId = url.searchParams.get("page_config_id");
          return await handleGetNote(env, recordId, pageConfigId);
        }
        if (request.method === "PUT") {
          const body = await request.json();
          return await handleSaveNote(env, user, recordId, body);
        }
      }

      const commentDeleteMatch = path.match(/^\/records\/([^/]+)\/comments\/([^/]+)$/);
      if (commentDeleteMatch && request.method === "DELETE") {
        const [, recordId, commentId] = commentDeleteMatch;
        return await handleDeleteComment(env, user, recordId, commentId);
      }

      const commentMatch = path.match(/^\/records\/([^/]+)\/comments$/);
      if (commentMatch) {
        const recordId = commentMatch[1];
        if (request.method === "GET") {
          const pageConfigId = url.searchParams.get("page_config_id");
          return await handleListComments(env, recordId, pageConfigId);
        }
        if (request.method === "POST") {
          const body = await request.json();
          return await handleCreateComment(env, user, recordId, body);
        }
      }

      // ─── Record Badge Counts (batch) ───
      if (path === "/records/badge-counts" && request.method === "POST") {
        try {
          const body = await request.json();
          const recordIds = body.record_ids || [];
          const pageConfigId = body.page_config_id || "";
          if (recordIds.length === 0) return jsonResponse({ counts: {} });
          // Limit to 200 records per request
          const ids = recordIds.slice(0, 200);
          const placeholders = ids.map(() => "?").join(",");

          const [commentsRes, notesRes, filesRes] = await Promise.all([
            env.DB.prepare(
              `SELECT record_id, COUNT(*) as c FROM record_comments WHERE record_id IN (${placeholders}) AND page_config_id = ? GROUP BY record_id`
            ).bind(...ids, pageConfigId).all(),
            env.DB.prepare(
              `SELECT record_id FROM record_notes WHERE record_id IN (${placeholders}) AND page_config_id = ? AND content != ''`
            ).bind(...ids, pageConfigId).all(),
            env.DB.prepare(
              `SELECT record_id, COUNT(*) as c FROM files WHERE record_id IN (${placeholders}) GROUP BY record_id`
            ).bind(...ids).all(),
          ]);

          const counts = {};
          for (const r of (commentsRes.results || [])) counts[r.record_id] = { ...counts[r.record_id], comments: r.c };
          for (const r of (notesRes.results || [])) counts[r.record_id] = { ...counts[r.record_id], notes: true };
          for (const r of (filesRes.results || [])) counts[r.record_id] = { ...counts[r.record_id], files: r.c };
          return jsonResponse({ counts });
        } catch (err) {
          return jsonResponse({ _error: err.message }, 500);
        }
      }

      // ─── Task Activity ───
      const taskActivityMatch = path.match(/^\/task-activity\/([^/]+)$/);
      if (taskActivityMatch) {
        const taskId = taskActivityMatch[1];
        if (request.method === "GET") {
          const source = url.searchParams.get("source");
          return await handleGetTaskActivity(env, taskId, source);
        }
        if (request.method === "PUT") {
          const body = await request.json();
          return await handleUpsertTaskActivity(env, taskId, body);
        }
      }
      if (path === "/task-activity" && request.method === "GET") {
        const source = url.searchParams.get("source");
        return await handleListTaskActivity(env, source);
      }

      // ─── Task Interaction Journal Routes ───
      const interactionSummaryMatch = path.match(/^\/task-interactions\/([^/]+)\/summary$/);
      if (interactionSummaryMatch && request.method === "GET") {
        return await handleGetInteractionSummary(env, interactionSummaryMatch[1]);
      }
      if (path === "/task-interactions" && request.method === "POST") {
        const body = await request.json();
        return await handleLogInteraction(env, body);
      }
      if (path === "/task-interactions" && request.method === "GET") {
        return await handleListInteractions(env, url);
      }

      // ─── Sheet Routes ───
      const sheetStructureMatch = path.match(/^\/sheets\/([^/]+)\/structure$/);
      if (sheetStructureMatch && request.method === "POST") {
        const id = sheetStructureMatch[1];
        const body = await request.json();
        return await handleSheetStructure(env, id, body);
      }

      const sheetFormulaMatch = path.match(/^\/sheets\/([^/]+)\/formula$/);
      if (sheetFormulaMatch && request.method === "POST") {
        const id = sheetFormulaMatch[1];
        const body = await request.json();
        return await handleSheetFormula(env, id, body);
      }

      const sheetResizeMatch = path.match(/^\/sheets\/([^/]+)\/resize$/);
      if (sheetResizeMatch && request.method === "POST") {
        const id = sheetResizeMatch[1];
        const body = await request.json();
        return await handleSheetResize(env, id, body);
      }

      const sheetMatch = path.match(/^\/sheets\/([^/]+)$/);
      if (sheetMatch) {
        const id = sheetMatch[1];
        if (request.method === "GET") return await handleGetSheet(env, id);
        if (request.method === "PATCH") {
          const body = await request.json();
          return await handleUpdateSheet(env, id, body);
        }
      }

      // ─── Document (R2) Routes ───
      const docBlocksMatch = path.match(/^\/docs\/([^/]+)\/blocks$/);
      if (docBlocksMatch && request.method === "PATCH") {
        const id = docBlocksMatch[1];
        const body = await request.json();
        return await handleUpdateDocBlocks(env, id, body);
      }

      const docExportMatch = path.match(/^\/docs\/([^/]+)\/export\/notion$/);
      if (docExportMatch && request.method === "GET") {
        const id = docExportMatch[1];
        return await handleExportDocNotion(env, id);
      }

      const docMatch = path.match(/^\/docs\/([^/]+)$/);
      if (docMatch) {
        const id = docMatch[1];
        if (request.method === "GET") return await handleGetDoc(env, id);
        if (request.method === "PUT") {
          const body = await request.json();
          return await handleSaveDoc(env, id, body);
        }
      }

      // ─── D1 Automation Rules CRUD ───
      const ruleMatch = path.match(/^\/d1\/rules\/([^/]+)$/);
      if (ruleMatch) {
        const id = ruleMatch[1];
        if (request.method === "GET") return await handleGetRule(env, id);
        if (request.method === "PATCH") {
          const body = await request.json();
          return await handleUpdateRule(env, id, body);
        }
        if (request.method === "DELETE") return await handleDeleteRule(env, id);
      }

      if (path === "/d1/rules" && request.method === "GET") {
        return await handleListRules(env, url);
      }
      if (path === "/d1/rules" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateRule(env, body);
      }

      // ─── D1 Automation Flows CRUD ───
      const flowMatch = path.match(/^\/d1\/flows\/([^/]+)$/);
      if (flowMatch) {
        const id = flowMatch[1];
        if (request.method === "GET") return await handleGetFlow(env, id);
        if (request.method === "PATCH") {
          const body = await request.json();
          return await handleUpdateFlow(env, id, body);
        }
        if (request.method === "DELETE") return await handleDeleteFlow(env, id);
      }

      if (path === "/d1/flows" && request.method === "GET") {
        return await handleListFlows(env, url);
      }
      if (path === "/d1/flows" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateFlow(env, body);
      }

      // ─── D1 Notifications ───
      if (path === "/d1/notifications" && request.method === "GET") {
        return await handleListNotifications(env, url, user);
      }
      if (path === "/d1/notifications" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateNotification(env, body);
      }
      // Mark all notifications read for current user
      if (path === "/d1/notifications/mark-all-read" && request.method === "POST") {
        const freshRole = user ? await getFreshRole(env, user) : null;
        // Multi-user: deleted/unknown users get no access
        if (user && !freshRole) return jsonResponse({ _error: "User not found" }, 403);
        let query = "UPDATE notifications SET status = 'read' WHERE status = 'unread'";
        const params = [];
        if (user) {
          query += " AND (target_user_id = 'all' OR target_user_id = ?)";
          params.push(user.sub);
        }
        const result = await env.DB.prepare(query).bind(...params).run();
        // Audit log
        if (user) {
          try {
            await env.DB.prepare(
              "INSERT INTO audit_log (id, user_id, user_name, action, resource_type, details, created_at) VALUES (?, ?, ?, 'mark_all_read', 'notification', ?, datetime('now'))"
            ).bind(crypto.randomUUID(), user.sub, user.name || "", JSON.stringify({ count: result?.changes || 0 })).run();
          } catch (_) {}
        }
        return jsonResponse({ success: true });
      }
      // Lightweight unread count only (for polling)
      if (path === "/d1/notifications/unread-count" && request.method === "GET") {
        const freshRole = user ? await getFreshRole(env, user) : null;
        if (user && !freshRole) return jsonResponse({ _error: "User not found" }, 403);
        let query = "SELECT COUNT(*) as count FROM notifications WHERE status = 'unread'";
        const params = [];
        if (user) {
          query += " AND (target_user_id = 'all' OR target_user_id = ?)";
          params.push(user.sub);
        }
        const row = await env.DB.prepare(query).bind(...params).first();
        return jsonResponse({ unread_count: row?.count || 0 });
      }
      // Notification preferences (get/put)
      if (path === "/d1/notifications/preferences" && (request.method === "GET" || request.method === "PUT")) {
        if (!user?.sub) return jsonResponse({ _error: "Auth required" }, 401);
        if (request.method === "GET") {
          const row = await env.DB.prepare(
            "SELECT value FROM user_connections WHERE user_id = ? AND key = 'notification_prefs'"
          ).bind(user.sub).first();
          return jsonResponse(row?.value ? JSON.parse(row.value) : { muted_types: [] });
        }
        // PUT
        const body = await request.json();
        const prefs = JSON.stringify({ muted_types: body.muted_types || [] });
        await env.DB.prepare(
          "INSERT OR REPLACE INTO user_connections (user_id, key, value, updated_at) VALUES (?, 'notification_prefs', ?, datetime('now'))"
        ).bind(user.sub, prefs).run();
        return jsonResponse({ success: true });
      }

      // ─── D1 Notifications CRUD (by ID — must come AFTER specific sub-path routes) ───
      const notifMatch = path.match(/^\/d1\/notifications\/([^/]+)$/);
      if (notifMatch) {
        const id = notifMatch[1];
        if (request.method === "GET") return await handleGetNotification(env, id);
        if (request.method === "PATCH") {
          const body = await request.json();
          return await handleUpdateNotification(env, id, body);
        }
        if (request.method === "DELETE") return await handleDeleteNotification(env, id);
      }

      // ─── D1 Knowledge Base CRUD ───
      const kbMatch = path.match(/^\/d1\/kb\/([^/]+)$/);
      if (kbMatch) {
        const id = kbMatch[1];
        if (request.method === "GET") return await handleGetKB(env, id);
        if (request.method === "PATCH") {
          const body = await request.json();
          return await handleUpdateKB(env, id, body);
        }
        if (request.method === "DELETE") return await handleDeleteKB(env, id);
      }

      if (path === "/d1/kb" && request.method === "GET") {
        return await handleListKB(env, url);
      }
      if (path === "/d1/kb" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateKB(env, body);
      }
      if (path === "/d1/kb/search" && request.method === "POST") {
        const body = await request.json();
        return await handleSearchKB(env, body);
      }

      // ─── Custom Functions CRUD ───
      if (path === "/d1/custom-functions" && request.method === "GET") {
        return await handleListCustomFunctions(env, url);
      }
      if (path === "/d1/custom-functions" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateCustomFunction(env, body);
      }
      const cfMatch = path.match(/^\/d1\/custom-functions\/([^/]+)$/);
      if (cfMatch && request.method === "GET") {
        return await handleGetCustomFunction(env, decodeURIComponent(cfMatch[1]));
      }
      if (cfMatch && request.method === "PATCH") {
        const body = await request.json();
        return await handleUpdateCustomFunction(env, decodeURIComponent(cfMatch[1]), body);
      }
      if (cfMatch && request.method === "DELETE") {
        return await handleDeleteCustomFunction(env, decodeURIComponent(cfMatch[1]));
      }

      // ─── Function Executions (Audit Trail) ───
      if (path === "/d1/function-executions" && request.method === "GET") {
        return await handleListFunctionExecutions(env, url);
      }
      if (path === "/d1/function-executions" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateFunctionExecution(env, body);
      }

      // ─── Flow Executions ───
      if (path === "/d1/flow-executions" && request.method === "GET") {
        return await handleListFlowExecutions(env, url);
      }
      if (path === "/d1/flow-executions" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateFlowExecution(env, body);
      }
      const fexMatch = path.match(/^\/d1\/flow-executions\/([^/]+)$/);
      if (fexMatch && request.method === "PATCH") {
        const body = await request.json();
        return await handleUpdateFlowExecution(env, decodeURIComponent(fexMatch[1]), body);
      }

      // ─── External API Proxy ───

      if (path === "/proxy/external-api" && request.method === "POST") {
        return await handleExternalApiProxy(env, await request.json());
      }

      // ─── Neurons CRUD ───

      // GET /neurons/graph — full dump for Wasabi agent
      if (path === "/neurons/graph" && request.method === "GET") {
        const { results: neurons } = await env.DB.prepare("SELECT * FROM neurons ORDER BY updated_at DESC").all();
        const { results: nodes } = await env.DB.prepare("SELECT * FROM neuron_nodes ORDER BY neuron_id, created_at").all();
        const nodesByNeuron = {};
        for (const node of nodes) {
          if (!nodesByNeuron[node.neuron_id]) nodesByNeuron[node.neuron_id] = [];
          nodesByNeuron[node.neuron_id].push(node);
        }
        return jsonResponse({ neurons: neurons.map(n => ({ ...n, nodes: nodesByNeuron[n.id] || [] })) });
      }

      // GET /neurons/by-node/:nodeId — find neurons containing a specific node
      if (path.startsWith("/neurons/by-node/") && request.method === "GET") {
        const nodeId = decodeURIComponent(path.slice(17));
        const { results } = await env.DB.prepare(`
          SELECT n.id, n.name, n.created_at, n.updated_at, COUNT(nn2.id) as node_count
          FROM neuron_nodes nn
          JOIN neurons n ON nn.neuron_id = n.id
          LEFT JOIN neuron_nodes nn2 ON nn2.neuron_id = n.id
          WHERE nn.node_id = ?
          GROUP BY n.id
        `).bind(nodeId).all();
        return jsonResponse({ neurons: results });
      }

      // POST /neurons/:id/nodes — add a node to an existing neuron
      const addNodeMatch = path.match(/^\/neurons\/([^/]+)\/nodes$/);
      if (addNodeMatch && request.method === "POST") {
        const neuronId = addNodeMatch[1];
        const node = await request.json();
        const nodeRowId = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO neuron_nodes (id, neuron_id, node_type, node_id, node_label, page_config_id, meta) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(nodeRowId, neuronId, node.node_type, node.node_id, node.node_label || "", node.page_config_id || "", JSON.stringify(node.meta || {})).run();
        await env.DB.prepare("UPDATE neurons SET updated_at = datetime('now') WHERE id = ?").bind(neuronId).run();
        return jsonResponse({ id: nodeRowId }, 201);
      }

      // DELETE /neurons/:id/nodes/:nodeId — remove a node from a neuron
      const removeNodeMatch = path.match(/^\/neurons\/([^/]+)\/nodes\/([^/]+)$/);
      if (removeNodeMatch && request.method === "DELETE") {
        const [, neuronId, nodeRowId] = removeNodeMatch;
        await env.DB.prepare("DELETE FROM neuron_nodes WHERE id = ? AND neuron_id = ?").bind(nodeRowId, neuronId).run();
        await env.DB.prepare("UPDATE neurons SET updated_at = datetime('now') WHERE id = ?").bind(neuronId).run();
        return jsonResponse({ ok: true });
      }

      // Single neuron routes: GET/PATCH/DELETE /neurons/:id
      const neuronMatch = path.match(/^\/neurons\/([^/]+)$/);
      if (neuronMatch) {
        const id = neuronMatch[1];
        if (request.method === "GET") {
          const neuron = await env.DB.prepare("SELECT * FROM neurons WHERE id = ?").bind(id).first();
          if (!neuron) return jsonResponse({ _error: "Neuron not found" }, 404);
          const { results: nodes } = await env.DB.prepare("SELECT * FROM neuron_nodes WHERE neuron_id = ? ORDER BY created_at").bind(id).all();
          return jsonResponse({ ...neuron, nodes });
        }
        if (request.method === "PATCH") {
          const body = await request.json();
          await env.DB.prepare("UPDATE neurons SET name = ?, updated_at = datetime('now') WHERE id = ?").bind(body.name || "", id).run();
          return jsonResponse({ ok: true });
        }
        if (request.method === "DELETE") {
          await env.DB.prepare("DELETE FROM neuron_nodes WHERE neuron_id = ?").bind(id).run();
          await env.DB.prepare("DELETE FROM neurons WHERE id = ?").bind(id).run();
          return jsonResponse({ ok: true });
        }
      }

      // GET /neurons — list all with node counts
      if (path === "/neurons" && request.method === "GET") {
        const { results } = await env.DB.prepare(`
          SELECT n.id, n.name, n.created_at, n.updated_at, COUNT(nn.id) as node_count
          FROM neurons n LEFT JOIN neuron_nodes nn ON n.id = nn.neuron_id
          GROUP BY n.id ORDER BY n.updated_at DESC
        `).all();
        return jsonResponse({ neurons: results });
      }

      // POST /neurons — create with initial nodes
      if (path === "/neurons" && request.method === "POST") {
        const { name, nodes } = await request.json();
        if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
          return jsonResponse({ _error: "At least one node is required" }, 400);
        }
        const neuronId = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO neurons (id, name) VALUES (?, ?)").bind(neuronId, name || "").run();
        for (const node of nodes) {
          const nodeRowId = crypto.randomUUID();
          await env.DB.prepare(
            "INSERT INTO neuron_nodes (id, neuron_id, node_type, node_id, node_label, page_config_id, meta) VALUES (?, ?, ?, ?, ?, ?, ?)"
          ).bind(nodeRowId, neuronId, node.node_type, node.node_id, node.node_label || "", node.page_config_id || "", JSON.stringify(node.meta || {})).run();
        }
        return jsonResponse({ id: neuronId, name: name || "", node_count: nodes.length }, 201);
      }

      // ─── Cell Links Routes ───

      // GET /links?target_page_id=X&target_view_idx=N — list links for a view
      if (path === "/links" && request.method === "GET") {
        const url = new URL(request.url);
        const targetPage = url.searchParams.get("target_page_id");
        const targetView = url.searchParams.get("target_view_idx");
        let query = "SELECT * FROM cell_links WHERE active = 1";
        const binds = [];
        if (targetPage) { query += " AND target_page_id = ?"; binds.push(targetPage); }
        if (targetView != null) { query += " AND target_view_idx = ?"; binds.push(Number(targetView)); }
        query += " ORDER BY created_at DESC";
        const { results } = await env.DB.prepare(query).bind(...binds).all();
        // Parse JSON refs
        const links = results.map((r) => ({
          ...r,
          source_ref: safeParseJSON(r.source_ref),
          target_ref: safeParseJSON(r.target_ref),
        }));
        return jsonResponse({ links });
      }

      // POST /links — create a new link
      if (path === "/links" && request.method === "POST") {
        const body = await request.json();
        const id = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO cell_links (id, source_page_id, source_view_idx, source_ref, target_page_id, target_view_idx, target_ref, direction, active, source_field_type, target_field_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        ).bind(
          id,
          body.source_page_id || "",
          body.source_view_idx ?? 0,
          JSON.stringify(body.source_ref || {}),
          body.target_page_id || "",
          body.target_view_idx ?? 0,
          JSON.stringify(body.target_ref || {}),
          body.direction || "one_way",
          body.source_field_type || "",
          body.target_field_type || ""
        ).run();
        return jsonResponse({ id }, 201);
      }

      // GET /links/by-source/:pageId — links from a source page
      if (path.startsWith("/links/by-source/") && request.method === "GET") {
        const sourcePageId = decodeURIComponent(path.slice(17));
        const { results } = await env.DB.prepare(
          "SELECT * FROM cell_links WHERE source_page_id = ? AND active = 1 ORDER BY created_at DESC"
        ).bind(sourcePageId).all();
        const links = results.map((r) => ({
          ...r,
          source_ref: safeParseJSON(r.source_ref),
          target_ref: safeParseJSON(r.target_ref),
        }));
        return jsonResponse({ links });
      }

      // Single link routes: GET/PATCH/DELETE /links/:id
      const linkMatch = path.match(/^\/links\/([^/]+)$/);
      if (linkMatch) {
        const id = linkMatch[1];
        if (request.method === "GET") {
          const link = await env.DB.prepare("SELECT * FROM cell_links WHERE id = ?").bind(id).first();
          if (!link) return jsonResponse({ _error: "Link not found" }, 404);
          return jsonResponse({
            ...link,
            source_ref: safeParseJSON(link.source_ref),
            target_ref: safeParseJSON(link.target_ref),
          });
        }
        if (request.method === "PATCH") {
          const body = await request.json();
          const sets = [];
          const vals = [];
          if (body.direction !== undefined) { sets.push("direction = ?"); vals.push(body.direction); }
          if (body.active !== undefined) { sets.push("active = ?"); vals.push(body.active ? 1 : 0); }
          if (body.source_ref !== undefined) { sets.push("source_ref = ?"); vals.push(JSON.stringify(body.source_ref)); }
          if (body.target_ref !== undefined) { sets.push("target_ref = ?"); vals.push(JSON.stringify(body.target_ref)); }
          if (body.source_field_type !== undefined) { sets.push("source_field_type = ?"); vals.push(body.source_field_type); }
          if (body.target_field_type !== undefined) { sets.push("target_field_type = ?"); vals.push(body.target_field_type); }
          if (sets.length > 0) {
            vals.push(id);
            await env.DB.prepare(`UPDATE cell_links SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
          }
          return jsonResponse({ ok: true });
        }
        if (request.method === "DELETE") {
          await env.DB.prepare("DELETE FROM cell_links WHERE id = ?").bind(id).run();
          return jsonResponse({ ok: true });
        }
      }

      // ─── Notion Sync Routes ───
      const syncConfigureMatch = path.match(/^\/sync\/([^/]+)\/configure$/);
      if (syncConfigureMatch && request.method === "POST") {
        const tableId = syncConfigureMatch[1];
        const body = await request.json();
        const notionKey = await getNotionKey(request, env);
        return await handleSyncConfigure(env, tableId, body, notionKey);
      }

      const syncPushMatch = path.match(/^\/sync\/([^/]+)\/push$/);
      if (syncPushMatch && request.method === "POST") {
        const tableId = syncPushMatch[1];
        const notionKey = await getNotionKey(request, env);
        return await handleSyncPush(env, tableId, notionKey);
      }

      const syncPullMatch = path.match(/^\/sync\/([^/]+)\/pull$/);
      if (syncPullMatch && request.method === "POST") {
        const tableId = syncPullMatch[1];
        const notionKey = await getNotionKey(request, env);
        const fullResync = url.searchParams.get("full") === "1";
        return await handleSyncPull(env, tableId, notionKey, fullResync);
      }

      const syncStatusMatch = path.match(/^\/sync\/([^/]+)\/status$/);
      if (syncStatusMatch && request.method === "GET") {
        const tableId = syncStatusMatch[1];
        return await handleSyncStatus(env, tableId);
      }

      // Sync flush — process all dirty rows
      if (path === "/sync/flush" && request.method === "POST") {
        const notionKey = await getNotionKey(request, env);
        return await handleSyncFlush(env, notionKey);
      }

      // Sync bootstrap — auto-configure + full pull for all linked Notion databases
      if (path === "/sync/bootstrap" && request.method === "POST") {
        const notionKey = await getNotionKey(request, env);
        return await handleSyncBootstrap(env, notionKey);
      }

      const syncDeleteMatch = path.match(/^\/sync\/([^/]+)$/);
      if (syncDeleteMatch && request.method === "DELETE") {
        const tableId = syncDeleteMatch[1];
        return await handleSyncDelete(env, tableId);
      }

      // ─── Disconnect & Sync Backup ───
      const disconnectMatch = path.match(/^\/pages\/([^/]+)\/disconnect$/);
      if (disconnectMatch && request.method === "POST") {
        const pageId = disconnectMatch[1];
        return await handleDisconnect(env, pageId);
      }

      const syncBackupMatch = path.match(/^\/pages\/([^/]+)\/sync-backup$/);
      if (syncBackupMatch && request.method === "POST") {
        const pageId = syncBackupMatch[1];
        const body = await request.json();
        const notionKey = await getNotionKey(request, env);
        return await handleSyncBackup(env, pageId, body, notionKey);
      }

      // ─── File Storage (R2) ───
      const fileMatch = path.match(/^\/files\/([^/]+)$/);

      // POST /files — upload file (multipart form-data)
      if (path === "/files" && request.method === "POST") {
        return await handleFileUpload(request, env);
      }
      // GET /files — list files, requires ?page_id= or ?record_id=
      if (path === "/files" && request.method === "GET") {
        return await handleListFiles(env, user, url.searchParams.get("page_id"), url.searchParams.get("record_id"));
      }
      // GET /files/:id — download file (with page permission check)
      if (fileMatch && request.method === "GET") {
        return await handleGetFile(env, user, fileMatch[1]);
      }
      // DELETE /files/:id — delete file (with page permission check)
      if (fileMatch && request.method === "DELETE") {
        return await handleDeleteFile(env, user, fileMatch[1]);
      }

      // ─── Monday.com Proxy ───
      if (path === "/monday/graphql" && request.method === "POST") {
        const body = await request.json();
        const mondayKey = body.mondayKey || await getMondayKey(env);
        if (!mondayKey) {
          return jsonResponse({ _error: "Monday.com API key not configured" }, 400);
        }
        const mondayRes = await fetch("https://api.monday.com/v2", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": mondayKey,
            "API-Version": "2024-10",
          },
          body: JSON.stringify({ query: body.query, variables: body.variables }),
        });
        const mondayData = await mondayRes.json();
        return jsonResponse(mondayData, mondayRes.ok ? 200 : mondayRes.status);
      }

      // ─── Notion Routes ───
      const notionKey = await getNotionKey(request, env);

      // Query database (with pagination)
      if (path === "/query" && request.method === "POST") {
        const body = await request.json();
        return await notionFetch(`/databases/${body.database_id}/query`, "POST", notionKey, {
          filter: body.filter,
          sorts: body.sorts,
          start_cursor: body.start_cursor,
          page_size: body.page_size || 100,
        });
      }

      // Batch resolve page titles (for relation fields)
      if (path === "/pages/titles" && request.method === "POST") {
        const { ids } = await request.json();
        if (!Array.isArray(ids) || ids.length === 0) return jsonResponse({});
        // Limit to 50 to avoid excessive API calls
        const uniqueIds = [...new Set(ids)].slice(0, 50);
        const titles = {};
        // Fetch in parallel, 10 at a time
        for (let i = 0; i < uniqueIds.length; i += 10) {
          const batch = uniqueIds.slice(i, i + 10);
          const results = await Promise.allSettled(
            batch.map(async (id) => {
              try {
                const res = await fetch(`${NOTION_API}/pages/${id}`, {
                  headers: { Authorization: `Bearer ${notionKey}`, "Notion-Version": "2022-06-28" },
                });
                if (!res.ok) return { id, title: "Untitled" };
                const page = await res.json();
                // Extract title — try type=title first, then check for rich_text arrays
                let title = null;
                for (const [propName, prop] of Object.entries(page.properties || {})) {
                  if (prop.type === "title") {
                    const arr = prop.title || [];
                    if (arr.length > 0) {
                      title = arr.map(t => t.plain_text || "").join("");
                    }
                    break;
                  }
                }
                // Fallback: look for any property with a title array
                if (!title) {
                  for (const [propName, prop] of Object.entries(page.properties || {})) {
                    if (prop.title && Array.isArray(prop.title) && prop.title.length > 0) {
                      title = prop.title.map(t => t.plain_text || "").join("");
                      break;
                    }
                  }
                }
                return { id, title: title || "Untitled" };
              } catch {
                return { id, title: "Untitled" };
              }
            })
          );
          for (const r of results) {
            if (r.status === "fulfilled" && r.value) titles[r.value.id] = r.value.title;
          }
        }
        return jsonResponse(titles);
      }

      // Get page
      if (path.startsWith("/page/") && request.method === "GET") {
        const pageId = path.split("/page/")[1];
        return await notionFetch(`/pages/${pageId}`, "GET", notionKey);
      }

      // Create page
      if (path === "/page" && request.method === "POST") {
        const body = await request.json();
        return await notionFetch("/pages", "POST", notionKey, body);
      }

      // Update page
      if (path.startsWith("/page/") && request.method === "PATCH") {
        const pageId = path.split("/page/")[1];
        const body = await request.json();
        return await notionFetch(`/pages/${pageId}`, "PATCH", notionKey, body);
      }

      // Get database schema
      if (path.startsWith("/database/") && request.method === "GET") {
        const dbId = path.split("/database/")[1];
        return await notionFetch(`/databases/${dbId}`, "GET", notionKey);
      }

      // Create database
      if (path === "/create-database" && request.method === "POST") {
        const body = await request.json();
        return await notionFetch("/databases", "POST", notionKey, body);
      }

      // Update database (schema / title)
      if (path.startsWith("/database/") && request.method === "PATCH") {
        const dbId = path.split("/database/")[1];
        const body = await request.json();
        return await notionFetch(`/databases/${dbId}`, "PATCH", notionKey, body);
      }

      // Update single block
      if (path.startsWith("/block/") && request.method === "PATCH") {
        const blockId = path.split("/block/")[1];
        const body = await request.json();
        return await notionFetch(`/blocks/${blockId}`, "PATCH", notionKey, body);
      }

      // Delete single block
      if (path.startsWith("/block/") && request.method === "DELETE") {
        const blockId = path.split("/block/")[1];
        return await notionFetch(`/blocks/${blockId}`, "DELETE", notionKey);
      }

      // Get blocks
      if (path.startsWith("/blocks/") && request.method === "GET") {
        const blockId = path.split("/blocks/")[1];
        return await notionFetch(`/blocks/${blockId}/children?page_size=100`, "GET", notionKey);
      }

      // Append blocks
      if (path.startsWith("/blocks/") && request.method === "PATCH") {
        const blockId = path.split("/blocks/")[1];
        const body = await request.json();
        return await notionFetch(`/blocks/${blockId}/children`, "PATCH", notionKey, body);
      }

      // Search
      if (path === "/search" && request.method === "POST") {
        const body = await request.json();
        return await notionFetch("/search", "POST", notionKey, body);
      }

      // Test Notion connection
      if (path === "/test" && request.method === "GET") {
        return await notionFetch("/users/me", "GET", notionKey);
      }

      // ─── Claude API (with smart caching) ───
      if (path === "/claude" && request.method === "POST") {
        const body = await request.json();
        const claudeKey = await getClaudeKey(request, body, env);
        if (!claudeKey) {
          return jsonResponse({ _error: "Missing Claude API key" }, 400);
        }
        delete body.claudeKey;

        // ── Cache layer: only for requests flagged as cacheable ──
        const cacheHint = request.headers.get("X-Cache-Hint");
        if (cacheHint === "cacheable") {
          const cacheKey = await buildAICacheKey(body);
          const cache = caches.default;
          const cached = await cache.match(cacheKey);
          if (cached) {
            const hitBody = await cached.text();
            return new Response(hitBody, {
              status: 200,
              headers: { ...CORS, "Content-Type": "application/json", "X-Cache": "HIT" },
            });
          }

          // Cache miss — call Claude, then cache successful responses
          const response = await claudeFetch(claudeKey, body);
          if (response.status === 200) {
            const responseBody = await response.text();
            const cachedResp = new Response(responseBody, {
              status: 200,
              headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
            });
            ctx.waitUntil(cache.put(cacheKey, cachedResp));

            return new Response(responseBody, {
              status: 200,
              headers: { ...CORS, "Content-Type": "application/json", "X-Cache": "MISS" },
            });
          }
          return response;
        }

        // Non-cacheable: direct pass-through
        return await claudeFetch(claudeKey, body);
      }

      // ─── File proxy (download Notion files as base64) ───
      if (path === "/fetch-file" && request.method === "POST") {
        const { url: fileUrl } = await request.json();
        if (!fileUrl) return jsonResponse({ _error: "Missing file URL" }, 400);

        const fileRes = await fetch(fileUrl);
        if (!fileRes.ok) return jsonResponse({ _error: `File fetch failed: ${fileRes.status}` }, 502);

        const buffer = await fileRes.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        const contentType = fileRes.headers.get("Content-Type") || "application/octet-stream";

        return jsonResponse({ base64, contentType, size: buffer.byteLength });
      }

      // ─── Linked Sheet proxy (fetch + parse CSV with caching) ───
      if (path === "/sheets/fetch" && request.method === "POST") {
        const { url: sheetUrl } = await request.json();
        if (!sheetUrl) return jsonResponse({ _error: "Missing sheet URL" }, 400);
        if (!sheetUrl.startsWith("https://")) return jsonResponse({ _error: "Only HTTPS URLs are supported" }, 400);

        let fetchUrl = sheetUrl;
        let sheetType = "csv";
        const gMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
        if (gMatch) {
          sheetType = "google_sheets";
          fetchUrl = `https://docs.google.com/spreadsheets/d/${gMatch[1]}/gviz/tq?tqx=out:csv`;
        }

        const cacheKey = new Request(`https://wasabi-cache.internal/sheets/${encodeURIComponent(sheetUrl)}`, { method: "GET" });
        const cache = caches.default;
        const cached = await cache.match(cacheKey);
        if (cached) return cached;

        const csvRes = await fetch(fetchUrl, { headers: { "User-Agent": "Wasabi-Platform/1.0" } });
        if (!csvRes.ok) {
          const status = csvRes.status;
          const msg = status === 401 || status === 403
            ? "This sheet is not publicly accessible. Make sure it is shared via 'Anyone with the link can view'."
            : `Failed to fetch sheet data (${status})`;
          return jsonResponse({ _error: msg }, 502);
        }
        const csvText = await csvRes.text();

        const { columns, rows } = parseCSV(csvText);
        const result = { columns, rows: rows.slice(0, 10000), cachedAt: Date.now(), sheetType, truncated: rows.length > 10000 };

        const response = jsonResponse(result);
        const cachedResponse = new Response(response.body, response);
        cachedResponse.headers.set("Cache-Control", "public, max-age=300");
        await cache.put(cacheKey, cachedResponse.clone());

        return cachedResponse;
      }

      // ─── Page Permissions Management ───
      const pagePermMatch = path.match(/^\/pages\/([^/]+)\/permissions$/);
      if (pagePermMatch) {
        const pageId = pagePermMatch[1];
        if (request.method === "GET") {
          // Only owner/admin can view permissions
          if (!await checkPagePermission(env, user, pageId, "owner")) {
            return jsonResponse({ _error: "Only page owners can view permissions" }, 403);
          }
          const { results } = await env.DB.prepare(
            "SELECT pp.*, u.display_name FROM page_permissions pp LEFT JOIN users u ON pp.user_id = u.id WHERE pp.page_id = ? ORDER BY pp.created_at"
          ).bind(pageId).all();
          return jsonResponse({ permissions: results || [] });
        }
        if (request.method === "PUT") {
          // Only owner/admin can set permissions
          if (!await checkPagePermission(env, user, pageId, "owner")) {
            return jsonResponse({ _error: "Only page owners can manage permissions" }, 403);
          }
          const body = await request.json();
          if (!body.user_id || !body.permission) {
            return jsonResponse({ _error: "Missing user_id or permission" }, 400);
          }
          if (!["owner", "editor", "viewer", "none"].includes(body.permission)) {
            return jsonResponse({ _error: "Invalid permission level" }, 400);
          }
          await env.DB.prepare(
            "INSERT OR REPLACE INTO page_permissions (page_id, user_id, permission, granted_by) VALUES (?, ?, ?, ?)"
          ).bind(pageId, body.user_id, body.permission, user?.sub || "system").run();
          await auditLog(env, user, "set_page_permission", "page", pageId, { target_user: body.user_id, permission: body.permission });
          return jsonResponse({ ok: true });
        }
      }

      const pagePermDeleteMatch = path.match(/^\/pages\/([^/]+)\/permissions\/([^/]+)$/);
      if (pagePermDeleteMatch && request.method === "DELETE") {
        const [, pageId, targetUserId] = pagePermDeleteMatch;
        if (!await checkPagePermission(env, user, pageId, "owner")) {
          return jsonResponse({ _error: "Only page owners can manage permissions" }, 403);
        }
        await env.DB.prepare(
          "DELETE FROM page_permissions WHERE page_id = ? AND user_id = ?"
        ).bind(pageId, targetUserId).run();
        await auditLog(env, user, "remove_page_permission", "page", pageId, { target_user: targetUserId });
        return jsonResponse({ ok: true });
      }

      // ─── Audit Log (admin only) ───
      if (path === "/audit-log" && request.method === "GET") {
        if (user && user.role !== "admin") {
          return jsonResponse({ _error: "Admin required" }, 403);
        }
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
        const offset = parseInt(url.searchParams.get("offset") || "0");
        const action = url.searchParams.get("action");
        const resourceType = url.searchParams.get("resource_type");
        let query = "SELECT * FROM audit_log";
        const conditions = [];
        const binds = [];
        if (action) { conditions.push("action = ?"); binds.push(action); }
        if (resourceType) { conditions.push("resource_type = ?"); binds.push(resourceType); }
        if (conditions.length) query += " WHERE " + conditions.join(" AND ");
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
        binds.push(limit, offset);
        const { results } = await env.DB.prepare(query).bind(...binds).all();
        return jsonResponse({ entries: (results || []).map(r => ({ ...r, details: JSON.parse(r.details || "{}") })) });
      }

      // ─── Factory Reset ───
      if (path === "/factory-reset" && request.method === "POST") {
        await auditLog(env, user, "factory_reset", "system", "", {});
        return await handleFactoryReset(env);
      }

      // 404
      return jsonResponse({ error: "Not found", path }, 404);

    } catch (err) {
      return jsonResponse({ _error: err.message || "Internal server error" }, 500);
    }
  },
};

// ─── Route Handlers ───

async function handleHealth(env) {
  const status = { ok: true, version: "2.0.0", d1: false, r2: false, notion: false, claude: false };

  // Check D1
  try {
    await env.DB.prepare("SELECT 1").first();
    status.d1 = true;
  } catch {}

  // Check R2
  try {
    if (env.DOCS) {
      await env.DOCS.head("__health__");
      status.r2 = true;
    }
  } catch {
    // R2 binding exists but head() on missing key throws — that's fine
    if (env.DOCS) status.r2 = true;
  }

  // Check if Notion connection exists
  try {
    const row = await env.DB.prepare("SELECT key FROM connections WHERE key = 'notion'").first();
    status.notion = !!row;
  } catch {}

  // Check if Claude connection exists
  try {
    const row = await env.DB.prepare("SELECT key FROM connections WHERE key = 'claude'").first();
    status.claude = !!row;
  } catch {}

  return jsonResponse(status);
}

async function handleInit(env) {
  // ── Schema version fast path ──
  // Skip all DDL if the schema is already at the current version.
  // Reduces ~92 sequential D1 queries to 3 on returning page loads.
  const CURRENT_SCHEMA_VERSION = "2";
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM connections WHERE key = 'schema_version'"
    ).first();
    if (row?.value === CURRENT_SCHEMA_VERSION) {
      let multiUserEnabled = false;
      try {
        const registered = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM users WHERE password_hash IS NOT NULL AND deleted_at IS NULL"
        ).first();
        multiUserEnabled = registered && registered.count > 0;
      } catch {}
      const tables = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
      ).all();
      return jsonResponse({
        ok: true,
        tables: tables.results.map((t) => t.name),
        message: "Database initialized successfully",
        multi_user: multiUserEnabled,
      });
    }
  } catch {
    // connections table doesn't exist yet (first boot) — fall through to full init
  }

  // ── Full init (first boot, factory reset, or schema version bump) ──
  const statements = D1_SCHEMA.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  const indexStatements = D1_INDEXES.split(";").map((s) => s.trim()).filter((s) => s.length > 0);

  try {
    // Create tables (batched — single round-trip)
    await env.DB.batch(statements.map(sql => env.DB.prepare(sql)));

    // Migrations for existing databases (run BEFORE indexes, since indexes may reference new columns)
    const migrations = [
      "ALTER TABLE sheet_data ADD COLUMN row_heights TEXT DEFAULT '{}'",
      "ALTER TABLE sheet_data ADD COLUMN frozen TEXT DEFAULT '{}'",
      "ALTER TABLE sheet_data ADD COLUMN cell_styles TEXT DEFAULT '{}'",
      "ALTER TABLE custom_functions ADD COLUMN meta TEXT DEFAULT '{}'",
      "CREATE TABLE IF NOT EXISTS task_activity (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, source TEXT NOT NULL, last_activity_at TEXT NOT NULL, UNIQUE(task_id, source))",
      "CREATE INDEX IF NOT EXISTS idx_task_activity_lookup ON task_activity(task_id, source)",
      "ALTER TABLE table_rows ADD COLUMN sync_dirty INTEGER DEFAULT 0",
      "ALTER TABLE table_rows ADD COLUMN sync_retry_count INTEGER DEFAULT 0",
      "CREATE TABLE IF NOT EXISTS data_summary_cache (page_id TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', updated_at TEXT DEFAULT (datetime('now')))",
      // Sprint 5: Multi-user foundation
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', invite_code TEXT UNIQUE, password_hash TEXT, created_at TEXT DEFAULT (datetime('now')), last_login_at TEXT)",
      "CREATE TABLE IF NOT EXISTS user_connections (user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, metadata TEXT DEFAULT '{}', updated_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (user_id, key))",
      "CREATE INDEX IF NOT EXISTS idx_users_invite ON users(invite_code)",
      "CREATE INDEX IF NOT EXISTS idx_user_conn ON user_connections(user_id)",
      "ALTER TABLE page_configs ADD COLUMN pin_protected INTEGER DEFAULT 0",
      "ALTER TABLE notifications ADD COLUMN target_user_id TEXT DEFAULT 'all'",
      "ALTER TABLE table_rows ADD COLUMN owner_user_id TEXT DEFAULT 'default'",
      // Sprint 6: Account recovery
      "ALTER TABLE users ADD COLUMN deleted_at TEXT DEFAULT NULL",
      // Sprint 7: Per-user state persistence
      "CREATE TABLE IF NOT EXISTS user_state (user_id TEXT PRIMARY KEY, last_page TEXT, zen_tasks_table_id TEXT, updated_at TEXT DEFAULT (datetime('now')))",
      "CREATE TABLE IF NOT EXISTS user_dashboards (user_id TEXT PRIMARY KEY, widgets TEXT NOT NULL DEFAULT '[]', updated_at TEXT DEFAULT (datetime('now')))",
      // Sprint 8: Record read receipts
      "CREATE TABLE IF NOT EXISTS record_views (user_id TEXT NOT NULL, record_id TEXT NOT NULL, last_viewed_at TEXT NOT NULL, PRIMARY KEY (user_id, record_id))",
      "CREATE INDEX IF NOT EXISTS idx_record_views_user ON record_views(user_id)",
      // Sprint 13: Enriched notifications
      "ALTER TABLE notifications ADD COLUMN record_id TEXT DEFAULT ''",
      "ALTER TABLE notifications ADD COLUMN record_name TEXT DEFAULT ''",
      "ALTER TABLE notifications ADD COLUMN page_config_id TEXT DEFAULT ''",
      "ALTER TABLE notifications ADD COLUMN page_name TEXT DEFAULT ''",
      "ALTER TABLE notifications ADD COLUMN actor_name TEXT DEFAULT ''",
      // Task interaction journal (per-user, typed interactions)
      "CREATE TABLE IF NOT EXISTS task_interactions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, source TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT 'default', interaction_type TEXT NOT NULL DEFAULT 'view', detail TEXT, created_at TEXT DEFAULT (datetime('now')))",
      "CREATE INDEX IF NOT EXISTS idx_task_interactions_lookup ON task_interactions(task_id, source)",
      "CREATE INDEX IF NOT EXISTS idx_task_interactions_user ON task_interactions(user_id, source)",
      // Cell links: field type columns + indexes
      "ALTER TABLE cell_links ADD COLUMN source_field_type TEXT DEFAULT ''",
      "ALTER TABLE cell_links ADD COLUMN target_field_type TEXT DEFAULT ''",
      "CREATE INDEX IF NOT EXISTS idx_cell_links_target ON cell_links(target_page_id, target_view_idx)",
      "CREATE INDEX IF NOT EXISTS idx_cell_links_source ON cell_links(source_page_id)",
      // Per-user view preferences (stored as JSON blob)
      "ALTER TABLE user_state ADD COLUMN view_prefs TEXT DEFAULT '{}'",
      // Record model: file-per-record support
      "ALTER TABLE files ADD COLUMN record_id TEXT DEFAULT ''",
      "CREATE INDEX IF NOT EXISTS idx_files_record ON files(record_id)",
      // Sprint 14: Real-time collaboration — field-level versioning
      "ALTER TABLE table_rows ADD COLUMN cell_versions TEXT DEFAULT '{}'",
      "ALTER TABLE table_rows ADD COLUMN updated_by TEXT DEFAULT NULL",
      // Tier 2: Resource-level permissions
      "CREATE TABLE IF NOT EXISTS page_permissions (page_id TEXT NOT NULL, user_id TEXT NOT NULL, permission TEXT NOT NULL DEFAULT 'viewer', granted_by TEXT, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (page_id, user_id))",
      "CREATE INDEX IF NOT EXISTS idx_page_perms_user ON page_permissions(user_id)",
      "ALTER TABLE page_configs ADD COLUMN created_by TEXT DEFAULT NULL",
      // Tier 3: Audit log
      "CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_name TEXT DEFAULT '', action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT DEFAULT '', details TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now')))",
      "CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)",
      "CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, resource_type)",
      "CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at DESC)",
      // Tier 3: Server-side PIN sessions
      "CREATE TABLE IF NOT EXISTS pin_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, page_id TEXT NOT NULL, expires_at TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS idx_pin_sessions_page ON pin_sessions(page_id, user_id)",
      // Multi-device sync: active sessions
      "CREATE TABLE IF NOT EXISTS active_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_info TEXT DEFAULT '', ip_address TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT DEFAULT (datetime('now')), revoked_at TEXT DEFAULT NULL)",
      "CREATE INDEX IF NOT EXISTS idx_sessions_user ON active_sessions(user_id)",
      // Phase 2C: Invite code expiration
      "ALTER TABLE users ADD COLUMN invite_expires_at TEXT",
      // D1-backed rate limiting (persists across worker isolates)
      "CREATE TABLE IF NOT EXISTS rate_limits (key TEXT NOT NULL, ts INTEGER NOT NULL)",
      "CREATE INDEX IF NOT EXISTS idx_rate_limits_key_ts ON rate_limits(key, ts)",
      // Sub-items: parent-child row hierarchy
      "ALTER TABLE table_rows ADD COLUMN parent_row_id TEXT DEFAULT NULL",
      "CREATE INDEX IF NOT EXISTS idx_rows_parent ON table_rows(table_id, parent_row_id)",
      // Sub-item independent schema
      "ALTER TABLE table_schemas ADD COLUMN sub_columns TEXT DEFAULT '[]'",
    ];
    for (const sql of migrations) {
      try { await env.DB.prepare(sql).run(); } catch (_) { /* column already exists */ }
    }
    // Cleanup expired unused invites (no password_hash = never registered)
    try {
      await env.DB.prepare(
        "DELETE FROM users WHERE invite_code IS NOT NULL AND password_hash IS NULL AND invite_expires_at IS NOT NULL AND invite_expires_at < datetime('now')"
      ).run();
    } catch (_) {}

    // Create indexes (batched — single round-trip, after migrations so new columns exist)
    await env.DB.batch(indexStatements.map(sql => env.DB.prepare(sql)));

    // Bootstrap: if no users exist, create a default admin invite
    let adminBootstrap = null;
    try {
      const userCount = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
      if (!userCount || userCount.count === 0) {
        const adminId = crypto.randomUUID();
        const adminCode = crypto.randomUUID().slice(0, 8).toUpperCase();
        await env.DB.prepare(
          "INSERT INTO users (id, display_name, role, invite_code) VALUES (?, 'Admin', 'admin', ?)"
        ).bind(adminId, adminCode).run();
        adminBootstrap = { id: adminId, invite_code: adminCode, role: "admin" };
      }
    } catch {}

    // Backfill: set created_by and page_permissions for existing pages
    try {
      const firstAdmin = await env.DB.prepare(
        "SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL ORDER BY created_at LIMIT 1"
      ).first();
      if (firstAdmin) {
        // Set created_by on pages that don't have it
        await env.DB.prepare(
          "UPDATE page_configs SET created_by = ? WHERE created_by IS NULL"
        ).bind(firstAdmin.id).run();
        // Add owner permissions for all pages that don't have ANY permission entries (batched)
        const allPages = await env.DB.prepare("SELECT id FROM page_configs").all();
        const permStmts = (allPages.results || []).map(page =>
          env.DB.prepare(
            "INSERT OR IGNORE INTO page_permissions (page_id, user_id, permission, granted_by) VALUES (?, ?, 'owner', ?)"
          ).bind(page.id, firstAdmin.id, firstAdmin.id)
        );
        if (permStmts.length > 0) await env.DB.batch(permStmts);
      }
    } catch (_) {}

    // Write schema version so subsequent loads use the fast path
    try {
      await env.DB.prepare(
        "INSERT INTO connections (key, value, metadata, updated_at) VALUES ('schema_version', ?, '{}', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
      ).bind(CURRENT_SCHEMA_VERSION).run();
    } catch {}

    // Return table list
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    ).all();

    // Check if registered users exist (users with password_hash set)
    let multiUserEnabled = false;
    try {
      const registered = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM users WHERE password_hash IS NOT NULL AND deleted_at IS NULL"
      ).first();
      multiUserEnabled = registered && registered.count > 0;
    } catch {}

    return jsonResponse({
      ok: true,
      tables: tables.results.map((t) => t.name),
      message: "Database initialized successfully",
      multi_user: multiUserEnabled,
      ...(adminBootstrap ? { admin_invite: adminBootstrap } : {}),
    });
  } catch (err) {
    return jsonResponse({ _error: `Init failed: ${err.message}` }, 500);
  }
}

async function handleFactoryReset(env) {
  const userTables = [
    "page_configs", "table_schemas", "table_rows", "sheet_data",
    "documents", "automation_rules", "notifications", "knowledge_base",
    "cell_links", "sync_configs", "record_notes", "record_comments",
    "neurons", "neuron_nodes", "users", "user_connections",
    "page_permissions", "audit_log", "pin_sessions",
  ];
  try {
    for (const table of userTables) {
      try { await env.DB.prepare(`DELETE FROM ${table}`).run(); } catch (_) {}
    }
    // Also clear API connections (notion, claude, monday)
    try { await env.DB.prepare("DELETE FROM connections").run(); } catch (_) {}
    // Delete all R2 docs
    try {
      if (env.DOCS) {
        const listed = await env.DOCS.list();
        for (const obj of listed.objects || []) {
          await env.DOCS.delete(obj.key);
        }
      }
    } catch (_) {}
    return jsonResponse({ ok: true, message: "Factory reset complete. All user data erased." });
  } catch (err) {
    return jsonResponse({ _error: `Factory reset failed: ${err.message}` }, 500);
  }
}

// ─── Auth Handlers ───

async function handleAuthRegister(env, body) {
  const { invite_code, display_name, password } = body || {};
  if (!invite_code || !display_name?.trim()) {
    return jsonResponse({ _error: "invite_code and display_name required" }, 400);
  }
  if (!password || password.length < 10 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    return jsonResponse({ _error: "Password must be at least 10 characters with uppercase, lowercase, and a number" }, 400);
  }

  try {
    // Find the invite (pending user with unused invite code, OR existing user with cleared password for re-registration)
    // Also check invite hasn't expired (NULL invite_expires_at = no expiry for legacy invites)
    const invite = await env.DB.prepare(
      "SELECT id, role, display_name, password_hash FROM users WHERE invite_code = ? AND deleted_at IS NULL AND (invite_expires_at IS NULL OR invite_expires_at > datetime('now'))"
    ).bind(invite_code.trim()).first();

    if (!invite) {
      return jsonResponse({ _error: "Invalid, expired, or already used invite code" }, 400);
    }

    // Check display name uniqueness (exclude this user's own record)
    const nameCheck = await env.DB.prepare(
      "SELECT id FROM users WHERE display_name = ? AND id != ? AND deleted_at IS NULL"
    ).bind(display_name.trim(), invite.id).first();
    if (nameCheck) {
      return jsonResponse({ _error: "Display name already taken" }, 400);
    }

    // Hash password with PBKDF2
    const passwordHash = await hashPassword(password);

    // Update the user record: set display name, password, mark as registered
    const now = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE users SET display_name = ?, password_hash = ?, last_login_at = ?, invite_code = NULL WHERE id = ?"
    ).bind(display_name.trim(), passwordHash, now, invite.id).run();

    // Generate JWT with session ID (access + refresh tokens)
    const sessionId = crypto.randomUUID();
    const jwtPayload = { sub: invite.id, role: invite.role, name: display_name.trim(), jti: sessionId };
    const accessToken = await signJwt(jwtPayload, env); // 15 min
    const refreshToken = await signJwt(jwtPayload, env, REFRESH_TOKEN_DAYS * 86400); // 7 days
    // Record session
    try {
      const deviceInfo = (body._device_info || "").slice(0, 200);
      await env.DB.prepare(
        "INSERT INTO active_sessions (id, user_id, device_info) VALUES (?, ?, ?)"
      ).bind(sessionId, invite.id, deviceInfo).run();
    } catch (_) {}
    return jsonResponse(
      { ok: true, token: accessToken, user: { id: invite.id, display_name: display_name.trim(), role: invite.role } },
      200,
      { "Set-Cookie": buildAuthCookie(refreshToken) }
    );
  } catch (err) {
    return jsonResponse({ _error: `Registration failed: ${err.message}` }, 500);
  }
}

async function handleAuthLogin(env, body) {
  const { display_name, password } = body || {};

  if (!display_name?.trim() || !password) {
    return jsonResponse({ _error: "Invalid credentials" }, 401);
  }

  try {
    // Look up by display name (active users only)
    const user = await env.DB.prepare(
      "SELECT id, display_name, role, password_hash FROM users WHERE display_name = ? AND deleted_at IS NULL AND password_hash IS NOT NULL"
    ).bind(display_name.trim()).first();

    if (!user) {
      return jsonResponse({ _error: "Invalid credentials" }, 401);
    }

    // Verify password (supports both legacy SHA-256 and PBKDF2)
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return jsonResponse({ _error: "Invalid credentials" }, 401);
    }

    // Auto-migrate legacy hash to PBKDF2 on successful login
    if (!user.password_hash.includes(":")) {
      const newHash = await hashPassword(password);
      await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
        .bind(newHash, user.id).run();
    }

    // Update last login
    await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), user.id).run();

    const sessionId = crypto.randomUUID();
    const jwtPayload = { sub: user.id, role: user.role, name: user.display_name, jti: sessionId };
    const accessToken = await signJwt(jwtPayload, env); // 15 min (default)
    const refreshToken = await signJwt(jwtPayload, env, REFRESH_TOKEN_DAYS * 86400); // 7 days
    // Record session
    try {
      const deviceInfo = (body._device_info || "").slice(0, 200);
      await env.DB.prepare(
        "INSERT INTO active_sessions (id, user_id, device_info) VALUES (?, ?, ?)"
      ).bind(sessionId, user.id, deviceInfo).run();
    } catch (_) {}
    return jsonResponse(
      { ok: true, token: accessToken, refreshToken, user: { id: user.id, display_name: user.display_name, role: user.role } },
      200,
      { "Set-Cookie": buildAuthCookie(refreshToken) }
    );
  } catch (err) {
    return jsonResponse({ _error: `Login failed: ${err.message}` }, 500);
  }
}

async function handleAuthMe(env, jwtPayload) {
  try {
    const user = await env.DB.prepare(
      "SELECT id, display_name, role, created_at, last_login_at FROM users WHERE id = ?"
    ).bind(jwtPayload.sub).first();
    if (!user) return jsonResponse({ _error: "User not found" }, 404);

    // Issue a fresh access token so the client can repopulate memory after page refresh.
    // Also refresh the cookie so the 7-day window resets on activity.
    const jwtP = { sub: user.id, role: user.role, name: user.display_name, jti: jwtPayload.jti || null };
    const accessToken = await signJwt(jwtP, env); // 15 min
    const refreshToken = await signJwt(jwtP, env, REFRESH_TOKEN_DAYS * 86400); // 7 days
    return jsonResponse(
      { user, token: accessToken, refreshToken },
      200,
      { "Set-Cookie": buildAuthCookie(refreshToken) }
    );
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleAuthRefresh(env, jwtPayload) {
  try {
    const user = await env.DB.prepare(
      "SELECT id, display_name, role FROM users WHERE id = ?"
    ).bind(jwtPayload.sub).first();
    if (!user) return jsonResponse({ _error: "User not found" }, 404);

    // Issue new access token, rotate refresh cookie
    const jwtP = { sub: user.id, role: user.role, name: user.display_name, jti: jwtPayload.jti || null };
    const accessToken = await signJwt(jwtP, env); // 15 min
    const refreshToken = await signJwt(jwtP, env, REFRESH_TOKEN_DAYS * 86400); // 7 days
    return jsonResponse(
      { ok: true, token: accessToken, refreshToken, user: { id: user.id, display_name: user.display_name, role: user.role } },
      200,
      { "Set-Cookie": buildAuthCookie(refreshToken) }
    );
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── User Management Handlers (admin only) ───

async function handleCreateInvite(env, body) {
  const { role = "viewer", display_name = "Invited User", expires_in_days = 7 } = body || {};
  if (!["admin", "editor", "viewer"].includes(role)) {
    return jsonResponse({ _error: "Invalid role. Must be admin, editor, or viewer." }, 400);
  }

  try {
    const id = crypto.randomUUID();
    // Generate a short, readable invite code
    const code = crypto.randomUUID().slice(0, 8).toUpperCase();
    // Set expiration (default 7 days, max 90 days)
    const days = Math.min(Math.max(parseInt(expires_in_days) || 7, 1), 90);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    await env.DB.prepare(
      "INSERT INTO users (id, display_name, role, invite_code, invite_expires_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, display_name, role, code, expiresAt).run();

    return jsonResponse({ ok: true, invite: { id, invite_code: code, role, display_name, expires_at: expiresAt } });
  } catch (err) {
    return jsonResponse({ _error: `Failed to create invite: ${err.message}` }, 500);
  }
}

async function handleUserDirectory(env) {
  try {
    const rows = await env.DB.prepare(
      "SELECT id, display_name, role FROM users WHERE deleted_at IS NULL AND password_hash IS NOT NULL ORDER BY display_name"
    ).all();
    return jsonResponse({ users: rows.results });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleListUsers(env) {
  try {
    const rows = await env.DB.prepare(
      "SELECT id, display_name, role, invite_code, created_at, last_login_at, deleted_at FROM users ORDER BY deleted_at IS NOT NULL, created_at"
    ).all();
    return jsonResponse({ users: rows.results });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleDeleteUser(env, userId, requestingUser) {
  if (userId === requestingUser?.sub && requestingUser) {
    return jsonResponse({ _error: "Cannot delete your own account" }, 400);
  }
  // Last-admin protection
  const targetUser = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(userId).first();
  if (targetUser?.role === "admin") {
    const adminCount = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND deleted_at IS NULL"
    ).first();
    if (adminCount.count <= 1) {
      return jsonResponse({ _error: "Cannot delete the last admin. Promote another user first." }, 400);
    }
  }
  try {
    // Soft delete: set deleted_at timestamp (30-day grace period)
    await env.DB.prepare("UPDATE users SET deleted_at = datetime('now') WHERE id = ?").bind(userId).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleRestoreUser(env, userId) {
  try {
    await env.DB.prepare("UPDATE users SET deleted_at = NULL WHERE id = ?").bind(userId).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleHardDeleteUser(env, userId, body) {
  try {
    const transferTo = body?.transfer_to; // user ID or 'unassigned'
    if (transferTo && transferTo !== 'unassigned') {
      // Transfer owned records to another user
      await env.DB.prepare("UPDATE table_rows SET owner_user_id = ? WHERE owner_user_id = ?").bind(transferTo, userId).run();
    } else {
      // Mark as unassigned
      await env.DB.prepare("UPDATE table_rows SET owner_user_id = 'unassigned' WHERE owner_user_id = ?").bind(userId).run();
    }
    // Hard delete user and connections
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
    await env.DB.prepare("DELETE FROM user_connections WHERE user_id = ?").bind(userId).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleResetUserPassword(env, userId) {
  try {
    const newCode = crypto.randomUUID().slice(0, 8).toUpperCase();
    await env.DB.prepare(
      "UPDATE users SET invite_code = ?, password_hash = NULL WHERE id = ?"
    ).bind(newCode, userId).run();
    return jsonResponse({ ok: true, invite_code: newCode });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUpdateUser(env, userId, body) {
  const updates = [];
  const params = [];
  if (body.display_name) { updates.push("display_name = ?"); params.push(body.display_name); }
  if (body.role && ["admin", "editor", "viewer"].includes(body.role)) {
    // Self-demotion protection: prevent last admin from demoting themselves
    const targetUser = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(userId).first();
    if (targetUser?.role === "admin" && body.role !== "admin") {
      const adminCount = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND deleted_at IS NULL"
      ).first();
      if (adminCount.count <= 1) {
        return jsonResponse({ _error: "Cannot change role: this is the last admin. Promote another user first." }, 400);
      }
    }
    updates.push("role = ?"); params.push(body.role);
  }
  if (updates.length === 0) return jsonResponse({ _error: "Nothing to update" }, 400);

  try {
    params.push(userId);
    await env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).bind(...params).run();
    const updatedUser = await env.DB.prepare("SELECT id, display_name, role FROM users WHERE id = ?").bind(userId).first();
    return jsonResponse({ ok: true, user: updatedUser });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Session Management Handlers (multi-device sync) ───

async function handleListSessions(env, user) {
  try {
    const rows = await env.DB.prepare(
      "SELECT id, device_info, created_at, last_seen_at FROM active_sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC"
    ).bind(user.sub).all();
    return jsonResponse({
      sessions: (rows.results || []).map((s) => ({
        ...s,
        is_current: s.id === user.jti,
      })),
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleRevokeSession(env, user, sessionId) {
  try {
    // Only revoke own sessions
    const session = await env.DB.prepare(
      "SELECT user_id FROM active_sessions WHERE id = ? AND revoked_at IS NULL"
    ).bind(sessionId).first();
    if (!session || session.user_id !== user.sub) {
      return jsonResponse({ _error: "Session not found" }, 404);
    }
    await env.DB.prepare(
      "UPDATE active_sessions SET revoked_at = datetime('now') WHERE id = ?"
    ).bind(sessionId).run();
    // Broadcast session revocation via UserRoom DO
    try {
      const roomId = env.USER_ROOMS.idFromName(`user:${user.sub}`);
      const room = env.USER_ROOMS.get(roomId);
      await room.fetch(new Request("https://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "session_revoked", sessionIds: [sessionId] }),
      }));
    } catch (_) {}
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleLogoutOtherSessions(env, user) {
  try {
    // Revoke all sessions except current
    const revoked = await env.DB.prepare(
      "UPDATE active_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND id != ? AND revoked_at IS NULL"
    ).bind(user.sub, user.jti || "").run();
    // Get revoked session IDs for broadcast
    const revokedSessions = await env.DB.prepare(
      "SELECT id FROM active_sessions WHERE user_id = ? AND revoked_at IS NOT NULL AND id != ?"
    ).bind(user.sub, user.jti || "").all();
    const sessionIds = (revokedSessions.results || []).map((s) => s.id);
    // Broadcast via UserRoom DO
    try {
      const roomId = env.USER_ROOMS.idFromName(`user:${user.sub}`);
      const room = env.USER_ROOMS.get(roomId);
      await room.fetch(new Request("https://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "session_revoked", sessionIds }),
      }));
    } catch (_) {}
    return jsonResponse({ ok: true, revoked_count: revoked.meta?.changes || 0 });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleLogoutAllDevices(env, user) {
  try {
    await env.DB.prepare(
      "UPDATE active_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL"
    ).bind(user.sub).run();
    // Broadcast to all connections
    try {
      const roomId = env.USER_ROOMS.idFromName(`user:${user.sub}`);
      const room = env.USER_ROOMS.get(roomId);
      await room.fetch(new Request("https://internal/broadcast", {
        method: "POST",
        body: JSON.stringify({ type: "session_revoked", sessionIds: ["*"] }),
      }));
    } catch (_) {}
    return jsonResponse({ ok: true }, 200, { "Set-Cookie": buildClearAuthCookie() });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Per-User State Handlers ───

async function handleGetUserState(env, user) {
  try {
    const row = await env.DB.prepare("SELECT * FROM user_state WHERE user_id = ?").bind(user.sub).first();
    if (row) {
      // Parse view_prefs JSON if present
      try { row.view_prefs = JSON.parse(row.view_prefs || "{}"); } catch { row.view_prefs = {}; }
    }
    return jsonResponse({ state: row || { user_id: user.sub, last_page: null, zen_tasks_table_id: null, view_prefs: {} } });
  } catch (err) {
    return jsonResponse({ state: { user_id: user.sub, last_page: null, zen_tasks_table_id: null, view_prefs: {} } });
  }
}

async function handlePutUserState(env, user, body) {
  try {
    const sets = ["updated_at = datetime('now')"];
    const binds = [];
    if (body.last_page !== undefined) { sets.push("last_page = ?"); binds.push(body.last_page); }
    if (body.zen_tasks_table_id !== undefined) { sets.push("zen_tasks_table_id = ?"); binds.push(body.zen_tasks_table_id); }
    if (body.view_prefs !== undefined) { sets.push("view_prefs = ?"); binds.push(JSON.stringify(body.view_prefs)); }

    // Upsert
    await env.DB.prepare(
      `INSERT INTO user_state (user_id, last_page, zen_tasks_table_id, view_prefs, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET ${sets.join(", ")}`
    ).bind(user.sub, body.last_page || null, body.zen_tasks_table_id || null, JSON.stringify(body.view_prefs || {}), ...binds).run();

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Per-User Dashboard Handlers ───

async function handleGetUserDashboard(env, user) {
  try {
    const row = await env.DB.prepare("SELECT * FROM user_dashboards WHERE user_id = ?").bind(user.sub).first();
    const widgets = row?.widgets ? JSON.parse(row.widgets) : [];
    return jsonResponse({ widgets, updated_at: row?.updated_at || null });
  } catch (err) {
    return jsonResponse({ widgets: [], updated_at: null });
  }
}

async function handlePutUserDashboard(env, user, body) {
  try {
    const widgetsJson = JSON.stringify(body.widgets || []);
    // Conflict detection: if client sends if_match (updated_at), check it
    if (body.if_match) {
      const existing = await env.DB.prepare(
        "SELECT updated_at FROM user_dashboards WHERE user_id = ?"
      ).bind(user.sub).first();
      if (existing && existing.updated_at > body.if_match) {
        const currentWidgets = await env.DB.prepare(
          "SELECT widgets FROM user_dashboards WHERE user_id = ?"
        ).bind(user.sub).first();
        return jsonResponse({
          _error: "Conflict: dashboard was updated on another device",
          conflict: true,
          server_widgets: currentWidgets?.widgets ? JSON.parse(currentWidgets.widgets) : [],
          server_updated_at: existing.updated_at,
        }, 409);
      }
    }
    await env.DB.prepare(
      `INSERT INTO user_dashboards (user_id, widgets, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET widgets = ?, updated_at = datetime('now')`
    ).bind(user.sub, widgetsJson, widgetsJson).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Record Views Handlers ───

async function handlePutRecordView(env, user, recordId) {
  try {
    await env.DB.prepare(
      `INSERT INTO record_views (user_id, record_id, last_viewed_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id, record_id) DO UPDATE SET last_viewed_at = datetime('now')`
    ).bind(user.sub, recordId).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleGetRecordViews(env, user, url) {
  try {
    const since = url.searchParams.get("since");
    let rows;
    if (since) {
      rows = await env.DB.prepare(
        "SELECT record_id, last_viewed_at FROM record_views WHERE user_id = ? AND last_viewed_at >= ?"
      ).bind(user.sub, since).all();
    } else {
      rows = await env.DB.prepare(
        "SELECT record_id, last_viewed_at FROM record_views WHERE user_id = ?"
      ).bind(user.sub).all();
    }
    return jsonResponse({ views: rows.results || [] });
  } catch (err) {
    return jsonResponse({ views: [] });
  }
}

// ─── PIN Lock Handlers ───

async function handleSetPin(env, body) {
  const { pin } = body || {};
  if (!pin || pin.length < 4) {
    return jsonResponse({ _error: "PIN must be at least 4 characters" }, 400);
  }
  try {
    const hashed = await hashPassword(pin);
    await env.DB.prepare(
      "INSERT OR REPLACE INTO connections (key, value, updated_at) VALUES ('table_pin', ?, datetime('now'))"
    ).bind(hashed).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleVerifyPin(env, body, user) {
  const { pin, page_id } = body || {};
  if (!pin) return jsonResponse({ _error: "PIN required" }, 400);
  try {
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'table_pin'").first();
    if (!row) return jsonResponse({ _error: "No PIN configured" }, 404);
    const valid = await verifyPassword(pin, row.value);
    if (!valid) return jsonResponse({ _error: "Incorrect PIN" }, 403);

    // Auto-migrate legacy PIN hash to PBKDF2
    if (!row.value.includes(":")) {
      const newHash = await hashPassword(pin);
      await env.DB.prepare(
        "UPDATE connections SET value = ?, updated_at = datetime('now') WHERE key = 'table_pin'"
      ).bind(newHash).run();
    }

    // Issue a server-side PIN session token (15 minute TTL)
    const pinToken = crypto.randomUUID();
    const userId = user?.sub || "anonymous";
    const pageId = page_id || "_global";
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    try {
      await env.DB.prepare(
        "INSERT INTO pin_sessions (token, user_id, page_id, expires_at) VALUES (?, ?, ?, ?)"
      ).bind(pinToken, userId, pageId, expiresAt).run();
    } catch (_) {}

    return jsonResponse({ ok: true, verified: true, pin_token: pinToken, expires_in: 900 });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Connections CRUD ───

async function handleGetConnections(env) {
  try {
    const rows = await env.DB.prepare(
      "SELECT key, value, metadata, updated_at FROM connections ORDER BY key"
    ).all();
    // Values included — endpoint is auth-protected by X-Wasabi-Key
    return jsonResponse({
      connections: rows.results.map((r) => ({
        key: r.key,
        value: r.value,
        metadata: JSON.parse(r.metadata || "{}"),
        updated_at: r.updated_at,
        connected: true,
      })),
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleSetConnection(env, body) {
  const { key, value, metadata } = body;
  if (!key || !value) {
    return jsonResponse({ _error: "Missing key or value" }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO connections (key, value, metadata, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, metadata = excluded.metadata, updated_at = datetime('now')`
    ).bind(key, value, JSON.stringify(metadata || {})).run();

    return jsonResponse({ ok: true, key });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleDeleteConnection(env, key) {
  if (!key) return jsonResponse({ _error: "Missing connection key" }, 400);

  try {
    await env.DB.prepare("DELETE FROM connections WHERE key = ?").bind(key).run();
    return jsonResponse({ ok: true, key });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Google OAuth & API Handlers ───

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

/**
 * Get a valid Google access token for a specific user.
 * Checks user_connections first, then falls back to global connections.
 * Returns { access_token, email } or null if not connected.
 */
async function getGoogleAccessTokenForUser(env, userId) {
  // No userId (MCP/API key access) — use global connection
  if (!userId) return getGoogleAccessToken(env);
  // Per-user: only use their own token, NEVER fall back to global
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM user_connections WHERE user_id = ? AND key = 'google'"
    ).bind(userId).first();
    if (!row?.value) return null; // User has no Google connection
    const tokens = JSON.parse(row.value);
    if (!tokens.access_token || !tokens.refresh_token) return null;
    // Check expiry
    if (tokens.expires_at && Date.now() < tokens.expires_at - 60000) return tokens;
    // Refresh
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: tokens.refresh_token, grant_type: "refresh_token" }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const updated = { ...tokens, access_token: data.access_token, expires_at: Date.now() + (data.expires_in || 3600) * 1000 };
    await env.DB.prepare(
      "INSERT OR REPLACE INTO user_connections (user_id, key, value, updated_at) VALUES (?, 'google', ?, datetime('now'))"
    ).bind(userId, JSON.stringify(updated)).run();
    return updated;
  } catch { return null; }
}

/**
 * Get a valid Google access token, refreshing if expired.
 * Returns { access_token, email } or null if not connected.
 */
async function getGoogleAccessToken(env) {
  let row;
  try {
    row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'google'").first();
  } catch { return null; }
  if (!row?.value) return null;

  const tokens = JSON.parse(row.value);
  if (!tokens.access_token || !tokens.refresh_token) return null;

  // Check if token is still valid (with 60s buffer)
  if (tokens.expires_at && Date.now() < tokens.expires_at - 60000) {
    return tokens;
  }

  // Refresh the token
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();

    const updated = {
      ...tokens,
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    };

    // Persist refreshed tokens
    await env.DB.prepare(
      `UPDATE connections SET value = ?, updated_at = datetime('now') WHERE key = 'google'`
    ).bind(JSON.stringify(updated)).run();

    return updated;
  } catch {
    return null;
  }
}

function handleGoogleAuthUrl(request, env, userId) {
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) return jsonResponse({ _error: "GOOGLE_CLIENT_ID not configured" }, 500);

  const workerUrl = new URL(request.url).origin;
  const redirectUri = `${workerUrl}/google/callback`;

  // Encode user ID in state so the callback can store tokens per-user
  const stateObj = { workerUrl, userId: userId || null };
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state: JSON.stringify(stateObj),
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  return jsonResponse({ url });
}

async function handleGoogleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(callbackHTML("error", error), {
      status: 400,
      headers: { ...CORS, "Content-Type": "text/html" },
    });
  }

  if (!code) {
    return new Response(callbackHTML("error", "No authorization code received"), {
      status: 400,
      headers: { ...CORS, "Content-Type": "text/html" },
    });
  }

  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response(callbackHTML("error", "Google OAuth not configured"), {
      status: 500,
      headers: { ...CORS, "Content-Type": "text/html" },
    });
  }

  const workerUrl = url.origin;
  const redirectUri = `${workerUrl}/google/callback`;

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return new Response(callbackHTML("error", `Token exchange failed: ${errText}`), {
        status: 502,
        headers: { ...CORS, "Content-Type": "text/html" },
      });
    }

    const tokenData = await tokenRes.json();

    // Fetch user email
    let email = "";
    try {
      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        email = userData.email || "";
      }
    } catch {}

    // Store tokens in D1
    const tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + (tokenData.expires_in || 3600) * 1000,
      email,
      scopes: GOOGLE_SCOPES,
    };

    // Extract user ID from OAuth state for per-user storage
    let stateUserId = null;
    const stateParam = url.searchParams.get("state");
    try {
      const stateObj = JSON.parse(stateParam);
      stateUserId = stateObj.userId || null;
    } catch { /* state may be plain URL from old flow */ }

    const tokensJson = JSON.stringify(tokens);

    if (stateUserId) {
      // Store per-user in user_connections — this is the primary storage
      await env.DB.prepare(
        `INSERT INTO user_connections (user_id, key, value, updated_at)
         VALUES (?, 'google', ?, datetime('now'))
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      ).bind(stateUserId, tokensJson).run();
    } else {
      // No user context (shouldn't happen from UI, but handle MCP/direct access)
      await env.DB.prepare(
        `INSERT INTO connections (key, value, metadata, updated_at)
         VALUES ('google', ?, '{}', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      ).bind(tokensJson).run();
    }

    return new Response(callbackHTML("success", email), {
      status: 200,
      headers: { ...CORS, "Content-Type": "text/html" },
    });
  } catch (err) {
    return new Response(callbackHTML("error", err.message), {
      status: 500,
      headers: { ...CORS, "Content-Type": "text/html" },
    });
  }
}

/** Generate HTML for the OAuth callback popup page. */
function callbackHTML(status, detail) {
  const isSuccess = status === "success";
  return `<!DOCTYPE html><html><head><title>Wasabi - Google Auth</title>
<style>body{font-family:system-ui;background:#080809;color:#F2F2F3;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{text-align:center;padding:40px;border-radius:12px;background:#101012;border:1px solid #242428}
.icon{font-size:48px;margin-bottom:16px}
.msg{font-size:14px;color:#4E4E58;margin-top:8px}</style></head>
<body><div class="card">
<div class="icon">${isSuccess ? "&#10003;" : "&#10007;"}</div>
<h2>${isSuccess ? "Connected!" : "Connection Failed"}</h2>
<p class="msg">${isSuccess ? `Signed in as ${detail}` : detail}</p>
<p class="msg">You can close this window.</p>
</div>
<script>
try{window.opener&&window.opener.postMessage({type:"google-oauth-${status}",detail:"${detail}"},"*")}catch(e){}
setTimeout(function(){window.close()},3000);
</script></body></html>`;
}

async function handleGoogleStatus(env, userId) {
  try {
    // Per-user: only show their own connection
    if (userId) {
      const userRow = await env.DB.prepare(
        "SELECT value FROM user_connections WHERE user_id = ? AND key = 'google'"
      ).bind(userId).first();
      if (!userRow?.value) return jsonResponse({ connected: false });
      const tokens = JSON.parse(userRow.value);
      return jsonResponse({ connected: true, email: tokens.email || "", scopes: tokens.scopes || "" });
    }
    // No userId (MCP/API key access) — check global
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'google'").first();
    if (!row?.value) return jsonResponse({ connected: false });
    const tokens = JSON.parse(row.value);
    return jsonResponse({ connected: true, email: tokens.email || "", scopes: tokens.scopes || "" });
  } catch (err) {
    return jsonResponse({ connected: false, error: err.message });
  }
}

async function handleGoogleDisconnect(env, userId) {
  try {
    // Per-user: only disconnect their own token
    if (userId) {
      const userRow = await env.DB.prepare(
        "SELECT value FROM user_connections WHERE user_id = ? AND key = 'google'"
      ).bind(userId).first();
      if (userRow?.value) {
        const tokens = JSON.parse(userRow.value);
        if (tokens.access_token) {
          await fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.access_token}`, { method: "POST" }).catch(() => {});
        }
        await env.DB.prepare("DELETE FROM user_connections WHERE user_id = ? AND key = 'google'").bind(userId).run();
      }
      // Always return ok — user is now disconnected (even if they had no token)
      return jsonResponse({ ok: true });
    }
    // No userId (MCP/API key access) — disconnect global
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'google'").first();
    if (row?.value) {
      const tokens = JSON.parse(row.value);
      if (tokens.access_token) {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.access_token}`, { method: "POST" }).catch(() => {});
      }
    }
    await env.DB.prepare("DELETE FROM connections WHERE key = 'google'").run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Gmail API Proxy Handlers ───

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

async function handleGmailSummary(env, userId) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  try {
    // Get unread count
    const unreadRes = await fetch(`${GMAIL_API}/messages?q=is:unread+in:inbox&maxResults=1`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const unreadData = await unreadRes.json();
    const unread = unreadData.resultSizeEstimate || 0;

    // Get recent messages (just headers)
    const recentRes = await fetch(`${GMAIL_API}/messages?maxResults=5&labelIds=INBOX`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const recentData = await recentRes.json();
    const messages = recentData.messages || [];

    // Fetch headers for each recent message
    const recent = await Promise.all(
      messages.slice(0, 5).map(async (m) => {
        try {
          const msgRes = await fetch(`${GMAIL_API}/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          });
          const msg = await msgRes.json();
          const headers = msg.payload?.headers || [];
          return {
            id: m.id,
            threadId: m.threadId,
            subject: headers.find((h) => h.name === "Subject")?.value || "(no subject)",
            from: headers.find((h) => h.name === "From")?.value || "",
            date: headers.find((h) => h.name === "Date")?.value || "",
            snippet: msg.snippet || "",
            labelIds: msg.labelIds || [],
          };
        } catch { return null; }
      })
    );

    return jsonResponse({ unread, recent: recent.filter(Boolean) });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleGmailSearch(env, body, userId) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  const { q, maxResults = 20, labelIds } = body;
  try {
    let url = `${GMAIL_API}/messages?maxResults=${maxResults}`;
    if (q) url += `&q=${encodeURIComponent(q)}`;
    if (labelIds) url += `&labelIds=${encodeURIComponent(labelIds)}`;

    const listRes = await fetch(url, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const listData = await listRes.json();
    const messageIds = listData.messages || [];

    // Fetch metadata for each message
    const messages = await Promise.all(
      messageIds.slice(0, maxResults).map(async (m) => {
        try {
          const msgRes = await fetch(`${GMAIL_API}/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          });
          const msg = await msgRes.json();
          const headers = msg.payload?.headers || [];
          return {
            id: m.id,
            threadId: m.threadId,
            subject: headers.find((h) => h.name === "Subject")?.value || "(no subject)",
            from: headers.find((h) => h.name === "From")?.value || "",
            to: headers.find((h) => h.name === "To")?.value || "",
            date: headers.find((h) => h.name === "Date")?.value || "",
            snippet: msg.snippet || "",
            labelIds: msg.labelIds || [],
          };
        } catch { return null; }
      })
    );

    return jsonResponse({
      messages: messages.filter(Boolean),
      resultSizeEstimate: listData.resultSizeEstimate || 0,
      nextPageToken: listData.nextPageToken || null,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleGmailGetMessage(env, messageId, userId) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  try {
    const res = await fetch(`${GMAIL_API}/messages/${messageId}?format=full`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Gmail API error: ${errText}` }, res.status);
    }
    const msg = await res.json();

    // Extract body
    let body = "";
    let htmlBody = "";
    function extractBody(part) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        body = atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
      } else if (part.mimeType === "text/html" && part.body?.data) {
        htmlBody = atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
      }
      if (part.parts) part.parts.forEach(extractBody);
    }
    if (msg.payload) extractBody(msg.payload);

    const headers = msg.payload?.headers || [];
    return jsonResponse({
      id: msg.id,
      threadId: msg.threadId,
      messageId: headers.find((h) => h.name === "Message-ID" || h.name === "Message-Id")?.value || "",
      subject: headers.find((h) => h.name === "Subject")?.value || "",
      from: headers.find((h) => h.name === "From")?.value || "",
      to: headers.find((h) => h.name === "To")?.value || "",
      cc: headers.find((h) => h.name === "Cc")?.value || "",
      date: headers.find((h) => h.name === "Date")?.value || "",
      body,
      htmlBody,
      snippet: msg.snippet || "",
      labelIds: msg.labelIds || [],
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleGmailGetThread(env, threadId, userId) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  try {
    const res = await fetch(`${GMAIL_API}/threads/${threadId}?format=full`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Gmail API error: ${errText}` }, res.status);
    }
    const thread = await res.json();

    const messages = (thread.messages || []).map((msg) => {
      let body = "";
      let htmlBody = "";
      function extractBody(part) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          body = atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
        } else if (part.mimeType === "text/html" && part.body?.data) {
          htmlBody = atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
        }
        if (part.parts) part.parts.forEach(extractBody);
      }
      if (msg.payload) extractBody(msg.payload);

      const headers = msg.payload?.headers || [];
      return {
        id: msg.id,
        threadId: msg.threadId,
        messageId: headers.find((h) => h.name === "Message-ID" || h.name === "Message-Id")?.value || "",
        subject: headers.find((h) => h.name === "Subject")?.value || "",
        from: headers.find((h) => h.name === "From")?.value || "",
        to: headers.find((h) => h.name === "To")?.value || "",
        cc: headers.find((h) => h.name === "Cc")?.value || "",
        date: headers.find((h) => h.name === "Date")?.value || "",
        references: headers.find((h) => h.name === "References")?.value || "",
        body,
        htmlBody,
        snippet: msg.snippet || "",
        labelIds: msg.labelIds || [],
      };
    });

    return jsonResponse({ threadId: thread.id, messages });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleGmailUpdateDraft(env, draftId, body, userId) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  const { to, subject, bodyText, threadId } = body;
  if (!bodyText && !to && !subject) return jsonResponse({ _error: "Nothing to update" }, 400);

  try {
    const lines = [
      to ? `To: ${to}` : "",
      `Subject: ${subject || ""}`,
      `Content-Type: text/plain; charset=utf-8`,
      "",
      bodyText || "",
    ].filter((l, i) => i >= 3 || l);

    const raw = btoa(unescape(encodeURIComponent(lines.join("\r\n"))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const payload = { message: { raw } };
    if (threadId) payload.message.threadId = threadId;

    const res = await fetch(`${GMAIL_API}/drafts/${draftId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: draftId, ...payload }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Draft update failed: ${errText}` }, res.status);
    }
    const result = await res.json();
    return jsonResponse({ ok: true, id: result.id });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleGmailSend(env, body, userId) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  const { to, subject, bodyText, threadId, inReplyTo, references } = body;
  if (!to || !bodyText) return jsonResponse({ _error: "Missing 'to' or 'bodyText'" }, 400);

  try {
    // Build RFC 2822 message
    const lines = [
      `To: ${to}`,
      `Subject: ${subject || "(no subject)"}`,
      `Content-Type: text/plain; charset=utf-8`,
    ];
    if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
    if (references) lines.push(`References: ${references}`);
    lines.push("", bodyText);

    const raw = btoa(unescape(encodeURIComponent(lines.join("\r\n"))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const payload = { raw };
    if (threadId) payload.threadId = threadId;

    const res = await fetch(`${GMAIL_API}/messages/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Send failed: ${errText}` }, res.status);
    }
    const result = await res.json();
    return jsonResponse({ ok: true, id: result.id, threadId: result.threadId });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleGmailCreateDraft(env, body, userId) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  const { to, subject, bodyText } = body;
  if (!bodyText) return jsonResponse({ _error: "Missing 'bodyText'" }, 400);

  try {
    const lines = [
      to ? `To: ${to}` : "",
      `Subject: ${subject || ""}`,
      `Content-Type: text/plain; charset=utf-8`,
      "",
      bodyText,
    ].filter(Boolean);

    const raw = btoa(unescape(encodeURIComponent(lines.join("\r\n"))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const res = await fetch(`${GMAIL_API}/drafts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: { raw } }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Draft creation failed: ${errText}` }, res.status);
    }
    const result = await res.json();
    return jsonResponse({ ok: true, id: result.id, messageId: result.message?.id });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleGmailModify(env, messageId, body, userId) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  const { action, addLabelIds, removeLabelIds } = body;

  // Map friendly actions to label modifications
  let add = addLabelIds || [];
  let remove = removeLabelIds || [];
  if (action === "archive") remove = [...remove, "INBOX"];
  else if (action === "trash") add = [...add, "TRASH"];
  else if (action === "star") add = [...add, "STARRED"];
  else if (action === "unstar") remove = [...remove, "STARRED"];
  else if (action === "mark_read") remove = [...remove, "UNREAD"];
  else if (action === "mark_unread") add = [...add, "UNREAD"];

  try {
    const res = await fetch(`${GMAIL_API}/messages/${messageId}/modify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Modify failed: ${errText}` }, res.status);
    }
    const result = await res.json();
    return jsonResponse({ ok: true, id: result.id, labelIds: result.labelIds });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Calendar API Proxy Handlers ───

const GCAL_API = "https://www.googleapis.com/calendar/v3";

async function handleCalendarSummary(env, userId) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  try {
    const now = new Date().toISOString();
    const endOfDay = new Date();
    endOfDay.setDate(endOfDay.getDate() + 2);

    const res = await fetch(
      `${GCAL_API}/calendars/primary/events?timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(endOfDay.toISOString())}&maxResults=5&singleEvents=true&orderBy=startTime`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Calendar API error: ${errText}` }, res.status);
    }
    const data = await res.json();
    const upcoming = (data.items || []).map((e) => ({
      id: e.id,
      summary: e.summary || "(no title)",
      start: e.start?.dateTime || e.start?.date || "",
      end: e.end?.dateTime || e.end?.date || "",
      location: e.location || "",
      status: e.status,
    }));
    return jsonResponse({ upcoming });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleCalendarList(env, userId) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  try {
    const res = await fetch(`${GCAL_API}/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Calendar list error: ${errText}` }, res.status);
    }
    const data = await res.json();
    const calendars = (data.items || []).map((c) => ({
      id: c.id,
      summary: c.summary || c.id,
      backgroundColor: c.backgroundColor || "#4285f4",
      foregroundColor: c.foregroundColor || "#ffffff",
      primary: !!c.primary,
      selected: c.selected !== false,
      accessRole: c.accessRole || "reader",
    }));
    return jsonResponse({ calendars });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleCalendarListEvents(env, params, userId) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  try {
    // Step 1: Fetch all calendars
    const calListRes = await fetch(`${GCAL_API}/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    let calendars = [];
    if (calListRes.ok) {
      const calData = await calListRes.json();
      calendars = (calData.items || [])
        .filter((c) => c.selected !== false)
        .map((c) => ({
          id: c.id,
          summary: c.summary || c.id,
          backgroundColor: c.backgroundColor || "#4285f4",
          primary: !!c.primary,
        }));
    }
    // Fallback: if calendar list fails, just use primary
    if (calendars.length === 0) {
      calendars = [{ id: "primary", summary: "Primary", backgroundColor: "#4285f4", primary: true }];
    }

    // Step 2: Fetch events from all calendars in parallel
    const qs = new URLSearchParams();
    if (params.timeMin) qs.set("timeMin", params.timeMin);
    if (params.timeMax) qs.set("timeMax", params.timeMax);
    qs.set("maxResults", params.maxResults || "50");
    qs.set("singleEvents", "true");
    qs.set("orderBy", "startTime");

    const eventPromises = calendars.map(async (cal) => {
      try {
        const res = await fetch(`${GCAL_API}/calendars/${encodeURIComponent(cal.id)}/events?${qs}`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.items || []).map((e) => ({
          id: e.id,
          summary: e.summary || "",
          description: e.description || "",
          start: e.start || {},
          end: e.end || {},
          location: e.location || "",
          status: e.status,
          attendees: (e.attendees || []).map((a) => ({ email: a.email, responseStatus: a.responseStatus })),
          htmlLink: e.htmlLink || "",
          calendarId: cal.id,
          calendarColor: cal.backgroundColor,
          calendarName: cal.summary,
        }));
      } catch {
        return [];
      }
    });

    const results = await Promise.all(eventPromises);
    const allEvents = results.flat();

    // Step 3: Sort by start time
    allEvents.sort((a, b) => {
      const aTime = a.start?.dateTime || a.start?.date || "";
      const bTime = b.start?.dateTime || b.start?.date || "";
      return aTime.localeCompare(bTime);
    });

    return jsonResponse({ events: allEvents, calendars });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleCalendarCreateEvent(env, body, userId) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  const { summary, description, start, end, location, attendees } = body;
  if (!summary || !start || !end) return jsonResponse({ _error: "Missing summary, start, or end" }, 400);

  try {
    const event = {
      summary,
      description: description || "",
      location: location || "",
      start: start.includes("T") ? { dateTime: start } : { date: start },
      end: end.includes("T") ? { dateTime: end } : { date: end },
    };
    if (attendees?.length) {
      event.attendees = attendees.map((email) => (typeof email === "string" ? { email } : email));
    }

    const res = await fetch(`${GCAL_API}/calendars/primary/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Create event failed: ${errText}` }, res.status);
    }
    const result = await res.json();
    return jsonResponse({
      ok: true,
      id: result.id,
      summary: result.summary,
      start: result.start?.dateTime || result.start?.date,
      htmlLink: result.htmlLink,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleCalendarUpdateEvent(env, eventId, body, userId) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  try {
    const update = {};
    if (body.summary !== undefined) update.summary = body.summary;
    if (body.description !== undefined) update.description = body.description;
    if (body.location !== undefined) update.location = body.location;
    if (body.start) update.start = body.start.includes("T") ? { dateTime: body.start } : { date: body.start };
    if (body.end) update.end = body.end.includes("T") ? { dateTime: body.end } : { date: body.end };
    if (body.attendees) update.attendees = body.attendees.map((e) => (typeof e === "string" ? { email: e } : e));

    const res = await fetch(`${GCAL_API}/calendars/primary/events/${eventId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(update),
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Update event failed: ${errText}` }, res.status);
    }
    const result = await res.json();
    return jsonResponse({ ok: true, id: result.id, summary: result.summary });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleCalendarDeleteEvent(env, eventId, userId) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  try {
    const res = await fetch(`${GCAL_API}/calendars/primary/events/${eventId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!res.ok && res.status !== 204) {
      const errText = await res.text();
      return jsonResponse({ _error: `Delete event failed: ${errText}` }, res.status);
    }
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleCalendarFreeBusy(env, body, userId) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  const { timeMin, timeMax } = body;
  if (!timeMin || !timeMax) return jsonResponse({ _error: "Missing timeMin or timeMax" }, 400);

  try {
    const res = await fetch(`${GCAL_API}/freeBusy`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin,
        timeMax,
        items: [{ id: "primary" }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `FreeBusy query failed: ${errText}` }, res.status);
    }
    const data = await res.json();
    const busy = data.calendars?.primary?.busy || [];
    return jsonResponse({ busy });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Page Config Handlers ───

async function handleListPages(env, user) {
  try {
    // All authenticated users see all pages in the shared workspace.
    // Page-level write permissions are enforced at mutation endpoints (update/delete).
    const rows = await env.DB.prepare(
      "SELECT * FROM page_configs ORDER BY sort_order, created_at"
    ).all();
    // Parse JSON config for each page
    const pages = (rows.results || []).map((r) => ({
      ...r,
      config: JSON.parse(r.config || "{}"),
    }));
    return jsonResponse({ pages });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleCreatePage(env, body, user) {
  const { title, icon, page_type, parent_id, sort_order, config, columns } = body;
  if (!title || !page_type) {
    return jsonResponse({ _error: "Missing title or page_type" }, 400);
  }

  const id = body.id || crypto.randomUUID();

  try {
    await env.DB.prepare(
      `INSERT INTO page_configs (id, parent_id, title, icon, page_type, sort_order, config, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(
      id,
      parent_id || null,
      title,
      icon || "",
      page_type,
      sort_order || 0,
      JSON.stringify(config || {}),
      user?.sub || null
    ).run();

    // Auto-assign owner permission to creator
    if (user?.sub) {
      try {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO page_permissions (page_id, user_id, permission, granted_by) VALUES (?, ?, 'owner', ?)"
        ).bind(id, user.sub, user.sub).run();
      } catch (_) {}
    }

    // If this is a standalone database, create the table schema
    if (page_type === "database" && columns) {
      // Auto-append system timestamp columns if not present
      const hasLastUpdated = columns.some((c) => c.type === "last_edited_time" || c.id === "_last_edited_time");
      if (!hasLastUpdated) {
        columns.push({ id: "_last_edited_time", name: "Last Updated", type: "last_edited_time", system: true });
      }
      const hasCreated = columns.some((c) => c.type === "created_time" || c.id === "_created_time");
      if (!hasCreated) {
        columns.push({ id: "_created_time", name: "Created", type: "created_time", system: true });
      }

      await env.DB.prepare(
        `INSERT INTO table_schemas (id, columns, created_at, updated_at)
         VALUES (?, ?, datetime('now'), datetime('now'))`
      ).bind(id, JSON.stringify(columns)).run();
    }

    // If this is a sheet, initialize sheet_data
    if (page_type === "sheet") {
      const colCount = body.col_count || 26;
      const rowCount = body.row_count || 100;
      await env.DB.prepare(
        `INSERT INTO sheet_data (id, col_count, row_count, cells, col_widths, created_at, updated_at)
         VALUES (?, ?, ?, '{}', '{}', datetime('now'), datetime('now'))`
      ).bind(id, colCount, rowCount).run();
    }

    // If this is a standalone document, initialize document metadata + R2 content
    if (page_type === "document" && !config?.notionPageId) {
      const r2Key = `docs/${id}.json`;
      const initialContent = { version: 1, blocks: [] };
      await env.DOCS.put(r2Key, JSON.stringify(initialContent), {
        httpMetadata: { contentType: "application/json" },
      });
      await env.DB.prepare(
        `INSERT INTO documents (id, r2_key, version, word_count, created_at, updated_at)
         VALUES (?, ?, 1, 0, datetime('now'), datetime('now'))`
      ).bind(id, r2Key).run();
    }

    // Auto-bootstrap sync for linked_notion pages — populate D1 schema + rows
    if (page_type === "linked_notion") {
      const dbIds = config?.databaseIds || [];
      if (dbIds.length > 0) {
        try {
          const notionKey = await getNotionKeyFromDB(env);
          if (notionKey) {
            const configBody = { notion_db_id: dbIds[0], direction: "bidirectional" };
            await handleSyncConfigure(env, id, configBody, notionKey);
            await handleSyncPull(env, id, notionKey, true);
          }
        } catch (err) {
          console.error(`Auto-bootstrap sync failed for page ${id}:`, err.message);
          // Non-fatal — page is created, sync can be retried later
        }
      }
    }

    return jsonResponse({ ok: true, id }, 201);
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleGetSummaryCache(env, pageId) {
  try {
    const row = await env.DB.prepare(
      "SELECT summary, updated_at FROM data_summary_cache WHERE page_id = ?"
    ).bind(pageId).first();
    if (!row) return jsonResponse({ cached: false, summary: null });
    return jsonResponse({ cached: true, summary: row.summary, updated_at: row.updated_at });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleSetSummaryCache(env, pageId, body) {
  try {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO data_summary_cache (page_id, summary, updated_at) VALUES (?, ?, datetime('now'))"
    ).bind(pageId, body.summary || "").run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleGetPage(env, id) {
  try {
    const row = await env.DB.prepare("SELECT * FROM page_configs WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ _error: "Page not found" }, 404);
    return jsonResponse({ ...row, config: JSON.parse(row.config || "{}") });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUpdatePage(env, id, body) {
  const sets = [];
  const binds = [];

  if (body.title !== undefined) { sets.push("title = ?"); binds.push(body.title); }
  if (body.icon !== undefined) { sets.push("icon = ?"); binds.push(body.icon); }
  if (body.parent_id !== undefined) { sets.push("parent_id = ?"); binds.push(body.parent_id); }
  if (body.page_type !== undefined) { sets.push("page_type = ?"); binds.push(body.page_type); }
  if (body.sort_order !== undefined) { sets.push("sort_order = ?"); binds.push(body.sort_order); }
  if (body.config !== undefined) { sets.push("config = ?"); binds.push(JSON.stringify(body.config)); }
  if (body.pin_protected !== undefined) { sets.push("pin_protected = ?"); binds.push(body.pin_protected ? 1 : 0); }

  if (sets.length === 0) return jsonResponse({ _error: "No fields to update" }, 400);

  sets.push("updated_at = datetime('now')");
  binds.push(id);

  try {
    await env.DB.prepare(
      `UPDATE page_configs SET ${sets.join(", ")} WHERE id = ?`
    ).bind(...binds).run();

    // If columns are provided, upsert the table schema (allows fixing pages that were created without columns)
    if (body.columns && Array.isArray(body.columns)) {
      const cols = body.columns;
      const hasLastUpdated = cols.some((c) => c.type === "last_edited_time" || c.id === "_last_edited_time");
      if (!hasLastUpdated) cols.push({ id: "_last_edited_time", name: "Last Updated", type: "last_edited_time", system: true });
      const hasCreated = cols.some((c) => c.type === "created_time" || c.id === "_created_time");
      if (!hasCreated) cols.push({ id: "_created_time", name: "Created", type: "created_time", system: true });
      await env.DB.prepare(
        `INSERT INTO table_schemas (id, columns, created_at, updated_at)
         VALUES (?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET columns = excluded.columns, updated_at = datetime('now')`
      ).bind(id, JSON.stringify(cols)).run();
    }

    return jsonResponse({ ok: true, id });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleReorderPages(env, body) {
  // body.items: [{ id, sort_order, parent_id? }]
  const items = body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return jsonResponse({ _error: "items array required" }, 400);
  }
  try {
    const stmts = items.map((item) => {
      if (item.parent_id !== undefined) {
        return env.DB.prepare(
          "UPDATE page_configs SET sort_order = ?, parent_id = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(item.sort_order ?? 0, item.parent_id, item.id);
      }
      return env.DB.prepare(
        "UPDATE page_configs SET sort_order = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(item.sort_order ?? 0, item.id);
    });
    await env.DB.batch(stmts);
    return jsonResponse({ ok: true, updated: items.length });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleDeletePage(env, id) {
  try {
    // Collect all IDs to delete (the page itself + any children)
    const children = await env.DB.prepare(
      "SELECT id FROM page_configs WHERE parent_id = ?"
    ).bind(id).all();
    const allIds = [id, ...(children.results || []).map((r) => r.id)];

    for (const pid of allIds) {
      // Remove table schema
      await env.DB.prepare("DELETE FROM table_schemas WHERE id = ?").bind(pid).run();
      // Remove table rows
      await env.DB.prepare("DELETE FROM table_rows WHERE table_id = ?").bind(pid).run();
      // Remove sheet data
      await env.DB.prepare("DELETE FROM sheet_data WHERE id = ?").bind(pid).run();
      // Remove sync configs
      await env.DB.prepare("DELETE FROM sync_configs WHERE table_id = ?").bind(pid).run();
      // Remove cell links (source or target)
      await env.DB.prepare(
        "DELETE FROM cell_links WHERE source_page_id = ? OR target_page_id = ?"
      ).bind(pid, pid).run();
      // Remove automation rules scoped to this page
      await env.DB.prepare(
        "DELETE FROM automation_rules WHERE scope_table_id = ?"
      ).bind(pid).run();
      // Remove document metadata + R2 content
      const docMeta = await env.DB.prepare(
        "SELECT r2_key FROM documents WHERE id = ?"
      ).bind(pid).first();
      if (docMeta?.r2_key) {
        try { await env.DOCS.delete(docMeta.r2_key); } catch {}
      }
      await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(pid).run();
    }

    // Remove child page configs
    await env.DB.prepare("DELETE FROM page_configs WHERE parent_id = ?").bind(id).run();
    // Remove the page config itself
    await env.DB.prepare("DELETE FROM page_configs WHERE id = ?").bind(id).run();

    return jsonResponse({ ok: true, id, deleted_children: allIds.length - 1 });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Table Schema Handlers ───

async function handleGetSchema(env, id) {
  try {
    const row = await env.DB.prepare("SELECT * FROM table_schemas WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ _error: "Schema not found" }, 404);
    return jsonResponse({ ...row, columns: JSON.parse(row.columns), sub_columns: JSON.parse(row.sub_columns || "[]") });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUpdateSchema(env, id, body) {
  if (!body.columns && !body.sub_columns) return jsonResponse({ _error: "Missing columns or sub_columns" }, 400);

  try {
    if (body.columns && body.sub_columns) {
      await env.DB.prepare(
        `INSERT INTO table_schemas (id, columns, sub_columns, created_at, updated_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET columns = excluded.columns, sub_columns = excluded.sub_columns, updated_at = datetime('now')`
      ).bind(id, JSON.stringify(body.columns), JSON.stringify(body.sub_columns)).run();
    } else if (body.columns) {
      await env.DB.prepare(
        `INSERT INTO table_schemas (id, columns, created_at, updated_at)
         VALUES (?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET columns = excluded.columns, updated_at = datetime('now')`
      ).bind(id, JSON.stringify(body.columns)).run();
    } else {
      await env.DB.prepare(
        `UPDATE table_schemas SET sub_columns = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(JSON.stringify(body.sub_columns), id).run();
    }
    return jsonResponse({ ok: true, id });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Table Row Handlers ───

async function checkCircularReference(db, tableId, rowId, proposedParentId) {
  let currentId = proposedParentId;
  const visited = new Set();
  while (currentId) {
    if (currentId === rowId) return true;
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    const row = await db.prepare(
      "SELECT parent_row_id FROM table_rows WHERE id = ? AND table_id = ?"
    ).bind(currentId, tableId).first();
    currentId = row?.parent_row_id;
  }
  return false;
}

async function handleListRows(env, tableId, url) {
  const limit = Math.min(parseInt(url.searchParams.get("limit")) || 100, 10000);
  const offset = parseInt(url.searchParams.get("offset")) || 0;
  const includeArchived = url.searchParams.get("archived") === "true";
  const parentRowId = url.searchParams.get("parent_row_id");

  try {
    let sql = "SELECT * FROM table_rows WHERE table_id = ?";
    const binds = [tableId];
    if (!includeArchived) sql += " AND archived = 0";
    if (parentRowId !== null && parentRowId !== undefined) {
      if (parentRowId === "null" || parentRowId === "") {
        sql += " AND parent_row_id IS NULL";
      } else {
        sql += " AND parent_row_id = ?";
        binds.push(parentRowId);
      }
    }
    sql += " ORDER BY sort_order, created_at";
    sql += ` LIMIT ${limit} OFFSET ${offset}`;

    const rows = await env.DB.prepare(sql).bind(...binds).all();

    const parsed = rows.results.map((r) => ({
      ...r,
      cells: JSON.parse(r.cells || "{}"),
      cell_versions: JSON.parse(r.cell_versions || "{}"),
      metadata: JSON.parse(r.metadata || "{}"),
    }));

    return jsonResponse({ rows: parsed, has_more: rows.results.length === limit });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleCreateRows(env, tableId, body, user) {
  const rows = Array.isArray(body.rows) ? body.rows : [body];
  const created = [];
  const ownerId = user?.sub ? JSON.stringify([user.sub]) : "default";

  try {
    for (const row of rows) {
      const id = row.id || crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO table_rows (id, table_id, cells, sort_order, metadata, sync_dirty, owner_user_id, parent_row_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now'), datetime('now'))`
      ).bind(
        id,
        tableId,
        JSON.stringify(row.cells || {}),
        row.sort_order || 0,
        JSON.stringify(row.metadata || {}),
        ownerId,
        row.parent_row_id || null
      ).run();
      created.push(id);
    }

    // Invalidate data summary cache for this table's pages
    invalidateSummaryCache(env, tableId).catch(() => {});

    return jsonResponse({ ok: true, ids: created }, 201);
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUpdateRow(env, tableId, rowId, body, user) {
  const sets = [];
  const binds = [];

  try {
    // Read existing row for merge, automation triggers, and conflict detection
    const existing = await env.DB.prepare(
      "SELECT cells, cell_versions, metadata, owner_user_id FROM table_rows WHERE id = ? AND table_id = ?"
    ).bind(rowId, tableId).first();
    const oldCells = existing ? JSON.parse(existing.cells || "{}") : {};
    const currentVersions = existing ? JSON.parse(existing.cell_versions || "{}") : {};

    // ── Circular reference check for parent_row_id ──
    if (body.parent_row_id) {
      if (body.parent_row_id === rowId) {
        return jsonResponse({ _error: "A record cannot be its own parent" }, 400);
      }
      const isCircular = await checkCircularReference(env.DB, tableId, rowId, body.parent_row_id);
      if (isCircular) {
        return jsonResponse({ _error: "Circular reference: this record is an ancestor of the target parent" }, 400);
      }
    }

    let newCells = oldCells;
    let conflicts = null;

    if (body.cells !== undefined) {
      const incomingCells = body.cells;
      const baseVersions = body.base_versions; // sent by collaboration-aware clients

      if (baseVersions) {
        // ── Field-level conflict detection ──
        const accepted = {};
        const rejected = {};
        const newVersions = { ...currentVersions };

        for (const [field, value] of Object.entries(incomingCells)) {
          const currentV = currentVersions[field] || 0;
          const baseV = baseVersions[field];

          if (baseV === undefined || baseV >= currentV) {
            // Accept: base version is current or field is new
            accepted[field] = value;
            newVersions[field] = currentV + 1;
          } else {
            // Conflict: base version is stale — another user changed this field
            rejected[field] = {
              yourValue: value,
              currentValue: oldCells[field],
              currentVersion: currentV,
            };
          }
        }

        if (Object.keys(rejected).length) conflicts = rejected;

        if (Object.keys(accepted).length) {
          newCells = { ...oldCells, ...accepted };
          sets.push("cells = ?"); binds.push(JSON.stringify(newCells));
          sets.push("cell_versions = ?"); binds.push(JSON.stringify(newVersions));
        }
      } else {
        // ── Legacy path: no base_versions sent, accept unconditionally ──
        if (body.merge_cells) {
          newCells = { ...oldCells, ...incomingCells };
        } else {
          newCells = incomingCells;
        }
        sets.push("cells = ?"); binds.push(JSON.stringify(newCells));

        // Bump versions for all changed fields
        const newVersions = { ...currentVersions };
        for (const field of Object.keys(incomingCells)) {
          newVersions[field] = (currentVersions[field] || 0) + 1;
        }
        sets.push("cell_versions = ?"); binds.push(JSON.stringify(newVersions));
      }
    }
    if (body.sort_order !== undefined) { sets.push("sort_order = ?"); binds.push(body.sort_order); }
    if (body.parent_row_id !== undefined) { sets.push("parent_row_id = ?"); binds.push(body.parent_row_id); }
    if (body.archived !== undefined) { sets.push("archived = ?"); binds.push(body.archived ? 1 : 0); }
    if (body.metadata !== undefined) { sets.push("metadata = ?"); binds.push(JSON.stringify(body.metadata)); }
    if (body.owner_user_id !== undefined) {
      // Accepts string, array, or null — stored as JSON array string
      const ownerVal = body.owner_user_id;
      if (ownerVal === null || ownerVal === "unassigned") {
        sets.push("owner_user_id = ?"); binds.push("unassigned");
      } else if (Array.isArray(ownerVal)) {
        sets.push("owner_user_id = ?"); binds.push(JSON.stringify(ownerVal));
      } else {
        sets.push("owner_user_id = ?"); binds.push(JSON.stringify([ownerVal]));
      }
    }

    if (sets.length === 0 && !conflicts) return jsonResponse({ _error: "No fields to update" }, 400);
    // If everything was conflicted (nothing accepted), return conflicts without writing
    if (sets.length === 0 && conflicts) {
      return jsonResponse({ ok: false, conflicts, cell_versions: currentVersions });
    }

    // Track who made this change
    if (user?.sub) { sets.push("updated_by = ?"); binds.push(user.sub); }

    // Mark row dirty for Notion sync (skip if this is a sync-originated update)
    if (!body._fromSync) {
      sets.push("sync_dirty = 1");
    }
    sets.push("updated_at = datetime('now')");
    binds.push(rowId, tableId);

    await env.DB.prepare(
      `UPDATE table_rows SET ${sets.join(", ")} WHERE id = ? AND table_id = ?`
    ).bind(...binds).run();

    // Invalidate data summary cache
    invalidateSummaryCache(env, tableId).catch(() => {});

    // Event-driven automation triggers (non-blocking)
    if (body.cells !== undefined && !body._fromSync) {
      checkAutomationTriggers(env, tableId, rowId, oldCells, newCells).catch((err) =>
        console.error("[AutoTrigger] Error:", err.message)
      );
    }

    // ── Resolve page name for enriched notifications (non-blocking) ──
    let _notifPageName = "";
    if ((body.cells !== undefined || body.owner_user_id !== undefined) && user) {
      try {
        const pc = await env.DB.prepare("SELECT name FROM page_configs WHERE id = ?").bind(tableId).first();
        _notifPageName = pc?.name || "";
      } catch (_) {}
    }

    // ── Status change notifications (non-blocking) ──
    if (body.cells !== undefined && !body._fromSync && user) {
      (async () => {
        try {
          const statusFields = ["status", "Status", "stage", "Stage", "state", "State", "phase", "Phase"];
          for (const field of statusFields) {
            if (newCells[field] !== undefined && oldCells[field] !== undefined && newCells[field] !== oldCells[field]) {
              const title = await resolveRecordTitle(env, tableId, newCells) || "Record";
              const actorName = user.name || "Someone";
              const ownerUserIds = existing?.owner_user_id;
              if (ownerUserIds && ownerUserIds !== "default" && ownerUserIds !== "unassigned") {
                let owners = [];
                try { owners = JSON.parse(ownerUserIds); } catch { owners = [ownerUserIds]; }
                for (const ownerId of owners) {
                  if (ownerId !== user.sub) {
                    await createNotificationInternal(env, {
                      message: `${actorName} changed ${field} to "${newCells[field]}" on "${title}"`,
                      type: "status_change",
                      source: rowId,
                      target_user_id: ownerId,
                      record_id: rowId,
                      record_name: title,
                      page_config_id: tableId,
                      page_name: _notifPageName,
                      actor_name: actorName,
                    });
                  }
                }
              }
              break;
            }
          }
        } catch (_) {}
      })();
    }

    // ── Task cache invalidation broadcast (cross-user) ──
    // When a status/done field changes, notify all users to refresh their task caches
    if (body.cells !== undefined && !body._fromSync) {
      const STATUS_FIELDS = ["status", "stage", "state", "phase", "done", "complete", "completed"];
      const schema = await env.DB.prepare("SELECT columns FROM table_schemas WHERE id = ?").bind(tableId).first();
      const cols = schema ? JSON.parse(schema.columns || "[]") : [];
      const colMap = Object.fromEntries(cols.map((c) => [c.id, c]));
      const changedStatusField = Object.keys(body.cells).some((colId) => {
        const col = colMap[colId];
        if (!col) return false;
        const colName = (col.name || "").toLowerCase();
        return col.type === "status" || col.type === "checkbox" || STATUS_FIELDS.some((s) => colName.includes(s));
      });
      if (changedStatusField) {
        (async () => {
          try {
            const allUsers = await env.DB.prepare("SELECT id FROM users WHERE deleted_at IS NULL").all();
            for (const u of (allUsers.results || [])) {
              try {
                const roomId = env.USER_ROOMS.idFromName(`user:${u.id}`);
                const room = env.USER_ROOMS.get(roomId);
                await room.fetch(new Request("https://internal/broadcast", {
                  method: "POST",
                  body: JSON.stringify({ type: "task_cache_invalidate", tableId }),
                }));
              } catch (_) {}
            }
          } catch (_) {}
        })();
      }
    }

    // ── Assignment change notifications (Sprint 11B) ──
    if (body.owner_user_id !== undefined && user) {
      (async () => {
        try {
          let oldOwners = [];
          if (existing?.owner_user_id && existing.owner_user_id !== "default" && existing.owner_user_id !== "unassigned") {
            try { oldOwners = JSON.parse(existing.owner_user_id); } catch { oldOwners = [existing.owner_user_id]; }
          }
          let newOwners = [];
          const ownerVal = body.owner_user_id;
          if (ownerVal && ownerVal !== "unassigned") {
            if (Array.isArray(ownerVal)) newOwners = ownerVal;
            else newOwners = [ownerVal];
          }
          const newlyAssigned = newOwners.filter((id) => !oldOwners.includes(id));
          if (newlyAssigned.length > 0) {
            const title = await resolveRecordTitle(env, tableId, newCells) || "Record";
            const actorName = user.name || "Someone";
            for (const assigneeId of newlyAssigned) {
              if (assigneeId !== user.sub) {
                await createNotificationInternal(env, {
                  message: `${actorName} assigned you to "${title}"`,
                  type: "assignment",
                  source: rowId,
                  target_user_id: assigneeId,
                  record_id: rowId,
                  record_name: title,
                  page_config_id: tableId,
                  page_name: _notifPageName,
                  actor_name: actorName,
                });
              }
            }
          }
        } catch (_) {}
      })();
    }

    // Read back the final cell_versions for the response
    const finalRow = await env.DB.prepare(
      "SELECT cell_versions FROM table_rows WHERE id = ? AND table_id = ?"
    ).bind(rowId, tableId).first();
    const finalVersions = finalRow ? JSON.parse(finalRow.cell_versions || "{}") : {};

    const response = { ok: true, id: rowId, cell_versions: finalVersions };
    if (conflicts) response.conflicts = conflicts;
    return jsonResponse(response);
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleDeleteRow(env, tableId, rowId, cascade) {
  try {
    // Check if row has a linked Notion page — archive it too
    const row = await env.DB.prepare(
      "SELECT metadata FROM table_rows WHERE id = ? AND table_id = ?"
    ).bind(rowId, tableId).first();
    const metadata = row ? safeParseJSON(row.metadata) : {};

    // Check for children (sub-items)
    const childCheck = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM table_rows WHERE parent_row_id = ? AND table_id = ? AND archived = 0"
    ).bind(rowId, tableId).first();
    const childCount = childCheck?.cnt || 0;

    if (childCount > 0 && !cascade) {
      // Has children and no cascade specified — ask the client what to do
      return jsonResponse({ hasChildren: true, childCount }, 409);
    }

    if (childCount > 0 && cascade === "orphan") {
      // Move children to top level before archiving parent
      await env.DB.prepare(
        "UPDATE table_rows SET parent_row_id = NULL, updated_at = datetime('now') WHERE parent_row_id = ? AND table_id = ? AND archived = 0"
      ).bind(rowId, tableId).run();
    }

    if (childCount > 0 && cascade === "delete") {
      // Archive all descendants recursively
      await env.DB.prepare(
        `WITH RECURSIVE descendants(id) AS (
          SELECT id FROM table_rows WHERE parent_row_id = ? AND table_id = ? AND archived = 0
          UNION ALL
          SELECT tr.id FROM table_rows tr JOIN descendants d ON tr.parent_row_id = d.id WHERE tr.table_id = ? AND tr.archived = 0
        )
        UPDATE table_rows SET archived = 1, sync_dirty = 0, updated_at = datetime('now') WHERE id IN (SELECT id FROM descendants)`
      ).bind(rowId, tableId, tableId).run();
    }

    // Archive the row itself
    await env.DB.prepare(
      "UPDATE table_rows SET archived = 1, sync_dirty = 0, updated_at = datetime('now') WHERE id = ? AND table_id = ?"
    ).bind(rowId, tableId).run();

    // Archive corresponding Notion page (non-blocking)
    if (metadata.notion_page_id) {
      archiveNotionPage(env, metadata.notion_page_id).catch((err) =>
        console.error("[SyncDelete] Failed to archive Notion page:", err.message)
      );
    }

    // Invalidate data summary cache
    invalidateSummaryCache(env, tableId).catch(() => {});

    return jsonResponse({ ok: true, id: rowId });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleQueryTable(env, tableId, body) {
  try {
    const limit = Math.min(body.limit || 1000, 10000);
    const offset = body.offset || 0;

    const rows = await env.DB.prepare(
      `SELECT * FROM table_rows WHERE table_id = ? AND archived = 0
       ORDER BY sort_order, created_at LIMIT ${limit} OFFSET ${offset}`
    ).bind(tableId).all();

    let parsed = rows.results.map((r) => ({
      ...r,
      cells: JSON.parse(r.cells || "{}"),
      cell_versions: JSON.parse(r.cell_versions || "{}"),
      metadata: JSON.parse(r.metadata || "{}"),
    }));

    // Apply filters on JSON cells (worker-side)
    if (body.filters && body.filters.length > 0) {
      parsed = applyRowFilters(parsed, body.filters);
    }

    // Apply sorts on JSON cells (worker-side)
    if (body.sorts && body.sorts.length > 0) {
      parsed = applyRowSorts(parsed, body.sorts);
    }

    return jsonResponse({ rows: parsed, total: parsed.length });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Record Notes & Comments Handlers ───

async function handleGetNote(env, recordId, pageConfigId) {
  try {
    const note = await env.DB.prepare(
      "SELECT * FROM record_notes WHERE record_id = ? AND page_config_id = ?"
    ).bind(recordId, pageConfigId || "").first();
    return jsonResponse({ note: note || { record_id: recordId, page_config_id: pageConfigId, content: "" } });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleSaveNote(env, user, recordId, body) {
  try {
    const { page_config_id, content } = body;
    if (!page_config_id) return jsonResponse({ _error: "page_config_id required" }, 400);
    const id = `${recordId}:${page_config_id}`;
    await env.DB.prepare(
      `INSERT INTO record_notes (id, record_id, page_config_id, content, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = datetime('now')`
    ).bind(id, recordId, page_config_id, content || "").run();

    // ── @mention notifications for notes ──
    try {
      // For log mode (JSON), scan only the most recent entry; for free mode, scan raw content
      let textToScan = content || "";
      try {
        const parsed = JSON.parse(content);
        if (parsed._mode === "log" && parsed.entries?.length > 0) {
          textToScan = parsed.entries[0].text || "";
        }
      } catch (_) {} // Not JSON — free mode, use content as-is

      const mentions = extractMentions(textToScan);
      if (mentions.length > 0) {
        const authorName = user?.name || "Someone";
        const authorId = user?.sub || "default";
        const preview = (textToScan || "").length > 60 ? textToScan.slice(0, 60) + "..." : textToScan;

        // Resolve record title and page name for enriched notifications
        let recordTitle = "";
        let pageName = "";
        try {
          const rowData = await env.DB.prepare("SELECT cells, table_id FROM table_rows WHERE id = ?").bind(recordId).first();
          if (rowData?.cells) {
            const c = typeof rowData.cells === "string" ? JSON.parse(rowData.cells) : rowData.cells;
            recordTitle = await resolveRecordTitle(env, rowData.table_id || "", c);
          }
          if (rowData?.table_id) {
            const pc = await env.DB.prepare("SELECT name FROM page_configs WHERE id = ?").bind(rowData.table_id).first();
            pageName = pc?.name || "";
          }
        } catch (_) {}

        const users = await env.DB.prepare("SELECT id, display_name FROM users WHERE deleted_at IS NULL").all();
        const userList = users.results || [];
        for (const mentionName of mentions) {
          const mentionLower = mentionName.toLowerCase();
          const matched = userList.find((u) => u.display_name.toLowerCase() === mentionLower);
          if (matched && matched.id !== authorId) {
            // Dedup: skip if same mention notification exists within last 5 minutes (prevents duplicates from free-mode debounce auto-save)
            const existing = await env.DB.prepare(
              `SELECT id FROM notifications
               WHERE type = 'mention' AND record_id = ? AND target_user_id = ? AND actor_name = ?
               AND created_at > datetime('now', '-5 minutes')`
            ).bind(recordId, matched.id, authorName).first();
            if (existing) continue;

            await createNotificationInternal(env, {
              message: `${authorName} mentioned you in a note on "${recordTitle || "a record"}": "${preview}"`,
              type: "mention",
              source: recordId,
              target_user_id: matched.id,
              record_id: recordId,
              record_name: recordTitle,
              page_config_id: page_config_id,
              page_name: pageName,
              actor_name: authorName,
            });
          }
        }
      }
    } catch (_) {} // Non-critical — don't fail the save if notification creation fails

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleListComments(env, recordId, pageConfigId) {
  try {
    const results = await env.DB.prepare(
      "SELECT * FROM record_comments WHERE record_id = ? AND page_config_id = ? ORDER BY created_at ASC"
    ).bind(recordId, pageConfigId || "").all();
    return jsonResponse({ comments: results.results || [] });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Internal Notification Helper ───
async function createNotificationInternal(env, {
  message, type = "notification", source = "", target_user_id = "all",
  record_id = "", record_name = "", page_config_id = "", page_name = "", actor_name = "",
}) {
  try {
    // Check user notification preferences (skip for broadcast 'all')
    if (target_user_id !== "all") {
      try {
        const prefRow = await env.DB.prepare(
          "SELECT value FROM user_connections WHERE user_id = ? AND key = 'notification_prefs'"
        ).bind(target_user_id).first();
        if (prefRow?.value) {
          const prefs = JSON.parse(prefRow.value);
          if (prefs.muted_types?.includes(type)) return; // User muted this type
        }
      } catch (_) {} // Proceed if prefs lookup fails
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO notifications (id, message, type, status, source, target_user_id, record_id, record_name, page_config_id, page_name, actor_name, created_at)
       VALUES (?, ?, ?, 'unread', ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(id, message, type, source, target_user_id, record_id, record_name, page_config_id, page_name, actor_name).run();
  } catch (_) {}
}

// ─── Extract @mentions from text ───
function extractMentions(text) {
  if (!text) return [];
  const matches = text.match(/@[\w\s]+(?=\s|$|[.,!?;:])/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1).trim());
}

async function handleCreateComment(env, user, recordId, body) {
  try {
    const { page_config_id, content } = body;
    if (!page_config_id || !content) return jsonResponse({ _error: "page_config_id and content required" }, 400);
    // Use authenticated user from JWT — never trust user_id from request body
    const user_id = user?.sub || "default";
    const user_name = user?.name || "User";
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO record_comments (id, record_id, page_config_id, user_id, user_name, content)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, recordId, page_config_id, user_id, user_name, content).run();

    // ── Notification triggers ──
    const commenterName = user_name || "Someone";
    const preview = content.length > 60 ? content.slice(0, 60) + "..." : content;

    // Resolve record title and page name for enriched notifications
    let recordTitle = "";
    let pageName = "";
    try {
      const rowData = await env.DB.prepare("SELECT cells, table_id FROM table_rows WHERE id = ?").bind(recordId).first();
      if (rowData?.cells) {
        const c = typeof rowData.cells === "string" ? JSON.parse(rowData.cells) : rowData.cells;
        recordTitle = await resolveRecordTitle(env, rowData.table_id || "", c);
      }
      if (rowData?.table_id) {
        const pc = await env.DB.prepare("SELECT name FROM page_configs WHERE id = ?").bind(rowData.table_id).first();
        pageName = pc?.name || "";
      }
    } catch (_) {}

    // 1. Notify record owner(s) if commenter != owner
    try {
      const row = await env.DB.prepare("SELECT owner_user_id FROM table_rows WHERE id = ?").bind(recordId).first();
      if (row?.owner_user_id && row.owner_user_id !== "default" && row.owner_user_id !== "unassigned") {
        let ownerIds = [];
        try { ownerIds = JSON.parse(row.owner_user_id); } catch { ownerIds = [row.owner_user_id]; }
        for (const ownerId of ownerIds) {
          if (ownerId !== user_id) {
            await createNotificationInternal(env, {
              message: `${commenterName} commented on "${recordTitle || "a record"}": "${preview}"`,
              type: "comment",
              source: recordId,
              target_user_id: ownerId,
              record_id: recordId,
              record_name: recordTitle,
              page_config_id: page_config_id,
              page_name: pageName,
              actor_name: commenterName,
            });
          }
        }
      }
    } catch (_) {}

    // 2. Notify @mentioned users
    try {
      const mentions = extractMentions(content);
      if (mentions.length > 0) {
        const users = await env.DB.prepare("SELECT id, display_name FROM users WHERE deleted_at IS NULL").all();
        const userList = users.results || [];
        for (const mentionName of mentions) {
          const mentionLower = mentionName.toLowerCase();
          const matched = userList.find((u) => u.display_name.toLowerCase() === mentionLower);
          if (matched && matched.id !== user_id) {
            await createNotificationInternal(env, {
              message: `${commenterName} mentioned you on "${recordTitle || "a record"}": "${preview}"`,
              type: "mention",
              source: recordId,
              target_user_id: matched.id,
              record_id: recordId,
              record_name: recordTitle,
              page_config_id: page_config_id,
              page_name: pageName,
              actor_name: commenterName,
            });
          }
        }
      }
    } catch (_) {}

    return jsonResponse({ id, ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleDeleteComment(env, user, recordId, commentId) {
  try {
    // Only the comment author or admin can delete
    const comment = await env.DB.prepare("SELECT user_id FROM record_comments WHERE id = ? AND record_id = ?").bind(commentId, recordId).first();
    if (!comment) return jsonResponse({ _error: "Comment not found" }, 404);
    if (comment.user_id !== user?.sub && user?.role !== "admin") {
      return jsonResponse({ _error: "Cannot delete another user's comment" }, 403);
    }
    await env.DB.prepare("DELETE FROM record_comments WHERE id = ? AND record_id = ?").bind(commentId, recordId).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Task Activity Handlers ───

async function handleListTaskActivity(env, source) {
  try {
    if (!source) return jsonResponse({ _error: "source query param required" }, 400);
    const results = await env.DB.prepare(
      "SELECT * FROM task_activity WHERE source = ?"
    ).bind(source).all();
    return jsonResponse({ activities: results.results || [] });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleGetTaskActivity(env, taskId, source) {
  try {
    if (source) {
      const row = await env.DB.prepare(
        "SELECT * FROM task_activity WHERE task_id = ? AND source = ?"
      ).bind(taskId, source).first();
      return jsonResponse({ activity: row || null });
    }
    const results = await env.DB.prepare(
      "SELECT * FROM task_activity WHERE task_id = ?"
    ).bind(taskId).all();
    return jsonResponse({ activities: results.results || [] });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUpsertTaskActivity(env, taskId, body) {
  try {
    const { source, last_activity_at } = body;
    if (!source || !last_activity_at) return jsonResponse({ _error: "source and last_activity_at required" }, 400);
    const id = `${taskId}:${source}`;
    await env.DB.prepare(
      `INSERT INTO task_activity (id, task_id, source, last_activity_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_activity_at = excluded.last_activity_at`
    ).bind(id, taskId, source, last_activity_at).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Task Interaction Journal Handlers ───

async function handleLogInteraction(env, body) {
  try {
    const { task_id, source, user_id, interaction_type, detail } = body;
    if (!task_id || !source || !interaction_type) {
      return jsonResponse({ _error: "task_id, source, and interaction_type required" }, 400);
    }
    const id = `${task_id}:${user_id || "default"}:${interaction_type}:${Date.now()}`;
    await env.DB.prepare(
      `INSERT INTO task_interactions (id, task_id, source, user_id, interaction_type, detail)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, task_id, source, user_id || "default", interaction_type, detail || null).run();
    // Also update legacy task_activity for backward compat
    const legacyId = `${task_id}:${source}`;
    await env.DB.prepare(
      `INSERT INTO task_activity (id, task_id, source, last_activity_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET last_activity_at = datetime('now')`
    ).bind(legacyId, task_id, source).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleListInteractions(env, url) {
  try {
    const source = url.searchParams.get("source");
    const userId = url.searchParams.get("user_id");
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);
    let query = "SELECT * FROM task_interactions WHERE 1=1";
    const params = [];
    if (source) { query += " AND source = ?"; params.push(source); }
    if (userId) { query += " AND user_id = ?"; params.push(userId); }
    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);
    const { results } = await env.DB.prepare(query).bind(...params).all();
    return jsonResponse({ interactions: results || [] });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleGetInteractionSummary(env, taskId) {
  try {
    // Return the most recent interaction per user per type, with display names
    const { results } = await env.DB.prepare(
      `SELECT ti.user_id, u.display_name, ti.interaction_type, ti.detail,
              MAX(ti.created_at) as last_at, COUNT(*) as count
       FROM task_interactions ti
       LEFT JOIN users u ON ti.user_id = u.id
       WHERE ti.task_id = ?
       GROUP BY ti.user_id, ti.interaction_type
       ORDER BY last_at DESC`
    ).bind(taskId).all();
    return jsonResponse({ summary: results || [] });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Sheet Handlers ───

async function handleGetSheet(env, id) {
  try {
    const row = await env.DB.prepare("SELECT * FROM sheet_data WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ _error: "Sheet not found" }, 404);
    return jsonResponse({
      ...row,
      cells: JSON.parse(row.cells || "{}"),
      col_widths: JSON.parse(row.col_widths || "{}"),
      row_heights: JSON.parse(row.row_heights || "{}"),
      frozen: JSON.parse(row.frozen || "{}"),
      cell_styles: JSON.parse(row.cell_styles || "{}"),
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUpdateSheet(env, id, body) {
  try {
    // Helper: merge a JSON column
    async function mergeJsonCol(colName, incoming, deleteNulls) {
      const existing = await env.DB.prepare(`SELECT ${colName} FROM sheet_data WHERE id = ?`).bind(id).first();
      if (!existing) return false;
      const current = JSON.parse(existing[colName] || "{}");
      const merged = { ...current };
      for (const [key, val] of Object.entries(incoming)) {
        if (deleteNulls && (val === null || val === undefined)) {
          delete merged[key];
        } else {
          merged[key] = val;
        }
      }
      await env.DB.prepare(
        `UPDATE sheet_data SET ${colName} = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(JSON.stringify(merged), id).run();
      return true;
    }

    if (body.cells) {
      const ok = await mergeJsonCol("cells", body.cells, true);
      if (!ok) return jsonResponse({ _error: "Sheet not found" }, 404);
    }
    if (body.col_widths) await mergeJsonCol("col_widths", body.col_widths, false);
    if (body.row_heights) await mergeJsonCol("row_heights", body.row_heights, false);
    if (body.cell_styles) await mergeJsonCol("cell_styles", body.cell_styles, false);

    // Direct JSON overwrites (not merge)
    if (body.frozen !== undefined) {
      await env.DB.prepare(
        "UPDATE sheet_data SET frozen = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(JSON.stringify(body.frozen), id).run();
    }

    return jsonResponse({ ok: true, id });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleSheetFormula(env, id, body) {
  const { fn, args, target } = body;
  // Backward compat: accept "range" as alias for "args"
  const formulaArgs = args || body.range;
  if (!fn || !formulaArgs || !target) {
    return jsonResponse({ _error: "Missing fn, args, or target" }, 400);
  }

  try {
    const row = await env.DB.prepare("SELECT cells FROM sheet_data WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ _error: "Sheet not found" }, 404);
    const cells = JSON.parse(row.cells || "{}");

    const result = evaluateFormula(fn.toUpperCase(), formulaArgs, cells);
    if (result._error) return jsonResponse({ _error: result._error }, 400);

    // Store result + formula in target cell
    const formula = `${fn.toUpperCase()}(${formulaArgs})`;
    cells[target] = { v: result.value, f: formula };

    await env.DB.prepare(
      "UPDATE sheet_data SET cells = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(JSON.stringify(cells), id).run();

    return jsonResponse({ ok: true, target, value: result.value, formula });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Expanded Formula Engine ───

function evaluateFormula(fn, argsStr, cells) {
  // Parse comma-separated args, respecting ranges
  const parts = splitFormulaArgs(argsStr);

  // Resolve all values from args
  function resolveValues(parts) {
    const vals = [];
    for (const part of parts) {
      const trimmed = part.trim();
      // Check if it's a range (e.g., A1:B10)
      if (/^[A-Z]+\d+:[A-Z]+\d+$/i.test(trimmed)) {
        vals.push(...parseCellRange(trimmed, cells));
      }
      // Single cell ref (e.g., A1)
      else if (/^[A-Z]+\d+$/i.test(trimmed)) {
        const cell = cells[trimmed.toUpperCase()];
        vals.push(cell !== undefined && cell !== null ? (typeof cell === "object" ? cell.v : cell) : null);
      }
      // String literal
      else if (/^".*"$/.test(trimmed) || /^'.*'$/.test(trimmed)) {
        vals.push(trimmed.slice(1, -1));
      }
      // Number literal
      else if (!isNaN(Number(trimmed)) && trimmed !== "") {
        vals.push(Number(trimmed));
      }
      else {
        vals.push(trimmed);
      }
    }
    return vals;
  }

  const allVals = resolveValues(parts);
  const nums = allVals.map(Number).filter((n) => !isNaN(n));

  switch (fn) {
    case "SUM":
      return { value: nums.reduce((a, b) => a + b, 0) };
    case "AVG":
    case "AVERAGE":
      return { value: nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0 };
    case "COUNT":
      return { value: allVals.filter((v) => v !== null && v !== undefined && v !== "").length };
    case "COUNTA":
      return { value: allVals.filter((v) => v !== null && v !== undefined && v !== "").length };
    case "COUNTBLANK":
      return { value: allVals.filter((v) => v === null || v === undefined || v === "").length };
    case "MIN":
      return { value: nums.length > 0 ? Math.min(...nums) : 0 };
    case "MAX":
      return { value: nums.length > 0 ? Math.max(...nums) : 0 };
    case "CONCAT":
    case "CONCATENATE":
      return { value: allVals.map((v) => v ?? "").join("") };
    case "ABS":
      return { value: nums.length > 0 ? Math.abs(nums[0]) : 0 };
    case "ROUND": {
      const val = nums[0] ?? 0;
      const dec = nums[1] ?? 0;
      return { value: Math.round(val * Math.pow(10, dec)) / Math.pow(10, dec) };
    }
    case "LEN":
      return { value: String(allVals[0] ?? "").length };
    case "TRIM":
      return { value: String(allVals[0] ?? "").trim() };
    case "UPPER":
      return { value: String(allVals[0] ?? "").toUpperCase() };
    case "LOWER":
      return { value: String(allVals[0] ?? "").toLowerCase() };
    case "LEFT": {
      const str = String(allVals[0] ?? "");
      const n = nums.length > 1 ? nums[1] : (Number(allVals[1]) || 1);
      return { value: str.slice(0, n) };
    }
    case "RIGHT": {
      const str = String(allVals[0] ?? "");
      const n = nums.length > 1 ? nums[1] : (Number(allVals[1]) || 1);
      return { value: str.slice(-n) };
    }
    case "MID": {
      const str = String(allVals[0] ?? "");
      const start = (Number(allVals[1]) || 1) - 1;
      const len = Number(allVals[2]) || 1;
      return { value: str.slice(start, start + len) };
    }
    case "TODAY":
      return { value: new Date().toISOString().slice(0, 10) };
    case "NOW":
      return { value: new Date().toISOString() };
    case "IF": {
      // Evaluate condition: may be a comparison expression like "B2>200"
      const rawCond = parts[0].trim();
      let isTruthy;
      const compMatch = rawCond.match(/^(.+?)(>=|<=|<>|!=|>|<|=)(.+)$/);
      if (compMatch) {
        const [, lhsRaw, op, rhsRaw] = compMatch;
        const resolve1 = (s) => { const t = s.trim(); const m = t.match(/^[A-Z]+\d+$/i); if (m) { const c = cells[t.toUpperCase()]; return c != null ? (typeof c === "object" ? c.v : c) : null; } if (/^".*"$/.test(t)||/^'.*'$/.test(t)) return t.slice(1,-1); const n = Number(t); return isNaN(n) ? t : n; };
        const lhs = resolve1(lhsRaw), rhs = resolve1(rhsRaw);
        const nl = Number(lhs), nr = Number(rhs);
        const useNum = !isNaN(nl) && !isNaN(nr);
        const a = useNum ? nl : lhs, b = useNum ? nr : rhs;
        switch (op) {
          case ">": isTruthy = a > b; break;
          case "<": isTruthy = a < b; break;
          case ">=": isTruthy = a >= b; break;
          case "<=": isTruthy = a <= b; break;
          case "=": isTruthy = a == b; break;
          case "<>": case "!=": isTruthy = a != b; break;
          default: isTruthy = !!a;
        }
      } else {
        const condition = allVals[0];
        isTruthy = condition && condition !== 0 && condition !== "0" && condition !== "FALSE" && condition !== "false";
      }
      const trueVal = allVals[1] ?? "";
      const falseVal = allVals[2] ?? "";
      return { value: isTruthy ? trueVal : falseVal };
    }
    case "SUMIF": {
      // SUMIF(range, criteria, sum_range)
      if (parts.length < 2) return { _error: "SUMIF requires at least 2 args" };
      const criteriaRange = parseCellRange(parts[0].trim(), cells);
      const criteria = parts[1].trim().replace(/^["']|["']$/g, "");
      const sumRange = parts.length > 2 ? parseCellRange(parts[2].trim(), cells) : criteriaRange;
      let sum = 0;
      for (let i = 0; i < criteriaRange.length; i++) {
        if (String(criteriaRange[i]) === criteria) {
          const n = Number(sumRange[i]);
          if (!isNaN(n)) sum += n;
        }
      }
      return { value: sum };
    }
    case "COUNTIF": {
      if (parts.length < 2) return { _error: "COUNTIF requires 2 args" };
      const cRange = parseCellRange(parts[0].trim(), cells);
      const crit = parts[1].trim().replace(/^["']|["']$/g, "");
      let count = 0;
      for (const v of cRange) {
        if (String(v) === crit) count++;
      }
      return { value: count };
    }
    case "VLOOKUP": {
      // VLOOKUP(search_key, range, col_index, [is_sorted])
      if (parts.length < 3) return { _error: "VLOOKUP requires at least 3 args" };
      const searchKey = allVals[0];
      const rangeStr = parts[1].trim();
      const colIdx = Number(allVals[2]) || 1;
      const rangeMatch = rangeStr.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
      if (!rangeMatch) return { _error: "Invalid VLOOKUP range" };
      const [, sc, sr, ec, er] = rangeMatch;
      const startC = colToIndex(sc.toUpperCase());
      const endC = colToIndex(ec.toUpperCase());
      const startR = parseInt(sr);
      const endR = parseInt(er);
      for (let r = startR; r <= endR; r++) {
        const lookKey = indexToCol(startC) + r;
        const lookCell = cells[lookKey];
        const lookVal = lookCell !== undefined && lookCell !== null ? (typeof lookCell === "object" ? lookCell.v : lookCell) : null;
        if (String(lookVal) === String(searchKey)) {
          const resultCol = startC + colIdx - 1;
          if (resultCol > endC) return { _error: "Col index out of range" };
          const rKey = indexToCol(resultCol) + r;
          const rCell = cells[rKey];
          return { value: rCell !== undefined && rCell !== null ? (typeof rCell === "object" ? rCell.v : rCell) : "" };
        }
      }
      return { value: "#N/A" };
    }
    case "INDEX": {
      // INDEX(range, row_num, [col_num])
      if (parts.length < 2) return { _error: "INDEX requires at least 2 args" };
      const rangeStr = parts[0].trim();
      const rowNum = Number(allVals[1]) || 1;
      const colNum = parts.length > 2 ? (Number(allVals[2]) || 1) : 1;
      const rangeMatch = rangeStr.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
      if (!rangeMatch) return { _error: "Invalid INDEX range" };
      const [, sc, sr, , ] = rangeMatch;
      const targetCol = colToIndex(sc.toUpperCase()) + colNum - 1;
      const targetRow = parseInt(sr) + rowNum - 1;
      const rKey = indexToCol(targetCol) + targetRow;
      const rCell = cells[rKey];
      return { value: rCell !== undefined && rCell !== null ? (typeof rCell === "object" ? rCell.v : rCell) : "" };
    }
    case "MATCH": {
      // MATCH(search_key, range, [match_type])
      if (parts.length < 2) return { _error: "MATCH requires at least 2 args" };
      const searchKey = allVals[0];
      const mRange = parseCellRange(parts[1].trim(), cells);
      for (let i = 0; i < mRange.length; i++) {
        if (String(mRange[i]) === String(searchKey)) return { value: i + 1 };
      }
      return { value: "#N/A" };
    }
    case "HYPERLINK": {
      // HYPERLINK(url, [label]) - returns label or url
      return { value: allVals[1] ?? allVals[0] ?? "" };
    }
    default:
      return { _error: `Unknown function: ${fn}` };
  }
}

function splitFormulaArgs(argsStr) {
  // Split by comma but respect quoted strings
  const result = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    if (inQuote) {
      current += ch;
      if (ch === quoteChar) inQuote = false;
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
      current += ch;
    } else if (ch === ",") {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) result.push(current);
  return result;
}

// ─── Sheet Structure Handler ───

async function handleSheetStructure(env, id, body) {
  const { action, index } = body;
  if (!action || index === undefined) {
    return jsonResponse({ _error: "Missing action or index" }, 400);
  }

  try {
    const row = await env.DB.prepare("SELECT * FROM sheet_data WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ _error: "Sheet not found" }, 404);

    let cells = JSON.parse(row.cells || "{}");
    let colCount = row.col_count || 26;
    let rowCount = row.row_count || 100;
    const newCells = {};

    switch (action) {
      case "insertRow": {
        // Shift all rows >= index down by 1
        for (const [key, val] of Object.entries(cells)) {
          const m = key.match(/^([A-Z]+)(\d+)$/);
          if (!m) { newCells[key] = val; continue; }
          const r = parseInt(m[2]);
          if (r >= index) {
            newCells[m[1] + (r + 1)] = val;
          } else {
            newCells[key] = val;
          }
        }
        cells = newCells;
        rowCount++;
        break;
      }
      case "deleteRow": {
        for (const [key, val] of Object.entries(cells)) {
          const m = key.match(/^([A-Z]+)(\d+)$/);
          if (!m) { newCells[key] = val; continue; }
          const r = parseInt(m[2]);
          if (r === index) continue; // skip deleted row
          if (r > index) {
            newCells[m[1] + (r - 1)] = val;
          } else {
            newCells[key] = val;
          }
        }
        cells = newCells;
        rowCount = Math.max(1, rowCount - 1);
        break;
      }
      case "insertCol": {
        // Shift all columns >= index right by 1
        for (const [key, val] of Object.entries(cells)) {
          const m = key.match(/^([A-Z]+)(\d+)$/);
          if (!m) { newCells[key] = val; continue; }
          const c = colToIndex(m[1]);
          if (c >= index) {
            newCells[indexToCol(c + 1) + m[2]] = val;
          } else {
            newCells[key] = val;
          }
        }
        cells = newCells;
        colCount++;
        break;
      }
      case "deleteCol": {
        for (const [key, val] of Object.entries(cells)) {
          const m = key.match(/^([A-Z]+)(\d+)$/);
          if (!m) { newCells[key] = val; continue; }
          const c = colToIndex(m[1]);
          if (c === index) continue; // skip deleted col
          if (c > index) {
            newCells[indexToCol(c - 1) + m[2]] = val;
          } else {
            newCells[key] = val;
          }
        }
        cells = newCells;
        colCount = Math.max(1, colCount - 1);
        break;
      }
      default:
        return jsonResponse({ _error: `Unknown action: ${action}` }, 400);
    }

    await env.DB.prepare(
      "UPDATE sheet_data SET cells = ?, col_count = ?, row_count = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(JSON.stringify(cells), colCount, rowCount, id).run();

    return jsonResponse({ ok: true, cells, col_count: colCount, row_count: rowCount });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleSheetResize(env, id, body) {
  const sets = [];
  const binds = [];

  if (body.col_count !== undefined) { sets.push("col_count = ?"); binds.push(body.col_count); }
  if (body.row_count !== undefined) { sets.push("row_count = ?"); binds.push(body.row_count); }

  if (sets.length === 0) return jsonResponse({ _error: "No dimensions to update" }, 400);

  sets.push("updated_at = datetime('now')");
  binds.push(id);

  try {
    await env.DB.prepare(
      `UPDATE sheet_data SET ${sets.join(", ")} WHERE id = ?`
    ).bind(...binds).run();
    return jsonResponse({ ok: true, id });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Sheet Helper: Parse Cell Range ───

function parseCellRange(range, cells) {
  // Parse "A2:A10" → list of cell values
  const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!match) return [];

  const [, startCol, startRow, endCol, endRow] = match;
  const values = [];

  const sc = colToIndex(startCol.toUpperCase());
  const ec = colToIndex(endCol.toUpperCase());
  const sr = parseInt(startRow);
  const er = parseInt(endRow);

  for (let c = sc; c <= ec; c++) {
    for (let r = sr; r <= er; r++) {
      const key = indexToCol(c) + r;
      const cell = cells[key];
      if (cell !== undefined && cell !== null) {
        // Cell can be { v: value, f?: formula } or plain value
        values.push(typeof cell === "object" ? cell.v : cell);
      }
    }
  }
  return values;
}

function colToIndex(col) {
  let idx = 0;
  for (let i = 0; i < col.length; i++) {
    idx = idx * 26 + (col.charCodeAt(i) - 64);
  }
  return idx;
}

function indexToCol(idx) {
  let col = "";
  while (idx > 0) {
    const rem = (idx - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    idx = Math.floor((idx - 1) / 26);
  }
  return col;
}

// ─── Document (R2) Handlers ───

async function handleGetDoc(env, id) {
  try {
    // Get metadata from D1
    const meta = await env.DB.prepare("SELECT * FROM documents WHERE id = ?").bind(id).first();
    if (!meta) return jsonResponse({ _error: "Document not found" }, 404);

    // Get content from R2
    const r2Key = meta.r2_key || `docs/${id}.json`;
    const obj = await env.DOCS.get(r2Key);
    let content = { version: 1, blocks: [] };
    if (obj) {
      const text = await obj.text();
      content = JSON.parse(text);
    }

    return jsonResponse({
      id: meta.id,
      version: meta.version,
      word_count: meta.word_count,
      created_at: meta.created_at,
      updated_at: meta.updated_at,
      content,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleSaveDoc(env, id, body) {
  const { content } = body;
  if (!content) return jsonResponse({ _error: "Missing content" }, 400);

  const r2Key = `docs/${id}.json`;

  try {
    // Calculate word count from blocks or plain string
    let wordCount = 0;
    if (typeof content === "string") {
      wordCount = content.split(/\s+/).filter(Boolean).length;
    } else if (content.blocks) {
      for (const block of content.blocks) {
        const text = block.content || "";
        wordCount += text.split(/\s+/).filter(Boolean).length;
      }
    }

    // Save content to R2
    await env.DOCS.put(r2Key, JSON.stringify(content), {
      httpMetadata: { contentType: "application/json" },
    });

    // Upsert D1 metadata
    await env.DB.prepare(
      `INSERT INTO documents (id, r2_key, version, word_count, created_at, updated_at)
       VALUES (?, ?, 1, ?, datetime('now'), datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         version = documents.version + 1,
         word_count = excluded.word_count,
         updated_at = datetime('now')`
    ).bind(id, r2Key, wordCount).run();

    // Get updated metadata
    const meta = await env.DB.prepare("SELECT version, word_count FROM documents WHERE id = ?").bind(id).first();

    return jsonResponse({
      ok: true,
      id,
      version: meta?.version || 1,
      word_count: meta?.word_count || wordCount,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUpdateDocBlocks(env, id, body) {
  const { updates } = body;
  if (!updates || !Array.isArray(updates)) {
    return jsonResponse({ _error: "Missing updates array" }, 400);
  }

  const r2Key = `docs/${id}.json`;

  try {
    // Read current content
    const obj = await env.DOCS.get(r2Key);
    let content = { version: 1, blocks: [] };
    if (obj) {
      content = JSON.parse(await obj.text());
    }

    // Apply updates
    for (const update of updates) {
      const { action, block, blockId, index } = update;
      switch (action) {
        case "add":
          if (typeof index === "number") {
            content.blocks.splice(index, 0, block);
          } else {
            content.blocks.push(block);
          }
          break;
        case "update":
          content.blocks = content.blocks.map((b) =>
            b.id === blockId ? { ...b, ...block } : b
          );
          break;
        case "delete":
          content.blocks = content.blocks.filter((b) => b.id !== blockId);
          break;
        case "move": {
          const fromIdx = content.blocks.findIndex((b) => b.id === blockId);
          if (fromIdx >= 0 && typeof index === "number") {
            const [item] = content.blocks.splice(fromIdx, 1);
            content.blocks.splice(index, 0, item);
          }
          break;
        }
      }
    }

    // Save updated content
    await env.DOCS.put(r2Key, JSON.stringify(content), {
      httpMetadata: { contentType: "application/json" },
    });

    // Update D1 metadata
    let wordCount = 0;
    for (const block of content.blocks) {
      const text = block.content || "";
      wordCount += text.split(/\s+/).filter(Boolean).length;
    }

    await env.DB.prepare(
      `UPDATE documents SET version = version + 1, word_count = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(wordCount, id).run();

    return jsonResponse({ ok: true, id, blockCount: content.blocks.length });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleExportDocNotion(env, id) {
  const r2Key = `docs/${id}.json`;

  try {
    const obj = await env.DOCS.get(r2Key);
    if (!obj) return jsonResponse({ _error: "Document not found" }, 404);

    const content = JSON.parse(await obj.text());
    const notionBlocks = (content.blocks || []).map(wasabiBlockToNotion);

    return jsonResponse({ blocks: notionBlocks });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// Convert Wasabi block format → Notion block API format
function wasabiBlockToNotion(block) {
  const richText = block.content
    ? [{ type: "text", text: { content: block.content } }]
    : [];

  switch (block.type) {
    case "heading_1":
      return { type: "heading_1", heading_1: { rich_text: richText } };
    case "heading_2":
      return { type: "heading_2", heading_2: { rich_text: richText } };
    case "heading_3":
      return { type: "heading_3", heading_3: { rich_text: richText } };
    case "bulleted_list_item":
      return { type: "bulleted_list_item", bulleted_list_item: { rich_text: richText } };
    case "numbered_list_item":
      return { type: "numbered_list_item", numbered_list_item: { rich_text: richText } };
    case "to_do":
      return { type: "to_do", to_do: { rich_text: richText, checked: block.checked || false } };
    case "toggle":
      return { type: "toggle", toggle: { rich_text: richText } };
    case "quote":
      return { type: "quote", quote: { rich_text: richText } };
    case "callout":
      return {
        type: "callout",
        callout: {
          rich_text: richText,
          icon: block.icon ? { type: "emoji", emoji: block.icon } : { type: "emoji", emoji: "💡" },
        },
      };
    case "code":
      return { type: "code", code: { rich_text: richText, language: block.language || "plain text" } };
    case "image":
      return {
        type: "image",
        image: { type: "external", external: { url: block.url || "" } },
      };
    case "bookmark":
      return { type: "bookmark", bookmark: { url: block.url || "" } };
    case "divider":
      return { type: "divider", divider: {} };
    default:
      return { type: "paragraph", paragraph: { rich_text: richText } };
  }
}

// ─── File Storage Handlers (R2) ───

async function handleFileUpload(request, env) {
  try {
    const contentType = request.headers.get("content-type") || "";

    // Workspace quota check (5GB = 5368709120 bytes)
    const WORKSPACE_QUOTA = 5368709120;
    const FILE_MAX = 52428800; // 50MB per file

    // Support multipart form-data
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return jsonResponse({ _error: "No file provided" }, 400);
      }
      if (file.size > FILE_MAX) {
        return jsonResponse({ _error: `File exceeds 50MB limit (${(file.size / 1048576).toFixed(1)}MB)` }, 400);
      }
      // Check workspace quota
      const usage = await env.DB.prepare("SELECT COALESCE(SUM(size), 0) as total FROM files").first();
      if ((usage?.total || 0) + file.size > WORKSPACE_QUOTA) {
        return jsonResponse({ _error: "Workspace storage limit (5GB) reached" }, 400);
      }

      const pageId = formData.get("page_id") || "";
      const recordId = formData.get("record_id") || "";
      const meta = formData.get("meta") || "{}";
      const id = crypto.randomUUID();
      const ext = file.name.split(".").pop() || "bin";
      const r2Key = `files/${id}.${ext}`;

      await env.DOCS.put(r2Key, file.stream(), {
        httpMetadata: { contentType: file.type || "application/octet-stream" },
      });

      await env.DB.prepare(
        `INSERT INTO files (id, name, r2_key, mime_type, size, page_id, record_id, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, file.name, r2Key, file.type || "application/octet-stream", file.size, pageId, recordId, meta).run();

      return jsonResponse({ id, name: file.name, r2_key: r2Key, size: file.size, mime_type: file.type, record_id: recordId });
    }

    // Support JSON body with base64 data
    const body = await request.json();
    if (!body.name || !body.data) {
      return jsonResponse({ _error: "name and data (base64) required" }, 400);
    }
    const bytes = Uint8Array.from(atob(body.data), (c) => c.charCodeAt(0));
    if (bytes.length > FILE_MAX) {
      return jsonResponse({ _error: `File exceeds 50MB limit (${(bytes.length / 1048576).toFixed(1)}MB)` }, 400);
    }
    const usage = await env.DB.prepare("SELECT COALESCE(SUM(size), 0) as total FROM files").first();
    if ((usage?.total || 0) + bytes.length > WORKSPACE_QUOTA) {
      return jsonResponse({ _error: "Workspace storage limit (5GB) reached" }, 400);
    }

    const id = crypto.randomUUID();
    const ext = body.name.split(".").pop() || "bin";
    const r2Key = `files/${id}.${ext}`;
    const mimeType = body.mime_type || "application/octet-stream";

    await env.DOCS.put(r2Key, bytes, {
      httpMetadata: { contentType: mimeType },
    });

    await env.DB.prepare(
      `INSERT INTO files (id, name, r2_key, mime_type, size, page_id, record_id, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, body.name, r2Key, mimeType, bytes.length, body.page_id || "", body.record_id || "", JSON.stringify(body.meta || {})).run();

    return jsonResponse({ id, name: body.name, r2_key: r2Key, size: bytes.length, mime_type: mimeType, record_id: body.record_id || "" });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleListFiles(env, user, pageId, recordId) {
  try {
    // Require page_id or record_id — no bare list-all (prevents leaking all workspace files)
    if (!pageId && !recordId) {
      // Admin can list all; non-admin must scope to a page or record
      const role = user ? await getFreshRole(env, user) : null;
      if (role !== "admin") {
        return jsonResponse({ _error: "page_id or record_id required" }, 400);
      }
    }

    let result;
    if (recordId) {
      // Verify user has access to the page this record belongs to
      if (user) {
        const record = await env.DB.prepare("SELECT page_config_id FROM rows WHERE id = ?").bind(recordId).first();
        if (record?.page_config_id) {
          const allowed = await checkPagePermission(env, user, record.page_config_id, "viewer");
          if (!allowed) return jsonResponse({ _error: "Access denied" }, 403);
        }
      }
      result = await env.DB.prepare("SELECT * FROM files WHERE record_id = ? ORDER BY created_at DESC").bind(recordId).all();
    } else if (pageId) {
      // Verify user has access to this page
      if (user) {
        const allowed = await checkPagePermission(env, user, pageId, "viewer");
        if (!allowed) return jsonResponse({ _error: "Access denied" }, 403);
      }
      result = await env.DB.prepare("SELECT * FROM files WHERE page_id = ? ORDER BY created_at DESC").bind(pageId).all();
    } else {
      result = await env.DB.prepare("SELECT * FROM files ORDER BY created_at DESC LIMIT 200").all();
    }
    return jsonResponse({ files: result.results || [] });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleGetFile(env, user, id) {
  try {
    const row = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ _error: "File not found" }, 404);

    // Verify user has access to the page this file belongs to
    if (user && row.page_id) {
      const allowed = await checkPagePermission(env, user, row.page_id, "viewer");
      if (!allowed) return jsonResponse({ _error: "Access denied" }, 403);
    }

    const obj = await env.DOCS.get(row.r2_key);
    if (!obj) return jsonResponse({ _error: "File data not found in R2" }, 404);

    return new Response(obj.body, {
      headers: {
        ...CORS,
        "Content-Type": row.mime_type || "application/octet-stream",
        "Content-Disposition": `inline; filename="${row.name}"`,
        "Content-Length": String(row.size),
      },
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleDeleteFile(env, user, id) {
  try {
    const row = await env.DB.prepare("SELECT r2_key, page_id FROM files WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ _error: "File not found" }, 404);

    // Verify user has editor-level access to the page this file belongs to
    if (user && row.page_id) {
      const allowed = await checkPagePermission(env, user, row.page_id, "editor");
      if (!allowed) return jsonResponse({ _error: "Access denied" }, 403);
    }

    await env.DOCS.delete(row.r2_key);
    await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(id).run();

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Row Filter/Sort Helpers ───

function applyRowFilters(rows, filters) {
  return rows.filter((row) =>
    filters.every((f) => {
      const val = row.cells[f.column];
      const cmp = f.value;
      switch (f.op) {
        case "equals": return val === cmp;
        case "not_equals": return val !== cmp;
        case "contains": return String(val || "").toLowerCase().includes(String(cmp).toLowerCase());
        case "not_contains": return !String(val || "").toLowerCase().includes(String(cmp).toLowerCase());
        case "starts_with": return String(val || "").toLowerCase().startsWith(String(cmp).toLowerCase());
        case "ends_with": return String(val || "").toLowerCase().endsWith(String(cmp).toLowerCase());
        case "is_empty": return val === null || val === undefined || val === "";
        case "is_not_empty": return val !== null && val !== undefined && val !== "";
        case "gt": return Number(val) > Number(cmp);
        case "gte": return Number(val) >= Number(cmp);
        case "lt": return Number(val) < Number(cmp);
        case "lte": return Number(val) <= Number(cmp);
        default: return true;
      }
    })
  );
}

function applyRowSorts(rows, sorts) {
  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const va = a.cells[s.column] ?? "";
      const vb = b.cells[s.column] ?? "";
      const dir = s.direction === "desc" ? -1 : 1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
    }
    return 0;
  });
}

// ─── Notion API Helper ───
async function notionFetch(endpoint, method, notionKey, body) {
  if (!notionKey) {
    return jsonResponse({ _error: "Missing Notion API key" }, 401);
  }

  const headers = {
    Authorization: `Bearer ${notionKey}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };

  const opts = { method, headers };
  if (body && method !== "GET") {
    opts.body = JSON.stringify(body);
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${NOTION_API}${endpoint}`, opts);

    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const wait = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(2000 * Math.pow(2, attempt), 16000);
      await sleep(wait);
      continue;
    }

    const data = await res.json().catch(() => ({ _error: "Failed to parse response" }));

    if (!res.ok) {
      return jsonResponse({
        _error: data.message || `Notion API error: ${res.status}`,
        status: res.status,
        code: data.code,
      }, res.status);
    }

    return jsonResponse(data);
  }

  return jsonResponse({ _error: "Rate limited — max retries exceeded" }, 429);
}

// ─── AI Cache Key Builder ───
async function buildAICacheKey(body) {
  const normalized = JSON.stringify({
    m: body.model,
    s: typeof body.system === "string" ? body.system.slice(0, 500) : "",
    q: (body.messages || []).map((msg) => ({
      r: msg.role,
      c: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
    })),
  });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Request(`https://wasabi-cache.internal/ai/${hex}`, { method: "GET" });
}

// ─── Claude API Helper ───
async function claudeFetch(claudeKey, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(CLAUDE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429 || res.status === 529) {
      const wait = Math.min(2000 * Math.pow(2, attempt), 30000);
      await sleep(wait);
      continue;
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return jsonResponse({
        _error: errData.error?.message || `Claude API error: ${res.status}`,
        type: errData.error?.type,
      }, res.status);
    }

    const data = await res.json();
    return jsonResponse(data);
  }

  return jsonResponse({ _error: "Claude rate limited — max retries exceeded" }, 429);
}

// ─── Utilities ───
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...extraHeaders },
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── CSV Parser (state machine, handles quoted fields) ───
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuoted = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuoted) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuoted = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"' && field.length === 0) {
        inQuoted = true;
        i++;
      } else if (ch === ",") {
        row.push(field);
        field = "";
        i++;
      } else if (ch === "\r" || ch === "\n") {
        row.push(field);
        field = "";
        if (ch === "\r" && i + 1 < text.length && text[i + 1] === "\n") i++;
        i++;
        if (row.length > 0 && row.some((c) => c.length > 0)) rows.push(row);
        row = [];
      } else {
        field += ch;
        i++;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.length > 0)) rows.push(row);
  }

  if (rows.length === 0) return { columns: [], rows: [] };
  const columns = rows[0];
  return { columns, rows: rows.slice(1) };
}

// ─── D1 Automation Rules Handlers ───

async function handleListRules(env, url) {
  const enabled = url.searchParams.get("enabled");
  let query = "SELECT * FROM automation_rules";
  const params = [];
  if (enabled === "true") { query += " WHERE enabled = 1"; }
  else if (enabled === "false") { query += " WHERE enabled = 0"; }
  query += " ORDER BY created_at DESC";

  const { results } = await env.DB.prepare(query).bind(...params).all();
  // Parse JSON config fields
  const rules = (results || []).map((r) => ({
    ...r,
    trigger_config: safeParseJSON(r.trigger_config),
    action_config: safeParseJSON(r.action_config),
    enabled: !!r.enabled,
  }));
  return jsonResponse({ rules });
}

async function handleCreateRule(env, body) {
  const id = crypto.randomUUID();
  const {
    name, description = "", trigger_type, trigger_config = {},
    action_config = {}, enabled = false, scope_table_id = null,
  } = body;

  if (!name || !trigger_type) {
    return jsonResponse({ _error: "name and trigger_type required" }, 400);
  }

  await env.DB.prepare(
    `INSERT INTO automation_rules (id, name, description, trigger_type, trigger_config, action_config, enabled, scope_table_id, fire_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`
  ).bind(
    id, name, description, trigger_type,
    JSON.stringify(trigger_config), JSON.stringify(action_config),
    enabled ? 1 : 0, scope_table_id,
  ).run();

  return jsonResponse({ id, name, success: true });
}

async function handleGetRule(env, id) {
  const row = await env.DB.prepare("SELECT * FROM automation_rules WHERE id = ?").bind(id).first();
  if (!row) return jsonResponse({ _error: "Rule not found" }, 404);
  row.trigger_config = safeParseJSON(row.trigger_config);
  row.action_config = safeParseJSON(row.action_config);
  row.enabled = !!row.enabled;
  return jsonResponse(row);
}

async function handleUpdateRule(env, id, body) {
  const sets = [];
  const vals = [];

  for (const [key, val] of Object.entries(body)) {
    if (["name", "description", "trigger_type", "scope_table_id", "last_fired_at"].includes(key)) {
      sets.push(`${key} = ?`);
      vals.push(val);
    } else if (key === "trigger_config" || key === "action_config") {
      sets.push(`${key} = ?`);
      vals.push(typeof val === "string" ? val : JSON.stringify(val));
    } else if (key === "enabled") {
      sets.push("enabled = ?");
      vals.push(val ? 1 : 0);
    } else if (key === "fire_count") {
      sets.push("fire_count = ?");
      vals.push(val);
    }
  }

  if (sets.length === 0) return jsonResponse({ _error: "No valid fields to update" }, 400);

  sets.push("updated_at = datetime('now')");
  vals.push(id);

  await env.DB.prepare(`UPDATE automation_rules SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return jsonResponse({ success: true, id });
}

async function handleDeleteRule(env, id) {
  await env.DB.prepare("DELETE FROM automation_rules WHERE id = ?").bind(id).run();
  return jsonResponse({ success: true, id });
}

// ─── D1 Automation Flows Handlers ───

async function handleListFlows(env, url) {
  const enabled = url.searchParams.get("enabled");
  let query = "SELECT * FROM automation_flows";
  const params = [];
  if (enabled === "true") { query += " WHERE enabled = 1"; }
  else if (enabled === "false") { query += " WHERE enabled = 0"; }
  query += " ORDER BY updated_at DESC";

  const { results } = await env.DB.prepare(query).bind(...params).all();
  const flows = (results || []).map((r) => ({
    ...r,
    flow_data: safeParseJSON(r.flow_data),
    enabled: !!r.enabled,
  }));
  return jsonResponse({ flows });
}

async function handleCreateFlow(env, body) {
  const id = crypto.randomUUID();
  const {
    name = "Untitled", description = "", flow_data = {},
    enabled = false,
  } = body;

  await env.DB.prepare(
    `INSERT INTO automation_flows (id, name, description, flow_data, enabled, run_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`
  ).bind(
    id, name, description,
    typeof flow_data === "string" ? flow_data : JSON.stringify(flow_data),
    enabled ? 1 : 0,
  ).run();

  return jsonResponse({ id, name, success: true });
}

async function handleGetFlow(env, id) {
  const row = await env.DB.prepare("SELECT * FROM automation_flows WHERE id = ?").bind(id).first();
  if (!row) return jsonResponse({ _error: "Flow not found" }, 404);
  row.flow_data = safeParseJSON(row.flow_data);
  row.enabled = !!row.enabled;
  return jsonResponse(row);
}

async function handleUpdateFlow(env, id, body) {
  const sets = [];
  const vals = [];

  for (const [key, val] of Object.entries(body)) {
    if (["name", "description", "last_run"].includes(key)) {
      sets.push(`${key} = ?`);
      vals.push(val);
    } else if (key === "flow_data") {
      sets.push("flow_data = ?");
      vals.push(typeof val === "string" ? val : JSON.stringify(val));
    } else if (key === "enabled") {
      sets.push("enabled = ?");
      vals.push(val ? 1 : 0);
    } else if (key === "run_count") {
      sets.push("run_count = ?");
      vals.push(val);
    }
  }

  if (sets.length === 0) return jsonResponse({ _error: "No valid fields to update" }, 400);

  sets.push("updated_at = datetime('now')");
  vals.push(id);

  await env.DB.prepare(`UPDATE automation_flows SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return jsonResponse({ success: true, id });
}

async function handleDeleteFlow(env, id) {
  await env.DB.prepare("DELETE FROM automation_flows WHERE id = ?").bind(id).run();
  return jsonResponse({ success: true, id });
}

// ─── D1 Notifications Handlers ───

async function handleListNotifications(env, url, user) {
  const status = url.searchParams.get("status");
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  const conditions = [];
  const params = [];

  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }

  // Filter by user: admins see all, others see 'all' + their own
  const freshRole = user ? await getFreshRole(env, user) : null;
  // Multi-user: deleted/unknown users get no access
  if (user && !freshRole) {
    return jsonResponse({ notifications: [], unread_count: 0, _error: "User not found" }, 403);
  }
  if (user) {
    conditions.push("(target_user_id = 'all' OR target_user_id = ?)");
    params.push(user.sub);
  }

  let query = "SELECT * FROM notifications";
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...params).all();

  // Unread count (scoped to same user filter)
  let countQuery = "SELECT COUNT(*) as count FROM notifications WHERE status = 'unread'";
  const countParams = [];
  if (user) {
    countQuery += " AND (target_user_id = 'all' OR target_user_id = ?)";
    countParams.push(user.sub);
  }
  const countRow = await env.DB.prepare(countQuery).bind(...countParams).first();

  return jsonResponse({
    notifications: results || [],
    unread_count: countRow?.count || 0,
  });
}

async function handleCreateNotification(env, body) {
  const id = crypto.randomUUID();
  const {
    message, type = "notification", source = "", status = "unread", target_user_id = "all",
    record_id = "", record_name = "", page_config_id = "", page_name = "", actor_name = "",
  } = body;

  if (!message) return jsonResponse({ _error: "message required" }, 400);

  await env.DB.prepare(
    `INSERT INTO notifications (id, message, type, status, source, target_user_id, record_id, record_name, page_config_id, page_name, actor_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(id, message, type, status, source, target_user_id, record_id, record_name, page_config_id, page_name, actor_name).run();

  return jsonResponse({ id, success: true });
}

async function handleGetNotification(env, id) {
  const row = await env.DB.prepare("SELECT * FROM notifications WHERE id = ?").bind(id).first();
  if (!row) return jsonResponse({ _error: "Notification not found" }, 404);
  return jsonResponse(row);
}

async function handleUpdateNotification(env, id, body) {
  const sets = [];
  const vals = [];

  if (body.status) { sets.push("status = ?"); vals.push(body.status); }
  if (body.message) { sets.push("message = ?"); vals.push(body.message); }

  if (sets.length === 0) return jsonResponse({ _error: "No valid fields to update" }, 400);

  vals.push(id);
  await env.DB.prepare(`UPDATE notifications SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return jsonResponse({ success: true, id });
}

async function handleDeleteNotification(env, id) {
  await env.DB.prepare("DELETE FROM notifications WHERE id = ?").bind(id).run();
  return jsonResponse({ success: true, id });
}

// ─── D1 Knowledge Base Handlers ───

async function handleListKB(env, url) {
  const category = url.searchParams.get("category");
  let query = "SELECT * FROM knowledge_base";
  const params = [];
  if (category) {
    query += " WHERE category = ?";
    params.push(category);
  }
  query += " ORDER BY updated_at DESC";

  const { results } = await env.DB.prepare(query).bind(...params).all();
  // Parse JSON fields
  const entries = (results || []).map((r) => ({
    ...r,
    related_pages: safeParseJSON(r.related_pages),
  }));
  return jsonResponse({ entries });
}

async function handleCreateKB(env, body) {
  const id = crypto.randomUUID();
  const {
    key, category = "business_context", content,
    source = "conversation", related_pages = [],
  } = body;

  if (!key || !content) return jsonResponse({ _error: "key and content required" }, 400);

  // Upsert: check for existing entry with same key
  const existing = await env.DB.prepare(
    "SELECT id FROM knowledge_base WHERE key = ?"
  ).bind(key).first();

  if (existing) {
    await env.DB.prepare(
      `UPDATE knowledge_base SET content = ?, category = ?, source = ?, related_pages = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(content, category, source, JSON.stringify(related_pages), existing.id).run();
    return jsonResponse({ id: existing.id, updated: true, success: true });
  }

  await env.DB.prepare(
    `INSERT INTO knowledge_base (id, key, category, content, source, related_pages, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(id, key, category, content, source, JSON.stringify(related_pages)).run();

  return jsonResponse({ id, success: true });
}

async function handleGetKB(env, id) {
  const row = await env.DB.prepare("SELECT * FROM knowledge_base WHERE id = ?").bind(id).first();
  if (!row) return jsonResponse({ _error: "KB entry not found" }, 404);
  row.related_pages = safeParseJSON(row.related_pages);
  return jsonResponse(row);
}

async function handleUpdateKB(env, id, body) {
  const sets = [];
  const vals = [];

  for (const [key, val] of Object.entries(body)) {
    if (["key", "category", "content", "source"].includes(key)) {
      sets.push(`${key} = ?`);
      vals.push(val);
    } else if (key === "related_pages") {
      sets.push("related_pages = ?");
      vals.push(JSON.stringify(val));
    }
  }

  if (sets.length === 0) return jsonResponse({ _error: "No valid fields to update" }, 400);

  sets.push("updated_at = datetime('now')");
  vals.push(id);

  await env.DB.prepare(`UPDATE knowledge_base SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return jsonResponse({ success: true, id });
}

async function handleDeleteKB(env, id) {
  await env.DB.prepare("DELETE FROM knowledge_base WHERE id = ?").bind(id).run();
  return jsonResponse({ success: true, id });
}

async function handleSearchKB(env, body) {
  const { query, category } = body;
  if (!query) return jsonResponse({ _error: "query required" }, 400);

  let sql = "SELECT * FROM knowledge_base";
  const params = [];
  if (category) {
    sql += " WHERE category = ?";
    params.push(category);
  }
  sql += " ORDER BY updated_at DESC";

  const { results } = await env.DB.prepare(sql).bind(...params).all();

  // Simple text matching (score by key + content match)
  const queryLower = query.toLowerCase();
  const scored = (results || []).map((r) => {
    let score = 0;
    if ((r.key || "").toLowerCase().includes(queryLower)) score += 10;
    if ((r.content || "").toLowerCase().includes(queryLower)) score += 5;
    if ((r.category || "").toLowerCase().includes(queryLower)) score += 2;
    return { ...r, related_pages: safeParseJSON(r.related_pages), _score: score };
  });

  const matches = scored
    .filter((s) => s._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 10);

  return jsonResponse({ results: matches });
}

// ─── Custom Functions CRUD ───

async function handleListCustomFunctions(env, url) {
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

async function handleCreateCustomFunction(env, body) {
  const id = body.id || `fn_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const { name, description = "", type = "transform", inputs = {}, outputs = {}, code, status = "draft", meta = {} } = body;

  if (!name || !code) return jsonResponse({ _error: "name and code required" }, 400);

  await env.DB.prepare(
    `INSERT INTO custom_functions (id, name, description, type, version, inputs, outputs, code, status, meta, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(id, name, description, type, JSON.stringify(inputs), JSON.stringify(outputs), code, status, JSON.stringify(meta)).run();

  return jsonResponse({ id, success: true }, 201);
}

async function handleGetCustomFunction(env, id) {
  const row = await env.DB.prepare("SELECT * FROM custom_functions WHERE id = ?").bind(id).first();
  if (!row) return jsonResponse({ _error: "Custom function not found" }, 404);
  row.inputs = safeParseJSON(row.inputs);
  row.outputs = safeParseJSON(row.outputs);
  row.meta = safeParseJSON(row.meta);
  return jsonResponse(row);
}

async function handleUpdateCustomFunction(env, id, body) {
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

async function handleDeleteCustomFunction(env, id) {
  await env.DB.prepare("DELETE FROM custom_functions WHERE id = ?").bind(id).run();
  return jsonResponse({ success: true, id });
}

// ─── Function Executions (Audit Trail) ───

async function handleListFunctionExecutions(env, url) {
  const functionId = url.searchParams.get("function_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

  let query = "SELECT * FROM function_executions";
  const params = [];
  if (functionId) {
    query += " WHERE function_id = ?";
    params.push(functionId);
  }
  query += " ORDER BY executed_at DESC LIMIT ?";
  params.push(limit);

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return jsonResponse({ executions: results || [] });
}

async function handleCreateFunctionExecution(env, body) {
  const id = `fex_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const {
    function_id, function_name = "", trigger_source = "chat",
    status = "success", input_summary = "{}", output_summary = "{}",
    mutations_count = 0, duration_ms = 0, error = "",
  } = body;

  if (!function_id) return jsonResponse({ _error: "function_id required" }, 400);

  await env.DB.prepare(
    `INSERT INTO function_executions (id, function_id, function_name, trigger_source, status, input_summary, output_summary, mutations_count, duration_ms, error, executed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(
    id, function_id, function_name, trigger_source, status,
    typeof input_summary === "string" ? input_summary : JSON.stringify(input_summary),
    typeof output_summary === "string" ? output_summary : JSON.stringify(output_summary),
    mutations_count, duration_ms, error
  ).run();

  return jsonResponse({ id, success: true }, 201);
}

// ─── Flow Execution Handlers ───

async function handleListFlowExecutions(env, url) {
  const flowId = url.searchParams.get("flow_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

  let query = "SELECT * FROM flow_executions";
  const params = [];
  if (flowId) {
    query += " WHERE flow_id = ?";
    params.push(flowId);
  }
  query += " ORDER BY started_at DESC LIMIT ?";
  params.push(limit);

  const { results } = await env.DB.prepare(query).bind(...params).all();
  const parsed = (results || []).map((r) => ({
    ...r,
    node_states: safeParseJSON(r.node_states),
  }));
  return jsonResponse({ executions: parsed });
}

async function handleCreateFlowExecution(env, body) {
  const id = `flx_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const {
    flow_id, flow_name = "", trigger_source = "manual",
    status = "running", node_states = "{}", error = "",
  } = body;

  if (!flow_id) return jsonResponse({ _error: "flow_id required" }, 400);

  await env.DB.prepare(
    `INSERT INTO flow_executions (id, flow_id, flow_name, trigger_source, status, node_states, started_at, error)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`
  ).bind(
    id, flow_id, flow_name, trigger_source, status,
    typeof node_states === "string" ? node_states : JSON.stringify(node_states),
    error
  ).run();

  return jsonResponse({ id, success: true }, 201);
}

async function handleUpdateFlowExecution(env, id, body) {
  const sets = [];
  const vals = [];

  for (const [key, val] of Object.entries(body)) {
    if (key === "status") { sets.push("status = ?"); vals.push(val); }
    else if (key === "node_states") {
      sets.push("node_states = ?");
      vals.push(typeof val === "string" ? val : JSON.stringify(val));
    }
    else if (key === "error") { sets.push("error = ?"); vals.push(val); }
    else if (key === "completed_at") { sets.push("completed_at = ?"); vals.push(val); }
  }

  if (sets.length === 0) return jsonResponse({ _error: "No valid fields to update" }, 400);

  vals.push(id);
  await env.DB.prepare(`UPDATE flow_executions SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return jsonResponse({ success: true, id });
}

// ─── External API Proxy ───

/**
 * Proxy external API requests for custom functions.
 * Rate-limited, with domain allowlist validation and timeout.
 */
async function handleExternalApiProxy(env, body) {
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
function executeSandboxServer(code, datasets) {
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

function validatePluginCodeServer(code) {
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

function executeSandboxPluginServer(code, datasets, manifest, config = {}) {
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

/**
 * Topologically sort nodes from trigger nodes via BFS (server-side mirror).
 */
function buildExecutionPlanServer(nodes, connections) {
  const triggerNodes = nodes.filter(
    (n) => n.type === "trigger" || (n.ports?.in?.length === 0)
  );
  const adjacency = {};
  for (const conn of connections) {
    if (!adjacency[conn.fromNode]) adjacency[conn.fromNode] = [];
    adjacency[conn.fromNode].push(conn);
  }
  const visited = new Set();
  const plan = [];
  const queue = [...triggerNodes];
  while (queue.length > 0) {
    const node = queue.shift();
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    plan.push(node);
    for (const edge of (adjacency[node.id] || [])) {
      const next = nodes.find((n) => n.id === edge.toNode);
      if (next && !visited.has(next.id)) queue.push(next);
    }
  }
  return plan;
}

/**
 * Gather inputs for a node from upstream outputs (server-side mirror).
 */
function gatherInputsServer(node, connections, nodeOutputs) {
  const incoming = connections.filter((c) => c.toNode === node.id);
  if (incoming.length === 1) {
    const output = nodeOutputs[incoming[0].fromNode];
    if (output && typeof output === "object") return output;
    return {};
  }
  let merged = {};
  for (const conn of incoming) {
    const output = nodeOutputs[conn.fromNode];
    if (!output || typeof output !== "object") continue;
    if (Array.isArray(output)) {
      merged[conn.fromPort || conn.fromNode] = output;
    } else {
      merged = { ...merged, ...output };
    }
  }
  return merged;
}

/**
 * Evaluate a condition node (server-side mirror).
 */
function evaluateConditionServer(config, inputData) {
  const { field, operator, value } = config;
  if (!field) return { branch: "true", data: inputData };
  const fieldValue = inputData?.[field] ?? "";
  const testValue = value ?? "";
  let result = false;
  switch (operator) {
    case "equals": result = String(fieldValue) === String(testValue); break;
    case "not_equals": result = String(fieldValue) !== String(testValue); break;
    case "contains": result = String(fieldValue).toLowerCase().includes(String(testValue).toLowerCase()); break;
    case "gt": result = Number(fieldValue) > Number(testValue); break;
    case "lt": result = Number(fieldValue) < Number(testValue); break;
    default: result = String(fieldValue) === String(testValue);
  }
  return { branch: result ? "true" : "false", data: inputData };
}

/**
 * Mark downstream nodes as skipped (server-side mirror).
 */
function markDownstreamServer(startNodeId, connections, skippedSet) {
  const queue = [startNodeId];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (skippedSet.has(nodeId)) continue;
    skippedSet.add(nodeId);
    for (const conn of connections.filter((c) => c.fromNode === nodeId)) {
      queue.push(conn.toNode);
    }
  }
}

/**
 * Execute a full flow graph server-side.
 * Mirrors client-side flowExecutor.js — handles triggers, conditions, transforms, and actions.
 *
 * @param {Array} nodes - Flow node definitions
 * @param {Array} connections - Flow edge definitions
 * @param {object} contextData - Trigger context (matched pages, schedule info, etc.)
 * @param {object} env - Cloudflare Worker env (DB, etc.)
 * @returns {Promise<{ nodeOutputs, status, error? }>}
 */
async function executeFlowServer(nodes, connections, contextData, env) {
  const plan = buildExecutionPlanServer(nodes, connections);
  const nodeOutputs = {};
  const skippedNodes = new Set();
  const nodeStates = {};

  // Build adjacency for condition branching
  const adjacency = {};
  for (const conn of connections) {
    if (!adjacency[conn.fromNode]) adjacency[conn.fromNode] = [];
    adjacency[conn.fromNode].push(conn);
  }

  for (const node of plan) {
    if (skippedNodes.has(node.id)) {
      nodeStates[node.id] = "skipped";
      continue;
    }

    nodeStates[node.id] = "running";

    try {
      const inputs = gatherInputsServer(node, connections, nodeOutputs);
      let result;

      switch (node.type) {
        case "trigger":
          result = { ...contextData, ...inputs, _trigger: node.subtype };
          break;

        case "condition": {
          const condResult = evaluateConditionServer(node.config || {}, inputs);
          result = condResult.data;
          const activeBranch = condResult.branch;
          const outConns = adjacency[node.id] || [];
          for (const conn of outConns) {
            const portLabel = (node.ports?.out || []).find((p) => p.id === conn.fromPort)?.label;
            if (portLabel && portLabel !== activeBranch) {
              markDownstreamServer(conn.toNode, connections, skippedNodes);
            }
          }
          break;
        }

        case "action":
          result = await executeFlowActionServer(node, inputs, env);
          break;

        case "transform":
          result = await executeFlowTransformServer(node, inputs, env);
          break;

        default:
          result = inputs;
      }

      nodeOutputs[node.id] = result;
      nodeStates[node.id] = "success";
    } catch (err) {
      console.error(`[FlowServer] Node "${node.label}" (${node.id}) failed:`, err.message);
      nodeOutputs[node.id] = { _error: err.message };
      nodeStates[node.id] = "error";
    }
  }

  return { nodeOutputs, nodeStates, status: "completed" };
}

/**
 * Execute an action node server-side (reuses executeServerTool pattern).
 */
async function executeFlowActionServer(node, inputs, env) {
  const templateData = { ...inputs };

  switch (node.subtype) {
    case "post_notification": {
      const message = expandTemplateServer(node.config?.message || "", templateData);
      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO notifications (id, message, type, status, source, created_at) VALUES (?, ?, ?, 'unread', ?, datetime('now'))"
      ).bind(id, message, node.config?.type || "notification", `flow:${node.label}`).run();
      return { _action: "notification_sent", message };
    }

    case "update_page": {
      const properties = safeParseJSON(node.config?.properties);
      const expanded = {};
      for (const [key, val] of Object.entries(properties)) {
        expanded[key] = typeof val === "string" ? expandTemplateServer(val, templateData) : val;
      }
      // If we have a page ID from upstream data, do the actual update
      const pageId = inputs?.id || inputs?.pageId || inputs?.page_id;
      const dbId = inputs?.databaseId || inputs?.database_id || inputs?.table_id;
      if (pageId) {
        const existing = await env.DB.prepare("SELECT cells FROM table_rows WHERE id = ?").bind(pageId).first();
        const merged = { ...safeParseJSON(existing?.cells), ...expanded };
        await env.DB.prepare("UPDATE table_rows SET cells = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(JSON.stringify(merged), pageId).run();
        return { _action: "page_updated", pageId, properties: expanded };
      }
      return { _action: "update_page", properties: expanded, ...inputs };
    }

    case "create_page": {
      const properties = safeParseJSON(node.config?.properties);
      const expanded = {};
      for (const [key, val] of Object.entries(properties)) {
        expanded[key] = typeof val === "string" ? expandTemplateServer(val, templateData) : val;
      }
      const dbId = node.config?.databaseId;
      if (dbId) {
        const id = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO table_rows (id, table_id, cells, sort_order, metadata, created_at, updated_at) VALUES (?, ?, ?, 0, '{}', datetime('now'), datetime('now'))"
        ).bind(id, dbId, JSON.stringify(expanded)).run();
        return { _action: "page_created", pageId: id, ...expanded };
      }
      return { _action: "create_page", properties: expanded };
    }

    default:
      return { _action: node.subtype, ...inputs };
  }
}

/**
 * Execute a transform node server-side.
 * For execute_function subtype: fetches function from D1, runs in sandbox.
 */
async function executeFlowTransformServer(node, inputs, env) {
  if (node.subtype === "execute_function") {
    const { functionId } = node.config || {};
    if (!functionId) throw new Error("No function selected for this node.");

    // Fetch the function from D1
    const fn = await env.DB.prepare("SELECT * FROM custom_functions WHERE id = ?").bind(functionId).first();
    if (!fn) throw new Error(`Function not found: ${functionId}`);

    const code = fn.code || "";
    const meta = safeParseJSON(fn.meta);

    // Build datasets from upstream inputs
    const datasets = {};
    if (inputs && typeof inputs === "object") {
      if (inputs.results && Array.isArray(inputs.results)) {
        datasets.data = inputs.results;
      } else {
        Object.assign(datasets, inputs);
      }
    }

    const execStart = Date.now();
    const result = executeSandboxServer(code, datasets);
    const durationMs = Date.now() - execStart;

    // Log execution (non-blocking)
    try {
      const execId = `fex_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      env.DB.prepare(
        `INSERT INTO function_executions (id, function_id, function_name, trigger_source, status, input_summary, output_summary, duration_ms, error, executed_at)
         VALUES (?, ?, ?, 'flow', ?, ?, ?, ?, '', datetime('now'))`
      ).bind(
        execId, functionId, fn.name || "",
        result.success ? "success" : "error",
        JSON.stringify({ datasets: Object.keys(datasets) }),
        JSON.stringify({ type: typeof result.result }),
        durationMs
      ).run().catch(() => {});
    } catch { /* ignore */ }

    if (!result.success) throw new Error(`Function "${fn.name}" execution failed`);

    // Wrap result with output key if configured
    if (node.config?.outputKey) {
      return { ...inputs, [node.config.outputKey]: result.result, _functionResult: true };
    }
    return { ...inputs, result: result.result, _functionResult: true };
  }

  // Plugin transform
  if (node.subtype === "execute_plugin") {
    const { pluginId } = node.config || {};
    if (!pluginId) throw new Error("No plugin selected for this node.");

    const fn = await env.DB.prepare("SELECT * FROM custom_functions WHERE id = ?").bind(pluginId).first();
    if (!fn) throw new Error(`Plugin not found: ${pluginId}`);

    const code = fn.code || "";
    const meta = safeParseJSON(fn.meta);
    const manifest = meta?.manifest || {};

    const datasets = {};
    if (inputs && typeof inputs === "object") {
      if (inputs.results && Array.isArray(inputs.results)) datasets.data = inputs.results;
      else Object.assign(datasets, inputs);
    }

    // Build config from manifest defaults + node overrides
    const pluginConfig = {};
    if (manifest.ui?.configSchema) {
      for (const [k, v] of Object.entries(manifest.ui.configSchema)) pluginConfig[k] = v.default ?? null;
    }
    if (node.config?.config) Object.assign(pluginConfig, node.config.config);

    const execStart = Date.now();
    const result = executeSandboxPluginServer(code, datasets, manifest, pluginConfig);
    const durationMs = Date.now() - execStart;

    // Log execution
    try {
      const execId = `fex_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      env.DB.prepare(
        `INSERT INTO function_executions (id, function_id, function_name, trigger_source, status, input_summary, output_summary, duration_ms, error, executed_at)
         VALUES (?, ?, ?, 'flow', ?, ?, ?, ?, '', datetime('now'))`
      ).bind(execId, pluginId, fn.name || "", result.success ? "success" : "error",
        JSON.stringify({ datasets: Object.keys(datasets) }), JSON.stringify({ type: typeof result.result }), durationMs
      ).run().catch(() => {});
    } catch { /* ignore */ }

    if (!result.success) throw new Error(`Plugin "${fn.name}" execution failed`);

    const output = result.result?.viewSpec ? result.result.data : result.result;
    if (node.config?.outputKey) return { ...inputs, [node.config.outputKey]: output, _functionResult: true };
    return { ...inputs, result: output, _functionResult: true };
  }

  // Template transform
  const template = node.config?.template || "";
  const expanded = expandTemplateServer(template, inputs);
  return { ...inputs, result: expanded, _transformed: true };
}

// ─── Server-Side Automation Engine ───

/**
 * Main automation tick — called every 2 minutes by Cloudflare cron.
 * Queries enabled rules, evaluates triggers with field-level change detection,
 * and executes matched rules server-side (no browser required).
 */
async function runAutomationTick(env) {
  const LOG = "[AutoCron]";
  const MAX_RULES_PER_TICK = 5;
  const MAX_AGENT_ITERATIONS = 8;
  const AGENT_MAX_TOKENS = 2048;

  try {
    // 1. Fetch all enabled rules
    const { results: rawRules } = await env.DB.prepare(
      "SELECT * FROM automation_rules WHERE enabled = 1"
    ).all();

    if (!rawRules || rawRules.length === 0) {
      console.log(LOG, "No enabled rules — skipping tick");
      return;
    }

    console.log(LOG, `Found ${rawRules.length} enabled rule(s)`);

    const rules = rawRules.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || "",
      trigger: r.trigger_type,
      triggerConfig: safeParseJSON(r.trigger_config),
      actionConfig: safeParseJSON(r.action_config),
      instruction: safeParseJSON(r.action_config).instruction || "",
      databaseId: safeParseJSON(r.action_config).database_id || r.scope_table_id || "",
      enabled: !!r.enabled,
      lastFired: r.last_fired_at || null,
      fireCount: r.fire_count || 0,
      ownerPage: safeParseJSON(r.action_config).owner_page || "",
    }));

    // 2. Evaluate each rule
    const now = new Date();
    const toExecute = [];

    for (const rule of rules) {
      if (toExecute.length >= MAX_RULES_PER_TICK) break;

      try {
        const result = await evaluateRuleServer(rule, now, env);
        if (result.shouldFire) {
          toExecute.push({ rule, changedRecords: result.changedRecords || [] });
        }
      } catch (err) {
        console.error(LOG, `Trigger eval failed for "${rule.name}":`, err.message);
      }
    }

    if (toExecute.length === 0) {
      console.log(LOG, "No rules triggered this tick");
      return;
    }

    console.log(LOG, `${toExecute.length} rule(s) triggered — executing`);

    // 3. Get Claude key for agent-based rules
    let claudeKey = null;
    try {
      const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'claude'").first();
      claudeKey = row?.value || null;
    } catch {}

    // 4. Execute triggered rules
    for (const { rule, changedRecords } of toExecute) {
      try {
        await executeRuleServer(rule, changedRecords, claudeKey, env);

        // Update last_fired_at and fire_count
        await env.DB.prepare(
          "UPDATE automation_rules SET last_fired_at = datetime('now'), fire_count = fire_count + 1, updated_at = datetime('now') WHERE id = ?"
        ).bind(rule.id).run();

        console.log(LOG, `Rule "${rule.name}" fired successfully`);
      } catch (err) {
        console.error(LOG, `Rule "${rule.name}" execution failed:`, err.message);
      }
    }

    // ── 5. Process enabled automation flows ──
    await processEnabledFlows(env, now);

  } catch (err) {
    console.error(LOG, "Tick failed:", err.message);
  }
}

/**
 * Process enabled automation flows.
 * Queries flows with enabled=1, evaluates trigger nodes (schedule or event-based),
 * and executes matching flows using the server-side flow executor.
 */
async function processEnabledFlows(env, now) {
  const LOG = "[FlowCron]";
  const MAX_FLOWS_PER_TICK = 3;

  try {
    const { results: flows } = await env.DB.prepare(
      "SELECT * FROM automation_flows WHERE enabled = 1"
    ).all();

    if (!flows || flows.length === 0) return;

    console.log(LOG, `Found ${flows.length} enabled flow(s)`);

    let executedCount = 0;

    for (const flow of flows) {
      if (executedCount >= MAX_FLOWS_PER_TICK) break;

      const flowData = safeParseJSON(flow.flow_data);
      const nodes = flowData.nodes || [];
      const connections = flowData.connections || [];

      if (nodes.length === 0) continue;

      // Find trigger nodes
      const triggerNodes = nodes.filter((n) => n.type === "trigger");
      if (triggerNodes.length === 0) continue;

      // Evaluate each trigger node to see if the flow should fire
      let shouldFire = false;
      let contextData = {};

      for (const trigger of triggerNodes) {
        const trigResult = await evaluateFlowTrigger(trigger, flow, now, env);
        if (trigResult.shouldFire) {
          shouldFire = true;
          contextData = { ...contextData, ...trigResult.contextData };
          break; // One matching trigger is enough
        }
      }

      if (!shouldFire) continue;

      console.log(LOG, `Flow "${flow.name}" (${flow.id}) triggered — executing`);

      // Create flow execution record
      const execId = `flx_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      try {
        await env.DB.prepare(
          `INSERT INTO flow_executions (id, flow_id, flow_name, trigger_source, status, node_states, started_at)
           VALUES (?, ?, ?, 'cron', 'running', '{}', datetime('now'))`
        ).bind(execId, flow.id, flow.name).run();
      } catch { /* ignore logging errors */ }

      try {
        const result = await executeFlowServer(nodes, connections, contextData, env);

        // Update flow execution record
        await env.DB.prepare(
          `UPDATE flow_executions SET status = ?, node_states = ?, completed_at = datetime('now') WHERE id = ?`
        ).bind(
          result.status || "completed",
          JSON.stringify(result.nodeStates || {}),
          execId
        ).run();

        // Update flow's last_run and run_count
        await env.DB.prepare(
          "UPDATE automation_flows SET last_run = datetime('now'), run_count = run_count + 1, updated_at = datetime('now') WHERE id = ?"
        ).bind(flow.id).run();

        executedCount++;
        console.log(LOG, `Flow "${flow.name}" completed successfully`);
      } catch (err) {
        console.error(LOG, `Flow "${flow.name}" failed:`, err.message);
        try {
          await env.DB.prepare(
            `UPDATE flow_executions SET status = 'failed', error = ?, completed_at = datetime('now') WHERE id = ?`
          ).bind(err.message, execId).run();
        } catch { /* ignore */ }
      }
    }

    if (executedCount > 0) {
      console.log(LOG, `Executed ${executedCount} flow(s) this tick`);
    }
  } catch (err) {
    console.error(LOG, "Flow processing failed:", err.message);
  }
}

/**
 * Evaluate whether a flow's trigger node should fire.
 * Supports: schedule, field_change/status_change, page_created, manual (never fires on cron).
 */
async function evaluateFlowTrigger(triggerNode, flow, now, env) {
  const config = triggerNode.config || {};

  switch (triggerNode.subtype) {
    case "schedule": {
      const intervalMin = config.interval_minutes;
      if (!intervalMin || intervalMin <= 0) return { shouldFire: false };

      // Check flow's last_run to see if enough time has passed
      if (!flow.last_run) return { shouldFire: true, contextData: { _trigger: "schedule" } };
      const lastMs = new Date(flow.last_run).getTime();
      if (isNaN(lastMs)) return { shouldFire: true, contextData: { _trigger: "schedule" } };

      const elapsed = now.getTime() - lastMs;
      if (elapsed >= intervalMin * 60_000) {
        return { shouldFire: true, contextData: { _trigger: "schedule", elapsed_minutes: Math.round(elapsed / 60_000) } };
      }
      return { shouldFire: false };
    }

    case "field_change":
    case "status_change":
    case "database_change": {
      const databaseId = config.databaseId;
      if (!databaseId) return { shouldFire: false };

      // Check for changed records since flow's last_run
      const since = flow.last_run
        ? new Date(flow.last_run).toISOString()
        : new Date(now.getTime() - 5 * 60_000).toISOString(); // Default: last 5 min

      try {
        const { results } = await env.DB.prepare(
          "SELECT id, cells, updated_at FROM table_rows WHERE table_id = ? AND archived = 0 AND updated_at > ? ORDER BY updated_at DESC LIMIT 50"
        ).bind(databaseId, since).all();

        if (!results || results.length === 0) return { shouldFire: false };

        const changedRows = results.map((r) => ({
          id: r.id,
          ...safeParseJSON(r.cells),
          _updated: r.updated_at,
        }));

        // If a specific field/value is configured, filter to matching changes
        if (config.field && config.to) {
          const matchingRows = changedRows.filter((r) => {
            const fieldVal = String(r[config.field] ?? "");
            return fieldVal === config.to;
          });
          if (matchingRows.length === 0) return { shouldFire: false };
          return {
            shouldFire: true,
            contextData: {
              _trigger: triggerNode.subtype,
              matched_count: matchingRows.length,
              results: matchingRows.slice(0, 10),
              databaseId,
            },
          };
        }

        return {
          shouldFire: true,
          contextData: {
            _trigger: triggerNode.subtype,
            matched_count: changedRows.length,
            results: changedRows.slice(0, 10),
            databaseId,
          },
        };
      } catch (err) {
        console.error("[FlowCron] Field change detection failed:", err.message);
        return { shouldFire: false };
      }
    }

    case "page_created": {
      const databaseId = config.databaseId;
      if (!databaseId) return { shouldFire: false };

      const since = flow.last_run
        ? new Date(flow.last_run).toISOString()
        : new Date(now.getTime() - 5 * 60_000).toISOString();

      try {
        const { results } = await env.DB.prepare(
          "SELECT id, cells, created_at FROM table_rows WHERE table_id = ? AND archived = 0 AND created_at > ? ORDER BY created_at DESC LIMIT 50"
        ).bind(databaseId, since).all();

        if (!results || results.length === 0) return { shouldFire: false };

        const newRows = results.map((r) => ({
          id: r.id,
          ...safeParseJSON(r.cells),
          _created: r.created_at,
        }));

        return {
          shouldFire: true,
          contextData: {
            _trigger: "page_created",
            matched_count: newRows.length,
            results: newRows.slice(0, 10),
            databaseId,
          },
        };
      } catch (err) {
        console.error("[FlowCron] New record detection failed:", err.message);
        return { shouldFire: false };
      }
    }

    case "manual":
    default:
      return { shouldFire: false };
  }
}

/**
 * Server-side trigger evaluation with field-level change detection via snapshots.
 */
async function evaluateRuleServer(rule, now, env) {
  switch (rule.trigger) {
    case "schedule": {
      const intervalMin = rule.triggerConfig?.interval_minutes;
      if (!intervalMin || intervalMin <= 0) return { shouldFire: false };
      if (!rule.lastFired) return { shouldFire: true, changedRecords: [] };
      const lastMs = new Date(rule.lastFired).getTime();
      if (isNaN(lastMs)) return { shouldFire: true, changedRecords: [] };
      return {
        shouldFire: (now.getTime() - lastMs) >= intervalMin * 60_000,
        changedRecords: [],
      };
    }

    case "field_change":
    case "status_change": {
      if (!rule.databaseId) return { shouldFire: false };
      return await detectFieldChanges(rule, env);
    }

    case "page_created": {
      if (!rule.databaseId) return { shouldFire: false };
      return await detectNewRecords(rule, env);
    }

    case "manual":
    default:
      return { shouldFire: false };
  }
}

/**
 * Field-level change detection using rule_snapshots table.
 * Hashes the watched field (or all fields) for each record and compares to stored snapshots.
 * Returns specific changed records with old/new values.
 */
async function detectFieldChanges(rule, env) {
  const watchedField = rule.triggerConfig?.field || null;

  // Get current records from D1 table
  let rows;
  try {
    const result = await env.DB.prepare(
      "SELECT id, cells, updated_at FROM table_rows WHERE table_id = ? AND archived = 0 ORDER BY updated_at DESC LIMIT 200"
    ).bind(rule.databaseId).all();
    rows = (result.results || []).map((r) => ({
      id: r.id,
      cells: safeParseJSON(r.cells),
      updated_at: r.updated_at,
    }));
  } catch (err) {
    console.error("[AutoCron] Failed to query table for field changes:", err.message);
    return { shouldFire: false };
  }

  if (rows.length === 0) return { shouldFire: false };

  // Get existing snapshots for this rule
  const { results: existingSnaps } = await env.DB.prepare(
    "SELECT record_id, field_name, value_hash FROM rule_snapshots WHERE rule_id = ?"
  ).bind(rule.id).all();

  const snapMap = new Map();
  for (const snap of existingSnaps || []) {
    snapMap.set(`${snap.record_id}::${snap.field_name}`, snap.value_hash);
  }

  // Compare current values against snapshots
  const changedRecords = [];
  const upserts = [];

  for (const row of rows) {
    const fieldsToCheck = watchedField
      ? [watchedField]
      : Object.keys(row.cells);

    for (const field of fieldsToCheck) {
      const value = row.cells[field];
      const valueStr = value === null || value === undefined ? "" : String(value);
      const hash = simpleHash(valueStr);
      const key = `${row.id}::${field}`;
      const oldHash = snapMap.get(key);

      if (oldHash !== undefined && oldHash !== hash) {
        // Value changed
        changedRecords.push({
          id: row.id,
          cells: row.cells,
          changed_field: field,
          new_value: value,
          old_hash: oldHash,
        });
      }

      // Upsert snapshot (always update to latest)
      upserts.push({ ruleId: rule.id, recordId: row.id, field, hash });
    }
  }

  // Batch upsert snapshots
  if (upserts.length > 0) {
    const batchSize = 50;
    for (let i = 0; i < upserts.length; i += batchSize) {
      const batch = upserts.slice(i, i + batchSize);
      const stmts = batch.map((u) =>
        env.DB.prepare(
          "INSERT OR REPLACE INTO rule_snapshots (rule_id, record_id, field_name, value_hash, updated_at) VALUES (?, ?, ?, ?, datetime('now'))"
        ).bind(u.ruleId, u.recordId, u.field, u.hash)
      );
      await env.DB.batch(stmts);
    }
  }

  // For first run (no existing snapshots), don't fire — just seed
  if (existingSnaps.length === 0) {
    console.log("[AutoCron]", `Rule "${rule.name}": seeded ${upserts.length} snapshots (first run, no fire)`);
    return { shouldFire: false };
  }

  return {
    shouldFire: changedRecords.length > 0,
    changedRecords: changedRecords.slice(0, 10),
  };
}

/**
 * Detect newly created records since rule last fired.
 */
async function detectNewRecords(rule, env) {
  const lastFiredISO = rule.lastFired
    ? new Date(rule.lastFired).toISOString()
    : new Date(Date.now() - 24 * 60 * 60_000).toISOString();

  try {
    const { results } = await env.DB.prepare(
      "SELECT id, cells, created_at FROM table_rows WHERE table_id = ? AND archived = 0 AND created_at > ? ORDER BY created_at DESC LIMIT 50"
    ).bind(rule.databaseId, lastFiredISO).all();

    const newRecords = (results || []).map((r) => ({
      id: r.id,
      cells: safeParseJSON(r.cells),
      created_at: r.created_at,
    }));

    return {
      shouldFire: newRecords.length > 0,
      changedRecords: newRecords.slice(0, 10),
    };
  } catch (err) {
    console.error("[AutoCron] Failed to detect new records:", err.message);
    return { shouldFire: false };
  }
}

/**
 * Execute a rule server-side. Fast path for notifications, slow path for Claude agent.
 */
async function executeRuleServer(rule, changedRecords, claudeKey, env) {
  const instruction = (rule.instruction || "").trim();

  // Build template data from first changed record
  const firstRecord = changedRecords[0] || {};
  const templateData = {
    name: rule.name,
    description: rule.description,
    databaseId: rule.databaseId,
    matched_count: changedRecords.length,
    changed_field: firstRecord.changed_field || "",
    new_value: firstRecord.new_value || "",
    ...(firstRecord.cells || {}),
  };

  // Also get the table schema to help with column names
  let schemaColumns = [];
  try {
    const schemaRow = await env.DB.prepare(
      "SELECT columns FROM table_schemas WHERE id = ?"
    ).bind(rule.databaseId).first();
    if (schemaRow) {
      schemaColumns = JSON.parse(schemaRow.columns || "[]");
    }
  } catch {}

  // Try to find the "title" column (first column, or one named "Name"/"Title")
  const titleCol = schemaColumns.find((c) => c.name === "Name" || c.name === "Title" || c.type === "title")
    || schemaColumns[0];
  if (titleCol && firstRecord.cells) {
    templateData.record_name = firstRecord.cells[titleCol.name] || "";
  }

  // ── Fast path: direct notification ──
  if (instruction.startsWith("post_notification:")) {
    const messageTemplate = instruction.slice("post_notification:".length).trim();
    const message = expandTemplateServer(messageTemplate, templateData);

    await env.DB.prepare(
      "INSERT INTO notifications (id, message, type, status, source, created_at) VALUES (?, ?, 'alert', 'unread', ?, datetime('now'))"
    ).bind(crypto.randomUUID(), message, `automation:${rule.name}`).run();

    console.log("[AutoCron]", `Fast-path notification: "${message}"`);
    return { path: "fast", message };
  }

  // ── Slow path: Claude agent ──
  if (!claudeKey) {
    console.warn("[AutoCron]", `Rule "${rule.name}" needs Claude API key for agent execution — skipping`);
    return { path: "skipped", reason: "no_claude_key" };
  }

  // Build a rich system prompt with actual record data
  const changedSummary = changedRecords.slice(0, 5).map((r) => {
    const name = titleCol ? (r.cells?.[titleCol.name] || r.id) : r.id;
    const field = r.changed_field || "record";
    const val = r.new_value !== undefined ? ` → "${r.new_value}"` : "";
    return `- ${name}: ${field} changed${val}`;
  }).join("\n");

  const systemPrompt = [
    `You are an automation agent for rule "${rule.name}".`,
    rule.description ? `Description: ${rule.description}` : null,
    `Instruction: ${instruction}`,
    rule.databaseId ? `Target database ID: ${rule.databaseId}` : null,
    schemaColumns.length > 0
      ? `Database columns: ${schemaColumns.map((c) => `${c.name} (${c.type})`).join(", ")}`
      : null,
    changedRecords.length > 0
      ? `\nTriggered by ${changedRecords.length} changed record(s):\n${changedSummary}`
      : null,
    "\nComplete the instruction efficiently. Do not ask follow-up questions.",
    "Use the available tools to query data, update records, or post notifications.",
  ].filter(Boolean).join("\n");

  const userMessage = changedRecords.length > 0
    ? `Execute this automation now. ${instruction}\n\nChanged records: ${JSON.stringify(changedRecords.slice(0, 5).map((r) => ({ id: r.id, ...r.cells, _changed: r.changed_field, _new_value: r.new_value })))}`
    : `Execute this automation now. ${instruction}`;

  // Server-side tool definitions (subset for automation)
  const serverTools = [
    {
      name: "query_database",
      description: "Query a D1 table for records. Returns rows with all cell values.",
      input_schema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "The D1 table ID to query." },
        },
        required: ["database_id"],
      },
    },
    {
      name: "update_page",
      description: "Update a record's cells in a D1 table.",
      input_schema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "The row ID to update." },
          database_id: { type: "string", description: "The D1 table ID." },
          properties: { type: "object", description: "Key-value pairs of cell values to update." },
        },
        required: ["page_id", "properties"],
      },
    },
    {
      name: "create_page",
      description: "Create a new record in a D1 table.",
      input_schema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "The D1 table ID." },
          properties: { type: "object", description: "Key-value pairs for the new record's cells." },
        },
        required: ["database_id", "properties"],
      },
    },
    {
      name: "post_notification",
      description: "Post a notification to the user's feed.",
      input_schema: {
        type: "object",
        properties: {
          message: { type: "string", description: "The notification message." },
          type: { type: "string", enum: ["notification", "alert", "summary"], description: "Type." },
          source: { type: "string", description: "Source label." },
        },
        required: ["message"],
      },
    },
  ];

  // Run the agent loop server-side
  const messages = [{ role: "user", content: userMessage }];
  let finalText = "";

  for (let iter = 0; iter < 8; iter++) {
    const body = {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: systemPrompt,
      messages,
      tools: serverTools,
    };

    const res = await fetch(CLAUDE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429 || res.status === 529) {
      await sleep(Math.min(2000 * Math.pow(2, iter), 30000));
      continue;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Claude API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    messages.push({ role: "assistant", content: data.content });

    // Extract text
    const textBlocks = (data.content || []).filter((b) => b.type === "text").map((b) => b.text);
    if (textBlocks.length > 0) finalText = textBlocks.join("\n");

    // If no tool use, we're done
    const toolBlocks = (data.content || []).filter((b) => b.type === "tool_use");
    if (data.stop_reason !== "tool_use" || toolBlocks.length === 0) break;

    // Execute tool calls against D1 directly
    const toolResults = [];
    for (const block of toolBlocks) {
      let result;
      try {
        result = await executeServerTool(block.name, block.input, env);
      } catch (err) {
        result = JSON.stringify({ error: err.message });
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  console.log("[AutoCron]", `Agent completed for "${rule.name}": ${finalText.slice(0, 200)}`);
  return { path: "agent", text: finalText };
}

/**
 * Execute a tool call directly against D1 (no HTTP round-trip).
 */
async function executeServerTool(toolName, input, env) {
  switch (toolName) {
    case "query_database": {
      const tableId = input.database_id;
      if (!tableId) return JSON.stringify({ error: "database_id required" });

      const { results } = await env.DB.prepare(
        "SELECT id, cells, created_at, updated_at FROM table_rows WHERE table_id = ? AND archived = 0 ORDER BY sort_order, created_at LIMIT 100"
      ).bind(tableId).all();

      const rows = (results || []).map((r) => ({
        id: r.id,
        ...safeParseJSON(r.cells),
        _created: r.created_at,
        _updated: r.updated_at,
      }));

      return JSON.stringify({ count: rows.length, rows });
    }

    case "create_page": {
      const tableId = input.database_id;
      if (!tableId) return JSON.stringify({ error: "database_id required" });

      const id = crypto.randomUUID();
      const cells = input.properties || {};

      await env.DB.prepare(
        "INSERT INTO table_rows (id, table_id, cells, sort_order, metadata, created_at, updated_at) VALUES (?, ?, ?, 0, '{}', datetime('now'), datetime('now'))"
      ).bind(id, tableId, JSON.stringify(cells)).run();

      return JSON.stringify({ success: true, id });
    }

    case "update_page": {
      const rowId = input.page_id;
      const tableId = input.database_id;
      if (!rowId) return JSON.stringify({ error: "page_id required" });

      // Merge cells
      const existing = tableId
        ? await env.DB.prepare("SELECT cells FROM table_rows WHERE id = ? AND table_id = ?").bind(rowId, tableId).first()
        : await env.DB.prepare("SELECT cells FROM table_rows WHERE id = ?").bind(rowId).first();

      const currentCells = existing ? safeParseJSON(existing.cells) : {};
      const merged = { ...currentCells, ...(input.properties || {}) };

      if (tableId) {
        await env.DB.prepare(
          "UPDATE table_rows SET cells = ?, updated_at = datetime('now') WHERE id = ? AND table_id = ?"
        ).bind(JSON.stringify(merged), rowId, tableId).run();
      } else {
        await env.DB.prepare(
          "UPDATE table_rows SET cells = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(JSON.stringify(merged), rowId).run();
      }

      return JSON.stringify({ success: true, id: rowId });
    }

    case "post_notification": {
      const id = crypto.randomUUID();
      const message = input.message || "";
      const type = input.type || "notification";
      const source = input.source || "automation";

      await env.DB.prepare(
        "INSERT INTO notifications (id, message, type, status, source, created_at) VALUES (?, ?, ?, 'unread', ?, datetime('now'))"
      ).bind(id, message, type, source).run();

      return JSON.stringify({ success: true, id });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

/**
 * Simple string hash for snapshot comparison (non-cryptographic, fast).
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return String(hash);
}

/**
 * Expand {{template}} variables in a string.
 */
function expandTemplateServer(template, data) {
  if (!template) return "";
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = data[key];
    if (val === null || val === undefined) return "";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  });
}

function safeParseJSON(str) {
  if (!str) return {};
  if (typeof str === "object") return str;
  try { return JSON.parse(str); }
  catch { return {}; }
}

// ─── Notion Sync Handlers ───

/**
 * Event-driven automation trigger check.
 * Called inline from handleUpdateRow when cells change.
 * Compares old vs new cells to detect field/status changes,
 * then executes matching rules immediately (fast path inline, slow path async).
 */
async function checkAutomationTriggers(env, tableId, rowId, oldCells, newCells) {
  // Find enabled rules that watch this table for field/status changes
  const { results: rules } = await env.DB.prepare(
    `SELECT * FROM automation_rules
     WHERE scope_table_id = ? AND enabled = 1
     AND trigger_type IN ('field_change', 'status_change')`
  ).bind(tableId).all();

  if (!rules || rules.length === 0) return;

  // Detect which fields actually changed
  const changedFields = {};
  const allKeys = new Set([...Object.keys(oldCells), ...Object.keys(newCells)]);
  for (const key of allKeys) {
    const oldVal = oldCells[key] === undefined ? "" : String(oldCells[key]);
    const newVal = newCells[key] === undefined ? "" : String(newCells[key]);
    if (oldVal !== newVal) {
      changedFields[key] = { old: oldCells[key], new: newCells[key] };
    }
  }

  if (Object.keys(changedFields).length === 0) return;

  // Get Claude key for slow-path rules
  let claudeKey = null;
  try {
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'claude'").first();
    claudeKey = row?.value || null;
  } catch {}

  for (const rawRule of rules) {
    const triggerConfig = safeParseJSON(rawRule.trigger_config);
    const actionConfig = safeParseJSON(rawRule.action_config);
    const watchedField = triggerConfig?.field || null;

    // Check if the watched field changed (or any field if no specific watch)
    const relevantChange = watchedField
      ? changedFields[watchedField]
      : Object.keys(changedFields).length > 0;

    if (!relevantChange) continue;

    const changedRecords = [{
      id: rowId,
      cells: newCells,
      changed_field: watchedField || Object.keys(changedFields)[0],
      new_value: watchedField ? newCells[watchedField] : newCells[Object.keys(changedFields)[0]],
    }];

    const rule = {
      id: rawRule.id,
      name: rawRule.name,
      description: rawRule.description || "",
      trigger: rawRule.trigger_type,
      triggerConfig,
      actionConfig,
      instruction: actionConfig.instruction || "",
      databaseId: rawRule.scope_table_id || "",
      enabled: true,
      lastFired: rawRule.last_fired_at,
      fireCount: rawRule.fire_count || 0,
    };

    try {
      await executeRuleServer(rule, changedRecords, claudeKey, env);
      await env.DB.prepare(
        "UPDATE automation_rules SET last_fired_at = datetime('now'), fire_count = fire_count + 1, updated_at = datetime('now') WHERE id = ?"
      ).bind(rule.id).run();

      // Update snapshots so cron doesn't double-fire
      for (const field of Object.keys(changedFields)) {
        const hash = simpleHash(String(newCells[field] ?? ""));
        await env.DB.prepare(
          "INSERT OR REPLACE INTO rule_snapshots (rule_id, record_id, field_name, value_hash, updated_at) VALUES (?, ?, ?, ?, datetime('now'))"
        ).bind(rule.id, rowId, field, hash).run();
      }

      console.log("[AutoTrigger]", `Rule "${rule.name}" fired for row ${rowId}`);
    } catch (err) {
      console.error("[AutoTrigger]", `Rule "${rule.name}" failed:`, err.message);
    }
  }
}

/**
 * Cron-triggered sync flush — processes dirty rows to Notion.
 * Runs alongside the automation tick on every cron invocation.
 */
async function runSyncFlushTick(env) {
  const LOG = "[SyncCron]";
  try {
    const notionKey = await getNotionKeyFromDB(env);
    if (!notionKey) return; // No Notion key configured

    // Check if any dirty rows exist before doing full flush
    const dirty = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM table_rows WHERE sync_dirty = 1 AND archived = 0"
    ).first();
    if (!dirty || dirty.cnt === 0) return;

    console.log(LOG, `${dirty.cnt} dirty row(s) — flushing`);

    // Reuse the flush logic (but we can't return an HTTP response, so call internal)
    const result = await syncFlushInternal(env, notionKey);
    console.log(LOG, `Done: ${result.created} created, ${result.updated} updated, ${result.errors} errors`);
  } catch (err) {
    console.error(LOG, "Flush tick failed:", err.message);
  }
}

/**
 * Internal sync flush logic (shared by cron and HTTP endpoint).
 */
async function syncFlushInternal(env, notionKey) {
  const MAX_ROWS = 10;
  const MAX_CONCURRENT = 3;
  const MAX_RETRIES = 5;

  const { results: dirtyRows } = await env.DB.prepare(
    `SELECT id, table_id, cells, metadata, sync_retry_count
     FROM table_rows
     WHERE sync_dirty = 1 AND archived = 0 AND sync_retry_count < ?
     ORDER BY updated_at ASC LIMIT ?`
  ).bind(MAX_RETRIES, MAX_ROWS).all();

  if (!dirtyRows || dirtyRows.length === 0) {
    return { flushed: 0, created: 0, updated: 0, errors: 0 };
  }

  // Group by table_id to batch-load sync configs
  const tableIds = [...new Set(dirtyRows.map((r) => r.table_id))];
  const configMap = {};
  const schemaMap = {};

  for (const tid of tableIds) {
    const config = await env.DB.prepare(
      "SELECT * FROM sync_configs WHERE table_id = ? AND enabled = 1"
    ).bind(tid).first();
    if (config) {
      configMap[tid] = config;
      const schema = await env.DB.prepare("SELECT columns FROM table_schemas WHERE id = ?").bind(tid).first();
      schemaMap[tid] = schema ? safeParseJSON(schema.columns) : [];
    }
  }

  let created = 0, updated = 0, errors = 0;

  for (let i = 0; i < dirtyRows.length; i += MAX_CONCURRENT) {
    const batch = dirtyRows.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.allSettled(
      batch.map((row) => flushSingleRow(env, row, configMap, schemaMap, notionKey))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value === "created") created++;
        else if (result.value === "updated") updated++;
      } else {
        errors++;
      }
    }
  }

  return { flushed: dirtyRows.length, created, updated, errors };
}

/**
 * Convert Notion database properties to D1 column definitions.
 * Used when auto-creating a table_schemas entry for a linked Notion database.
 */
function notionPropsToD1Columns(notionProps) {
  // Map Notion property types to D1 column types
  // CRITICAL: title→title (not text), status→status (not select)
  // These must match what d1SchemaToClassified() expects
  const typeMap = {
    title: "title", rich_text: "text", number: "number",
    select: "select", multi_select: "multi_select", status: "status",
    date: "date", checkbox: "checkbox", url: "url", email: "email",
    phone_number: "phone", people: "people", files: "files",
    relation: "relation", formula: "text", rollup: "text",
    created_time: "date", last_edited_time: "date",
    created_by: "text", last_edited_by: "text",
    unique_id: "text",
  };

  const columns = [];
  let titleCol = null;

  for (const [name, prop] of Object.entries(notionProps)) {
    const colType = typeMap[prop.type] || "text";
    const col = {
      id: name, // Use Notion property name as column ID for direct mapping
      name: name,
      type: colType,
    };

    // Extract select/multi_select/status options
    if (prop.type === "select" && prop.select?.options) {
      col.options = prop.select.options.map((o) => ({ label: o.name, color: o.color }));
    }
    if (prop.type === "multi_select" && prop.multi_select?.options) {
      col.options = prop.multi_select.options.map((o) => ({ label: o.name, color: o.color }));
    }
    if (prop.type === "status" && prop.status?.options) {
      col.options = prop.status.options.map((o) => ({ label: o.name, color: o.color }));
      if (prop.status?.groups) {
        col.groups = prop.status.groups.map((g) => ({
          name: g.name, color: g.color,
          options: (g.option_ids || []),
        }));
      }
    }

    // Mark computed properties as read-only
    if (["formula", "rollup", "created_time", "last_edited_time", "created_by", "last_edited_by", "unique_id"].includes(prop.type)) {
      col.readOnly = true;
    }

    // Track title column to ensure it's first
    if (prop.type === "title") {
      titleCol = col;
    } else {
      columns.push(col);
    }
  }

  // Title column MUST be first — d1SchemaToClassified uses columns[0] as title
  if (titleCol) {
    columns.unshift(titleCol);
  }

  return columns;
}

/**
 * Configure sync between a D1 table and a Notion database.
 * Creates or updates a sync_configs row + auto-generates field mapping.
 * If no D1 schema exists, auto-creates one from Notion properties.
 */
async function handleSyncConfigure(env, tableId, body, notionKey) {
  const { notion_db_id, direction = "bidirectional", field_mapping } = body;
  if (!notion_db_id) return jsonResponse({ _error: "notion_db_id required" }, 400);
  if (!notionKey) return jsonResponse({ _error: "Notion API key not configured" }, 400);

  // Get Notion database schema FIRST (we need this whether or not D1 schema exists)
  let notionSchema;
  try {
    const res = await fetch(`${NOTION_API}/databases/${notion_db_id}`, {
      headers: {
        Authorization: `Bearer ${notionKey}`,
        "Notion-Version": NOTION_VERSION,
      },
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return jsonResponse({ _error: `Notion API error: ${errBody.message || res.status}` }, 502);
    }
    notionSchema = await res.json();
  } catch (err) {
    return jsonResponse({ _error: `Failed to reach Notion: ${err.message}` }, 502);
  }

  // Always regenerate D1 schema from Notion properties (handles schema drift + type fixes)
  const notionProps = notionSchema.properties || {};
  const columns = notionPropsToD1Columns(notionProps);

  await env.DB.prepare(
    `INSERT INTO table_schemas (id, columns, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET columns = excluded.columns, updated_at = datetime('now')`
  ).bind(tableId, JSON.stringify(columns)).run();

  {
  }

  // Auto-generate field mapping from D1 columns ↔ Notion properties
  let mapping = field_mapping;
  if (!mapping || Object.keys(mapping).length === 0) {
    mapping = {};
    const notionProps = notionSchema.properties || {};
    for (const col of Array.isArray(columns) ? columns : []) {
      const colName = col.name || col.id;
      if (notionProps[colName]) {
        mapping[col.id] = { notion_property: colName, notion_type: notionProps[colName].type };
      } else {
        const match = Object.entries(notionProps).find(
          ([k]) => k.toLowerCase() === colName.toLowerCase()
        );
        if (match) {
          mapping[col.id] = { notion_property: match[0], notion_type: match[1].type };
        }
      }
    }
  }

  // Check for existing config
  const existing = await env.DB.prepare(
    "SELECT id FROM sync_configs WHERE table_id = ?"
  ).bind(tableId).first();

  const id = existing?.id || crypto.randomUUID();

  if (existing) {
    await env.DB.prepare(
      "UPDATE sync_configs SET notion_db_id = ?, direction = ?, field_mapping = ?, enabled = 1 WHERE id = ?"
    ).bind(notion_db_id, direction, JSON.stringify(mapping), id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO sync_configs (id, table_id, notion_db_id, direction, field_mapping, enabled) VALUES (?, ?, ?, ?, ?, 1)"
    ).bind(id, tableId, notion_db_id, direction, JSON.stringify(mapping)).run();
  }

  return jsonResponse({
    id,
    table_id: tableId,
    notion_db_id,
    direction,
    field_mapping: mapping,
    notion_title: notionSchema.title?.[0]?.plain_text || "Untitled",
  });
}

/**
 * Push D1 table rows → Notion pages.
 * Creates new pages or updates existing ones (tracked via row metadata.notion_page_id).
 */
async function handleSyncPush(env, tableId, notionKey) {
  if (!notionKey) return jsonResponse({ _error: "Notion API key not configured" }, 400);

  // Get sync config
  const config = await env.DB.prepare(
    "SELECT * FROM sync_configs WHERE table_id = ? AND enabled = 1"
  ).bind(tableId).first();
  if (!config) return jsonResponse({ _error: "No sync configured for this table" }, 404);

  const fieldMapping = safeParseJSON(config.field_mapping);
  const notionDbId = config.notion_db_id;

  // Get table schema for column name lookup
  const schema = await env.DB.prepare("SELECT columns FROM table_schemas WHERE id = ?").bind(tableId).first();
  const columns = schema ? (Array.isArray(safeParseJSON(schema.columns)) ? safeParseJSON(schema.columns) : []) : [];
  const colMap = {};
  for (const c of columns) colMap[c.id] = c;

  // Get all non-archived rows
  const { results: rows } = await env.DB.prepare(
    "SELECT * FROM table_rows WHERE table_id = ? AND archived = 0"
  ).bind(tableId).all();

  let created = 0, updated = 0, errors = 0;

  for (const row of rows || []) {
    const cells = safeParseJSON(row.cells);
    const metadata = safeParseJSON(row.metadata);
    const notionPageId = metadata.notion_page_id;

    // Build Notion properties from field mapping
    const properties = {};
    for (const [colId, mapping] of Object.entries(fieldMapping)) {
      const value = cells[colId];
      if (value === undefined || value === null) continue;
      const notionProp = mapping.notion_property;
      const notionType = mapping.notion_type;
      properties[notionProp] = buildNotionPropValue(notionType, value);
    }

    try {
      if (notionPageId) {
        // Update existing Notion page
        await fetch(`${NOTION_API}/pages/${notionPageId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${notionKey}`,
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ properties }),
        });
        updated++;
      } else {
        // Create new Notion page
        const res = await fetch(`${NOTION_API}/pages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${notionKey}`,
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            parent: { database_id: notionDbId },
            properties,
          }),
        });
        const page = await res.json();
        if (page.id) {
          // Store Notion page ID in row metadata
          metadata.notion_page_id = page.id;
          metadata.last_synced_at = new Date().toISOString();
          await env.DB.prepare(
            "UPDATE table_rows SET metadata = ? WHERE id = ?"
          ).bind(JSON.stringify(metadata), row.id).run();
          created++;
        } else {
          errors++;
        }
      }
    } catch (err) {
      console.error(`Sync push error for row ${row.id}:`, err.message);
      errors++;
    }
  }

  // Update last synced timestamp
  await env.DB.prepare(
    "UPDATE sync_configs SET last_synced_at = datetime('now') WHERE table_id = ?"
  ).bind(tableId).run();

  return jsonResponse({ pushed: { created, updated, errors }, total: (rows || []).length });
}

/**
 * Pull Notion pages → D1 table rows.
 * Creates new rows or updates existing ones (matched by notion_page_id in metadata).
 */
async function handleSyncPull(env, tableId, notionKey, fullResync = false) {
  if (!notionKey) return jsonResponse({ _error: "Notion API key not configured" }, 400);

  const config = await env.DB.prepare(
    "SELECT * FROM sync_configs WHERE table_id = ? AND enabled = 1"
  ).bind(tableId).first();
  if (!config) return jsonResponse({ _error: "No sync configured for this table" }, 404);

  const fieldMapping = safeParseJSON(config.field_mapping);
  const notionDbId = config.notion_db_id;
  const lastSyncedAt = config.last_synced_at;

  // Get table schema
  const schema = await env.DB.prepare("SELECT columns FROM table_schemas WHERE id = ?").bind(tableId).first();
  const columns = schema ? (Array.isArray(safeParseJSON(schema.columns)) ? safeParseJSON(schema.columns) : []) : [];

  // Get existing rows with notion_page_id
  const { results: existingRows } = await env.DB.prepare(
    "SELECT id, cells, metadata FROM table_rows WHERE table_id = ? AND archived = 0"
  ).bind(tableId).all();

  const notionIdToRowId = {};
  const notionIdToOldCells = {};
  for (const row of existingRows || []) {
    const meta = safeParseJSON(row.metadata);
    if (meta.notion_page_id) {
      notionIdToRowId[meta.notion_page_id] = row.id;
      notionIdToOldCells[meta.notion_page_id] = safeParseJSON(row.cells);
    }
  }

  // Build Notion query — use incremental filter if we have a last_synced_at and not full resync
  const queryBody = { page_size: 100 };
  if (lastSyncedAt && !fullResync) {
    queryBody.filter = {
      timestamp: "last_edited_time",
      last_edited_time: { after: lastSyncedAt },
    };
  }

  // Query pages from Notion database (with pagination)
  let notionPages = [];
  let cursor = undefined;
  do {
    const body = { ...queryBody };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`${NOTION_API}/databases/${notionDbId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionKey}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    notionPages.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  // Refresh schema options from Notion DB metadata (keeps select/status options current)
  try {
    const dbMeta = await fetch(`${NOTION_API}/databases/${notionDbId}`, {
      headers: { Authorization: `Bearer ${notionKey}`, "Notion-Version": NOTION_VERSION },
    });
    if (dbMeta.ok) {
      const dbData = await dbMeta.json();
      const freshColumns = notionPropsToD1Columns(dbData.properties || {});
      // Merge: update options on existing columns, add new columns
      const existingById = {};
      for (const c of columns) existingById[c.id] = c;
      for (const fc of freshColumns) {
        if (existingById[fc.id]) {
          // Update options and type if changed
          existingById[fc.id].options = fc.options || existingById[fc.id].options;
          existingById[fc.id].type = fc.type;
        } else {
          columns.push(fc);
          existingById[fc.id] = fc;
        }
      }
      await env.DB.prepare(
        "UPDATE table_schemas SET columns = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(JSON.stringify(columns), tableId).run();

      // Also add new columns to field mapping
      for (const fc of freshColumns) {
        if (!fieldMapping[fc.id]) {
          fieldMapping[fc.id] = { notion_property: fc.name, notion_type: fc.type };
        }
      }
      await env.DB.prepare(
        "UPDATE sync_configs SET field_mapping = ? WHERE table_id = ?"
      ).bind(JSON.stringify(fieldMapping), tableId).run();
    }
  } catch (err) {
    console.error(`Schema refresh failed for ${tableId}:`, err.message);
  }

  let created = 0, updated = 0, archived = 0, errors = 0;

  // Reverse field mapping: notion_property → col_id
  const reverseMapping = {};
  for (const [colId, mapping] of Object.entries(fieldMapping)) {
    reverseMapping[mapping.notion_property] = colId;
  }

  const seenNotionIds = new Set();

  for (const page of notionPages) {
    seenNotionIds.add(page.id);

    // Handle archived/trashed Notion pages
    if (page.archived) {
      const existingRowId = notionIdToRowId[page.id];
      if (existingRowId) {
        try {
          await env.DB.prepare(
            "UPDATE table_rows SET archived = 1, sync_dirty = 0, updated_at = datetime('now') WHERE id = ?"
          ).bind(existingRowId).run();
          archived++;
        } catch (err) {
          console.error(`Sync pull archive error for page ${page.id}:`, err.message);
          errors++;
        }
      }
      continue;
    }

    const cells = {};
    for (const [propName, propVal] of Object.entries(page.properties || {})) {
      const colId = reverseMapping[propName];
      if (!colId) continue;
      cells[colId] = readNotionPropValue(propVal);
    }

    const existingRowId = notionIdToRowId[page.id];
    const oldCells = notionIdToOldCells[page.id] || {};

    try {
      if (existingRowId) {
        // Merge: preserve local-only fields, overwrite mapped fields from Notion
        const mergedCells = { ...oldCells, ...cells };
        await env.DB.prepare(
          "UPDATE table_rows SET cells = ?, metadata = ?, sync_dirty = 0, updated_at = datetime('now') WHERE id = ?"
        ).bind(
          JSON.stringify(mergedCells),
          JSON.stringify({ notion_page_id: page.id, last_synced_at: new Date().toISOString(), notion_last_edited: page.last_edited_time }),
          existingRowId
        ).run();
        updated++;

        // Fire automation triggers for sync-pulled changes
        checkAutomationTriggers(env, tableId, existingRowId, oldCells, mergedCells).catch((err) =>
          console.error("[AutoTrigger] Sync pull trigger error:", err.message)
        );
      } else {
        // Create new row
        const rowId = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO table_rows (id, table_id, cells, metadata, sync_dirty) VALUES (?, ?, ?, ?, 0)"
        ).bind(
          rowId, tableId, JSON.stringify(cells),
          JSON.stringify({ notion_page_id: page.id, last_synced_at: new Date().toISOString(), notion_last_edited: page.last_edited_time })
        ).run();
        created++;
      }
    } catch (err) {
      console.error(`Sync pull error for page ${page.id}:`, err.message);
      errors++;
    }
  }

  // Handle Notion deletions: on full resync, archive D1 rows whose Notion pages are gone
  if (fullResync) {
    for (const [notionId, rowId] of Object.entries(notionIdToRowId)) {
      if (!seenNotionIds.has(notionId)) {
        try {
          await env.DB.prepare(
            "UPDATE table_rows SET archived = 1, sync_dirty = 0, updated_at = datetime('now') WHERE id = ?"
          ).bind(rowId).run();
          archived++;
        } catch (err) {
          console.error(`Sync pull delete-detect error for row ${rowId}:`, err.message);
        }
      }
    }
  }

  await env.DB.prepare(
    "UPDATE sync_configs SET last_synced_at = datetime('now') WHERE table_id = ?"
  ).bind(tableId).run();

  // Invalidate data summary cache
  invalidateSummaryCache(env, tableId).catch(() => {});

  return jsonResponse({ pulled: { created, updated, archived, errors }, total: notionPages.length, incremental: !fullResync && !!lastSyncedAt });
}

/**
 * Get sync status for a table.
 */
async function handleSyncStatus(env, tableId) {
  const config = await env.DB.prepare(
    "SELECT * FROM sync_configs WHERE table_id = ?"
  ).bind(tableId).first();

  if (!config) return jsonResponse({ configured: false });

  return jsonResponse({
    configured: true,
    id: config.id,
    table_id: config.table_id,
    notion_db_id: config.notion_db_id,
    direction: config.direction,
    field_mapping: safeParseJSON(config.field_mapping),
    last_synced_at: config.last_synced_at,
    enabled: !!config.enabled,
  });
}

/**
 * Remove sync configuration for a table.
 */
async function handleSyncDelete(env, tableId) {
  await env.DB.prepare("DELETE FROM sync_configs WHERE table_id = ?").bind(tableId).run();
  return jsonResponse({ success: true, table_id: tableId });
}

/**
 * Disconnect a page from its external source (Notion, etc).
 * - Deletes sync_configs for the page
 * - Changes page_type from "linked_notion" to "database"
 * - Strips external connection metadata from config (databaseIds, etc)
 * - Clears notion_page_id from row metadata
 * - Data remains in D1 untouched
 * POST /pages/:id/disconnect
 */
async function handleDisconnect(env, pageId) {
  // Verify page exists
  const page = await env.DB.prepare("SELECT * FROM page_configs WHERE id = ?").bind(pageId).first();
  if (!page) return jsonResponse({ _error: "Page not found" }, 404);

  const pageType = page.page_type;
  if (pageType !== "linked_notion") {
    return jsonResponse({ _error: `Cannot disconnect: page_type is "${pageType}", expected "linked_notion"` }, 400);
  }

  // Check sync config exists
  const syncConfig = await env.DB.prepare(
    "SELECT * FROM sync_configs WHERE table_id = ?"
  ).bind(pageId).first();

  // Delete sync config
  if (syncConfig) {
    await env.DB.prepare("DELETE FROM sync_configs WHERE table_id = ?").bind(pageId).run();
  }

  // Update page_type to "database" and strip Notion-specific config
  const config = safeParseJSON(page.config);
  const disconnectedFrom = {
    source: "notion",
    notion_db_id: syncConfig?.notion_db_id || config.databaseIds?.[0] || null,
    disconnected_at: new Date().toISOString(),
    last_synced_at: syncConfig?.last_synced_at || null,
  };
  delete config.databaseIds;
  config.disconnected_from = disconnectedFrom;

  await env.DB.prepare(
    "UPDATE page_configs SET page_type = 'database', config = ? WHERE id = ?"
  ).bind(JSON.stringify(config), pageId).run();

  // Clear all Notion metadata from rows and reset sync_dirty (sever row-level links)
  const { results: rows } = await env.DB.prepare(
    "SELECT id, metadata FROM table_rows WHERE table_id = ?"
  ).bind(pageId).all();

  let clearedRows = 0;
  for (const row of rows || []) {
    const meta = safeParseJSON(row.metadata);
    const hasNotion = meta.notion_page_id || meta.last_synced_at || meta.notion_last_edited;
    if (hasNotion) {
      delete meta.notion_page_id;
      delete meta.last_synced_at;
      delete meta.notion_last_edited;
      await env.DB.prepare(
        "UPDATE table_rows SET metadata = ?, sync_dirty = 0 WHERE id = ?"
      ).bind(JSON.stringify(meta), row.id).run();
      clearedRows++;
    }
  }

  return jsonResponse({
    ok: true,
    page_id: pageId,
    previous_type: pageType,
    new_type: "database",
    sync_config_deleted: !!syncConfig,
    rows_cleared: clearedRows,
    disconnected_from: disconnectedFrom,
  });
}

/**
 * Create a synced backup: creates a new Notion database from D1 schema,
 * pushes all D1 rows to it, and configures ongoing bidirectional sync.
 * Converts page_type from "database" to "linked_notion".
 * POST /pages/:id/sync-backup
 * Body: { parent_page_id } — Notion page ID to create the database under
 */
async function handleSyncBackup(env, pageId, body, notionKey) {
  if (!notionKey) return jsonResponse({ _error: "Notion API key not configured" }, 400);

  const { parent_page_id } = body || {};
  if (!parent_page_id) return jsonResponse({ _error: "parent_page_id required (Notion page to create database under)" }, 400);

  // Verify page exists
  const page = await env.DB.prepare("SELECT * FROM page_configs WHERE id = ?").bind(pageId).first();
  if (!page) return jsonResponse({ _error: "Page not found" }, 404);

  // Check no active sync already exists
  const existingSync = await env.DB.prepare(
    "SELECT id FROM sync_configs WHERE table_id = ? AND enabled = 1"
  ).bind(pageId).first();
  if (existingSync) {
    return jsonResponse({ _error: "Page already has an active sync configuration. Disconnect first to create a new backup." }, 400);
  }

  // Get D1 schema
  const schemaRow = await env.DB.prepare("SELECT columns FROM table_schemas WHERE id = ?").bind(pageId).first();
  if (!schemaRow) return jsonResponse({ _error: "No schema found for this page" }, 404);
  const columns = safeParseJSON(schemaRow.columns);
  if (!columns.length) return jsonResponse({ _error: "Schema has no columns" }, 400);

  // Build Notion database properties from D1 columns
  const notionProperties = d1ColumnsToNotionProperties(columns);

  // Create the Notion database
  const pageTitle = page.name || "Wasabi Backup";
  const createRes = await fetch(`${NOTION_API}/databases`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${notionKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parent_page_id },
      title: [{ type: "text", text: { content: pageTitle } }],
      properties: notionProperties,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    return jsonResponse({ _error: `Failed to create Notion database: ${err.message || createRes.statusText}` }, 502);
  }

  const newDb = await createRes.json();
  const notionDbId = newDb.id;
  const notionDbUrl = newDb.url;

  // Configure sync
  const configBody = { notion_db_id: notionDbId, direction: "bidirectional" };
  const configRes = await handleSyncConfigure(env, pageId, configBody, notionKey);
  const configData = await configRes.json().catch(() => ({}));
  if (configData._error) {
    return jsonResponse({ _error: `Sync config failed: ${configData._error}` }, 500);
  }

  // Push all D1 rows to the new Notion database
  const pushRes = await handleSyncPush(env, pageId, notionKey);
  const pushData = await pushRes.json().catch(() => ({}));

  // Update page_type to linked_notion and store databaseIds in config
  const config = safeParseJSON(page.config);
  config.databaseIds = [notionDbId];
  if (config.disconnected_from) {
    config.previous_connections = config.previous_connections || [];
    config.previous_connections.push(config.disconnected_from);
    delete config.disconnected_from;
  }

  await env.DB.prepare(
    "UPDATE page_configs SET page_type = 'linked_notion', config = ? WHERE id = ?"
  ).bind(JSON.stringify(config), pageId).run();

  return jsonResponse({
    ok: true,
    page_id: pageId,
    notion_db_id: notionDbId,
    notion_db_url: notionDbUrl,
    new_type: "linked_notion",
    push_results: pushData.pushed || {},
    total_rows: pushData.total || 0,
  });
}

/**
 * Convert D1 column definitions to Notion database property definitions.
 * Reverse of notionPropsToD1Columns().
 */
function d1ColumnsToNotionProperties(columns) {
  const properties = {};
  const typeMap = {
    title: "title",
    text: "rich_text",
    number: "number",
    select: "select",
    multi_select: "multi_select",
    status: "status",
    date: "date",
    checkbox: "checkbox",
    url: "url",
    email: "email",
    phone: "phone_number",
  };

  for (const col of columns) {
    const notionType = typeMap[col.type];
    if (!notionType) continue; // Skip types that can't be created in Notion (people, files, relation, etc.)

    if (notionType === "title") {
      // Title property is special in Notion
      properties[col.name] = { title: {} };
    } else if (notionType === "rich_text") {
      properties[col.name] = { rich_text: {} };
    } else if (notionType === "number") {
      properties[col.name] = { number: {} };
    } else if (notionType === "select") {
      const opts = (col.options || []).map((o) => ({
        name: o.label || o.name || String(o),
        color: o.color || "default",
      }));
      properties[col.name] = { select: { options: opts } };
    } else if (notionType === "multi_select") {
      const opts = (col.options || []).map((o) => ({
        name: o.label || o.name || String(o),
        color: o.color || "default",
      }));
      properties[col.name] = { multi_select: { options: opts } };
    } else if (notionType === "status") {
      // Notion API doesn't allow setting status options on create — just define the property
      properties[col.name] = { status: {} };
    } else if (notionType === "date") {
      properties[col.name] = { date: {} };
    } else if (notionType === "checkbox") {
      properties[col.name] = { checkbox: {} };
    } else if (notionType === "url") {
      properties[col.name] = { url: {} };
    } else if (notionType === "email") {
      properties[col.name] = { email: {} };
    } else if (notionType === "phone_number") {
      properties[col.name] = { phone_number: {} };
    }
  }

  return properties;
}

/**
 * Bootstrap sync for all linked Notion databases.
 * Finds page_configs with notion databaseIds that have no sync_config,
 * creates sync configs, generates schemas, and runs full pulls.
 * POST /sync/bootstrap
 */
async function handleSyncBootstrap(env, notionKey) {
  if (!notionKey) return jsonResponse({ _error: "Notion API key not configured" }, 400);

  try {
    // Get all page configs
    const pages = await env.DB.prepare("SELECT * FROM page_configs").all();
    const allPages = pages.results || [];

    // Get existing sync configs to skip already-configured tables
    const syncs = await env.DB.prepare("SELECT table_id FROM sync_configs").all();
    const syncedTableIds = new Set((syncs.results || []).map((s) => s.table_id));

    const results = [];

    for (const page of allPages) {
      // Find pages with linked Notion database IDs
      let dbIds = [];
      try {
        const config = JSON.parse(page.config || "{}");
        const raw = config.databaseIds || config.notion_database_id;
        if (Array.isArray(raw)) dbIds = raw;
        else if (typeof raw === "string" && raw) dbIds = [raw];
      } catch {}

      // Also check top-level notion_database_id
      if (page.notion_database_id) dbIds.push(page.notion_database_id);

      if (!dbIds.length) continue;
      if (syncedTableIds.has(page.id)) {
        results.push({ page_id: page.id, status: "already_synced" });
        continue;
      }

      // Use the first database ID for sync
      const notionDbId = dbIds[0];

      try {
        // Configure sync (this auto-creates schema if missing)
        const configBody = { notion_db_id: notionDbId, direction: "bidirectional" };
        // Call handleSyncConfigure internally
        const configRes = await handleSyncConfigure(env, page.id, configBody, notionKey);
        const configData = await configRes.json().catch(() => ({}));

        if (configData._error) {
          results.push({ page_id: page.id, notion_db: notionDbId, status: "config_error", error: configData._error });
          continue;
        }

        // Run full pull (fix: correct argument order)
        const pullRes = await handleSyncPull(env, page.id, notionKey, true);
        const pullData = await pullRes.json().catch(() => ({}));

        if (pullData._error) {
          results.push({ page_id: page.id, notion_db: notionDbId, status: "pull_error", error: pullData._error });
          continue;
        }

        // Keep page_type as "linked_notion" — the Notion connection is still active.
        // resolveSourceType now returns "d1" for linked_notion pages.

        results.push({
          page_id: page.id,
          notion_db: notionDbId,
          status: "synced",
          rows_created: pullData.created || 0,
          rows_updated: pullData.updated || 0,
        });
      } catch (err) {
        results.push({ page_id: page.id, notion_db: notionDbId, status: "error", error: err.message });
      }
    }

    return jsonResponse({ bootstrapped: results.filter((r) => r.status === "synced").length, results });
  } catch (err) {
    return jsonResponse({ _error: `Bootstrap failed: ${err.message}` }, 500);
  }
}

/**
 * HTTP handler: flush dirty rows to Notion.
 * POST /sync/flush
 */
async function handleSyncFlush(env, notionKey) {
  if (!notionKey) return jsonResponse({ _error: "Notion API key not configured" }, 400);
  const result = await syncFlushInternal(env, notionKey);
  return jsonResponse(result);
}

/**
 * Flush a single dirty row to Notion.
 */
async function flushSingleRow(env, row, configMap, schemaMap, notionKey) {
  const config = configMap[row.table_id];
  if (!config) {
    // No sync config — clear dirty flag (nothing to sync to)
    await env.DB.prepare("UPDATE table_rows SET sync_dirty = 0 WHERE id = ?").bind(row.id).run();
    return "skipped";
  }

  const fieldMapping = safeParseJSON(config.field_mapping);
  const notionDbId = config.notion_db_id;
  const cells = safeParseJSON(row.cells);
  const metadata = safeParseJSON(row.metadata);
  const notionPageId = metadata.notion_page_id;

  // Build Notion properties from field mapping
  const properties = {};
  for (const [colId, mapping] of Object.entries(fieldMapping)) {
    const value = cells[colId];
    if (value === undefined || value === null) continue;
    properties[mapping.notion_property] = buildNotionPropValue(mapping.notion_type, value);
  }

  try {
    if (notionPageId) {
      // Update existing Notion page
      const res = await fetch(`${NOTION_API}/pages/${notionPageId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${notionKey}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ properties }),
      });
      if (!res.ok) throw new Error(`Notion update failed: ${res.status}`);

      // Clear dirty flag
      await env.DB.prepare(
        "UPDATE table_rows SET sync_dirty = 0, sync_retry_count = 0 WHERE id = ?"
      ).bind(row.id).run();
      return "updated";
    } else {
      // Create new Notion page
      const res = await fetch(`${NOTION_API}/pages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${notionKey}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ parent: { database_id: notionDbId }, properties }),
      });
      const page = await res.json();
      if (!page.id) throw new Error("Notion create returned no ID");

      // Store Notion page ID and clear dirty flag
      metadata.notion_page_id = page.id;
      metadata.last_synced_at = new Date().toISOString();
      await env.DB.prepare(
        "UPDATE table_rows SET metadata = ?, sync_dirty = 0, sync_retry_count = 0 WHERE id = ?"
      ).bind(JSON.stringify(metadata), row.id).run();
      return "created";
    }
  } catch (err) {
    console.error(`[SyncFlush] Row ${row.id} failed:`, err.message);
    // Increment retry count
    await env.DB.prepare(
      "UPDATE table_rows SET sync_retry_count = sync_retry_count + 1 WHERE id = ?"
    ).bind(row.id).run();
    throw err;
  }
}

/**
 * Archive a Notion page (called when a D1 row is deleted).
 */
async function archiveNotionPage(env, notionPageId) {
  const notionKey = await getNotionKeyFromDB(env);
  if (!notionKey) return;

  await fetch(`${NOTION_API}/pages/${notionPageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${notionKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ archived: true }),
  });
}

/**
 * Get Notion key from DB connections table (for non-request contexts).
 */
async function getNotionKeyFromDB(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'notion'").first();
    return row?.value || null;
  } catch { return null; }
}

/**
 * Invalidate data summary cache for all pages that use a given table.
 */
async function invalidateSummaryCache(env, tableId) {
  // Find page configs that reference this table
  const { results: pages } = await env.DB.prepare(
    "SELECT id, config FROM page_configs"
  ).all();

  for (const page of (pages || [])) {
    const config = safeParseJSON(page.config);
    // Check if any data source in this page references the table
    const sources = config.dataSources || config.data_sources || [];
    const usesTable = sources.some((s) => s.tableId === tableId || s.table_id === tableId);
    if (usesTable) {
      await env.DB.prepare(
        "DELETE FROM data_summary_cache WHERE page_id = ?"
      ).bind(page.id).run();
    }
  }
}

/**
 * Convert a JS value into a Notion property value object for push.
 */
function buildNotionPropValue(type, value) {
  switch (type) {
    case "title":
      return { title: [{ text: { content: String(value) } }] };
    case "rich_text":
      return { rich_text: [{ text: { content: String(value) } }] };
    case "number":
      return { number: typeof value === "number" ? value : parseFloat(value) || 0 };
    case "select":
      return { select: { name: String(value) } };
    case "multi_select": {
      const items = Array.isArray(value) ? value : String(value).split(",").map((s) => s.trim());
      return { multi_select: items.map((name) => ({ name })) };
    }
    case "status":
      return { status: { name: String(value) } };
    case "date":
      return { date: { start: String(value) } };
    case "checkbox":
      return { checkbox: !!value };
    case "url":
      return { url: String(value) || null };
    case "email":
      return { email: String(value) || null };
    case "phone_number":
      return { phone_number: String(value) || null };
    default:
      return { rich_text: [{ text: { content: String(value) } }] };
  }
}

/**
 * Read a Notion property value into a plain JS value for pull.
 */
function readNotionPropValue(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case "title":
      return (prop.title || []).map((t) => t.plain_text).join("");
    case "rich_text":
      return (prop.rich_text || []).map((t) => t.plain_text).join("");
    case "number":
      return prop.number;
    case "select":
      return prop.select?.name || null;
    case "multi_select":
      return (prop.multi_select || []).map((s) => s.name);
    case "status":
      return prop.status?.name || null;
    case "date":
      return prop.date?.start || null;
    case "checkbox":
      return !!prop.checkbox;
    case "url":
      return prop.url || null;
    case "email":
      return prop.email || null;
    case "phone_number":
      return prop.phone_number || null;
    case "created_time":
      return prop.created_time || null;
    case "last_edited_time":
      return prop.last_edited_time || null;
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TableRoom — Durable Object for real-time collaboration
// One instance per table. Manages WebSocket connections, presence, and change broadcasting.
// ═══════════════════════════════════════════════════════════════════════════════

export class TableRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.tableId = null; // Set from URL on first fetch
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Extract tableId from URL path
    const pathMatch = url.pathname.match(/\/ws\/table\/(.+)$/);
    if (pathMatch && !this.tableId) this.tableId = pathMatch[1];

    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernation API: runtime manages the socket, DO sleeps between messages
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      userId: null, userName: null, role: null, color: null,
      activeRecordId: null, isTyping: false, typingField: null,
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Hibernation handlers (replace addEventListener) ──

  webSocketMessage(ws, message) {
    try {
      const msg = JSON.parse(message);
      this.handleMessage(ws, msg);
    } catch {}
  }

  webSocketClose(ws, code, reason) {
    const session = ws.deserializeAttachment();
    if (session?.userId) {
      this.broadcast({ type: "user_left", userId: session.userId }, ws);
      this.broadcastPresence();
    }
  }

  webSocketError(ws, error) {
    // close handler fires after error — cleanup happens there
  }

  handleMessage(ws, msg) {
    const session = ws.deserializeAttachment();
    if (!session) return;

    switch (msg.type) {
      case "join": {
        session.userId = msg.userId;
        session.userName = msg.userName;
        session.role = msg.role;
        session.color = msg.color;
        ws.serializeAttachment(session);
        this.broadcast({ type: "user_joined", userId: msg.userId, userName: msg.userName, color: msg.color }, ws);
        this.broadcastPresence();
        break;
      }

      case "focus": {
        session.activeRecordId = msg.recordId;
        ws.serializeAttachment(session);
        this.broadcast({ type: "user_focus", userId: session.userId, recordId: msg.recordId }, ws);
        this.broadcastPresence();
        break;
      }

      case "blur": {
        session.activeRecordId = null;
        session.isTyping = false;
        session.typingField = null;
        ws.serializeAttachment(session);
        this.broadcast({ type: "user_blur", userId: session.userId }, ws);
        this.broadcastPresence();
        break;
      }

      case "typing": {
        session.isTyping = true;
        session.typingField = msg.field;
        session.activeRecordId = msg.recordId || session.activeRecordId;
        ws.serializeAttachment(session);
        this.broadcast({ type: "user_typing", userId: session.userId, recordId: session.activeRecordId, field: msg.field }, ws);
        break;
      }

      case "stop_typing": {
        session.isTyping = false;
        session.typingField = null;
        ws.serializeAttachment(session);
        this.broadcast({ type: "user_stop_typing", userId: session.userId }, ws);
        break;
      }

      case "save": {
        // Route save through DO for conflict detection + broadcast
        this.handleSave(ws, session, msg);
        break;
      }
    }
  }

  async handleSave(ws, session, msg) {
    const { recordId, cells, base_versions } = msg;
    const tableId = this.tableId;

    try {
      // Read current row from D1
      const existing = await this.env.DB.prepare(
        "SELECT cells, cell_versions FROM table_rows WHERE id = ? AND table_id = ?"
      ).bind(recordId, tableId).first();

      if (!existing) {
        this.sendTo(ws, { type: "save_error", recordId, error: "Row not found" });
        return;
      }

      const currentCells = JSON.parse(existing.cells || "{}");
      const currentVersions = JSON.parse(existing.cell_versions || "{}");
      const baseVersions = base_versions || {};

      const accepted = {};
      const conflicts = {};
      const newVersions = { ...currentVersions };

      for (const [field, value] of Object.entries(cells || {})) {
        const currentV = currentVersions[field] || 0;
        const baseV = baseVersions[field];

        if (baseV === undefined || baseV >= currentV) {
          accepted[field] = value;
          newVersions[field] = currentV + 1;
        } else {
          conflicts[field] = {
            yourValue: value,
            currentValue: currentCells[field],
            currentVersion: currentV,
          };
        }
      }

      // Write accepted fields to D1
      if (Object.keys(accepted).length > 0) {
        const mergedCells = { ...currentCells, ...accepted };
        await this.env.DB.prepare(
          `UPDATE table_rows SET cells = ?, cell_versions = ?, updated_at = datetime('now'), updated_by = ?, sync_dirty = 1
           WHERE id = ? AND table_id = ?`
        ).bind(JSON.stringify(mergedCells), JSON.stringify(newVersions), session.userId, recordId, tableId).run();

        // Broadcast accepted changes to all OTHER clients
        this.broadcast({
          type: "record_updated",
          recordId,
          cells: accepted,
          cell_versions: newVersions,
          updatedBy: session.userId,
          updatedByName: session.userName,
        }, ws);
      }

      // Send result back to the saving client
      this.sendTo(ws, {
        type: "save_result",
        recordId,
        accepted,
        conflicts: Object.keys(conflicts).length ? conflicts : undefined,
        cell_versions: newVersions,
      });

      // Send conflict messages for conflicted fields
      if (Object.keys(conflicts).length > 0) {
        for (const [field, info] of Object.entries(conflicts)) {
          this.sendTo(ws, {
            type: "conflict",
            recordId,
            field,
            yourValue: info.yourValue,
            theirValue: info.currentValue,
            currentVersion: info.currentVersion,
          });
        }
      }
    } catch (err) {
      this.sendTo(ws, { type: "save_error", recordId, error: err.message });
    }
  }

  broadcast(msg, excludeWs) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === excludeWs) continue;
      const session = ws.deserializeAttachment();
      if (!session?.userId) continue; // Skip unjoined connections
      try { ws.send(data); } catch {}
    }
  }

  sendTo(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }

  broadcastPresence() {
    const allWs = this.ctx.getWebSockets();
    const users = [];
    const joinedSockets = [];

    for (const ws of allWs) {
      const session = ws.deserializeAttachment();
      if (!session?.userId) continue;
      joinedSockets.push(ws);
      users.push({
        userId: session.userId,
        userName: session.userName,
        color: session.color,
        activeRecordId: session.activeRecordId,
        isTyping: session.isTyping,
        typingField: session.typingField,
      });
    }

    const data = JSON.stringify({ type: "presence", users });
    for (const ws of joinedSockets) {
      try { ws.send(data); } catch {}
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UserRoom — Durable Object for multi-device sync
// One instance per user. Manages WebSocket connections across all devices.
// Syncs dashboard layout, navigation state, and session revocation.
// ═══════════════════════════════════════════════════════════════════════════════

export class UserRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // HTTP broadcast endpoint (server-initiated messages, e.g., session revocation)
    if (request.method === "POST" && url.pathname === "/broadcast") {
      return this.handleBroadcast(request);
    }

    // WebSocket upgrade
    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const sessionId = url.searchParams.get("sid") || "";
    const deviceInfo = url.searchParams.get("device") || "unknown";

    // Hibernation API: runtime manages the socket, DO sleeps between messages
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ sessionId, deviceInfo, connectedAt: Date.now() });

    // Send device list to all (including new connection)
    this.broadcastDeviceList();

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Hibernation handlers (replace addEventListener) ──

  webSocketMessage(ws, message) {
    try {
      const msg = JSON.parse(message);
      this.handleMessage(ws, msg);
    } catch {}
  }

  webSocketClose(ws, code, reason) {
    this.broadcastDeviceList();
  }

  webSocketError(ws, error) {
    // close handler fires after error — cleanup happens there
  }

  handleMessage(sender, msg) {
    switch (msg.type) {
      case "dashboard_update":
      case "nav_update":
      case "task_cache_invalidate":
        // Relay to all OTHER connections (not sender)
        this.broadcast(msg, sender);
        break;
      case "ping":
        this.sendTo(sender, { type: "pong" });
        break;
    }
  }

  async handleBroadcast(request) {
    try {
      const msg = await request.json();
      if (msg.type === "session_revoked") {
        const revokeAll = msg.sessionIds?.includes("*");
        for (const ws of this.ctx.getWebSockets()) {
          const session = ws.deserializeAttachment();
          if (revokeAll || msg.sessionIds?.includes(session?.sessionId)) {
            this.sendTo(ws, msg);
            try { ws.close(4001, "Session revoked"); } catch {}
          }
        }
      } else {
        for (const ws of this.ctx.getWebSockets()) {
          try { ws.send(JSON.stringify(msg)); } catch {}
        }
      }
    } catch {}
    return new Response("ok");
  }

  broadcast(msg, excludeWs) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === excludeWs) continue;
      try { ws.send(data); } catch {}
    }
  }

  sendTo(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }

  broadcastDeviceList() {
    const allWs = this.ctx.getWebSockets();
    const devices = [];
    for (const ws of allWs) {
      const session = ws.deserializeAttachment();
      if (session) {
        devices.push({
          sessionId: session.sessionId,
          deviceInfo: session.deviceInfo,
          connectedAt: session.connectedAt,
        });
      }
    }
    const data = JSON.stringify({ type: "devices", devices });
    for (const ws of allWs) {
      try { ws.send(data); } catch {}
    }
  }
}
