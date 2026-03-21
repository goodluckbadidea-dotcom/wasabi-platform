# Wasabi Platform: MCP Server

**Version:** March 2026
**Purpose:** Local MCP server for Claude Desktop (Cowork) integration with live Wasabi backend
**Location:** `mcp-server/`
**Transport:** stdio (spawned by Claude Desktop)
**Runtime:** Node.js ESM (no build step required)
**SDK:** `@modelcontextprotocol/sdk` v1.12+

---

## Architecture

```
Claude Desktop / Cowork
    │
    │  stdio transport (JSON-RPC 2.0)
    ▼
mcp-server/index.js
    (Node.js ES module process)
    │
    │  HTTPS requests + X-Wasabi-Key header
    ▼
Cloudflare Worker
    (wasabi-worker.goodluckbadidea.workers.dev)
    │
    ├─→ D1 Database (tables, rows, automations)
    ├─→ R2 Storage (files, documents)
    ├─→ Notion API (via proxy)
    ├─→ Google APIs (Gmail, Calendar, Sheets)
    └─→ Claude API (for in-app agent)
```

**MCP Server Role:** Thin proxy layer
- Translates MCP tool calls → HTTP requests
- Adds authentication (X-Wasabi-Key header)
- Parses responses → structured JSON
- Auto-syncs Notion data on first query if needed
- No business logic — purely request/response translation

---

## Configuration

### Claude Desktop Setup

**File:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
Or equivalent on Windows/Linux

**Configuration:**
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

After updating, restart Claude Desktop to load the MCP server.

### MCP Server Config

**File:** `mcp-server/config.json` (gitignored — not in version control)

**Template:** `mcp-server/config.example.json`
```json
{
  "workerUrl": "https://wasabi-worker.goodluckbadidea.workers.dev",
  "apiKey": "wasabi-secret-key"
}
```

**Required Fields:**
- `workerUrl`: Wasabi Worker base URL (no trailing slash)
- `apiKey`: X-Wasabi-Key header value

**Package Dependencies:** `mcp-server/package.json`
```json
{
  "@modelcontextprotocol/sdk": "^1.12.0"
}
```

Run `npm install` in mcp-server directory before first use.

---

## Tools (Complete Reference)

### 1. Health & Status

```javascript
wasabi_health(action: "check" | "list_connections")
```
- **check**: Verify worker is online
- **list_connections**: Show saved external keys (Notion, Claude, Google)

---

### 2. Pages (Databases, Documents, Sheets)

```javascript
wasabi_pages(
  action: "list" | "get" | "get_schema" | "create" | "update" | "delete",
  id?: string,
  data?: { title, page_type, columns, views, ... }
)
```

**Actions:**
- `list`: Return all pages with row counts, types
- `get`: Fetch single page config
- `get_schema`: Table column definitions
- `create`: Create database/doc/sheet with initial columns
- `update`: Add views, rename fields, update settings
- `delete`: Delete page and all data

**Page Types:** `database`, `document`, `sheet`, `page`, `dashboard`

**View Types:** `table`, `kanban`, `gantt`, `calendar`, `cardGrid`, `charts`, `form`, `summaryTiles`, `activityFeed`, `customView`

---

### 3. Data (Table Rows)

```javascript
wasabi_data(
  action: "list" | "query" | "create" | "update" | "delete",
  table_id: string,
  row_id?: string,
  filters?: object,
  sorts?: array,
  rows?: array,
  data?: object,
  limit?: number,
  offset?: number
)
```

**Features:**
- Auto-syncs Notion linked tables on first empty query
- Supports filter/sort (D1 native syntax)
- Returns `truncated: true` if results exceed limit
- Create accepts single or batch rows
- Update uses merge mode by default (partial cell updates)

---

### 4. Automations (Rules)

```javascript
wasabi_automations(
  action: "list" | "get" | "create" | "update" | "delete",
  id?: string,
  data?: { name, trigger_type, trigger_config, action_config, enabled },
  enabled?: boolean
)
```

