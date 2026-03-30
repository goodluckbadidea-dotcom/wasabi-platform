// ─── Notion Pagination Helper ───
// Full cursor-based pagination for Notion database queries.
// All calls go through notionProxy → apiFetch (JWT auth).
// Worker retrieves the Notion key from D1 server-side.

import { notionProxy } from "../lib/api.js";

/**
 * Query a Notion database with full pagination.
 * Returns ALL matching results (no cap).
 *
 * @param {string} databaseId - Target database ID
 * @param {object} [filter] - Notion filter object
 * @param {Array} [sorts] - Notion sorts array
 * @returns {Promise<Array>} All matching pages
 */
export async function queryAll(databaseId, filter, sorts) {
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

    const data = await notionProxy("/query", "POST", body);

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
export async function queryLimited(databaseId, filter, sorts, limit = 50) {
  const body = {
    database_id: databaseId,
    page_size: Math.min(limit, 100),
  };
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;

  const data = await notionProxy("/query", "POST", body);
  return data.results || [];
}
