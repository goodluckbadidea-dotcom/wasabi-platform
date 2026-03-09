// ─── Wasabi Tool Executor ───
// Routes tool calls to the appropriate Notion client functions.
// Returns string results for the agent.

import * as client from "../notion/client.js";
import { queryAll } from "../notion/pagination.js";
import { detectSchema, autoDetectViews, schemaToText, suggestViewMappings } from "../notion/schema.js";
import { writeKB, searchKB, kbResultsToText } from "./memory.js";
import { extractProperties, getPageTitle } from "../notion/properties.js";
import * as api from "../lib/api.js";
import { savePageConfig } from "../config/pageConfig.js";

// ─── D1 Helpers ───

/** Check if a database_id refers to a D1 standalone table or sheet (vs Notion DB). */
async function isD1Table(id) {
  try {
    const cfg = await api.getPageConfig(id);
    return cfg && (cfg.page_type === "database" || cfg.page_type === "sheet");
  } catch {
    return false;
  }
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
  parentPageId,
  kbDbId,
  notifDbId,
  configDbId,
  rulesDbId,
  onPageCreated,
}) {
  return async function executeTool(toolName, toolInput) {
    switch (toolName) {
      // ─── Database Operations ───
      case "query_database": {
        // D1 standalone table path
        if (await isD1Table(toolInput.database_id)) {
          // Use queryTable for full filter/sort/limit support
          const queryBody = {};
          if (toolInput.filter) queryBody.filters = toolInput.filter;
          if (toolInput.sorts) queryBody.sorts = toolInput.sorts;
          queryBody.limit = 200; // generous limit for agent visibility

          let rows;
          try {
            const res = await api.queryTable(toolInput.database_id, queryBody);
            rows = res?.rows || [];
          } catch {
            // Fallback to listRows if queryTable endpoint unavailable
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
        // Notion path
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
        for (const q of queries.slice(0, 5)) { // Max 5 databases per call
          const label = q.label || q.database_id;
          try {
            // D1 path
            if (await isD1Table(q.database_id)) {
              const queryBody = {};
              if (q.filter) queryBody.filters = q.filter;
              if (q.sorts) queryBody.sorts = q.sorts;
              queryBody.limit = 100;

              let rows;
              try {
                const res = await api.queryTable(q.database_id, queryBody);
                rows = res?.rows || [];
              } catch {
                const res = await api.listRows(q.database_id, { limit: 100 });
                rows = res?.rows || [];
              }
              allResults[label] = {
                count: rows.length,
                results: rows.slice(0, 100),
                truncated: rows.length > 100,
                storage: "d1",
              };
            } else {
              // Notion path
              const results = await queryAll(workerUrl, notionKey, q.database_id, q.filter, q.sorts);
              const summary = results.map((page) => {
                const props = extractProperties(page);
                return { id: page.id, ...props };
              });
              allResults[label] = {
                count: summary.length,
                results: summary.slice(0, 30),
                truncated: summary.length > 30,
              };
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
        // D1 standalone table — use api.getTableSchema()
        if (await isD1Table(toolInput.database_id)) {
          try {
            const d1Schema = await api.getTableSchema(toolInput.database_id);
            const columns = d1Schema?.columns || [];
            const text = columns.map((c) =>
              `- ${c.name} (${c.type}${c.options?.length ? `: ${c.options.join(", ")}` : ""})`
            ).join("\n");
            return JSON.stringify({
              schema: text,
              fieldCount: columns.length,
              raw: { columns, storage: "d1" },
              suggestedViews: [],
            });
          } catch (err) {
            return JSON.stringify({ error: `Failed to detect D1 schema: ${err.message}` });
          }
        }
        // Notion path
        const schema = await detectSchema(workerUrl, notionKey, toolInput.database_id);
        const views = autoDetectViews(schema);
        const text = schemaToText(schema);
        return JSON.stringify({
          schema: text,
          suggestedViews: views,
          fieldCount: schema.allFields.length,
          raw: schema,
        });
      }

      // ─── Page Config Creation ───
      case "create_page_config": {
        const { name, icon, databaseIds, views, agentPrompt } = toolInput;
        const pageConfig = {
          name,
          icon: icon || "page",
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
          // Parse CSV/JSON files into records
          const created = [];
          const errors = [];

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

              created.push({
                file: f.name,
                recordCount: records.length,
                sampleRecord: records[0] || null,
                records: records.slice(0, 50), // Cap for context window
              });
            } catch (err) {
              errors.push({ file: f.name, error: err.message });
            }
          }

          return JSON.stringify({
            action: "create_records",
            target_database_id,
            parsed: created,
            errors,
            note: "Records parsed. Use create_page tool to insert each record into the target database.",
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

        // D1 path — load all rows and search in JS
        if (await isD1Table(database_id)) {
          let allRows;
          try {
            const res = await api.listRows(database_id, { limit: 500 });
            allRows = res?.rows || [];
          } catch {
            allRows = [];
          }

          for (const term of search_terms.slice(0, 10)) {
            const termLower = term.toLowerCase();
            const matched = allRows
              .map((row) => {
                const cells = row.cells || row;
                let score = 0;
                for (const val of Object.values(cells)) {
                  if (String(val).toLowerCase().includes(termLower)) score++;
                }
                return { id: row.id || row._id, ...cells, _matchScore: score };
              })
              .filter((r) => r._matchScore > 0)
              .sort((a, b) => b._matchScore - a._matchScore)
              .slice(0, 5);

            if (matched.length > 0) {
              matches.push({ term, matches: matched });
            }
          }
        } else {
          // Notion path
          for (const term of search_terms.slice(0, 10)) {
            try {
              const filter = match_field
                ? { property: match_field, rich_text: { contains: term } }
                : undefined;

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

              if (matched.length > 0) {
                matches.push({ term, matches: matched });
              }
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

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  };
}
