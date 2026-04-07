// ─── Record comments handlers ───
import { createNotificationInternal, extractMentions } from './notifications.js';
import { resolveRecordTitle } from '../utils.js';

export async function handleListComments(env, recordId, pageConfigId, jsonResponse) {
  try {
    const results = await env.DB.prepare(
      "SELECT * FROM record_comments WHERE record_id = ? AND page_config_id = ? ORDER BY created_at ASC"
    ).bind(recordId, pageConfigId || "").all();
    return jsonResponse({ comments: results.results || [] });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleCreateComment(env, user, recordId, body, jsonResponse) {
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
          if (matched) {
            // Dedup: skip if same mention notification exists within last 5 minutes
            const existing = await env.DB.prepare(
              `SELECT id FROM notifications
               WHERE type = 'mention' AND record_id = ? AND target_user_id = ? AND actor_name = ?
               AND created_at > datetime('now', '-5 minutes')`
            ).bind(recordId, matched.id, commenterName).first();
            if (existing) continue;

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

export async function handleDeleteComment(env, user, recordId, commentId, jsonResponse) {
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
