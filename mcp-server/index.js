// ─── Wasabi MCP Server ───
// Local MCP server for Claude Desktop (Cowork).
// Proxies requests to the remote Wasabi Cloudflare Worker.
// Speaks MCP protocol over stdio transport.
//
// TOOL USAGE PLAYBOOK (for the AI reading these descriptions):
// 1. Start with wasabi_context — single call that returns every page (with schema +
//    row count + view types), KB summary, integration status, recent activity, users.
//    This is your grounding snapshot. Use wasabi_dashboard if you only want a quick
//    health/notification check.
// 2. Use wasabi_data to read rows. Pages with sub-items: pass parent_row_id="null"
//    for top-level rows, or a specific row id to list its children.
// 3. Use wasabi_search for keyword search across pages + rows + KB.
// 4. Use wasabi_record_context for a record + comments + note + files + sub-items
//    in a single call.
// 5. Use wasabi_analytics for aggregations (count, sum, group_by).
//
// CONFIRMATION GATE: every write/delete tool requires confirm: true. Without it the
// tool returns a "pending_confirmation" envelope describing the planned action.
// Surface that envelope to the user, get their explicit approval, then re-call with
// confirm: true. Do not skip this step — it exists to protect user data.

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

// Unwrap common worker response shapes. The /pages, /tables/:id/rows, /d1/notifications,
// /users, etc. endpoints return { pages: [...] } / { rows: [...] } / { users: [...] }
// rather than bare arrays. Earlier MCP code assumed raw arrays and silently produced empty
// results. This helper normalizes both shapes.
function unwrap(res, key) {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res[key])) return res[key];
  return [];
}

// Confirmation gate for destructive / mutating actions. The MCP client (the AI) must
// re-invoke the tool with `confirm: true` after surfacing the planned action to the user.
// Returns a pending-confirmation envelope when not confirmed; null when the caller may
// proceed. Keep the message AI-readable — it explicitly instructs the model to surface
// the intent to its operator before retrying.
const CONFIRM_MESSAGE =
  "This action modifies workspace data. Show the planned action to the user, " +
  "wait for explicit approval, then re-call the same tool with confirm: true to execute.";

