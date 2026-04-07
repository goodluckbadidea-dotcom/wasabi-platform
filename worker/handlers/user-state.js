// ─── User state, dashboard, and record-view handlers ───

export async function handleGetUserState(env, user, jsonResponse) {
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

export async function handlePutUserState(env, user, body, jsonResponse) {
  try {
    const sets = ["updated_at = datetime('now')"];
    const binds = [];
    if (body.last_page !== undefined) { sets.push("last_page = ?"); binds.push(body.last_page); }
    if (body.zen_tasks_table_id !== undefined) { sets.push("zen_tasks_table_id = ?"); binds.push(body.zen_tasks_table_id); }
    if (body.view_prefs !== undefined) { sets.push("view_prefs = ?"); binds.push(JSON.stringify(body.view_prefs)); }

    // Two-step upsert: ensure row exists, then update only provided fields.
    // Previous single INSERT...ON CONFLICT clobbered zen_tasks_table_id with null
    // when unrelated fields (e.g. last_page) were written to a new row.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user_state (user_id, updated_at) VALUES (?, datetime('now'))`
    ).bind(user.sub).run();

    if (binds.length > 0) {
      await env.DB.prepare(
        `UPDATE user_state SET ${sets.join(", ")} WHERE user_id = ?`
      ).bind(...binds, user.sub).run();
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleGetUserDashboard(env, user, jsonResponse) {
  try {
    const row = await env.DB.prepare("SELECT * FROM user_dashboards WHERE user_id = ?").bind(user.sub).first();
    const widgets = row?.widgets ? JSON.parse(row.widgets) : [];
    return jsonResponse({ widgets, updated_at: row?.updated_at || null });
  } catch (err) {
    return jsonResponse({ widgets: [], updated_at: null });
  }
}

export async function handlePutUserDashboard(env, user, body, jsonResponse) {
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

export async function handlePutRecordView(env, user, recordId, jsonResponse) {
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

export async function handleGetRecordViews(env, user, url, jsonResponse) {
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
