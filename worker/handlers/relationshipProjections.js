// ─── Relationship Projections + Rebuild Script ───
//
// Projection layer for the unified relationships subsystem. One projector per
// legacy source system. Each projector mirrors facts from its source table
// into the `relationships` table as edges with origin = 'projected_*'.
//
// ─── Invariants ──────────────────────────────────────────────────────────────
//
//   1. Projectors are idempotent. Running any projector twice in a row must
//      produce zero additional rows. Enforced by the partial UNIQUE INDEX
//      `idx_rel_uniq_active` on (source_type, source_id, target_type,
//      target_id, type) WHERE deleted_at IS NULL, combined with INSERT OR
//      IGNORE in every projector.
//
//   2. Projection edges are fully rebuildable from source. At any time:
//          DELETE FROM relationships WHERE origin LIKE 'projected_%'
//          await rebuildProjections(env)
//      must reproduce identical state.
//
//   3. Native edges (origin = 'user_declared' | 'ai_inferred') are never
//      touched by rebuild. Only projection edges are cleared and rewritten.
//
//   4. User-declared always wins. If a projection would shadow an existing
//      native edge with the same (source, target, type) tuple, INSERT OR
//      IGNORE silently skips — the native edge stays.
//
// ─── Projector map ───────────────────────────────────────────────────────────
//
//   projectParentRows      — table_rows.parent_row_id → 'part_of'
//   projectCellLinks       — cell_links (active=1)     → 'references'
//   projectRelationColumns — relation column arrays    → 'related_to'
//   projectNeuronNodes     — neuron_nodes              → 'member_of_neuron'
//   projectMentions        — notifications (mention)   → 'mentioned_in'
//

const D1_BATCH_SIZE = 100;

// Execute a list of prepared INSERT statements in chunks. Returns the total
// number of rows actually inserted (INSERT OR IGNORE that hit a duplicate
// reports changes=0 and is correctly excluded from the sum).
async function executeBatch(env, statements) {
  if (!statements || statements.length === 0) return 0;
  let inserted = 0;
  for (let i = 0; i < statements.length; i += D1_BATCH_SIZE) {
    const chunk = statements.slice(i, i + D1_BATCH_SIZE);
    const results = await env.DB.batch(chunk);
    for (const r of results) {
      inserted += r?.meta?.changes || 0;
    }
  }
  return inserted;
}

// Translate a cell_links source/target ref blob into a stable field-endpoint
// string ID. Returns null for unrecognized shapes (those refs are skipped).
export function refToFieldId(ref) {
  if (!ref || typeof ref !== 'object') return null;
  // D1 native: { type: "d1", record_id, column_name }
  if (ref.type === 'd1' && ref.record_id && ref.column_name) {
    return `d1:${ref.record_id}:${ref.column_name}`;
  }
  // Notion: { type: "notion", pageId, field } OR legacy { pageId, field }
  if ((ref.type === 'notion' || (!ref.type && ref.pageId)) && ref.pageId && ref.field) {
    return `notion:${ref.pageId}:${ref.field}`;
  }
  // Sheet: { type: "sheet", sheetUrl, rowIndex, column }
  if (ref.type === 'sheet' && ref.sheetUrl != null && ref.column != null) {
    return `sheet:${ref.sheetUrl}:${ref.rowIndex ?? 0}:${ref.column}`;
  }
  return null;
}

// Common INSERT shape used by all projectors. Positional binds in column order.
const INSERT_SQL = `
  INSERT OR IGNORE INTO relationships (
    id, type, source_type, source_id, source_page_id,
    target_type, target_id, target_page_id,
    directed, origin, confidence, meta,
    created_at, created_by, updated_at, deleted_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?, 'system', ?, NULL)
`;

