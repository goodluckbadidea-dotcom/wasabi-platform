// ─── Notion API Client ───
// All calls routed through Cloudflare Worker proxy via apiFetch (JWT auth).
// Worker retrieves the Notion key from D1 server-side — no key needed from frontend.

import { notionProxy } from "../lib/api.js";
import { queryAll, queryLimited } from "./pagination.js";

/**
 * Query a database (full pagination).
 */
export { queryAll, queryLimited };

/**
 * Get a single page by ID.
 */
export async function getPage(pageId) {
  return notionProxy(`/page/${pageId}`, "GET");
}

/**
 * Create a page in a database.
 */
export async function createPage(databaseId, properties, children) {
  const body = {
    parent: { database_id: databaseId },
    properties,
  };
  if (children) body.children = children;
  return notionProxy("/page", "POST", body);
}

/**
 * Update a page's properties.
 */
export async function updatePage(pageId, properties) {
  return notionProxy(`/page/${pageId}`, "PATCH", { properties });
}

/**
 * Archive (soft-delete) a page.
 */
export async function archivePage(pageId) {
  return notionProxy(`/page/${pageId}`, "PATCH", { archived: true });
}

/**
 * Unarchive a page (restore from trash).
 */
export async function unarchivePage(pageId) {
  return notionProxy(`/page/${pageId}`, "PATCH", { archived: false });
}

/**
 * Ensure a page is active (not archived). Auto-unarchives if needed.
 * Returns the page object.
 */
export async function ensurePageActive(pageId) {
  const page = await getPage(pageId);
  if (page.archived) {
    return unarchivePage(pageId);
  }
  return page;
}

/**
 * Get blocks (page content).
 */
export async function getBlocks(pageId) {
  const data = await notionProxy(`/blocks/${pageId}`, "GET");
  return data.results || [];
}

/**
 * Append block children to a page or block.
 * Uses the existing PATCH /blocks/:id worker route (plural — appends children).
 */
export async function appendBlocks(parentId, children) {
  return notionProxy(`/blocks/${parentId}`, "PATCH", { children });
}

/**
 * Update a single block's content.
 * Uses the PATCH /block/:id worker route (singular — updates one block).
 */
export async function updateBlock(blockId, blockData) {
  return notionProxy(`/block/${blockId}`, "PATCH", blockData);
}

/**
 * Delete a single block.
 * Uses the DELETE /block/:id worker route.
 */
export async function deleteBlock(blockId) {
  return notionProxy(`/block/${blockId}`, "DELETE");
}

/**
 * Create a new Notion database under a parent page.
 */
export async function createDatabase(parentPageId, title, schema) {
  const properties = {};

  for (const field of schema) {
    switch (field.type) {
      case "title":
        properties[field.name] = { title: {} };
        break;
      case "rich_text":
        properties[field.name] = { rich_text: {} };
        break;
      case "number":
        properties[field.name] = { number: { format: field.format || "number" } };
        break;
      case "select":
        properties[field.name] = {
          select: {
            options: (field.options || []).map((o) =>
              typeof o === "string" ? { name: o } : o
            ),
          },
        };
        break;
      case "status":
        properties[field.name] = {
          status: {
            options: (field.options || []).map((o) =>
              typeof o === "string" ? { name: o } : o
            ),
          },
        };
        break;
      case "multi_select":
        properties[field.name] = {
          multi_select: {
            options: (field.options || []).map((o) =>
              typeof o === "string" ? { name: o } : o
            ),
          },
        };
        break;
      case "date":
        properties[field.name] = { date: {} };
        break;
      case "checkbox":
        properties[field.name] = { checkbox: {} };
        break;
      case "url":
        properties[field.name] = { url: {} };
        break;
      case "email":
        properties[field.name] = { email: {} };
        break;
      case "phone_number":
        properties[field.name] = { phone_number: {} };
        break;
      case "relation":
        if (field.synced && field.syncedPropertyName) {
          properties[field.name] = {
            relation: {
              database_id: field.relatedDbId,
              type: "dual_property",
              dual_property: { synced_property_name: field.syncedPropertyName },
            },
          };
        } else {
          properties[field.name] = {
            relation: {
              database_id: field.relatedDbId,
              type: "single_property",
              single_property: {},
            },
          };
        }
        break;
      default:
        properties[field.name] = { rich_text: {} };
    }
  }

  return notionProxy("/create-database", "POST", {
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: title } }],
    properties,
  });
}

/**
 * Retrieve a database schema (properties definition).
 */
export async function getDatabase(databaseId) {
  return notionProxy(`/database/${databaseId}`, "GET");
}

/**
 * Update a database's schema (add/rename/remove properties) or title.
 * `payload` follows the Notion API: { title?, description?, properties? }
 */
export async function updateDatabase(databaseId, payload) {
  return notionProxy(`/database/${databaseId}`, "PATCH", payload);
}

/**
 * Test Notion connection by listing user info.
 */
export async function testConnection() {
  try {
    const data = await notionProxy("/test", "GET");
    if (data._error) return { ok: false, error: data._error };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Create a page as a child of another page (not in a database).
 */
export async function createSubpage(parentPageId, title, children) {
  const parent = parentPageId
    ? { type: "page_id", page_id: parentPageId }
    : { type: "workspace", workspace: true };
  const body = {
    parent,
    properties: {
      title: { title: [{ type: "text", text: { content: title } }] },
    },
  };
  if (children) body.children = children;
  return notionProxy("/page", "POST", body);
}

/**
 * Search for databases accessible to the integration.
 * @param {string} query - Optional search query
 * @returns {Array} Array of database objects
 */
export async function searchDatabases(query = "") {
  const data = await notionProxy("/search", "POST", {
    query,
    filter: { value: "database", property: "object" },
    page_size: 50,
  });
  return (data.results || []).filter((r) => r.object === "database" && !r.archived);
}

/**
 * Post a notification to the Notifications database.
 */
export async function postNotification(notifDbId, { message, type = "notification", source = "wasabi" }) {
  return createPage(notifDbId, {
    Message: { title: [{ type: "text", text: { content: message } }] },
    Type: { select: { name: type } },
    Source: { rich_text: [{ type: "text", text: { content: source } }] },
    Status: { select: { name: "unread" } },
  });
}
