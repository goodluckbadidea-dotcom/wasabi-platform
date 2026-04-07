// ─── Session management handlers ───
import { buildClearAuthCookie } from '../crypto.js';

export async function handleListSessions(env, user, jsonResponse) {
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

export async function handleRevokeSession(env, user, sessionId, jsonResponse) {
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

export async function handleLogoutOtherSessions(env, user, jsonResponse) {
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

export async function handleLogoutAllDevices(env, user, jsonResponse) {
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
