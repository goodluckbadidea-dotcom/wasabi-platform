// ─── Task Pin handlers ───
// Admin-set pins that push tasks to the top of a target user's AI-curated
// zen list. Ordering among multiple pins is preserved via `pin_order`.
// Pin uniqueness: one pin per (target_user_id, task_id) — the UNIQUE index
// on the table enforces this at the DB level, and the POST handler upserts.

// Read query used by both handlers. LEFT JOIN so the pinner's display_name
// travels with the pin — saves the frontend a separate /users fetch on
// every zen list render.
//
// Also filters out pins whose source task_id points at an archived row
// (archived_at IS NOT NULL). The pin row stays in the DB — if the row is
// unarchived later, the pin reappears automatically. Rows soft-deleted via
// the existing `archived = 1` flag are already handled by the caller's
// task-completion logic (clearPinsForCompletedTask).
const LIST_QUERY = `
  SELECT tp.*, u.display_name AS pinned_by_name
  FROM task_pins tp
  LEFT JOIN users u ON tp.pinned_by_user_id = u.id
  LEFT JOIN table_rows tr ON tr.id = tp.task_id
  WHERE tp.target_user_id = ?
    AND (tr.id IS NULL OR tr.archived_at IS NULL)
  ORDER BY tp.pin_order ASC, tp.created_at ASC
`;

export async function handleListPinsForTarget(env, targetUserId, jsonResponse) {
  try {
    if (!targetUserId) {
      return jsonResponse({ _error: "target_user_id required" }, 400);
    }
    const { results } = await env.DB.prepare(LIST_QUERY).bind(targetUserId).all();
    return jsonResponse({ pins: results || [] });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleListMyPins(env, user, jsonResponse) {
  try {
    const userId = user?.sub;
    if (!userId) return jsonResponse({ _error: "Not authenticated" }, 401);
    const { results } = await env.DB.prepare(LIST_QUERY).bind(userId).all();
    return jsonResponse({ pins: results || [] });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// Replace-all semantics: the request body is the complete ordered pin set
// for one target user. Any existing pin for that user not in the body is
// deleted. Existing pins present in the body are updated (pin_order,
// reason). New entries are inserted. Runs inside a single D1 batch so the
// replace is atomic per user.
export async function handleReplacePinsForTarget(env, body, actorUser, jsonResponse) {
  try {
    const { target_user_id, pins } = body || {};
    if (!target_user_id) {
      return jsonResponse({ _error: "target_user_id required" }, 400);
    }
    if (!Array.isArray(pins)) {
      return jsonResponse({ _error: "pins must be an array" }, 400);
    }
    const actorId = actorUser?.sub || "";

    // Validate each pin has the required fields.
    for (const p of pins) {
      if (!p || typeof p.task_id !== "string" || !p.task_id) {
        return jsonResponse({ _error: "each pin requires task_id" }, 400);
      }
    }

    // Build the atomic replace: delete all existing pins for this user,
    // then insert the new ordered set. If pins is empty this is a full
    // clear.
    const stmts = [
      env.DB.prepare("DELETE FROM task_pins WHERE target_user_id = ?").bind(target_user_id),
    ];
    pins.forEach((p, idx) => {
      const id = `${target_user_id}:${p.task_id}`;
      stmts.push(
        env.DB.prepare(
          `INSERT INTO task_pins (id, target_user_id, task_id, source, pin_order, pinned_by_user_id, reason, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
        ).bind(
          id,
          target_user_id,
          p.task_id,
          p.source || "",
          typeof p.pin_order === "number" ? p.pin_order : idx,
          actorId,
          p.reason || ""
        )
      );
    });
    await env.DB.batch(stmts);

    const { results } = await env.DB.prepare(LIST_QUERY).bind(target_user_id).all();
    return jsonResponse({ ok: true, pins: results || [] });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleDeletePin(env, id, jsonResponse) {
  try {
    if (!id) return jsonResponse({ _error: "id required" }, 400);
    await env.DB.prepare("DELETE FROM task_pins WHERE id = ?").bind(id).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// Called from handleUpdateRow when a row moves to a done/cancelled status.
// Deletes any pins pointing at that row across all target users. Best-effort
// — the caller wraps this in try/catch so a failure here never breaks the
// originating row update.
export async function clearPinsForCompletedTask(env, taskId) {
  if (!taskId) return;
  await env.DB.prepare("DELETE FROM task_pins WHERE task_id = ?").bind(taskId).run();
}
