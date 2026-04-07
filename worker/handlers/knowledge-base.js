// ─── Knowledge base handlers ───
import { safeParseJSON } from '../utils.js';

export async function handleListKB(env, url, jsonResponse) {
  const category = url.searchParams.get("category");
  let query = "SELECT * FROM knowledge_base";
  const params = [];
  if (category) {
    query += " WHERE category = ?";
    params.push(category);
  }
  query += " ORDER BY updated_at DESC";

  const { results } = await env.DB.prepare(query).bind(...params).all();
  // Parse JSON fields
  const entries = (results || []).map((r) => ({
    ...r,
    related_pages: safeParseJSON(r.related_pages),
  }));
  return jsonResponse({ entries });
}

export async function handleCreateKB(env, body, jsonResponse) {
  const id = crypto.randomUUID();
  const {
    key, category = "business_context", content,
    source = "conversation", related_pages = [],
  } = body;

  if (!key || !content) return jsonResponse({ _error: "key and content required" }, 400);

  // Upsert: check for existing entry with same key
  const existing = await env.DB.prepare(
    "SELECT id FROM knowledge_base WHERE key = ?"
  ).bind(key).first();

  if (existing) {
    await env.DB.prepare(
      `UPDATE knowledge_base SET content = ?, category = ?, source = ?, related_pages = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(content, category, source, JSON.stringify(related_pages), existing.id).run();
    return jsonResponse({ id: existing.id, updated: true, success: true });
  }

  await env.DB.prepare(
    `INSERT INTO knowledge_base (id, key, category, content, source, related_pages, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(id, key, category, content, source, JSON.stringify(related_pages)).run();

  return jsonResponse({ id, success: true });
}

export async function handleGetKB(env, id, jsonResponse) {
  const row = await env.DB.prepare("SELECT * FROM knowledge_base WHERE id = ?").bind(id).first();
  if (!row) return jsonResponse({ _error: "KB entry not found" }, 404);
  row.related_pages = safeParseJSON(row.related_pages);
  return jsonResponse(row);
}

export async function handleUpdateKB(env, id, body, jsonResponse) {
  const sets = [];
  const vals = [];

  for (const [key, val] of Object.entries(body)) {
    if (["key", "category", "content", "source"].includes(key)) {
      sets.push(`${key} = ?`);
      vals.push(val);
    } else if (key === "related_pages") {
      sets.push("related_pages = ?");
      vals.push(JSON.stringify(val));
    }
  }

  if (sets.length === 0) return jsonResponse({ _error: "No valid fields to update" }, 400);

  sets.push("updated_at = datetime('now')");
  vals.push(id);

  await env.DB.prepare(`UPDATE knowledge_base SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return jsonResponse({ success: true, id });
}

export async function handleDeleteKB(env, id, jsonResponse) {
  await env.DB.prepare("DELETE FROM knowledge_base WHERE id = ?").bind(id).run();
  return jsonResponse({ success: true, id });
}

export async function handleSearchKB(env, body, jsonResponse) {
  const { query, category } = body;
  if (!query) return jsonResponse({ _error: "query required" }, 400);

  let sql = "SELECT * FROM knowledge_base";
  const params = [];
  if (category) {
    sql += " WHERE category = ?";
    params.push(category);
  }
  sql += " ORDER BY updated_at DESC";

  const { results } = await env.DB.prepare(sql).bind(...params).all();

  // Simple text matching (score by key + content match)
  const queryLower = query.toLowerCase();
  const scored = (results || []).map((r) => {
    let score = 0;
    if ((r.key || "").toLowerCase().includes(queryLower)) score += 10;
    if ((r.content || "").toLowerCase().includes(queryLower)) score += 5;
    if ((r.category || "").toLowerCase().includes(queryLower)) score += 2;
    return { ...r, related_pages: safeParseJSON(r.related_pages), _score: score };
  });

  const matches = scored
    .filter((s) => s._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 10);

  return jsonResponse({ results: matches });
}