// Fetch (record_id → table_id) for a list of record IDs. Used to fill in
// target_page_id when the target isn't pre-known (relation columns, neuron
// record-nodes that didn't store page_config_id).
async function lookupTablesForRecords(env, recordIds) {
  const map = {};
  if (recordIds.length === 0) return map;
  const unique = [...new Set(recordIds)];
  for (let i = 0; i < unique.length; i += D1_BATCH_SIZE) {
    const chunk = unique.slice(i, i + D1_BATCH_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id, table_id FROM table_rows WHERE id IN (${placeholders})`
    ).bind(...chunk).all();
    for (const r of (results || [])) map[r.id] = r.table_id;
  }
  return map;
}

// ─── 1. parent_row_id → part_of ──────────────────────────────────────────────
//
// For every unarchived row with a parent, emit one directed edge:
//   (record, row.id) --part_of--> (record, row.parent_row_id)
// Both endpoints live in the same table (sub-items always share their parent's
// table_id), so source_page_id == target_page_id == row.table_id.
export async function projectParentRows(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, table_id, parent_row_id
       FROM table_rows
      WHERE parent_row_id IS NOT NULL
        AND archived = 0`
  ).all();
  if (!results || results.length === 0) return 0;

  const now = new Date().toISOString();
  const stmt = env.DB.prepare(INSERT_SQL);
  const batch = results.map((row) => stmt.bind(
    crypto.randomUUID(),
    'part_of',
    'record', row.id, row.table_id,
    'record', row.parent_row_id, row.table_id,
    'projected_parent_row',
    null, // meta — fully captured by source/target
    now,
    now,
  ));
  return await executeBatch(env, batch);
}

// ─── 2. cell_links (active=1) → references ───────────────────────────────────
//
// For every active cell_link, emit one directed edge between the two field
// endpoints. Field endpoint IDs are stable strings derived from the link's
// ref blobs (see refToFieldId). The original ref shape is preserved in meta
// so consumers can resolve back to the underlying cell.
export async function projectCellLinks(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, source_page_id, source_view_idx, source_ref,
            target_page_id, target_view_idx, target_ref,
            source_field_type, target_field_type
       FROM cell_links
      WHERE active = 1`
  ).all();
  if (!results || results.length === 0) return 0;

  const now = new Date().toISOString();
  const stmt = env.DB.prepare(INSERT_SQL);
  const batch = [];
  for (const link of results) {
    let sourceRef, targetRef;
    try { sourceRef = JSON.parse(link.source_ref); } catch { continue; }
    try { targetRef = JSON.parse(link.target_ref); } catch { continue; }
    const sourceFieldId = refToFieldId(sourceRef);
    const targetFieldId = refToFieldId(targetRef);
    if (!sourceFieldId || !targetFieldId) continue;

    const meta = JSON.stringify({
      link_id: link.id,
      source_ref: sourceRef,
      target_ref: targetRef,
      source_view_idx: link.source_view_idx,
      target_view_idx: link.target_view_idx,
      source_field_type: link.source_field_type || null,
      target_field_type: link.target_field_type || null,
    });

    batch.push(stmt.bind(
      crypto.randomUUID(),
      'references',
      'field', sourceFieldId, link.source_page_id || null,
      'field', targetFieldId, link.target_page_id || null,
      'projected_cell_link',
      meta,
      now,
      now,
    ));
  }
  return await executeBatch(env, batch);
}

// ─── 3. relation column arrays → related_to ──────────────────────────────────
//
// Walk every table schema looking for columns where type='relation'. For each
// such column, scan the table's rows; for each ID in the array cell value,
// emit one directed edge (record → record). target_page_id is enriched via a
// batch lookup so the permission filter scopes results correctly.
export async function projectRelationColumns(env) {
  const { results: schemas } = await env.DB.prepare(
    'SELECT id, columns FROM table_schemas'
  ).all();
  if (!schemas || schemas.length === 0) return 0;

  // Group: tableId → [{ id, name }] of relation columns
  const relationColsByTable = {};
  for (const s of schemas) {
    let cols;
    try { cols = JSON.parse(s.columns); } catch { continue; }
    if (!Array.isArray(cols)) continue;
    const relCols = cols.filter((c) => c?.type === 'relation' && c?.id);
    if (relCols.length > 0) relationColsByTable[s.id] = relCols;
  }
  if (Object.keys(relationColsByTable).length === 0) return 0;

  // Collect candidate edges from row cell values
  const candidates = [];
  for (const [tableId, relCols] of Object.entries(relationColsByTable)) {
    const { results: rows } = await env.DB.prepare(
      'SELECT id, cells FROM table_rows WHERE table_id = ? AND archived = 0'
    ).bind(tableId).all();
    for (const row of (rows || [])) {
      let cells;
      try { cells = JSON.parse(row.cells); } catch { continue; }
      for (const col of relCols) {
        const value = cells?.[col.id];
        if (!Array.isArray(value)) continue;
        for (const targetId of value) {
          if (typeof targetId !== 'string' || !targetId) continue;
          candidates.push({
            sourceId: row.id,
            sourcePageId: tableId,
            targetId,
            columnId: col.id,
            columnName: col.name || '',
          });
        }
      }
    }
  }
  if (candidates.length === 0) return 0;

  // Enrich target_page_id via single batch lookup
  const tableIdByRowId = await lookupTablesForRecords(
    env,
    candidates.map((c) => c.targetId)
  );

  const now = new Date().toISOString();
  const stmt = env.DB.prepare(INSERT_SQL);
  const batch = candidates.map((c) => {
    const meta = JSON.stringify({ column_id: c.columnId, column_name: c.columnName });
    return stmt.bind(
      crypto.randomUUID(),
      'related_to',
      'record', c.sourceId, c.sourcePageId,
      'record', c.targetId, tableIdByRowId[c.targetId] || null,
      'projected_relation_col',
      meta,
      now,
      now,
    );
  });
  return await executeBatch(env, batch);
}

// ─── 4. neuron_nodes → member_of_neuron ──────────────────────────────────────
//
// Hub-and-spoke projection: every node points at its neuron. node_type values
// like 'table'/'database'/'folder'/'document' map to the unified 'page' entity
// type since they're all backed by page_configs. For 'record' nodes that lack
// a stored page_config_id, we look up the host table_id so the permission
// filter can scope edges to private databases.
export async function projectNeuronNodes(env) {
  const { results: nodes } = await env.DB.prepare(
    'SELECT id, neuron_id, node_type, node_id, node_label, page_config_id FROM neuron_nodes'
  ).all();
  if (!nodes || nodes.length === 0) return 0;

  const ALLOWED = new Set(['record', 'page', 'field', 'user', 'comment']);
  const PAGE_LIKE = new Set(['table', 'database', 'folder', 'document']);

  const candidates = [];
  for (const node of nodes) {
    let sourceType = node.node_type;
    if (PAGE_LIKE.has(sourceType)) sourceType = 'page';
    if (!ALLOWED.has(sourceType)) continue;
    if (!node.node_id || !node.neuron_id) continue;
    candidates.push({
      sourceType,
      sourceId: node.node_id,
      sourcePageId: node.page_config_id || null,
      neuronId: node.neuron_id,
      nodeLabel: node.node_label || '',
    });
  }
  if (candidates.length === 0) return 0;

  // For 'record' source-nodes without a stored page_config_id, look up table_id
  const recordsToLookup = candidates
    .filter((c) => c.sourceType === 'record' && !c.sourcePageId)
    .map((c) => c.sourceId);
  const tableIdByRowId = await lookupTablesForRecords(env, recordsToLookup);
  for (const c of candidates) {
    if (c.sourceType === 'record' && !c.sourcePageId && tableIdByRowId[c.sourceId]) {
      c.sourcePageId = tableIdByRowId[c.sourceId];
    }
  }

  const now = new Date().toISOString();
  const stmt = env.DB.prepare(INSERT_SQL);
  const batch = candidates.map((c) => {
    const meta = c.nodeLabel ? JSON.stringify({ node_label: c.nodeLabel }) : null;
    return stmt.bind(
      crypto.randomUUID(),
      'member_of_neuron',
      c.sourceType, c.sourceId, c.sourcePageId,
      'neuron', c.neuronId, null,
      'projected_neuron_node',
      meta,
      now,
      now,
    );
  });
  return await executeBatch(env, batch);
}

// ─── 5. notifications (type='mention') → mentioned_in ────────────────────────
//
// One directed edge per mention notification. Broadcast notifications
// (target_user_id = 'all') are skipped — they don't represent a specific
// user's mention. Multiple mentions of the same user in the same record
// dedupe to a single edge via the unique index; meta carries the originating
// notification id for traceability.
export async function projectMentions(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, target_user_id, record_id, page_config_id, source
       FROM notifications
      WHERE type = 'mention'
        AND target_user_id IS NOT NULL
        AND target_user_id != ''
        AND target_user_id != 'all'
        AND record_id IS NOT NULL
        AND record_id != ''`
  ).all();
  if (!results || results.length === 0) return 0;

  const now = new Date().toISOString();
  const stmt = env.DB.prepare(INSERT_SQL);
  const batch = results.map((notif) => {
    const meta = JSON.stringify({
      notification_id: notif.id,
      source: notif.source || '',
    });
    return stmt.bind(
      crypto.randomUUID(),
      'mentioned_in',
      'user', notif.target_user_id, null,
      'record', notif.record_id, notif.page_config_id || null,
      'projected_mention',
      meta,
      now,
      now,
    );
  });
  return await executeBatch(env, batch);
}

