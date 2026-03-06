// ─── Wasabi Tool Executor ───
// Routes tool calls to the appropriate Notion client functions.
// Returns string results for the agent.

import * as client from "../notion/client.js";
import { queryAll } from "../notion/pagination.js";
import { detectSchema, autoDetectViews, schemaToText, suggestViewMappings } from "../notion/schema.js";
import { writeKB, searchKB, kbResultsToText } from "./memory.js";
import { extractProperties, getPageTitle } from "../notion/properties.js";

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
  onPageCreated,
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

      // ─── Database Creation ───
      case "create_database": {
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
        await client.postNotification(workerUrl, notionKey, notifDbId, {
          message: toolInput.message,
          type: toolInput.type || "notification",
          source: toolInput.source || "wasabi",
        });
        return JSON.stringify({ success: true });
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
