// ─── Notification handlers + internal helper ───
import { getFreshRole } from '../auth.js';

export async function createNotificationInternal(env, {
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
      } catch (err) { console.error("[createNotification] prefs lookup failed:", err?.message || err); } // Proceed if prefs lookup fails
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO notifications (id, message, type, status, source, target_user_id, record_id, record_name, page_config_id, page_name, actor_name, created_at)
       VALUES (?, ?, ?, 'unread', ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(id, message, type, source, target_user_id, record_id, record_name, page_config_id, page_name, actor_name).run();

    // Push instant notification via UserRoom WebSocket
    if (target_user_id && target_user_id !== "all" && env.USER_ROOMS) {
      try {
        const roomId = env.USER_ROOMS.idFromName(`user:${target_user_id}`);
        const room = env.USER_ROOMS.get(roomId);
        await room.fetch(new Request("https://dummy/broadcast", {
          method: "POST",
          body: JSON.stringify({ type: "notification_new", notificationId: id }),
        }));
      } catch (err) { console.error("[createNotification] WebSocket push failed:", err?.message || err); } // Don't fail notification creation if WS push fails
    }
  } catch (err) { console.error("[createNotification] failed:", err?.message || err, { type, target_user_id, record_id }); }
}

// ─── Extract @mentions from text ───
export function extractMentions(text) {
  if (!text) return [];
  const matches = text.match(/@[\w]+(?=\s|$|[.,!?;:])/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1).trim());
}

export async function handleListNotifications(env, url, user, jsonResponse) {
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

export async function handleCreateNotification(env, body, jsonResponse) {
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

export async function handleGetNotification(env, id, jsonResponse) {
  const row = await env.DB.prepare("SELECT * FROM notifications WHERE id = ?").bind(id).first();
  if (!row) return jsonResponse({ _error: "Notification not found" }, 404);
  return jsonResponse(row);
}

export async function handleUpdateNotification(env, id, body, jsonResponse) {
  const sets = [];
  const vals = [];

  if (body.status) { sets.push("status = ?"); vals.push(body.status); }
  if (body.message) { sets.push("message = ?"); vals.push(body.message); }

  if (sets.length === 0) return jsonResponse({ _error: "No valid fields to update" }, 400);

  vals.push(id);
  await env.DB.prepare(`UPDATE notifications SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return jsonResponse({ success: true, id });
}

export async function handleDeleteNotification(env, id, jsonResponse) {
  await env.DB.prepare("DELETE FROM notifications WHERE id = ?").bind(id).run();
  return jsonResponse({ success: true, id });
}