**Trigger Types:**
- `schedule` (cron): `{cron: "0 9 * * 1-5"}`
- `status_change`: `{field_name, old_value, new_value}`
- `field_change`: `{field_name}`
- `page_created`: `{}`
- `manual`: `{}`

**Action Config:**
- `instruction`: AI prompt (supports `{{fieldName}}` template vars)

---

### 5. Custom Functions

```javascript
wasabi_functions(
  action: "list" | "get" | "create" | "update" | "delete" | "list_executions",
  id?: string,
  data?: { name, type, code, inputs, outputs, status, meta },
  type?: string,
  status?: "draft" | "active" | "disabled"
)
```

**Function Types:**
- `transform`: Data transformation
- `aggregation`: Summarize data
- `forecast`: Predict trends
- `alert`: Trigger notifications
- `pipeline`: Multi-step data flow
- `view`: Custom view renderer
- `plugin`: Dashboard widget

**Execution History:** `list_executions` shows past runs with timestamps and results

---

### 6. Flows (Visual Automation)

```javascript
wasabi_flows(
  action: "list" | "get" | "create" | "update" | "delete" | "list_executions",
  id?: string,
  data?: { name, description, graph, enabled }
)
```

**Flow Structure:**
```json
{
  "nodes": [
    { "id": "n1", "type": "trigger", "label": "On Schedule", "config": {} },
    { "id": "n2", "type": "data", "label": "Query Tasks", "config": { "source_id": "..." } },
    { "id": "n3", "type": "ai", "label": "Summarize", "config": { "prompt": "..." } },
    { "id": "n4", "type": "action", "label": "Post", "config": { "target": "notification" } }
  ],
  "edges": [
    { "from": "n1", "to": "n2" },
    { "from": "n2", "to": "n3" },
    { "from": "n3", "to": "n4" }
  ]
}
```

---

### 7. Knowledge Base

```javascript
wasabi_kb(
  action: "list" | "get" | "create" | "update" | "delete" | "search",
  id?: string,
  data?: { key, category, content, source, related_pages },
  category?: string,
  query?: string
)
```

**Categories:** `business_rules`, `domain_knowledge`, `team_context`, `templates`, etc.

**Search:** Full-text search across all KB entries

---

### 8. Notifications

```javascript
wasabi_notifications(
  action: "list" | "create" | "update" | "delete" | "mark_all_read" | "unread_count",
  id?: string,
  data?: { message, type, source, record_id },
  status?: "unread" | "read"
)
```

**Notification Types:** `notification`, `alert`, `summary`

---

### 9. Neurons (Semantic Links)

```javascript
wasabi_neurons(
  action: "list" | "get" | "create" | "delete" | "graph" | "add_node" | "remove_node" | "by_node",
  id?: string,
  data?: { name, nodes: [{ type, ref }] },
  node_id?: string
)
```

**Neuron Structure:** Named clusters linking:
- Records (reference by `{type: "record", record_id, page_id}`)
- Pages (reference by `{type: "page", page_id}`)
- Fields (reference by `{type: "field", field_name}`)

**Graph View:** Return relationship graph structure

---

### 10. Users

```javascript
wasabi_users(
  action: "list" | "get_me" | "invite" | "update" | "delete",
  id?: string,
  data?: { display_name, role }
)
```

**Actions:**
- `invite`: Create invite with role (`viewer`, `editor`, `admin`)
- `update`: Change role or status
- `delete`: Deactivate user

---

### 11. Files (R2 Storage)

```javascript
wasabi_files(
  action: "list" | "get_url" | "delete",
  id?: string,
  page_id?: string,
  record_id?: string
)
```

**Filtering:**
- `page_id`: Files attached to page
- `record_id`: Files attached to record

**Upload:** Via web UI only (not supported in MCP)

---

### 12. Search (Global)

