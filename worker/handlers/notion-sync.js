// ─── Notion Sync Handlers ───
// Sync configure/push/pull, backup, bootstrap, flush, and Notion prop helpers.
// Extracted from worker.js — zero logic changes.

import { safeParseJSON } from '../utils.js';
import { NOTION_API, NOTION_VERSION } from '../schema.js';
import { checkAutomationTriggers } from '../automation/engine.js';
import { decryptSecret, encryptSecret } from '../crypto.js';

async function runSyncFlushTick(env) {
  const LOG = "[SyncCron]";
  try {
    const notionKey = await getNotionKeyFromDB(env);
    if (!notionKey) return; // No Notion key configured

    // Check if any dirty rows exist before doing full flush
    const dirty = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM table_rows WHERE sync_dirty = 1 AND archived = 0"
    ).first();
    if (!dirty || dirty.cnt === 0) return;

    console.log(LOG, `${dirty.cnt} dirty row(s) — flushing`);

    // Reuse the flush logic (but we can't return an HTTP response, so call internal)
    const result = await syncFlushInternal(env, notionKey);
    console.log(LOG, `Done: ${result.created} created, ${result.updated} updated, ${result.errors} errors`);
  } catch (err) {
    console.error(LOG, "Flush tick failed:", err.message);
  }
}

/**
 * Internal sync flush logic (shared by cron and HTTP endpoint).
 */
async function syncFlushInternal(env, notionKey) {
  const MAX_ROWS = 10;
  const MAX_CONCURRENT = 3;
  const MAX_RETRIES = 5;

  const { results: dirtyRows } = await env.DB.prepare(
    `SELECT id, table_id, cells, metadata, sync_retry_count
     FROM table_rows
     WHERE sync_dirty = 1 AND archived = 0 AND sync_retry_count < ?
     ORDER BY updated_at ASC LIMIT ?`
  ).bind(MAX_RETRIES, MAX_ROWS).all();

  if (!dirtyRows || dirtyRows.length === 0) {
    return { flushed: 0, created: 0, updated: 0, errors: 0 };
  }

  // Group by table_id to batch-load sync configs
  const tableIds = [...new Set(dirtyRows.map((r) => r.table_id))];
  const configMap = {};
  const schemaMap = {};

  for (const tid of tableIds) {
    const config = await env.DB.prepare(
      "SELECT * FROM sync_configs WHERE table_id = ? AND enabled = 1"
    ).bind(tid).first();
    if (config) {
      configMap[tid] = config;
      const schema = await env.DB.prepare("SELECT columns FROM table_schemas WHERE id = ?").bind(tid).first();
      schemaMap[tid] = schema ? safeParseJSON(schema.columns) : [];
    }
  }

  let created = 0, updated = 0, errors = 0;

  for (let i = 0; i < dirtyRows.length; i += MAX_CONCURRENT) {
    const batch = dirtyRows.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.allSettled(
      batch.map((row) => flushSingleRow(env, row, configMap, schemaMap, notionKey))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value === "created") created++;
        else if (result.value === "updated") updated++;
      } else {
        errors++;
      }
    }
  }

  return { flushed: dirtyRows.length, created, updated, errors };
}

/**
 * Convert Notion database properties to D1 column definitions.
 * Used when auto-creating a table_schemas entry for a linked Notion database.
 */
function notionPropsToD1Columns(notionProps) {
  // Map Notion property types to D1 column types
  // CRITICAL: title→title (not text), status→status (not select)
  // These must match what d1SchemaToClassified() expects
  const typeMap = {
    title: "title", rich_text: "text", number: "number",
    select: "select", multi_select: "multi_select", status: "status",
    date: "date", checkbox: "checkbox", url: "url", email: "email",
    phone_number: "phone", people: "people", files: "files",
    relation: "relation", formula: "text", rollup: "text",
    created_time: "date", last_edited_time: "date",
    created_by: "text", last_edited_by: "text",
    unique_id: "text",
  };

  const columns = [];
  let titleCol = null;

  for (const [name, prop] of Object.entries(notionProps)) {
    const colType = typeMap[prop.type] || "text";
    const col = {
      id: name, // Use Notion property name as column ID for direct mapping
      name: name,
      type: colType,
    };

    // Extract select/multi_select/status options
    if (prop.type === "select" && prop.select?.options) {
      col.options = prop.select.options.map((o) => ({ label: o.name, color: o.color }));
    }
    if (prop.type === "multi_select" && prop.multi_select?.options) {
      col.options = prop.multi_select.options.map((o) => ({ label: o.name, color: o.color }));
    }
    if (prop.type === "status" && prop.status?.options) {
      col.options = prop.status.options.map((o) => ({ label: o.name, color: o.color }));
      if (prop.status?.groups) {
        col.groups = prop.status.groups.map((g) => ({
          name: g.name, color: g.color,
          options: (g.option_ids || []),
        }));
      }
    }

    // Mark computed properties as read-only
    if (["formula", "rollup", "created_time", "last_edited_time", "created_by", "last_edited_by", "unique_id"].includes(prop.type)) {
      col.readOnly = true;
    }

    // Track title column to ensure it's first
    if (prop.type === "title") {
      titleCol = col;
    } else {
      columns.push(col);
    }
  }

  // Title column MUST be first — d1SchemaToClassified uses columns[0] as title
  if (titleCol) {
    columns.unshift(titleCol);
  }

  return columns;
}

