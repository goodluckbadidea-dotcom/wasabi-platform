// ─── Link Storage ───
// Stores and loads cell links via D1 API + localStorage cache.
// Each record represents a live data link between two cells across views/pages.

import * as api from "../lib/api.js";

const CACHE_KEY = "wasabi_links";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let _cacheTimestamp = 0;

/**
 * Load all active links from D1.
 * Uses localStorage cache if fresh (< 5 min), otherwise fetches from API.
 */
export async function loadLinks(_workerUrl, _notionKey, _linksDbId, forceRefresh = false) {
  // Check cache freshness
  if (!forceRefresh && Date.now() - _cacheTimestamp < CACHE_TTL) {
    const cached = loadCachedLinks();
    if (cached.length > 0) return cached;
  }

  const res = await api.listLinks();
  const links = (res.links || []).map(normalizeLink);

  // Cache locally
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(links));
    _cacheTimestamp = Date.now();
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
 * Save a link to D1 (create or update). Returns the link ID.
 */
export async function saveLink(_workerUrl, _notionKey, _linksDbId, link) {
  const { id, name, sourcePage, sourceView, sourceRef, targetPage, targetView, targetRef, direction, sourceFieldType, targetFieldType } = link;

  const payload = {
    source_page_id: sourcePage || "",
    source_view_idx: sourceView ?? 0,
    source_ref: sourceRef || {},
    target_page_id: targetPage || "",
    target_view_idx: targetView ?? 0,
    target_ref: targetRef || {},
    direction: direction || "one_way",
    source_field_type: sourceFieldType || "",
    target_field_type: targetFieldType || "",
  };

  // Existing link → update
  if (id && !id.startsWith("link_")) {
    await api.updateLinkAPI(id, payload);
    updateCachedLink({ ...link, id });
    return id;
  }

  // New link → create
  const res = await api.createLinkAPI(payload);
  const saved = { ...link, id: res.id };
  updateCachedLink(saved, id);
  return res.id;
}

/**
 * Delete a link from D1.
 */
export async function deleteLink(_workerUrl, _notionKey, linkId) {
  await api.deleteLinkAPI(linkId);
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
    _cacheTimestamp = Date.now();
  } catch {}
}

/**
 * Normalize a D1 link row into the app's link format.
 */
function normalizeLink(row) {
  return {
    id: row.id,
    name: row.name || "",
    sourcePage: row.source_page_id || "",
    sourceView: row.source_view_idx ?? 0,
    sourceRef: typeof row.source_ref === "string" ? JSON.parse(row.source_ref || "{}") : (row.source_ref || {}),
    targetPage: row.target_page_id || "",
    targetView: row.target_view_idx ?? 0,
    targetRef: typeof row.target_ref === "string" ? JSON.parse(row.target_ref || "{}") : (row.target_ref || {}),
    direction: row.direction || "one_way",
    sourceFieldType: row.source_field_type || "",
    targetFieldType: row.target_field_type || "",
  };
}

/**
 * Invalidate the cache so next loadLinks() fetches fresh data.
 */
export function invalidateLinksCache() {
  _cacheTimestamp = 0;
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