function gate(confirm, intended) {
  if (confirm === true) return null;
  return ok({
    pending_confirmation: true,
    intended_action: intended,
    message: CONFIRM_MESSAGE,
  });
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
  version: "2.0.0",
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
  "List all pages/databases in the workspace, get a page config, get table schema, or manage page configs. Use 'list' first to discover available pages and their IDs. Pages have fields: id, title, page_type (database|document|page|dashboard), parent_id, icon, config.views[]. To CREATE a database: provide title, page_type='database', columns array with {id, name, type} objects. To ADD VIEWS: update the page config with config.views array containing {type, label, config} objects. View types: table, kanban, gantt, calendar, cardGrid, charts, form, summaryTiles, activityFeed, customView. create/update/delete require confirm: true.",
  {
    action: z.enum(["list", "get", "get_schema", "create", "update", "delete"]),
    id: z.string().optional().describe("Page ID (required for get/get_schema/update/delete)"),
    data: z.string().optional().describe("JSON string of page config data for create/update"),
    confirm: z.boolean().optional().describe("Required true for create/update/delete (destructive)."),
  },
  async ({ action, id, data: rawData, confirm }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": return ok(await wasabiFetch("/pages"));
        case "get": return ok(await wasabiFetch(`/pages/${id}`));
        case "get_schema": return ok(await wasabiFetch(`/pages/${id}/schema`));
        case "create": {
          const g = gate(confirm, { method: "POST", path: "/pages", payload: data });
          if (g) return g;
          return ok(await wasabiFetch("/pages", "POST", data));
        }
        case "update": {
          const g = gate(confirm, { method: "PATCH", path: `/pages/${id}`, payload: data });
          if (g) return g;
          return ok(await wasabiFetch(`/pages/${id}`, "PATCH", data));
        }
        case "delete": {
          const g = gate(confirm, { method: "DELETE", path: `/pages/${id}`, note: "Page and its data will be deleted." });
          if (g) return g;
          return ok(await wasabiFetch(`/pages/${id}`, "DELETE"));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 3. DATA (table rows) — with auto-sync
// ═══════════════════════════════════════════
server.tool(
  "wasabi_data",
  "Query, create, update, and delete table rows. Use wasabi_pages or wasabi_context first to find table IDs. Rows have shape { id, table_id, cells: {...}, parent_row_id, sort_order, created_at, updated_at }. PARENT/CHILD HIERARCHY: rows with parent_row_id set are sub-items. Use parent_row_id='null' to list only top-level rows, or a specific row id to list its children. create/update/delete require confirm: true.",
  {
    action: z.enum(["list", "query", "create", "update", "delete"]),
    table_id: z.string().describe("The table/database ID"),
    row_id: z.string().optional().describe("Row ID (for update/delete)"),
    parent_row_id: z.string().optional().describe("For list: 'null' to list top-level rows only, or a specific row id to list that row's sub-items. Omit to list all rows (mixed)."),
    filters: z.string().optional().describe("JSON string of filter object for query action"),
    sorts: z.string().optional().describe("JSON string of sort array for query action"),
    limit: z.number().optional().describe("Max rows to return (default 100)"),
    offset: z.number().optional().describe("Pagination offset"),
    rows: z.string().optional().describe("JSON string of array of row objects for create"),
    data: z.string().optional().describe("JSON string of row data for update (cells object)"),
    confirm: z.boolean().optional().describe("Required true for create/update/delete (destructive)."),
  },
  async ({ action, table_id, row_id, parent_row_id, filters: rawFilters, sorts: rawSorts, limit, offset, rows: rawRows, data: rawData, confirm }) => {
    const filters = parseJSON(rawFilters);
    const sorts = parseJSON(rawSorts);
    const rows = parseJSON(rawRows);
    const data = parseJSON(rawData);
    try {
      const lim = limit || 100;
      switch (action) {
        case "list": {
          const params = new URLSearchParams();
          params.set("limit", String(lim));
          params.set("offset", String(offset || 0));
          if (parent_row_id !== undefined && parent_row_id !== null) params.set("parent_row_id", parent_row_id);
          let result = await wasabiFetch(`/tables/${table_id}/rows?${params}`);
          let rowArr = unwrap(result, "rows");
          if (rowArr.length === 0) {
            const syncInfo = await ensureSynced(table_id);
            if (syncInfo?.auto_synced) {
              result = await wasabiFetch(`/tables/${table_id}/rows?${params}`);
              rowArr = unwrap(result, "rows");
              return ok({ ...result, rows: rowArr, _auto_synced: true, _sync_result: syncInfo.pull_result });
            }
          }
          return ok(result);
        }
        case "query": {
          let result = await wasabiFetch(`/tables/${table_id}/query`, "POST", { filters, sorts, limit: lim, offset });
          let rowArr = unwrap(result, "rows");
          if (rowArr.length === 0) {
            const syncInfo = await ensureSynced(table_id);
            if (syncInfo?.auto_synced) {
              result = await wasabiFetch(`/tables/${table_id}/query`, "POST", { filters, sorts, limit: lim, offset });
              return ok({ ...(typeof result === 'object' ? result : { rows: result }), _auto_synced: true });
            }
          }
          return ok(result);
        }
        case "create": {
          const g = gate(confirm, { method: "POST", path: `/tables/${table_id}/rows`, row_count: Array.isArray(rows) ? rows.length : 0, sample: Array.isArray(rows) ? rows[0] : null });
          if (g) return g;
          return ok(await wasabiFetch(`/tables/${table_id}/rows`, "POST", { rows }));
        }
        case "update": {
          const g = gate(confirm, { method: "PATCH", path: `/tables/${table_id}/rows/${row_id}`, payload: data });
          if (g) return g;
          return ok(await wasabiFetch(`/tables/${table_id}/rows/${row_id}`, "PATCH", data));
        }
        case "delete": {
          const g = gate(confirm, { method: "DELETE", path: `/tables/${table_id}/rows/${row_id}`, note: "Row will be archived/deleted." });
          if (g) return g;
          return ok(await wasabiFetch(`/tables/${table_id}/rows/${row_id}`, "DELETE"));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 4. AUTOMATIONS
// ═══════════════════════════════════════════
server.tool(
  "wasabi_automations",
  "CRUD automation rules. Trigger types: schedule (cron), status_change, field_change, page_created, manual. action_config.instruction is an AI prompt that supports {{field}} template variables. Read wasabi://docs/data-model for full rule schema. create/update/delete require confirm: true.",
  {
    action: z.enum(["list", "get", "create", "update", "delete"]),
    id: z.string().optional().describe("Rule ID"),
    data: z.string().optional().describe("JSON string of rule data: name, description, trigger_type, trigger_config, action_config, enabled, scope_table_id"),
    enabled: z.boolean().optional().describe("Filter by enabled status for list"),
    confirm: z.boolean().optional().describe("Required true for create/update/delete."),
  },
  async ({ action, id, data: rawData, enabled, confirm }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": {
          const qs = enabled != null ? `?enabled=${enabled}` : "";
          return ok(await wasabiFetch(`/d1/rules${qs}`));
        }
        case "get": return ok(await wasabiFetch(`/d1/rules/${id}`));
        case "create": {
          const g = gate(confirm, { method: "POST", path: "/d1/rules", payload: data });
          if (g) return g;
          return ok(await wasabiFetch("/d1/rules", "POST", data));
        }
        case "update": {
          const g = gate(confirm, { method: "PATCH", path: `/d1/rules/${id}`, payload: data });
          if (g) return g;
          return ok(await wasabiFetch(`/d1/rules/${id}`, "PATCH", data));
        }
        case "delete": {
          const g = gate(confirm, { method: "DELETE", path: `/d1/rules/${id}` });
          if (g) return g;
          return ok(await wasabiFetch(`/d1/rules/${id}`, "DELETE"));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 5. CUSTOM FUNCTIONS
// ═══════════════════════════════════════════
server.tool(
  "wasabi_functions",
  "CRUD custom functions and plugins. Types: transform, aggregation, forecast, alert, pipeline, view, plugin. Plugins have type='plugin' and include a manifest. Use list_executions to see past runs. Read wasabi://docs/data-model resource for full schema and examples. create/update/delete require confirm: true.",
  {
    action: z.enum(["list", "get", "create", "update", "delete", "list_executions"]),
    id: z.string().optional().describe("Function ID"),
    data: z.string().optional().describe("JSON string of function data: name, description, type, inputs, outputs, code, status, meta, manifest"),
    status: z.string().optional().describe("Filter by status: draft, active, disabled"),
    type: z.string().optional().describe("Filter by type: transform, plugin, etc."),
    limit: z.number().optional().describe("Limit for list_executions"),
    confirm: z.boolean().optional().describe("Required true for create/update/delete."),
  },
  async ({ action, id, data: rawData, status, type, limit, confirm }) => {
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
        case "create": {
          const g = gate(confirm, { method: "POST", path: "/d1/custom-functions", payload: data });
          if (g) return g;
          return ok(await wasabiFetch("/d1/custom-functions", "POST", data));
        }
        case "update": {
          const g = gate(confirm, { method: "PATCH", path: `/d1/custom-functions/${id}`, payload: data });
          if (g) return g;
          return ok(await wasabiFetch(`/d1/custom-functions/${id}`, "PATCH", data));
        }
        case "delete": {
          const g = gate(confirm, { method: "DELETE", path: `/d1/custom-functions/${id}` });
          if (g) return g;
          return ok(await wasabiFetch(`/d1/custom-functions/${id}`, "DELETE"));
        }
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
  "CRUD automation flows (multi-step node-based workflows). Flow graph has nodes [{id, type, config}] and edges [{source, target}]. Node types: trigger, action, condition, delay. Read wasabi://docs/data-model for flow schema examples. create/update/delete require confirm: true.",
  {
    action: z.enum(["list", "get", "create", "update", "delete", "list_executions"]),
    id: z.string().optional().describe("Flow ID"),
    data: z.string().optional().describe("JSON string of flow data: name, description, graph, enabled"),
    enabled: z.boolean().optional().describe("Filter by enabled for list"),
    limit: z.number().optional(),
    confirm: z.boolean().optional().describe("Required true for create/update/delete."),
  },
  async ({ action, id, data: rawData, enabled, limit, confirm }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": {
          const qs = enabled != null ? `?enabled=${enabled}` : "";
          return ok(await wasabiFetch(`/d1/flows${qs}`));
        }
        case "get": return ok(await wasabiFetch(`/d1/flows/${id}`));
        case "create": {
          const g = gate(confirm, { method: "POST", path: "/d1/flows", payload: data });
          if (g) return g;
          return ok(await wasabiFetch("/d1/flows", "POST", data));
        }
        case "update": {
          const g = gate(confirm, { method: "PATCH", path: `/d1/flows/${id}`, payload: data });
          if (g) return g;
          return ok(await wasabiFetch(`/d1/flows/${id}`, "PATCH", data));
        }
        case "delete": {
          const g = gate(confirm, { method: "DELETE", path: `/d1/flows/${id}` });
          if (g) return g;
          return ok(await wasabiFetch(`/d1/flows/${id}`, "DELETE"));
        }
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
  "CRUD knowledge base entries. KB entries shape future AI agent responses by providing business context, rules, and domain knowledge. create/update/delete require confirm: true.",
  {
    action: z.enum(["list", "get", "create", "update", "delete", "search"]),
    id: z.string().optional().describe("KB entry ID"),
    data: z.string().optional().describe("JSON string of KB data: key, category, content, source, related_pages"),
    category: z.string().optional().describe("Filter by category for list"),
    query: z.string().optional().describe("Search query for search action"),
    confirm: z.boolean().optional().describe("Required true for create/update/delete."),
  },
  async ({ action, id, data: rawData, category, query, confirm }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": {
          const qs = category ? `?category=${encodeURIComponent(category)}` : "";
          return ok(await wasabiFetch(`/d1/kb${qs}`));
        }
        case "get": return ok(await wasabiFetch(`/d1/kb/${id}`));
        case "create": {
          const g = gate(confirm, { method: "POST", path: "/d1/kb", payload: data });
          if (g) return g;
          return ok(await wasabiFetch("/d1/kb", "POST", data));
        }
        case "update": {
          const g = gate(confirm, { method: "PATCH", path: `/d1/kb/${id}`, payload: data });
          if (g) return g;
          return ok(await wasabiFetch(`/d1/kb/${id}`, "PATCH", data));
        }
        case "delete": {
          const g = gate(confirm, { method: "DELETE", path: `/d1/kb/${id}` });
          if (g) return g;
          return ok(await wasabiFetch(`/d1/kb/${id}`, "DELETE"));
        }
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
  "List, create, and manage notifications. Check unread count or mark all as read. create/update/delete/mark_all_read require confirm: true.",
  {
    action: z.enum(["list", "create", "update", "delete", "mark_all_read", "unread_count"]),
    id: z.string().optional().describe("Notification ID"),
    data: z.string().optional().describe("JSON string of notification data: message, type, source, record_id, target_user_id"),
    status: z.string().optional().describe("Filter: unread, read"),
    target_user_id: z.string().optional().describe("Filter notifications by recipient user id (default: workspace-wide; pass 'me' for current user)"),
    limit: z.number().optional(),
    confirm: z.boolean().optional().describe("Required true for create/update/delete/mark_all_read."),
  },
  async ({ action, id, data: rawData, status, target_user_id, limit, confirm }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": {
          const params = new URLSearchParams();
          if (status) params.set("status", status);
          if (limit) params.set("limit", String(limit));
          if (target_user_id) params.set("target_user_id", target_user_id);
          return ok(await wasabiFetch(`/d1/notifications?${params}`));
        }
        case "create": {
          const g = gate(confirm, { method: "POST", path: "/d1/notifications", payload: data });
          if (g) return g;
          return ok(await wasabiFetch("/d1/notifications", "POST", data));
        }
        case "update": {
          const g = gate(confirm, { method: "PATCH", path: `/d1/notifications/${id}`, payload: data });
          if (g) return g;
          return ok(await wasabiFetch(`/d1/notifications/${id}`, "PATCH", data));
        }
        case "delete": {
          const g = gate(confirm, { method: "DELETE", path: `/d1/notifications/${id}` });
          if (g) return g;
          return ok(await wasabiFetch(`/d1/notifications/${id}`, "DELETE"));
        }
        case "mark_all_read": {
          const g = gate(confirm, { method: "POST", path: "/d1/notifications/mark-all-read", note: "Marks ALL notifications as read." });
          if (g) return g;
          return ok(await wasabiFetch("/d1/notifications/mark-all-read", "POST"));
        }
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
  "Neurons are named relationship clusters linking records, pages, and fields across the workspace. Each node has node_type (record|page|field|table), node_id, node_label, page_config_id. Use 'graph' for the full relationship map and 'by_node' to find all neurons containing a specific record/field. create/delete/add_node/remove_node require confirm: true.",
  {
    action: z.enum(["list", "get", "create", "delete", "graph", "add_node", "remove_node", "by_node"]),
    id: z.string().optional().describe("Neuron ID"),
    node_id: z.string().optional().describe("Node ID (for remove_node/by_node)"),
    data: z.string().optional().describe("JSON string of neuron data: name, nodes (for create); node details (for add_node)"),
    confirm: z.boolean().optional().describe("Required true for create/delete/add_node/remove_node."),
  },
  async ({ action, id, node_id, data: rawData, confirm }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": return ok(await wasabiFetch("/neurons"));
        case "get": return ok(await wasabiFetch(`/neurons/${id}`));
        case "graph": return ok(await wasabiFetch("/neurons/graph"));
        case "by_node": return ok(await wasabiFetch(`/neurons/by-node/${node_id}`));
        case "create": {
          const g = gate(confirm, { method: "POST", path: "/neurons", payload: data });
          if (g) return g;
          return ok(await wasabiFetch("/neurons", "POST", data));
        }
        case "delete": {
          const g = gate(confirm, { method: "DELETE", path: `/neurons/${id}` });
          if (g) return g;
          return ok(await wasabiFetch(`/neurons/${id}`, "DELETE"));
        }
        case "add_node": {
          const g = gate(confirm, { method: "POST", path: `/neurons/${id}/nodes`, payload: data });
          if (g) return g;
          return ok(await wasabiFetch(`/neurons/${id}/nodes`, "POST", data));
        }
        case "remove_node": {
          const g = gate(confirm, { method: "DELETE", path: `/neurons/${id}/nodes/${node_id}` });
          if (g) return g;
          return ok(await wasabiFetch(`/neurons/${id}/nodes/${node_id}`, "DELETE"));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 10. USERS
// ═══════════════════════════════════════════
server.tool(
  "wasabi_users",
  "List workspace users, check current user, invite new users, update roles, or delete users. Admin only for invite/update/delete. invite/update/delete require confirm: true (account-management operations).",
  {
    action: z.enum(["list", "get_me", "directory", "invite", "update", "delete"]),
    id: z.string().optional().describe("User ID (for update/delete)"),
    data: z.string().optional().describe("JSON string of user data: display_name + role for invite; role for update"),
    confirm: z.boolean().optional().describe("Required true for invite/update/delete."),
  },
  async ({ action, id, data: rawData, confirm }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": return ok(await wasabiFetch("/users"));
        case "directory": return ok(await wasabiFetch("/users/directory"));
        case "get_me": return ok(await wasabiFetch("/auth/me"));
        case "invite": {
          const g = gate(confirm, { method: "POST", path: "/users/invite", payload: data, note: "Creates an invite code. Account creation requires the invitee to register." });
          if (g) return g;
          return ok(await wasabiFetch("/users/invite", "POST", data));
        }
        case "update": {
          const g = gate(confirm, { method: "PATCH", path: `/users/${id}`, payload: data });
          if (g) return g;
          return ok(await wasabiFetch(`/users/${id}`, "PATCH", data));
        }
        case "delete": {
          const g = gate(confirm, { method: "DELETE", path: `/users/${id}`, note: "Soft-deletes the user account." });
          if (g) return g;
          return ok(await wasabiFetch(`/users/${id}`, "DELETE"));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 11. FILES
// ═══════════════════════════════════════════
server.tool(
  "wasabi_files",
  "List or delete files stored in R2. Upload is not supported via MCP (use the web UI). Filter by page_id or record_id. delete requires confirm: true.",
  {
    action: z.enum(["list", "get_url", "delete"]),
    id: z.string().optional().describe("File ID (for get_url/delete)"),
    page_id: z.string().optional().describe("Filter files by page"),
    record_id: z.string().optional().describe("Filter files by record"),
    confirm: z.boolean().optional().describe("Required true for delete."),
  },
  async ({ action, id, page_id, record_id, confirm }) => {
    try {
      switch (action) {
        case "list": {
          const params = new URLSearchParams();
          if (page_id) params.set("page_id", page_id);
          if (record_id) params.set("record_id", record_id);
          return ok(await wasabiFetch(`/files?${params}`));
        }
        case "get_url": return ok(await wasabiFetch(`/files/${id}`));
        case "delete": {
          const g = gate(confirm, { method: "DELETE", path: `/files/${id}`, note: "File removed from R2 storage." });
          if (g) return g;
          return ok(await wasabiFetch(`/files/${id}`, "DELETE"));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 12. SEARCH
// ═══════════════════════════════════════════
server.tool(
  "wasabi_search",
  "Search across ALL tables, pages, and knowledge base in one call. Finds records by keyword across the entire workspace. Returns: { pages: matched page titles, knowledge_base: matched KB entries, table_rows: [{ page_id, page_title, rows: [...] }] }. Row matching is server-side via the /search endpoint when available, else client-side substring match against cell values.",
  {
    query: z.string().describe("Search keyword or phrase"),
    scope: z.enum(["all", "tables", "kb", "pages"]).optional().describe("Limit search scope (default: all)"),
    limit: z.number().optional().describe("Max results per table (default 10)"),
    max_tables: z.number().optional().describe("Max tables to scan for row matches (default 50)"),
  },
  async ({ query, scope, limit, max_tables }) => {
    const lim = limit || 10;
    const maxTables = max_tables || 50;
    const s = scope || "all";
    const q = (query || "").toLowerCase();
    try {
      const results = {};

      // Fetch pages once and reuse across scopes
      const pagesRes = await wasabiFetch("/pages").catch(() => ({ pages: [] }));
      const allPages = unwrap(pagesRes, "pages");

      // Match pages by title
      if (s === "all" || s === "pages") {
        const matched = allPages.filter((p) => (p.title || "").toLowerCase().includes(q));
        if (matched.length) {
          results.pages = matched.map((p) => ({ id: p.id, title: p.title, page_type: p.page_type, parent_id: p.parent_id || null }));
        }
      }

      // Match KB entries (worker /d1/kb/search returns { results: [...] } or array)
      if (s === "all" || s === "kb") {
        const kbRes = await wasabiFetch("/d1/kb/search", "POST", { query }).catch(() => ({ results: [] }));
        const kbList = Array.isArray(kbRes) ? kbRes : (kbRes?.results || kbRes?.entries || []);
        if (kbList.length) results.knowledge_base = kbList.slice(0, lim);
      }

      // Match table rows — client-side substring scan against cell values.
      // (Worker /search is a Notion proxy, not a workspace search.)
      if (s === "all" || s === "tables") {
        const tables = allPages.filter((p) => p.page_type === "database");
        const tableResults = [];
        for (const page of tables.slice(0, maxTables)) {
          try {
            const rowsRes = await wasabiFetch(`/tables/${page.id}/rows?limit=1000`);
            const rowArr = unwrap(rowsRes, "rows");
            const matched = rowArr.filter((r) => {
              const cells = r.cells || {};
              for (const k of Object.keys(cells)) {
                const v = cells[k];
                if (v == null) continue;
                if (typeof v === "string" && v.toLowerCase().includes(q)) return true;
                if (Array.isArray(v) && v.some((x) => String(x).toLowerCase().includes(q))) return true;
                if (typeof v === "object" && JSON.stringify(v).toLowerCase().includes(q)) return true;
                if (String(v).toLowerCase().includes(q)) return true;
              }
              return false;
            }).slice(0, lim);
            if (matched.length) {
              tableResults.push({ page_id: page.id, page_title: page.title, page_type: page.page_type, rows: matched });
            }
          } catch { /* skip tables that error */ }
        }
        if (tableResults.length) results.table_rows = tableResults;
      }

      return ok({
        query,
        scope: s,
        ...results,
        _summary: {
          pages_matched: results.pages?.length || 0,
          kb_matched: results.knowledge_base?.length || 0,
          tables_with_matches: Array.isArray(results.table_rows) ? results.table_rows.length : 0,
        },
      });
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 13. DASHBOARD
// ═══════════════════════════════════════════
server.tool(
  "wasabi_dashboard",
  "Get a workspace snapshot for an at-a-glance briefing: health, pages (with optional row counts), unread notifications, recent task activity. NOTE: for richer context (KB summary, integration status, schemas) use wasabi_context instead. Set include_row_counts=true to fetch row counts per database (slower; one query per table).",
  {
    include: z.enum(["all", "health", "pages", "notifications", "activity"]).optional().describe("What to include (default: all)"),
    include_row_counts: z.boolean().optional().describe("Fetch row counts per database (default: false; slow on large workspaces)"),
  },
  async ({ include, include_row_counts }) => {
    const inc = include || "all";
    try {
      const snapshot = {};
      const fetches = [];

      if (inc === "all" || inc === "health") {
        fetches.push(wasabiFetch("/health").then((r) => (snapshot.health = r)).catch(() => (snapshot.health = { status: "unreachable" })));
      }
      if (inc === "all" || inc === "pages") {
        fetches.push(wasabiFetch("/pages").then(async (res) => {
          const arr = unwrap(res, "pages");
          const mapped = arr.map((p) => ({
            id: p.id,
            title: p.title,
            page_type: p.page_type,
            parent_id: p.parent_id || null,
            view_count: (p.config?.views || []).length,
            view_types: (p.config?.views || []).map((v) => v.type),
          }));
          if (include_row_counts) {
            const databases = mapped.filter((p) => p.page_type === "database");
            await Promise.all(databases.map(async (p) => {
              try {
                const r = await wasabiFetch(`/tables/${p.id}/rows?limit=10000`);
                p.row_count = unwrap(r, "rows").length;
              } catch { p.row_count = null; }
            }));
          }
          snapshot.pages = mapped;
          snapshot.page_count = mapped.length;
        }).catch((e) => { snapshot.pages = []; snapshot._pages_error = String(e); }));
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
  "Bulk import data into a Wasabi table. Accepts an array of row objects. Use action='schema' first to see available columns, then 'import' to insert. import requires confirm: true.",
  {
    action: z.enum(["schema", "import"]).describe("'schema' to get column info, 'import' to insert rows"),
    table_id: z.string().describe("Target table ID"),
    rows: z.string().optional().describe("JSON string of array of row objects, e.g. [{\"Name\":\"Widget\",\"Cost\":42}, ...]"),
    merge_key: z.string().optional().describe("If set, update existing rows where this column matches instead of creating duplicates"),
    confirm: z.boolean().optional().describe("Required true for import action."),
  },
  async ({ action, table_id, rows: rawRows, merge_key, confirm }) => {
    try {
      if (action === "schema") {
        const schema = await wasabiFetch(`/pages/${table_id}/schema`);
        return ok({ table_id, schema, hint: "Use the column names from this schema as keys in your row objects for import" });
      }

      const rows = parseJSON(rawRows);
      if (!Array.isArray(rows) || !rows.length) return err("rows must be a non-empty JSON array of objects");

      const g = gate(confirm, { method: "import", table_id, row_count: rows.length, sample: rows[0], merge_key: merge_key || null });
      if (g) return g;

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
  "Attach external context to a Wasabi record — add a comment or note linking an email, URL, document, or other external reference. Useful for connecting Cowork context to Wasabi data. add_comment/set_note require confirm: true.",
  {
    action: z.enum(["add_comment", "set_note", "get_comments", "get_note"]),
    record_id: z.string().describe("Record ID to attach to"),
    page_id: z.string().optional().describe("Page ID (required for notes)"),
    content: z.string().optional().describe("Comment text or note content (markdown supported)"),
    user_name: z.string().optional().describe("Display name for comment author (default: MCP)"),
    confirm: z.boolean().optional().describe("Required true for add_comment/set_note."),
  },
  async ({ action, record_id, page_id, content, user_name, confirm }) => {
    try {
      switch (action) {
        case "add_comment": {
          const g = gate(confirm, { method: "POST", path: `/records/${record_id}/comments`, payload: { content, user_name: user_name || "Cowork MCP" } });
          if (g) return g;
          return ok(await wasabiFetch(`/records/${record_id}/comments`, "POST", {
            content, user_id: "mcp", user_name: user_name || "Cowork MCP",
          }));
        }
        case "set_note": {
          const g = gate(confirm, { method: "PUT", path: `/records/${record_id}/notes`, payload: { content, page_config_id: page_id } });
          if (g) return g;
          return ok(await wasabiFetch(`/records/${record_id}/notes`, "PUT", {
            content, page_config_id: page_id,
          }));
        }
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
  "Modify a table's schema: add new columns, remove columns, or rename/retype existing columns. Use wasabi_pages get_schema first to see current columns. update requires confirm: true (schema changes may affect existing data).",
  {
    table_id: z.string().describe("Page/table ID whose schema to modify"),
    action: z.enum(["get", "update"]).describe("'get' to view schema, 'update' to modify"),
    schema: z.string().optional().describe("JSON string of updated schema (full columns array for update)"),
    confirm: z.boolean().optional().describe("Required true for update."),
  },
  async ({ table_id, action, schema: rawSchema, confirm }) => {
    try {
      if (action === "get") {
        return ok(await wasabiFetch(`/pages/${table_id}/schema`));
      }
      const schema = parseJSON(rawSchema);
      const g = gate(confirm, { method: "PATCH", path: `/pages/${table_id}/schema`, payload: schema, note: "Schema change — may affect existing row data." });
      if (g) return g;
      return ok(await wasabiFetch(`/pages/${table_id}/schema`, "PATCH", schema));
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 21. BULK UPDATE
// ═══════════════════════════════════════════
server.tool(
  "wasabi_bulk_update",
  "Update multiple rows that match a filter in one operation. E.g. 'mark all Awaiting PO items from vendor X as Cancelled'. Without confirm: true acts as a preview (returns matched count and sample). With confirm: true performs the update.",
  {
    table_id: z.string().describe("Table ID"),
    filters: z.string().describe("JSON string of filter to match rows to update"),
    updates: z.string().describe("JSON string of cell values to set on all matched rows, e.g. {\"Status\":\"Cancelled\"}"),
    confirm: z.boolean().optional().describe("Required true to execute. Without it, returns a preview of matched rows."),
  },
  async ({ table_id, filters: rawFilters, updates: rawUpdates, confirm }) => {
    const filters = parseJSON(rawFilters);
    const updates = parseJSON(rawUpdates);
    try {
      const result = await wasabiFetch(`/tables/${table_id}/query`, "POST", { filters, limit: 5000 });
      const rows = unwrap(result, "rows");

      if (confirm !== true) {
        return ok({
          pending_confirmation: true,
          intended_action: { method: "bulk_update", table_id, updates, filters, matched: rows.length },
          preview: { matched: rows.length, sample: rows.slice(0, 5) },
          message: CONFIRM_MESSAGE,
        });
      }

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
      const body = { prompt };
      if (context) body.context = context;
      const result = await wasabiFetch("/agent", "POST", body);
      return ok(result);
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 24. AGENT CONFIG
// ═══════════════════════════════════════════
server.tool(
  "wasabi_agent_config",
  "Read or update the Wasabi in-app agent's configuration: system prompt, persona, knowledge base entries that shape its behavior. Tune the agent without opening the app. create_kb/update_kb require confirm: true.",
  {
    action: z.enum(["get_kb", "update_kb", "create_kb", "list_kb"]),
    id: z.string().optional().describe("KB entry ID (for get/update)"),
    data: z.string().optional().describe("JSON string of KB data to create/update"),
    category: z.string().optional().describe("Filter KB by category (e.g. 'agent_config', 'business_rules')"),
    confirm: z.boolean().optional().describe("Required true for create_kb/update_kb."),
  },
  async ({ action, id, data: rawData, category, confirm }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list_kb": {
          const qs = category ? `?category=${encodeURIComponent(category)}` : "";
          return ok(await wasabiFetch(`/d1/kb${qs}`));
        }
        case "get_kb": return ok(await wasabiFetch(`/d1/kb/${id}`));
        case "create_kb": {
          const g = gate(confirm, { method: "POST", path: "/d1/kb", payload: data });
          if (g) return g;
          return ok(await wasabiFetch("/d1/kb", "POST", data));
        }
        case "update_kb": {
          const g = gate(confirm, { method: "PATCH", path: `/d1/kb/${id}`, payload: data });
          if (g) return g;
          return ok(await wasabiFetch(`/d1/kb/${id}`, "PATCH", data));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 25. TRIGGER
// ═══════════════════════════════════════════
server.tool(
  "wasabi_trigger",
  "Manually trigger an automation rule or flow. Useful for running scheduled tasks on-demand. Requires confirm: true (executes automation side-effects).",
  {
    type: z.enum(["rule", "flow"]).describe("Whether to trigger a rule or a flow"),
    id: z.string().describe("Rule ID or Flow ID to trigger"),
    input: z.string().optional().describe("JSON string of input data to pass to the trigger"),
    confirm: z.boolean().optional().describe("Required true to fire the trigger."),
  },
  async ({ type, id, input: rawInput, confirm }) => {
    const input = parseJSON(rawInput);
    try {
      const g = gate(confirm, { method: "trigger", type, id, input: input || {}, note: "Will run the automation's actions immediately." });
      if (g) return g;
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
  "Create or manage scheduled automation rules. Set up recurring tasks like daily inventory checks or weekly reports. create/update/delete require confirm: true.",
  {
    action: z.enum(["list", "create", "update", "delete"]),
    id: z.string().optional().describe("Rule ID for update/delete"),
    data: z.string().optional().describe("JSON string of schedule rule data: name, trigger_type='schedule', trigger_config={cron:'...'}, action_config={instruction:'...'}, scope_table_id, enabled"),
    confirm: z.boolean().optional().describe("Required true for create/update/delete."),
  },
  async ({ action, id, data: rawData, confirm }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": return ok(await wasabiFetch("/d1/rules?trigger_type=schedule"));
        case "create": {
          const rule = { ...data, trigger_type: "schedule" };
          const g = gate(confirm, { method: "POST", path: "/d1/rules", payload: rule });
          if (g) return g;
          return ok(await wasabiFetch("/d1/rules", "POST", rule));
        }
        case "update": {
          const g = gate(confirm, { method: "PATCH", path: `/d1/rules/${id}`, payload: data });
          if (g) return g;
          return ok(await wasabiFetch(`/d1/rules/${id}`, "PATCH", data));
        }
        case "delete": {
          const g = gate(confirm, { method: "DELETE", path: `/d1/rules/${id}` });
          if (g) return g;
          return ok(await wasabiFetch(`/d1/rules/${id}`, "DELETE"));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 27. GOOGLE (Gmail + Calendar)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_google",
  "Access Gmail and Google Calendar through Wasabi's stored OAuth tokens. Reads are unrestricted; sends, drafts, label changes, event mutations require confirm: true. gmail actions: summary, search, read, send, draft, modify, thread. calendar actions: list, summary, events, create_event, update_event, delete_event, freebusy.",
  {
    service: z.enum(["gmail", "calendar"]).describe("Google service to use"),
    action: z.string().describe("See description for action list per service."),
    data: z.string().optional().describe("JSON string of action-specific params (e.g. {query:'from:vendor'} for gmail search, {timeMin:'...',timeMax:'...'} for calendar events)"),
    id: z.string().optional().describe("Message/event/thread/draft ID for read/update/delete actions"),
    confirm: z.boolean().optional().describe("Required true for: send, draft, modify, create_event, update_event, delete_event."),
  },
  async ({ service, action, data: rawData, id, confirm }) => {
    const data = parseJSON(rawData) || {};
    try {
      if (service === "gmail") {
        switch (action) {
          case "summary": return ok(await wasabiFetch("/google/gmail/summary"));
          case "search": return ok(await wasabiFetch("/google/gmail/messages", "POST", data));
          case "read": return ok(await wasabiFetch(`/google/gmail/messages/${id}`));
          case "thread": return ok(await wasabiFetch(`/google/gmail/threads/${id}`));
          case "send": {
            const g = gate(confirm, { method: "POST", path: "/google/gmail/send", payload: data, note: "Will send an email from the connected Google account." });
            if (g) return g;
            return ok(await wasabiFetch("/google/gmail/send", "POST", data));
          }
          case "draft": {
            const g = gate(confirm, { method: "POST", path: "/google/gmail/drafts", payload: data });
            if (g) return g;
            return ok(await wasabiFetch("/google/gmail/drafts", "POST", data));
          }
          case "modify": {
            const g = gate(confirm, { method: "POST", path: `/google/gmail/modify/${id}`, payload: data });
            if (g) return g;
            return ok(await wasabiFetch(`/google/gmail/modify/${id}`, "POST", data));
          }
          default: return err(`Unknown gmail action: ${action}`);
        }
      }
      if (service === "calendar") {
        switch (action) {
          case "list": return ok(await wasabiFetch("/google/calendar/list"));
          case "summary": return ok(await wasabiFetch("/google/calendar/summary"));
          case "events": return ok(await wasabiFetch(`/google/calendar/events?${new URLSearchParams(data)}`));
          case "freebusy": return ok(await wasabiFetch("/google/calendar/freebusy", "POST", data));
          case "create_event": {
            const g = gate(confirm, { method: "POST", path: "/google/calendar/events", payload: data });
            if (g) return g;
            return ok(await wasabiFetch("/google/calendar/events", "POST", data));
          }
          case "update_event": {
            const g = gate(confirm, { method: "PATCH", path: `/google/calendar/events/${id}`, payload: data });
            if (g) return g;
            return ok(await wasabiFetch(`/google/calendar/events/${id}`, "PATCH", data));
          }
          case "delete_event": {
            const g = gate(confirm, { method: "DELETE", path: `/google/calendar/events/${id}` });
            if (g) return g;
            return ok(await wasabiFetch(`/google/calendar/events/${id}`, "DELETE"));
          }
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
  "Manage Notion sync for tables. Configure bidirectional sync, push/pull changes, check sync status. configure/push/pull/delete/flush require confirm: true (they modify data across systems).",
  {
    action: z.enum(["configure", "push", "pull", "status", "delete", "flush"]),
    table_id: z.string().optional().describe("Table ID (required for configure/push/pull/status/delete)"),
    data: z.string().optional().describe("JSON string of sync config: notion_db_id, direction (push/pull/bidirectional), field_mapping"),
    full: z.boolean().optional().describe("Full resync for pull action (default: false)"),
    confirm: z.boolean().optional().describe("Required true for configure/push/pull/delete/flush."),
  },
  async ({ action, table_id, data: rawData, full, confirm }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "status": return ok(await wasabiFetch(`/sync/${table_id}/status`));
        case "configure": {
          const g = gate(confirm, { method: "POST", path: `/sync/${table_id}/configure`, payload: data });
          if (g) return g;
          return ok(await wasabiFetch(`/sync/${table_id}/configure`, "POST", data));
        }
        case "push": {
          const g = gate(confirm, { method: "POST", path: `/sync/${table_id}/push`, note: "Pushes local rows to Notion." });
          if (g) return g;
          return ok(await wasabiFetch(`/sync/${table_id}/push`, "POST"));
        }
        case "pull": {
          const g = gate(confirm, { method: "POST", path: `/sync/${table_id}/pull${full ? "?full=1" : ""}`, note: full ? "Full resync — overwrites local rows from Notion." : "Incremental pull from Notion." });
          if (g) return g;
          return ok(await wasabiFetch(`/sync/${table_id}/pull${full ? "?full=1" : ""}`, "POST"));
        }
        case "delete": {
          const g = gate(confirm, { method: "DELETE", path: `/sync/${table_id}`, note: "Disconnects the sync config (data remains)." });
          if (g) return g;
          return ok(await wasabiFetch(`/sync/${table_id}`, "DELETE"));
        }
        case "flush": {
          const g = gate(confirm, { method: "POST", path: "/sync/flush", note: "Flushes all dirty rows to Notion." });
          if (g) return g;
          return ok(await wasabiFetch("/sync/flush", "POST"));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 29. RECORDS (notes, comments, badges)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_records",
  "Manage record-level details: notes, comments, badge counts, and view history. Richer than basic row CRUD. Mutating actions (set_note, add_comment, delete_comment, record_view) require confirm: true.",
  {
    action: z.enum(["get_note", "set_note", "get_comments", "add_comment", "delete_comment", "badge_counts", "view_history", "record_view"]),
    record_id: z.string().optional().describe("Record ID"),
    page_id: z.string().optional().describe("Page config ID (for notes)"),
    data: z.string().optional().describe("JSON string of content/comment data"),
    record_ids: z.string().optional().describe("JSON string array of record IDs (for badge_counts)"),
    since: z.string().optional().describe("ISO date for view_history filter"),
    confirm: z.boolean().optional().describe("Required true for set_note/add_comment/delete_comment/record_view."),
  },
  async ({ action, record_id, page_id, data: rawData, record_ids: rawIds, since, confirm }) => {
    const data = parseJSON(rawData) || {};
    const record_ids = parseJSON(rawIds);
    try {
      switch (action) {
        case "get_note": return ok(await wasabiFetch(`/records/${record_id}/notes?page_config_id=${page_id}`));
        case "get_comments": return ok(await wasabiFetch(`/records/${record_id}/comments`));
        case "view_history": {
          const qs = since ? `?since=${encodeURIComponent(since)}` : "";
          return ok(await wasabiFetch(`/record-views${qs}`));
        }
        case "badge_counts": return ok(await wasabiFetch("/records/badge-counts", "POST", { record_ids, page_config_id: page_id || undefined }));
        case "set_note": {
          const g = gate(confirm, { method: "PUT", path: `/records/${record_id}/notes`, payload: { content: data.content, page_config_id: page_id } });
          if (g) return g;
          return ok(await wasabiFetch(`/records/${record_id}/notes`, "PUT", { content: data.content, page_config_id: page_id }));
        }
        case "add_comment": {
          const g = gate(confirm, { method: "POST", path: `/records/${record_id}/comments`, payload: { content: data.content, user_name: data.user_name || "Cowork MCP" } });
          if (g) return g;
          return ok(await wasabiFetch(`/records/${record_id}/comments`, "POST", { content: data.content, user_id: data.user_id || "mcp", user_name: data.user_name || "Cowork MCP" }));
        }
        case "delete_comment": {
          const g = gate(confirm, { method: "DELETE", path: `/records/${record_id}/comments/${data.comment_id}` });
          if (g) return g;
          return ok(await wasabiFetch(`/records/${record_id}/comments/${data.comment_id}`, "DELETE"));
        }
        case "record_view": {
          const g = gate(confirm, { method: "PUT", path: `/record-views/${record_id}`, note: "Logs that this record was viewed." });
          if (g) return g;
          return ok(await wasabiFetch(`/record-views/${record_id}`, "PUT"));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 30. CONTEXT (single-call workspace snapshot)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_context",
  "Single-call workspace snapshot for AI grounding: every page with schema + row count + view types, KB summary, integration status (Google/Microsoft/Notion/Figma/Claude), recent activity (notifications + audit log + record views), users. START HERE on a new conversation to understand the workspace before drilling in with wasabi_data / wasabi_records / wasabi_search.",
  {
    row_counts: z.boolean().optional().describe("Include per-table row counts (default true)."),
    schemas: z.boolean().optional().describe("Include column schemas per database (default true)."),
    kb: z.boolean().optional().describe("Include knowledge base entries (default true)."),
    activity: z.boolean().optional().describe("Include recent notifications + audit log + record views (default true)."),
    integrations: z.boolean().optional().describe("Include integration connection status (default true)."),
    kb_limit: z.number().optional().describe("Max KB entries to include (default 30, max 200)."),
    activity_limit: z.number().optional().describe("Max items per activity feed (default 20, max 100)."),
  },
  async ({ row_counts, schemas, kb, activity, integrations, kb_limit, activity_limit }) => {
    try {
      const params = new URLSearchParams();
      if (row_counts === false) params.set("row_counts", "false");
      if (schemas === false) params.set("schemas", "false");
      if (kb === false) params.set("kb", "false");
      if (activity === false) params.set("activity", "false");
      if (integrations === false) params.set("integrations", "false");
      if (kb_limit) params.set("kb_limit", String(kb_limit));
      if (activity_limit) params.set("activity_limit", String(activity_limit));
      const qs = params.toString() ? `?${params}` : "";
      return ok(await wasabiFetch(`/mcp/context${qs}`));
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 31. MICROSOFT 365 (Outlook mail + calendar)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_microsoft",
  "Access Outlook mail and Microsoft Calendar through Wasabi's stored OAuth tokens. Reads are unrestricted; sends, draft writes, modify, event mutations require confirm: true. mail actions: status, summary, search, read, thread, send, draft, update_draft, modify. calendar actions: summary, events, create_event, update_event, delete_event, freebusy.",
  {
    service: z.enum(["mail", "calendar"]).describe("Microsoft service to use"),
    action: z.string().describe("See description for action list per service."),
    data: z.string().optional().describe("JSON string of action-specific params."),
    id: z.string().optional().describe("Message/conversation/event/draft ID."),
    confirm: z.boolean().optional().describe("Required true for: send, draft, update_draft, modify, create_event, update_event, delete_event."),
  },
  async ({ service, action, data: rawData, id, confirm }) => {
    const data = parseJSON(rawData) || {};
    try {
      if (service === "mail") {
        switch (action) {
          case "status": return ok(await wasabiFetch("/microsoft/status"));
          case "summary": return ok(await wasabiFetch("/microsoft/mail/summary"));
          case "search": return ok(await wasabiFetch("/microsoft/mail/messages", "POST", data));
          case "read": return ok(await wasabiFetch(`/microsoft/mail/messages/${id}`));
          case "thread": return ok(await wasabiFetch(`/microsoft/mail/conversations/${id}`));
          case "send": {
            const g = gate(confirm, { method: "POST", path: "/microsoft/mail/send", payload: data, note: "Sends an email from the connected Outlook account." });
            if (g) return g;
            return ok(await wasabiFetch("/microsoft/mail/send", "POST", data));
          }
          case "draft": {
            const g = gate(confirm, { method: "POST", path: "/microsoft/mail/drafts", payload: data });
            if (g) return g;
            return ok(await wasabiFetch("/microsoft/mail/drafts", "POST", data));
          }
          case "update_draft": {
            const g = gate(confirm, { method: "PATCH", path: `/microsoft/mail/drafts/${id}`, payload: data });
            if (g) return g;
            return ok(await wasabiFetch(`/microsoft/mail/drafts/${id}`, "PATCH", data));
          }
          case "modify": {
            const g = gate(confirm, { method: "POST", path: `/microsoft/mail/modify/${id}`, payload: data });
            if (g) return g;
            return ok(await wasabiFetch(`/microsoft/mail/modify/${id}`, "POST", data));
          }
          default: return err(`Unknown mail action: ${action}`);
        }
      }
      if (service === "calendar") {
        switch (action) {
          case "summary": return ok(await wasabiFetch("/microsoft/calendar/summary"));
          case "events": return ok(await wasabiFetch(`/microsoft/calendar/events?${new URLSearchParams(data)}`));
          case "freebusy": return ok(await wasabiFetch("/microsoft/calendar/freebusy", "POST", data));
          case "create_event": {
            const g = gate(confirm, { method: "POST", path: "/microsoft/calendar/events", payload: data });
            if (g) return g;
            return ok(await wasabiFetch("/microsoft/calendar/events", "POST", data));
          }
          case "update_event": {
            const g = gate(confirm, { method: "PATCH", path: `/microsoft/calendar/events/${id}`, payload: data });
            if (g) return g;
            return ok(await wasabiFetch(`/microsoft/calendar/events/${id}`, "PATCH", data));
          }
          case "delete_event": {
            const g = gate(confirm, { method: "DELETE", path: `/microsoft/calendar/events/${id}` });
            if (g) return g;
            return ok(await wasabiFetch(`/microsoft/calendar/events/${id}`, "DELETE"));
          }
          default: return err(`Unknown calendar action: ${action}`);
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 32. FIGMA (files, comments, comment-record links)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_figma",
  "Access Figma through Wasabi's stored OAuth token. Browse projects/files, read/write file comments, manage comment ↔ Wasabi-record links. import/post_comment/delete_comment/create_link/delete_link require confirm: true.",
  {
    action: z.enum([
      "status", "projects", "files", "get_file",
      "list_comments", "post_comment", "delete_comment",
      "list_links_for_record", "list_links_for_comment", "create_link", "delete_link",
      "import",
    ]),
    project_id: z.string().optional().describe("Project ID (for files)."),
    file_key: z.string().optional().describe("File key (for get_file / comments)."),
    record_id: z.string().optional().describe("Wasabi record id (for link lookups)."),
    comment_id: z.string().optional().describe("Figma comment id (for delete_comment, link lookups)."),
    link_id: z.string().optional().describe("Comment-link id (for delete_link)."),
    data: z.string().optional().describe("JSON string of payload (comment body, link spec, import options)."),
    confirm: z.boolean().optional().describe("Required true for import/post_comment/delete_comment/create_link/delete_link."),
  },
  async ({ action, project_id, file_key, record_id, comment_id, link_id, data: rawData, confirm }) => {
    const data = parseJSON(rawData) || {};
    try {
      switch (action) {
        case "status": return ok(await wasabiFetch("/figma/status"));
        case "projects": return ok(await wasabiFetch("/figma/projects"));
        case "files": {
          const qs = project_id ? `?project=${encodeURIComponent(project_id)}` : "";
          return ok(await wasabiFetch(`/figma/files${qs}`));
        }
        case "get_file": return ok(await wasabiFetch(`/figma/files/${file_key}`));
        case "list_comments": return ok(await wasabiFetch(`/figma/files/${file_key}/comments`));
        case "list_links_for_record": return ok(await wasabiFetch(`/figma/comment-links?record_id=${encodeURIComponent(record_id)}`));
        case "list_links_for_comment": return ok(await wasabiFetch(`/figma/comment-links?comment_id=${encodeURIComponent(comment_id)}`));
        case "post_comment": {
          const g = gate(confirm, { method: "POST", path: `/figma/files/${file_key}/comments`, payload: data });
          if (g) return g;
          return ok(await wasabiFetch(`/figma/files/${file_key}/comments`, "POST", data));
        }
        case "delete_comment": {
          const g = gate(confirm, { method: "DELETE", path: `/figma/files/${file_key}/comments/${comment_id}` });
          if (g) return g;
          return ok(await wasabiFetch(`/figma/files/${file_key}/comments/${comment_id}`, "DELETE"));
        }
        case "create_link": {
          const g = gate(confirm, { method: "POST", path: "/figma/comment-links", payload: data });
          if (g) return g;
          return ok(await wasabiFetch("/figma/comment-links", "POST", data));
        }
        case "delete_link": {
          const g = gate(confirm, { method: "DELETE", path: `/figma/comment-links/${link_id}` });
          if (g) return g;
          return ok(await wasabiFetch(`/figma/comment-links/${link_id}`, "DELETE"));
        }
        case "import": {
          const g = gate(confirm, { method: "POST", path: "/figma/import", payload: data });
          if (g) return g;
          return ok(await wasabiFetch("/figma/import", "POST", data));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 33. AUDIT LOG (admin-only, read-only)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_audit",
  "Read the workspace audit log (admin only). Filter by user, resource type, action, or time range. Useful for tracing 'who did what' across the workspace.",
  {
    user_id: z.string().optional().describe("Filter by actor user id."),
    resource_type: z.string().optional().describe("Filter by resource type (e.g. 'page', 'row', 'user')."),
    resource_id: z.string().optional().describe("Filter by resource id."),
    action: z.string().optional().describe("Filter by action name (e.g. 'delete_row', 'set_page_permission')."),
    since: z.string().optional().describe("ISO date — only entries after this time."),
    limit: z.number().optional().describe("Max entries (default 100, max 1000)."),
  },
  async ({ user_id, resource_type, resource_id, action, since, limit }) => {
    try {
      const params = new URLSearchParams();
      if (user_id) params.set("user_id", user_id);
      if (resource_type) params.set("resource_type", resource_type);
      if (resource_id) params.set("resource_id", resource_id);
      if (action) params.set("action", action);
      if (since) params.set("since", since);
      if (limit) params.set("limit", String(Math.min(limit, 1000)));
      const qs = params.toString() ? `?${params}` : "";
      return ok(await wasabiFetch(`/audit-log${qs}`));
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 34. CELL LINKS (cross-page linked-cell relationships)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_links",
  "Manage cell links — relationships that let a cell on one page mirror data from a cell on another. Useful for discovering how pages reference each other. create/delete require confirm: true.",
  {
    action: z.enum(["list", "create", "delete"]),
    id: z.string().optional().describe("Link id (for delete)."),
    page_id: z.string().optional().describe("Filter list to links involving this page (source or target)."),
    data: z.string().optional().describe("JSON payload for create: { source_page_id, source_ref, target_page_id, target_ref, direction }."),
    confirm: z.boolean().optional().describe("Required true for create/delete."),
  },
  async ({ action, id, page_id, data: rawData, confirm }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": {
          const qs = page_id ? `?page_id=${encodeURIComponent(page_id)}` : "";
          return ok(await wasabiFetch(`/links${qs}`));
        }
        case "create": {
          const g = gate(confirm, { method: "POST", path: "/links", payload: data });
          if (g) return g;
          return ok(await wasabiFetch("/links", "POST", data));
        }
        case "delete": {
          const g = gate(confirm, { method: "DELETE", path: `/links/${id}` });
          if (g) return g;
          return ok(await wasabiFetch(`/links/${id}`, "DELETE"));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 35. RELATIONSHIPS (record-level relationships)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_relationships",
  "Manage record-level relationships (typed edges between rows across pages). list/create/delete; rebuild reindexes all relationships from current data. create/delete/rebuild require confirm: true.",
  {
    action: z.enum(["list", "create", "delete", "rebuild"]),
    id: z.string().optional().describe("Relationship id (for delete)."),
    data: z.string().optional().describe("JSON for create: { type, source_type, source_id, source_page_id, target_type, target_id, target_page_id }."),
    confirm: z.boolean().optional().describe("Required true for create/delete/rebuild."),
  },
  async ({ action, id, data: rawData, confirm }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list": return ok(await wasabiFetch("/relationships"));
        case "create": {
          const g = gate(confirm, { method: "POST", path: "/relationships", payload: data });
          if (g) return g;
          return ok(await wasabiFetch("/relationships", "POST", data));
        }
        case "delete": {
          const g = gate(confirm, { method: "DELETE", path: `/relationships/${id}` });
          if (g) return g;
          return ok(await wasabiFetch(`/relationships/${id}`, "DELETE"));
        }
        case "rebuild": {
          const g = gate(confirm, { method: "POST", path: "/relationships/rebuild", note: "Rebuilds all relationship rows from current data. May be slow." });
          if (g) return g;
          return ok(await wasabiFetch("/relationships/rebuild", "POST"));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 36. PAGE PERMISSIONS (read-only)
// ═══════════════════════════════════════════
// WRITES intentionally not exposed via MCP: per Claude's safety policy,
// permission modification must happen in-app where the user sees the UI.
server.tool(
  "wasabi_permissions",
  "Read page permissions (admin or page owner only). Returns the user_id + permission level (owner/editor/viewer/none) entries for a given page. WRITES are not exposed via MCP — change permissions through the Wasabi web UI.",
  {
    page_id: z.string().describe("Page ID whose permissions to list."),
  },
  async ({ page_id }) => {
    try {
      return ok(await wasabiFetch(`/pages/${page_id}/permissions`));
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 37. USER STATE (per-user UI state + dashboard)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_user_state",
  "Read or update the current user's UI state and dashboard widget layout. update_state/update_dashboard require confirm: true.",
  {
    action: z.enum(["get_state", "update_state", "get_dashboard", "update_dashboard"]),
    data: z.string().optional().describe("JSON payload for update actions."),
    confirm: z.boolean().optional().describe("Required true for update actions."),
  },
  async ({ action, data: rawData, confirm }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "get_state": return ok(await wasabiFetch("/user-state"));
        case "get_dashboard": return ok(await wasabiFetch("/user-dashboard"));
        case "update_state": {
          const g = gate(confirm, { method: "PUT", path: "/user-state", payload: data });
          if (g) return g;
          return ok(await wasabiFetch("/user-state", "PUT", data));
        }
        case "update_dashboard": {
          const g = gate(confirm, { method: "PUT", path: "/user-dashboard", payload: data });
          if (g) return g;
          return ok(await wasabiFetch("/user-dashboard", "PUT", data));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 38. RECORD CONTEXT (per-record mega-bundle)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_record_context",
  "Fetch a record + its full context in one shot: row data, comments, note, attached files, sub-items (child rows), badge counts. Mirrors the in-app agent's get_record_context tool. Useful when the AI needs to reason about a single record without making 5+ tool calls.",
  {
    record_id: z.string().describe("Record / row ID"),
    table_id: z.string().describe("Containing table ID"),
    page_id: z.string().optional().describe("Page config ID (defaults to table_id for database pages)."),
    include_files: z.boolean().optional().describe("Include attached files (default true)."),
    include_sub_items: z.boolean().optional().describe("Include child rows (default true)."),
  },
  async ({ record_id, table_id, page_id, include_files, include_sub_items }) => {
    const includeFiles = include_files !== false;
    const includeSubs = include_sub_items !== false;
    const pageId = page_id || table_id;
    try {
      const fetches = {
        row: wasabiFetch(`/tables/${table_id}/rows/${record_id}`).catch((e) => ({ _error: String(e) })),
        comments: wasabiFetch(`/records/${record_id}/comments`).catch((e) => ({ _error: String(e) })),
        note: wasabiFetch(`/records/${record_id}/notes?page_config_id=${pageId}`).catch((e) => ({ _error: String(e) })),
        badges: wasabiFetch("/records/badge-counts", "POST", { record_ids: [record_id], page_config_id: pageId }).catch((e) => ({ _error: String(e) })),
      };
      if (includeFiles) {
        fetches.files = wasabiFetch(`/files?record_id=${encodeURIComponent(record_id)}`).catch((e) => ({ _error: String(e) }));
      }
      if (includeSubs) {
        fetches.sub_items = wasabiFetch(`/tables/${table_id}/rows?parent_row_id=${encodeURIComponent(record_id)}&limit=500`)
          .then((r) => unwrap(r, "rows"))
          .catch((e) => ({ _error: String(e) }));
      }
      const keys = Object.keys(fetches);
      const values = await Promise.all(keys.map((k) => fetches[k]));
      const result = {};
      keys.forEach((k, i) => { result[k] = values[i]; });
      return ok({ record_id, table_id, ...result });
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 39. EXTERNAL API PROXY (call third-party APIs via worker)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_external_proxy",
  "Proxy an HTTP request to an external API through the Wasabi worker. Useful for calling endpoints that need server-side fetch (CORS, secrets). The worker enforces an allowlist and rate limits. Requires confirm: true (external side-effects).",
  {
    url: z.string().describe("Full external URL to fetch."),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional().describe("HTTP method (default GET)."),
    headers: z.string().optional().describe("JSON string of request headers."),
    body: z.string().optional().describe("Request body (string or JSON-stringified)."),
    confirm: z.boolean().optional().describe("Required true to send the request."),
  },
  async ({ url, method, headers: rawHeaders, body, confirm }) => {
    const headers = parseJSON(rawHeaders);
    const m = method || "GET";
    try {
      const g = gate(confirm, { method: m, external_url: url, headers: headers || null, has_body: !!body });
      if (g) return g;
      return ok(await wasabiFetch("/proxy/external-api", "POST", { url, method: m, headers, body }));
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 40. DOCUMENTS (rich-text document blocks)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_documents",
  "Read and write document content (rich-text blocks stored in R2). Each document is identified by its page id. save/update_blocks/export_notion require confirm: true.",
  {
    action: z.enum(["get", "save", "update_blocks", "export_notion"]),
    id: z.string().describe("Document / page id."),
    data: z.string().optional().describe("JSON payload for save (full doc) or update_blocks (block ops)."),
    confirm: z.boolean().optional().describe("Required true for save/update_blocks/export_notion."),
  },
  async ({ action, id, data: rawData, confirm }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "get": return ok(await wasabiFetch(`/docs/${id}`));
        case "save": {
          const g = gate(confirm, { method: "PUT", path: `/docs/${id}`, note: "Overwrites the entire document." });
          if (g) return g;
          return ok(await wasabiFetch(`/docs/${id}`, "PUT", data));
        }
        case "update_blocks": {
          const g = gate(confirm, { method: "PATCH", path: `/docs/${id}/blocks`, payload: data });
          if (g) return g;
          return ok(await wasabiFetch(`/docs/${id}/blocks`, "PATCH", data));
        }
        case "export_notion": {
          const g = gate(confirm, { method: "POST", path: `/docs/${id}/export/notion`, note: "Pushes the document to Notion." });
          if (g) return g;
          return ok(await wasabiFetch(`/docs/${id}/export/notion`, "POST", data));
        }
      }
    } catch (e) { return err(e); }
  }
);

// ═══════════════════════════════════════════
// 41. TASK ACTIVITY (interactions, snoozes, activity feed)
// ═══════════════════════════════════════════
server.tool(
  "wasabi_task_activity",
  "Read task activity, log interactions with records, and manage task snoozes (used by the Tasks view). Mutating actions (log_interaction, snooze, unsnooze) require confirm: true.",
  {
    action: z.enum(["list_activity", "get_activity", "list_interactions", "interaction_summary", "log_interaction", "list_snoozes", "snooze", "unsnooze"]),
    record_id: z.string().optional().describe("Record id (for get_activity, interaction_summary, snooze, unsnooze)."),
    data: z.string().optional().describe("JSON payload for log_interaction or snooze."),
    limit: z.number().optional().describe("Max entries for list actions."),
    confirm: z.boolean().optional().describe("Required true for log_interaction/snooze/unsnooze."),
  },
  async ({ action, record_id, data: rawData, limit, confirm }) => {
    const data = parseJSON(rawData);
    try {
      switch (action) {
        case "list_activity": {
          const qs = limit ? `?limit=${limit}` : "";
          return ok(await wasabiFetch(`/task-activity${qs}`));
        }
        case "get_activity": return ok(await wasabiFetch(`/task-activity/${record_id}`));
        case "list_interactions": {
          const qs = limit ? `?limit=${limit}` : "";
          return ok(await wasabiFetch(`/task-interactions${qs}`));
        }
        case "interaction_summary": return ok(await wasabiFetch(`/task-interactions/${record_id}/summary`));
        case "log_interaction": {
          const g = gate(confirm, { method: "POST", path: "/task-interactions", payload: data });
          if (g) return g;
          return ok(await wasabiFetch("/task-interactions", "POST", data));
        }
        case "list_snoozes": return ok(await wasabiFetch("/task-snoozes"));
        case "snooze": {
          const g = gate(confirm, { method: "POST", path: "/task-snoozes", payload: data });
          if (g) return g;
          return ok(await wasabiFetch("/task-snoozes", "POST", data));
        }
        case "unsnooze": {
          const g = gate(confirm, { method: "DELETE", path: `/task-snoozes/${record_id}` });
          if (g) return g;
          return ok(await wasabiFetch(`/task-snoozes/${record_id}`, "DELETE"));
        }
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
        pages: unwrap(pages, "pages").map((p) => ({
          id: p.id,
          title: p.title,
          page_type: p.page_type,
          parent_id: p.parent_id || null,
          views: (p.config?.views || []).map((v) => ({ type: v.type, label: v.label })),
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
