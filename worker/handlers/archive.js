// ─── Archive Handlers ───
// User-initiated archive of pages and rows. Distinct from the existing
// `archived` soft-delete flag on table_rows (which is a permanent delete
// hide). Archive stamps `archived_at` + `archived_by`, cascades to all
// descendants, and is fully reversible via unarchive.
//
// Admin-only: all endpoints require user.role === 'admin'.
//
// Cascade rules:
//   - Archiving a PAGE archives:
//       - every descendant page (parent_id closure)
//       - every row inside the page and its descendant pages
//   - Archiving a ROW archives:
//       - every descendant row (parent_row_id closure) within the same table
//   - Unarchive is symmetric and only touches items that were archived by
//     THIS SAME cascade event (matched by archived_at within the batch).
//     Simpler semantics: unarchiving a page unarchives its whole subtree.

function requireAdmin(user, jsonResponse) {
  if (!user || user.role !== 'admin') {
    return jsonResponse({ _error: 'Admin required for archive operations' }, 403);
  }
  return null;
}

// Collect the closure of descendant page ids under `rootId` (inclusive).
async function collectPageDescendants(env, rootId) {
  const all = [rootId];
  let frontier = [rootId];
  while (frontier.length) {
    const placeholders = frontier.map(() => '?').join(',');
    const children = await env.DB.prepare(
      `SELECT id FROM page_configs WHERE parent_id IN (${placeholders})`
    ).bind(...frontier).all();
    const next = (children.results || []).map((r) => r.id);
    if (!next.length) break;
    all.push(...next);
    frontier = next;
  }
  return all;
}

// Collect the closure of descendant row ids under `rootRowId` (inclusive)
// within a single table.
async function collectRowDescendants(env, tableId, rootRowId) {
  const all = [rootRowId];
  let frontier = [rootRowId];
  while (frontier.length) {
    const placeholders = frontier.map(() => '?').join(',');
    const children = await env.DB.prepare(
      `SELECT id FROM table_rows WHERE table_id = ? AND parent_row_id IN (${placeholders})`
    ).bind(tableId, ...frontier).all();
    const next = (children.results || []).map((r) => r.id);
    if (!next.length) break;
    all.push(...next);
    frontier = next;
  }
  return all;
}

