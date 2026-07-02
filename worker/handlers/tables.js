// ─── Table Schema + Row Handlers ───
// Schema CRUD, row CRUD, query, filters, sorts.
// Extracted from worker.js — zero logic changes.

import { safeParseJSON, resolveRecordTitle } from '../utils.js';
import { createNotificationInternal } from './notifications.js';
import { checkAutomationTriggers } from '../automation/engine.js';
import { invalidateSummaryCache, archiveNotionPage } from './notion-sync.js';
import {
  emitProjectedEdge, deleteProjectedEdge, deleteAllProjectedEdgesForEntity,
  getRelationColumns, resolveRecordPageId,
} from './relationshipProjections.js';
import { clearPinsForCompletedTask } from './task-pins.js';

// ─── Parent owner propagation ───
// When a sub-item gains an owner, walk up the parent chain and add any
// new owners to each ancestor's owner_user_id. Removal of owners from a
// sub does NOT propagate (per design — they may own the parent for other
// reasons). Best-effort: never breaks the caller if propagation fails.
//
// Multi-level chains: every ancestor up to the root receives the new
// owners. The visited-set guard short-circuits accidental cycles.
//
// Race safety: read-modify-write on parent.owner_user_id has a small
// window where two concurrent updates could overlap. Both compute a
// union, so the worst case is a redundant write — final state is still
// the correct super-set.
export async function propagateOwnersToAncestors(env, tableId, parentRowId, addedOwners, originRowId, user) {
  if (!parentRowId || !addedOwners?.length) return;
  let currentId = parentRowId;
  const visited = new Set();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const parent = await env.DB.prepare(
      "SELECT owner_user_id, parent_row_id FROM table_rows WHERE id = ? AND table_id = ?"
    ).bind(currentId, tableId).first();
    if (!parent) break;

    let parentOwners = [];
    const raw = parent.owner_user_id;
    if (raw && raw !== "default" && raw !== "unassigned") {
      try { parentOwners = JSON.parse(raw); } catch { parentOwners = [raw]; }
      if (!Array.isArray(parentOwners)) parentOwners = [parentOwners];
    }

    const ownerSet = new Set(parentOwners);
    const added = [];
    for (const o of addedOwners) {
      if (o && !ownerSet.has(o)) { ownerSet.add(o); added.push(o); }
    }

    if (added.length > 0) {
      await env.DB.prepare(
        "UPDATE table_rows SET owner_user_id = ?, sync_dirty = 1, updated_at = datetime('now') WHERE id = ? AND table_id = ?"
      ).bind(JSON.stringify([...ownerSet]), currentId, tableId).run();

      // Audit (best-effort, separate insert to avoid breaking the propagation
      // chain if the audit_log write fails for any reason).
      try {
        await env.DB.prepare(
          "INSERT INTO audit_log (id, user_id, user_name, action, resource_type, resource_id, details) VALUES (?, ?, ?, 'auto_assign_parent_owner', 'row', ?, ?)"
        ).bind(
          crypto.randomUUID(),
          user?.sub || "system",
          user?.name || "",
          currentId,
          JSON.stringify({ added_owners: added, origin_row_id: originRowId, reason: "sub-item ownership propagation" })
        ).run();
      } catch (_) { /* audit best-effort */ }
    }

    currentId = parent.parent_row_id;
  }
}

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

// Hard cap on nesting depth. Depth 0 = top-level, 1 = child, 2 = grandchild.
// Mirrors MAX_DEPTH in src/lib/useTreeData.js so the UI and backend never
// disagree about what's renderable.
const MAX_NEST_DEPTH = 2;

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

// Returns the depth of a row by walking up parent_row_id pointers.
// Root rows return 0, children of root return 1, grandchildren return 2.
async function getRowDepth(db, tableId, rowId) {
  let currentId = rowId;
  let depth = 0;
  const visited = new Set();
  while (currentId) {
    if (visited.has(currentId)) break; // cycle safety
    visited.add(currentId);
    const row = await db.prepare(
      "SELECT parent_row_id FROM table_rows WHERE id = ? AND table_id = ?"
    ).bind(currentId, tableId).first();
    if (!row?.parent_row_id) break;
    currentId = row.parent_row_id;
    depth++;
    if (depth > MAX_NEST_DEPTH + 2) break; // hard ceiling so a corrupted chain can't spin
  }
  return depth;
}

