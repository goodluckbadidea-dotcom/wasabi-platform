// ─── Wasabi Tool Executor ───
// Routes tool calls to the appropriate data source functions.
// Supports D1 tables, D1 sheets, linked Notion, linked Monday, and linked Google Sheets.

import * as client from "../notion/client.js";
import { queryAll } from "../notion/pagination.js";
import { detectSchema, autoDetectViews, schemaToText, suggestViewMappings } from "../notion/schema.js";
import { writeKB, searchKB, kbResultsToText } from "./memory.js";
import { extractProperties, getPageTitle } from "../notion/properties.js";
import * as api from "../lib/api.js";
import { savePageConfig } from "../config/pageConfig.js";
import { fetchSheetData } from "../sheets/sheetClient.js";
import { fetchBoardItems, fetchBoardColumns } from "../monday/client.js";
import { mondayColumnsToSchema, mondayItemToPage } from "../monday/schema.js";

// ─── Source Resolution Helpers ───

/** Fetch and cache page config for an ID. Returns full config or null. */
async function getFullPageConfig(id) {
  try {
    return await api.getPageConfig(id);
  } catch {
    return null;
  }
}

/** Get the page_type for an ID, or null if not found. */
async function getPageType(id) {
  const cfg = await getFullPageConfig(id);
  return cfg?.page_type || null;
}

/** Check if a database_id refers to a D1 standalone table or sheet (vs Notion DB). */
async function isD1Table(id) {
  const pt = await getPageType(id);
  return pt === "database" || pt === "sheet";
}

/**
 * Fetch rows from a linked Google Sheet page.
 * Returns array of { [columnName]: value } objects.
 */
async function fetchLinkedSheetRows(pageConfig, workerUrl) {
  // Find sheetUrl from views config
  const sheetView = pageConfig.views?.find((v) => v.type === "linked_sheet");
  const sheetUrl = sheetView?.config?.sheetUrl || pageConfig.sheetUrl;
  if (!sheetUrl || !workerUrl) return [];

  const data = await fetchSheetData(workerUrl, sheetUrl);
  if (!data?.columns?.length || !data?.rows?.length) return [];

  // Convert 2D array to row objects
  return data.rows.map((row, idx) => {
    const obj = { _row: idx + 2 };
    data.columns.forEach((col, i) => {
      if (row[i] !== undefined && row[i] !== null && row[i] !== "") {
        obj[col] = row[i];
      }
    });
    return obj;
  });
}

/**
 * Fetch rows from a linked Monday.com board.
 * Returns array of flat { [columnTitle]: value } objects.
 */
async function fetchLinkedMondayRows(pageConfig, mondayKey) {
  const boardId = pageConfig.mondayBoardId;
  if (!boardId || !mondayKey) return [];

  const [columns, items] = await Promise.all([
    fetchBoardColumns(mondayKey, boardId),
    fetchBoardItems(mondayKey, boardId),
  ]);

  // Convert Monday items to flat row objects
  return items.map((item) => {
    const row = { _id: item.id, Name: item.name };
    if (item.group?.title) row._group = item.group.title;
    for (const cv of (item.column_values || [])) {
      const col = columns.find((c) => c.id === cv.id);
      const label = col?.title || cv.id;
      if (cv.text) row[label] = cv.text;
    }
    return row;
  });
}

/** Convert sheet grid cells { "A1": {v:...}, "B2": {v:...} } into row objects with headers. */
function sheetCellsToRows(cells, colCount = 26) {
  if (!cells || typeof cells !== "object") return [];

  // Build column labels (A, B, C, ...)
  const colLabels = [];
  for (let i = 0; i < colCount; i++) {
    let label = "";
    let n = i + 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      label = String.fromCharCode(65 + rem) + label;
      n = Math.floor((n - 1) / 26);
    }
    colLabels.push(label);
  }

  // Find the max row number present in cells
  let maxRow = 0;
  for (const key of Object.keys(cells)) {
    const rowNum = parseInt(key.replace(/^[A-Z]+/, ""), 10);
    if (rowNum > maxRow) maxRow = rowNum;
  }
  if (maxRow === 0) return [];

  // Read row 1 as headers
  const headers = {};
  for (const col of colLabels) {
    const cell = cells[`${col}1`];
    const val = cell && typeof cell === "object" ? cell.v : cell;
    if (val) headers[col] = String(val).trim();
  }

  // Build rows (starting from row 2)
  const rows = [];
  for (let r = 2; r <= maxRow; r++) {
    const row = { _row: r };
    let hasData = false;
    for (const col of colLabels) {
      const cell = cells[`${col}${r}`];
      const val = cell && typeof cell === "object" ? cell.v : cell;
      const header = headers[col] || col;
      if (val !== undefined && val !== null && val !== "") {
        row[header] = val;
        hasData = true;
      }
    }
    if (hasData) rows.push(row);
  }
  return rows;
}

