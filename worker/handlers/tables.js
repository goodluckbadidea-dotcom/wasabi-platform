// ─── Table Schema + Row Handlers ───
// Schema CRUD, row CRUD, query, filters, sorts.
// Extracted from worker.js — zero logic changes.

import { safeParseJSON, resolveRecordTitle } from '../utils.js';
import { createNotificationInternal } from './notifications.js';
import { checkAutomationTriggers } from '../automation/engine.js';
import { invalidateSummaryCache, archiveNotionPage } from './notion-sync.js';

// ─── Table Schema Handlers ───

async function handleGetSchema(env, id, jsonResponse) {
  try {
    const row = await env.DB.prepare("SELECT * FROM table_schemas WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ _error: "Schema not found" }, 404);
    return jsonResponse({ ...row, columns: JSON.parse(row.columns), sub_columns: JSON.parse(row.sub_columns || "[]") });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUpdateSchema(env, id, body, jsonResponse) {
  if (!body.columns && !body.sub_columns) return jsonResponse({ _error: "Missing columns or sub_columns" }, 400);

  try {
    if (body.columns && body.sub_columns) {
      await env.DB.prepare(
        `INSERT INTO table_schemas (id, columns, sub_columns, created_at, updated_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET columns = excluded.columns, sub_columns = excluded.sub_columns, updated_at = datetime('now')`
      ).bind(id, JSON.stringify(body.columns), JSON.stringify(body.sub_columns)).run();
    } else if (body.columns) {
      await env.DB.prepare(
        `INSERT INTO table_schemas (id, columns, created_at, updated_at)
         VALUES (?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET columns = excluded.columns, updated_at = datetime('now')`
      ).bind(id, JSON.stringify(body.columns)).run();
    } else {
      await env.DB.prepare(
        `UPDATE table_schemas SET sub_columns = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(JSON.stringify(body.sub_columns), id).run();
    }
    return jsonResponse({ ok: true, id });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Table Row Handlers ───

async function checkCircularReference(db, tableId, rowId, proposedParentId) {
  let currentId = proposedParentId;
  const visited = new Set();
  while (currentId) {
    if (currentId === rowId) return true;
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    const row = await db.prepare(
      "SELECT parent_row_id FROM table_rows WHERE id = ? AND table_id = ?"
    ).bind(currentId, tableId).first();
    currentId = row?.parent_row_id;
  }
  return false;
}

async function handleListRows(env, tableId, url, jsonResponse) {
  const limit = Math.min(parseInt(url.searchParams.get("limit")) || 100, 10000);
  const offset = parseInt(url.searchParams.get("offset")) || 0;
  const includeArchived = url.searchParams.get("archived") === "true";
  const parentRowId = url.searchParams.get("parent_row_id");

  try {
    let sql = "SELECT * FROM table_rows WHERE table_id = ?";
    const binds = [tableId];
    if (!includeArchived) sql += " AND archived = 0";
    if (parentRowId !== null && parentRowId !== undefined) {
      if (parentRowId === "null" || parentRowId === "") {
        sql += " AND parent_row_id IS NULL";
      } else {
        sql += " AND parent_row_id = ?";
        binds.push(parentRowId);
      }
    }
    sql += " ORDER BY sort_order, created_at";
    sql += ` LIMIT ${limit} OFFSET ${offset}`;

    const rows = await env.DB.prepare(sql).bind(...binds).all();

    const parsed = rows.results.map((r) => ({
      ...r,
      cells: JSON.parse(r.cells || "{}"),
      cell_versions: JSON.parse(r.cell_versions || "{}"),
      metadata: JSON.parse(r.metadata || "{}"),
    }));

    return jsonResponse({ rows: parsed, has_more: rows.results.length === limit });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleCreateRows(env, tableId, body, user, jsonResponse) {
  const rows = Array.isArray(body.rows) ? body.rows : [body];
  const created = [];
  const ownerId = user?.sub ? JSON.stringify([user.sub]) : "default";

  try {
    for (const row of rows) {
      const id = row.id || crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO table_rows (id, table_id, cells, sort_order, metadata, sync_dirty, owner_user_id, parent_row_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now'), datetime('now'))`
      ).bind(
        id,
        tableId,
        JSON.stringify(row.cells || {}),
        row.sort_order || 0,
        JSON.stringify(row.metadata || {}),
        ownerId,
        row.parent_row_id || null
      ).run();
      created.push(id);
    }

    // Invalidate data summary cache for this table's pages
    invalidateSummaryCache(env, tableId).catch(() => {});

    return jsonResponse({ ok: true, ids: created }, 201);
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUpdateRow(env, tableId, rowId, body, user, jsonResponse) {
  const sets = [];
  const binds = [];

  try {
    // Read existing row for merge, automation triggers, and conflict detection
    const existing = await env.DB.prepare(
      "SELECT cells, cell_versions, metadata, owner_user_id FROM table_rows WHERE id = ? AND table_id = ?"
    ).bind(rowId, tableId).first();
    const oldCells = existing ? JSON.parse(existing.cells || "{}") : {};
    const currentVersions = existing ? JSON.parse(existing.cell_versions || "{}") : {};

    // ── Circular reference check for parent_row_id ──
    if (body.parent_row_id) {
      if (body.parent_row_id === rowId) {
        return jsonResponse({ _error: "A record cannot be its own parent" }, 400);
      }
      const isCircular = await checkCircularReference(env.DB, tableId, rowId, body.parent_row_id);
      if (isCircular) {
        return jsonResponse({ _error: "Circular reference: this record is an ancestor of the target parent" }, 400);
      }
    }

    let newCells = oldCells;
    let conflicts = null;

    if (body.cells !== undefined) {
      const incomingCells = body.cells;
      const baseVersions = body.base_versions; // sent by collaboration-aware clients

      if (baseVersions) {
        // ── Field-level conflict detection ──
        const accepted = {};
        const rejected = {};
        const newVersions = { ...currentVersions };

        for (const [field, value] of Object.entries(incomingCells)) {
          const currentV = currentVersions[field] || 0;
          const baseV = baseVersions[field];

          if (baseV === undefined || baseV >= currentV) {
            // Accept: base version is current or field is new
            accepted[field] = value;
            newVersions[field] = currentV + 1;
          } else {
            // Conflict: base version is stale — another user changed this field
            rejected[field] = {
              yourValue: value,
              currentValue: oldCells[field],
              currentVersion: currentV,
            };
          }
        }

        if (Object.keys(rejected).length) conflicts = rejected;

        if (Object.keys(accepted).length) {
          newCells = { ...oldCells, ...accepted };
          sets.push("cells = ?"); binds.push(JSON.stringify(newCells));
          sets.push("cell_versions = ?"); binds.push(JSON.stringify(newVersions));
        }
      } else {
        // ── Legacy path: no base_versions sent, accept unconditionally ──
        if (body.merge_cells) {
          newCells = { ...oldCells, ...incomingCells };
        } else {
          newCells = incomingCells;
        }
        sets.push("cells = ?"); binds.push(JSON.stringify(newCells));

        // Bump versions for all changed fields
        const newVersions = { ...currentVersions };
        for (const field of Object.keys(incomingCells)) {
          newVersions[field] = (currentVersions[field] || 0) + 1;
        }
        sets.push("cell_versions = ?"); binds.push(JSON.stringify(newVersions));
      }
    }
    if (body.sort_order !== undefined) { sets.push("sort_order = ?"); binds.push(body.sort_order); }
    if (body.parent_row_id !== undefined) { sets.push("parent_row_id = ?"); binds.push(body.parent_row_id); }
    if (body.archived !== undefined) { sets.push("archived = ?"); binds.push(body.archived ? 1 : 0); }
    if (body.metadata !== undefined) { sets.push("metadata = ?"); binds.push(JSON.stringify(body.metadata)); }
    if (body.owner_user_id !== undefined) {
      // Accepts string, array, or null — stored as JSON array string
      const ownerVal = body.owner_user_id;
      if (ownerVal === null || ownerVal === "unassigned") {
        sets.push("owner_user_id = ?"); binds.push("unassigned");
      } else if (Array.isArray(ownerVal)) {
        sets.push("owner_user_id = ?"); binds.push(JSON.stringify(ownerVal));
      } else {
        sets.push("owner_user_id = ?"); binds.push(JSON.stringify([ownerVal]));
      }
    }

    if (sets.length === 0 && !conflicts) return jsonResponse({ _error: "No fields to update" }, 400);
    // If everything was conflicted (nothing accepted), return conflicts without writing
    if (sets.length === 0 && conflicts) {
      return jsonResponse({ ok: false, conflicts, cell_versions: currentVersions });
    }

    // Track who made this change
    if (user?.sub) { sets.push("updated_by = ?"); binds.push(user.sub); }

    // Mark row dirty for Notion sync (skip if this is a sync-originated update)
    if (!body._fromSync) {
      sets.push("sync_dirty = 1");
    }
    sets.push("updated_at = datetime('now')");
    binds.push(rowId, tableId);

    await env.DB.prepare(
      `UPDATE table_rows SET ${sets.join(", ")} WHERE id = ? AND table_id = ?`
    ).bind(...binds).run();

    // Invalidate data summary cache
    invalidateSummaryCache(env, tableId).catch(() => {});

    // Event-driven automation triggers (non-blocking)
    if (body.cells !== undefined && !body._fromSync) {
      checkAutomationTriggers(env, tableId, rowId, oldCells, newCells).catch((err) =>
        console.error("[AutoTrigger] Error:", err.message)
      );
    }

    // ── Resolve page name for enriched notifications (non-blocking) ──
    let _notifPageName = "";
    if ((body.cells !== undefined || body.owner_user_id !== undefined) && user) {
      try {
        const pc = await env.DB.prepare("SELECT name FROM page_configs WHERE id = ?").bind(tableId).first();
        _notifPageName = pc?.name || "";
      } catch (_) {}
    }

    // ── Status change notifications (non-blocking) ──
    if (body.cells !== undefined && !body._fromSync && user) {
      (async () => {
        try {
          const statusFields = ["status", "Status", "stage", "Stage", "state", "State", "phase", "Phase"];
          for (const field of statusFields) {
            if (newCells[field] !== undefined && oldCells[field] !== undefined && newCells[field] !== oldCells[field]) {
              const title = await resolveRecordTitle(env, tableId, newCells) || "Record";
              const actorName = user.name || "Someone";
              const ownerUserIds = existing?.owner_user_id;
              if (ownerUserIds && ownerUserIds !== "default" && ownerUserIds !== "unassigned") {
                let owners = [];
                try { owners = JSON.parse(ownerUserIds); } catch { owners = [ownerUserIds]; }
                for (const ownerId of owners) {
                  if (ownerId !== user.sub) {
                    await createNotificationInternal(env, {
                      message: `${actorName} changed ${field} to "${newCells[field]}" on "${title}"`,
                      type: "status_change",
                      source: rowId,
                      target_user_id: ownerId,
                      record_id: rowId,
                      record_name: title,
                      page_config_id: tableId,
                      page_name: _notifPageName,
                      actor_name: actorName,
                    });
                  }
                }
              }
              break;
            }
          }
        } catch (_) {}
      })();
    }

    // ── Task cache invalidation broadcast (cross-user) ──
    // Notify all users to refresh their task caches when status/done/owner changes
    const ownerChanged = body.owner_user_id !== undefined;
    let statusChanged = false;
    if (body.cells !== undefined && !body._fromSync) {
      const STATUS_FIELDS = ["status", "stage", "state", "phase", "done", "complete", "completed"];
      const schema = await env.DB.prepare("SELECT columns FROM table_schemas WHERE id = ?").bind(tableId).first();
      const cols = schema ? JSON.parse(schema.columns || "[]") : [];
      const colMap = Object.fromEntries(cols.map((c) => [c.id, c]));
      statusChanged = Object.keys(body.cells).some((colId) => {
        const col = colMap[colId];
        if (!col) return false;
        const colName = (col.name || "").toLowerCase();
        return col.type === "status" || col.type === "checkbox" || STATUS_FIELDS.some((s) => colName.includes(s));
      });
    }
    if (statusChanged || ownerChanged) {
      (async () => {
        try {
          const allUsers = await env.DB.prepare("SELECT id FROM users WHERE deleted_at IS NULL").all();
          for (const u of (allUsers.results || [])) {
            try {
              const roomId = env.USER_ROOMS.idFromName(`user:${u.id}`);
              const room = env.USER_ROOMS.get(roomId);
              await room.fetch(new Request("https://internal/broadcast", {
                method: "POST",
                body: JSON.stringify({ type: "task_cache_invalidate", tableId }),
              }));
            } catch (_) {}
          }
        } catch (_) {}
      })();
    }

    // ── Assignment change notifications (Sprint 11B) ──
    if (body.owner_user_id !== undefined && user) {
      (async () => {
        try {
          let oldOwners = [];
          if (existing?.owner_user_id && existing.owner_user_id !== "default" && existing.owner_user_id !== "unassigned") {
            try { oldOwners = JSON.parse(existing.owner_user_id); } catch { oldOwners = [existing.owner_user_id]; }
          }
          let newOwners = [];
          const ownerVal = body.owner_user_id;
          if (ownerVal && ownerVal !== "unassigned") {
            if (Array.isArray(ownerVal)) newOwners = ownerVal;
            else newOwners = [ownerVal];
          }
          const newlyAssigned = newOwners.filter((id) => !oldOwners.includes(id));
          if (newlyAssigned.length > 0) {
            const title = await resolveRecordTitle(env, tableId, newCells) || "Record";
            const actorName = user.name || "Someone";
            for (const assigneeId of newlyAssigned) {
              if (assigneeId !== user.sub) {
                await createNotificationInternal(env, {
                  message: `${actorName} assigned you to "${title}"`,
                  type: "assignment",
                  source: rowId,
                  target_user_id: assigneeId,
                  record_id: rowId,
                  record_name: title,
                  page_config_id: tableId,
                  page_name: _notifPageName,
                  actor_name: actorName,
                });
              }
            }
          }
        } catch (_) {}
      })();
    }

    // Read back the final cell_versions for the response
    const finalRow = await env.DB.prepare(
      "SELECT cell_versions FROM table_rows WHERE id = ? AND table_id = ?"
    ).bind(rowId, tableId).first();
    const finalVersions = finalRow ? JSON.parse(finalRow.cell_versions || "{}") : {};

    const response = { ok: true, id: rowId, cell_versions: finalVersions };
    if (conflicts) response.conflicts = conflicts;
    return jsonResponse(response);
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleDeleteRow(env, tableId, rowId, cascade, jsonResponse) {
  try {
    // Check if row has a linked Notion page — archive it too
    const row = await env.DB.prepare(
      "SELECT metadata FROM table_rows WHERE id = ? AND table_id = ?"
    ).bind(rowId, tableId).first();
    const metadata = row ? safeParseJSON(row.metadata) : {};

    // Check for children (sub-items)
    const childCheck = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM table_rows WHERE parent_row_id = ? AND table_id = ? AND archived = 0"
    ).bind(rowId, tableId).first();
    const childCount = childCheck?.cnt || 0;

    if (childCount > 0 && !cascade) {
      // Has children and no cascade specified — ask the client what to do
      return jsonResponse({ hasChildren: true, childCount }, 409);
    }

    if (childCount > 0 && cascade === "orphan") {
      // Move children to top level before archiving parent
      await env.DB.prepare(
        "UPDATE table_rows SET parent_row_id = NULL, updated_at = datetime('now') WHERE parent_row_id = ? AND table_id = ? AND archived = 0"
      ).bind(rowId, tableId).run();
    }

    if (childCount > 0 && cascade === "delete") {
      // Archive all descendants recursively
      await env.DB.prepare(
        `WITH RECURSIVE descendants(id) AS (
          SELECT id FROM table_rows WHERE parent_row_id = ? AND table_id = ? AND archived = 0
          UNION ALL
          SELECT tr.id FROM table_rows tr JOIN descendants d ON tr.parent_row_id = d.id WHERE tr.table_id = ? AND tr.archived = 0
        )
        UPDATE table_rows SET archived = 1, sync_dirty = 0, updated_at = datetime('now') WHERE id IN (SELECT id FROM descendants)`
      ).bind(rowId, tableId, tableId).run();
    }

    // Archive the row itself
    await env.DB.prepare(
      "UPDATE table_rows SET archived = 1, sync_dirty = 0, updated_at = datetime('now') WHERE id = ? AND table_id = ?"
    ).bind(rowId, tableId).run();

    // Archive corresponding Notion page (non-blocking)
    if (metadata.notion_page_id) {
      archiveNotionPage(env, metadata.notion_page_id).catch((err) =>
        console.error("[SyncDelete] Failed to archive Notion page:", err.message)
      );
    }

    // Invalidate data summary cache
    invalidateSummaryCache(env, tableId).catch(() => {});

    // Remove neuron nodes referencing this row (and cascade-deleted children)
    await env.DB.prepare("DELETE FROM neuron_nodes WHERE node_id = ?").bind(rowId).run();
    if (childCount > 0 && cascade === "delete") {
      await env.DB.prepare(`
        DELETE FROM neuron_nodes WHERE node_id IN (
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM table_rows WHERE parent_row_id = ? AND table_id = ?
            UNION ALL
            SELECT tr.id FROM table_rows tr JOIN descendants d ON tr.parent_row_id = d.id WHERE tr.table_id = ?
          ) SELECT id FROM descendants
        )
      `).bind(rowId, tableId, tableId).run();
    }
    // Clean up empty neurons
    await env.DB.prepare(
      "DELETE FROM neurons WHERE id NOT IN (SELECT DISTINCT neuron_id FROM neuron_nodes)"
    ).run();

    return jsonResponse({ ok: true, id: rowId });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleQueryTable(env, tableId, body, jsonResponse) {
  try {
    const limit = Math.min(body.limit || 1000, 10000);
    const offset = body.offset || 0;

    const rows = await env.DB.prepare(
      `SELECT * FROM table_rows WHERE table_id = ? AND archived = 0
       ORDER BY sort_order, created_at LIMIT ${limit} OFFSET ${offset}`
    ).bind(tableId).all();

    let parsed = rows.results.map((r) => ({
      ...r,
      cells: JSON.parse(r.cells || "{}"),
      cell_versions: JSON.parse(r.cell_versions || "{}"),
      metadata: JSON.parse(r.metadata || "{}"),
    }));

    // Apply filters on JSON cells (worker-side)
    if (body.filters && body.filters.length > 0) {
      parsed = applyRowFilters(parsed, body.filters);
    }

    // Apply sorts on JSON cells (worker-side)
    if (body.sorts && body.sorts.length > 0) {
      parsed = applyRowSorts(parsed, body.sorts);
    }

    return jsonResponse({ rows: parsed, total: parsed.length });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Record comment handlers moved to worker/handlers/records.js ───

// ─── Notification helpers + handlers moved to worker/handlers/notifications.js ───

// ─── Task Activity Handlers ───

// ─── Interaction handlers moved to worker/handlers/interactions.js ───

// ─── Document (R2) Handlers ───

// ─── Document handlers moved to worker/handlers/documents.js ───

// ─── File Storage Handlers (R2) ───

// ─── File handlers moved to worker/handlers/files.js ───

// ─── Row Filter/Sort Helpers ───

function applyRowFilters(rows, filters) {
  return rows.filter((row) =>
    filters.every((f) => {
      const val = row.cells[f.column];
      const cmp = f.value;
      switch (f.op) {
        case "equals": return val === cmp;
        case "not_equals": return val !== cmp;
        case "contains": return String(val || "").toLowerCase().includes(String(cmp).toLowerCase());
        case "not_contains": return !String(val || "").toLowerCase().includes(String(cmp).toLowerCase());
        case "starts_with": return String(val || "").toLowerCase().startsWith(String(cmp).toLowerCase());
        case "ends_with": return String(val || "").toLowerCase().endsWith(String(cmp).toLowerCase());
        case "is_empty": return val === null || val === undefined || val === "";
        case "is_not_empty": return val !== null && val !== undefined && val !== "";
        case "gt": return Number(val) > Number(cmp);
        case "gte": return Number(val) >= Number(cmp);
        case "lt": return Number(val) < Number(cmp);
        case "lte": return Number(val) <= Number(cmp);
        default: return true;
      }
    })
  );
}

function applyRowSorts(rows, sorts) {
  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const va = a.cells[s.column] ?? "";
      const vb = b.cells[s.column] ?? "";
      const dir = s.direction === "desc" ? -1 : 1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
    }
    return 0;
  });
}

export {
  handleGetSchema,
  handleUpdateSchema,
  handleListRows,
  handleCreateRows,
  handleUpdateRow,
  handleDeleteRow,
  handleQueryTable,
};
