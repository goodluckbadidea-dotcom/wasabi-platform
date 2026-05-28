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
      const coalesce = `COALESCE(${c.paths.map(() => "json_extract(cells, ?)").join(", ")})`;
      try {
        const rowsRes = await env.DB.prepare(
          `SELECT id, ${coalesce} AS title, updated_at
             FROM table_rows
            WHERE table_id = ?
              AND archived = 0
              AND ${coalesce} IS NOT NULL
              AND LOWER(${coalesce}) LIKE ?
            ORDER BY updated_at DESC
            LIMIT ${Math.max(1, Math.min(remaining, 200))}`
        ).bind(
          ...c.paths,            // SELECT COALESCE
          c.id,                  // table_id
          ...c.paths,            // WHERE IS NOT NULL COALESCE
          ...c.paths,            // WHERE LIKE COALESCE
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
      } catch {
        // Skip tables whose schema or rows break the query — keep going.
      }
    }

    return jsonResponse({ results: results.slice(0, limit) });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}
