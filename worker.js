// ─── Wasabi Platform Cloudflare Worker ───
// Backend with D1 storage, optional Notion + Claude proxy.
// Auth via shared secret (X-Wasabi-Key header).

import { NOTION_API, NOTION_VERSION, CLAUDE_API, D1_SCHEMA, D1_INDEXES } from './worker/schema.js';
import { getCorsHeaders } from './worker/cors.js';
import { signJwt, verifyJwt, buildAuthCookie, buildClearAuthCookie, hashPassword, verifyPassword, base64UrlEncode, base64UrlDecode, REFRESH_TOKEN_DAYS, ACCESS_TOKEN_MINS } from './worker/crypto.js';
import { extractUser, authenticate, checkRoutePermission, getFreshRole, checkPagePermission, checkPinProtection, ROLE_LEVEL, requireRole } from './worker/auth.js';
import { checkRateLimit, recordRateLimitAttempt, clearRateLimit } from './worker/rate-limit.js';
import { createJsonResponse, safeParseJSON, sleep, resolveRecordTitle } from './worker/utils.js';
import { handleListKB, handleCreateKB, handleGetKB, handleUpdateKB, handleDeleteKB, handleSearchKB } from './worker/handlers/knowledge-base.js';
import { handleGetConnections, handleSetConnection, handleDeleteConnection } from './worker/handlers/connections.js';
import { handleSetPin, handleVerifyPin } from './worker/handlers/pin.js';
import { handleGetUserState, handlePutUserState, handleGetUserDashboard, handlePutUserDashboard, handlePutRecordView, handleGetRecordViews } from './worker/handlers/user-state.js';
import { createNotificationInternal, extractMentions, handleListNotifications, handleCreateNotification, handleGetNotification, handleUpdateNotification, handleDeleteNotification } from './worker/handlers/notifications.js';
import { handleListSessions, handleRevokeSession, handleLogoutOtherSessions, handleLogoutAllDevices } from './worker/handlers/sessions.js';
import { handleListTaskActivity, handleGetTaskActivity, handleUpsertTaskActivity, handleLogInteraction, handleListInteractions, handleGetInteractionSummary } from './worker/handlers/interactions.js';
import { handleGetDoc, handleSaveDoc, handleUpdateDocBlocks, handleExportDocNotion } from './worker/handlers/documents.js';
import { handleFileUpload, handleListFiles, handleGetFile, handleDeleteFile } from './worker/handlers/files.js';
import { handleAuthRegister, handleAuthLogin, handleAuthMe, handleAuthRefresh } from './worker/handlers/auth.js';
import { handleCreateInvite, handleUserDirectory, handleListUsers, handleDeleteUser, handleRestoreUser, handleHardDeleteUser, handleResetUserPassword, handleUpdateUser } from './worker/handlers/users.js';
import { handleListCustomFunctions, handleCreateCustomFunction, handleGetCustomFunction, handleUpdateCustomFunction, handleDeleteCustomFunction, handleExternalApiProxy, validatePluginCodeServer } from './worker/handlers/custom-functions.js';
import { handleListRules, handleCreateRule, handleGetRule, handleUpdateRule, handleDeleteRule, handleListFlows, handleCreateFlow, handleGetFlow, handleUpdateFlow, handleDeleteFlow, handleListFunctionExecutions, handleCreateFunctionExecution, handleListFlowExecutions, handleCreateFlowExecution, handleUpdateFlowExecution } from './worker/handlers/automations.js';
import { handleListComments, handleCreateComment, handleDeleteComment } from './worker/handlers/records.js';
import { handleGoogleAuthUrl, handleGoogleCallback, handleGoogleStatus, handleGoogleDisconnect, handleGmailSummary, handleGmailSearch, handleGmailGetMessage, handleGmailGetThread, handleGmailUpdateDraft, handleGmailSend, handleGmailCreateDraft, handleGmailModify, handleCalendarSummary, handleCalendarList, handleCalendarListEvents, handleCalendarCreateEvent, handleCalendarUpdateEvent, handleCalendarDeleteEvent, handleCalendarFreeBusy, fetchGoogleSheetViaApi } from './worker/handlers/google.js';
import { handleMicrosoftAuthUrl, handleMicrosoftCallback, handleMicrosoftStatus, handleMicrosoftDisconnect } from './worker/handlers/microsoft.js';
import { handleOutlookSummary, handleOutlookSearch, handleOutlookGetMessage, handleOutlookGetThread, handleOutlookSend, handleOutlookModify, handleOutlookCreateDraft, handleOutlookUpdateDraft, handleOutlookFreeBusy, handleOutlookCalendarSummary, handleOutlookListEvents, handleOutlookCreateEvent, handleOutlookUpdateEvent, handleOutlookDeleteEvent } from './worker/handlers/outlook.js';
import { handleFigmaStatus, handleFigmaProjects, handleFigmaFiles, handleFigmaFile, handleFigmaImport, handleFigmaListComments, handleFigmaPostComment, handleFigmaDeleteComment, handleFigmaListLinksForRecord, handleFigmaListLinksForComment, handleFigmaCreateLink, handleFigmaDeleteLink } from './worker/handlers/figma.js';
import { runAutomationTick, checkAutomationTriggers, runNeuronPruneTick } from './worker/automation/engine.js';
import { runSyncFlushTick, handleSyncConfigure, handleSyncPush, handleSyncPull, handleSyncStatus, handleSyncDelete, handleDisconnect, handleSyncBackup, handleSyncBootstrap, handleSyncFlush, getNotionKeyFromDB, invalidateSummaryCache } from './worker/handlers/notion-sync.js';
import { handleListPages, handleCreatePage, handleGetSummaryCache, handleSetSummaryCache, handleGetPage, handleUpdatePage, handleReorderPages, handleDeletePage } from './worker/handlers/pages.js';
import { handleGetSchema, handleUpdateSchema, handleListRows, handleCreateRows, handleUpdateRow, handleDeleteRow, handleQueryTable } from './worker/handlers/tables.js';
import { handleListRelationships, handleCreateRelationship, handleDeleteRelationship, handleRebuildRelationships } from './worker/handlers/relationships.js';
import { emitProjectedEdge, deleteProjectedEdge, deleteAllProjectedEdgesByTarget, refToFieldId, mapNeuronNodeTypeToEntityType, resolveRecordPageId } from './worker/handlers/relationshipProjections.js';
import { handleHealth, handleInit, handleFactoryReset } from './worker/handlers/init.js';
import {
  handleListExtensions, handleGetExtension, handleCreateExtension, handleUpdateExtension, handleDeleteExtension,
  handleListSnapshots, handleGetSnapshot, handleGenerateSnapshot, handleUpdateSnapshot, handleDeleteSnapshot,
  handlePublishSnapshot, handleGetSnapshotData, handleServeSnapshotHtml,
  handleAddSnapshotLink, handleListSnapshotLinks,
} from './worker/handlers/extensions.js';


// ─── Record title resolution ───
// Finds the display title from a row's cells by checking the schema's title column,
// then falling back to common field name patterns.
// resolveRecordTitle moved to worker/utils.js


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