// Returns the deepest non-archived descendant offset below `rowId`.
// 0 if the row has no children. Early-exits once the depth exceeds the cap.
async function getSubtreeDepth(db, tableId, rowId) {
  let frontier = [rowId];
  let depth = 0;
  while (frontier.length > 0) {
    const placeholders = frontier.map(() => "?").join(",");
    const next = await db.prepare(
      `SELECT id FROM table_rows WHERE parent_row_id IN (${placeholders}) AND table_id = ? AND archived = 0`
    ).bind(...frontier, tableId).all();
    if (!next.results || next.results.length === 0) break;
    depth++;
    if (depth > MAX_NEST_DEPTH) break; // early-out — anything past cap is a reject anyway
    frontier = next.results.map((r) => r.id);
  }
  return depth;
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

    // Live projection: emit 'related_to' edges for any relation column values
    // on the newly created rows. Skipped entirely if the table has no relation
    // columns (single schema lookup, very cheap).
    try {
      const relCols = await getRelationColumns(env, tableId);
      if (relCols.length > 0) {
        for (const row of rows) {
          const cells = row.cells || {};
          for (const col of relCols) {
            const ids = cells[col.id];
            if (!Array.isArray(ids)) continue;
            for (const targetId of ids) {
              if (typeof targetId !== "string" || !targetId) continue;
              const targetPageId = await resolveRecordPageId(env, targetId);
              await emitProjectedEdge(env, {
                type: "related_to", origin: "projected_relation_col",
                source_type: "record", source_id: row.id || created[rows.indexOf(row)], source_page_id: tableId,
                target_type: "record", target_id: targetId, target_page_id: targetPageId,
                meta: { column_id: col.id, column_name: col.name || "" },
              });
            }
          }
        }
      }
    } catch (err) { console.error("[relationships] handleCreateRows projection failed:", err.message || err); }

    // Live projection: emit 'part_of' edges for any newly created sub-items.
    // Both endpoints share the same table_id (sub-items always live in their
    // parent's table).
    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row.parent_row_id) continue;
        await emitProjectedEdge(env, {
          type: "part_of", origin: "projected_parent_row",
          source_type: "record", source_id: row.id || created[i], source_page_id: tableId,
          target_type: "record", target_id: row.parent_row_id, target_page_id: tableId,
          meta: null,
        });
      }
    } catch (err) { console.error("[relationships] handleCreateRows part_of projection failed:", err.message || err); }

    // Auto-assign parent owners: each new sub-item is owned by its creator
    // (see ownerId above). Propagate that creator into each ancestor so the
    // parent surfaces in the creator's curated task list immediately.
    if (user?.sub) {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row.parent_row_id) continue;
        try {
          await propagateOwnersToAncestors(env, tableId, row.parent_row_id, [user.sub], created[i], user);
        } catch (err) {
          console.error("[parent_owner] create propagation failed:", err.message || err);
        }
      }
    }

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
      "SELECT cells, cell_versions, metadata, owner_user_id, parent_row_id, archived FROM table_rows WHERE id = ? AND table_id = ?"
    ).bind(rowId, tableId).first();
    const oldCells = existing ? JSON.parse(existing.cells || "{}") : {};
    const currentVersions = existing ? JSON.parse(existing.cell_versions || "{}") : {};
    const oldParentRowId = existing?.parent_row_id || null;
    const oldArchived = existing?.archived ? 1 : 0;

    // ── Circular reference check for parent_row_id ──
    if (body.parent_row_id) {
      if (body.parent_row_id === rowId) {
        return jsonResponse({ _error: "A record cannot be its own parent" }, 400);
      }
      const isCircular = await checkCircularReference(env.DB, tableId, rowId, body.parent_row_id);
      if (isCircular) {
        return jsonResponse({ _error: "Circular reference: this record is an ancestor of the target parent" }, 400);
      }

      // ── Depth cap: refuse moves that would push any row past MAX_NEST_DEPTH.
      // depth(newParent) + 1 + subtreeDepthBelow(rowId) ≤ MAX_NEST_DEPTH.
      const parentDepth = await getRowDepth(env.DB, tableId, body.parent_row_id);
      const subDepth = await getSubtreeDepth(env.DB, tableId, rowId);
      if (parentDepth + 1 + subDepth > MAX_NEST_DEPTH) {
        return jsonResponse({
          _error: `Maximum ${MAX_NEST_DEPTH + 1} levels of nesting`,
          code: "DEPTH_CAP_EXCEEDED",
        }, 400);
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

    // Auto-assign parent owners: when this row is a sub-item and gained
    // owners, union the new owner set into each ancestor's owners. Skips
    // when the body sets "unassigned" (removal does NOT propagate). Best-
    // effort — wrapped to never break the row update.
    if (body.owner_user_id !== undefined && existing?.parent_row_id) {
      try {
        const ov = body.owner_user_id;
        const newSubOwners = (ov && ov !== "unassigned")
          ? (Array.isArray(ov) ? ov : [ov])
          : [];
        if (newSubOwners.length > 0) {
          await propagateOwnersToAncestors(env, tableId, existing.parent_row_id, newSubOwners, rowId, user);
        }
      } catch (err) {
        console.error("[parent_owner] update propagation failed:", err.message || err);
      }
    }

    // Auto-clear task pins when this row moves to a done/cancelled status.
    // Reads the table schema, finds status columns, checks the new cell
    // value's category, and drops any pins pointing at this row. Best-
    // effort — never breaks the row update.
    if (body.cells !== undefined) {
      try {
        const schemaRow = await env.DB.prepare(
          "SELECT columns FROM table_schemas WHERE id = ?"
        ).bind(tableId).first();
        if (schemaRow?.columns) {
          const cols = JSON.parse(schemaRow.columns);
          for (const col of (Array.isArray(cols) ? cols : [])) {
            if (col?.type !== "status") continue;
            const rawVal = newCells[col.id] ?? newCells[col.name];
            if (!rawVal) continue;
            const valStr = String(rawVal).toLowerCase();
            const opt = (Array.isArray(col.options) ? col.options : [])
              .find((o) => String(o?.name || "").toLowerCase() === valStr);
            if (opt && (opt.category === "complete" || opt.category === "cancelled")) {
              await clearPinsForCompletedTask(env, rowId);
              break;
            }
          }
        }
      } catch (err) {
        console.error("[task-pins] auto-clear failed:", err?.message || err);
      }
    }

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
    // Enriched with change details so clients can apply local heuristic adjustments instantly
    const ownerChanged = body.owner_user_id !== undefined;
    let statusChanged = false;
    let newStatusValue = null;
    let statusFieldName = null;
    if (body.cells !== undefined && !body._fromSync) {
      const STATUS_FIELDS = ["status", "stage", "state", "phase", "done", "complete", "completed"];
      const schema = await env.DB.prepare("SELECT columns FROM table_schemas WHERE id = ?").bind(tableId).first();
      const cols = schema ? JSON.parse(schema.columns || "[]") : [];
      const colMap = Object.fromEntries(cols.map((c) => [c.id, c]));
      for (const colId of Object.keys(body.cells)) {
        const col = colMap[colId];
        if (!col) continue;
        const colName = (col.name || "").toLowerCase();
        const isStatus = col.type === "status" || col.type === "checkbox" || STATUS_FIELDS.some((s) => colName.includes(s));
        if (isStatus) {
          statusChanged = true;
          statusFieldName = col.name || colId;
          newStatusValue = newCells[colId] ?? body.cells[colId];
          break;
        }
      }
    }
    if (statusChanged || ownerChanged) {
      // Resolve new owner IDs for the enriched event
      let newOwnerUserIds = null;
      if (ownerChanged) {
        const ov = body.owner_user_id;
        if (ov === null || ov === "unassigned") newOwnerUserIds = [];
        else if (Array.isArray(ov)) newOwnerUserIds = ov;
        else newOwnerUserIds = [ov];
      }
      const changeEvent = {
        type: "task_record_changed",
        tableId,
        recordId: rowId,
        changes: {
          ownerChanged,
          newOwnerUserIds,
          statusChanged,
          newStatus: newStatusValue,
          statusField: statusFieldName,
          fieldChanged: body.cells !== undefined,
          updatedBy: user?.sub || null,
        },
      };
      (async () => {
        try {
          const allUsers = await env.DB.prepare("SELECT id FROM users WHERE deleted_at IS NULL").all();
          for (const u of (allUsers.results || [])) {
            try {
              const roomId = env.USER_ROOMS.idFromName(`user:${u.id}`);
              const room = env.USER_ROOMS.get(roomId);
              await room.fetch(new Request("https://internal/broadcast", {
                method: "POST",
                body: JSON.stringify(changeEvent),
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

    // Live projection: diff relation-column cell values, emit/delete edges
    // for added/removed targets. Only runs when cells actually changed and
    // the table has at least one relation column (cheap schema lookup).
    if (body.cells !== undefined) {
      try {
        const relCols = await getRelationColumns(env, tableId);
        if (relCols.length > 0) {
          for (const col of relCols) {
            const oldArr = Array.isArray(oldCells[col.id]) ? oldCells[col.id] : [];
            const newArr = Array.isArray(newCells[col.id]) ? newCells[col.id] : [];
            const added = newArr.filter((x) => typeof x === "string" && x && !oldArr.includes(x));
            const removed = oldArr.filter((x) => typeof x === "string" && x && !newArr.includes(x));
            for (const targetId of added) {
              const targetPageId = await resolveRecordPageId(env, targetId);
              await emitProjectedEdge(env, {
                type: "related_to", origin: "projected_relation_col",
                source_type: "record", source_id: rowId, source_page_id: tableId,
                target_type: "record", target_id: targetId, target_page_id: targetPageId,
                meta: { column_id: col.id, column_name: col.name || "" },
              });
            }
            for (const targetId of removed) {
              await deleteProjectedEdge(env, {
                type: "related_to", origin: "projected_relation_col",
                source_type: "record", source_id: rowId,
                target_type: "record", target_id: targetId,
              });
            }
          }
        }
      } catch (err) { console.error("[relationships] handleUpdateRow projection failed:", err.message || err); }
    }

    // Live projection: keep 'part_of' edge in sync with parent_row_id and
    // archived state. Cases handled:
    //   - parent_row_id moved A → B: delete old edge, emit new
    //   - parent_row_id removed (set to null): delete old edge
    //   - parent_row_id added (was null, now set): emit new edge
    //   - row archived (effective parent stays the same): delete edge
    //   - row unarchived: re-emit edge if it currently has a parent
    try {
      const parentChanging = body.parent_row_id !== undefined;
      const archiveChanging = body.archived !== undefined;
      if (parentChanging || archiveChanging) {
        const newParentRowId = parentChanging ? (body.parent_row_id || null) : oldParentRowId;
        const newArchived = archiveChanging ? (body.archived ? 1 : 0) : oldArchived;
        // Always remove the old edge if there was one
        if (oldParentRowId && (oldArchived === 0)) {
          await deleteProjectedEdge(env, {
            type: "part_of", origin: "projected_parent_row",
            source_type: "record", source_id: rowId,
            target_type: "record", target_id: oldParentRowId,
          });
        }
        // Re-emit only if the row is unarchived AND has a parent
        if (newParentRowId && newArchived === 0) {
          await emitProjectedEdge(env, {
            type: "part_of", origin: "projected_parent_row",
            source_type: "record", source_id: rowId, source_page_id: tableId,
            target_type: "record", target_id: newParentRowId, target_page_id: tableId,
            meta: null,
          });
        }
      }
    } catch (err) { console.error("[relationships] handleUpdateRow part_of projection failed:", err.message || err); }

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

async function handleDeleteRow(env, tableId, rowId, cascade, confirmDependents, jsonResponse) {
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

    // Check for downstream depends_on dependents — other records that have
    // declared they depend on this one. Cascade hint for depends_on is
    // 'prompt', so we ask the user before silently breaking those references.
    if (!confirmDependents) {
      try {
        const depCount = await env.DB.prepare(
          `SELECT COUNT(*) as cnt FROM relationships
            WHERE type = 'depends_on'
              AND origin IN ('user_declared','ai_inferred')
              AND target_type = 'record' AND target_id = ?
              AND deleted_at IS NULL`
        ).bind(rowId).first();
        const dependentCount = depCount?.cnt || 0;
        if (dependentCount > 0) {
          // Pull a sample of up to 5 dependent rows for the warning dialog
          const { results: depRows } = await env.DB.prepare(
            `SELECT r.source_id, r.source_page_id, tr.cells, tr.table_id
               FROM relationships r
               LEFT JOIN table_rows tr ON tr.id = r.source_id AND tr.archived = 0
              WHERE r.type = 'depends_on'
                AND r.origin IN ('user_declared','ai_inferred')
                AND r.target_type = 'record' AND r.target_id = ?
                AND r.deleted_at IS NULL
              LIMIT 5`
          ).bind(rowId).all();
          const sample = [];
          for (const dr of (depRows || [])) {
            let title = "Untitled";
            if (dr.cells && dr.table_id) {
              try {
                const cells = typeof dr.cells === "string" ? JSON.parse(dr.cells) : dr.cells;
                title = await resolveRecordTitle(env, dr.table_id, cells) || "Untitled";
              } catch (_) {}
            }
            sample.push({
              id: dr.source_id,
              title,
              page_id: dr.source_page_id || dr.table_id || null,
            });
          }
          return jsonResponse({
            hasDependents: true,
            dependentCount,
            dependentSample: sample,
          }, 409);
        }
      } catch (err) {
        console.error("[handleDeleteRow] dependent check failed:", err.message || err);
        // If the check itself errors out (e.g. relationships table missing in
        // a partially-migrated environment), don't block the delete.
      }
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

    // Live projection: sweep relation-column + part_of edges touching this row
    // (origin filter prevents native edges from being touched). For
    // cascade='delete', also sweep descendants since they're now archived.
    await deleteAllProjectedEdgesForEntity(env, {
      entity_type: "record", entity_id: rowId, origin: "projected_relation_col",
    });
    await deleteAllProjectedEdgesForEntity(env, {
      entity_type: "record", entity_id: rowId, origin: "projected_parent_row",
    });
    if (childCount > 0 && cascade === "delete") {
      try {
        const { results: descs } = await env.DB.prepare(`
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM table_rows WHERE parent_row_id = ? AND table_id = ?
            UNION ALL
            SELECT tr.id FROM table_rows tr JOIN descendants d ON tr.parent_row_id = d.id WHERE tr.table_id = ?
          ) SELECT id FROM descendants
        `).bind(rowId, tableId, tableId).all();
        const ids = (descs || []).map((r) => r.id).filter(Boolean);
        // Chunked DELETE for both relation-col and part_of edges
        for (let i = 0; i < ids.length; i += 100) {
          const chunk = ids.slice(i, i + 100);
          const placeholders = chunk.map(() => "?").join(",");
          await env.DB.prepare(`
            DELETE FROM relationships
             WHERE origin IN ('projected_relation_col', 'projected_parent_row')
               AND ((source_type = 'record' AND source_id IN (${placeholders}))
                 OR (target_type = 'record' AND target_id IN (${placeholders})))
          `).bind(...chunk, ...chunk).run();
        }
      } catch (err) { console.error("[relationships] handleDeleteRow descendant sweep failed:", err.message || err); }
    }
    if (childCount > 0 && cascade === "orphan") {
      // Children's parent_row_id was set to NULL — their part_of edges (if any)
      // pointed at this row, which we already cleaned via the target sweep above.
      // No additional work needed.
    }

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
