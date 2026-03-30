// ─── Wasabi MCP Server ───
// Local MCP server for Claude Desktop (Cowork).
// Proxies requests to the remote Wasabi Cloudflare Worker.
// Speaks MCP protocol over stdio transport.
//
// TOOL USAGE PLAYBOOK (for the AI reading these descriptions):
// 1. Start with wasabi_dashboard to understand the workspace
// 2. Use wasabi_pages (list) to find page IDs and their types
// 3. Use wasabi_data to read/write rows — if rows come back empty,
//    the table may need a Notion sync pull (use wasabi_sync pull)
// 4. Use wasabi_search to find anything by keyword across all data
// 5. Use wasabi_analytics for aggregations (count, sum, group_by)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ── Load config ──
const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, "config.json"), "utf-8"));
const { workerUrl, apiKey } = config;

// ── Core fetch helper ──
async function wasabiFetch(path, method = "GET", body = null) {
  const url = `${workerUrl}${path}`;
  const headers = {
    "Content-Type": "application/json",
    "X-Wasabi-Key": apiKey,
  };
  const opts = { method, headers };
  if (body && method !== "GET") opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    const msg = typeof data === "object" ? (data.error || data.message || JSON.stringify(data)) : text;
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return data;
}

function ok(result) {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
function err(error) {
  return { content: [{ type: "text", text: JSON.stringify({ error: String(error) }) }], isError: true };
}
function parseJSON(str) {
  if (!str) return undefined;
  if (typeof str === "object") return str;
  try { return JSON.parse(str); } catch { return str; }
}

// ── Auto-sync helper: check if a table needs sync pull ──
async function ensureSynced(tableId) {
  try {
    const status = await wasabiFetch(`/sync/${tableId}/status`);
    if (status && status.notion_db_id && !status.last_synced_at) {
      // Sync is configured but never pulled — do a full pull now
      const pullResult = await wasabiFetch(`/sync/${tableId}/pull?full=1`, "POST");
      return { auto_synced: true, pull_result: pullResult };
    }
    return null;
  } catch {
    return null; // No sync config — that's fine
  }
}

// ── Create MCP Server ──
const server = new McpServer({
  name: "wasabi",
  version: "1.0.0",
});

// ═══════════════════════════════════════════
// 1. HEALTH
// ═══════════════════════════════════════════
server.tool(
  "wasabi_health",
  "Check Wasabi worker health or list saved connections (Notion key, Claude key, etc.)",
  { action: z.enum(["check", "list_connections"]) },
  async ({ action }) => {
    try {
      if (action === "check") return ok(await wasabiFetch("/health"));
      if (action === "list_connections") return ok(await wasabiFetch("/connections"));
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 2. PAGES
// ═══════════════════════════════════════════
server.tool(
  "wasabi_pages",
  "List all pages/databases in the workspace, get a page config, get table schema, or manage page configs. Use 'list' first to discover available pages and their IDs. Page types: database, document, page, dashboard. To CREATE a database: provide title, page_type='database', columns array with {id, name, type} objects. To ADD VIEWS: update the page config with views array containing {type, label, config} objects. View types: table, kanban, gantt, calendar, cardGrid, charts, form, summaryTiles, activityFeed, customView. Read wasabi://docs/data-model for full view config schemas.",
  {
    action: z.enum(["list", "get", "get_schema", "create", "update", "delete"]),
    id: z.string().optional().describe("Page ID (required for get/get_schema/update/delete)"),
    data: z.string().optional().describe("JSON string of page config data for create/update"),
  },
  async ({ action, id, data: rawData }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": return ok(await wasabiFetch("/pages"));
        case "get": return ok(await wasabiFetch(`/pages/${id}`));
        case "get_schema": return ok(await wasabiFetch(`/pages/${id}/schema`));
        case "create": return ok(await wasabiFetch("/pages", "POST", data));
        case "update": return ok(await wasabiFetch(`/pages/${id}`, "PATCH", data));
        case "delete": return ok(await wasabiFetch(`/pages/${id}`, "DELETE"));
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 3. DATA (table rows) — with auto-sync
// ═══════════════════════════════════════════
server.tool(
  "wasabi_data",
  "Query, create, update, and delete table rows in D1 databases. Use wasabi_pages first to find table IDs. Default limit is 100 rows.",
  {
    action: z.enum(["list", "query", "create", "update", "delete"]),
    table_id: z.string().describe("The table/database ID"),
    row_id: z.string().optional().describe("Row ID (for update/delete)"),
    filters: z.string().optional().describe("JSON string of filter object for query action"),
    sorts: z.string().optional().describe("JSON string of sort array for query action"),
    limit: z.number().optional().describe("Max rows to return (default 100)"),
    offset: z.number().optional().describe("Pagination offset"),
    rows: z.string().optional().describe("JSON string of array of row objects for create"),
    data: z.string().optional().describe("JSON string of row data for update (cells object)"),
  },
  async ({ action, table_id, row_id, filters: rawFilters, sorts: rawSorts, limit, offset, rows: rawRows, data: rawData }) => {
    const filters = parseJSON(rawFilters);
    const sorts = parseJSON(rawSorts);
    const rows = parseJSON(rawRows);
    const data = parseJSON(rawData);
    try {
      const lim = limit || 100;
      switch (action) {
        case "list": {
          let result = await wasabiFetch(`/tables/${table_id}/rows?limit=${lim}&offset=${offset || 0}`);
          let rowArr = result?.rows || (Array.isArray(result) ? result : []);
          // Auto-sync: if empty, check if Notion sync needs initial pull
          if (rowArr.length === 0) {
            const syncInfo = await ensureSynced(table_id);
            if (syncInfo?.auto_synced) {
              // Re-fetch after sync
              result = await wasabiFetch(`/tables/${table_id}/rows?limit=${lim}&offset=${offset || 0}`);
              rowArr = result?.rows || (Array.isArray(result) ? result : []);
              return ok({ ...result, rows: rowArr, _auto_synced: true, _sync_result: syncInfo.pull_result });
            }
          }
          return ok(result);
        }
        case "query": {
          let result = await wasabiFetch(`/tables/${table_id}/query`, "POST", { filters, sorts, limit: lim, offset });
          let rowArr = result?.rows || (Array.isArray(result) ? result : []);
          // Auto-sync on empty query too
          if (rowArr.length === 0) {
            const syncInfo = await ensureSynced(table_id);
            if (syncInfo?.auto_synced) {
              result = await wasabiFetch(`/tables/${table_id}/query`, "POST", { filters, sorts, limit: lim, offset });
              return ok({ ...(typeof result === 'object' ? result : { rows: result }), _auto_synced: true });
            }
          }
          return ok(result);
        }
        case "create":
          return ok(await wasabiFetch(`/tables/${table_id}/rows`, "POST", { rows }));
        case "update":
          return ok(await wasabiFetch(`/tables/${table_id}/rows/${row_id}`, "PATCH", data));
        case "delete":
          return ok(await wasabiFetch(`/tables/${table_id}/rows/${row_id}`, "DELETE"));
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 4. AUTOMATIONS
// ═══════════════════════════════════════════
server.tool(
  "wasabi_automations",
  "CRUD automation rules. Trigger types: schedule (cron), status_change, field_change, page_created, manual. action_config.instruction is an AI prompt that supports {{field}} template variables. Example: trigger_type='schedule', trigger_config={cron:'0 9 * * 1-5'}, action_config={instruction:'Check inventory levels and alert if below threshold'}. Read wasabi://docs/data-model for full rule schema.",
  {
    action: z.enum(["list", "get", "create", "update", "delete"]),
    id: z.string().optional().describe("Rule ID"),
    data: z.string().optional().describe("JSON string of rule data: name, description, trigger_type, trigger_config, action_config, enabled, scope_table_id"),
    enabled: z.boolean().optional().describe("Filter by enabled status for list"),
  },
  async ({ action, id, data: rawData, enabled }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": {
          const qs = enabled != null ? `?enabled=${enabled}` : "";
          return ok(await wasabiFetch(`/d1/rules${qs}`));
        }
        case "get": return ok(await wasabiFetch(`/d1/rules/${id}`));
        case "create": return ok(await wasabiFetch("/d1/rules", "POST", data));
        case "update": return ok(await wasabiFetch(`/d1/rules/${id}`, "PATCH", data));
        case "delete": return ok(await wasabiFetch(`/d1/rules/${id}`, "DELETE"));
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 5. CUSTOM FUNCTIONS
// ═══════════════════════════════════════════
server.tool(
  "wasabi_functions",
  "CRUD custom functions and plugins. Types: transform, aggregation, forecast, alert, pipeline, view, plugin. Plugins have type='plugin' and include a manifest. Use list_executions to see past runs. To BUILD a plugin: create with type='plugin', code containing HTML/CSS/JS (rendered in iframe), and meta.manifest with name/icon/version. To build a CUSTOM VIEW: type='view', code with HTML/CSS/JS. Read wasabi://docs/data-model resource for full schema and examples.",
  {
    action: z.enum(["list", "get", "create", "update", "delete", "list_executions"]),
    id: z.string().optional().describe("Function ID"),
    data: z.string().optional().describe("JSON string of function data: name, description, type, inputs, outputs, code, status, meta, manifest"),
    status: z.string().optional().describe("Filter by status: draft, active, disabled"),
    type: z.string().optional().describe("Filter by type: transform, plugin, etc."),
    limit: z.number().optional().describe("Limit for list_executions"),
  },
  async ({ action, id, data: rawData, status, type, limit }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": {
          const params = new URLSearchParams();
          if (status) params.set("status", status);
          if (type) params.set("type", type);
          const qs = params.toString() ? `?${params}` : "";
          return ok(await wasabiFetch(`/d1/custom-functions${qs}`));
        }
        case "get": return ok(await wasabiFetch(`/d1/custom-functions/${id}`));
        case "create": return ok(await wasabiFetch("/d1/custom-functions", "POST", data));
        case "update": return ok(await wasabiFetch(`/d1/custom-functions/${id}`, "PATCH", data));
        case "delete": return ok(await wasabiFetch(`/d1/custom-functions/${id}`, "DELETE"));
        case "list_executions": {
          const params = new URLSearchParams();
          if (id) params.set("function_id", id);
          if (limit) params.set("limit", String(limit));
          return ok(await wasabiFetch(`/d1/function-executions?${params}`));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 6. FLOWS
// ═══════════════════════════════════════════
server.tool(
  "wasabi_flows",
  "CRUD automation flows (multi-step node-based workflows with a graph of connected actions). Flow graph has nodes array [{id, type, config}] and edges array [{source, target}]. Node types: trigger, action, condition, delay. Action nodes use config.instruction for AI-powered steps. Read wasabi://docs/data-model for flow schema examples.",
  {
    action: z.enum(["list", "get", "create", "update", "delete", "list_executions"]),
    id: z.string().optional().describe("Flow ID"),
    data: z.string().optional().describe("JSON string of flow data: name, description, graph, enabled"),
    enabled: z.boolean().optional().describe("Filter by enabled for list"),
    limit: z.number().optional(),
  },
  async ({ action, id, data: rawData, enabled, limit }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": {
          const qs = enabled != null ? `?enabled=${enabled}` : "";
          return ok(await wasabiFetch(`/d1/flows${qs}`));
        }
        case "get": return ok(await wasabiFetch(`/d1/flows/${id}`));
        case "create": return ok(await wasabiFetch("/d1/flows", "POST", data));
        case "update": return ok(await wasabiFetch(`/d1/flows/${id}`, "PATCH", data));
        case "delete": return ok(await wasabiFetch(`/d1/flows/${id}`, "DELETE"));
        case "list_executions": {
          const params = new URLSearchParams();
          if (id) params.set("flow_id", id);
          if (limit) params.set("limit", String(limit));
          return ok(await wasabiFetch(`/d1/flow-executions?${params}`));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 7. KNOWLEDGE BASE
// ═══════════════════════════════════════════
server.tool(
  "wasabi_kb",
  "CRUD knowledge base entries. KB entries shape future AI agent responses by providing business context, rules, and domain knowledge.",
  {
    action: z.enum(["list", "get", "create", "update", "delete", "search"]),
    id: z.string().optional().describe("KB entry ID"),
    data: z.string().optional().describe("JSON string of KB data: key, category, content, source, related_pages"),
    category: z.string().optional().describe("Filter by category for list"),
    query: z.string().optional().describe("Search query for search action"),
  },
  async ({ action, id, data: rawData, category, query }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": {
          const qs = category ? `?category=${encodeURIComponent(category)}` : "";
          return ok(await wasabiFetch(`/d1/kb${qs}`));
        }
        case "get": return ok(await wasabiFetch(`/d1/kb/${id}`));
        case "create": return ok(await wasabiFetch("/d1/kb", "POST", data));
        case "update": return ok(await wasabiFetch(`/d1/kb/${id}`, "PATCH", data));
        case "delete": return ok(await wasabiFetch(`/d1/kb/${id}`, "DELETE"));
        case "search": return ok(await wasabiFetch("/d1/kb/search", "POST", { query, category }));
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 8. NOTIFICATIONS
// ═══════════════════════════════════════════
server.tool(
  "wasabi_notifications",
  "List, create, and manage notifications. Check unread count or mark all as read.",
  {
    action: z.enum(["list", "create", "update", "delete", "mark_all_read", "unread_count"]),
    id: z.string().optional().describe("Notification ID"),
    data: z.string().optional().describe("JSON string of notification data: message, type, source, record_id"),
    status: z.string().optional().describe("Filter: unread, read"),
    limit: z.number().optional(),
  },
  async ({ action, id, data: rawData, status, limit }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": {
          const params = new URLSearchParams();
          if (status) params.set("status", status);
          if (limit) params.set("limit", String(limit));
          return ok(await wasabiFetch(`/d1/notifications?${params}`));
        }
        case "create": return ok(await wasabiFetch("/d1/notifications", "POST", data));
        case "update": return ok(await wasabiFetch(`/d1/notifications/${id}`, "PATCH", data));
        case "delete": return ok(await wasabiFetch(`/d1/notifications/${id}`, "DELETE"));
        case "mark_all_read": return ok(await wasabiFetch("/d1/notifications/mark-all-read", "POST"));
        case "unread_count": return ok(await wasabiFetch("/d1/notifications/unread-count"));
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 9. NEURONS
// ═══════════════════════════════════════════
server.tool(
  "wasabi_neurons",
  "Neurons are named relationship clusters linking records, pages, and fields across the workspace. Use to discover hidden connections (e.g. which vendors supply which SKUs, or which projects depend on which inventory). Create neurons with nodes: each node has node_type (record|page|field|table), node_id, node_label, page_config_id. Use 'graph' to visualize all relationships. Use 'by_node' to find all neurons containing a specific record/field.",
  {
    action: z.enum(["list", "get", "create", "delete", "graph", "add_node", "remove_node", "by_node"]),
    id: z.string().optional().describe("Neuron ID"),
    node_id: z.string().optional().describe("Node ID (for remove_node/by_node)"),
    data: z.string().optional().describe("JSON string of neuron data: name, nodes (for create); node details (for add_node)"),
  },
  async ({ action, id, node_id, data: rawData }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": return ok(await wasabiFetch("/neurons"));
        case "get": return ok(await wasabiFetch(`/neurons/${id}`));
        case "create": return ok(await wasabiFetch("/neurons", "POST", data));
        case "delete": return ok(await wasabiFetch(`/neurons/${id}`, "DELETE"));
        case "graph": return ok(await wasabiFetch("/neurons/graph"));
        case "add_node": return ok(await wasabiFetch(`/neurons/${id}/nodes`, "POST", data));
        case "remove_node": return ok(await wasabiFetch(`/neurons/${id}/nodes/${node_id}`, "DELETE"));
        case "by_node": return ok(await wasabiFetch(`/neurons/by-node/${node_id}`));
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 10. USERS
// ═══════════════════════════════════════════
server.tool(
  "wasabi_users",
  "List workspace users, check current user, invite new users, update roles, or delete users. Admin only for invite/update/delete.",
  {
    action: z.enum(["list", "get_me", "invite", "update", "delete"]),
    id: z.string().optional().describe("User ID (for update/delete)"),
    data: z.string().optional().describe("JSON string of user data: display_name + role for invite; role for update"),
  },
  async ({ action, id, data: rawData }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": return ok(await wasabiFetch("/users"));
        case "get_me": return ok(await wasabiFetch("/auth/me"));
        case "invite": return ok(await wasabiFetch("/users/invite", "POST", data));
        case "update": return ok(await wasabiFetch(`/users/${id}`, "PATCH", data));
        case "delete": return ok(await wasabiFetch(`/users/${id}`, "DELETE"));
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 11. FILES
// ═══════════════════════════════════════════
server.tool(
  "wasabi_files",
  "List or delete files stored in R2. Upload is not supported via MCP (use the web UI). Filter by page_id or record_id.",
  {
    action: z.enum(["list", "get_url", "delete"]),
    id: z.string().optional().describe("File ID (for get_url/delete)"),
    page_id: z.string().optional().describe("Filter files by page"),
    record_id: z.string().optional().describe("Filter files by record"),
  },
  async ({ action, id, page_id, record_id }) => {
    try {
      switch (action) {
        case "list": {
          const params = new URLSearchParams();
          if (page_id) params.set("page_id", page_id);
          if (record_id) params.set("record_id", record_id);
          return ok(await wasabiFetch(`/files?${params}`));
        }
        case "get_url": return ok(await wasabiFetch(`/files/${id}`));
        case "delete": return ok(await wasabiFetch(`/files/${id}`, "DELETE"));
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 12. SEARCH
// ═══════════════════════════════════════════
server.tool(
  "wasabi_search",
  "Search across ALL tables, pages, and knowledge base in one call. Finds records by keyword across the entire workspace. Returns matched rows grouped by page/table.",
  {
    query: z.string().describe("Search keyword or phrase"),
    scope: z.enum(["all", "tables", "kb", "pages"]).optional().describe("Limit search scope (default: all)"),
    limit: z.number().optional().describe("Max results per table (default 10)"),
  },
  async ({ query, scope, limit }) => {
    const lim = limit || 10;
    const s = scope || "all";
    try {
      const results = {};

      // Search pages by name
      if (s === "all" || s === "pages") {
        const pages = await wasabiFetch("/pages").catch(() => []);
        const matched = (Array.isArray(pages) ? pages : []).filter(
          (p) => (p.name || "").toLowerCase().includes(query.toLowerCase())
        );
        if (matched.length) results.pages = matched.map((p) => ({ id: p.id, name: p.name, type: p.page_type }));
      }

      // Search KB
      if (s === "all" || s === "kb") {
        const kb = await wasabiFetch("/d1/kb/search", "POST", { query }).catch(() => []);
        if (Array.isArray(kb) && kb.length) results.knowledge_base = kb.slice(0, lim);
      }

      // Search across all table rows
      if (s === "all" || s === "tables") {
        const pages = await wasabiFetch("/pages").catch(() => []);
        const tables = (Array.isArray(pages) ? pages : []).filter((p) => p.id);
        const tableResults = [];
        for (const page of tables.slice(0, 10)) {
          try {
            const rows = await wasabiFetch(`/tables/${page.id}/rows?limit=${lim}&search=${encodeURIComponent(query)}`);
            const rowArr = rows?.rows || (Array.isArray(rows) ? rows : []);
            if (rowArr.length) tableResults.push({ page_id: page.id, page_name: page.name, rows: rowArr });
          } catch { /* skip tables that error */ }
        }
        if (tableResults.length) results.table_rows = tableResults;
      }

      return ok(results);
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 13. DASHBOARD
// ═══════════════════════════════════════════
server.tool(
  "wasabi_dashboard",
  "Get a comprehensive workspace snapshot: health status, page list with row counts, unread notifications, recent activity. Perfect for morning briefings or status checks. START HERE when exploring the workspace — this gives you the full picture. Then use wasabi_pages to drill into specific pages, wasabi_data to read rows, wasabi_analytics for aggregations.",
  {
    include: z.enum(["all", "health", "pages", "notifications", "activity"]).optional().describe("What to include (default: all)"),
  },
  async ({ include }) => {
    const inc = include || "all";
    try {
      const snapshot = {};
      const fetches = [];

      if (inc === "all" || inc === "health") {
        fetches.push(wasabiFetch("/health").then((r) => (snapshot.health = r)).catch(() => (snapshot.health = { status: "unreachable" })));
      }
      if (inc === "all" || inc === "pages") {
        fetches.push(wasabiFetch("/pages").then((pages) => {
          const arr = Array.isArray(pages) ? pages : [];
          snapshot.pages = arr.map((p) => ({
            id: p.id,
            name: p.name,
            type: p.page_type,
            parent_id: p.parent_id || null,
            views: (p.views || []).length,
          }));
          snapshot.page_count = arr.length;
        }).catch(() => (snapshot.pages = [])));
      }
      if (inc === "all" || inc === "notifications") {
        fetches.push(wasabiFetch("/d1/notifications/unread-count").then((r) => (snapshot.unread_notifications = r)).catch(() => (snapshot.unread_notifications = 0)));
      }
      if (inc === "all" || inc === "activity") {
        fetches.push(wasabiFetch("/task-activity?limit=10").then((r) => (snapshot.recent_activity = r)).catch(() => (snapshot.recent_activity = [])));
      }

      await Promise.all(fetches);
      snapshot.timestamp = new Date().toISOString();
      return ok(snapshot);
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 14. ANALYTICS
// ═══════════════════════════════════════════
server.tool(
  "wasabi_analytics",
  "Run aggregate queries on table data: count rows, sum/average numeric fields, group by a field. Useful for reports like 'total spend by vendor' or 'count of items by status'.",
  {
    table_id: z.string().describe("Table ID to analyze"),
    operation: z.enum(["count", "sum", "average", "group_count", "group_sum"]).describe("Aggregation type"),
    field: z.string().optional().describe("Field name for sum/average/group operations"),
    group_by: z.string().optional().describe("Field to group by (for group_count/group_sum)"),
    filters: z.string().optional().describe("JSON string of filter object to narrow the dataset"),
  },
  async ({ table_id, operation, field, group_by, filters: rawFilters }) => {
    const filters = parseJSON(rawFilters);
    try {
      const body = { filters, limit: 5000 };
      const result = await wasabiFetch(`/tables/${table_id}/query`, "POST", body);
      let rows = result?.rows || (Array.isArray(result) ? result : []);

      // Auto-sync if empty
      if (rows.length === 0) {
        const syncInfo = await ensureSynced(table_id);
        if (syncInfo?.auto_synced) {
          const retry = await wasabiFetch(`/tables/${table_id}/query`, "POST", body);
          rows = retry?.rows || (Array.isArray(retry) ? retry : []);
        }
      }

      const getCellValue = (row, f) => {
        const cells = row.cells || row;
        return cells[f] ?? null;
      };

      switch (operation) {
        case "count":
          return ok({ count: rows.length });
        case "sum": {
          const total = rows.reduce((s, r) => s + (Number(getCellValue(r, field)) || 0), 0);
          return ok({ field, sum: total, count: rows.length });
        }
        case "average": {
          const vals = rows.map((r) => Number(getCellValue(r, field))).filter((v) => !isNaN(v));
          return ok({ field, average: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0, count: vals.length });
        }
        case "group_count": {
          const groups = {};
          for (const r of rows) { const k = String(getCellValue(r, group_by) ?? "(empty)"); groups[k] = (groups[k] || 0) + 1; }
          return ok({ group_by, groups, total: rows.length });
        }
        case "group_sum": {
          const groups = {};
          for (const r of rows) { const k = String(getCellValue(r, group_by) ?? "(empty)"); groups[k] = (groups[k] || 0) + (Number(getCellValue(r, field)) || 0); }
          return ok({ group_by, field, groups, total: rows.length });
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 15. DIFF
// ═══════════════════════════════════════════
server.tool(
  "wasabi_diff",
  "Compare current table state with a previous snapshot, or get recently modified rows. Useful for tracking what changed since a given date.",
  {
    table_id: z.string().describe("Table ID"),
    since: z.string().optional().describe("ISO date string — return rows modified after this time"),
    limit: z.number().optional().describe("Max rows to return (default 50)"),
  },
  async ({ table_id, since, limit }) => {
    const lim = limit || 50;
    try {
      const result = await wasabiFetch(`/tables/${table_id}/rows?limit=${lim}`);
      const rows = result?.rows || (Array.isArray(result) ? result : []);

      if (since) {
        const sinceDate = new Date(since).getTime();
        const changed = rows.filter((r) => new Date(r.updated_at || r.created_at).getTime() > sinceDate);
        return ok({ table_id, since, changed_rows: changed.length, rows: changed });
      }

      const sorted = [...rows].sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
      return ok({ table_id, total: sorted.length, rows: sorted.slice(0, lim) });
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 16. IMPORT
// ═══════════════════════════════════════════
server.tool(
  "wasabi_import",
  "Bulk import data into a Wasabi table. Accepts an array of row objects (as JSON string). Automatically fetches the target table schema so you can map columns. Use action='schema' first to see available columns, then 'import' to insert.",
  {
    action: z.enum(["schema", "import"]).describe("'schema' to get column info, 'import' to insert rows"),
    table_id: z.string().describe("Target table ID"),
    rows: z.string().optional().describe("JSON string of array of row objects, e.g. [{\"Name\":\"Widget\",\"Cost\":42}, ...]"),
    merge_key: z.string().optional().describe("If set, update existing rows where this column matches instead of creating duplicates"),
  },
  async ({ action, table_id, rows: rawRows, merge_key }) => {
    try {
      if (action === "schema") {
        const schema = await wasabiFetch(`/pages/${table_id}/schema`);
        return ok({ table_id, schema, hint: "Use the column names from this schema as keys in your row objects for import" });
      }

      const rows = parseJSON(rawRows);
      if (!Array.isArray(rows) || !rows.length) return err("rows must be a non-empty JSON array of objects");

      if (merge_key) {
        const existing = await wasabiFetch(`/tables/${table_id}/rows?limit=5000`);
        const existingRows = existing?.rows || (Array.isArray(existing) ? existing : []);
        const existingMap = {};
        for (const r of existingRows) {
          const key = (r.cells || r)[merge_key];
          if (key != null) existingMap[String(key)] = r.id;
        }

        const toCreate = [];
        const toUpdate = [];
        for (const row of rows) {
          const key = row[merge_key];
          if (key != null && existingMap[String(key)]) {
            toUpdate.push({ id: existingMap[String(key)], cells: row });
          } else {
            toCreate.push(row);
          }
        }

        const results = { created: 0, updated: 0, errors: [] };
        if (toCreate.length) {
          await wasabiFetch(`/tables/${table_id}/rows`, "POST", { rows: toCreate });
          results.created = toCreate.length;
        }
        for (const u of toUpdate) {
          try {
            await wasabiFetch(`/tables/${table_id}/rows/${u.id}`, "PATCH", u.cells);
            results.updated++;
          } catch (e) { results.errors.push({ id: u.id, error: String(e) }); }
        }
        return ok(results);
      }

      const result = await wasabiFetch(`/tables/${table_id}/rows`, "POST", { rows });
      return ok({ created: rows.length, result });
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 17. EXPORT
// ═══════════════════════════════════════════
server.tool(
  "wasabi_export",
  "Export table data as JSON or CSV format. Useful for getting data out of Wasabi for use in spreadsheets, emails, or other apps.",
  {
    table_id: z.string().describe("Table ID to export"),
    format: z.enum(["json", "csv"]).optional().describe("Output format (default: json)"),
    filters: z.string().optional().describe("JSON string of filter object to export subset"),
    limit: z.number().optional().describe("Max rows (default 1000)"),
  },
  async ({ table_id, format, filters: rawFilters, limit }) => {
    const fmt = format || "json";
    const lim = limit || 1000;
    const filters = parseJSON(rawFilters);
    try {
      let rows;
      if (filters) {
        const result = await wasabiFetch(`/tables/${table_id}/query`, "POST", { filters, limit: lim });
        rows = result?.rows || (Array.isArray(result) ? result : []);
      } else {
        const result = await wasabiFetch(`/tables/${table_id}/rows?limit=${lim}`);
        rows = result?.rows || (Array.isArray(result) ? result : []);
      }

      if (fmt === "csv") {
        if (!rows.length) return ok({ csv: "", row_count: 0 });
        const allKeys = new Set();
        for (const r of rows) for (const k of Object.keys(r.cells || r)) allKeys.add(k);
        const headers = [...allKeys];
        const csvLines = [headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(",")];
        for (const r of rows) {
          const cells = r.cells || r;
          csvLines.push(headers.map((h) => { const v = cells[h] ?? ""; return `"${String(v).replace(/"/g, '""')}"`; }).join(","));
        }
        return ok({ csv: csvLines.join("\n"), row_count: rows.length });
      }

      return ok({ rows, row_count: rows.length });
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 18. LINK EXTERNAL
// ═══════════════════════════════════════════
server.tool(
  "wasabi_link_external",
  "Attach external context to a Wasabi record — add a comment or note linking an email, URL, document, or other external reference. Useful for connecting Cowork context to Wasabi data.",
  {
    action: z.enum(["add_comment", "set_note", "get_comments", "get_note"]),
    record_id: z.string().describe("Record ID to attach to"),
    page_id: z.string().optional().describe("Page ID (required for notes)"),
    content: z.string().optional().describe("Comment text or note content (markdown supported)"),
    user_name: z.string().optional().describe("Display name for comment author (default: MCP)"),
  },
  async ({ action, record_id, page_id, content, user_name }) => {
    try {
      switch (action) {
        case "add_comment":
          return ok(await wasabiFetch(`/records/${record_id}/comments`, "POST", {
            content, user_id: "mcp", user_name: user_name || "Cowork MCP",
          }));
        case "set_note":
          return ok(await wasabiFetch(`/records/${record_id}/notes`, "PUT", {
            content, page_config_id: page_id,
          }));
        case "get_comments":
          return ok(await wasabiFetch(`/records/${record_id}/comments`));
        case "get_note":
          return ok(await wasabiFetch(`/records/${record_id}/notes?page_config_id=${page_id}`));
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 19. SQL (advanced query)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_sql",
  "Execute powerful queries against Wasabi tables using the query endpoint. Supports complex filters, sorts, and pagination. For advanced data questions that simple list/get can't answer.",
  {
    table_id: z.string().describe("Table ID to query"),
    filters: z.string().optional().describe("JSON string of filter object: {\"field\": {\"op\": \"value\"}} where op is eq, ne, gt, lt, gte, lte, contains, starts_with, in"),
    sorts: z.string().optional().describe("JSON string of sort array: [{\"field\": \"Name\", \"direction\": \"asc\"}]"),
    limit: z.number().optional().describe("Max rows (default 100, max 5000)"),
    offset: z.number().optional().describe("Pagination offset"),
    fields: z.string().optional().describe("Comma-separated list of fields to return (default: all)"),
  },
  async ({ table_id, filters: rawFilters, sorts: rawSorts, limit, offset, fields }) => {
    const filters = parseJSON(rawFilters);
    const sorts = parseJSON(rawSorts);
    try {
      const body = { filters, sorts, limit: limit || 100, offset: offset || 0 };
      const result = await wasabiFetch(`/tables/${table_id}/query`, "POST", body);
      let rows = result?.rows || (Array.isArray(result) ? result : []);

      // Auto-sync if empty
      if (rows.length === 0) {
        const syncInfo = await ensureSynced(table_id);
        if (syncInfo?.auto_synced) {
          const retry = await wasabiFetch(`/tables/${table_id}/query`, "POST", body);
          rows = retry?.rows || (Array.isArray(retry) ? retry : []);
        }
      }

      if (fields) {
        const fieldList = fields.split(",").map((f) => f.trim());
        rows = rows.map((r) => {
          const cells = r.cells || r;
          const filtered = {};
          for (const f of fieldList) if (f in cells) filtered[f] = cells[f];
          return { ...r, cells: filtered };
        });
      }

      return ok({ rows, count: rows.length });
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 20. SCHEMA ALTER
// ═══════════════════════════════════════════
server.tool(
  "wasabi_schema_alter",
  "Modify a table's schema: add new columns, remove columns, or rename/retype existing columns. Use wasabi_pages get_schema first to see current columns.",
  {
    table_id: z.string().describe("Page/table ID whose schema to modify"),
    action: z.enum(["get", "update"]).describe("'get' to view schema, 'update' to modify"),
    schema: z.string().optional().describe("JSON string of updated schema (full columns array for update)"),
  },
  async ({ table_id, action, schema: rawSchema }) => {
    try {
      if (action === "get") {
        return ok(await wasabiFetch(`/pages/${table_id}/schema`));
      }
      const schema = parseJSON(rawSchema);
      return ok(await wasabiFetch(`/pages/${table_id}/schema`, "PATCH", schema));
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 21. BULK UPDATE
// ═══════════════════════════════════════════
server.tool(
  "wasabi_bulk_update",
  "Update multiple rows that match a filter in one operation. E.g. 'mark all Awaiting PO items from vendor X as Cancelled'. Returns count of rows updated.",
  {
    table_id: z.string().describe("Table ID"),
    filters: z.string().describe("JSON string of filter to match rows to update"),
    updates: z.string().describe("JSON string of cell values to set on all matched rows, e.g. {\"Status\":\"Cancelled\"}"),
    dry_run: z.boolean().optional().describe("If true, return matched rows without updating (default: false)"),
  },
  async ({ table_id, filters: rawFilters, updates: rawUpdates, dry_run }) => {
    const filters = parseJSON(rawFilters);
    const updates = parseJSON(rawUpdates);
    try {
      const result = await wasabiFetch(`/tables/${table_id}/query`, "POST", { filters, limit: 5000 });
      const rows = result?.rows || (Array.isArray(result) ? result : []);

      if (dry_run) return ok({ matched: rows.length, rows: rows.slice(0, 20), note: "Dry run — no changes made" });

      let updated = 0;
      const errors = [];
      for (const row of rows) {
        try {
          await wasabiFetch(`/tables/${table_id}/rows/${row.id}`, "PATCH", updates);
          updated++;
        } catch (e) { errors.push({ id: row.id, error: String(e) }); }
      }
      return ok({ matched: rows.length, updated, errors: errors.length ? errors : undefined });
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 22. BACKUP
// ═══════════════════════════════════════════
server.tool(
  "wasabi_backup",
  "Create a full snapshot of a table's data (all rows + schema). Returns the data as JSON for safekeeping. Use before making bulk changes.",
  {
    table_id: z.string().describe("Table ID to back up"),
  },
  async ({ table_id }) => {
    try {
      const [schema, data] = await Promise.all([
        wasabiFetch(`/pages/${table_id}/schema`).catch(() => null),
        wasabiFetch(`/tables/${table_id}/rows?limit=10000`).catch(() => []),
      ]);
      const rows = data?.rows || (Array.isArray(data) ? data : []);
      return ok({
        table_id,
        timestamp: new Date().toISOString(),
        schema,
        row_count: rows.length,
        rows,
      });
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 23. AGENT QUERY (Claude-to-Claude)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_agent_query",
  "Send a prompt to the Wasabi in-app Claude agent. The agent has Wasabi-specific context (system prompt, KB, page schemas) that Cowork doesn't. Use this to leverage its domain knowledge or to perform actions through it.",
  {
    prompt: z.string().describe("The prompt/question to send to the Wasabi agent"),
    context: z.string().optional().describe("Optional JSON string of additional context to include (page_id, record data, etc.)"),
  },
  async ({ prompt, context: rawContext }) => {
    const context = parseJSON(rawContext);
    try {
      const body = {
        messages: [{ role: "user", content: prompt }],
      };
      if (context) body.context = context;
      const result = await wasabiFetch("/claude", "POST", body);
      return ok(result);
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 24. AGENT CONFIG
// ═══════════════════════════════════════════
server.tool(
  "wasabi_agent_config",
  "Read or update the Wasabi in-app agent's configuration: system prompt, persona, knowledge base entries that shape its behavior. Tune the agent without opening the app.",
  {
    action: z.enum(["get_kb", "update_kb", "create_kb", "list_kb"]),
    id: z.string().optional().describe("KB entry ID (for get/update)"),
    data: z.string().optional().describe("JSON string of KB data to create/update"),
    category: z.string().optional().describe("Filter KB by category (e.g. 'agent_config', 'business_rules')"),
  },
  async ({ action, id, data: rawData, category }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list_kb": {
          const qs = category ? `?category=${encodeURIComponent(category)}` : "";
          return ok(await wasabiFetch(`/d1/kb${qs}`));
        }
        case "get_kb": return ok(await wasabiFetch(`/d1/kb/${id}`));
        case "create_kb": return ok(await wasabiFetch("/d1/kb", "POST", data));
        case "update_kb": return ok(await wasabiFetch(`/d1/kb/${id}`, "PATCH", data));
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 25. TRIGGER
// ═══════════════════════════════════════════
server.tool(
  "wasabi_trigger",
  "Manually trigger an automation rule or flow. Useful for running scheduled tasks on-demand like 'run the weekly inventory check right now'.",
  {
    type: z.enum(["rule", "flow"]).describe("Whether to trigger a rule or a flow"),
    id: z.string().describe("Rule ID or Flow ID to trigger"),
    input: z.string().optional().describe("JSON string of input data to pass to the trigger"),
  },
  async ({ type, id, input: rawInput }) => {
    const input = parseJSON(rawInput);
    try {
      if (type === "rule") {
        const rule = await wasabiFetch(`/d1/rules/${id}`);
        await wasabiFetch("/d1/function-executions", "POST", {
          function_id: id, trigger: "manual_mcp", status: "running",
          input_data: JSON.stringify(input || {}),
        });
        return ok({ triggered: true, rule, note: "Rule trigger queued. Check function-executions for results." });
      }
      if (type === "flow") {
        const flow = await wasabiFetch(`/d1/flows/${id}`);
        const exec = await wasabiFetch("/d1/flow-executions", "POST", {
          flow_id: id, status: "running", trigger: "manual_mcp",
          started_at: new Date().toISOString(),
        });
        return ok({ triggered: true, flow_name: flow.name, execution: exec });
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 26. SCHEDULE
// ═══════════════════════════════════════════
server.tool(
  "wasabi_schedule",
  "Create or manage scheduled automation rules. Set up recurring tasks like daily inventory checks or weekly reports.",
  {
    action: z.enum(["list", "create", "update", "delete"]),
    id: z.string().optional().describe("Rule ID for update/delete"),
    data: z.string().optional().describe("JSON string of schedule rule data: name, trigger_type='schedule', trigger_config={cron:'...'}, action_config={instruction:'...'}, scope_table_id, enabled"),
  },
  async ({ action, id, data: rawData }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": return ok(await wasabiFetch("/d1/rules?trigger_type=schedule"));
        case "create": {
          const rule = { ...data, trigger_type: "schedule" };
          return ok(await wasabiFetch("/d1/rules", "POST", rule));
        }
        case "update": return ok(await wasabiFetch(`/d1/rules/${id}`, "PATCH", data));
        case "delete": return ok(await wasabiFetch(`/d1/rules/${id}`, "DELETE"));
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 27. GOOGLE (Gmail + Calendar)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_google",
  "Access Gmail and Google Calendar through Wasabi's Google OAuth connection. Search emails, read threads, send messages, list events, create events, check free/busy. Uses Wasabi's stored OAuth tokens.",
  {
    service: z.enum(["gmail", "calendar"]).describe("Google service to use"),
    action: z.string().describe("gmail: summary, search, read, send, draft, modify, thread | calendar: list, summary, events, create_event, update_event, delete_event, freebusy"),
    data: z.string().optional().describe("JSON string of action-specific params (e.g. {query:'from:vendor'} for gmail search, {timeMin:'...',timeMax:'...'} for calendar events)"),
    id: z.string().optional().describe("Message/event/thread/draft ID for read/update/delete actions"),
  },
  async ({ service, action, data: rawData, id }) => {
    const data = parseJSON(rawData) || {};
    try {
      if (service === "gmail") {
        switch (action) {
          case "summary": return ok(await wasabiFetch("/google/gmail/summary"));
          case "search": return ok(await wasabiFetch("/google/gmail/messages", "POST", data));
          case "read": return ok(await wasabiFetch(`/google/gmail/messages/${id}`));
          case "send": return ok(await wasabiFetch("/google/gmail/send", "POST", data));
          case "draft": return ok(await wasabiFetch("/google/gmail/drafts", "POST", data));
          case "modify": return ok(await wasabiFetch(`/google/gmail/modify/${id}`, "POST", data));
          case "thread": return ok(await wasabiFetch(`/google/gmail/threads/${id}`));
          default: return err(`Unknown gmail action: ${action}`);
        }
      }
      if (service === "calendar") {
        switch (action) {
          case "list": return ok(await wasabiFetch("/google/calendar/list"));
          case "summary": return ok(await wasabiFetch("/google/calendar/summary"));
          case "events": return ok(await wasabiFetch(`/google/calendar/events?${new URLSearchParams(data)}`));
          case "create_event": return ok(await wasabiFetch("/google/calendar/events", "POST", data));
          case "update_event": return ok(await wasabiFetch(`/google/calendar/events/${id}`, "PATCH", data));
          case "delete_event": return ok(await wasabiFetch(`/google/calendar/events/${id}`, "DELETE"));
          case "freebusy": return ok(await wasabiFetch("/google/calendar/freebusy", "POST", data));
          default: return err(`Unknown calendar action: ${action}`);
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 28. SYNC (Notion <> Wasabi)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_sync",
  "Manage Notion sync for tables. Configure bidirectional sync, push/pull changes, check sync status.",
  {
    action: z.enum(["configure", "push", "pull", "status", "delete", "flush"]),
    table_id: z.string().optional().describe("Table ID (required for configure/push/pull/status/delete)"),
    data: z.string().optional().describe("JSON string of sync config: notion_db_id, direction (push/pull/bidirectional), field_mapping"),
    full: z.boolean().optional().describe("Full resync for pull action (default: false)"),
  },
  async ({ action, table_id, data: rawData, full }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "configure": return ok(await wasabiFetch(`/sync/${table_id}/configure`, "POST", data));
        case "push": return ok(await wasabiFetch(`/sync/${table_id}/push`, "POST"));
        case "pull": return ok(await wasabiFetch(`/sync/${table_id}/pull${full ? "?full=1" : ""}`, "POST"));
        case "status": return ok(await wasabiFetch(`/sync/${table_id}/status`));
        case "delete": return ok(await wasabiFetch(`/sync/${table_id}`, "DELETE"));
        case "flush": return ok(await wasabiFetch("/sync/flush", "POST"));
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 29. RECORDS (notes, comments, badges)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_records",
  "Manage record-level details: notes, comments, badge counts, and view history. Richer than basic row CRUD.",
  {
    action: z.enum(["get_note", "set_note", "get_comments", "add_comment", "delete_comment", "badge_counts", "view_history", "record_view"]),
    record_id: z.string().optional().describe("Record ID"),
    page_id: z.string().optional().describe("Page config ID (for notes)"),
    data: z.string().optional().describe("JSON string of content/comment data"),
    record_ids: z.string().optional().describe("JSON string array of record IDs (for badge_counts)"),
    since: z.string().optional().describe("ISO date for view_history filter"),
  },
  async ({ action, record_id, page_id, data: rawData, record_ids: rawIds, since }) => {
    const data = parseJSON(rawData) || {};
    const record_ids = parseJSON(rawIds);
    try {
      switch (action) {
        case "get_note": return ok(await wasabiFetch(`/records/${record_id}/notes?page_config_id=${page_id}`));
        case "set_note": return ok(await wasabiFetch(`/records/${record_id}/notes`, "PUT", { content: data.content, page_config_id: page_id }));
        case "get_comments": return ok(await wasabiFetch(`/records/${record_id}/comments`));
        case "add_comment": return ok(await wasabiFetch(`/records/${record_id}/comments`, "POST", { content: data.content, user_id: data.user_id || "mcp", user_name: data.user_name || "Cowork MCP" }));
        case "delete_comment": return ok(await wasabiFetch(`/records/${record_id}/comments/${data.comment_id}`, "DELETE"));
        case "badge_counts": return ok(await wasabiFetch("/records/badge-counts", "POST", { record_ids }));
        case "view_history": {
          const qs = since ? `?since=${encodeURIComponent(since)}` : "";
          return ok(await wasabiFetch(`/record-views${qs}`));
        }
        case "record_view": return ok(await wasabiFetch(`/record-views/${record_id}`, "PUT"));
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// RESOURCE: Wasabi Schema & Data Model Docs
// ═══════════════════════════════════════════
server.resource(
  "wasabi-docs",
  "wasabi://docs/data-model",
  async () => ({
    contents: [{
      uri: "wasabi://docs/data-model",
      mimeType: "text/markdown",
      text: `# Wasabi Data Model & Schema Reference

## Page Types
- \`database\` — table with rows, columns, views (most common)
- \`document\` — rich text page (stored in R2)
- \`page\` — generic container
- \`dashboard\` — widget grid

## View Types (14 total)
\`table\` \`kanban\` \`gantt\` \`calendar\` \`cardGrid\` \`charts\` \`form\` \`summaryTiles\` \`activityFeed\` \`document\` \`notificationFeed\` \`linked_sheet\` \`customView\`

### View Config Examples
\`\`\`json
// Kanban view
{ "type": "kanban", "label": "By Status", "config": { "groupByField": "Status", "cardFields": ["Title", "Priority", "Due Date"] } }

// Gantt view
{ "type": "gantt", "label": "Timeline", "config": { "startField": "Start Date", "endField": "End Date", "taskField": "Title" } }

// Chart view
{ "type": "charts", "label": "Spend Chart", "config": { "chartType": "bar", "xAxis": "Vendor", "yAxis": "Cost", "aggregation": "sum" } }

// Custom view (renders a custom function)
{ "type": "customView", "label": "Pomodoro Timer", "config": { "functionId": "fn_abc123" } }
\`\`\`

## Column Types (15 total)
\`text\` \`rich_text\` \`title\` \`number\` \`select\` \`multi_select\` \`date\` \`checkbox\` \`url\` \`email\` \`phone_number\` \`status\` \`people\` \`relation\` \`created_time\` \`last_edited_time\`

### Column Definition
\`\`\`json
{ "id": "col_1", "name": "Status", "type": "select", "options": [{ "label": "Active", "color": "#4CAF50" }, { "label": "Done", "color": "#9E9E9E" }] }
\`\`\`

## Dashboard Widget Types
\`view\` \`shortcut\` \`text\` \`plugin\`

### Widget Examples
\`\`\`json
// Embed a database view as a widget
{ "id": "w_1", "type": "view", "pageId": "page_abc", "viewIndex": 0, "label": "Projects Kanban", "h": 400, "colSpan": 2 }

// Plugin widget (renders custom function in iframe)
{ "id": "w_2", "type": "plugin", "functionId": "fn_pomodoro", "label": "Pomodoro Timer", "h": 300, "colSpan": 1, "refreshInterval": 0 }

// Text/markdown widget
{ "id": "w_3", "type": "text", "content": "## Welcome\\nDaily standup at 9am", "label": "Notes", "h": 200 }

// Shortcut button
{ "id": "w_4", "type": "shortcut", "pageId": "page_xyz", "label": "Open Inventory", "h": 80 }
\`\`\`

## Custom Function Schema
Types: \`transform\` \`aggregation\` \`forecast\` \`alert\` \`pipeline\` \`view\` \`plugin\`

### Creating a Plugin (e.g. Pomodoro Timer)
\`\`\`json
{
  "name": "Pomodoro Timer",
  "description": "Animated 25-min focus timer with break intervals",
  "type": "plugin",
  "status": "active",
  "inputs": {},
  "outputs": {},
  "code": "<div id='timer'>25:00</div><style>#timer{font-size:4em;text-align:center;font-family:monospace;color:var(--text)}</style><script>let s=1500,i=setInterval(()=>{if(s<=0)clearInterval(i);document.getElementById('timer').textContent=Math.floor(s/60)+':'+(s%60+'').padStart(2,'0');s--},1000)</script>",
  "meta": { "manifest": { "name": "Pomodoro Timer", "icon": "⏱️", "version": "1.0" } }
}
\`\`\`

### Creating a Custom View Function
\`\`\`json
{
  "name": "Heat Map View",
  "type": "view",
  "status": "active",
  "code": "<!-- HTML/CSS/JS that renders a custom visualization -->",
  "inputs": { "tableId": { "type": "string" } },
  "outputs": { "html": { "type": "string" } }
}
\`\`\`

## Automation Rules
Trigger types: \`schedule\` \`status_change\` \`field_change\` \`page_created\` \`manual\`

### Rule Examples
\`\`\`json
// Daily inventory check
{
  "name": "Daily Inventory Alert",
  "trigger_type": "schedule",
  "trigger_config": { "cron": "0 9 * * 1-5" },
  "action_config": { "instruction": "Check all SKUs where OR Site Inventory < 1000 and create a notification for each" },
  "scope_table_id": "inventory_page_id",
  "enabled": true
}

// Status change trigger
{
  "name": "Notify on Complete",
  "trigger_type": "status_change",
  "trigger_config": { "field_name": "Status", "new_value": "Complete" },
  "action_config": { "instruction": "Send notification: {{Title}} has been marked complete" },
  "scope_table_id": "projects_page_id"
}
\`\`\`

## Automation Flows (multi-step)
\`\`\`json
{
  "name": "New Order Pipeline",
  "flow_data": {
    "nodes": [
      { "id": "n1", "type": "trigger", "config": { "trigger_type": "page_created" } },
      { "id": "n2", "type": "action", "config": { "instruction": "Validate order fields" } },
      { "id": "n3", "type": "condition", "config": { "field": "Priority", "operator": "eq", "value": "High" } },
      { "id": "n4", "type": "action", "config": { "instruction": "Send urgent notification" } }
    ],
    "edges": [
      { "source": "n1", "target": "n2" },
      { "source": "n2", "target": "n3" },
      { "source": "n3", "target": "n4" }
    ]
  }
}
\`\`\`

## Neurons (relationship clusters)
\`\`\`json
// Create a neuron linking a vendor, their SKUs, and production records
{
  "name": "Vendor → SKU → Production",
  "nodes": [
    { "node_type": "record", "node_id": "row_vendor1", "node_label": "Acme Corp", "page_config_id": "vendors_page" },
    { "node_type": "record", "node_id": "row_sku1", "node_label": "TIN-100S", "page_config_id": "inventory_page" },
    { "node_type": "field", "node_id": "Status", "node_label": "Production Status", "page_config_id": "projects_page" }
  ]
}
\`\`\`
Node types: \`record\` \`page\` \`field\` \`table\`

## Workflow: Building a Custom Plugin Widget
1. \`wasabi_functions\` create — type "plugin", code with HTML/CSS/JS
2. \`wasabi_pages\` update — add a customView to the page's views array (or skip if dashboard-only)
3. Read current dashboard: \`wasabi_data\` won't work here — use the dashboard endpoint
4. Pin to dashboard: add a widget with type "plugin", functionId pointing to the function

## Workflow: Creating a New Database with Views
1. \`wasabi_pages\` create — page_type "database", include columns array
2. \`wasabi_pages\` update — add views to config (kanban, gantt, etc.)
3. \`wasabi_data\` create — add initial rows
4. Optionally \`wasabi_sync\` configure — link to Notion database

## Key IDs
- Page IDs look like: \`pg_abc123\` or UUIDs
- Row IDs look like: UUIDs
- Function IDs look like: \`fn_abc123\`
- Column IDs look like: \`col_abc123\`
`,
    }],
  })
);

// ═══════════════════════════════════════════
// RESOURCE: Workspace overview
// ═══════════════════════════════════════════
server.resource(
  "workspace-overview",
  "wasabi://workspace",
  async () => {
    try {
      const [health, pages] = await Promise.all([
        wasabiFetch("/health").catch(() => ({ status: "unreachable" })),
        wasabiFetch("/pages").catch(() => []),
      ]);
      const summary = {
        health,
        pages: (Array.isArray(pages) ? pages : []).map((p) => ({
          id: p.id,
          name: p.name,
          type: p.page_type || p.pageType,
          views: (p.views || []).map((v) => v.type || v.label),
        })),
      };
      return {
        contents: [{
          uri: "wasabi://workspace",
          text: JSON.stringify(summary, null, 2),
          mimeType: "application/json",
        }],
      };
    } catch (e) {
      return { contents: [{ uri: "wasabi://workspace", text: JSON.stringify({ error: String(e) }), mimeType: "application/json" }] };
    }
  }
);

// ── Start ──
const transport = new StdioServerTransport();
await server.connect(transport);
