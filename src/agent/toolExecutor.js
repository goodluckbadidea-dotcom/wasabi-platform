// ─── Wasabi Tool Executor ───
// Routes tool calls to the appropriate Notion client functions.
// Returns string results for the agent.

import * as client from "../notion/client.js";
import { queryAll } from "../notion/pagination.js";
import { detectSchema, autoDetectViews, schemaToText, suggestViewMappings } from "../notion/schema.js";
import { writeKB, searchKB, kbResultsToText } from "./memory.js";
import { extractProperties, getPageTitle } from "../notion/properties.js";
import * as api from "../lib/api.js";

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
 * @param {Function} opts.delegateToPageAgent - Callback for page agent delegation
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
  delegateToPageAgent,
}) {
  return async function executeTool(toolName, toolInput) {
    switch (toolName) {
      // ─── Database Operations ───
      case "query_database": {
        const results = await queryAll(
          workerUrl, notionKey,
          toolInput.database_id,
          toolInput.filter,
          toolInput.sorts
        );
        // Return summarized results (keep payload manageable for context)
        const summary = results.map((page) => {
          const props = extractProperties(page);
          return { id: page.id, ...props };
        });
        return JSON.stringify({
          count: summary.length,
          results: summary.slice(0, 50), // Cap at 50 for context window
          truncated: summary.length > 50,
        });
      }

      case "get_page": {
        const page = await client.getPage(workerUrl, notionKey, toolInput.page_id);
        const props = extractProperties(page);
        return JSON.stringify({ id: page.id, ...props });
      }

      case "create_page": {
        const page = await client.createPage(
          workerUrl, notionKey,
          toolInput.database_id,
          toolInput.properties
        );
        return JSON.stringify({ id: page.id, url: page.url, success: true });
      }

      case "update_page": {
        await client.updatePage(
          workerUrl, notionKey,
          toolInput.page_id,
          toolInput.properties
        );
        return JSON.stringify({ success: true, page_id: toolInput.page_id });
      }

      // ─── Cross-Database Query ───
      case "cross_database_query": {
        const queries = toolInput.queries || [];
        const allResults = {};
        for (const q of queries.slice(0, 5)) { // Max 5 databases per call
          const label = q.label || q.database_id;
          try {
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

        // Store config in Notion Page Config DB
        const configPage = await client.createPage(workerUrl, notionKey, configDbId, {
          Name: { title: [{ type: "text", text: { content: name } }] },
          Icon: { rich_text: [{ type: "text", text: { content: icon || "page" } }] },
          Config: { rich_text: [{ type: "text", text: { content: JSON.stringify(pageConfig) } }] },
        });

        pageConfig.id = configPage.id;

        // Notify the UI to add this page
        if (onPageCreated) onPageCreated(pageConfig);

        return JSON.stringify({ success: true, pageId: configPage.id, name });
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
        for (const term of search_terms.slice(0, 10)) {
          try {
            // Query with a title-contains filter as primary search
            const filter = match_field
              ? { property: match_field, rich_text: { contains: term } }
              : undefined;

            const results = await queryAll(workerUrl, notionKey, database_id, filter);
            const matched = results
              .map((page) => {
                const props = extractProperties(page);
                // Score by how many fields contain the search term
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

        return JSON.stringify({
          search_terms,
          database_id,
          results: matches,
          totalMatches: matches.reduce((sum, m) => sum + (m.matches?.length || 0), 0),
        });
      }

      // ─── Delegation to Page Agent ───
      case "delegate_to_page_agent": {
        if (!delegateToPageAgent) {
          return JSON.stringify({ error: "Page agent delegation not available in this context." });
        }
        try {
          const result = await delegateToPageAgent(toolInput.page_config_id, toolInput.task);
          return JSON.stringify({ success: true, result });
        } catch (err) {
          return JSON.stringify({ error: `Delegation failed: ${err.message}` });
        }
      }

      // ─── Escalation ───
      case "escalate_to_wasabi": {
        // This is handled by the ChatPanel component, not executed here.
        // Return a signal that the UI layer interprets.
        return JSON.stringify({
          _escalate: true,
          reason: toolInput.reason,
          context: toolInput.context_summary,
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  };
}

/**
 * Create a limited executor for page agents (no DB creation, no config writes).
 */
export function createPageToolExecutor({
  workerUrl, notionKey, notifDbId, kbDbId, scopedDatabaseIds,
}) {
  const fullExecutor = createToolExecutor({
    workerUrl, notionKey,
    parentPageId: null,
    kbDbId,
    notifDbId,
    configDbId: null,
    onPageCreated: null,
  });

  return async function executePageTool(toolName, toolInput) {
    // Block tools page agents shouldn't use
    const blocked = ["create_database", "detect_schema", "create_page_config", "update_knowledge_base"];
    if (blocked.includes(toolName)) {
      return JSON.stringify({ error: `Tool "${toolName}" is not available to page agents. Use escalate_to_wasabi instead.` });
    }

    // Scope database queries to allowed databases
    if (toolName === "query_database" && scopedDatabaseIds?.length) {
      if (!scopedDatabaseIds.includes(toolInput.database_id)) {
        return JSON.stringify({
          error: `Database ${toolInput.database_id} is outside this page's scope. Use escalate_to_wasabi for cross-database operations.`,
        });
      }
    }

    return fullExecutor(toolName, toolInput);
  };
}

/**
 * Create a delegate function that runs a page agent as a sub-agent.
 * Used by Wasabi to delegate tasks to page agents (runs on Haiku).
 *
 * @param {object} opts
 * @param {string} opts.workerUrl
 * @param {string} opts.notionKey
 * @param {string} opts.claudeKey
 * @param {string} opts.kbDbId
 * @param {string} opts.notifDbId
 * @param {string} opts.configDbId
 * @returns {Function} (pageConfigId, task) => Promise<string>
 */
export function createDelegateFunction({ workerUrl, notionKey, claudeKey, kbDbId, notifDbId, configDbId }) {
  return async function delegateToPageAgent(pageConfigId, task) {
    // 1. Load page config from Notion
    const configPage = await client.getPage(workerUrl, notionKey, pageConfigId);
    const configRaw = extractProperties(configPage);
    let pageConfig;
    try {
      pageConfig = JSON.parse(configRaw.Config || "{}");
    } catch {
      throw new Error(`Failed to parse config for page ${pageConfigId}`);
    }

    const pageName = configRaw.Name || pageConfig.name || "Page Agent";
    const databaseIds = pageConfig.databaseIds || pageConfig.agentConfig?.databases || [];

    // 2. Detect schema for the page's databases
    const { detectSchema, schemaToText } = await import("../notion/schema.js");
    let schemaText = "";
    for (const dbId of databaseIds.slice(0, 3)) {
      try {
        const schema = await detectSchema(workerUrl, notionKey, dbId);
        schemaText += `Database ${dbId}:\n${schemaToText(schema)}\n\n`;
      } catch (err) {
        schemaText += `Database ${dbId}: (failed to detect schema)\n\n`;
      }
    }

    // 3. Build page agent prompt
    const { buildPageAgentPrompt } = await import("./wasabiPrompt.js");
    const systemPrompt = buildPageAgentPrompt({
      pageName,
      agentPrompt: pageConfig.agentConfig?.prompt,
      databaseIds,
      schemaText,
    });

    // 4. Create scoped executor
    const executeTool = createPageToolExecutor({
      workerUrl, notionKey, notifDbId, kbDbId,
      scopedDatabaseIds: databaseIds,
    });

    // 5. Run mini agent loop
    const { runAgent } = await import("./runAgent.js");
    const { PAGE_TOOLS } = await import("./tools.js");

    const { text } = await runAgent({
      messages: [{ role: "user", content: task }],
      systemPrompt,
      tools: PAGE_TOOLS,
      model: "claude-haiku-4-5-20251001",
      workerUrl,
      claudeKey,
      executeTool,
      maxIterations: 8,
      maxTokens: 1024,
    });

    return text;
  };
}
