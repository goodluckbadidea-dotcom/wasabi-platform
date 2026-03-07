// ─── Notion API Client ───
// All calls routed through Cloudflare Worker proxy.
// Every function takes workerUrl + notionKey (no globals).

import { queryAll, queryLimited } from "./pagination.js";
import { getConnection } from "../lib/api.js";

/** Inject X-Wasabi-Key from stored connection into any headers object. */
function withAuth(headers = {}) {
  const conn = getConnection();
  if (conn?.secret) headers["X-Wasabi-Key"] = conn.secret;
  return headers;
}

/**
 * Query a database (full pagination).
 */
export { queryAll, queryLimited };

/**
 * Get a single page by ID.
 */
export async function getPage(workerUrl, notionKey, pageId) {
  const res = await fetch(`${workerUrl}/page/${pageId}`, {
    headers: withAuth({ Authorization: `Bearer ${notionKey}` }),
  });
  if (!res.ok) throw new Error(`Failed to get page (${res.status})`);
  return res.json();
}

/**
 * Create a page in a database.
 */
export async function createPage(workerUrl, notionKey, databaseId, properties, children) {
  const body = {
    parent: { database_id: databaseId },
    properties,
  };
  if (children) body.children = children;

  const res = await fetch(`${workerUrl}/page`, {
    method: "POST",
    headers: withAuth({
      "Content-Type": "application/json",
      Authorization: `Bearer ${notionKey}`,
    }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const detail = errData._error || errData.message || "";
    throw new Error(`Failed to create page (${res.status})${detail ? ": " + detail : ""}`);
  }
  return res.json();
}

/**
 * Update a page's properties.
 */
export async function updatePage(workerUrl, notionKey, pageId, properties) {
  const res = await fetch(`${workerUrl}/page/${pageId}`, {
    method: "PATCH",
    headers: withAuth({
      "Content-Type": "application/json",
      Authorization: `Bearer ${notionKey}`,
    }),
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Failed to update page (${res.status}): ${err}`);
  }
  return res.json();
}

/**
 * Archive (soft-delete) a page.
 */
export async function archivePage(workerUrl, notionKey, pageId) {
  const res = await fetch(`${workerUrl}/page/${pageId}`, {
    method: "PATCH",
    headers: withAuth({
      "Content-Type": "application/json",
      Authorization: `Bearer ${notionKey}`,
    }),
    body: JSON.stringify({ archived: true }),
  });
  if (!res.ok) throw new Error(`Failed to archive page (${res.status})`);
  return res.json();
}

/**
 * Unarchive a page (restore from trash).
 */
export async function unarchivePage(workerUrl, notionKey, pageId) {
  const res = await fetch(`${workerUrl}/page/${pageId}`, {
    method: "PATCH",
    headers: withAuth({
      "Content-Type": "application/json",
      Authorization: `Bearer ${notionKey}`,
    }),
    body: JSON.stringify({ archived: false }),
  });
  if (!res.ok) throw new Error(`Failed to unarchive page (${res.status})`);
  return res.json();
}

/**
 * Ensure a page is active (not archived). Auto-unarchives if needed.
 * Returns the page object.
 */
export async function ensurePageActive(workerUrl, notionKey, pageId) {
  const page = await getPage(workerUrl, notionKey, pageId);
  if (page.archived) {
    return unarchivePage(workerUrl, notionKey, pageId);
  }
  return page;
}

/**
 * Get blocks (page content).
 */
export async function getBlocks(workerUrl, notionKey, pageId) {
  const res = await fetch(`${workerUrl}/blocks/${pageId}`, {
    headers: withAuth({ Authorization: `Bearer ${notionKey}` }),
  });
  if (!res.ok) throw new Error(`Failed to get blocks (${res.status})`);
  const data = await res.json();
  return data.results || [];
}

/**
 * Append block children to a page or block.
 * Uses the existing PATCH /blocks/:id worker route (plural — appends children).
 */
export async function appendBlocks(workerUrl, notionKey, parentId, children) {
  const res = await fetch(`${workerUrl}/blocks/${parentId}`, {
    method: "PATCH",
    headers: withAuth({
      "Content-Type": "application/json",
      Authorization: `Bearer ${notionKey}`,
    }),
    body: JSON.stringify({ children }),
  });
  if (!res.ok) throw new Error(`Failed to append blocks (${res.status})`);
  return res.json();
}

/**
 * Update a single block's content.
 * Uses the PATCH /block/:id worker route (singular — updates one block).
 */
export async function updateBlock(workerUrl, notionKey, blockId, blockData) {
  const res = await fetch(`${workerUrl}/block/${blockId}`, {
    method: "PATCH",
    headers: withAuth({
      "Content-Type": "application/json",
      Authorization: `Bearer ${notionKey}`,
    }),
    body: JSON.stringify(blockData),
  });
  if (!res.ok) throw new Error(`Failed to update block (${res.status})`);
  return res.json();
}

/**
 * Delete a single block.
 * Uses the DELETE /block/:id worker route.
 */
export async function deleteBlock(workerUrl, notionKey, blockId) {
  const res = await fetch(`${workerUrl}/block/${blockId}`, {
    method: "DELETE",
    headers: withAuth({ Authorization: `Bearer ${notionKey}` }),
  });
  if (!res.ok) throw new Error(`Failed to delete block (${res.status})`);
  return res.json();
}

/**
 * Create a new Notion database under a parent page.
 */
export async function createDatabase(workerUrl, notionKey, parentPageId, title, schema) {
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
        properties[field.name] = {
          relation: {
            database_id: field.relatedDbId,
            type: "single_property",
            single_property: {},
          },
        };
        break;
      default:
        properties[field.name] = { rich_text: {} };
    }
  }

  const res = await fetch(`${workerUrl}/create-database`, {
    method: "POST",
    headers: withAuth({
      "Content-Type": "application/json",
      Authorization: `Bearer ${notionKey}`,
    }),
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: title } }],
      properties,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const detail = errData._error || errData.message || "";
    throw new Error(`Failed to create database (${res.status})${detail ? ": " + detail : ""}`);
  }
  return res.json();
}

/**
 * Retrieve a database schema (properties definition).
 */
export async function getDatabase(workerUrl, notionKey, databaseId) {
  const res = await fetch(`${workerUrl}/database/${databaseId}`, {
    headers: withAuth({ Authorization: `Bearer ${notionKey}` }),
  });
  if (!res.ok) throw new Error(`Failed to get database (${res.status})`);
  return res.json();
}

/**
 * Update a database's schema (add/rename/remove properties) or title.
 * `payload` follows the Notion API: { title?, description?, properties? }
 */
export async function updateDatabase(workerUrl, notionKey, databaseId, payload) {
  const res = await fetch(`${workerUrl}/database/${databaseId}`, {
    method: "PATCH",
    headers: withAuth({
      "Content-Type": "application/json",
      Authorization: `Bearer ${notionKey}`,
    }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Failed to update database (${res.status}): ${err}`);
  }
  return res.json();
}

/**
 * Test Notion connection by listing user info.
 */
export async function testConnection(workerUrl, notionKey) {
  const res = await fetch(`${workerUrl}/test`, {
    headers: withAuth({ Authorization: `Bearer ${notionKey}` }),
  });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const data = await res.json();
  if (data._error) return { ok: false, error: data._error };
  return { ok: true, data };
}

/**
 * Create a page as a child of another page (not in a database).
 */
export async function createSubpage(workerUrl, notionKey, parentPageId, title, children) {
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

  const res = await fetch(`${workerUrl}/page`, {
    method: "POST",
    headers: withAuth({
      "Content-Type": "application/json",
      Authorization: `Bearer ${notionKey}`,
    }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const detail = errData._error || errData.message || "";
    throw new Error(`Failed to create subpage (${res.status})${detail ? ": " + detail : ""}`);
  }
  return res.json();
}

/**
 * Search for databases accessible to the integration.
 * @param {string} query - Optional search query
 * @returns {Array} Array of database objects
 */
export async function searchDatabases(workerUrl, notionKey, query = "") {
  const res = await fetch(`${workerUrl}/search`, {
    method: "POST",
    headers: withAuth({
      "Content-Type": "application/json",
      Authorization: `Bearer ${notionKey}`,
    }),
    body: JSON.stringify({
      query,
      filter: { value: "database", property: "object" },
      page_size: 50,
    }),
  });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const data = await res.json();
  return (data.results || []).filter((r) => r.object === "database" && !r.archived);
}

/**
 * Post a notification to the Notifications database.
 */
export async function postNotification(workerUrl, notionKey, notifDbId, { message, type = "notification", source = "wasabi" }) {
  return createPage(workerUrl, notionKey, notifDbId, {
    Message: { title: [{ type: "text", text: { content: message } }] },
    Type: { select: { name: type } },
    Source: { rich_text: [{ type: "text", text: { content: source } }] },
    Status: { select: { name: "unread" } },
  });
}
