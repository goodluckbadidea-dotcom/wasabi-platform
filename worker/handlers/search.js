// ─── Record search across all D1-backed tables ───
// Schema-aware: for each table, builds a list of candidate title paths
// from its schema (top-level title col, sub-item title col, first text
// col fallback — each as both column id and column name, since cell keys
// vary by table origin: Notion-synced tables key cells by name, native
// D1 tables key by id) and runs SQL LIKE on COALESCE(json_extract...).
// Server-side. No 500-row cap. No fallback-cell guessing.

const RECORD_PAGE_TYPES = new Set([
  "database",
  "linked_notion",
  "linked_monday",
  "linked_sheet",
]);

// Build the list of JSON paths to probe as the row's "title". Each title
// column contributes both its id and its name, since either may be used
// as the cell key depending on whether the table was synced from Notion
// or created natively in D1.
function buildTitlePaths(columns, subColumns) {
  const seen = new Set();
  const paths = [];
  const push = (key) => {
    if (!key) return;
    const escaped = String(key).replace(/"/g, '\\"');
    const path = `$."${escaped}"`;
    if (seen.has(path)) return;
    seen.add(path);
    paths.push(path);
  };

  // Prefer explicitly typed title columns from both schemas.
  const titleCols = [
    ...(columns || []).filter((c) => c?.type === "title"),
    ...(subColumns || []).filter((c) => c?.type === "title"),
  ];
  for (const c of titleCols) {
    push(c.id);
    push(c.name);
  }

  // Fallback: first text-typed column (top-level, then sub).
  if (titleCols.length === 0) {
    const firstText = (columns || []).find((c) => c?.type === "text")
      || (subColumns || []).find((c) => c?.type === "text");
    if (firstText) {
      push(firstText.id);
      push(firstText.name);
    }
  }

  return paths;
}

export async function handleSearchRecords(env, url, jsonResponse) {
  const query = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit")) || 50, 200);
  if (!query) return jsonResponse({ results: [] });

  try {
    const [pagesRes, schemasRes] = await Promise.all([
      env.DB.prepare("SELECT id, title, icon, page_type, config FROM page_configs").all(),
      env.DB.prepare("SELECT id, columns, sub_columns FROM table_schemas").all(),
    ]);

    const pathsByTableId = new Map();
    for (const row of schemasRes.results || []) {
      let cols, subs;
      try { cols = JSON.parse(row.columns || "[]"); } catch { cols = []; }
      try { subs = JSON.parse(row.sub_columns || "[]"); } catch { subs = []; }
      const paths = buildTitlePaths(cols, subs);
      if (paths.length > 0) pathsByTableId.set(row.id, paths);
    }

    const candidates = [];
    for (const p of pagesRes.results || []) {
      if (!RECORD_PAGE_TYPES.has(p.page_type)) continue;
      let cfg;
      try { cfg = JSON.parse(p.config || "{}"); } catch { cfg = {}; }
      if (cfg._systemInternal) continue;
      const paths = pathsByTableId.get(p.id);
      if (!paths || paths.length === 0) continue;
      candidates.push({ id: p.id, name: p.title, icon: p.icon || "", paths });
    }

    const pattern = `%${query.toLowerCase()}%`;
    const results = [];

    for (const c of candidates) {
      if (results.length >= limit) break;
      const remaining = limit - results.length;
      // SQLite COALESCE requires ≥2 args, so for single-path tables fall
      // back to a plain json_extract.
      const titleExpr = c.paths.length === 1
        ? "json_extract(cells, ?)"
        : `COALESCE(${c.paths.map(() => "json_extract(cells, ?)").join(", ")})`;
      try {
        const rowsRes = await env.DB.prepare(
          `SELECT id, ${titleExpr} AS title, updated_at
             FROM table_rows
            WHERE table_id = ?
              AND archived = 0
              AND ${titleExpr} IS NOT NULL
              AND LOWER(${titleExpr}) LIKE ?
            ORDER BY updated_at DESC
            LIMIT ${Math.max(1, Math.min(remaining, 200))}`
        ).bind(
          ...c.paths,            // SELECT
          c.id,                  // table_id
          ...c.paths,            // WHERE IS NOT NULL
          ...c.paths,            // WHERE LIKE
          pattern,
        ).all();

        for (const r of rowsRes.results || []) {
          results.push({
            pageId: c.id,
            pageName: c.name,
            pageIcon: c.icon,
            rowId: r.id,
            title: String(r.title || ""),
            tableId: c.id,
            updatedAt: r.updated_at,
          });
        }
      } catch (err) {
        // Log but don't fail the whole search — one broken table shouldn't
        // sink the rest. Surfacing the error helps diagnose next time.
        console.error(`[search/records] table ${c.id} (${c.name}) failed:`, err.message);
      }
    }

    return jsonResponse({ results: results.slice(0, limit) });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Neuron / topic search ───
// Matches the query against neuron.name OR any member node_label. For each
// matched neuron, returns its members with a resolved targetPageId so the
// dialog can navigate on click. Row nodes carry no page_config_id today,
// so we resolve their parent table via a single batched lookup.

export async function handleSearchNeurons(env, url, jsonResponse) {
  const query = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit")) || 20, 50);
  if (!query) return jsonResponse({ results: [] });

  const pattern = `%${query.toLowerCase()}%`;

  try {
    // Match neurons by name OR by containing a node whose label matches.
    const neuronsRes = await env.DB.prepare(
      `SELECT id, name, updated_at
         FROM neurons
        WHERE LOWER(name) LIKE ?
           OR id IN (SELECT neuron_id FROM neuron_nodes WHERE LOWER(node_label) LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ${Math.max(1, limit)}`
    ).bind(pattern, pattern).all();

    const neurons = neuronsRes.results || [];
    if (neurons.length === 0) return jsonResponse({ results: [] });

    // All members for the matched neurons in one shot.
    const neuronIds = neurons.map((n) => n.id);
    const placeholders = neuronIds.map(() => "?").join(", ");
    const nodesRes = await env.DB.prepare(
      `SELECT id, neuron_id, node_type, node_id, node_label, page_config_id
         FROM neuron_nodes
        WHERE neuron_id IN (${placeholders})
        ORDER BY created_at ASC`
    ).bind(...neuronIds).all();
    const nodes = nodesRes.results || [];

    // Row-typed nodes don't store page_config_id, so look up their parent
    // table_id in a single batched query.
    const rowNodeIds = Array.from(new Set(
      nodes
        .filter((n) => (n.node_type === "row" || n.node_type === "record") && !n.page_config_id)
        .map((n) => n.node_id)
    ));
    const rowToTable = new Map();
    if (rowNodeIds.length > 0) {
      const ph = rowNodeIds.map(() => "?").join(", ");
      const rowsRes = await env.DB.prepare(
        `SELECT id, table_id FROM table_rows WHERE id IN (${ph})`
      ).bind(...rowNodeIds).all();
      for (const r of rowsRes.results || []) {
        rowToTable.set(r.id, r.table_id);
      }
    }

    // Resolve each node to a targetPageId and collect those for a final
    // page-title lookup.
    const resolved = [];
    const targetPageIds = new Set();
    for (const n of nodes) {
      let targetPageId = n.page_config_id || null;
      if (!targetPageId) {
        if (n.node_type === "page" || n.node_type === "table") {
          targetPageId = n.node_id;
        } else if (n.node_type === "row" || n.node_type === "record") {
          targetPageId = rowToTable.get(n.node_id) || null;
        }
      }
      resolved.push({ ...n, targetPageId });
      if (targetPageId) targetPageIds.add(targetPageId);
    }

    // Page titles + icons for the dialog's secondary line.
    const pageMeta = new Map();
    if (targetPageIds.size > 0) {
      const ids = [...targetPageIds];
      const ph = ids.map(() => "?").join(", ");
      const pagesRes = await env.DB.prepare(
        `SELECT id, title, icon FROM page_configs WHERE id IN (${ph})`
      ).bind(...ids).all();
      for (const p of pagesRes.results || []) {
        pageMeta.set(p.id, { title: p.title, icon: p.icon || "" });
      }
    }

    // Group members under their neuron, dropping members we couldn't resolve.
    const membersByNeuron = new Map();
    for (const n of resolved) {
      if (!n.targetPageId) continue;
      const list = membersByNeuron.get(n.neuron_id) || [];
      const meta = pageMeta.get(n.targetPageId) || {};
      list.push({
        id: n.id,
        nodeType: n.node_type,
        nodeId: n.node_id,
        label: n.node_label || "",
        targetPageId: n.targetPageId,
        targetPageName: meta.title || "",
        targetPageIcon: meta.icon || "",
      });
      membersByNeuron.set(n.neuron_id, list);
    }

    const results = neurons.map((n) => {
      const members = membersByNeuron.get(n.id) || [];
      return {
        id: n.id,
        name: n.name,
        memberCount: members.length,
        members,
      };
    });

    return jsonResponse({ results });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}
