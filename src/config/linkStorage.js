// ─── Link Storage ───
// Stores and loads cell links from Notion + localStorage cache.
// Each record represents a live data link between two cells across views/pages.

import { queryAll, createPage, updatePage, createDatabase } from "../notion/client.js";
import { safeJSON } from "../utils/helpers.js";

const LINKS_SCHEMA = [
  { name: "Name", type: "title" },
  { name: "Source Page", type: "rich_text" },
  { name: "Source View", type: "number" },
  { name: "Source Ref", type: "rich_text" },      // JSON: { type, pageId?, field?, sheetUrl?, rowIndex?, column? }
  { name: "Target Page", type: "rich_text" },
  { name: "Target View", type: "number" },
  { name: "Target Ref", type: "rich_text" },      // JSON: same shape as Source Ref
  { name: "Direction", type: "select", options: ["one_way", "bidirectional"] },
  { name: "Active", type: "checkbox" },
];

const CACHE_KEY = "wasabi_links";

/**
 * Initialize the Links database (lazy, called on first use).
 */
export async function initLinksDB(workerUrl, notionKey, rootPageId) {
  const db = await createDatabase(workerUrl, notionKey, rootPageId, "Cell Links", LINKS_SCHEMA);
  return db.id;
}

/**
 * Load all active links from Notion.
 */
export async function loadLinks(workerUrl, notionKey, linksDbId) {
  const results = await queryAll(workerUrl, notionKey, linksDbId, {
    property: "Active",
    checkbox: { equals: true },
  });

  const links = results.map((page) => {
    const props = page.properties || {};
    const name = props.Name?.title?.map((t) => t.plain_text).join("") || "";
    const sourcePage = props["Source Page"]?.rich_text?.map((t) => t.plain_text).join("") || "";
    const sourceView = props["Source View"]?.number ?? 0;
    const sourceRefStr = props["Source Ref"]?.rich_text?.map((t) => t.plain_text).join("") || "{}";
    const targetPage = props["Target Page"]?.rich_text?.map((t) => t.plain_text).join("") || "";
    const targetView = props["Target View"]?.number ?? 0;
    const targetRefStr = props["Target Ref"]?.rich_text?.map((t) => t.plain_text).join("") || "{}";
    const direction = props.Direction?.select?.name || "one_way";

    return {
      id: page.id,
      name,
      sourcePage,
      sourceView,
      sourceRef: safeJSON(sourceRefStr, {}),
      targetPage,
      targetView,
      targetRef: safeJSON(targetRefStr, {}),
      direction,
    };
  });

  // Cache locally
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(links));
  } catch {}

  return links;
}

/**
 * Load links from localStorage cache (instant, no API call).
 */
export function loadCachedLinks() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) : [];
  } catch {
    return [];
  }
}

/**
 * Save a link to Notion (create or update). Returns the page ID.
 */
export async function saveLink(workerUrl, notionKey, linksDbId, link) {
  const { id, name, sourcePage, sourceView, sourceRef, targetPage, targetView, targetRef, direction } = link;

  const properties = {
    Name: { title: [{ type: "text", text: { content: name || "Link" } }] },
    "Source Page": { rich_text: [{ type: "text", text: { content: sourcePage || "" } }] },
    "Source View": { number: sourceView ?? 0 },
    "Source Ref": { rich_text: [{ type: "text", text: { content: JSON.stringify(sourceRef || {}) } }] },
    "Target Page": { rich_text: [{ type: "text", text: { content: targetPage || "" } }] },
    "Target View": { number: targetView ?? 0 },
    "Target Ref": { rich_text: [{ type: "text", text: { content: JSON.stringify(targetRef || {}) } }] },
    Direction: { select: { name: direction || "one_way" } },
    Active: { checkbox: true },
  };

  // Existing link → update
  if (id && !id.startsWith("link_")) {
    await updatePage(workerUrl, notionKey, id, properties);
    updateCachedLink({ ...link, id });
    return id;
  }

  // New link → create
  const page = await createPage(workerUrl, notionKey, linksDbId, properties);
  const saved = { ...link, id: page.id };
  updateCachedLink(saved, id);
  return page.id;
}

/**
 * Delete (archive) a link.
 */
export async function deleteLink(workerUrl, notionKey, linkId) {
  await updatePage(workerUrl, notionKey, linkId, {
    Active: { checkbox: false },
  });
  try {
    const cached = loadCachedLinks();
    const updated = cached.filter((l) => l.id !== linkId);
    localStorage.setItem(CACHE_KEY, JSON.stringify(updated));
  } catch {}
}

/**
 * Update a single link in the localStorage cache.
 */
function updateCachedLink(link, oldId) {
  try {
    const cached = loadCachedLinks();
    const idx = cached.findIndex((l) => l.id === (oldId || link.id));
    if (idx >= 0) {
      cached[idx] = link;
    } else {
      cached.push(link);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch {}
}

/**
 * Resolve a source ref to its current value.
 * @param {Object} ref - { type: "notion", pageId, field } or { type: "sheet", sheetUrl, rowIndex, column }
 * @param {Array} notionData - array of Notion page objects (with properties)
 * @param {Object} sheetDataMap - { sheetUrl → { columns, rows } }
 * @returns {*} The resolved value, or undefined if not found
 */
export function resolveRef(ref, notionData = [], sheetDataMap = {}) {
  if (!ref || !ref.type) return undefined;

  if (ref.type === "notion") {
    const page = notionData.find((p) => p.id === ref.pageId);
    if (!page?.properties?.[ref.field]) return undefined;
    const prop = page.properties[ref.field];
    // Extract plain value based on Notion property type
    if (prop.title) return prop.title.map((t) => t.plain_text).join("");
    if (prop.rich_text) return prop.rich_text.map((t) => t.plain_text).join("");
    if (prop.number !== undefined) return prop.number;
    if (prop.select) return prop.select?.name || "";
    if (prop.status) return prop.status?.name || "";
    if (prop.checkbox !== undefined) return prop.checkbox;
    if (prop.date) return prop.date?.start || "";
    if (prop.url) return prop.url || "";
    if (prop.email) return prop.email || "";
    if (prop.phone_number) return prop.phone_number || "";
    if (prop.multi_select) return prop.multi_select.map((s) => s.name).join(", ");
    if (prop.people) return prop.people.map((p) => p.name || p.id).join(", ");
    return JSON.stringify(prop);
  }

  if (ref.type === "sheet") {
    const sheet = sheetDataMap[ref.sheetUrl];
    if (!sheet) return undefined;
    const colIdx = sheet.columns.indexOf(ref.column);
    if (colIdx < 0) return undefined;
    const row = sheet.rows[ref.rowIndex];
    if (!row) return undefined;
    return row[colIdx];
  }

  return undefined;
}