/**
 * Configure sync between a D1 table and a Notion database.
 * Creates or updates a sync_configs row + auto-generates field mapping.
 * If no D1 schema exists, auto-creates one from Notion properties.
 */
async function handleSyncConfigure(env, tableId, body, notionKey, jsonResponse) {
  const { notion_db_id, direction = "bidirectional", field_mapping } = body;
  if (!notion_db_id) return jsonResponse({ _error: "notion_db_id required" }, 400);
  if (!notionKey) return jsonResponse({ _error: "Notion API key not configured" }, 400);

  // Get Notion database schema FIRST (we need this whether or not D1 schema exists)
  let notionSchema;
  try {
    const res = await fetch(`${NOTION_API}/databases/${notion_db_id}`, {
      headers: {
        Authorization: `Bearer ${notionKey}`,
        "Notion-Version": NOTION_VERSION,
      },
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return jsonResponse({ _error: `Notion API error: ${errBody.message || res.status}` }, 502);
    }
    notionSchema = await res.json();
  } catch (err) {
    return jsonResponse({ _error: `Failed to reach Notion: ${err.message}` }, 502);
  }

  // Always regenerate D1 schema from Notion properties (handles schema drift + type fixes)
  const notionProps = notionSchema.properties || {};
  const columns = notionPropsToD1Columns(notionProps);

  await env.DB.prepare(
    `INSERT INTO table_schemas (id, columns, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET columns = excluded.columns, updated_at = datetime('now')`
  ).bind(tableId, JSON.stringify(columns)).run();

  {
  }

  // Auto-generate field mapping from D1 columns ↔ Notion properties
  let mapping = field_mapping;
  if (!mapping || Object.keys(mapping).length === 0) {
    mapping = {};
    const notionProps = notionSchema.properties || {};
    for (const col of Array.isArray(columns) ? columns : []) {
      const colName = col.name || col.id;
      if (notionProps[colName]) {
        mapping[col.id] = { notion_property: colName, notion_type: notionProps[colName].type };
      } else {
        const match = Object.entries(notionProps).find(
          ([k]) => k.toLowerCase() === colName.toLowerCase()
        );
        if (match) {
          mapping[col.id] = { notion_property: match[0], notion_type: match[1].type };
        }
      }
    }
  }

  // Check for existing config
  const existing = await env.DB.prepare(
    "SELECT id FROM sync_configs WHERE table_id = ?"
  ).bind(tableId).first();

  const id = existing?.id || crypto.randomUUID();

  if (existing) {
    await env.DB.prepare(
      "UPDATE sync_configs SET notion_db_id = ?, direction = ?, field_mapping = ?, enabled = 1 WHERE id = ?"
    ).bind(notion_db_id, direction, JSON.stringify(mapping), id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO sync_configs (id, table_id, notion_db_id, direction, field_mapping, enabled) VALUES (?, ?, ?, ?, ?, 1)"
    ).bind(id, tableId, notion_db_id, direction, JSON.stringify(mapping)).run();
  }

  return jsonResponse({
    id,
    table_id: tableId,
    notion_db_id,
    direction,
    field_mapping: mapping,
    notion_title: notionSchema.title?.[0]?.plain_text || "Untitled",
  });
}

/**
 * Push D1 table rows → Notion pages.
 * Creates new pages or updates existing ones (tracked via row metadata.notion_page_id).
 */
async function handleSyncPush(env, tableId, notionKey, jsonResponse) {
  if (!notionKey) return jsonResponse({ _error: "Notion API key not configured" }, 400);

  // Get sync config
  const config = await env.DB.prepare(
    "SELECT * FROM sync_configs WHERE table_id = ? AND enabled = 1"
  ).bind(tableId).first();
  if (!config) return jsonResponse({ _error: "No sync configured for this table" }, 404);

  const fieldMapping = safeParseJSON(config.field_mapping);
  const notionDbId = config.notion_db_id;

  // Get table schema for column name lookup
  const schema = await env.DB.prepare("SELECT columns FROM table_schemas WHERE id = ?").bind(tableId).first();
  const columns = schema ? (Array.isArray(safeParseJSON(schema.columns)) ? safeParseJSON(schema.columns) : []) : [];
  const colMap = {};
  for (const c of columns) colMap[c.id] = c;

  // Get all non-archived rows
  const { results: rows } = await env.DB.prepare(
    "SELECT * FROM table_rows WHERE table_id = ? AND archived = 0"
  ).bind(tableId).all();

  let created = 0, updated = 0, errors = 0;

  for (const row of rows || []) {
    const cells = safeParseJSON(row.cells);
    const metadata = safeParseJSON(row.metadata);
    const notionPageId = metadata.notion_page_id;

    // Build Notion properties from field mapping
    const properties = {};
    for (const [colId, mapping] of Object.entries(fieldMapping)) {
      const value = cells[colId];
      if (value === undefined || value === null) continue;
      const notionProp = mapping.notion_property;
      const notionType = mapping.notion_type;
      properties[notionProp] = buildNotionPropValue(notionType, value);
    }

    try {
      if (notionPageId) {
        // Update existing Notion page
        await fetch(`${NOTION_API}/pages/${notionPageId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${notionKey}`,
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ properties }),
        });
        updated++;
      } else {
        // Create new Notion page
        const res = await fetch(`${NOTION_API}/pages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${notionKey}`,
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            parent: { database_id: notionDbId },
            properties,
          }),
        });
        const page = await res.json();
        if (page.id) {
          // Store Notion page ID in row metadata
          metadata.notion_page_id = page.id;
          metadata.last_synced_at = new Date().toISOString();
          await env.DB.prepare(
            "UPDATE table_rows SET metadata = ? WHERE id = ?"
          ).bind(JSON.stringify(metadata), row.id).run();
          created++;
        } else {
          errors++;
        }
      }
    } catch (err) {
      console.error(`Sync push error for row ${row.id}:`, err.message);
      errors++;
    }
  }

  // Update last synced timestamp
  await env.DB.prepare(
    "UPDATE sync_configs SET last_synced_at = datetime('now') WHERE table_id = ?"
  ).bind(tableId).run();

  return jsonResponse({ pushed: { created, updated, errors }, total: (rows || []).length });
}