```javascript
wasabi_search(
  query: string,
  scope?: "all" | "tables" | "kb" | "pages",
  limit?: number
)
```

Returns results grouped by source (table, KB, page) with matching excerpts.

---

### 13. Dashboard

```javascript
wasabi_dashboard(
  include?: "all" | "health" | "pages" | "notifications" | "activity"
)
```

**Returns:**
- Health status (worker up, DB connected)
- Page list with row counts
- Unread notification count
- Recent activity (last 10 actions)

---

### 14. Analytics

```javascript
wasabi_analytics(
  table_id: string,
  operation: "count" | "sum" | "average" | "group_count" | "group_sum",
  field?: string,
  group_by?: string,
  filters?: object
)
```

**Examples:**
- `count` rows
- `sum` on numeric field
- `group_count` items by field
- `group_sum` revenue by customer

---

### 15. Diff (Change Tracking)

```javascript
wasabi_diff(
  table_id: string,
  since?: ISO date string
)
```

Returns rows modified after given date with `updated_at` timestamp.

---

### 16. Import (Bulk)

```javascript
wasabi_import(
  action: "schema" | "import",
  table_id: string,
  rows?: array,
  merge_key?: string
)
```

**Schema Action:** Return column definitions for mapping

**Import Action:** Insert with optional `merge_key` for deduplication

---

### 17. Export

```javascript
wasabi_export(
  table_id: string,
  format: "json" | "csv",
  filters?: object,
  limit?: number
)
```

Returns data as JSON array or CSV string.

---

### 18. Link External

```javascript
wasabi_link_external(
  action: "add_comment" | "set_note" | "get_comments" | "get_note",
  record_id: string,
  page_id?: string,
  content?: string,
  user_name?: string
)
```

Attach notes/comments linking external context to records.

---

### 19. SQL (Advanced Query)

```javascript
wasabi_sql(
  table_id: string,
  fields?: string,
  filters?: object,
  sorts?: array,
  limit?: number,
  offset?: number
)
```

**Filters Syntax:**
```json
{
  "field_name": { "op": "value" }
}
```

**Operators:** `eq`, `ne`, `gt`, `lt`, `gte`, `lte`, `contains`, `starts_with`, `in`

---

### 20. Schema Alter

```javascript
wasabi_schema_alter(
  action: "get" | "update",
  table_id: string,
  schema?: array
)
```

**Modifications:**
- Add columns: `{ name, type, options?, format? }`
- Remove: Set column to `null`
- Rename: Update column object with new `name`

---

### 21. Bulk Update

```javascript
wasabi_bulk_update(
  table_id: string,
  filters: object,
  updates: object,
  dry_run?: boolean
)
```

**Dry Run:** Returns matched rows without applying updates.

---

### 22. Backup

```javascript
wasabi_backup(table_id: string)
```

Returns complete table snapshot: schema + all rows as JSON.

---

### 23. Agent Query

```javascript
wasabi_agent_query(
  prompt: string,
  context?: object
)
```

Sends prompt to the in-app Wasabi agent (Claude-to-Claude).

---

### 24. Agent Config

```javascript
wasabi_agent_config(
  action: "get_kb" | "update_kb" | "create_kb" | "list_kb",
  id?: string,
  category?: string,
  data?: { key, category, content, source }
)
```

Manage agent's knowledge base and behavior configuration.

---

### 25. Trigger

```javascript
wasabi_trigger(
  type: "rule" | "flow",
  id: string,
  input?: object
)
```

Manually fire automation rule or flow on demand.

---

### 26. Schedule

```javascript
wasabi_schedule(
  action: "list" | "create" | "update" | "delete",
  id?: string,
  data?: { name, cron, action_config, scope_table_id, enabled }
)
```

Create scheduled automation rules with cron expressions.

---

### 27. Google (Gmail + Calendar)

```javascript
wasabi_google(
  service: "gmail" | "calendar",
  action: string,
  data?: object,
  id?: string
)
```

