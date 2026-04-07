// ─── Task activity + interaction journal handlers ───

export async function handleListTaskActivity(env, source, jsonResponse) {
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

export async function handleGetTaskActivity(env, taskId, source, jsonResponse) {
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

export async function handleUpsertTaskActivity(env, taskId, body, jsonResponse) {
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

export async function handleLogInteraction(env, body, jsonResponse) {
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

export async function handleListInteractions(env, url, jsonResponse) {
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

export async function handleGetInteractionSummary(env, taskId, jsonResponse) {
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