/**
 * Pull Notion pages → D1 table rows.
 * Creates new rows or updates existing ones (matched by notion_page_id in metadata).
 */
async function handleSyncPull(env, tableId, notionKey, fullResync = false, jsonResponse) {
  if (!notionKey) return jsonResponse({ _error: "Notion API key not configured" }, 400);

  const config = await env.DB.prepare(
    "SELECT * FROM sync_configs WHERE table_id = ? AND enabled = 1"
  ).bind(tableId).first();
  if (!config) return jsonResponse({ _error: "No sync configured for this table" }, 404);

  const fieldMapping = safeParseJSON(config.field_mapping);
  const notionDbId = config.notion_db_id;
  const lastSyncedAt = config.last_synced_at;

  // Get table schema
  const schema = await env.DB.prepare("SELECT columns FROM table_schemas WHERE id = ?").bind(tableId).first();
  const columns = schema ? (Array.isArray(safeParseJSON(schema.columns)) ? safeParseJSON(schema.columns) : []) : [];

  // Get existing rows with notion_page_id
  const { results: existingRows } = await env.DB.prepare(
    "SELECT id, cells, metadata FROM table_rows WHERE table_id = ? AND archived = 0"
  ).bind(tableId).all();

  const notionIdToRowId = {};
  const notionIdToOldCells = {};
  for (const row of existingRows || []) {
    const meta = safeParseJSON(row.metadata);
    if (meta.notion_page_id) {
      notionIdToRowId[meta.notion_page_id] = row.id;
      notionIdToOldCells[meta.notion_page_id] = safeParseJSON(row.cells);
    }
  }

  // Build Notion query — use incremental filter if we have a last_synced_at and not full resync
  const queryBody = { page_size: 100 };
  if (lastSyncedAt && !fullResync) {
    queryBody.filter = {
      timestamp: "last_edited_time",
      last_edited_time: { after: lastSyncedAt },
    };
  }

  // Query pages from Notion database (with pagination)
  let notionPages = [];
  let cursor = undefined;
  do {
    const body = { ...queryBody };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`${NOTION_API}/databases/${notionDbId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionKey}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    notionPages.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  // Refresh schema options from Notion DB metadata (keeps select/status options current)
  try {
    const dbMeta = await fetch(`${NOTION_API}/databases/${notionDbId}`, {
      headers: { Authorization: `Bearer ${notionKey}`, "Notion-Version": NOTION_VERSION },
    });
    if (dbMeta.ok) {
      const dbData = await dbMeta.json();
      const freshColumns = notionPropsToD1Columns(dbData.properties || {});
      // Merge: update options on existing columns, add new columns
      const existingById = {};
      for (const c of columns) existingById[c.id] = c;
      for (const fc of freshColumns) {
        if (existingById[fc.id]) {
          // Update options and type if changed
          existingById[fc.id].options = fc.options || existingById[fc.id].options;
          existingById[fc.id].type = fc.type;
        } else {
          columns.push(fc);
          existingById[fc.id] = fc;
        }
      }
      await env.DB.prepare(
        "UPDATE table_schemas SET columns = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(JSON.stringify(columns), tableId).run();

      // Also add new columns to field mapping
      for (const fc of freshColumns) {
        if (!fieldMapping[fc.id]) {
          fieldMapping[fc.id] = { notion_property: fc.name, notion_type: fc.type };
        }
      }
      await env.DB.prepare(
        "UPDATE sync_configs SET field_mapping = ? WHERE table_id = ?"
      ).bind(JSON.stringify(fieldMapping), tableId).run();
    }
  } catch (err) {
    console.error(`Schema refresh failed for ${tableId}:`, err.message);
  }

  let created = 0, updated = 0, archived = 0, errors = 0;

  // Reverse field mapping: notion_property → col_id
  const reverseMapping = {};
  for (const [colId, mapping] of Object.entries(fieldMapping)) {
    reverseMapping[mapping.notion_property] = colId;
  }

  const seenNotionIds = new Set();

  for (const page of notionPages) {
    seenNotionIds.add(page.id);

    // Handle archived/trashed Notion pages
    if (page.archived) {
      const existingRowId = notionIdToRowId[page.id];
      if (existingRowId) {
        try {
          await env.DB.prepare(
            "UPDATE table_rows SET archived = 1, sync_dirty = 0, updated_at = datetime('now') WHERE id = ?"
          ).bind(existingRowId).run();
          archived++;
        } catch (err) {
          console.error(`Sync pull archive error for page ${page.id}:`, err.message);
          errors++;
        }
      }
      continue;
    }

    const cells = {};
    for (const [propName, propVal] of Object.entries(page.properties || {})) {
      const colId = reverseMapping[propName];
      if (!colId) continue;
      cells[colId] = readNotionPropValue(propVal);
    }

    const existingRowId = notionIdToRowId[page.id];
    const oldCells = notionIdToOldCells[page.id] || {};

    try {
      if (existingRowId) {
        // Merge: preserve local-only fields, overwrite mapped fields from Notion
        const mergedCells = { ...oldCells, ...cells };
        await env.DB.prepare(
          "UPDATE table_rows SET cells = ?, metadata = ?, sync_dirty = 0, updated_at = datetime('now') WHERE id = ?"
        ).bind(
          JSON.stringify(mergedCells),
          JSON.stringify({ notion_page_id: page.id, last_synced_at: new Date().toISOString(), notion_last_edited: page.last_edited_time }),
          existingRowId
        ).run();
        updated++;

        // Fire automation triggers for sync-pulled changes
        checkAutomationTriggers(env, tableId, existingRowId, oldCells, mergedCells).catch((err) =>
          console.error("[AutoTrigger] Sync pull trigger error:", err.message)
        );
      } else {
        // Create new row
        const rowId = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO table_rows (id, table_id, cells, metadata, sync_dirty) VALUES (?, ?, ?, ?, 0)"
        ).bind(
          rowId, tableId, JSON.stringify(cells),
          JSON.stringify({ notion_page_id: page.id, last_synced_at: new Date().toISOString(), notion_last_edited: page.last_edited_time })
        ).run();
        created++;
      }
    } catch (err) {
      console.error(`Sync pull error for page ${page.id}:`, err.message);
      errors++;
    }
  }

  // Handle Notion deletions: on full resync, archive D1 rows whose Notion pages are gone
  if (fullResync) {
    for (const [notionId, rowId] of Object.entries(notionIdToRowId)) {
      if (!seenNotionIds.has(notionId)) {
        try {
          await env.DB.prepare(
            "UPDATE table_rows SET archived = 1, sync_dirty = 0, updated_at = datetime('now') WHERE id = ?"
          ).bind(rowId).run();
          archived++;
        } catch (err) {
          console.error(`Sync pull delete-detect error for row ${rowId}:`, err.message);
        }
      }
    }
  }

  await env.DB.prepare(
    "UPDATE sync_configs SET last_synced_at = datetime('now') WHERE table_id = ?"
  ).bind(tableId).run();

  // Invalidate data summary cache
  invalidateSummaryCache(env, tableId).catch(() => {});

  return jsonResponse({ pulled: { created, updated, archived, errors }, total: notionPages.length, incremental: !fullResync && !!lastSyncedAt });
}

/**
 * Get sync status for a table.
 */
async function handleSyncStatus(env, tableId, jsonResponse) {
  const config = await env.DB.prepare(
    "SELECT * FROM sync_configs WHERE table_id = ?"
  ).bind(tableId).first();

  if (!config) return jsonResponse({ configured: false });

  return jsonResponse({
    configured: true,
    id: config.id,
    table_id: config.table_id,
    notion_db_id: config.notion_db_id,
    direction: config.direction,
    field_mapping: safeParseJSON(config.field_mapping),
    last_synced_at: config.last_synced_at,
    enabled: !!config.enabled,
  });
}

/**
 * Remove sync configuration for a table.
 */
async function handleSyncDelete(env, tableId, jsonResponse) {
  await env.DB.prepare("DELETE FROM sync_configs WHERE table_id = ?").bind(tableId).run();
  return jsonResponse({ success: true, table_id: tableId });
}

/**
 * Disconnect a page from its external source (Notion, etc).
 * - Deletes sync_configs for the page
 * - Changes page_type from "linked_notion" to "database"
 * - Strips external connection metadata from config (databaseIds, etc)
 * - Clears notion_page_id from row metadata
 * - Data remains in D1 untouched
 * POST /pages/:id/disconnect
 */
async function handleDisconnect(env, pageId, jsonResponse) {
  // Verify page exists
  const page = await env.DB.prepare("SELECT * FROM page_configs WHERE id = ?").bind(pageId).first();
  if (!page) return jsonResponse({ _error: "Page not found" }, 404);

  const pageType = page.page_type;
  if (pageType !== "linked_notion") {
    return jsonResponse({ _error: `Cannot disconnect: page_type is "${pageType}", expected "linked_notion"` }, 400);
  }

  // Check sync config exists
  const syncConfig = await env.DB.prepare(
    "SELECT * FROM sync_configs WHERE table_id = ?"
  ).bind(pageId).first();

  // Delete sync config
  if (syncConfig) {
    await env.DB.prepare("DELETE FROM sync_configs WHERE table_id = ?").bind(pageId).run();
  }

  // Update page_type to "database" and strip Notion-specific config
  const config = safeParseJSON(page.config);
  const disconnectedFrom = {
    source: "notion",
    notion_db_id: syncConfig?.notion_db_id || config.databaseIds?.[0] || null,
    disconnected_at: new Date().toISOString(),
    last_synced_at: syncConfig?.last_synced_at || null,
  };
  delete config.databaseIds;
  config.disconnected_from = disconnectedFrom;

  await env.DB.prepare(
    "UPDATE page_configs SET page_type = 'database', config = ? WHERE id = ?"
  ).bind(JSON.stringify(config), pageId).run();

  // Clear all Notion metadata from rows and reset sync_dirty (sever row-level links)
  const { results: rows } = await env.DB.prepare(
    "SELECT id, metadata FROM table_rows WHERE table_id = ?"
  ).bind(pageId).all();

  let clearedRows = 0;
  for (const row of rows || []) {
    const meta = safeParseJSON(row.metadata);
    const hasNotion = meta.notion_page_id || meta.last_synced_at || meta.notion_last_edited;
    if (hasNotion) {
      delete meta.notion_page_id;
      delete meta.last_synced_at;
      delete meta.notion_last_edited;
      await env.DB.prepare(
        "UPDATE table_rows SET metadata = ?, sync_dirty = 0 WHERE id = ?"
      ).bind(JSON.stringify(meta), row.id).run();
      clearedRows++;
    }
  }

  return jsonResponse({
    ok: true,
    page_id: pageId,
    previous_type: pageType,
    new_type: "database",
    sync_config_deleted: !!syncConfig,
    rows_cleared: clearedRows,
    disconnected_from: disconnectedFrom,
  });
}

/**
 * Create a synced backup: creates a new Notion database from D1 schema,
 * pushes all D1 rows to it, and configures ongoing bidirectional sync.
 * Converts page_type from "database" to "linked_notion".
 * POST /pages/:id/sync-backup
 * Body: { parent_page_id } — Notion page ID to create the database under
 */
async function handleSyncBackup(env, pageId, body, notionKey, jsonResponse) {
  if (!notionKey) return jsonResponse({ _error: "Notion API key not configured" }, 400);

  const { parent_page_id } = body || {};
  if (!parent_page_id) return jsonResponse({ _error: "parent_page_id required (Notion page to create database under)" }, 400);

  // Verify page exists
  const page = await env.DB.prepare("SELECT * FROM page_configs WHERE id = ?").bind(pageId).first();
  if (!page) return jsonResponse({ _error: "Page not found" }, 404);

  // Check no active sync already exists
  const existingSync = await env.DB.prepare(
    "SELECT id FROM sync_configs WHERE table_id = ? AND enabled = 1"
  ).bind(pageId).first();
  if (existingSync) {
    return jsonResponse({ _error: "Page already has an active sync configuration. Disconnect first to create a new backup." }, 400);
  }

  // Get D1 schema
  const schemaRow = await env.DB.prepare("SELECT columns FROM table_schemas WHERE id = ?").bind(pageId).first();
  if (!schemaRow) return jsonResponse({ _error: "No schema found for this page" }, 404);
  const columns = safeParseJSON(schemaRow.columns);
  if (!columns.length) return jsonResponse({ _error: "Schema has no columns" }, 400);

  // Build Notion database properties from D1 columns
  const notionProperties = d1ColumnsToNotionProperties(columns);

  // Create the Notion database
  const pageTitle = page.name || "Wasabi Backup";
  const createRes = await fetch(`${NOTION_API}/databases`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${notionKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parent_page_id },
      title: [{ type: "text", text: { content: pageTitle } }],
      properties: notionProperties,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    return jsonResponse({ _error: `Failed to create Notion database: ${err.message || createRes.statusText}` }, 502);
  }

  const newDb = await createRes.json();
  const notionDbId = newDb.id;
  const notionDbUrl = newDb.url;

  // Configure sync
  const configBody = { notion_db_id: notionDbId, direction: "bidirectional" };
  const configRes = await handleSyncConfigure(env, pageId, configBody, notionKey, jsonResponse);
  const configData = await configRes.json().catch(() => ({}));
  if (configData._error) {
    return jsonResponse({ _error: `Sync config failed: ${configData._error}` }, 500);
  }

  // Push all D1 rows to the new Notion database
  const pushRes = await handleSyncPush(env, pageId, notionKey, jsonResponse);
  const pushData = await pushRes.json().catch(() => ({}));

  // Update page_type to linked_notion and store databaseIds in config
  const config = safeParseJSON(page.config);
  config.databaseIds = [notionDbId];
  if (config.disconnected_from) {
    config.previous_connections = config.previous_connections || [];
    config.previous_connections.push(config.disconnected_from);
    delete config.disconnected_from;
  }

  await env.DB.prepare(
    "UPDATE page_configs SET page_type = 'linked_notion', config = ? WHERE id = ?"
  ).bind(JSON.stringify(config), pageId).run();

  return jsonResponse({
    ok: true,
    page_id: pageId,
    notion_db_id: notionDbId,
    notion_db_url: notionDbUrl,
    new_type: "linked_notion",
    push_results: pushData.pushed || {},
    total_rows: pushData.total || 0,
  });
}

/**
 * Convert D1 column definitions to Notion database property definitions.
 * Reverse of notionPropsToD1Columns().
 */
function d1ColumnsToNotionProperties(columns) {
  const properties = {};
  const typeMap = {
    title: "title",
    text: "rich_text",
    number: "number",
    select: "select",
    multi_select: "multi_select",
    status: "status",
    date: "date",
    checkbox: "checkbox",
    url: "url",
    email: "email",
    phone: "phone_number",
  };

  for (const col of columns) {
    const notionType = typeMap[col.type];
    if (!notionType) continue; // Skip types that can't be created in Notion (people, files, relation, etc.)

    if (notionType === "title") {
      // Title property is special in Notion
      properties[col.name] = { title: {} };
    } else if (notionType === "rich_text") {
      properties[col.name] = { rich_text: {} };
    } else if (notionType === "number") {
      properties[col.name] = { number: {} };
    } else if (notionType === "select") {
      const opts = (col.options || []).map((o) => ({
        name: o.label || o.name || String(o),
        color: o.color || "default",
      }));
      properties[col.name] = { select: { options: opts } };
    } else if (notionType === "multi_select") {
      const opts = (col.options || []).map((o) => ({
        name: o.label || o.name || String(o),
        color: o.color || "default",
      }));
      properties[col.name] = { multi_select: { options: opts } };
    } else if (notionType === "status") {
      // Notion API doesn't allow setting status options on create — just define the property
      properties[col.name] = { status: {} };
    } else if (notionType === "date") {
      properties[col.name] = { date: {} };
    } else if (notionType === "checkbox") {
      properties[col.name] = { checkbox: {} };
    } else if (notionType === "url") {
      properties[col.name] = { url: {} };
    } else if (notionType === "email") {
      properties[col.name] = { email: {} };
    } else if (notionType === "phone_number") {
      properties[col.name] = { phone_number: {} };
    }
  }

  return properties;
}

/**
 * Bootstrap sync for all linked Notion databases.
 * Finds page_configs with notion databaseIds that have no sync_config,
 * creates sync configs, generates schemas, and runs full pulls.
 * POST /sync/bootstrap
 */
async function handleSyncBootstrap(env, notionKey, jsonResponse) {
  if (!notionKey) return jsonResponse({ _error: "Notion API key not configured" }, 400);

  try {
    // Get all page configs
    const pages = await env.DB.prepare("SELECT * FROM page_configs").all();
    const allPages = pages.results || [];

    // Get existing sync configs to skip already-configured tables
    const syncs = await env.DB.prepare("SELECT table_id FROM sync_configs").all();
    const syncedTableIds = new Set((syncs.results || []).map((s) => s.table_id));

    const results = [];

    for (const page of allPages) {
      // Find pages with linked Notion database IDs
      let dbIds = [];
      try {
        const config = JSON.parse(page.config || "{}");
        const raw = config.databaseIds || config.notion_database_id;
        if (Array.isArray(raw)) dbIds = raw;
        else if (typeof raw === "string" && raw) dbIds = [raw];
      } catch {}

      // Also check top-level notion_database_id
      if (page.notion_database_id) dbIds.push(page.notion_database_id);

      if (!dbIds.length) continue;
      if (syncedTableIds.has(page.id)) {
        results.push({ page_id: page.id, status: "already_synced" });
        continue;
      }

      // Use the first database ID for sync
      const notionDbId = dbIds[0];

      try {
        // Configure sync (this auto-creates schema if missing)
        const configBody = { notion_db_id: notionDbId, direction: "bidirectional" };
        // Call handleSyncConfigure internally
        const configRes = await handleSyncConfigure(env, page.id, configBody, notionKey, jsonResponse);
        const configData = await configRes.json().catch(() => ({}));

        if (configData._error) {
          results.push({ page_id: page.id, notion_db: notionDbId, status: "config_error", error: configData._error });
          continue;
        }

        // Run full pull (fix: correct argument order)
        const pullRes = await handleSyncPull(env, page.id, notionKey, true, jsonResponse);
        const pullData = await pullRes.json().catch(() => ({}));

        if (pullData._error) {
          results.push({ page_id: page.id, notion_db: notionDbId, status: "pull_error", error: pullData._error });
          continue;
        }

        // Keep page_type as "linked_notion" — the Notion connection is still active.
        // resolveSourceType now returns "d1" for linked_notion pages.

        results.push({
          page_id: page.id,
          notion_db: notionDbId,
          status: "synced",
          rows_created: pullData.created || 0,
          rows_updated: pullData.updated || 0,
        });
      } catch (err) {
        results.push({ page_id: page.id, notion_db: notionDbId, status: "error", error: err.message });
      }
    }

    return jsonResponse({ bootstrapped: results.filter((r) => r.status === "synced").length, results });
  } catch (err) {
    return jsonResponse({ _error: `Bootstrap failed: ${err.message}` }, 500);
  }
}

/**
 * HTTP handler: flush dirty rows to Notion.
 * POST /sync/flush
 */
async function handleSyncFlush(env, notionKey, jsonResponse) {
  if (!notionKey) return jsonResponse({ _error: "Notion API key not configured" }, 400);
  const result = await syncFlushInternal(env, notionKey);
  return jsonResponse(result);
}

/**
 * Flush a single dirty row to Notion.
 */
async function flushSingleRow(env, row, configMap, schemaMap, notionKey) {
  const config = configMap[row.table_id];
  if (!config) {
    // No sync config — clear dirty flag (nothing to sync to)
    await env.DB.prepare("UPDATE table_rows SET sync_dirty = 0 WHERE id = ?").bind(row.id).run();
    return "skipped";
  }

  const fieldMapping = safeParseJSON(config.field_mapping);
  const notionDbId = config.notion_db_id;
  const cells = safeParseJSON(row.cells);
  const metadata = safeParseJSON(row.metadata);
  const notionPageId = metadata.notion_page_id;

  // Build Notion properties from field mapping
  const properties = {};
  for (const [colId, mapping] of Object.entries(fieldMapping)) {
    const value = cells[colId];
    if (value === undefined || value === null) continue;
    properties[mapping.notion_property] = buildNotionPropValue(mapping.notion_type, value);
  }

  try {
    if (notionPageId) {
      // Update existing Notion page
      const res = await fetch(`${NOTION_API}/pages/${notionPageId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${notionKey}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ properties }),
      });
      if (!res.ok) throw new Error(`Notion update failed: ${res.status}`);

      // Clear dirty flag
      await env.DB.prepare(
        "UPDATE table_rows SET sync_dirty = 0, sync_retry_count = 0 WHERE id = ?"
      ).bind(row.id).run();
      return "updated";
    } else {
      // Create new Notion page
      const res = await fetch(`${NOTION_API}/pages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${notionKey}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ parent: { database_id: notionDbId }, properties }),
      });
      const page = await res.json();
      if (!page.id) throw new Error("Notion create returned no ID");

      // Store Notion page ID and clear dirty flag
      metadata.notion_page_id = page.id;
      metadata.last_synced_at = new Date().toISOString();
      await env.DB.prepare(
        "UPDATE table_rows SET metadata = ?, sync_dirty = 0, sync_retry_count = 0 WHERE id = ?"
      ).bind(JSON.stringify(metadata), row.id).run();
      return "created";
    }
  } catch (err) {
    console.error(`[SyncFlush] Row ${row.id} failed:`, err.message);
    // Increment retry count
    await env.DB.prepare(
      "UPDATE table_rows SET sync_retry_count = sync_retry_count + 1 WHERE id = ?"
    ).bind(row.id).run();
    throw err;
  }
}

/**
 * Archive a Notion page (called when a D1 row is deleted).
 */
async function archiveNotionPage(env, notionPageId) {
  const notionKey = await getNotionKeyFromDB(env);
  if (!notionKey) return;

  await fetch(`${NOTION_API}/pages/${notionPageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${notionKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ archived: true }),
  });
}