/** Convert Notion-format properties to flat D1 cells. */
function notionPropsToD1Cells(props) {
  const cells = {};
  for (const [key, val] of Object.entries(props)) {
    if (val?.title)
      cells[key] = val.title.map((t) => t.text?.content || t.plain_text || "").join("");
    else if (val?.rich_text)
      cells[key] = val.rich_text.map((t) => t.text?.content || t.plain_text || "").join("");
    else if (val?.number != null) cells[key] = val.number;
    else if (val?.select) cells[key] = val.select.name || val.select;
    else if (val?.date) cells[key] = val.date.start || "";
    else if (val?.checkbox != null) cells[key] = val.checkbox;
    else if (val?.url) cells[key] = val.url;
    else if (val?.email) cells[key] = val.email;
    else if (typeof val === "string") cells[key] = val;
    else cells[key] = val;
  }
  return cells;
}

/**
 * Create a tool executor bound to a specific user's credentials and platform config.
 *
 * @param {object} opts
 * @param {string} opts.workerUrl
 * @param {string} opts.notionKey
 * @param {string} opts.mondayKey - Monday.com API key (optional)
 * @param {string} opts.parentPageId - Root Wasabi page in user's Notion
 * @param {string} opts.kbDbId - Knowledge Base database ID
 * @param {string} opts.notifDbId - Notifications database ID
 * @param {string} opts.configDbId - Page Config database ID
 * @param {string} opts.rulesDbId - Automation Rules database ID
 * @param {Function} opts.onPageCreated - Callback when a new page config is created
 * @returns {Function} executeTool(toolName, toolInput) => string
 */
