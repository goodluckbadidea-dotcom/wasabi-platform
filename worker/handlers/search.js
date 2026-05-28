// ─── Record search across all D1-backed tables ───
// Schema-aware: resolves each table's "title" column from the page's
// schema and runs LIKE on json_extract(cells, '$."<titleCol>"') so the
// match always lands on the user-designated title cell, not whichever
// string cell happens to come first in JSON insertion order.

const RECORD_PAGE_TYPES = new Set([
  "database",
  "linked_notion",
  "linked_monday",
  "linked_sheet",
]);

export async function handleSearchRecords(env, url, jsonResponse) {
  const query = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit")) || 50, 200);
  if (!query) return jsonResponse({ results: [] });

  try {
    const [pagesRes, schemasRes] = await Promise.all([
      env.DB.prepare("SELECT id, title, icon, page_type, config FROM page_configs").all(),
      env.DB.prepare("SELECT id, columns FROM table_schemas").all(),
    ]);

    const titleColByTableId = new Map();
    for (const row of schemasRes.results || []) {
      let cols;
      try { cols = JSON.parse(row.columns || "[]"); } catch { continue; }
      const titleCol = (cols || []).find((c) => c?.type === "title");
      if (titleCol?.name) titleColByTableId.set(row.id, titleCol.name);
    }

    const candidates = [];
    for (const p of pagesRes.results || []) {
      if (!RECORD_PAGE_TYPES.has(p.page_type)) continue;
      let cfg;
      try { cfg = JSON.parse(p.config || "{}"); } catch { cfg = {}; }
      if (cfg._systemInternal) continue;
      const titleCol = titleColByTableId.get(p.id);
      if (!titleCol) continue;
      candidates.push({ id: p.id, name: p.title, icon: p.icon || "", titleCol });
    }

    const pattern = `%${query.toLowerCase()}%`;
    const results = [];

    for (const c of candidates) {
      if (results.length >= limit) break;
      const remaining = limit - results.length;
      const jsonPath = `$."${String(c.titleCol).replace(/"/g, '\\"')}"`;
      try {
        const rowsRes = await env.DB.prepare(
          `SELECT id, json_extract(cells, ?) AS title, updated_at
             FROM table_rows
            WHERE table_id = ?
              AND archived = 0
              AND json_extract(cells, ?) IS NOT NULL
              AND LOWER(json_extract(cells, ?)) LIKE ?
            ORDER BY updated_at DESC
            LIMIT ${Math.max(1, Math.min(remaining, 200))}`
        ).bind(jsonPath, c.id, jsonPath, jsonPath, pattern).all();

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
