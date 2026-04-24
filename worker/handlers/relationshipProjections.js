// ─── Relationship Projections + Rebuild Script (Phase 1 stub) ───
//
// Projection layer for the unified relationships subsystem. One projector per
// legacy source system. Each projector mirrors facts from its source table into
// the `relationships` table as read-only edges with origin = 'projected_*'.
//
// ─── Invariants (design doc) ─────────────────────────────────────────────────
//
//   1. Projectors are idempotent. Running any projector twice in a row must
//      produce zero additional rows.
//
//   2. Projection edges are fully rebuildable from source. At any time:
//          DELETE FROM relationships WHERE origin LIKE 'projected_%'
//          await rebuildProjections(env)
//      must reproduce identical state.
//
//   3. Native edges (origin = 'user_declared' | 'ai_inferred') are never
//      touched by rebuild. Only projection edges are cleared and rewritten.
//
// ─── Phase 1 status ──────────────────────────────────────────────────────────
//
// Every projector below is a no-op stub. Phase 2 fills in the bodies. Running
// rebuildProjections() in Phase 1 performs the clear-slate DELETE (harmless —
// no projected rows exist because POST /relationships rejects projected
// origins) and returns { total: 0 }.
//
// ─── Projector map (for Phase 2 reference) ───────────────────────────────────
//
//   projectParentRows      — table_rows.parent_row_id → 'part_of'
//   projectCellLinks       — cell_links (active=1)     → 'references'
//   projectRelationColumns — relation column arrays    → 'related_to'
//   projectNeuronNodes     — neuron_nodes              → 'member_of_neuron'
//   projectMentions        — notifications (mention)   → 'mentioned_in'
//

export async function projectParentRows(_env) {
  // Phase 2: for every table_rows row where parent_row_id IS NOT NULL, upsert
  //   (record, row.id) --part_of--> (record, row.parent_row_id)
  //   origin = 'projected_parent_row', source_page_id = target_page_id = row.table_id.
  // Use INSERT OR IGNORE on a uniqueness tuple (source_type, source_id,
  // target_type, target_id, type) to stay idempotent.
  return 0;
}

export async function projectCellLinks(_env) {
  // Phase 2: for every cell_links row where active = 1, upsert
  //   (field, {record_id, column}) --references--> (field, {record_id, column})
  //   origin = 'projected_cell_link'. Meta carries the full source_ref/target_ref
  //   JSON so D1/Notion/sheet ref shapes are preserved.
  return 0;
}

export async function projectRelationColumns(_env) {
  // Phase 2: for every relation-column cell, decode the array and upsert one
  //   (record, row.id) --related_to--> (record, element_id)
  //   per element, origin = 'projected_relation_col'.
  return 0;
}

export async function projectNeuronNodes(_env) {
  // Phase 2: for every neuron_nodes row, upsert
  //   (node.type, node.id) --member_of_neuron--> (neuron, neuron_id)
  //   origin = 'projected_neuron_node'. Hub-and-spoke, not pairwise.
  return 0;
}

export async function projectMentions(_env) {
  // Phase 2: for every notifications row where type = 'mention', upsert
  //   (user, target_user_id) --mentioned_in--> (record, record_id)
  //   origin = 'projected_mention'. Meta carries the originating comment_id.
  return 0;
}

// ─── Rebuild ─────────────────────────────────────────────────────────────────
//
// Clears all projection edges and re-runs each projector. Native edges are
// untouched. Returns a count map so callers can verify how much was projected.
//
// Phase 1: the DELETE is a no-op in practice (no projected rows can exist) and
// each projector returns 0. The function is safe to call but produces nothing
// observable until Phase 2 projectors are implemented.
//
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
