// ─── Page Config Handlers ───
// CRUD for page_configs: list, create, get, update, reorder, delete.
// Extracted from worker.js — zero logic changes.

import { getNotionKeyFromDB, handleSyncConfigure, handleSyncPull } from './notion-sync.js';


async function handleListPages(env, user, jsonResponse) {
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

async function handleCreatePage(env, body, user, jsonResponse) {
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
            await handleSyncConfigure(env, id, configBody, notionKey, jsonResponse);
            await handleSyncPull(env, id, notionKey, true, jsonResponse);
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

async function handleGetSummaryCache(env, pageId, jsonResponse) {
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

async function handleSetSummaryCache(env, pageId, body, jsonResponse) {
  try {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO data_summary_cache (page_id, summary, updated_at) VALUES (?, ?, datetime('now'))"
    ).bind(pageId, body.summary || "").run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleGetPage(env, id, jsonResponse) {
  try {
    const row = await env.DB.prepare("SELECT * FROM page_configs WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ _error: "Page not found" }, 404);
    return jsonResponse({ ...row, config: JSON.parse(row.config || "{}") });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUpdatePage(env, id, body, jsonResponse) {
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

async function handleReorderPages(env, body, jsonResponse) {
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

async function handleDeletePage(env, id, jsonResponse) {
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
      // Remove neuron nodes referencing this page
      await env.DB.prepare("DELETE FROM neuron_nodes WHERE page_config_id = ?").bind(pid).run();
    }

    // Clean up neurons left with zero nodes after page deletion
    await env.DB.prepare(
      "DELETE FROM neurons WHERE id NOT IN (SELECT DISTINCT neuron_id FROM neuron_nodes)"
    ).run();

    // Remove child page configs
    await env.DB.prepare("DELETE FROM page_configs WHERE parent_id = ?").bind(id).run();
    // Remove the page config itself
    await env.DB.prepare("DELETE FROM page_configs WHERE id = ?").bind(id).run();

    return jsonResponse({ ok: true, id, deleted_children: allIds.length - 1 });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export {
  handleListPages,
  handleCreatePage,
  handleGetSummaryCache,
  handleSetSummaryCache,
  handleGetPage,
  handleUpdatePage,
  handleReorderPages,
  handleDeletePage,
};
