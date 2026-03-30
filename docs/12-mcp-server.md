# MCP Server

**Last Updated:** 2026-03-21

## Product Context

Wasabi is an AI-native workspace where users build persistent semantic scaffolding -- databases, knowledge bases, automations, and relationship networks (Neurons) -- that makes AI interactions more accurate over time. The MCP server is the "super-user tier" of Wasabi's three-tier platform vision: it lets external tools (Claude Code, Claude Desktop, or any MCP-compatible client) read and write Wasabi data programmatically.

---

## Purpose

The MCP server is a local Node.js process (`mcp-server/index.js`) that translates MCP tool calls into authenticated HTTPS requests against the Wasabi Cloudflare Worker. It uses stdio transport (JSON-RPC 2.0) and is spawned by the MCP client (e.g., Claude Desktop).

```
MCP Client (Claude Code / Claude Desktop)
    |
    |  stdio transport (JSON-RPC 2.0)
    v
mcp-server/index.js  (Node.js ESM process)
    |
    |  HTTPS + X-Wasabi-Key header
    v
Cloudflare Worker (wasabi-worker)
    |
    +-- D1 Database
    +-- R2 Storage
    +-- Notion API (proxy)
    +-- Google APIs (Gmail, Calendar)
    +-- Claude API (in-app agent)
```

The MCP server contains no business logic. It is a thin proxy: translate tool call to HTTP request, attach authentication, parse response, return structured JSON.

---

## Authentication

MCP requests use a **shared secret key** sent as the `X-Wasabi-Key` HTTP header. This is NOT the same as JWT cookie authentication used by the browser frontend.

| Mechanism | Used By | How It Works |
|-----------|---------|--------------|
| `X-Wasabi-Key` header | MCP server | Shared secret stored in `mcp-server/config.json` (gitignored). Worker validates against `WASABI_KEY` env var. |
| JWT + HttpOnly cookie | Browser frontend | 15-min access token in memory, 7-day refresh token in cookie. |

Configuration file (`mcp-server/config.json`, created from `config.example.json`):

```json
{
  "workerUrl": "https://wasabi-worker.goodluckbadidea.workers.dev",
  "apiKey": "your-wasabi-secret-key"
}
```

---

## Security

MCP requests pass through the same `checkRoutePermission()` function in `worker.js` as regular API calls. The MCP server does not bypass any access control -- it is subject to the same role-based permission checks, rate limiting, and input validation as the browser frontend.

The API key is stored in a gitignored config file. The MCP server runs locally as a child process -- it is never exposed on a public network. All traffic to the worker uses HTTPS.

---

## Tools (29)

### 1. wasabi_health

Check worker status or list saved external connections (Notion key, Claude key, Google OAuth).

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"check"` or `"list_connections"` | What to return |

### 2. wasabi_pages

CRUD for pages (databases, documents, dashboards).

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"list"` `"get"` `"get_schema"` `"create"` `"update"` `"delete"` | Operation |
| id | string | Page ID (for get/get_schema/update/delete) |
| data | object | Page config (title, page_type, columns, views) |

Page types: `database`, `document`, `page`, `dashboard`. View types: `table`, `kanban`, `gantt`, `calendar`, `cardGrid`, `charts`, `form`, `summaryTiles`, `activityFeed`, `customView`.

### 3. wasabi_data

CRUD for table rows with filter/sort/pagination.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"list"` `"query"` `"create"` `"update"` `"delete"` | Operation |
| table_id | string | Target table |
| row_id | string | Row ID (for update/delete) |
| filters | object | Filter object |
| sorts | array | Sort array |
| rows | array | Batch row creation |
| data | object | Row data for update |
| limit / offset | number | Pagination |

Auto-syncs Notion-linked tables on first empty query (cold start).

### 4. wasabi_automations

CRUD for automation rules. Trigger types: `schedule` (cron), `status_change`, `field_change`, `page_created`, `manual`. Action config uses an AI prompt with `{{fieldName}}` template variables.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"list"` `"get"` `"create"` `"update"` `"delete"` | Operation |
| id | string | Rule ID |
| data | object | Rule config (name, trigger_type, trigger_config, action_config, enabled) |
| enabled | boolean | Filter by enabled state |

### 5. wasabi_functions

CRUD for custom functions and plugins. Types: `transform`, `aggregation`, `forecast`, `alert`, `pipeline`, `view`, `plugin`. Plugins include an HTML/CSS/JS manifest rendered in an iframe.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"list"` `"get"` `"create"` `"update"` `"delete"` `"list_executions"` | Operation |
| id | string | Function ID |
| data | object | Function config (name, type, code, inputs, outputs, status, meta) |
| type / status | string | Filters |

### 6. wasabi_flows

CRUD for multi-step node-based automation flows. Graph structure with nodes (trigger, action, condition, delay) and edges.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"list"` `"get"` `"create"` `"update"` `"delete"` `"list_executions"` | Operation |
| id | string | Flow ID |
| data | object | Flow config (name, description, graph, enabled) |
| enabled | boolean | Filter |