/**
 * Get Notion key from DB connections table (for non-request contexts).
 */
async function getNotionKeyFromDB(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'notion'").first();
    if (!row?.value) return null;
    const notionKey = await decryptSecret(row.value, env);
    // Lazy migration: if value was plaintext, re-encrypt it now
    if (notionKey === row.value && !row.value.startsWith('enc:v1:')) {
      await env.DB.prepare(
        "UPDATE connections SET value = ?, updated_at = datetime('now') WHERE key = 'notion'"
      ).bind(await encryptSecret(notionKey, env)).run();
    }
    return notionKey;
  } catch { return null; }
}

/**
 * Invalidate data summary cache for all pages that use a given table.
 */
async function invalidateSummaryCache(env, tableId) {
  // Find page configs that reference this table
  const { results: pages } = await env.DB.prepare(
    "SELECT id, config FROM page_configs"
  ).all();

  for (const page of (pages || [])) {
    const config = safeParseJSON(page.config);
    // Check if any data source in this page references the table
    const sources = config.dataSources || config.data_sources || [];
    const usesTable = sources.some((s) => s.tableId === tableId || s.table_id === tableId);
    if (usesTable) {
      await env.DB.prepare(
        "DELETE FROM data_summary_cache WHERE page_id = ?"
      ).bind(page.id).run();
    }
  }
}