// ─── Get Notion key: from D1 connections or request header ───
async function getNotionKey(request, env) {
  // Check Authorization header — only accept if it's actually a Notion key (ntn_/secret_ prefix).
  // JWTs also arrive via Authorization header (from apiFetch), so we must not treat those as Notion keys.
  const authHeader = request.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (match) {
    const headerKey = match[1];
    if (headerKey.startsWith("ntn_") || headerKey.startsWith("secret_")) return headerKey;
  }
  // Fall through to D1 connections table
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
    ctx.waitUntil(runNeuronPruneTick(env));
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
    const cors = getCorsHeaders(request, env);
    const jsonResponse = createJsonResponse(cors);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ─── Public Routes (no auth required) ───

      // Health check
      if (path === "/health" && request.method === "GET") {
        return await handleHealth(env, jsonResponse);
      }

      // Extension snapshot HTML serving (pre-auth — visibility check is in handler).
      // Path: /extensions/{ext_slug}/{snap_slug} (no `/api/` prefix; this is the
      // viewable URL). Workspace-visibility snapshots still need an authenticated
      // user; public-visibility snapshots are reachable without auth.
      const extServeMatch = path.match(/^\/extensions\/([^/]+)\/([^/]+)\/?$/);
      if (extServeMatch && request.method === "GET") {
        // Don't intercept the snapshot-data subroute or known subpaths
        if (extServeMatch[1] !== "snapshots" && extServeMatch[2] !== "snapshots") {
          const preUser = await extractUser(request, env);
          return await handleServeSnapshotHtml(env, extServeMatch[1], extServeMatch[2], preUser, cors);
        }
      }

      // Google OAuth callback (browser redirect — no auth header)
      if (path === "/google/callback" && request.method === "GET") {
        return await handleGoogleCallback(request, env, jsonResponse);
      }

      // Microsoft OAuth — auth URL (login mode: no auth; link mode: extracts JWT from header)
      if (path === "/auth/microsoft" && request.method === "GET") {
        const msUser = await extractUser(request, env); // null if not authenticated — ok for login mode
        return await handleMicrosoftAuthUrl(request, env, msUser, jsonResponse);
      }

      // Microsoft OAuth callback (browser redirect — no auth header)
      if (path === "/auth/microsoft/callback" && request.method === "GET") {
        return await handleMicrosoftCallback(request, env, jsonResponse);
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
        return await handleInit(env, jsonResponse);
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
          ? await handleAuthRegister(env, body, jsonResponse)
          : await handleAuthLogin(env, body, jsonResponse);
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
        return await handleAuthMe(env, user, jsonResponse);
      }
      if (path === "/auth/refresh" && request.method === "POST") {
        const user = await extractUser(request, env);
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleAuthRefresh(env, user, jsonResponse);
      }

      // ─── Auth Gate ───
      if (!(await authenticate(request, env))) {
        return jsonResponse({ _error: "Unauthorized" }, 401);
      }

      // ─── Role Gate (centralized permission check) ───
      // Extract user from JWT. If no JWT but auth passed (MCP key or no-secret setup), use synthetic admin.
      const jwtUser = await extractUser(request, env);
      const isMcpOrSetup = !jwtUser && (
        !env.WASABI_SECRET || // First-time setup (no secret configured yet)
        request.headers.get("X-Wasabi-Key") === env.WASABI_SECRET // MCP server key
      );
      const user = jwtUser || (isMcpOrSetup ? { sub: "__mcp__", role: "admin", name: "MCP Server" } : null);
      if (!checkRoutePermission(path, request.method, user)) {
        return jsonResponse({ _error: "Insufficient permissions" }, 403);
      }

      // ─── User Directory (any authenticated user) ───
      if (path === "/users/directory" && request.method === "GET") {
        return await handleUserDirectory(env, jsonResponse);
      }

      // ─── User Management (admin only — role enforced by middleware) ───
      if (path === "/users/invite" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateInvite(env, body, jsonResponse);
      }
      if (path === "/users" && request.method === "GET") {
        return await handleListUsers(env, jsonResponse);
      }
      if (path.match(/^\/users\/[^/]+$/) && request.method === "DELETE") {
        const userId = path.split("/users/")[1];
        const result = await handleDeleteUser(env, userId, user, jsonResponse);
        if (result.status === 200) await auditLog(env, user, "delete_user", "user", userId, {});
        return result;
      }
      if (path.match(/^\/users\/[^/]+$/) && request.method === "PATCH") {
        const userId = path.split("/users/")[1];
        const body = await request.json();
        const result = await handleUpdateUser(env, userId, body, jsonResponse);
        if (result.status === 200) await auditLog(env, user, "update_user", "user", userId, { changes: body });
        return result;
      }
      if (path.match(/^\/users\/[^/]+\/restore$/) && request.method === "POST") {
        const userId = path.split("/users/")[1].split("/restore")[0];
        const result = await handleRestoreUser(env, userId, jsonResponse);
        if (result.status === 200) await auditLog(env, user, "restore_user", "user", userId, {});
        return result;
      }
      if (path.match(/^\/users\/[^/]+\/hard-delete$/) && request.method === "POST") {
        const userId = path.split("/users/")[1].split("/hard-delete")[0];
        const body = await request.json();
        const result = await handleHardDeleteUser(env, userId, body, jsonResponse);
        if (result.status === 200) await auditLog(env, user, "hard_delete_user", "user", userId, { transfer_to: body?.transfer_to });
        return result;
      }
      if (path.match(/^\/users\/[^/]+\/reset$/) && request.method === "POST") {
        const userId = path.split("/users/")[1].split("/reset")[0];
        const result = await handleResetUserPassword(env, userId, jsonResponse);
        if (result.status === 200) await auditLog(env, user, "reset_password", "user", userId, {});
        return result;
      }

      // ─── PIN Lock (role enforced by middleware) ───
      if (path === "/pin/set" && request.method === "POST") {
        const body = await request.json();
        const result = await handleSetPin(env, body, jsonResponse);
        if (result.status === 200) await auditLog(env, user, "set_pin", "system", "", {});
        return result;
      }
      if (path === "/pin/verify" && request.method === "POST") {
        const body = await request.json();
        return await handleVerifyPin(env, body, user, jsonResponse);
      }

      // ─── Session Management (multi-device) ───
      if (path === "/sessions" && request.method === "GET") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleListSessions(env, user, jsonResponse);
      }
      if (path.match(/^\/sessions\/[^/]+$/) && request.method === "DELETE") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        const sessionId = path.split("/sessions/")[1];
        return await handleRevokeSession(env, user, sessionId, jsonResponse);
      }
      if (path === "/sessions/logout-all" && request.method === "POST") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleLogoutOtherSessions(env, user, jsonResponse);
      }
      if (path === "/sessions/logout-all-devices" && request.method === "POST") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleLogoutAllDevices(env, user, jsonResponse);
      }

      // ─── Per-User State ───
      if (path === "/user-state" && request.method === "GET") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleGetUserState(env, user, jsonResponse);
      }
      if (path === "/user-state" && request.method === "PUT") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        const body = await request.json();
        return await handlePutUserState(env, user, body, jsonResponse);
      }

      // ─── Per-User Dashboard ───
      if (path === "/user-dashboard" && request.method === "GET") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleGetUserDashboard(env, user, jsonResponse);
      }
      if (path === "/user-dashboard" && request.method === "PUT") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        const body = await request.json();
        return await handlePutUserDashboard(env, user, body, jsonResponse);
      }

      // ─── Record Views ───
      if (path.match(/^\/record-views\/[^/]+$/) && request.method === "PUT") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        const recordId = path.split("/record-views/")[1];
        return await handlePutRecordView(env, user, recordId, jsonResponse);
      }
      if (path === "/record-views" && request.method === "GET") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleGetRecordViews(env, user, url, jsonResponse);
      }

      // ─── Connections CRUD ───
      if (path === "/connections" && request.method === "GET") {
        return await handleGetConnections(env, jsonResponse);
      }
      if (path === "/connections" && request.method === "POST") {
        const body = await request.json();
        return await handleSetConnection(env, body, jsonResponse);
      }
      if (path.startsWith("/connections/") && request.method === "DELETE") {
        const key = path.split("/connections/")[1];
        return await handleDeleteConnection(env, key, jsonResponse);
      }

      // ─── Figma API Proxy ───
      if (path === "/figma/status" && request.method === "GET") {
        return await handleFigmaStatus(env, jsonResponse);
      }
      if (path === "/figma/projects" && request.method === "GET") {
        return await handleFigmaProjects(env, jsonResponse);
      }
      // /figma/comment-links (Phase 3b) — must come before /figma/files
      // routes so the path matcher doesn't accidentally swallow it.
      if (path === "/figma/comment-links" && request.method === "GET") {
        const recordId = url.searchParams.get("record_id");
        const commentId = url.searchParams.get("comment_id");
        if (recordId) return await handleFigmaListLinksForRecord(env, recordId, jsonResponse);
        if (commentId) return await handleFigmaListLinksForComment(env, commentId, jsonResponse);
        return jsonResponse({ _error: "record_id or comment_id query param required" }, 400);
      }
      if (path === "/figma/comment-links" && request.method === "POST") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        const body = await request.json().catch(() => ({}));
        return await handleFigmaCreateLink(env, body, user, jsonResponse);
      }
      if (path.startsWith("/figma/comment-links/") && request.method === "DELETE") {
        const linkId = path.split("/")[3];
        return await handleFigmaDeleteLink(env, linkId, jsonResponse);
      }

      // /figma/files/:fileKey/comments (Phase 2)
      // MUST come before the catch-all /figma/files GET handler below, which
      // would otherwise match /figma/files/:key/comments and fall through to
      // "Missing project ID".
      if (path.startsWith("/figma/files/") && path.includes("/comments")) {
        const parts = path.split("/"); // ["", "figma", "files", ":key", "comments", ":id?"]
        const fileKey = parts[3];
        const commentId = parts[5];
        if (fileKey && parts[4] === "comments") {
          if (!commentId && request.method === "GET") {
            return await handleFigmaListComments(env, fileKey, jsonResponse);
          }
          if (!commentId && request.method === "POST") {
            if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
            const body = await request.json().catch(() => ({}));
            return await handleFigmaPostComment(env, fileKey, body, user, jsonResponse);
          }
          if (commentId && request.method === "DELETE") {
            return await handleFigmaDeleteComment(env, fileKey, commentId, jsonResponse);
          }
        }
      }

      if (path.startsWith("/figma/files") && request.method === "GET") {
        const parts = path.split("/");
        if (parts.length === 4) {
          // /figma/files/:fileKey — get single file metadata
          return await handleFigmaFile(env, parts[3], jsonResponse);
        }
        // /figma/files?project=X — list files in project
        const projectId = url.searchParams.get("project");
        return await handleFigmaFiles(env, projectId, jsonResponse);
      }

      if (path === "/figma/import" && request.method === "POST") {
        const body = await request.json();
        return await handleFigmaImport(env, body, user?.sub, jsonResponse);
      }

      // ─── Microsoft OAuth (per-user) ───
      if (path === "/microsoft/status" && request.method === "GET") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleMicrosoftStatus(env, user.sub, jsonResponse);
      }
      if (path === "/microsoft/disconnect" && request.method === "POST") {
        if (!user) return jsonResponse({ _error: "Not authenticated" }, 401);
        return await handleMicrosoftDisconnect(env, user.sub, jsonResponse);
      }

      // ─── Google OAuth + API Proxy (per-user) ───
      if (path === "/google/auth-url" && request.method === "GET") {
        return handleGoogleAuthUrl(request, env, user?.sub, jsonResponse);
      }
      if (path === "/google/status" && request.method === "GET") {
        return await handleGoogleStatus(env, user?.sub, jsonResponse);
      }
      if (path === "/google/disconnect" && request.method === "POST") {
        return await handleGoogleDisconnect(env, user?.sub, request, jsonResponse);
      }
      // Gmail proxy (per-user — role enforced by middleware)
      {
        const gUid = user?.sub;
        if (path === "/google/gmail/summary" && request.method === "GET") {
          return await handleGmailSummary(env, gUid, jsonResponse);
        }
        if (path === "/google/gmail/messages" && request.method === "POST") {
          const body = await request.json();
          return await handleGmailSearch(env, body, gUid, jsonResponse);
        }
        if (path.match(/^\/google\/gmail\/messages\/[^/]+$/) && request.method === "GET") {
          const msgId = path.split("/google/gmail/messages/")[1];
          return await handleGmailGetMessage(env, msgId, gUid, jsonResponse);
        }
        if (path === "/google/gmail/send" && request.method === "POST") {
          const body = await request.json();
          return await handleGmailSend(env, body, gUid, jsonResponse);
        }
        if (path.match(/^\/google\/gmail\/threads\/[^/]+$/) && request.method === "GET") {
          const threadId = path.split("/google/gmail/threads/")[1];
          return await handleGmailGetThread(env, threadId, gUid, jsonResponse);
        }
        if (path === "/google/gmail/drafts" && request.method === "POST") {
          const body = await request.json();
          return await handleGmailCreateDraft(env, body, gUid, jsonResponse);
        }
        if (path.match(/^\/google\/gmail\/drafts\/[^/]+$/) && request.method === "PUT") {
          const draftId = path.split("/google/gmail/drafts/")[1];
          const body = await request.json();
          return await handleGmailUpdateDraft(env, draftId, body, gUid, jsonResponse);
        }
        if (path.match(/^\/google\/gmail\/modify\/[^/]+$/) && request.method === "POST") {
          const msgId = path.split("/google/gmail/modify/")[1];
          const body = await request.json();
          return await handleGmailModify(env, msgId, body, gUid, jsonResponse);
        }
        // Calendar proxy (per-user)
        if (path === "/google/calendar/list" && request.method === "GET") {
          return await handleCalendarList(env, gUid, jsonResponse);
        }
        if (path === "/google/calendar/summary" && request.method === "GET") {
          return await handleCalendarSummary(env, gUid, jsonResponse);
        }
        if (path === "/google/calendar/events" && request.method === "GET") {
          const params = Object.fromEntries(url.searchParams);
          return await handleCalendarListEvents(env, params, gUid, jsonResponse);
        }
        if (path === "/google/calendar/events" && request.method === "POST") {
          const body = await request.json();
          return await handleCalendarCreateEvent(env, body, gUid, jsonResponse);
        }
        if (path.match(/^\/google\/calendar\/events\/[^/]+$/) && request.method === "PATCH") {
          const eventId = path.split("/google/calendar/events/")[1];
          const body = await request.json();
          return await handleCalendarUpdateEvent(env, eventId, body, gUid, jsonResponse);
        }
        if (path.match(/^\/google\/calendar\/events\/[^/]+$/) && request.method === "DELETE") {
          const eventId = path.split("/google/calendar/events/")[1];
          return await handleCalendarDeleteEvent(env, eventId, gUid, jsonResponse);
        }
        if (path === "/google/calendar/freebusy" && request.method === "POST") {
          const body = await request.json();
          return await handleCalendarFreeBusy(env, body, gUid, jsonResponse);
        }
      }

      // ─── Microsoft Outlook + Calendar (per-user) ───
      {
        const msUid = user?.sub;
        if (path === "/microsoft/mail/summary" && request.method === "GET") {
          return await handleOutlookSummary(env, msUid, jsonResponse);
        }
        if (path === "/microsoft/mail/messages" && request.method === "POST") {
          const body = await request.json();
          return await handleOutlookSearch(env, body, msUid, jsonResponse);
        }
        if (path.match(/^\/microsoft\/mail\/messages\/[^/]+$/) && request.method === "GET") {
          const msgId = path.split("/microsoft/mail/messages/")[1];
          return await handleOutlookGetMessage(env, msgId, msUid, jsonResponse);
        }
        if (path.match(/^\/microsoft\/mail\/conversations\/[^/]+$/) && request.method === "GET") {
          const convId = path.split("/microsoft/mail/conversations/")[1];
          return await handleOutlookGetThread(env, convId, msUid, jsonResponse);
        }
        if (path === "/microsoft/mail/send" && request.method === "POST") {
          const body = await request.json();
          return await handleOutlookSend(env, body, msUid, jsonResponse);
        }
        if (path.match(/^\/microsoft\/mail\/modify\/[^/]+$/) && request.method === "POST") {
          const msgId = path.split("/microsoft/mail/modify/")[1];
          const body = await request.json();
          return await handleOutlookModify(env, msgId, body, msUid, jsonResponse);
        }
        if (path === "/microsoft/mail/drafts" && request.method === "POST") {
          const body = await request.json();
          return await handleOutlookCreateDraft(env, body, msUid, jsonResponse);
        }
        if (path.match(/^\/microsoft\/mail\/drafts\/[^/]+$/) && request.method === "PATCH") {
          const msgId = path.split("/microsoft/mail/drafts/")[1];
          const body = await request.json();
          return await handleOutlookUpdateDraft(env, msgId, body, msUid, jsonResponse);
        }
        if (path === "/microsoft/calendar/freebusy" && request.method === "POST") {
          const body = await request.json();
          return await handleOutlookFreeBusy(env, body, msUid, jsonResponse);
        }
        if (path === "/microsoft/calendar/summary" && request.method === "GET") {
          return await handleOutlookCalendarSummary(env, msUid, jsonResponse);
        }
        if (path === "/microsoft/calendar/events" && request.method === "GET") {
          const params = Object.fromEntries(url.searchParams);
          return await handleOutlookListEvents(env, params, msUid, jsonResponse);
        }
        if (path === "/microsoft/calendar/events" && request.method === "POST") {
          const body = await request.json();
          return await handleOutlookCreateEvent(env, body, msUid, jsonResponse);
        }
        if (path.match(/^\/microsoft\/calendar\/events\/[^/]+$/) && request.method === "PATCH") {
          const eventId = path.split("/microsoft/calendar/events/")[1];
          const body = await request.json();
          return await handleOutlookUpdateEvent(env, eventId, body, msUid, jsonResponse);
        }
        if (path.match(/^\/microsoft\/calendar\/events\/[^/]+$/) && request.method === "DELETE") {
          const eventId = path.split("/microsoft/calendar/events/")[1];
          return await handleOutlookDeleteEvent(env, eventId, msUid, jsonResponse);
        }
      }

      // ─── Page Config CRUD ───
      // Summary cache route matched before single-page routes
      const summaryMatch = path.match(/^\/pages\/([^/]+)\/summary$/);
      if (summaryMatch && request.method === "GET") {
        return await handleGetSummaryCache(env, summaryMatch[1], jsonResponse);
      }
      if (summaryMatch && request.method === "PUT") {
        const body = await request.json();
        return await handleSetSummaryCache(env, summaryMatch[1], body, jsonResponse);
      }

      // Schema routes matched before single-page routes to avoid ID collision
      const schemaMatch = path.match(/^\/pages\/([^/]+)\/schema$/);
      if (schemaMatch) {
        const id = schemaMatch[1];
        if (request.method === "GET") return await handleGetSchema(env, id, jsonResponse);
        if (request.method === "PATCH") {
          if (!await checkPagePermission(env, user, id, "owner")) {
            return jsonResponse({ _error: "You don't have permission to edit this schema" }, 403);
          }
          const body = await request.json();
          return await handleUpdateSchema(env, id, body, jsonResponse);
        }
      }

      if (path === "/pages" && request.method === "GET") {
        return await handleListPages(env, user, jsonResponse);
      }
      if (path === "/pages" && request.method === "POST") {
        const body = await request.json();
        return await handleCreatePage(env, body, user, jsonResponse);
      }
      const pageConfigMatch = path.match(/^\/pages\/([^/]+)$/);
      if (pageConfigMatch) {
        const id = pageConfigMatch[1];
        if (request.method === "GET") return await handleGetPage(env, id, jsonResponse);
        if (request.method === "PATCH") {
          if (!await checkPagePermission(env, user, id, "owner")) {
            return jsonResponse({ _error: "You don't have permission to edit this page" }, 403);
          }
          const body = await request.json();
          return await handleUpdatePage(env, id, body, jsonResponse);
        }
        if (request.method === "DELETE") {
          if (!await checkPagePermission(env, user, id, "owner")) {
            return jsonResponse({ _error: "You don't have permission to delete this page" }, 403);
          }
          return await handleDeletePage(env, id, jsonResponse);
        }
      }

      // ─── Batch Reorder Pages ───
      if (path === "/pages/reorder" && request.method === "POST") {
        const body = await request.json();
        return await handleReorderPages(env, body, jsonResponse);
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
          return await handleUpdateRow(env, tableId, rowId, body, user, jsonResponse);
        }
        if (request.method === "DELETE") {
          if (!await checkPagePermission(env, user, tableId, "editor")) {
            return jsonResponse({ _error: "You don't have permission to delete rows in this table" }, 403);
          }
          if (!await checkPinProtection(env, user, request, tableId)) {
            return jsonResponse({ _error: "PIN verification required", pin_required: true }, 403);
          }
          return await handleDeleteRow(env, tableId, rowId, url.searchParams.get("cascade"), url.searchParams.get("confirm_dependents") === "1", jsonResponse);
        }
      }

      const tableRowsMatch = path.match(/^\/tables\/([^/]+)\/rows$/);
      if (tableRowsMatch) {
        const tableId = tableRowsMatch[1];
        if (request.method === "GET") {
          if (!await checkPagePermission(env, user, tableId, "viewer")) {
            return jsonResponse({ _error: "You don't have access to this table" }, 403);
          }
          return await handleListRows(env, tableId, url, jsonResponse);
        }
        if (request.method === "POST") {
          if (!await checkPagePermission(env, user, tableId, "editor")) {
            return jsonResponse({ _error: "You don't have permission to add rows to this table" }, 403);
          }
          if (!await checkPinProtection(env, user, request, tableId)) {
            return jsonResponse({ _error: "PIN verification required", pin_required: true }, 403);
          }
          const body = await request.json();
          return await handleCreateRows(env, tableId, body, user, jsonResponse);
        }
      }

      const queryMatch = path.match(/^\/tables\/([^/]+)\/query$/);
      if (queryMatch && request.method === "POST") {
        const tableId = queryMatch[1];
        const body = await request.json();
        return await handleQueryTable(env, tableId, body, jsonResponse);
      }

      const commentDeleteMatch = path.match(/^\/records\/([^/]+)\/comments\/([^/]+)$/);
      if (commentDeleteMatch && request.method === "DELETE") {
        const [, recordId, commentId] = commentDeleteMatch;
        return await handleDeleteComment(env, user, recordId, commentId, jsonResponse);
      }

      const commentMatch = path.match(/^\/records\/([^/]+)\/comments$/);
      if (commentMatch) {
        const recordId = commentMatch[1];
        if (request.method === "GET") {
          const pageConfigId = url.searchParams.get("page_config_id");
          return await handleListComments(env, recordId, pageConfigId, jsonResponse);
        }
        if (request.method === "POST") {
          const body = await request.json();
          return await handleCreateComment(env, user, recordId, body, jsonResponse);
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
          return await handleGetTaskActivity(env, taskId, source, jsonResponse);
        }
        if (request.method === "PUT") {
          const body = await request.json();
          return await handleUpsertTaskActivity(env, taskId, body, jsonResponse);
        }
      }
      if (path === "/task-activity" && request.method === "GET") {
        const source = url.searchParams.get("source");
        return await handleListTaskActivity(env, source, jsonResponse);
      }

      // ─── Task Interaction Journal Routes ───
      const interactionSummaryMatch = path.match(/^\/task-interactions\/([^/]+)\/summary$/);
      if (interactionSummaryMatch && request.method === "GET") {
        return await handleGetInteractionSummary(env, interactionSummaryMatch[1], jsonResponse);
      }
      if (path === "/task-interactions" && request.method === "POST") {
        const body = await request.json();
        return await handleLogInteraction(env, body, jsonResponse);
      }
      if (path === "/task-interactions" && request.method === "GET") {
        return await handleListInteractions(env, url, jsonResponse);
      }

      // ─── Task Snooze Routes ───
      const snoozeDeleteMatch = path.match(/^\/task-snoozes\/(.+)$/);
      if (snoozeDeleteMatch && request.method === "DELETE") {
        const id = decodeURIComponent(snoozeDeleteMatch[1]);
        await env.DB.prepare("DELETE FROM task_snoozes WHERE id = ?").bind(id).run();
        return jsonResponse({ ok: true });
      }
      if (path === "/task-snoozes" && request.method === "POST") {
        const body = await request.json();
        const { task_id, source, user_id, snooze_until, reason } = body;
        if (!task_id || !user_id || !snooze_until) {
          return jsonResponse({ error: "task_id, user_id, and snooze_until are required" }, 400);
        }
        const id = `${task_id}:${user_id}`;
        await env.DB.prepare(
          "INSERT INTO task_snoozes (id, task_id, source, user_id, snooze_until, reason) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET snooze_until = excluded.snooze_until, reason = excluded.reason"
        ).bind(id, task_id, source || "", user_id, snooze_until, reason || null).run();
        return jsonResponse({ ok: true, id });
      }
      if (path === "/task-snoozes" && request.method === "GET") {
        const userId = url.searchParams.get("user_id");
        if (!userId) return jsonResponse({ error: "user_id required" }, 400);
        const result = await env.DB.prepare(
          "SELECT * FROM task_snoozes WHERE user_id = ? AND snooze_until > datetime('now') ORDER BY snooze_until ASC"
        ).bind(userId).all();
        return jsonResponse({ snoozes: result.results || [] });
      }

      // ─── Document (R2) Routes ───
      const docBlocksMatch = path.match(/^\/docs\/([^/]+)\/blocks$/);
      if (docBlocksMatch && request.method === "PATCH") {
        const id = docBlocksMatch[1];
        const body = await request.json();
        return await handleUpdateDocBlocks(env, id, body, jsonResponse);
      }

      const docExportMatch = path.match(/^\/docs\/([^/]+)\/export\/notion$/);
      if (docExportMatch && request.method === "GET") {
        const id = docExportMatch[1];
        return await handleExportDocNotion(env, id, jsonResponse);
      }

      const docMatch = path.match(/^\/docs\/([^/]+)$/);
      if (docMatch) {
        const id = docMatch[1];
        if (request.method === "GET") return await handleGetDoc(env, id, jsonResponse);
        if (request.method === "PUT") {
          const body = await request.json();
          return await handleSaveDoc(env, id, body, jsonResponse);
        }
      }

      // ─── D1 Automation Rules CRUD ───
      const ruleMatch = path.match(/^\/d1\/rules\/([^/]+)$/);
      if (ruleMatch) {
        const id = ruleMatch[1];
        if (request.method === "GET") return await handleGetRule(env, id, jsonResponse);
        if (request.method === "PATCH") {
          const body = await request.json();
          return await handleUpdateRule(env, id, body, jsonResponse);
        }
        if (request.method === "DELETE") return await handleDeleteRule(env, id, jsonResponse);
      }

      if (path === "/d1/rules" && request.method === "GET") {
        return await handleListRules(env, url, jsonResponse);
      }
      if (path === "/d1/rules" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateRule(env, body, jsonResponse);
      }

      // ─── D1 Automation Flows CRUD ───
      const flowMatch = path.match(/^\/d1\/flows\/([^/]+)$/);
      if (flowMatch) {
        const id = flowMatch[1];
        if (request.method === "GET") return await handleGetFlow(env, id, jsonResponse);
        if (request.method === "PATCH") {
          const body = await request.json();
          return await handleUpdateFlow(env, id, body, jsonResponse);
        }
        if (request.method === "DELETE") return await handleDeleteFlow(env, id, jsonResponse);
      }

      if (path === "/d1/flows" && request.method === "GET") {
        return await handleListFlows(env, url, jsonResponse);
      }
      if (path === "/d1/flows" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateFlow(env, body, jsonResponse);
      }

      // ─── D1 Notifications ───
      if (path === "/d1/notifications" && request.method === "GET") {
        return await handleListNotifications(env, url, user, jsonResponse);
      }
      if (path === "/d1/notifications" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateNotification(env, body, jsonResponse);
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
        if (request.method === "GET") return await handleGetNotification(env, id, jsonResponse);
        if (request.method === "PATCH") {
          const body = await request.json();
          return await handleUpdateNotification(env, id, body, jsonResponse);
        }
        if (request.method === "DELETE") return await handleDeleteNotification(env, id, jsonResponse);
      }

      // ─── D1 Knowledge Base CRUD ───
      const kbMatch = path.match(/^\/d1\/kb\/([^/]+)$/);
      if (kbMatch) {
        const id = kbMatch[1];
        if (request.method === "GET") return await handleGetKB(env, id, jsonResponse);
        if (request.method === "PATCH") {
          const body = await request.json();
          return await handleUpdateKB(env, id, body, jsonResponse);
        }
        if (request.method === "DELETE") return await handleDeleteKB(env, id, jsonResponse);
      }

      if (path === "/d1/kb" && request.method === "GET") {
        return await handleListKB(env, url, jsonResponse);
      }
      if (path === "/d1/kb" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateKB(env, body, jsonResponse);
      }
      if (path === "/d1/kb/search" && request.method === "POST") {
        const body = await request.json();
        return await handleSearchKB(env, body, jsonResponse);
      }

      // ─── Custom Functions CRUD ───
      if (path === "/d1/custom-functions" && request.method === "GET") {
        return await handleListCustomFunctions(env, url, jsonResponse);
      }
      if (path === "/d1/custom-functions" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateCustomFunction(env, body, jsonResponse);
      }
      const cfMatch = path.match(/^\/d1\/custom-functions\/([^/]+)$/);
      if (cfMatch && request.method === "GET") {
        return await handleGetCustomFunction(env, decodeURIComponent(cfMatch[1]), jsonResponse);
      }
      if (cfMatch && request.method === "PATCH") {
        const body = await request.json();
        return await handleUpdateCustomFunction(env, decodeURIComponent(cfMatch[1]), body, jsonResponse);
      }
      if (cfMatch && request.method === "DELETE") {
        return await handleDeleteCustomFunction(env, decodeURIComponent(cfMatch[1]), jsonResponse);
      }

      // ─── Extensions (custom-coded report templates) ───
      // List + create templates
      if (path === "/extensions" && request.method === "GET") {
        return await handleListExtensions(env, url, jsonResponse);
      }
      if (path === "/extensions" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateExtension(env, body, user, jsonResponse);
      }
      // Snapshot subroutes — match before the generic /extensions/:id pattern.
      const snapByIdMatch = path.match(/^\/extensions\/snapshots\/([^/]+)$/);
      const snapDataMatch = path.match(/^\/extensions\/snapshots\/([^/]+)\/data$/);
      const snapPublishMatch = path.match(/^\/extensions\/snapshots\/([^/]+)\/publish$/);
      const snapLinksMatch = path.match(/^\/extensions\/snapshots\/([^/]+)\/links$/);
      if (path === "/extensions/snapshots" && request.method === "GET") {
        return await handleListSnapshots(env, url, null, jsonResponse);
      }
      if (snapDataMatch && request.method === "GET") {
        return await handleGetSnapshotData(env, decodeURIComponent(snapDataMatch[1]), jsonResponse);
      }
      if (snapPublishMatch && request.method === "POST") {
        return await handlePublishSnapshot(env, decodeURIComponent(snapPublishMatch[1]), user, jsonResponse);
      }
      if (snapLinksMatch && request.method === "GET") {
        return await handleListSnapshotLinks(env, decodeURIComponent(snapLinksMatch[1]), jsonResponse);
      }
      if (snapLinksMatch && request.method === "POST") {
        const body = await request.json();
        return await handleAddSnapshotLink(env, decodeURIComponent(snapLinksMatch[1]), body, user, jsonResponse);
      }
      if (snapByIdMatch && request.method === "GET") {
        return await handleGetSnapshot(env, decodeURIComponent(snapByIdMatch[1]), jsonResponse);
      }
      if (snapByIdMatch && request.method === "PATCH") {
        const body = await request.json();
        return await handleUpdateSnapshot(env, decodeURIComponent(snapByIdMatch[1]), body, jsonResponse);
      }
      if (snapByIdMatch && request.method === "DELETE") {
        return await handleDeleteSnapshot(env, decodeURIComponent(snapByIdMatch[1]), jsonResponse);
      }
      // Per-extension snapshot list + generation
      const extSnapsMatch = path.match(/^\/extensions\/([^/]+)\/snapshots$/);
      if (extSnapsMatch && request.method === "GET") {
        return await handleListSnapshots(env, url, decodeURIComponent(extSnapsMatch[1]), jsonResponse);
      }
      if (extSnapsMatch && request.method === "POST") {
        const body = await request.json();
        return await handleGenerateSnapshot(env, decodeURIComponent(extSnapsMatch[1]), body, user, jsonResponse);
      }
      // Extension by id or slug
      const extByIdMatch = path.match(/^\/extensions\/([^/]+)$/);
      if (extByIdMatch && request.method === "GET") {
        return await handleGetExtension(env, decodeURIComponent(extByIdMatch[1]), jsonResponse);
      }
      if (extByIdMatch && request.method === "PATCH") {
        const body = await request.json();
        return await handleUpdateExtension(env, decodeURIComponent(extByIdMatch[1]), body, jsonResponse);
      }
      if (extByIdMatch && request.method === "DELETE") {
        return await handleDeleteExtension(env, decodeURIComponent(extByIdMatch[1]), jsonResponse);
      }

      // ─── Function Executions (Audit Trail) ───
      if (path === "/d1/function-executions" && request.method === "GET") {
        return await handleListFunctionExecutions(env, url, jsonResponse);
      }
      if (path === "/d1/function-executions" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateFunctionExecution(env, body, jsonResponse);
      }

      // ─── Flow Executions ───
      if (path === "/d1/flow-executions" && request.method === "GET") {
        return await handleListFlowExecutions(env, url, jsonResponse);
      }
      if (path === "/d1/flow-executions" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateFlowExecution(env, body, jsonResponse);
      }
      const fexMatch = path.match(/^\/d1\/flow-executions\/([^/]+)$/);
      if (fexMatch && request.method === "PATCH") {
        const body = await request.json();
        return await handleUpdateFlowExecution(env, decodeURIComponent(fexMatch[1]), body, jsonResponse);
      }

      // ─── External API Proxy ───

      if (path === "/proxy/external-api" && request.method === "POST") {
        return await handleExternalApiProxy(env, await request.json(), jsonResponse);
      }

      // ─── Neurons CRUD ───

      // GET /neurons/hydrated — neurons with actual field values from connected records
      if (path === "/neurons/hydrated" && request.method === "GET") {
        const url = new URL(request.url);
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "30", 10), 50);

        // 1. Fetch neurons
        const { results: neurons } = await env.DB.prepare(
          "SELECT * FROM neurons ORDER BY updated_at DESC LIMIT ?"
        ).bind(limit).all();
        if (!neurons.length) return jsonResponse({ neurons: [] });

        const neuronIds = neurons.map(n => n.id);

        // 2. Fetch nodes + joined row data
        const placeholders = neuronIds.map(() => "?").join(",");
        const { results: nodesWithRows } = await env.DB.prepare(
          `SELECT nn.*, tr.cells, tr.table_id
           FROM neuron_nodes nn
           LEFT JOIN table_rows tr ON nn.node_id = tr.id
           WHERE nn.neuron_id IN (${placeholders})
           ORDER BY nn.neuron_id, nn.created_at`
        ).bind(...neuronIds).all();

        // 3. Collect page_config IDs we need: table_ids (for column defs) + page/folder/doc nodes
        const configIdsNeeded = new Set();
        for (const nd of nodesWithRows) {
          if (nd.table_id) configIdsNeeded.add(nd.table_id);
          if (nd.page_config_id) configIdsNeeded.add(nd.page_config_id);
          if (["page", "folder", "document"].includes(nd.node_type)) configIdsNeeded.add(nd.node_id);
        }

        // 4. Fetch page configs for column definitions and page names
        let configMap = {};
        if (configIdsNeeded.size > 0) {
          const cfgIds = [...configIdsNeeded];
          const cfgPlaceholders = cfgIds.map(() => "?").join(",");
          const { results: configs } = await env.DB.prepare(
            `SELECT id, title, config FROM page_configs WHERE id IN (${cfgPlaceholders})`
          ).bind(...cfgIds).all();
          for (const c of configs) configMap[c.id] = c;
        }

        // 5. Key field heuristic: pick up to 3 fields by column type priority
        const TYPE_PRIORITY = { status: 0, select: 1, date: 2, number: 3 };
        function pickKeyFields(cells, tableId) {
          if (!cells || !tableId) return null;
          const cfg = configMap[tableId];
          if (!cfg) return null;
          let columns;
          try { columns = JSON.parse(cfg.config || "{}").columns; } catch { return null; }
          if (!columns?.length) return null;

          let cellObj;
          try { cellObj = typeof cells === "string" ? JSON.parse(cells) : cells; } catch { return null; }

          // Sort columns by type priority, pick top 3 that have values
          const ranked = columns
            .filter(c => TYPE_PRIORITY[c.type] !== undefined && cellObj[c.id] != null && cellObj[c.id] !== "")
            .sort((a, b) => (TYPE_PRIORITY[a.type] ?? 99) - (TYPE_PRIORITY[b.type] ?? 99));

          const fields = {};
          for (const col of ranked.slice(0, 3)) {
            fields[col.name] = cellObj[col.id];
          }
          return Object.keys(fields).length > 0 ? fields : null;
        }

        // 6. Assemble response
        const nodesByNeuron = {};
        for (const nd of nodesWithRows) {
          if (!nodesByNeuron[nd.neuron_id]) nodesByNeuron[nd.neuron_id] = [];
          if (nodesByNeuron[nd.neuron_id].length >= 10) continue; // cap 10 nodes per neuron

          let hydrated = null;
          if (nd.cells && nd.table_id) {
            // Row node — extract key fields
            hydrated = pickKeyFields(nd.cells, nd.table_id);
          } else if (["page", "folder", "document"].includes(nd.node_type)) {
            // Page/folder/document node — use title
            const pc = configMap[nd.node_id];
            if (pc) hydrated = { title: pc.title };
          }

          // Resolve page name for context
          const pageCfg = configMap[nd.page_config_id] || configMap[nd.table_id];
          const pageName = pageCfg?.title || null;

          nodesByNeuron[nd.neuron_id].push({
            node_id: nd.node_id,
            node_type: nd.node_type,
            node_label: nd.node_label,
            page_config_id: nd.page_config_id,
            page_name: pageName,
            hydrated,
          });
        }

        return jsonResponse({
          neurons: neurons.map(n => ({
            id: n.id,
            name: n.name,
            nodes: nodesByNeuron[n.id] || [],
          })),
        });
      }

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

      // GET /neurons/:id/hydrated — single neuron with hydrated field values
      const hydratedSingleMatch = path.match(/^\/neurons\/([^/]+)\/hydrated$/);
      if (hydratedSingleMatch && request.method === "GET") {
        const neuronId = hydratedSingleMatch[1];
        const neuron = await env.DB.prepare("SELECT * FROM neurons WHERE id = ?").bind(neuronId).first();
        if (!neuron) return jsonResponse({ _error: "Neuron not found" }, 404);

        const { results: nodesWithRows } = await env.DB.prepare(
          `SELECT nn.*, tr.cells, tr.table_id
           FROM neuron_nodes nn
           LEFT JOIN table_rows tr ON nn.node_id = tr.id
           WHERE nn.neuron_id = ?
           ORDER BY nn.created_at`
        ).bind(neuronId).all();

        // Collect config IDs needed
        const configIdsNeeded = new Set();
        for (const nd of nodesWithRows) {
          if (nd.table_id) configIdsNeeded.add(nd.table_id);
          if (nd.page_config_id) configIdsNeeded.add(nd.page_config_id);
          if (["page", "folder", "document"].includes(nd.node_type)) configIdsNeeded.add(nd.node_id);
        }

        let configMap = {};
        if (configIdsNeeded.size > 0) {
          const cfgIds = [...configIdsNeeded];
          const cfgPlaceholders = cfgIds.map(() => "?").join(",");
          const { results: configs } = await env.DB.prepare(
            `SELECT id, title, config FROM page_configs WHERE id IN (${cfgPlaceholders})`
          ).bind(...cfgIds).all();
          for (const c of configs) configMap[c.id] = c;
        }

        const TYPE_PRIORITY = { status: 0, select: 1, date: 2, number: 3 };
        function pickKeyFields(cells, tableId) {
          if (!cells || !tableId) return null;
          const cfg = configMap[tableId];
          if (!cfg) return null;
          let columns;
          try { columns = JSON.parse(cfg.config || "{}").columns; } catch { return null; }
          if (!columns?.length) return null;
          let cellObj;
          try { cellObj = typeof cells === "string" ? JSON.parse(cells) : cells; } catch { return null; }
          const ranked = columns
            .filter(c => TYPE_PRIORITY[c.type] !== undefined && cellObj[c.id] != null && cellObj[c.id] !== "")
            .sort((a, b) => (TYPE_PRIORITY[a.type] ?? 99) - (TYPE_PRIORITY[b.type] ?? 99));
          const fields = {};
          for (const col of ranked.slice(0, 3)) {
            fields[col.name] = cellObj[col.id];
          }
          return Object.keys(fields).length > 0 ? fields : null;
        }

        const hydratedNodes = nodesWithRows.map((nd) => {
          let hydrated = null;
          if (nd.cells && nd.table_id) {
            hydrated = pickKeyFields(nd.cells, nd.table_id);
          } else if (["page", "folder", "document"].includes(nd.node_type)) {
            const pc = configMap[nd.node_id];
            if (pc) hydrated = { title: pc.title };
          }
          const pageCfg = configMap[nd.page_config_id] || configMap[nd.table_id];
          return {
            node_id: nd.node_id,
            node_type: nd.node_type,
            node_label: nd.node_label,
            page_config_id: nd.page_config_id,
            page_name: pageCfg?.title || null,
            hydrated,
          };
        });

        return jsonResponse({
          id: neuron.id,
          name: neuron.name,
          nodes: hydratedNodes,
        });
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
        // Live projection: mirror as a 'member_of_neuron' edge
        const sourceType = mapNeuronNodeTypeToEntityType(node.node_type);
        if (sourceType && node.node_id) {
          let sourcePageId = node.page_config_id || null;
          if (sourceType === "record" && !sourcePageId) {
            sourcePageId = await resolveRecordPageId(env, node.node_id);
          }
          await emitProjectedEdge(env, {
            type: "member_of_neuron",
            origin: "projected_neuron_node",
            source_type: sourceType, source_id: node.node_id, source_page_id: sourcePageId,
            target_type: "neuron", target_id: neuronId, target_page_id: null,
            meta: node.node_label ? { node_label: node.node_label } : null,
          });
        }
        return jsonResponse({ id: nodeRowId }, 201);
      }

      // DELETE /neurons/:neuronId/nodes/by-node-id/:nodeId — remove node by entity ID
      const removeByEntityMatch = path.match(/^\/neurons\/([^/]+)\/nodes\/by-node-id\/(.+)$/);
      if (removeByEntityMatch && request.method === "DELETE") {
        const [, neuronId, rawNodeId] = removeByEntityMatch;
        const nodeId = decodeURIComponent(rawNodeId);
        await env.DB.prepare("DELETE FROM neuron_nodes WHERE neuron_id = ? AND node_id = ?").bind(neuronId, nodeId).run();
        await env.DB.prepare("UPDATE neurons SET updated_at = datetime('now') WHERE id = ?").bind(neuronId).run();
        // Live projection: delete edges with source_id=nodeId pointing at this neuron
        // (origin filter ensures native edges are never touched)
        try {
          await env.DB.prepare(
            `DELETE FROM relationships
              WHERE type = 'member_of_neuron'
                AND origin = 'projected_neuron_node'
                AND source_id = ?
                AND target_type = 'neuron' AND target_id = ?`
          ).bind(nodeId, neuronId).run();
        } catch (err) { console.error("[relationships] neuron node delete projection failed:", err.message || err); }
        return jsonResponse({ ok: true });
      }

      // DELETE /neurons/:id/nodes/:nodeId — remove a node from a neuron
      const removeNodeMatch = path.match(/^\/neurons\/([^/]+)\/nodes\/([^/]+)$/);
      if (removeNodeMatch && request.method === "DELETE") {
        const [, neuronId, nodeRowId] = removeNodeMatch;
        // Look up the node before deletion so we know which entity edge to remove
        const preNode = await env.DB.prepare(
          "SELECT node_id FROM neuron_nodes WHERE id = ? AND neuron_id = ?"
        ).bind(nodeRowId, neuronId).first();
        await env.DB.prepare("DELETE FROM neuron_nodes WHERE id = ? AND neuron_id = ?").bind(nodeRowId, neuronId).run();
        await env.DB.prepare("UPDATE neurons SET updated_at = datetime('now') WHERE id = ?").bind(neuronId).run();
        if (preNode?.node_id) {
          try {
            await env.DB.prepare(
              `DELETE FROM relationships
                WHERE type = 'member_of_neuron'
                  AND origin = 'projected_neuron_node'
                  AND source_id = ?
                  AND target_type = 'neuron' AND target_id = ?`
            ).bind(preNode.node_id, neuronId).run();
          } catch (err) { console.error("[relationships] neuron node delete projection failed:", err.message || err); }
        }
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
          // Live projection: nuke every member_of_neuron edge pointing at this neuron
          await deleteAllProjectedEdgesByTarget(env, {
            target_type: "neuron", target_id: id, origin: "projected_neuron_node",
          });
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
          // Live projection: mirror as a 'member_of_neuron' edge
          const sourceType = mapNeuronNodeTypeToEntityType(node.node_type);
          if (sourceType && node.node_id) {
            let sourcePageId = node.page_config_id || null;
            if (sourceType === "record" && !sourcePageId) {
              sourcePageId = await resolveRecordPageId(env, node.node_id);
            }
            await emitProjectedEdge(env, {
              type: "member_of_neuron",
              origin: "projected_neuron_node",
              source_type: sourceType, source_id: node.node_id, source_page_id: sourcePageId,
              target_type: "neuron", target_id: neuronId, target_page_id: null,
              meta: node.node_label ? { node_label: node.node_label } : null,
            });
          }
        }
        return jsonResponse({ id: neuronId, name: name || "", node_count: nodes.length }, 201);
      }

      // ─── Relationships Routes ───

      // POST /relationships/rebuild — admin-only; re-runs all projectors
      // (must come before the generic POST /relationships rule below)
      if (path === "/relationships/rebuild" && request.method === "POST") {
        return await handleRebuildRelationships(env, jsonResponse);
      }

      // GET /relationships — list edges with permission filter
      if (path === "/relationships" && request.method === "GET") {
        return await handleListRelationships(env, url, user, jsonResponse);
      }

      // POST /relationships — create a native edge (user_declared or ai_inferred)
      if (path === "/relationships" && request.method === "POST") {
        const body = await request.json();
        return await handleCreateRelationship(env, body, user, jsonResponse);
      }

      // DELETE /relationships/:id — soft-delete an edge
      const relationshipDeleteMatch = path.match(/^\/relationships\/([^/]+)$/);
      if (relationshipDeleteMatch && request.method === "DELETE") {
        return await handleDeleteRelationship(env, relationshipDeleteMatch[1], user, jsonResponse);
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
        // Live projection: mirror as a 'references' edge in the relationships table
        const sourceFieldId = refToFieldId(body.source_ref);
        const targetFieldId = refToFieldId(body.target_ref);
        if (sourceFieldId && targetFieldId) {
          await emitProjectedEdge(env, {
            type: "references",
            origin: "projected_cell_link",
            source_type: "field", source_id: sourceFieldId, source_page_id: body.source_page_id || null,
            target_type: "field", target_id: targetFieldId, target_page_id: body.target_page_id || null,
            meta: {
              link_id: id,
              source_ref: body.source_ref || {},
              target_ref: body.target_ref || {},
              source_view_idx: body.source_view_idx ?? 0,
              target_view_idx: body.target_view_idx ?? 0,
              source_field_type: body.source_field_type || null,
              target_field_type: body.target_field_type || null,
            },
          });
        }
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
          // Capture pre-update link state if any field affecting the projection is changing
          const refsOrActiveChanging =
            body.active !== undefined ||
            body.source_ref !== undefined ||
            body.target_ref !== undefined;
          let preLink = null;
          if (refsOrActiveChanging) {
            preLink = await env.DB.prepare(
              "SELECT source_page_id, source_view_idx, source_ref, target_page_id, target_view_idx, target_ref, source_field_type, target_field_type, active FROM cell_links WHERE id = ?"
            ).bind(id).first();
          }
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
          // Live projection: rewrite references edge to match the new link state
          if (refsOrActiveChanging && preLink) {
            // Always remove the OLD projected edge first (idempotent — no-op if missing)
            const oldSourceRef = safeParseJSON(preLink.source_ref);
            const oldTargetRef = safeParseJSON(preLink.target_ref);
            const oldSourceFieldId = refToFieldId(oldSourceRef);
            const oldTargetFieldId = refToFieldId(oldTargetRef);
            if (oldSourceFieldId && oldTargetFieldId) {
              await deleteProjectedEdge(env, {
                type: "references", origin: "projected_cell_link",
                source_type: "field", source_id: oldSourceFieldId,
                target_type: "field", target_id: oldTargetFieldId,
              });
            }
            // Re-emit only if the post-update link is active
            const newActive = body.active !== undefined ? !!body.active : !!preLink.active;
            if (newActive) {
              const newSourceRef = body.source_ref !== undefined ? body.source_ref : oldSourceRef;
              const newTargetRef = body.target_ref !== undefined ? body.target_ref : oldTargetRef;
              const newSourcePageId = preLink.source_page_id || null;
              const newTargetPageId = preLink.target_page_id || null;
              const newSourceFieldId = refToFieldId(newSourceRef);
              const newTargetFieldId = refToFieldId(newTargetRef);
              if (newSourceFieldId && newTargetFieldId) {
                await emitProjectedEdge(env, {
                  type: "references", origin: "projected_cell_link",
                  source_type: "field", source_id: newSourceFieldId, source_page_id: newSourcePageId,
                  target_type: "field", target_id: newTargetFieldId, target_page_id: newTargetPageId,
                  meta: {
                    link_id: id,
                    source_ref: newSourceRef,
                    target_ref: newTargetRef,
                    source_view_idx: preLink.source_view_idx,
                    target_view_idx: preLink.target_view_idx,
                    source_field_type: body.source_field_type !== undefined ? body.source_field_type : preLink.source_field_type,
                    target_field_type: body.target_field_type !== undefined ? body.target_field_type : preLink.target_field_type,
                  },
                });
              }
            }
          }
          return jsonResponse({ ok: true });
        }
        if (request.method === "DELETE") {
          // Look up the link before deletion so we can clean up its projected edge
          const preLink = await env.DB.prepare(
            "SELECT source_ref, target_ref FROM cell_links WHERE id = ?"
          ).bind(id).first();
          await env.DB.prepare("DELETE FROM cell_links WHERE id = ?").bind(id).run();
          if (preLink) {
            const sourceRef = safeParseJSON(preLink.source_ref);
            const targetRef = safeParseJSON(preLink.target_ref);
            const sourceFieldId = refToFieldId(sourceRef);
            const targetFieldId = refToFieldId(targetRef);
            if (sourceFieldId && targetFieldId) {
              await deleteProjectedEdge(env, {
                type: "references", origin: "projected_cell_link",
                source_type: "field", source_id: sourceFieldId,
                target_type: "field", target_id: targetFieldId,
              });
            }
          }
          return jsonResponse({ ok: true });
        }
      }

      // ─── Notion Sync Routes ───
      const syncConfigureMatch = path.match(/^\/sync\/([^/]+)\/configure$/);
      if (syncConfigureMatch && request.method === "POST") {
        const tableId = syncConfigureMatch[1];
        const body = await request.json();
        const notionKey = await getNotionKey(request, env);
        return await handleSyncConfigure(env, tableId, body, notionKey, jsonResponse);
      }

      const syncPushMatch = path.match(/^\/sync\/([^/]+)\/push$/);
      if (syncPushMatch && request.method === "POST") {
        const tableId = syncPushMatch[1];
        const notionKey = await getNotionKey(request, env);
        return await handleSyncPush(env, tableId, notionKey, jsonResponse);
      }

      const syncPullMatch = path.match(/^\/sync\/([^/]+)\/pull$/);
      if (syncPullMatch && request.method === "POST") {
        const tableId = syncPullMatch[1];
        const notionKey = await getNotionKey(request, env);
        const fullResync = url.searchParams.get("full") === "1";
        return await handleSyncPull(env, tableId, notionKey, fullResync, jsonResponse);
      }

      const syncStatusMatch = path.match(/^\/sync\/([^/]+)\/status$/);
      if (syncStatusMatch && request.method === "GET") {
        const tableId = syncStatusMatch[1];
        return await handleSyncStatus(env, tableId, jsonResponse);
      }

      // Sync flush — process all dirty rows
      if (path === "/sync/flush" && request.method === "POST") {
        const notionKey = await getNotionKey(request, env);
        return await handleSyncFlush(env, notionKey, jsonResponse);
      }

      // Sync bootstrap — auto-configure + full pull for all linked Notion databases
      if (path === "/sync/bootstrap" && request.method === "POST") {
        const notionKey = await getNotionKey(request, env);
        return await handleSyncBootstrap(env, notionKey, jsonResponse);
      }

      const syncDeleteMatch = path.match(/^\/sync\/([^/]+)$/);
      if (syncDeleteMatch && request.method === "DELETE") {
        const tableId = syncDeleteMatch[1];
        return await handleSyncDelete(env, tableId, jsonResponse);
      }

      // ─── Disconnect & Sync Backup ───
      const disconnectMatch = path.match(/^\/pages\/([^/]+)\/disconnect$/);
      if (disconnectMatch && request.method === "POST") {
        const pageId = disconnectMatch[1];
        return await handleDisconnect(env, pageId, jsonResponse);
      }

      const syncBackupMatch = path.match(/^\/pages\/([^/]+)\/sync-backup$/);
      if (syncBackupMatch && request.method === "POST") {
        const pageId = syncBackupMatch[1];
        const body = await request.json();
        const notionKey = await getNotionKey(request, env);
        return await handleSyncBackup(env, pageId, body, notionKey, jsonResponse);
      }

      // ─── File Storage (R2) ───
      const fileMatch = path.match(/^\/files\/([^/]+)$/);

      // POST /files — upload file (multipart form-data)
      if (path === "/files" && request.method === "POST") {
        return await handleFileUpload(request, env, jsonResponse);
      }
      // GET /files — list files, requires ?page_id= or ?record_id=
      if (path === "/files" && request.method === "GET") {
        return await handleListFiles(env, user, url.searchParams.get("page_id"), url.searchParams.get("record_id"), jsonResponse);
      }
      // GET /files/:id — download file (with page permission check)
      if (fileMatch && request.method === "GET") {
        return await handleGetFile(env, user, fileMatch[1], jsonResponse);
      }
      // DELETE /files/:id — delete file (with page permission check)
      if (fileMatch && request.method === "DELETE") {
        return await handleDeleteFile(env, user, fileMatch[1], jsonResponse);
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
        }, jsonResponse);
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
        return await notionFetch(`/pages/${pageId}`, "GET", notionKey, jsonResponse);
      }

      // Create page
      if (path === "/page" && request.method === "POST") {
        const body = await request.json();
        return await notionFetch("/pages", "POST", notionKey, body, jsonResponse);
      }

      // Update page
      if (path.startsWith("/page/") && request.method === "PATCH") {
        const pageId = path.split("/page/")[1];
        const body = await request.json();
        return await notionFetch(`/pages/${pageId}`, "PATCH", notionKey, body, jsonResponse);
      }

      // Get database schema
      if (path.startsWith("/database/") && request.method === "GET") {
        const dbId = path.split("/database/")[1];
        return await notionFetch(`/databases/${dbId}`, "GET", notionKey, jsonResponse);
      }

      // Create database
      if (path === "/create-database" && request.method === "POST") {
        const body = await request.json();
        return await notionFetch("/databases", "POST", notionKey, body, jsonResponse);
      }

      // Update database (schema / title)
      if (path.startsWith("/database/") && request.method === "PATCH") {
        const dbId = path.split("/database/")[1];
        const body = await request.json();
        return await notionFetch(`/databases/${dbId}`, "PATCH", notionKey, body, jsonResponse);
      }

      // Update single block
      if (path.startsWith("/block/") && request.method === "PATCH") {
        const blockId = path.split("/block/")[1];
        const body = await request.json();
        return await notionFetch(`/blocks/${blockId}`, "PATCH", notionKey, body, jsonResponse);
      }

      // Delete single block
      if (path.startsWith("/block/") && request.method === "DELETE") {
        const blockId = path.split("/block/")[1];
        return await notionFetch(`/blocks/${blockId}`, "DELETE", notionKey, jsonResponse);
      }

      // Get blocks
      if (path.startsWith("/blocks/") && request.method === "GET") {
        const blockId = path.split("/blocks/")[1];
        return await notionFetch(`/blocks/${blockId}/children?page_size=100`, "GET", notionKey, jsonResponse);
      }

      // Append blocks
      if (path.startsWith("/blocks/") && request.method === "PATCH") {
        const blockId = path.split("/blocks/")[1];
        const body = await request.json();
        return await notionFetch(`/blocks/${blockId}/children`, "PATCH", notionKey, body, jsonResponse);
      }

      // Search
      if (path === "/search" && request.method === "POST") {
        const body = await request.json();
        return await notionFetch("/search", "POST", notionKey, body, jsonResponse);
      }

      // Test Notion connection
      if (path === "/test" && request.method === "GET") {
        return await notionFetch("/users/me", "GET", notionKey, jsonResponse);
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
              headers: { ...cors, "Content-Type": "application/json", "X-Cache": "HIT" },
            });
          }

          // Cache miss — call Claude, then cache successful responses
          const response = await claudeFetch(claudeKey, body, jsonResponse);
          if (response.status === 200) {
            const responseBody = await response.text();
            const cachedResp = new Response(responseBody, {
              status: 200,
              headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
            });
            ctx.waitUntil(cache.put(cacheKey, cachedResp));

            return new Response(responseBody, {
              status: 200,
              headers: { ...cors, "Content-Type": "application/json", "X-Cache": "MISS" },
            });
          }
          return response;
        }

        // Non-cacheable: direct pass-through
        return await claudeFetch(claudeKey, body, jsonResponse);
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

      // ─── Linked Sheet proxy (Google Sheets API when Sheets-granted, CSV fallback) ───
      if (path === "/sheets/fetch" && request.method === "POST") {
        const { url: sheetUrl } = await request.json();
        if (!sheetUrl) return jsonResponse({ _error: "Missing sheet URL" }, 400);
        if (!sheetUrl.startsWith("https://")) return jsonResponse({ _error: "Only HTTPS URLs are supported" }, 400);

        let fetchUrl = sheetUrl;
        let sheetType = "csv";
        let spreadsheetId = null;
        let gid = null;
        const gMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
        if (gMatch) {
          sheetType = "google_sheets";
          spreadsheetId = gMatch[1];
          // gid can be in either ?gid=... or #gid=...
          const gidMatch = sheetUrl.match(/[?&#]gid=(\d+)/);
          if (gidMatch) gid = gidMatch[1];
          fetchUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ""}`;
        }

        // Google Sheets via OAuth API path: returns formatting + inline images.
        // Only kicks in when the caller is authenticated AND has the "sheets"
        // grant. Per-user data — bypass the shared CDN cache.
        let apiAttempted = false;
        let apiError = null;
        let apiStatus = null;
        if (sheetType === "google_sheets" && user?.sub) {
          apiAttempted = true;
          const apiResult = await fetchGoogleSheetViaApi(env, user.sub, spreadsheetId, gid);
          if (!apiResult._error) {
            return jsonResponse({
              ...apiResult,
              cachedAt: Date.now(),
              sheetType,
            });
          }
          apiError = apiResult._error;
          apiStatus = apiResult.status;
          console.log("[sheets/fetch] API path failed, falling back to CSV:", apiError, "status:", apiStatus);
          // Fall through to CSV on 401 (no sheets grant) — preserves backward
          // compatibility for users who haven't granted Sheets yet. Other
          // errors (404, 500) bubble up as the CSV path can't recover from them
          // anyway, but try CSV as a last resort.
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
        const result = {
          columns, rows: rows.slice(0, 10000),
          cachedAt: Date.now(), sheetType,
          truncated: rows.length > 10000, source: "csv",
          // Diagnostic: surface API-path error to the client when fallback occurs.
          apiAttempted, apiError, apiStatus,
        };

        // Don't cache fallback responses — apiError state shouldn't be sticky.
        if (apiAttempted) {
          return jsonResponse(result);
        }

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
        return await handleFactoryReset(env, jsonResponse);
      }

      // 404
      return jsonResponse({ error: "Not found", path }, 404);

    } catch (err) {
      return jsonResponse({ _error: err.message || "Internal server error" }, 500);
    }
  },
};

// ─── Init / Health / Factory Reset handlers moved to worker/handlers/init.js ───


// ─── Auth Handlers ───

// ─── Auth handlers moved to worker/handlers/auth.js ───

// ─── User Management Handlers moved to worker/handlers/users.js ───

// ─── Session Management Handlers (multi-device sync) ───

// ─── Session handlers moved to worker/handlers/sessions.js ───

// ─── Per-User State Handlers ───

// ─── User state / dashboard / record-view handlers moved to worker/handlers/user-state.js ───

// ─── PIN Lock Handlers ───

// ─── PIN lock handlers moved to worker/handlers/pin.js ───

// ─── Connections CRUD ───
// (handlers moved to worker/handlers/connections.js)

// ─── Google OAuth & API Handlers moved to worker/handlers/google.js ───

// ─── Page Config Handlers ───
// ─── Page Handlers moved to worker/handlers/pages.js ───


// ─── Table Schema + Row Handlers moved to worker/handlers/tables.js ───


// ─── Notion API Helper ───
async function notionFetch(endpoint, method, notionKey, body, jsonResponse) {
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
async function claudeFetch(claudeKey, body, jsonResponse) {
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


// sleep moved to worker/utils.js

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

// ─── Automation Rules + Flows moved to worker/handlers/automations.js ───

// ─── D1 Notifications Handlers ───

// ─── D1 Knowledge Base Handlers moved to worker/handlers/knowledge-base.js ───

// ─── Custom Functions CRUD moved to worker/handlers/custom-functions.js ───

// ─── Custom Functions + Flow Executions moved to worker/handlers/custom-functions.js and worker/handlers/automations.js ───

// ─── Automation Engine moved to worker/automation/engine.js ───


// ─── Notion Sync Handlers moved to worker/handlers/notion-sync.js ───


export { TableRoom } from './worker/durable-objects/TableRoom.js';
export { UserRoom } from './worker/durable-objects/UserRoom.js';
