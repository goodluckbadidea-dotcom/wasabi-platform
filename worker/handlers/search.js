// ─── Record search across all D1-backed tables ───
// Schema-aware: for each table, builds a list of candidate title paths
// from its schema (top-level title col, sub-item title col, first text
// col fallback — each as both column id and column name, since cell keys
// vary by table origin: Notion-synced tables key cells by name, native
// D1 tables key by id) and runs SQL LIKE on COALESCE(json_extract...).
// Server-side. No 500-row cap. No fallback-cell guessing.
//
// When the LIKE pass returns < FUZZY_EXACT_THRESHOLD results, a second
// pass scans up to FUZZY_PER_TABLE_LIMIT rows per table and ranks by
// normalized Levenshtein similarity. Same idea for neuron search.

const RECORD_PAGE_TYPES = new Set([
  "database",
  "linked_notion",
  "linked_monday",
  "linked_sheet",
]);

const FUZZY_THRESHOLD = 0.7;
const FUZZY_MIN_QUERY_LENGTH = 3;
const FUZZY_EXACT_THRESHOLD = 5;       // exact-match count below which fuzzy fires
const FUZZY_PER_TABLE_LIMIT = 500;     // candidates pulled per table for fuzzy
const FUZZY_RESULT_CAP = 25;           // max fuzzy results merged into a search

function normalizeForFuzzy(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function strSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// Best similarity between query and a candidate string. Tries the full
// normalized candidate plus each whitespace-delimited token; returns the
// max so "treform" can match "1st Run Tins (Treeform)" via the "treeform"
// token even though the full string is far off.
function fuzzySimilarity(normQuery, candidate) {
  const c = normalizeForFuzzy(candidate);
  if (!normQuery || !c) return 0;
  let best = strSimilarity(normQuery, c);
  for (const token of c.split(" ")) {
    if (!token) continue;
    const s = strSimilarity(normQuery, token);
    if (s > best) best = s;
  }
  return best;
}

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
    const seen = new Set();  // page+row keys we've already returned (exact pass)

    const buildTitleExpr = (paths) => paths.length === 1
      ? "json_extract(cells, ?)"
      : `COALESCE(${paths.map(() => "json_extract(cells, ?)").join(", ")})`;

    // ── Pass 1: exact substring (SQL LIKE) ──
    for (const c of candidates) {
      if (results.length >= limit) break;
      const remaining = limit - results.length;
      const titleExpr = buildTitleExpr(c.paths);
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
          const key = `${c.id}:${r.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
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
        console.error(`[search/records] table ${c.id} (${c.name}) failed (exact):`, err.message);
      }
    }

    // ── Pass 2: fuzzy fallback ──
    // Only fires when the exact pass came back light AND the query is long
    // enough to make fuzzy matches meaningful. Pulls a broader candidate
    // pool per table and ranks by Levenshtein similarity.
    const normQuery = normalizeForFuzzy(query);
    if (
      normQuery.length >= FUZZY_MIN_QUERY_LENGTH &&
      results.length < FUZZY_EXACT_THRESHOLD
    ) {
      const fuzzyHits = [];
      for (const c of candidates) {
        const titleExpr = buildTitleExpr(c.paths);
        try {
          const rowsRes = await env.DB.prepare(
            `SELECT id, ${titleExpr} AS title, updated_at
               FROM table_rows
              WHERE table_id = ?
                AND archived = 0
                AND ${titleExpr} IS NOT NULL
              ORDER BY updated_at DESC
              LIMIT ${FUZZY_PER_TABLE_LIMIT}`
          ).bind(
            ...c.paths,            // SELECT
            c.id,                  // table_id
            ...c.paths,            // WHERE IS NOT NULL
          ).all();

          for (const r of rowsRes.results || []) {
            const key = `${c.id}:${r.id}`;
            if (seen.has(key)) continue;
            const titleStr = String(r.title || "");
            const score = fuzzySimilarity(normQuery, titleStr);
            if (score >= FUZZY_THRESHOLD) {
              fuzzyHits.push({
                pageId: c.id,
                pageName: c.name,
                pageIcon: c.icon,
                rowId: r.id,
                title: titleStr,
                tableId: c.id,
                updatedAt: r.updated_at,
                fuzzy: true,
                fuzzyScore: score,
              });
            }
          }
        } catch (err) {
          console.error(`[search/records] table ${c.id} (${c.name}) failed (fuzzy):`, err.message);
        }
      }
      fuzzyHits.sort((a, b) => b.fuzzyScore - a.fuzzyScore);
      for (const h of fuzzyHits.slice(0, FUZZY_RESULT_CAP)) {
        if (results.length >= limit) break;
        const key = `${h.pageId}:${h.rowId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(h);
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
    // ── Exact pass: name LIKE OR member label LIKE ──
    const exactRes = await env.DB.prepare(
      `SELECT id, name, updated_at
         FROM neurons
        WHERE LOWER(name) LIKE ?
           OR id IN (SELECT neuron_id FROM neuron_nodes WHERE LOWER(node_label) LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ${Math.max(1, limit)}`
    ).bind(pattern, pattern).all();

    const neurons = exactRes.results || [];
    const exactIds = new Set(neurons.map((n) => n.id));

    // ── Fuzzy fallback: name OR any member label within Levenshtein threshold ──
    // Neurons are small enough to scan in full; we fetch every neuron + the
    // node labels and rank by best similarity per neuron.
    const normQuery = normalizeForFuzzy(query);
    if (
      normQuery.length >= FUZZY_MIN_QUERY_LENGTH &&
      neurons.length < FUZZY_EXACT_THRESHOLD
    ) {
      try {
        const [allNeuronsRes, allLabelsRes] = await Promise.all([
          env.DB.prepare("SELECT id, name, updated_at FROM neurons").all(),
          env.DB.prepare("SELECT neuron_id, node_label FROM neuron_nodes WHERE node_label != ''").all(),
        ]);
        const labelsByNeuron = new Map();
        for (const row of allLabelsRes.results || []) {
          const list = labelsByNeuron.get(row.neuron_id) || [];
          list.push(row.node_label);
          labelsByNeuron.set(row.neuron_id, list);
        }
        const fuzzyHits = [];
        for (const n of allNeuronsRes.results || []) {
          if (exactIds.has(n.id)) continue;
          let best = fuzzySimilarity(normQuery, n.name);
          for (const label of labelsByNeuron.get(n.id) || []) {
            const s = fuzzySimilarity(normQuery, label);
            if (s > best) best = s;
          }
          if (best >= FUZZY_THRESHOLD) {
            fuzzyHits.push({ ...n, _score: best });
          }
        }
        fuzzyHits.sort((a, b) => b._score - a._score);
        for (const h of fuzzyHits.slice(0, FUZZY_RESULT_CAP)) {
          if (neurons.length >= limit) break;
          neurons.push({ id: h.id, name: h.name, updated_at: h.updated_at });
          exactIds.add(h.id);
        }
      } catch (err) {
        console.error("[search/neurons] fuzzy pass failed:", err.message);
      }
    }

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