### 7. wasabi_kb

CRUD and search for knowledge base entries. Categories include `business_rules`, `domain_knowledge`, `team_context`, `templates`. Full-text search via the `search` action.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"list"` `"get"` `"create"` `"update"` `"delete"` `"search"` | Operation |
| id | string | KB entry ID |
| data | object | Entry data (key, category, content, source, related_pages) |
| category / query | string | Filters |

### 8. wasabi_notifications

Manage notifications. Types: `notification`, `alert`, `summary`.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"list"` `"create"` `"update"` `"delete"` `"mark_all_read"` `"unread_count"` | Operation |
| id | string | Notification ID |
| data | object | Notification data (message, type, source, record_id) |
| status | `"unread"` or `"read"` | Filter |

### 9. wasabi_neurons

CRUD for semantic relationship clusters (Neurons). Neurons link records, pages, and fields across the workspace.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"list"` `"get"` `"create"` `"delete"` `"graph"` `"add_node"` `"remove_node"` `"by_node"` | Operation |
| id | string | Neuron ID |
| data | object | Neuron data (name, nodes with node_type/node_id/node_label/page_config_id) |
| node_id | string | For remove_node/by_node |

### 10. wasabi_users

User management. Admin-only for invite/update/delete.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"list"` `"get_me"` `"invite"` `"update"` `"delete"` | Operation |
| id | string | User ID |
| data | object | User data (display_name, role) |

### 11. wasabi_files

List, get URL, or delete files in R2 storage. Upload is via web UI only.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"list"` `"get_url"` `"delete"` | Operation |
| id | string | File ID |
| page_id / record_id | string | Filters |

### 12. wasabi_search

Global keyword search across all tables, pages, and knowledge base.

| Parameter | Type | Description |
|-----------|------|-------------|
| query | string | Search keyword |
| scope | `"all"` `"tables"` `"kb"` `"pages"` | Limit scope |
| limit | number | Max results per table |

### 13. wasabi_dashboard

Workspace snapshot: health status, page list with row counts, unread notifications, recent activity.

| Parameter | Type | Description |
|-----------|------|-------------|
| include | `"all"` `"health"` `"pages"` `"notifications"` `"activity"` | What to include |

### 14. wasabi_analytics

Aggregate queries on table data: count, sum, average, group_count, group_sum.

| Parameter | Type | Description |
|-----------|------|-------------|
| table_id | string | Target table |
| operation | `"count"` `"sum"` `"average"` `"group_count"` `"group_sum"` | Aggregation type |
| field | string | Field for sum/average/group operations |
| group_by | string | Group-by field |
| filters | object | Filter object |

### 15. wasabi_diff

Change tracking. Returns rows modified after a given date.

| Parameter | Type | Description |
|-----------|------|-------------|
| table_id | string | Target table |
| since | ISO date string | Cutoff date |
| limit | number | Max rows |

### 16. wasabi_import

Bulk import rows. Use `action: "schema"` first to see columns, then `"import"` to insert. Optional `merge_key` for deduplication.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"schema"` or `"import"` | Operation |
| table_id | string | Target table |
| rows | array | Row data for import |
| merge_key | string | Column to deduplicate on |

### 17. wasabi_export

Export table data as JSON or CSV.

| Parameter | Type | Description |
|-----------|------|-------------|
| table_id | string | Target table |
| format | `"json"` or `"csv"` | Output format |
| filters | object | Filter subset |
| limit | number | Max rows |

### 18. wasabi_link_external

Attach comments or notes linking external context (emails, URLs, documents) to records.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"add_comment"` `"set_note"` `"get_comments"` `"get_note"` | Operation |
| record_id | string | Target record |
| page_id | string | Required for notes |
| content | string | Comment/note text |
| user_name | string | Author display name |

### 19. wasabi_sql

Advanced query with complex filters, sorts, field selection, and pagination.

| Parameter | Type | Description |
|-----------|------|-------------|
| table_id | string | Target table |
| fields | string | Comma-separated field list |
| filters | object | Filter object (`{field: {op: value}}`) |
| sorts | array | Sort array |
| limit / offset | number | Pagination |

Filter operators: `eq`, `ne`, `gt`, `lt`, `gte`, `lte`, `contains`, `starts_with`, `in`.

### 20. wasabi_schema_alter

Modify a table's schema: add columns, remove columns, rename/retype columns.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"get"` or `"update"` | Operation |
| table_id | string | Target table |
| schema | string (JSON) | Updated columns array |

