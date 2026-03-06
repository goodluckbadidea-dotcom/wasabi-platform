// ─── Wasabi Knowledge Base ───
// Persistent memory system. Wasabi writes, page agents read.
// Stored as a Notion database with structured categories.

import { queryAll, createPage, updatePage, createDatabase } from "../notion/client.js";

const KB_SCHEMA = [
  { name: "Key", type: "title" },
  { name: "Category", type: "select", options: ["page_config", "user_preference", "business_context", "learned_pattern", "database_schema"] },
  { name: "Content", type: "rich_text" },
  { name: "Source", type: "select", options: ["conversation", "upload", "automation", "system"] },
  { name: "Last Referenced", type: "date" },
];

/**
 * Initialize the Knowledge Base database.
 * Called during first-run setup.
 */
export async function initKnowledgeBase(workerUrl, notionKey, parentPageId) {
  const db = await createDatabase(workerUrl, notionKey, parentPageId, "Wasabi Knowledge Base", KB_SCHEMA);
  return db.id;
}

/**
 * Write an entry to the Knowledge Base.
 * Checks for existing key — updates if found, creates if not.
 */
export async function writeKB(workerUrl, notionKey, kbDbId, { key, category, content, source = "conversation" }) {
  // Check for existing entry with same key
  const existing = await queryAll(workerUrl, notionKey, kbDbId, {
    property: "Key",
    title: { equals: key },
  });

  if (existing.length > 0) {
    // Update existing entry
    return updatePage(workerUrl, notionKey, existing[0].id, {
      Content: { rich_text: [{ type: "text", text: { content } }] },
      Category: { select: { name: category } },
      Source: { select: { name: source } },
      "Last Referenced": { date: { start: new Date().toISOString().split("T")[0] } },
    });
  }

  // Create new entry
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
 * Returns matching entries sorted by relevance (simple text match).
 */
export async function searchKB(workerUrl, notionKey, kbDbId, { query, category }) {
  const filter = category
    ? {
        and: [
          { property: "Category", select: { equals: category } },
        ],
      }
    : undefined;

  const all = await queryAll(workerUrl, notionKey, kbDbId, filter);

  // Simple text matching (Notion doesn't support full-text search via API)
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
 * Read all entries in a category (for lightweight context loading).
 */
export async function readKBCategory(workerUrl, notionKey, kbDbId, category) {
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
