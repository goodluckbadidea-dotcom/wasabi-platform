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
