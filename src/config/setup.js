// ─── First-Run Setup ───
// Creates the Wasabi platform infrastructure in the user's Notion workspace.

import { createSubpage, createDatabase } from "../notion/client.js";
import { initKnowledgeBase } from "../agent/memory.js";

const STORAGE_KEY = "wasabi_platform_ids";

const NOTIF_SCHEMA = [
  { name: "Message", type: "title" },
  { name: "Type", type: "select", options: ["notification", "alert", "summary"] },
  { name: "Source", type: "rich_text" },
  { name: "Status", type: "select", options: ["unread", "read", "archived"] },
];

const RULES_SCHEMA = [
  { name: "Name", type: "title" },
  { name: "Description", type: "rich_text" },
  { name: "Trigger", type: "select", options: ["schedule", "status_change", "field_change", "page_created", "manual"] },
  { name: "Trigger Config", type: "rich_text" },
  { name: "Instruction", type: "rich_text" },
  { name: "Database ID", type: "rich_text" },
  { name: "Enabled", type: "checkbox" },
  { name: "Last Fired", type: "date" },
  { name: "Fire Count", type: "number" },
  { name: "Owner Page", type: "rich_text" },
];

const CONFIG_SCHEMA = [
  { name: "Name", type: "title" },
  { name: "Icon", type: "rich_text" },
  { name: "Config", type: "rich_text" },
  { name: "ParentPage", type: "rich_text" },
  { name: "Active", type: "checkbox" },
];

/**
 * Run first-time setup: create all platform databases in user's Notion.
 * Returns the platform DB IDs.
 */
export async function runFirstTimeSetup(workerUrl, notionKey) {
  // 1. Create root page
  const rootPage = await createSubpage(workerUrl, notionKey, null, "Wasabi Platform");
  const rootId = rootPage.id;

  // 2. Create Knowledge Base DB
  const kbDbId = await initKnowledgeBase(workerUrl, notionKey, rootId);

  // 3. Create Page Config DB
  const configDb = await createDatabase(workerUrl, notionKey, rootId, "Page Configs", CONFIG_SCHEMA);
  const configDbId = configDb.id;

  // 4. Create Notifications DB
  const notifDb = await createDatabase(workerUrl, notionKey, rootId, "Notifications", NOTIF_SCHEMA);
  const notifDbId = notifDb.id;

  // 5. Create Automation Rules DB
  const rulesDb = await createDatabase(workerUrl, notionKey, rootId, "Automation Rules", RULES_SCHEMA);
  const rulesDbId = rulesDb.id;

  const ids = {
    rootPageId: rootId,
    kbDbId,
    configDbId,
    notifDbId,
    rulesDbId,
  };

  // Store locally
  savePlatformIds(ids);

  return ids;
}

/**
 * Save platform IDs to localStorage.
 */
export function savePlatformIds(ids) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {}
}

/**
 * Load platform IDs from localStorage.
 */
export function loadPlatformIds() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

/**
 * Check if first-time setup has been completed.
 */
export function isSetupComplete() {
  const ids = loadPlatformIds();
  return !!(ids?.rootPageId && ids?.kbDbId && ids?.configDbId && ids?.notifDbId && ids?.rulesDbId);
}

/**
 * Clear setup (for testing/reset).
 */
export function clearSetup() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("wasabi_page_configs");
    localStorage.removeItem("wasabi_user_keys");
  } catch {}
}