### 21. wasabi_bulk_update

Update all rows matching a filter in one operation. Supports dry run to preview matches.

| Parameter | Type | Description |
|-----------|------|-------------|
| table_id | string | Target table |
| filters | object | Filter to match rows |
| updates | object | Cell values to set |
| dry_run | boolean | Preview without applying |

### 22. wasabi_backup

Full snapshot of a table (schema + all rows) returned as JSON.

| Parameter | Type | Description |
|-----------|------|-------------|
| table_id | string | Target table |

### 23. wasabi_agent_query

Send a prompt to the in-app Wasabi AI agent. The in-app agent has Wasabi-specific context (system prompt, KB, page schemas) that external tools do not.

| Parameter | Type | Description |
|-----------|------|-------------|
| prompt | string | The prompt/question |
| context | object | Optional additional context (page_id, record data) |

### 24. wasabi_agent_config

Manage the in-app agent's knowledge base and behavior configuration.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"get_kb"` `"update_kb"` `"create_kb"` `"list_kb"` | Operation |
| id | string | KB entry ID |
| category | string | Filter by category |
| data | object | KB entry data |

### 25. wasabi_trigger

Manually fire an automation rule or flow on demand.

| Parameter | Type | Description |
|-----------|------|-------------|
| type | `"rule"` or `"flow"` | What to trigger |
| id | string | Rule or flow ID |
| input | object | Input data |

### 26. wasabi_schedule

Create and manage scheduled automation rules with cron expressions.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"list"` `"create"` `"update"` `"delete"` | Operation |
| id | string | Rule ID |
| data | object | Schedule config (name, cron, action_config, scope_table_id, enabled) |

### 27. wasabi_google

Access Gmail and Google Calendar through Wasabi's stored OAuth tokens.

| Parameter | Type | Description |
|-----------|------|-------------|
| service | `"gmail"` or `"calendar"` | Google service |
| action | string | Service-specific action |
| data | object | Action params |
| id | string | Message/event/thread ID |

Gmail actions: `summary`, `search`, `read`, `send`, `draft`, `modify`, `thread`. Calendar actions: `list`, `summary`, `events`, `create_event`, `update_event`, `delete_event`, `freebusy`.

### 28. wasabi_sync

Manage Notion sync for tables. Configure bidirectional sync, push/pull changes, check status.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"configure"` `"push"` `"pull"` `"status"` `"delete"` `"flush"` | Operation |
| table_id | string | Target table |
| data | object | Sync config (notion_db_id, direction, field_mapping) |
| full | boolean | Full resync for pull |

Directions: `push` (D1 to Notion), `pull` (Notion to D1), `bidirectional`.

### 29. wasabi_records

Manage per-record metadata: notes, comments, badge counts, view history.

| Parameter | Type | Description |
|-----------|------|-------------|
| action | `"get_note"` `"set_note"` `"get_comments"` `"add_comment"` `"delete_comment"` `"badge_counts"` `"view_history"` `"record_view"` | Operation |
| record_id | string | Target record |
| page_id | string | For notes |
| data | object | Content/comment data |
| record_ids | array | For badge_counts |
| since | ISO date | For view_history filter |

---

## Usage Playbook

For most tasks, follow this order:

1. `wasabi_dashboard` -- understand workspace health and page list
2. `wasabi_pages list` -- find page IDs and types
3. `wasabi_data list` -- fetch rows (triggers auto-sync for Notion-linked tables)
4. `wasabi_search` -- keyword search across all data
5. `wasabi_analytics` -- aggregations and summaries
6. `wasabi_automations` / `wasabi_flows` -- set up automation

---

## Auto-Sync on Cold Start

When `wasabi_data`, `wasabi_sql`, or `wasabi_analytics` return empty results for a Notion-linked table with `last_synced_at = null`, the MCP server automatically triggers a full pull from Notion, retries the original query, and returns `_auto_synced: true` in the response.

---

## Development

**Runtime:** Node.js ESM. **SDK:** `@modelcontextprotocol/sdk` v1.12+.

Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "wasabi": {
      "command": "node",
      "args": ["/absolute/path/to/wasabi-platform/mcp-server/index.js"]
    }
  }
}
```

Core fetch helper (`wasabiFetch`) prepends `workerUrl`, adds `X-Wasabi-Key` header, auto-parses JSON, and throws on non-2xx status. Response helpers `ok(result)` and `err(error)` format MCP-compliant responses.

---

## References

- Worker routes: `worker.js` (all `/wasabi/*` endpoints)
- MCP SDK docs: https://modelcontextprotocol.io
- Config template: `mcp-server/config.example.json`
