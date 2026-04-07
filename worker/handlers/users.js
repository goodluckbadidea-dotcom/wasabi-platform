// ─── User management handlers (admin only) ───

export async function handleCreateInvite(env, body, jsonResponse) {
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

export async function handleUserDirectory(env, jsonResponse) {
  try {
    const rows = await env.DB.prepare(
      "SELECT id, display_name, role FROM users WHERE deleted_at IS NULL AND password_hash IS NOT NULL ORDER BY display_name"
    ).all();
    return jsonResponse({ users: rows.results });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleListUsers(env, jsonResponse) {
  try {
    const rows = await env.DB.prepare(
      "SELECT id, display_name, role, invite_code, created_at, last_login_at, deleted_at FROM users ORDER BY deleted_at IS NOT NULL, created_at"
    ).all();
    return jsonResponse({ users: rows.results });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleDeleteUser(env, userId, requestingUser, jsonResponse) {
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

export async function handleRestoreUser(env, userId, jsonResponse) {
  try {
    await env.DB.prepare("UPDATE users SET deleted_at = NULL WHERE id = ?").bind(userId).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleHardDeleteUser(env, userId, body, jsonResponse) {
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

export async function handleResetUserPassword(env, userId, jsonResponse) {
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

export async function handleUpdateUser(env, userId, body, jsonResponse) {
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