/**
 * Convert a JS value into a Notion property value object for push.
 */
function buildNotionPropValue(type, value) {
  switch (type) {
    case "title":
      return { title: [{ text: { content: String(value) } }] };
    case "rich_text":
      return { rich_text: [{ text: { content: String(value) } }] };
    case "number":
      return { number: typeof value === "number" ? value : parseFloat(value) || 0 };
    case "select":
      return { select: { name: String(value) } };
    case "multi_select": {
      const items = Array.isArray(value) ? value : String(value).split(",").map((s) => s.trim());
      return { multi_select: items.map((name) => ({ name })) };
    }
    case "status":
      return { status: { name: String(value) } };
    case "date":
      return { date: { start: String(value) } };
    case "checkbox":
      return { checkbox: !!value };
    case "url":
      return { url: String(value) || null };
    case "email":
      return { email: String(value) || null };
    case "phone_number":
      return { phone_number: String(value) || null };
    default:
      return { rich_text: [{ text: { content: String(value) } }] };
  }
}

/**
 * Read a Notion property value into a plain JS value for pull.
 */
function readNotionPropValue(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case "title":
      return (prop.title || []).map((t) => t.plain_text).join("");
    case "rich_text":
      return (prop.rich_text || []).map((t) => t.plain_text).join("");
    case "number":
      return prop.number;
    case "select":
      return prop.select?.name || null;
    case "multi_select":
      return (prop.multi_select || []).map((s) => s.name);
    case "status":
      return prop.status?.name || null;
    case "date":
      return prop.date?.start || null;
    case "checkbox":
      return !!prop.checkbox;
    case "url":
      return prop.url || null;
    case "email":
      return prop.email || null;
    case "phone_number":
      return prop.phone_number || null;
    case "created_time":
      return prop.created_time || null;
    case "last_edited_time":
      return prop.last_edited_time || null;
    default:
      return null;
  }
}

export {
  runSyncFlushTick,
  handleSyncConfigure,
  handleSyncPush,
  handleSyncPull,
  handleSyncStatus,
  handleSyncDelete,
  handleDisconnect,
  handleSyncBackup,
  handleSyncBootstrap,
  handleSyncFlush,
  getNotionKeyFromDB,
  invalidateSummaryCache,
};

export { archiveNotionPage };