// ─── Live projection helpers (Step 3a) ──────────────────────────────────────
//
// Used by existing write paths (cell_links, neurons, table_rows) to keep the
// relationships table in sync as users mutate source data. Each helper is
// best-effort and origin-scoped — they can never accidentally touch a native
// edge (origin = 'user_declared' | 'ai_inferred').
//
// Errors are caught and logged inside the helpers so a projection failure
// can't break the user-visible save. Drift is auto-corrected on the next
// `rebuildProjections(env)` run.

// Insert a single projected edge. Idempotent: INSERT OR IGNORE against the
// partial UNIQUE INDEX skips duplicates and silently respects existing native
// edges with the same (source, target, type) tuple.
export async function emitProjectedEdge(env, params) {
  try {
    const {
      type, origin, meta = null, directed = 1,
      source_type, source_id, source_page_id = null,
      target_type, target_id, target_page_id = null,
    } = params;
    if (!type || !origin || !source_type || !source_id || !target_type || !target_id) return;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const metaJson = meta == null ? null : JSON.stringify(meta);
    await env.DB.prepare(INSERT_SQL).bind(
      id, type,
      source_type, source_id, source_page_id,
      target_type, target_id, target_page_id,
      origin, metaJson, now, now,
    ).run();
  } catch (err) {
    console.error('[relationships] emitProjectedEdge failed:', err.message || err);
  }
}