export function createToolExecutor({
  workerUrl,
  notionKey,
  mondayKey,
  parentPageId,
  kbDbId,
  notifDbId,
  configDbId,
  rulesDbId,
  onPageCreated,
  claudeKey,
}) {
  return async function executeTool(toolName, toolInput) {
    switch (toolName) {
      // ─── Database Operations ───
      case "query_database": {
        const qCfg = await getFullPageConfig(toolInput.database_id);
        const pageType = qCfg?.page_type || null;

        // D1 sheet path — grid cells converted to rows
        if (pageType === "sheet") {
          try {
            const sheet = await api.getSheet(toolInput.database_id);
            const rows = sheetCellsToRows(sheet.cells, sheet.col_count || 26);
            return JSON.stringify({
              count: rows.length,
              results: rows.slice(0, 200),
              truncated: rows.length > 200,
              storage: "sheet",
            });
          } catch (err) {
            return JSON.stringify({ error: `Failed to read sheet: ${err.message}`, storage: "sheet" });
          }
        }

        // D1 standalone table path
        if (pageType === "database") {
          const queryBody = {};
          if (toolInput.filter) queryBody.filters = toolInput.filter;
          if (toolInput.sorts) queryBody.sorts = toolInput.sorts;
          queryBody.limit = 200;

          let rows;
          try {
            const res = await api.queryTable(toolInput.database_id, queryBody);
            rows = res?.rows || [];
          } catch {
            const res = await api.listRows(toolInput.database_id, { limit: 200 });
            rows = res?.rows || [];
          }
          return JSON.stringify({
            count: rows.length,
            results: rows.slice(0, 200),
            truncated: rows.length > 200,
            storage: "d1",
          });
        }

        // Linked Google Sheet — read-only via worker proxy
        if (pageType === "linked_sheet") {
          try {
            const rows = await fetchLinkedSheetRows(qCfg, workerUrl);
            return JSON.stringify({
              count: rows.length,
              results: rows.slice(0, 200),
              truncated: rows.length > 200,
              storage: "linked_sheet",
              readOnly: true,
            });
          } catch (err) {
            return JSON.stringify({ error: `Failed to read linked sheet: ${err.message}`, storage: "linked_sheet" });
          }
        }

        // Linked Monday.com board — read/write via GraphQL proxy
        if (pageType === "linked_monday") {
          try {
            const rows = await fetchLinkedMondayRows(qCfg, mondayKey);
            return JSON.stringify({
              count: rows.length,
              results: rows.slice(0, 200),
              truncated: rows.length > 200,
              storage: "linked_monday",
            });
          } catch (err) {
            return JSON.stringify({ error: `Failed to read Monday board: ${err.message}`, storage: "linked_monday" });
          }
        }

        // Linked Notion — use databaseIds from page config
        if (pageType === "linked_notion" && qCfg?.databaseIds?.length) {
          const allData = [];
          for (const dbId of qCfg.databaseIds) {
            try {
              const results = await queryAll(workerUrl, notionKey, dbId, toolInput.filter, toolInput.sorts);
              const mapped = results.map((page) => ({ id: page.id, ...extractProperties(page), _databaseId: dbId }));
              allData.push(...mapped);
            } catch (err) {
              allData.push({ _error: `Failed to query ${dbId}: ${err.message}` });
            }
          }
          return JSON.stringify({
            count: allData.length,
            results: allData.slice(0, 100),
            truncated: allData.length > 100,
            storage: "linked_notion",
          });
        }

        // Direct Notion database path (fallback — raw Notion DB ID)
        const results = await queryAll(
          workerUrl, notionKey,
          toolInput.database_id,
          toolInput.filter,
          toolInput.sorts
        );
        const summary = results.map((page) => {
          const props = extractProperties(page);
          return { id: page.id, ...props };
        });
        return JSON.stringify({
          count: summary.length,
          results: summary.slice(0, 50),
          truncated: summary.length > 50,
        });
      }

      case "get_page": {
        const page = await client.getPage(workerUrl, notionKey, toolInput.page_id);
        const props = extractProperties(page);
        return JSON.stringify({ id: page.id, ...props });
      }

      case "create_page": {
        // D1 standalone table — create a row
        if (await isD1Table(toolInput.database_id)) {
          const cells = notionPropsToD1Cells(toolInput.properties);
          const res = await api.createRows(toolInput.database_id, [cells]);
          const newId = res?.ids?.[0] || res?.id || "created";
          return JSON.stringify({ id: newId, success: true, storage: "d1" });
        }
        // Notion path
        const page = await client.createPage(
          workerUrl, notionKey,
          toolInput.database_id,
          toolInput.properties
        );
        return JSON.stringify({ id: page.id, url: page.url, success: true });
      }

      case "update_page": {
        // D1 row update: page_id format is "tableId:rowId" or we check if it's a D1 row
        const pageId = toolInput.page_id;
        if (pageId && pageId.includes(":")) {
          // Explicit D1 format — "tableId:rowId"
          const [tableId, rowId] = pageId.split(":");
          const cells = notionPropsToD1Cells(toolInput.properties);
          await api.updateRow(tableId, rowId, { cells });
          return JSON.stringify({ success: true, page_id: pageId, storage: "d1" });
        }

        // Check if it looks like a D1 row ID (and a database_id hint is provided)
        if (toolInput.database_id && await isD1Table(toolInput.database_id)) {
          const cells = notionPropsToD1Cells(toolInput.properties);
          await api.updateRow(toolInput.database_id, pageId, { cells });
          return JSON.stringify({ success: true, page_id: pageId, storage: "d1" });
        }

        // Notion path
        await client.updatePage(
          workerUrl, notionKey,
          pageId,
          toolInput.properties
        );
        return JSON.stringify({ success: true, page_id: pageId });
      }

      // ─── Cross-Database Query ───
      case "cross_database_query": {
        const queries = toolInput.queries || [];
        const allResults = {};
        for (const q of queries.slice(0, 5)) {
          const label = q.label || q.database_id;
          try {
            const xCfg = await getFullPageConfig(q.database_id);
            const xType = xCfg?.page_type || null;

            if (xType === "sheet") {
              const sheet = await api.getSheet(q.database_id);
              const rows = sheetCellsToRows(sheet.cells, sheet.col_count || 26);
              allResults[label] = { count: rows.length, results: rows.slice(0, 100), truncated: rows.length > 100, storage: "sheet" };
            } else if (xType === "database") {
              const queryBody = { limit: 100 };
              if (q.filter) queryBody.filters = q.filter;
              if (q.sorts) queryBody.sorts = q.sorts;
              let rows;
              try { rows = (await api.queryTable(q.database_id, queryBody))?.rows || []; }
              catch { rows = (await api.listRows(q.database_id, { limit: 100 }))?.rows || []; }
              allResults[label] = { count: rows.length, results: rows.slice(0, 100), truncated: rows.length > 100, storage: "d1" };
            } else if (xType === "linked_sheet") {
              const rows = await fetchLinkedSheetRows(xCfg, workerUrl);
              allResults[label] = { count: rows.length, results: rows.slice(0, 100), truncated: rows.length > 100, storage: "linked_sheet", readOnly: true };
            } else if (xType === "linked_monday") {
              const rows = await fetchLinkedMondayRows(xCfg, mondayKey);
              allResults[label] = { count: rows.length, results: rows.slice(0, 100), truncated: rows.length > 100, storage: "linked_monday" };
            } else if (xType === "linked_notion" && xCfg?.databaseIds?.length) {
              const allData = [];
              for (const dbId of xCfg.databaseIds) {
                const res = await queryAll(workerUrl, notionKey, dbId, q.filter, q.sorts);
                allData.push(...res.map((p) => ({ id: p.id, ...extractProperties(p) })));
              }
              allResults[label] = { count: allData.length, results: allData.slice(0, 100), truncated: allData.length > 100, storage: "linked_notion" };
            } else {
              // Direct Notion DB ID
              const res = await queryAll(workerUrl, notionKey, q.database_id, q.filter, q.sorts);
              const mapped = res.map((p) => ({ id: p.id, ...extractProperties(p) }));
              allResults[label] = { count: mapped.length, results: mapped.slice(0, 30), truncated: mapped.length > 30 };
            }
          } catch (err) {
            allResults[label] = { error: err.message };
          }
        }
        return JSON.stringify(allResults);
      }

      // ─── Database Schema Update ───
      case "update_database": {
        const payload = {};

        // Title update
        if (toolInput.title) {
          payload.title = [{ type: "text", text: { content: toolInput.title } }];
        }

        // Build properties update
        const propUpdates = {};

        // Add new properties
        if (toolInput.add_properties) {
          for (const field of toolInput.add_properties) {
            const propDef = {};
            switch (field.type) {
              case "rich_text": propDef.rich_text = {}; break;
              case "number": propDef.number = { format: field.format || "number" }; break;
              case "select":
                propDef.select = { options: (field.options || []).map((o) => typeof o === "string" ? { name: o } : o) };
                break;
              case "status":
                propDef.status = { options: (field.options || []).map((o) => typeof o === "string" ? { name: o } : o) };
                break;
              case "multi_select":
                propDef.multi_select = { options: (field.options || []).map((o) => typeof o === "string" ? { name: o } : o) };
                break;
              case "date": propDef.date = {}; break;
              case "checkbox": propDef.checkbox = {}; break;
              case "url": propDef.url = {}; break;
              case "email": propDef.email = {}; break;
              case "phone_number": propDef.phone_number = {}; break;
              default: propDef.rich_text = {};
            }
            propUpdates[field.name] = propDef;
          }
        }

        // Rename properties
        if (toolInput.rename_properties) {
          for (const [oldName, newName] of Object.entries(toolInput.rename_properties)) {
            propUpdates[oldName] = { name: newName };
          }
        }

        // Remove properties (set to null in Notion API)
        if (toolInput.remove_properties) {
          for (const name of toolInput.remove_properties) {
            propUpdates[name] = null;
          }
        }

        if (Object.keys(propUpdates).length > 0) {
          payload.properties = propUpdates;
        }

        const result = await client.updateDatabase(workerUrl, notionKey, toolInput.database_id, payload);
        return JSON.stringify({ success: true, database_id: toolInput.database_id, title: toolInput.title || result.title?.[0]?.plain_text });
      }

      // ─── Database Creation ───
      case "create_database": {
        // Ensure root page is active (auto-unarchive if needed)
        if (parentPageId) {
          await client.ensurePageActive(workerUrl, notionKey, parentPageId);
        }
        const db = await client.createDatabase(
          workerUrl, notionKey,
          parentPageId,
          toolInput.title,
          toolInput.schema
        );
        return JSON.stringify({ database_id: db.id, title: toolInput.title, success: true });
      }

      // ─── Schema Detection ───
      case "detect_schema": {
        const sCfg = await getFullPageConfig(toolInput.database_id);
        const schemaPageType = sCfg?.page_type || null;

        // D1 sheet — read headers from row 1
        if (schemaPageType === "sheet") {
          try {
            const sheet = await api.getSheet(toolInput.database_id);
            const colLabels = [];
            for (let i = 0; i < (sheet.col_count || 26); i++) {
              let label = "";
              let n = i + 1;
              while (n > 0) { const rem = (n - 1) % 26; label = String.fromCharCode(65 + rem) + label; n = Math.floor((n - 1) / 26); }
              colLabels.push(label);
            }
            const columns = [];
            for (const col of colLabels) {
              const cell = sheet.cells?.[`${col}1`];
              const val = cell && typeof cell === "object" ? cell.v : cell;
              if (val) columns.push({ name: String(val).trim(), column: col, type: "text" });
            }
            const text = columns.map((c) => `- ${c.name} (column ${c.column}, text)`).join("\n");
            return JSON.stringify({ schema: text, fieldCount: columns.length, raw: { columns, storage: "sheet" }, suggestedViews: [] });
          } catch (err) {
            return JSON.stringify({ error: `Failed to detect sheet schema: ${err.message}` });
          }
        }

        // D1 standalone table
        if (schemaPageType === "database") {
          try {
            const d1Schema = await api.getTableSchema(toolInput.database_id);
            const columns = d1Schema?.columns || [];
            const text = columns.map((c) =>
              `- ${c.name} (${c.type}${c.options?.length ? `: ${c.options.join(", ")}` : ""})`
            ).join("\n");
            return JSON.stringify({ schema: text, fieldCount: columns.length, raw: { columns, storage: "d1" }, suggestedViews: [] });
          } catch (err) {
            return JSON.stringify({ error: `Failed to detect D1 schema: ${err.message}` });
          }
        }

        // Linked Google Sheet — detect columns from fetched data
        if (schemaPageType === "linked_sheet") {
          try {
            const rows = await fetchLinkedSheetRows(sCfg, workerUrl);
            const colNames = rows.length > 0 ? Object.keys(rows[0]).filter((k) => k !== "_row") : [];
            const text = colNames.map((c) => `- ${c} (text)`).join("\n");
            return JSON.stringify({ schema: text, fieldCount: colNames.length, raw: { columns: colNames, storage: "linked_sheet" }, suggestedViews: [] });
          } catch (err) {
            return JSON.stringify({ error: `Failed to detect linked sheet schema: ${err.message}` });
          }
        }

        // Linked Monday — detect columns from board definition
        if (schemaPageType === "linked_monday") {
          try {
            const columns = await fetchBoardColumns(mondayKey, sCfg.mondayBoardId);
            const text = columns.map((c) => `- ${c.title} (${c.type})`).join("\n");
            return JSON.stringify({ schema: text, fieldCount: columns.length, raw: { columns, storage: "linked_monday" }, suggestedViews: [] });
          } catch (err) {
            return JSON.stringify({ error: `Failed to detect Monday schema: ${err.message}` });
          }
        }

        // Linked Notion — detect schema from first databaseId
        if (schemaPageType === "linked_notion" && sCfg?.databaseIds?.length) {
          const schema = await detectSchema(workerUrl, notionKey, sCfg.databaseIds[0]);
          const views = autoDetectViews(schema);
          const text = schemaToText(schema);
          return JSON.stringify({ schema: text, suggestedViews: views, fieldCount: schema.allFields.length, raw: schema });
        }

        // Direct Notion DB ID fallback
        const schema = await detectSchema(workerUrl, notionKey, toolInput.database_id);
        const views = autoDetectViews(schema);
        const text = schemaToText(schema);
        return JSON.stringify({ schema: text, suggestedViews: views, fieldCount: schema.allFields.length, raw: schema });
      }

      // ─── Page Config Creation ───
      case "create_page_config": {
        const { name, icon, databaseIds, views, agentPrompt } = toolInput;
        const pageConfig = {
          name,
          icon: icon || "page",
          parentId: toolInput.parent_id || null,
          databaseIds: databaseIds || [],
          agentConfig: {
            model: "claude-haiku-4-5-20251001",
            prompt: agentPrompt || `You are a helpful assistant for the "${name}" page.`,
            tools: ["query_database", "get_page", "create_page", "update_page", "post_notification", "escalate_to_wasabi"],
            databases: databaseIds || [],
          },
          views: (views || []).map((v) => ({
            type: v.type,
            position: v.position || "main",
            config: v.config || {},
          })),
          createdAt: new Date().toISOString(),
        };

        // Save to D1 (primary path — works without Notion)
        const pageId = await savePageConfig(pageConfig);
        pageConfig.id = pageId;

        // Notify the UI to add this page
        if (onPageCreated) onPageCreated(pageConfig);

        return JSON.stringify({ success: true, pageId, name });
      }

      // ─── Knowledge Base ───
      case "update_knowledge_base": {
        await writeKB(workerUrl, notionKey, kbDbId, {
          key: toolInput.key,
          category: toolInput.category,
          content: toolInput.content,
        });
        return JSON.stringify({ success: true, key: toolInput.key });
      }

      case "search_knowledge_base": {
        const results = await searchKB(workerUrl, notionKey, kbDbId, {
          query: toolInput.query,
          category: toolInput.category,
        });
        return kbResultsToText(results);
      }

      // ─── Notifications ───
      case "post_notification": {
        // D1 path (preferred) — no notifDbId needed
        if (!notifDbId || notifDbId === "d1") {
          await api.createNotification({
            message: toolInput.message,
            type: toolInput.type || "notification",
            source: toolInput.source || "wasabi",
          });
        } else {
          // Legacy Notion path
          await client.postNotification(workerUrl, notionKey, notifDbId, {
            message: toolInput.message,
            type: toolInput.type || "notification",
            source: toolInput.source || "wasabi",
          });
        }
        return JSON.stringify({ success: true });
      }

      // ─── Automation Rule Creation ───
      case "create_automation_rule": {
        // D1 path (preferred)
        const ruleResult = await api.createRule({
          name: toolInput.name || "Untitled Rule",
          description: toolInput.description || "",
          trigger_type: toolInput.trigger,
          trigger_config: toolInput.trigger_config || {},
          action_config: {
            instruction: toolInput.instruction || "",
            database_id: toolInput.database_id || "",
            owner_page: toolInput.owner_page || "",
          },
          enabled: true,
          scope_table_id: toolInput.database_id || null,
        });
        return JSON.stringify({ success: true, rule_id: ruleResult.id, name: toolInput.name });
      }

      // ─── File Processing ───
      case "process_uploaded_files": {
        const { files: inputFiles, action, target_database_id } = toolInput;
        if (!inputFiles?.length) {
          return JSON.stringify({ error: "No files provided." });
        }

        if (action === "analyze") {
          // Parse and summarize each file
          const summaries = inputFiles.map((f) => {
            const lines = (f.text || "").split("\n");
            const isCSV = f.type === "csv" || f.type === "tsv" || f.name?.endsWith(".csv") || f.name?.endsWith(".tsv");
            let summary = { name: f.name, type: f.type, lineCount: lines.length };

            if (isCSV && lines.length > 0) {
              // Parse CSV headers and sample data
              const headers = lines[0].split(/[,\t]/);
              summary.headers = headers.map((h) => h.trim().replace(/^"|"$/g, ""));
              summary.rowCount = lines.length - 1;
              summary.sampleRows = lines.slice(1, 4).map((row) => row.substring(0, 200));
            } else if (f.type === "json") {
              try {
                const parsed = JSON.parse(f.text);
                if (Array.isArray(parsed)) {
                  summary.recordCount = parsed.length;
                  summary.sampleKeys = parsed.length > 0 ? Object.keys(parsed[0]) : [];
                } else {
                  summary.keys = Object.keys(parsed);
                }
              } catch {
                summary.parseError = true;
              }
            } else {
              summary.preview = (f.text || "").substring(0, 500);
            }

            return summary;
          });

          return JSON.stringify({ action: "analyze", files: summaries });
        }

        if (action === "create_records" && target_database_id) {
          // Parse CSV/JSON files into records and attempt bulk D1 insert
          const created = [];
          const errors = [];
          let isD1 = false;
          try {
            const cfg = await api.getPageConfig(target_database_id);
            isD1 = cfg && cfg.page_type === "database";
          } catch { /* not D1 */ }

          for (const f of inputFiles) {
            try {
              const isCSV = f.type === "csv" || f.type === "tsv" || f.name?.endsWith(".csv") || f.name?.endsWith(".tsv");
              let records = [];

              if (isCSV) {
                const lines = (f.text || "").split("\n").filter((l) => l.trim());
                if (lines.length < 2) continue;
                const sep = f.type === "tsv" || f.name?.endsWith(".tsv") ? "\t" : ",";
                const headers = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, ""));
                for (let i = 1; i < lines.length; i++) {
                  const vals = lines[i].split(sep).map((v) => v.trim().replace(/^"|"$/g, ""));
                  const record = {};
                  headers.forEach((h, j) => { if (vals[j]) record[h] = vals[j]; });
                  records.push(record);
                }
              } else if (f.type === "json") {
                const parsed = JSON.parse(f.text);
                records = Array.isArray(parsed) ? parsed : [parsed];
              }

              // If D1 table, bulk insert directly
              if (isD1 && records.length > 0) {
                let totalInserted = 0;
                for (let i = 0; i < records.length; i += 25) {
                  const batch = records.slice(i, i + 25);
                  await api.createRows(target_database_id, batch);
                  totalInserted += batch.length;
                }
                created.push({
                  file: f.name,
                  recordCount: records.length,
                  inserted: totalInserted,
                  storage: "d1",
                  sampleRecord: records[0] || null,
                });
              } else {
                created.push({
                  file: f.name,
                  recordCount: records.length,
                  sampleRecord: records[0] || null,
                  records: records.slice(0, 50),
                });
              }
            } catch (err) {
              errors.push({ file: f.name, error: err.message });
            }
          }

          return JSON.stringify({
            action: "create_records",
            target_database_id,
            parsed: created,
            errors,
            note: isD1
              ? `Records bulk-inserted into D1 table. ${created.reduce((s, c) => s + (c.inserted || 0), 0)} total rows created.`
              : "Records parsed. Use create_page tool to insert each record into the target database.",
          });
        }

        if (action === "index_to_kb") {
          if (!kbDbId) {
            return JSON.stringify({ error: "Knowledge base not configured." });
          }

          const indexed = [];
          for (const f of inputFiles) {
            const content = (f.text || "").substring(0, 1800); // KB entries have a size limit
            try {
              await writeKB(workerUrl, notionKey, kbDbId, {
                key: `upload:${f.name}`,
                category: "business_context",
                content: `[Uploaded file: ${f.name}]\n${content}`,
                source: "upload",
              });
              indexed.push(f.name);
            } catch (err) {
              indexed.push(`${f.name} (failed: ${err.message})`);
            }
          }

          return JSON.stringify({ action: "index_to_kb", indexed });
        }

        return JSON.stringify({ error: `Unknown action: ${action}` });
      }

      // ─── Smart Match Records ───
      case "smart_match_records": {
        const { database_id, search_terms, match_field } = toolInput;
        if (!database_id || !search_terms?.length) {
          return JSON.stringify({ error: "database_id and search_terms are required." });
        }

        const matches = [];
        const smCfg = await getFullPageConfig(database_id);
        const smPageType = smCfg?.page_type || null;

        // Load rows from any source into flat row objects for fuzzy matching
        let allRows = null;
        try {
          if (smPageType === "sheet") {
            const sheet = await api.getSheet(database_id);
            allRows = sheetCellsToRows(sheet.cells, sheet.col_count || 26);
          } else if (smPageType === "database") {
            const res = await api.listRows(database_id, { limit: 500 });
            allRows = (res?.rows || []).map((r) => ({ id: r.id, ...(r.cells || r) }));
          } else if (smPageType === "linked_sheet") {
            allRows = await fetchLinkedSheetRows(smCfg, workerUrl);
          } else if (smPageType === "linked_monday") {
            allRows = await fetchLinkedMondayRows(smCfg, mondayKey);
          } else if (smPageType === "linked_notion" && smCfg?.databaseIds?.length) {
            const res = await queryAll(workerUrl, notionKey, smCfg.databaseIds[0]);
            allRows = res.map((p) => ({ id: p.id, ...extractProperties(p) }));
          }
        } catch { /* fall through to Notion path */ }

        if (allRows !== null) {
          // Fuzzy match across flat rows
          for (const term of search_terms.slice(0, 10)) {
            const termLower = term.toLowerCase();
            const matched = allRows
              .map((row) => {
                let score = 0;
                for (const val of Object.values(row)) {
                  if (String(val).toLowerCase().includes(termLower)) score++;
                }
                return { ...row, _matchScore: score };
              })
              .filter((r) => r._matchScore > 0)
              .sort((a, b) => b._matchScore - a._matchScore)
              .slice(0, 5);
            if (matched.length > 0) matches.push({ term, matches: matched });
          }
        } else {
          // Direct Notion DB ID fallback
          for (const term of search_terms.slice(0, 10)) {
            try {
              const filter = match_field ? { property: match_field, rich_text: { contains: term } } : undefined;
              const results = await queryAll(workerUrl, notionKey, database_id, filter);
              const matched = results
                .map((page) => {
                  const props = extractProperties(page);
                  const termLower = term.toLowerCase();
                  let score = 0;
                  for (const [, val] of Object.entries(props)) {
                    if (String(val).toLowerCase().includes(termLower)) score++;
                  }
                  return { id: page.id, ...props, _matchScore: score };
                })
                .filter((r) => r._matchScore > 0)
                .sort((a, b) => b._matchScore - a._matchScore)
                .slice(0, 5);
              if (matched.length > 0) matches.push({ term, matches: matched });
            } catch (err) {
              matches.push({ term, error: err.message });
            }
          }
        }

        return JSON.stringify({
          search_terms,
          database_id,
          results: matches,
          totalMatches: matches.reduce((sum, m) => sum + (m.matches?.length || 0), 0),
        });
      }

      // ─── Neuron Operations ───

      case "query_neurons": {
        try {
          if (toolInput.node_id) {
            const res = await api.getNeuronsByNode(toolInput.node_id);
            return JSON.stringify({
              count: (res.neurons || []).length,
              neurons: res.neurons || [],
            });
          }
          const res = await api.getNeuronGraph();
          return JSON.stringify({
            count: (res.neurons || []).length,
            neurons: (res.neurons || []).slice(0, 50),
            truncated: (res.neurons || []).length > 50,
          });
        } catch (err) {
          return JSON.stringify({ error: err.message });
        }
      }

      case "create_neuron": {
        try {
          const res = await api.createNeuronAPI(toolInput.name || "", toolInput.nodes || []);
          return JSON.stringify({ success: true, neuron_id: res.id, node_count: (toolInput.nodes || []).length });
        } catch (err) {
          return JSON.stringify({ error: err.message });
        }
      }

      // ─── Calculation Sandbox ───

      case "run_calculation": {
        const { datasets, code, description } = toolInput;
        if (!code) return JSON.stringify({ error: "No code provided." });

        try {
          // ── Helper functions available in the sandbox ──
          const sum = (arr) => {
            if (!Array.isArray(arr)) return 0;
            return arr.reduce((a, b) => a + (Number(b) || 0), 0);
          };
          const avg = (arr) => {
            if (!Array.isArray(arr) || arr.length === 0) return 0;
            return sum(arr) / arr.length;
          };
          const min = (arr) => {
            const nums = (arr || []).map(Number).filter((n) => !isNaN(n));
            return nums.length ? Math.min(...nums) : 0;
          };
          const max = (arr) => {
            const nums = (arr || []).map(Number).filter((n) => !isNaN(n));
            return nums.length ? Math.max(...nums) : 0;
          };
          const groupBy = (arr, key) => {
            const groups = {};
            for (const item of (arr || [])) {
              const k = String(item?.[key] ?? "_none");
              (groups[k] = groups[k] || []).push(item);
            }
            return groups;
          };
          const sortBy = (arr, key, dir = "asc") =>
            [...(arr || [])].sort((a, b) => {
              const va = a?.[key], vb = b?.[key];
              const cmp = va < vb ? -1 : va > vb ? 1 : 0;
              return dir === "desc" ? -cmp : cmp;
            });
          const unique = (arr, key) =>
            [...new Set((arr || []).map((item) => (key ? item?.[key] : item)))].filter((v) => v != null);
          const round = (n, d = 2) => {
            const factor = Math.pow(10, d);
            return Math.round((Number(n) || 0) * factor) / factor;
          };
          const dateAdd = (dateStr, days) => {
            const d = new Date(dateStr);
            d.setDate(d.getDate() + days);
            return d.toISOString().split("T")[0];
          };
          const dateDiff = (dateStr1, dateStr2) => {
            const d1 = new Date(dateStr1);
            const d2 = new Date(dateStr2);
            return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
          };
          const weeksBetween = (dateStr1, dateStr2) => {
            return round(dateDiff(dateStr1, dateStr2) / 7, 1);
          };

          // ── Execute in sandbox ──
          // Try as expression first (IIFE), fall back to statements with implicit return
          let fnBody;
          const trimmed = code.trim();
          if (trimmed.startsWith("(function") || trimmed.startsWith("(()")) {
            // IIFE — wrap in return
            fnBody = `"use strict";\nreturn (${trimmed});`;
          } else if (trimmed.includes("return ")) {
            // Contains return statement — wrap in a block
            fnBody = `"use strict";\n${trimmed}`;
          } else {
            // Pure expression or statements — try as expression first
            fnBody = `"use strict";\nreturn (${trimmed});`;
          }

          let fn;
          try {
            fn = new Function(
              "datasets",
              "sum", "avg", "min", "max",
              "groupBy", "sortBy", "unique", "round",
              "dateAdd", "dateDiff", "weeksBetween",
              fnBody
            );
          } catch {
            // Expression parse failed — try as statements (last expression not returned)
            fn = new Function(
              "datasets",
              "sum", "avg", "min", "max",
              "groupBy", "sortBy", "unique", "round",
              "dateAdd", "dateDiff", "weeksBetween",
              `"use strict";\n${trimmed}`
            );
          }

          const result = fn(
            datasets || {},
            sum, avg, min, max,
            groupBy, sortBy, unique, round,
            dateAdd, dateDiff, weeksBetween
          );

          // Serialize result (handle large outputs gracefully)
          const serialized = JSON.stringify(result);
          const isTruncated = serialized.length > 50000;

          if (isTruncated && Array.isArray(result)) {
            // For arrays, return a subset with a note
            const subset = result.slice(0, Math.min(result.length, 200));
            return JSON.stringify({
              success: true,
              description: description || "Calculation completed",
              result: subset,
              totalRows: result.length,
              truncated: true,
              note: `Result had ${result.length} rows. Showing first ${subset.length}. Ask the user if they need more detail on specific items.`,
            });
          }

          return JSON.stringify({
            success: true,
            description: description || "Calculation completed",
            result,
            truncated: isTruncated,
          });
        } catch (err) {
          return JSON.stringify({
            error: `Calculation failed: ${err.message}`,
            description: description || "",
            hint: "Check your code syntax. Use an IIFE: (function() { ... return result; })()",
          });
        }
      }

      // ─── Batch Operations ───

      case "batch_operations": {
        const ops = (toolInput.operations || []).slice(0, 50);
        if (!ops.length) return JSON.stringify({ error: "No operations provided." });

        const results = [];
        for (const op of ops) {
          try {
            const result = await executeTool(op.action, op.params);
            results.push({ action: op.action, success: true, result: typeof result === "string" ? JSON.parse(result) : result });
          } catch (err) {
            results.push({ action: op.action, success: false, error: err.message });
          }
        }
        const succeeded = results.filter((r) => r.success).length;
        return JSON.stringify({
          success: true,
          total: results.length,
          succeeded,
          failed: results.length - succeeded,
          results,
        });
      }

      // ─── Export Report ───

      case "export_report": {
        // Return structured data for the frontend to handle (Blob download / print dialog)
        return JSON.stringify({
          __exportAction: true,
          format: toolInput.format,
          title: toolInput.title,
          headers: toolInput.headers,
          rows: toolInput.rows,
          summary: toolInput.summary || "",
        });
      }

      // ─── Delegate Task (Sub-Agents) ───

      case "delegate_task": {
        if (!claudeKey) return JSON.stringify({ error: "delegate_task requires API key configuration." });

        const tasks = (toolInput.tasks || []).slice(0, 5);
        if (!tasks.length) return JSON.stringify({ error: "No tasks provided." });

        try {
          const { runAgent } = await import("./runAgent.js");
          const { HAIKU } = await import("./aiRouter.js");
          const { WASABI_TOOLS: allTools } = await import("./tools.js");

          // Sub-agents get read-only tools only
          const readOnlyNames = new Set(["query_database", "search_knowledge_base", "run_calculation"]);
          const subAgentTools = allTools.filter((t) => readOnlyNames.has(t.name));

          // Create a read-only sub-executor (no claudeKey — prevents recursive delegation)
          const subExecutor = createToolExecutor({
            workerUrl, notionKey, mondayKey, parentPageId,
            kbDbId, notifDbId, configDbId, rulesDbId,
          });

          const results = await Promise.all(
            tasks.map(async (task) => {
              try {
                const messages = [{
                  role: "user",
                  content: `${task.instruction}\n\n${task.context ? `Context:\n${task.context}` : ""}`,
                }];
                const systemPrompt = "You are a focused analysis sub-agent. Answer the specific question using the tools available. Be precise, cite data sources, and return a structured summary. Do NOT fabricate data — only report what tools return.";
                const result = await runAgent({
                  messages,
                  tools: subAgentTools,
                  systemPrompt,
                  model: HAIKU,
                  workerUrl,
                  claudeKey,
                  executeTool: subExecutor,
                  maxIterations: 3,
                });
                return { label: task.label, success: true, result: result.text };
              } catch (err) {
                return { label: task.label, success: false, error: err.message };
              }
            })
          );

          const succeeded = results.filter((r) => r.success).length;
          const formatted = results.map((r) =>
            `### ${r.label}\n${r.success ? r.result : `Error: ${r.error}`}`
          ).join("\n\n");

          return `Sub-agent results (${succeeded}/${results.length} completed):\n\n${formatted}`;
        } catch (err) {
          return JSON.stringify({ error: `delegate_task failed: ${err.message}` });
        }
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  };
}
