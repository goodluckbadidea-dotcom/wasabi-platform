// ─── Monday.com GraphQL Client ───
// All calls proxied through the Wasabi worker to avoid CORS.
// Worker route: POST /monday/graphql

import { getConnection } from "../lib/api.js";

/**
 * Execute a Monday.com GraphQL query through the worker proxy.
 */
async function mondayQuery(query, variables = {}, mondayKey) {
  const conn = getConnection();
  if (!conn?.workerUrl) throw new Error("Not connected — complete setup first");

  const res = await fetch(`${conn.workerUrl}/monday/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(conn.secret ? { "X-Wasabi-Key": conn.secret } : {}),
    },
    body: JSON.stringify({ query, variables, mondayKey }),
  });

  const json = await res.json();
  if (!res.ok || json.errors?.length) {
    const msg = json.errors?.[0]?.message || json._error || `Monday API error: ${res.status}`;
    throw new Error(msg);
  }
  return json.data;
}

// ─── Board Operations ───

/**
 * List all boards the user has access to.
 */
export async function fetchBoards(mondayKey) {
  const data = await mondayQuery(
    `query { boards(limit: 50) { id name columns { id title type settings_str } } }`,
    {},
    mondayKey,
  );
  return data.boards || [];
}

/**
 * Fetch column definitions for a specific board.
 */
export async function fetchBoardColumns(mondayKey, boardId) {
  const data = await mondayQuery(
    `query ($boardId: [ID!]!) { boards(ids: $boardId) { columns { id title type settings_str } } }`,
    { boardId: [String(boardId)] },
    mondayKey,
  );
  return data.boards?.[0]?.columns || [];
}

/**
 * Fetch all items from a board with pagination.
 */
export async function fetchBoardItems(mondayKey, boardId) {
  const allItems = [];
  let cursor = null;

  // First page
  const firstData = await mondayQuery(
    `query ($boardId: [ID!]!) {
      boards(ids: $boardId) {
        items_page(limit: 500) {
          cursor
          items {
            id
            name
            group { id title }
            column_values { id text value type }
            created_at
            updated_at
          }
        }
      }
    }`,
    { boardId: [String(boardId)] },
    mondayKey,
  );

  const firstPage = firstData.boards?.[0]?.items_page;
  if (firstPage?.items) allItems.push(...firstPage.items);
  cursor = firstPage?.cursor;

  // Subsequent pages
  while (cursor) {
    const nextData = await mondayQuery(
      `query ($cursor: String!) {
        next_items_page(limit: 500, cursor: $cursor) {
          cursor
          items {
            id
            name
            group { id title }
            column_values { id text value type }
            created_at
            updated_at
          }
        }
      }`,
      { cursor },
      mondayKey,
    );

    const nextPage = nextData.next_items_page;
    if (nextPage?.items) allItems.push(...nextPage.items);
    cursor = nextPage?.cursor;
  }

  return allItems;
}

// ─── Item CRUD ───

/**
 * Create a new item on a board.
 */
export async function createItem(mondayKey, boardId, itemName, columnValues = {}) {
  const data = await mondayQuery(
    `mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
        id
        name
      }
    }`,
    {
      boardId: String(boardId),
      itemName,
      columnValues: JSON.stringify(columnValues),
    },
    mondayKey,
  );
  return data.create_item;
}

/**
 * Update an existing item's column values.
 */
export async function updateItem(mondayKey, boardId, itemId, columnValues = {}) {
  const data = await mondayQuery(
    `mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $columnValues) {
        id
        name
      }
    }`,
    {
      boardId: String(boardId),
      itemId: String(itemId),
      columnValues: JSON.stringify(columnValues),
    },
    mondayKey,
  );
  return data.change_multiple_column_values;
}

/**
 * Delete an item.
 */
export async function deleteItem(mondayKey, itemId) {
  const data = await mondayQuery(
    `mutation ($itemId: ID!) { delete_item(item_id: $itemId) { id } }`,
    { itemId: String(itemId) },
    mondayKey,
  );
  return data.delete_item;
}