async function handleArchivePage(env, pageId, user, jsonResponse) {
  const denied = requireAdmin(user, jsonResponse);
  if (denied) return denied;
  try {
    const exists = await env.DB.prepare(
      'SELECT id FROM page_configs WHERE id = ?'
    ).bind(pageId).first();
    if (!exists) return jsonResponse({ _error: 'Page not found' }, 404);

    const pageIds = await collectPageDescendants(env, pageId);
    const nowIso = new Date().toISOString();
    const actor = user?.sub || '';

    // Batch stamp pages
    const stmts = [];
    for (const pid of pageIds) {
      stmts.push(env.DB.prepare(
        `UPDATE page_configs SET archived_at = ?, archived_by = ?, updated_at = datetime('now')
         WHERE id = ? AND archived_at IS NULL`
      ).bind(nowIso, actor, pid));
    }
    // Batch stamp rows in every included table
    for (const pid of pageIds) {
      stmts.push(env.DB.prepare(
        `UPDATE table_rows SET archived_at = ?, archived_by = ?, updated_at = datetime('now')
         WHERE table_id = ? AND archived_at IS NULL`
      ).bind(nowIso, actor, pid));
    }
    if (stmts.length) await env.DB.batch(stmts);

    return jsonResponse({
      ok: true,
      archived_at: nowIso,
      pages_archived: pageIds.length,
      root_id: pageId,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUnarchivePage(env, pageId, user, jsonResponse) {
  const denied = requireAdmin(user, jsonResponse);
  if (denied) return denied;
  try {
    const exists = await env.DB.prepare(
      'SELECT id, archived_at FROM page_configs WHERE id = ?'
    ).bind(pageId).first();
    if (!exists) return jsonResponse({ _error: 'Page not found' }, 404);

    const pageIds = await collectPageDescendants(env, pageId);
    const stmts = [];
    for (const pid of pageIds) {
      stmts.push(env.DB.prepare(
        `UPDATE page_configs SET archived_at = NULL, archived_by = NULL, updated_at = datetime('now')
         WHERE id = ?`
      ).bind(pid));
      stmts.push(env.DB.prepare(
        `UPDATE table_rows SET archived_at = NULL, archived_by = NULL, updated_at = datetime('now')
         WHERE table_id = ? AND archived_at IS NOT NULL`
      ).bind(pid));
    }
    if (stmts.length) await env.DB.batch(stmts);

    return jsonResponse({
      ok: true,
      pages_unarchived: pageIds.length,
      root_id: pageId,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleArchiveRow(env, tableId, rowId, user, jsonResponse) {
  const denied = requireAdmin(user, jsonResponse);
  if (denied) return denied;
  try {
    const exists = await env.DB.prepare(
      'SELECT id FROM table_rows WHERE id = ? AND table_id = ?'
    ).bind(rowId, tableId).first();
    if (!exists) return jsonResponse({ _error: 'Row not found' }, 404);

    const rowIds = await collectRowDescendants(env, tableId, rowId);
    const nowIso = new Date().toISOString();
    const actor = user?.sub || '';

    const stmts = rowIds.map((rid) =>
      env.DB.prepare(
        `UPDATE table_rows SET archived_at = ?, archived_by = ?, updated_at = datetime('now')
         WHERE id = ? AND table_id = ? AND archived_at IS NULL`
      ).bind(nowIso, actor, rid, tableId)
    );
    if (stmts.length) await env.DB.batch(stmts);

    return jsonResponse({
      ok: true,
      archived_at: nowIso,
      rows_archived: rowIds.length,
      root_id: rowId,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUnarchiveRow(env, tableId, rowId, user, jsonResponse) {
  const denied = requireAdmin(user, jsonResponse);
  if (denied) return denied;
  try {
    const exists = await env.DB.prepare(
      'SELECT id FROM table_rows WHERE id = ? AND table_id = ?'
    ).bind(rowId, tableId).first();
    if (!exists) return jsonResponse({ _error: 'Row not found' }, 404);

    const rowIds = await collectRowDescendants(env, tableId, rowId);
    const stmts = rowIds.map((rid) =>
      env.DB.prepare(
        `UPDATE table_rows SET archived_at = NULL, archived_by = NULL, updated_at = datetime('now')
         WHERE id = ? AND table_id = ?`
      ).bind(rid, tableId)
    );
    if (stmts.length) await env.DB.batch(stmts);

    return jsonResponse({
      ok: true,
      rows_unarchived: rowIds.length,
      root_id: rowId,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// Return everything currently archived, organized for the Archive view.
// Admin-only (same as the actions).
//
// Response shape:
//   {
//     pages: [{ id, parent_id, title, icon, page_type, archived_at, archived_by, config }],
//     rows:  [{ id, table_id, table_title, cells, archived_at, archived_by, parent_row_id }],
//   }
//
// The frontend groups these into a tree — top-level archived pages, then
// archived rows grouped under whichever table they live in (which itself
// may be active or archived).
async function handleListArchived(env, user, jsonResponse) {
  const denied = requireAdmin(user, jsonResponse);
  if (denied) return denied;
  try {
    const pageRes = await env.DB.prepare(
      `SELECT id, parent_id, title, icon, page_type, archived_at, archived_by, config
       FROM page_configs WHERE archived_at IS NOT NULL ORDER BY archived_at DESC`
    ).all();
    const rowRes = await env.DB.prepare(
      `SELECT tr.id, tr.table_id, tr.cells, tr.archived_at, tr.archived_by, tr.parent_row_id,
              pc.title AS table_title
       FROM table_rows tr
       LEFT JOIN page_configs pc ON pc.id = tr.table_id
       WHERE tr.archived_at IS NOT NULL AND tr.archived = 0
       ORDER BY tr.archived_at DESC
       LIMIT 500`
    ).all();

    const pages = (pageRes.results || []).map((r) => ({
      ...r,
      config: (() => { try { return JSON.parse(r.config || '{}'); } catch { return {}; } })(),
    }));
    const rows = (rowRes.results || []).map((r) => ({
      ...r,
      cells: (() => { try { return JSON.parse(r.cells || '{}'); } catch { return {}; } })(),
    }));
    return jsonResponse({ pages, rows });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export {
  handleArchivePage,
  handleUnarchivePage,
  handleArchiveRow,
  handleUnarchiveRow,
  handleListArchived,
};