// Hard-delete a projected edge. The origin filter is critical — it prevents
// this helper from ever removing a native edge that happens to match the
// (source, target, type) tuple.
export async function deleteProjectedEdge(env, params) {
  try {
    const { type, origin, source_type, source_id, target_type, target_id } = params;
    if (!type || !origin) return;
    await env.DB.prepare(`
      DELETE FROM relationships
       WHERE type = ?
         AND origin = ?
         AND source_type = ? AND source_id = ?
         AND target_type = ? AND target_id = ?
    `).bind(type, origin, source_type, source_id, target_type, target_id).run();
  } catch (err) {
    console.error('[relationships] deleteProjectedEdge failed:', err.message || err);
  }
}

// Bulk-delete all projection edges of a given origin where this entity
// appears as either source or target. Used when an entity is destroyed
// (neuron deleted, row deleted) and all derived edges should be cleaned up.
// Origin filter prevents native-edge collateral damage.
export async function deleteAllProjectedEdgesForEntity(env, params) {
  try {
    const { entity_type, entity_id, origin } = params;
    if (!entity_type || !entity_id || !origin) return;
    await env.DB.prepare(`
      DELETE FROM relationships
       WHERE origin = ?
         AND ((source_type = ? AND source_id = ?)
           OR (target_type = ? AND target_id = ?))
    `).bind(origin, entity_type, entity_id, entity_type, entity_id).run();
  } catch (err) {
    console.error('[relationships] deleteAllProjectedEdgesForEntity failed:', err.message || err);
  }
}

