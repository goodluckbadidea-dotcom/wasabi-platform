// ─── Page Config Persistence ───
// Stores and loads page configurations from Notion + localStorage cache.

import { queryAll, createPage, updatePage, createDatabase, getPage, getDatabase } from "../notion/client.js";
import { safeJSON } from "../utils/helpers.js";

const CONFIG_DB_SCHEMA = [
  { name: "Name", type: "title" },
  { name: "Icon", type: "rich_text" },
  { name: "Config", type: "rich_text" },
  { name: "ParentPage", type: "rich_text" },
  { name: "Active", type: "checkbox" },
];

const CACHE_KEY = "wasabi_page_configs";

/**
 * Initialize the Page Config database.
 */
export async function initConfigDB(workerUrl, notionKey, parentPageId) {
  const db = await createDatabase(workerUrl, notionKey, parentPageId, "Wasabi Page Configs", CONFIG_DB_SCHEMA);
  return db.id;
}

/**
 * Load all active page configs from Notion.
 * Returns array of page config objects.
 */
export async function loadPageConfigs(workerUrl, notionKey, configDbId) {
  const results = await queryAll(workerUrl, notionKey, configDbId, {
    property: "Active",
    checkbox: { equals: true },
  });

  const configs = results.map((page) => {
    const name = page.properties?.Name?.title?.map((t) => t.plain_text).join("") || "Untitled";
    const icon = page.properties?.Icon?.rich_text?.map((t) => t.plain_text).join("") || "page";
    const configStr = page.properties?.Config?.rich_text?.map((t) => t.plain_text).join("") || "{}";
    const parentId = page.properties?.ParentPage?.rich_text?.map((t) => t.plain_text).join("") || null;

    const config = safeJSON(configStr, {});
    return {
      id: page.id,
      name,
      icon,
      parentId: parentId || null,
      ...config,
    };
  });

  // Cache locally
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

/**
 * Save a page config to Notion.
 */
export async function savePageConfig(workerUrl, notionKey, configDbId, pageConfig) {
  const { id, name, icon, parentId, ...rest } = pageConfig;
  const configStr = JSON.stringify(rest);

  if (id) {
    // Update existing
    await updatePage(workerUrl, notionKey, id, {
      Name: { title: [{ type: "text", text: { content: name } }] },
      Icon: { rich_text: [{ type: "text", text: { content: icon || "page" } }] },
      Config: { rich_text: [{ type: "text", text: { content: configStr } }] },
      ParentPage: { rich_text: [{ type: "text", text: { content: parentId || "" } }] },
      Active: { checkbox: true },
    });
    return id;
  }

  // Create new
  const page = await createPage(workerUrl, notionKey, configDbId, {
    Name: { title: [{ type: "text", text: { content: name } }] },
    Icon: { rich_text: [{ type: "text", text: { content: icon || "page" } }] },
    Config: { rich_text: [{ type: "text", text: { content: configStr } }] },
    ParentPage: { rich_text: [{ type: "text", text: { content: parentId || "" } }] },
    Active: { checkbox: true },
  });

  return page.id;
}

/**
 * Check if a page config is a document page (no database).
 */
export function isDocumentPage(pageConfig) {
  return pageConfig?.pageType === "document";
}

/**
 * Create a document-type page config object.
 */
export function createDocumentPageConfig(name, icon, notionPageId) {
  return {
    name,
    icon: icon || "page",
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
 * Archive (soft-delete) a page config.
 */
export async function archivePageConfig(workerUrl, notionKey, pageConfigId) {
  await updatePage(workerUrl, notionKey, pageConfigId, {
    Active: { checkbox: false },
  });
}

/**
 * Validate page configs by checking if their Notion resources still exist.
 * Returns { valid, stale } — stale pages reference deleted databases/pages.
 */
export async function validatePageConfigs(workerUrl, notionKey, configs) {
  const results = await Promise.allSettled(
    configs.map(async (config) => {
      if (config.pageType === "document") {
        // Document pages: check the Notion page from the document view
        const docView = config.views?.find((v) => v.type === "document");
        const pageId = docView?.config?.pageId || config.notionPageId;
        if (pageId) await getPage(workerUrl, notionKey, pageId);
      } else {
        // Data pages: check the first database
        const dbIds = config.databaseIds || [];
        if (dbIds.length > 0) await getDatabase(workerUrl, notionKey, dbIds[0]);
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
