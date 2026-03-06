// ─── Notion API Client ───
// All calls routed through Cloudflare Worker proxy.
// Every function takes workerUrl + notionKey (no globals).

import { queryAll, queryLimited } from "./pagination.js";

/**
 * Query a database (full pagination).
 */
export { queryAll, queryLimited };

/**
 * Get a single page by ID.
 */
export async function getPage(workerUrl, notionKey, pageId) {
  const res = await fetch(`${workerUrl}/page/${pageId}`, {
    headers: { Authorization: `Bearer ${notionKey}` },
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
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${notionKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Failed to create page (${res.status}): ${err}`);
  }
  return res.json();
}

/**
 * Update a page's properties.
 */
export async function updatePage(workerUrl, notionKey, pageId, properties) {
  const res = await fetch(`${workerUrl}/page/${pageId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${notionKey}`,
    },
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
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${notionKey}`,
    },
    body: JSON.stringify({ archived: true }),
  });
  if (!res.ok) throw new Error(`Failed to archive page (${res.status})`);
  return res.json();
}

/**
 * Get blocks (page content).
 */
export async function getBlocks(workerUrl, notionKey, pageId) {
  const res = await fetch(`${workerUrl}/blocks/${pageId}`, {
    headers: { Authorization: `Bearer ${notionKey}` },
  });
  if (!res.ok) throw new Error(`Failed to get blocks (${res.status})`);
  const data = await res.json();
  return data.results || [];
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
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${notionKey}`,
    },
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: title } }],
      properties,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Failed to create database (${res.status}): ${err}`);
  }
  return res.json();
}

/**
 * Retrieve a database schema (properties definition).
 */
export async function getDatabase(workerUrl, notionKey, databaseId) {
  const res = await fetch(`${workerUrl}/database/${databaseId}`, {
    headers: { Authorization: `Bearer ${notionKey}` },
  });
  if (!res.ok) throw new Error(`Failed to get database (${res.status})`);
  return res.json();
}

/**
 * Test Notion connection by listing user info.
 */
export async function testConnection(workerUrl, notionKey) {
  const res = await fetch(`${workerUrl}/test`, {
    headers: { Authorization: `Bearer ${notionKey}` },
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
  const body = {
    parent: { type: "page_id", page_id: parentPageId },
    properties: {
      title: { title: [{ type: "text", text: { content: title } }] },
    },
  };
  if (children) body.children = children;

  const res = await fetch(`${workerUrl}/page`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${notionKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to create subpage (${res.status})`);
  return res.json();
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
