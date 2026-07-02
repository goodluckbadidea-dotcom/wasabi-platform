// ─── Auth Middleware & Route Permissions ───
import { verifyJwt } from './crypto.js';

// Extract user from JWT in Authorization header OR HttpOnly cookie (returns null if no JWT)
// Also validates session hasn't been revoked (multi-device session management)
export async function extractUser(request, env) {
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

// ─── Auth Middleware ───
// Accepts either X-Wasabi-Key (MCP server, backward compat) or a valid JWT (browser clients).
export async function authenticate(request, env) {
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
export const ROLE_LEVEL = { admin: 3, editor: 2, viewer: 1 };

export function requireRole(user, minRole) {
  if (!user) return false; // No identity = no access (MCP uses synthetic admin user)
  return (ROLE_LEVEL[user.role] || 0) >= (ROLE_LEVEL[minRole] || 99);
}

// ─── Route Permission Map (first match wins) ───
// minRole: "admin" | "editor" | "viewer" | null (null = no role check, any authenticated user)
export const ROUTE_PERMISSIONS = [
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
  // Schema — editor for mutations
  { pattern: /^\/pages\/[^/]+\/schema$/, method: "PATCH", minRole: "editor" },
  // Page config — editor for create/update, admin for delete
  { pattern: "/pages", method: "POST", minRole: "editor", exact: true },
  { pattern: /^\/pages\/[^/]+$/, method: "PATCH", minRole: "editor" },
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
  // Task snoozes — editor for mutations
  { pattern: /^\/task-snoozes/, method: "POST", minRole: "editor" },
  { pattern: /^\/task-snoozes\//, method: "DELETE", minRole: "editor" },
  // Task pins (admin-managed priority) — admin for mutations. GET is
  // viewer+ so users can read their own pins; the route handler enforces
  // the admin check when the request is targeted at another user's pins.
  { pattern: /^\/task-pins$/, method: "POST", minRole: "admin" },
  { pattern: /^\/task-pins\//, method: "DELETE", minRole: "admin" },
  // Sheets — editor for linked sheet proxy
  { pattern: /^\/sheets\/fetch$/, method: "POST", minRole: "editor" },
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
  // Knowledge base — editor for mutations
  { pattern: /^\/d1\/kb/, method: "POST", minRole: "editor" },
  { pattern: /^\/d1\/kb/, method: "PATCH", minRole: "editor" },
  { pattern: /^\/d1\/kb/, method: "DELETE", minRole: "editor" },
  // Custom functions — editor for mutations
  { pattern: /^\/d1\/custom-functions/, method: "POST", minRole: "editor" },
  { pattern: /^\/d1\/custom-functions/, method: "PATCH", minRole: "editor" },
  { pattern: /^\/d1\/custom-functions/, method: "DELETE", minRole: "editor" },
  // Extensions — editor for template/snapshot mutations, admin for deletes,
  // viewer for reads. The HTML-serving route (/extensions/{ext_slug}/{snap_slug})
  // is matched pre-auth in worker.js and bypasses this table entirely.
  { pattern: /^\/extensions\/snapshots\/[^/]+$/, method: "DELETE", minRole: "admin" },
  { pattern: /^\/extensions\/[^/]+$/, method: "DELETE", minRole: "admin" },
  { pattern: /^\/extensions/, method: "POST", minRole: "editor" },
  { pattern: /^\/extensions/, method: "PATCH", minRole: "editor" },
  { pattern: /^\/extensions/, method: "DELETE", minRole: "admin" },
  { pattern: /^\/extensions/, method: "GET", minRole: null },
  // Neurons — editor for mutations
  { pattern: /^\/neurons/, method: "POST", minRole: "editor" },
  { pattern: /^\/neurons/, method: "PATCH", minRole: "editor" },
  { pattern: /^\/neurons/, method: "DELETE", minRole: "editor" },
  // Cell links — editor for mutations
  { pattern: /^\/links/, method: "POST", minRole: "editor" },
  { pattern: /^\/links/, method: "PATCH", minRole: "editor" },
  { pattern: /^\/links/, method: "DELETE", minRole: "editor" },
  // Relationships — editor for mutations (GET falls through to default, edge-level
  // permission filter enforced inside handleListRelationships)
  // Rebuild is admin-only (slate-clears all projection edges + re-runs projectors)
  { pattern: "/relationships/rebuild", method: "POST", minRole: "admin", exact: true },
  { pattern: /^\/relationships/, method: "POST", minRole: "editor" },
  { pattern: /^\/relationships/, method: "DELETE", minRole: "editor" },
  // Sync — editor for all mutations
  { pattern: /^\/sync\//, method: "POST", minRole: "editor" },
  { pattern: /^\/sync\//, method: "DELETE", minRole: "editor" },
  // Disconnect & Sync Backup — editor
  { pattern: /^\/pages\/[^/]+\/disconnect$/, method: "POST", minRole: "editor" },
  { pattern: /^\/pages\/[^/]+\/sync-backup$/, method: "POST", minRole: "editor" },
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

export function checkRoutePermission(path, method, user) {
  if (!user) return false; // No identity = no access (MCP uses synthetic admin user)
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
export async function getFreshRole(env, user) {
  if (!user?.sub) return null;
  const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(user.sub).first();
  return row?.role || user.role;
}

// ─── Tier 2: Page-Level Permission Check ───
const PERM_LEVEL = { owner: 4, editor: 3, viewer: 2, none: 0 };

export async function checkPagePermission(env, user, pageId, requiredLevel) {
  if (!user) return false;                   // No identity = no access (MCP uses synthetic admin user)
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
export async function checkPinProtection(env, user, request, tableId) {
  if (!user) return false;                     // No identity = no access (MCP uses synthetic admin user)
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
