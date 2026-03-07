// ─── Wasabi Knowledge Base ───
// Persistent memory system. Wasabi writes, page agents read.
// D1-backed via /d1/kb routes. Falls back to Notion for legacy configs.

import * as api from "../lib/api.js";

// Legacy Notion imports (kept for backward compat with existing setups)
import { queryAll, createPage, updatePage, createDatabase } from "../notion/client.js";

const KB_SCHEMA = [
  { name: "Key", type: "title" },
  { name: "Category", type: "select", options: ["page_config", "user_preference", "business_context", "learned_pattern", "database_schema"] },
  { name: "Content", type: "rich_text" },
  { name: "Source", type: "select", options: ["conversation", "automation", "system"] },
  { name: "Last Referenced", type: "date" },
];

/**
 * Legacy: Create the Knowledge Base Notion database under a parent page.
 * Only used by the old Notion-based setup flow.
 */
export async function initKnowledgeBase(workerUrl, notionKey, parentPageId) {
  const db = await createDatabase(workerUrl, notionKey, parentPageId, "Knowledge Base", KB_SCHEMA);
  return db.id;
}

/**
 * Write an entry to the Knowledge Base.
 * Uses D1 by default. Falls back to Notion if kbDbId is provided.
 */
export async function writeKB(workerUrl, notionKey, kbDbId, { key, category, content, source = "conversation" }) {
  // ── D1 path (preferred) ──
  // If no kbDbId provided or it looks like a D1 signal, use D1
  if (!kbDbId || kbDbId === "d1") {
    await api.createKBEntry({ key, category, content, source });
    return;
  }

  // ── Legacy Notion path ──
  const existing = await queryAll(workerUrl, notionKey, kbDbId, {
    property: "Key",
    title: { equals: key },
  });

  if (existing.length > 0) {
    return updatePage(workerUrl, notionKey, existing[0].id, {
      Content: { rich_text: [{ type: "text", text: { content } }] },
      Category: { select: { name: category } },
      Source: { select: { name: source } },
      "Last Referenced": { date: { start: new Date().toISOString().split("T")[0] } },
    });
  }

  return createPage(workerUrl, notionKey, kbDbId, {
    Key: { title: [{ type: "text", text: { content: key } }] },
    Category: { select: { name: category } },
    Content: { rich_text: [{ type: "text", text: { content } }] },
    Source: { select: { name: source } },
    "Last Referenced": { date: { start: new Date().toISOString().split("T")[0] } },
  });
}

/**
 * Search the Knowledge Base by text and optional category.
 */
export async function searchKB(workerUrl, notionKey, kbDbId, { query, category }) {
  // ── D1 path ──
  if (!kbDbId || kbDbId === "d1") {
    const result = await api.searchKB(query, category);
    return (result.results || []).map((r) => ({
      key: r.key,
      category: r.category,
      content: r.content,
      pageId: r.id,
    }));
  }

  // ── Legacy Notion path ──
  const filter = category
    ? { and: [{ property: "Category", select: { equals: category } }] }
    : undefined;

  const all = await queryAll(workerUrl, notionKey, kbDbId, filter);

  const queryLower = (query || "").toLowerCase();
  const scored = all.map((page) => {
    const key = page.properties?.Key?.title?.map((t) => t.plain_text).join("") || "";
    const content = page.properties?.Content?.rich_text?.map((t) => t.plain_text).join("") || "";
    const cat = page.properties?.Category?.select?.name || "";

    let score = 0;
    if (key.toLowerCase().includes(queryLower)) score += 10;
    if (content.toLowerCase().includes(queryLower)) score += 5;
    if (cat.toLowerCase().includes(queryLower)) score += 2;

    return { page, key, content, category: cat, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((s) => ({
      key: s.key,
      category: s.category,
      content: s.content,
      pageId: s.page.id,
    }));
}

/**
 * Read all entries in a category.
 */
export async function readKBCategory(workerUrl, notionKey, kbDbId, category) {
  // ── D1 path ──
  if (!kbDbId || kbDbId === "d1") {
    const result = await api.listKB({ category });
    return (result.entries || []).map((r) => ({
      key: r.key,
      content: r.content,
      pageId: r.id,
    }));
  }

  // ── Legacy Notion path ──
  const results = await queryAll(workerUrl, notionKey, kbDbId, {
    property: "Category",
    select: { equals: category },
  });

  return results.map((page) => ({
    key: page.properties?.Key?.title?.map((t) => t.plain_text).join("") || "",
    content: page.properties?.Content?.rich_text?.map((t) => t.plain_text).join("") || "",
    pageId: page.id,
  }));
}

/**
 * Format KB search results as text for agent context injection.
 */
export function kbResultsToText(results) {
  if (!results.length) return "No relevant knowledge found.";
  return results
    .map((r) => `[${r.category}] ${r.key}: ${r.content}`)
    .join("\n");
}