// Bulk-delete all projection edges of a given origin pointing AT a target
// (regardless of source). Used when a neuron is deleted — every node's
// member_of_neuron edge for that neuron should disappear.
export async function deleteAllProjectedEdgesByTarget(env, params) {
  try {
    const { target_type, target_id, origin } = params;
    if (!target_type || !target_id || !origin) return;
    await env.DB.prepare(`
      DELETE FROM relationships
       WHERE origin = ?
         AND target_type = ? AND target_id = ?
    `).bind(origin, target_type, target_id).run();
  } catch (err) {
    console.error('[relationships] deleteAllProjectedEdgesByTarget failed:', err.message || err);
  }
}

// Map raw neuron node_type strings to the unified entity-type taxonomy.
// 'table'/'database'/'folder'/'document' are all backed by page_configs and
// collapse to 'page'. Returns null for types we don't accept as endpoints.
export function mapNeuronNodeTypeToEntityType(nodeType) {
  if (!nodeType) return null;
  const ALLOWED = new Set(['record', 'page', 'field', 'user', 'comment']);
  const PAGE_LIKE = new Set(['table', 'database', 'folder', 'document']);
  let t = nodeType;
  if (PAGE_LIKE.has(t)) t = 'page';
  return ALLOWED.has(t) ? t : null;
}

// Resolve the host page (table) for a record-type entity. Used to fill in
// source_page_id when the caller doesn't know it (e.g. neuron node-add
// without an explicit page_config_id). Returns null if not found.
export async function resolveRecordPageId(env, recordId) {
  if (!recordId) return null;
  try {
    const r = await env.DB.prepare(
      'SELECT table_id FROM table_rows WHERE id = ?'
    ).bind(recordId).first();
    return r?.table_id || null;
  } catch (err) {
    console.error('[relationships] resolveRecordPageId failed:', err.message || err);
    return null;
  }
}

// Fetch the relation-type columns defined on a table's schema. Returns an
// empty array if the schema is missing, malformed, or has no relations.
// Used by table-row handlers to decide whether to do diff work for the
// projected_relation_col origin.
export async function getRelationColumns(env, tableId) {
  if (!tableId) return [];
  try {
    const row = await env.DB.prepare(
      'SELECT columns FROM table_schemas WHERE id = ?'
    ).bind(tableId).first();
    if (!row?.columns) return [];
    const cols = JSON.parse(row.columns);
    if (!Array.isArray(cols)) return [];
    return cols.filter((c) => c?.type === 'relation' && c?.id);
  } catch (err) {
    console.error('[relationships] getRelationColumns failed:', err.message || err);
    return [];
  }
}

// ─── Rebuild ─────────────────────────────────────────────────────────────────
//
// Clears all projection edges and re-runs each projector. Native edges
// (user_declared, ai_inferred) are never touched. Returns a count map so
// callers can verify how much was projected per source.
export async function rebuildProjections(env) {
  await env.DB.prepare(
    "DELETE FROM relationships WHERE origin LIKE 'projected_%'"
  ).run();

  const counts = {
    projected_parent_row: await projectParentRows(env),
    projected_cell_link: await projectCellLinks(env),
    projected_relation_col: await projectRelationColumns(env),
    projected_neuron_node: await projectNeuronNodes(env),
    projected_mention: await projectMentions(env),
  };
  counts.total = Object.values(counts).reduce((a, b) => a + b, 0);
  return counts;
}
