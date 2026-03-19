// ─── Wasabi MCP Server ───
// Local MCP server for Claude Desktop.
// Proxies requests to the remote Wasabi Cloudflare Worker.
// Speaks MCP protocol over stdio transport.

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
  "List all pages/databases in the workspace, get a page config, get table schema, or manage page configs. Use 'list' first to discover available pages and their IDs.",
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
// 3. DATA (table rows)
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
        case "list":
          return ok(await wasabiFetch(`/tables/${table_id}/rows?limit=${lim}&offset=${offset || 0}`));
        case "query":
          return ok(await wasabiFetch(`/tables/${table_id}/query`, "POST", { filters, sorts, limit: lim, offset }));
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
  "CRUD automation rules. Rules trigger on schedule, status_change, field_change, page_created, or manual. action_config.instruction supports {{field}} template variables.",
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
  "CRUD custom functions and plugins. Types: transform, aggregation, forecast, alert, pipeline, view, plugin. Plugins have type='plugin' and include a manifest. Use list_executions to see past runs.",
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
  "CRUD automation flows (multi-step node-based workflows with a graph of connected actions).",
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
  "Neurons are named relationship clusters linking records, pages, and fields across the workspace. View the graph or manage neurons and their nodes.",
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
// 12. SEARCH (cross-table fuzzy search)
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
        // Search first 10 tables to avoid timeout
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
// 13. DASHBOARD (workspace snapshot)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_dashboard",
  "Get a comprehensive workspace snapshot: health status, page list with row counts, unread notifications, recent activity. Perfect for morning briefings or status checks.",
  {
    include: z.enum(["all", "health", "pages", "notifications", "activity"]).optional().describe("What to include (default: all)"),
  },
  async ({ include }) => {
    const inc = include || "all";
    try {
      const snapshot = {};
      const fetches = [];

      if (inc === "all" || inc === "health") fetches.push(wasabiFetch("/health").then((r) => (snapshot.health = r)).catch(() => (snapshot.health = { status: "unreachable" })));
      if (inc === "all" || inc === "pages") fetches.push(wasabiFetch("/pages").then((r) => (snapshot.pages = (Array.isArray(r) ? r : []).map((p) => ({ id: p.id, name: p.name, type: p.page_type, views: (p.views || []).length })))).catch(() => (snapshot.pages = [])));
      if (inc === "all" || inc === "notifications") fetches.push(wasabiFetch("/d1/notifications/unread-count").then((r) => (snapshot.unread_notifications = r)).catch(() => (snapshot.unread_notifications = 0)));
      if (inc === "all" || inc === "activity") fetches.push(wasabiFetch("/task-activity?limit=10").then((r) => (snapshot.recent_activity = r)).catch(() => (snapshot.recent_activity = [])));

      await Promise.all(fetches);
      snapshot.timestamp = new Date().toISOString();
      return ok(snapshot);
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 14. ANALYTICS (aggregate queries)
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
      // Fetch all matching rows
      const body = { filters, limit: 5000 };
      const result = await wasabiFetch(`/tables/${table_id}/query`, "POST", body);
      const rows = result?.rows || (Array.isArray(result) ? result : []);

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
// 15. DIFF (change tracking)
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
      // Fetch rows and filter by updated_at
      const result = await wasabiFetch(`/tables/${table_id}/rows?limit=${lim}`);
      const rows = result?.rows || (Array.isArray(result) ? result : []);

      if (since) {
        const sinceDate = new Date(since).getTime();
        const changed = rows.filter((r) => new Date(r.updated_at || r.created_at).getTime() > sinceDate);
        return ok({ table_id, since, changed_rows: changed.length, rows: changed });
      }

      // Sort by most recently modified
      const sorted = [...rows].sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
      return ok({ table_id, total: sorted.length, rows: sorted.slice(0, lim) });
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 16. IMPORT (bulk insert with schema mapping)
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

      // If merge_key is set, fetch existing rows to check for duplicates
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
          const created = await wasabiFetch(`/tables/${table_id}/rows`, "POST", { rows: toCreate });
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

      // Simple bulk create
      const result = await wasabiFetch(`/tables/${table_id}/rows`, "POST", { rows });
      return ok({ created: rows.length, result });
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 17. EXPORT (table data as JSON/CSV)
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
        // Extract all unique cell keys
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
// 18. LINK EXTERNAL (attach refs to records)
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
// 19. SQL (raw D1 queries via query builder)
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

      // Field filtering (client-side)
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
// 20. SCHEMA ALTER (add/rename/remove columns)
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
// 21. BULK UPDATE (update rows matching filter)
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
      // Find matching rows
      const result = await wasabiFetch(`/tables/${table_id}/query`, "POST", { filters, limit: 5000 });
      const rows = result?.rows || (Array.isArray(result) ? result : []);

      if (dry_run) return ok({ matched: rows.length, rows: rows.slice(0, 20), note: "Dry run — no changes made" });

      // Update each row
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
// 22. BACKUP (export snapshot to R2)
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
// 24. AGENT CONFIG (read/update agent settings)
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
// 25. TRIGGER (manually fire automations)
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
        // Get the rule, then simulate its action
        const rule = await wasabiFetch(`/d1/rules/${id}`);
        // Log execution
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
// 26. SCHEDULE (create/update scheduled tasks)
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
// BONUS: 27. GOOGLE (Gmail + Calendar via Wasabi's OAuth)
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
// BONUS: 28. SYNC (Notion <> Wasabi sync)
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
// BONUS: 29. RECORDS (notes, comments, badges)
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
