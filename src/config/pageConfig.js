// ─── Page Config Persistence (D1 Backend) ───
// CRUD via worker /pages routes. localStorage cache for instant loads.
// Replaces the old Notion-backed config storage.

import { listPages, createPageConfig as apiCreate, updatePageConfig as apiUpdate, deletePageConfig as apiDelete } from "../lib/api.js";
import { getPage, getDatabase } from "../notion/client.js";

const CACHE_KEY = "wasabi_page_configs";

// ─── Load from D1 ───

/**
 * Load all page configs from D1.
 * Returns array in the format the frontend expects.
 */
export async function loadPageConfigs() {
  const result = await listPages();
  const pages = result.pages || [];

  const configs = pages.map(d1ToFrontend);

  // Cache locally for instant loads on next mount
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(configs));
  } catch {}

  return configs;
}

/**
 * Load configs from localStorage cache (instant, no API call).
 */
export function loadCachedConfigs() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) : [];
  } catch {
    return [];
  }
}

// ─── Save / Update ───

/**
 * Save a page config (create or update) in D1.
 * Returns the page ID.
 */
export async function savePageConfig(pageConfig) {
  const d1 = frontendToD1(pageConfig);

  if (pageConfig.id) {
    await apiUpdate(pageConfig.id, d1);
    return pageConfig.id;
  }

  const result = await apiCreate(d1);
  return result.id;
}

/**
 * Archive (delete) a page config from D1.
 */
export async function archivePageConfig(pageConfigId) {
  await apiDelete(pageConfigId);
}

// ─── Validation ───

/**
 * Validate page configs by checking their backend resources.
 * D1 standalone tables are always valid. Only Notion-linked pages need validation.
 */
export async function validatePageConfigs(workerUrl, notionKey, configs) {
  if (!workerUrl || !notionKey) return { valid: configs, stale: [] };

  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const pt = config.page_type || config.pageType;
      // These don't reference Notion resources — always valid
      if (config.type === "folder") return config;
      if (pt === "database" || pt === "linked_sheet") return config;
      if (pt === "sub_page" && !config.databaseIds?.length) return config;

      if (pt === "document") {
        const docView = config.views?.find((v) => v.type === "document");
        const pageId = docView?.config?.pageId || config.notionPageId;
        if (pageId) await getPage(workerUrl, notionKey, pageId);
      } else if (config.databaseIds?.length) {
        await getDatabase(workerUrl, notionKey, config.databaseIds[0]);
      }
      return config;
    })
  );

  const valid = [];
  const stale = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      valid.push(configs[i]);
    } else {
      console.warn(`[PageConfig] Stale page "${configs[i].name}":`, result.reason?.message);
      stale.push(configs[i]);
    }
  });

  return { valid, stale };
}

// ─── Config Object Creators ───

/**
 * Create a folder config (no backend resources).
 */
export function createFolderConfig(name, icon) {
  return {
    name,
    icon: icon || "folder",
    type: "folder",
    page_type: "folder",
    databaseIds: [],
    views: [],
    refreshInterval: 0,
  };
}

/**
 * Create a standalone D1 table config.
 */
export function createTableConfig(name, icon, columns) {
  return {
    name,
    icon: icon || "table",
    type: "page",
    page_type: "database",
    pageType: "database",
    databaseIds: [],
    views: [
      {
        type: "table",
        label: "All Records",
        position: "main",
      },
    ],
    columns,
    refreshInterval: 0,
  };
}

/**
 * Create a linked Notion database config.
 */
export function createLinkedNotionConfig(name, icon, notionDbId) {
  return {
    name,
    icon: icon || "database",
    type: "page",
    page_type: "linked_notion",
    pageType: "linked_notion",
    databaseIds: [notionDbId],
    views: [
      {
        type: "table",
        label: "All Records",
        position: "main",
        config: { databaseId: notionDbId },
      },
    ],
    refreshInterval: 30000,
  };
}

/**
 * Create a document-type page config (Notion-backed for now).
 */
export function createDocumentPageConfig(name, icon, notionPageId) {
  return {
    name,
    icon: icon || "page",
    type: "page",
    page_type: "document",
    pageType: "document",
    notionPageId,
    databaseIds: [],
    views: [
      {
        type: "document",
        label: "Document",
        position: "main",
        config: { pageId: notionPageId },
      },
    ],
    refreshInterval: 0,
  };
}

/**
 * Check if a config represents a document page.
 */
export function isDocumentPage(pageConfig) {
  return pageConfig?.pageType === "document" || pageConfig?.page_type === "document";
}

// ─── D1 ↔ Frontend Format Conversion ───

/**
 * Convert D1 page_configs row → frontend page config object.
 */
function d1ToFrontend(d1Page) {
  const config = d1Page.config || {};
  const pt = d1Page.page_type;
  const type = pt === "folder" ? "folder"
    : pt === "sub_page" ? "sub_page"
    : "page";

  return {
    id: d1Page.id,
    name: d1Page.title,
    icon: d1Page.icon || "page",
    parentId: d1Page.parent_id || null,
    type,
    page_type: pt,
    pageType: ["document", "linked_sheet", "database", "linked_notion"].includes(pt) ? pt : undefined,
    sort_order: d1Page.sort_order || 0,
    ...config,
  };
}

/**
 * Convert frontend page config → D1 page_configs row.
 */
function frontendToD1(config) {
  const {
    id, name, icon, parentId, type, page_type, pageType,
    sort_order, columns, ...rest
  } = config;

  // Determine D1 page_type from available fields
  let d1Type = page_type || pageType;
  if (!d1Type) {
    if (type === "folder") d1Type = "folder";
    else if (type === "sub_page") d1Type = "sub_page";
    else if (rest.databaseIds?.length) d1Type = "linked_notion";
    else d1Type = "database";
  }

  const d1 = {
    title: name,
    icon: icon || "page",
    parent_id: parentId || null,
    page_type: d1Type,
    sort_order: sort_order || 0,
    config: rest,
  };

  // Include columns for new database table creation
  if (columns) d1.columns = columns;

  return d1;
}