**Gmail Actions:**
- `summary`, `search`, `read`, `send`, `draft`, `modify`, `thread`

**Calendar Actions:**
- `list`, `summary`, `events`, `create_event`, `update_event`, `delete_event`, `freebusy`

---

### 28. Sync (Notion)

```javascript
wasabi_sync(
  action: "configure" | "push" | "pull" | "status" | "delete" | "flush",
  table_id: string,
  data?: { notion_db_id, direction, field_mapping },
  full?: boolean
)
```

**Directions:** `push` (D1→Notion), `pull` (Notion→D1), `bidirectional`

**Full Resync:** `full=true` clears D1 and pulls everything from Notion

---

### 29. Records

```javascript
wasabi_records(
  action: "get_note" | "set_note" | "get_comments" | "add_comment" | "delete_comment" | "badge_counts" | "view_history" | "record_view",
  record_id: string,
  page_id?: string,
  data?: { content },
  record_ids?: array,
  since?: ISO date
)
```

Manage per-record metadata: notes, comments, badges, view history.

---

## Usage Playbook

**For Most Tasks, Follow This Order:**

1. Start with `wasabi_dashboard` to understand workspace health
2. Use `wasabi_pages list` to find page IDs and types
3. For linked Notion tables, first `wasabi_data list` (triggers auto-sync)
4. Use `wasabi_search` for keyword queries across all data
5. Use `wasabi_analytics` for aggregations and summaries
6. Use `wasabi_automations` / `wasabi_flows` to set up automation

---

## Auto-Sync on Cold Start

**Problem:** Notion-linked database has sync config but no data in D1 (initial pull never ran)

**Solution:** When `wasabi_data`, `wasabi_sql`, or `wasabi_analytics` return empty results:
1. Server checks if Notion sync configured with `last_synced_at = null`
2. Automatically triggers full pull from Notion
3. Retries original query
4. Returns `_auto_synced: true` in response

This solves cold-start problem without manual intervention.

---

## Known Limitations

### Issue: Notion-Linked Databases Return Empty (LIMITATION)

**Status:** By design

**Problem:** Notion-linked databases configured but have `last_synced_at = null` will return empty results until first manual sync

**Workaround:** Auto-sync (see above) handles this automatically on first query

**Impact:** Users don't need to manually trigger Notion sync; MCP server handles it

---

## Development & Testing

### Local Testing

Server uses stdio transport — test with piped JSON-RPC:

```bash
cd mcp-server
npm install
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}\n' | node index.js
```

### Adding Tools

In `mcp-server/index.js`:

```javascript
server.tool(
  "tool_name",
  "Description for Claude",
  { zod_schema_of_inputs },
  async (inputs) => {
    try {
      const result = await wasabiFetch("/endpoint", "POST", inputs);
      return ok(result);
    } catch (e) {
      return err(e);
    }
  }
);
```

Then restart Claude Desktop to load changes.

### Core Fetch Helper

```javascript
async function wasabiFetch(path, method = "GET", body = null)
```

- Prepends `workerUrl` to path
- Adds `X-Wasabi-Key` header
- Auto-parses JSON response
- Throws on non-2xx status

### Response Helpers

```javascript
ok(result)     // Return { content: [{type: "text", text: JSON.stringify(result)}] }
err(error)     // Return { content: [...], isError: true }
```

---

## Security Model

- **Authentication:** X-Wasabi-Key header on all requests
- **Configuration:** API key in `config.json` (gitignored)
- **Process Isolation:** MCP server runs locally as child process
- **Network:** No public exposure; Claude Desktop spawns via stdio
- **Transport:** Authenticated HTTPS to Wasabi Worker

---

## References

- **Worker Routes:** `worker.js` for all `/wasabi/*` endpoints
- **SDK Docs:** https://modelcontextprotocol.io
- **Config Example:** `mcp-server/config.example.json`
- **Setup Guide:** `README.md` in mcp-server directory
