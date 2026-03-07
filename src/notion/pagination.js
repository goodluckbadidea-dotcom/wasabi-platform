// ─── Notion Pagination Helper ───
// Full cursor-based pagination for Notion database queries.

import { getConnection } from "../lib/api.js";

/** Inject X-Wasabi-Key from stored connection into any headers object. */
function withAuth(headers = {}) {
  const conn = getConnection();
  if (conn?.secret) headers["X-Wasabi-Key"] = conn.secret;
  return headers;
}

/**
 * Query a Notion database with full pagination.
 * Returns ALL matching results (no cap).
 *
 * @param {string} workerUrl - Cloudflare Worker base URL
 * @param {string} notionKey - Notion API key
 * @param {string} databaseId - Target database ID
 * @param {object} [filter] - Notion filter object
 * @param {Array} [sorts] - Notion sorts array
 * @returns {Promise<Array>} All matching pages
 */
export async function queryAll(workerUrl, notionKey, databaseId, filter, sorts) {
  let results = [];
  let cursor = undefined;
  let attempts = 0;
  const maxAttempts = 50; // Safety valve

  while (attempts < maxAttempts) {
    attempts++;
    const body = {
      database_id: databaseId,
      page_size: 100,
    };
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(`${workerUrl}/query`, {
      method: "POST",
      headers: withAuth({
        "Content-Type": "application/json",
        Authorization: `Bearer ${notionKey}`,
      }),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      throw new Error(`Notion query failed (${res.status}): ${errText}`);
    }

    const data = await res.json();

    if (data._error) {
      throw new Error(`Notion query error: ${data._error}`);
    }

    results = results.concat(data.results || []);

    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return results;
}

/**
 * Query with a result limit (for previews, autocomplete, etc.)
 */
export async function queryLimited(workerUrl, notionKey, databaseId, filter, sorts, limit = 50) {
  const body = {
    database_id: databaseId,
    page_size: Math.min(limit, 100),
  };
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;

  const res = await fetch(`${workerUrl}/query`, {
    method: "POST",
    headers: withAuth({
      "Content-Type": "application/json",
      Authorization: `Bearer ${notionKey}`,
    }),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Notion query failed (${res.status})`);
  }

  const data = await res.json();
  return data.results || [];
}
