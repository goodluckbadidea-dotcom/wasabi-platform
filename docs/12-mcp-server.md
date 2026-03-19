# 12 — MCP Server (Model Context Protocol)

## Overview

Wasabi includes a local MCP server that connects Claude Desktop (Cowork) to the live Wasabi backend. This gives Claude direct access to workspace data, automations, functions, and integrations — making it a superuser admin panel controlled by natural language.

**Location:** `mcp-server/`
**Transport:** stdio (spawned as a child process by Claude Desktop)
**Runtime:** Node.js ESM (no build step)
**SDK:** `@modelcontextprotocol/sdk` v1.27+

---

## Architecture

```
Claude Desktop (Cowork)
    │
    │  stdio (JSON-RPC)
    ▼
mcp-server/index.js          ← local Node.js process
    │
    │  HTTPS + X-Wasabi-Key header
    ▼
Cloudflare Worker             ← wasabi-worker.goodluckbadidea.workers.dev
    │
    ▼
D1 Database / R2 Storage / Notion API / Google API / Claude API
```

The MCP server is a thin proxy layer — it translates MCP tool calls into HTTP requests to the Wasabi Worker, adds authentication, and returns structured JSON responses.

---

## Configuration

### Claude Desktop Config

File: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "wasabi": {
      "command": "node",
      "args": ["/path/to/wasabi-platform/mcp-server/index.js"]
    }
  }
}
```

### MCP Server Config

File: `mcp-server/config.json` (gitignored)

```json
{
  "workerUrl": "https://wasabi-worker.goodluckbadidea.workers.dev",
  "apiKey": "your-wasabi-secret"
}
```

Template available at `mcp-server/config.example.json`.

---

## Tools (29 total)

### Core CRUD (1-11)

| # | Tool | Purpose |
|---|------|---------|
| 1 | `wasabi_health` | Health check, list saved connections |
| 2 | `wasabi_pages` | CRUD page configs, get schema, manage views |
| 3 | `wasabi_data` | Query/CRUD table rows in D1 (auto-syncs from Notion if empty) |
| 4 | `wasabi_automations` | CRUD automation rules (schedule, status_change, field_change, manual) |
| 5 | `wasabi_functions` | CRUD custom functions and plugins (7 types including view and plugin) |
| 6 | `wasabi_flows` | CRUD multi-step automation flows (node/edge graph) |
| 7 | `wasabi_kb` | CRUD knowledge base entries |
| 8 | `wasabi_notifications` | List/create/manage notifications, unread count |
| 9 | `wasabi_neurons` | Manage relationship clusters linking records, pages, fields |
| 10 | `wasabi_users` | User management, roles, invites |
| 11 | `wasabi_files` | List/delete R2-stored files |

### Intelligence (12-15)

| # | Tool | Purpose |
|---|------|---------|
| 12 | `wasabi_search` | Fuzzy search across ALL tables, pages, and KB in one call |
| 13 | `wasabi_dashboard` | Workspace snapshot: health, pages, notifications, activity |
| 14 | `wasabi_analytics` | Aggregate queries: count, sum, average, group_by |
| 15 | `wasabi_diff` | Change tracking — rows modified since a given date |

### Cross-App (16-18)

| # | Tool | Purpose |
|---|------|---------|
| 16 | `wasabi_import` | Bulk insert with schema-aware column mapping + merge-key dedup |
| 17 | `wasabi_export` | Export table data as JSON or CSV |
| 18 | `wasabi_link_external` | Attach comments/notes linking external context to records |

### Admin (19-22)

| # | Tool | Purpose |
|---|------|---------|
| 19 | `wasabi_sql` | Advanced query builder with filters, sorts, field selection |
| 20 | `wasabi_schema_alter` | Add/rename/remove table columns |
| 21 | `wasabi_bulk_update` | Update all rows matching a filter in one operation |
| 22 | `wasabi_backup` | Full table snapshot (schema + all rows) for safekeeping |

### AI (23-24)

| # | Tool | Purpose |
|---|------|---------|
| 23 | `wasabi_agent_query` | Claude-to-Claude: prompt the in-app Wasabi agent |
| 24 | `wasabi_agent_config` | Read/update agent KB and behavior config |

### Workflow (25-26)

| # | Tool | Purpose |
|---|------|---------|
| 25 | `wasabi_trigger` | Manually fire automation rules or flows on demand |
| 26 | `wasabi_schedule` | Create/manage scheduled automation rules |

### Integrations (27-29)

| # | Tool | Purpose |
|---|------|---------|
| 27 | `wasabi_google` | Gmail + Calendar via Wasabi's Google OAuth connection |
| 28 | `wasabi_sync` | Notion bidirectional sync: configure, push, pull, status |
| 29 | `wasabi_records` | Record notes, comments, badge counts, view history |

---

## Resources (2)

| Resource | URI | Purpose |
|----------|-----|---------|
| Data Model Docs | `wasabi://docs/data-model` | Complete schema reference: view types, column types, widget types, function schemas, automation rules, flow graphs, neuron structure, and step-by-step build workflows |
| Workspace Overview | `wasabi://workspace` | Live snapshot of health status + page list |

---

## Auto-Sync Feature

When `wasabi_data`, `wasabi_analytics`, or `wasabi_sql` return empty results for a table, the server checks if a Notion sync config exists with `last_synced_at = null` (never synced). If so, it automatically triggers a full sync pull from Notion, then retries the query.

This solves the cold-start problem where Notion-linked databases have a sync config but no data in D1 because the initial pull was never manually triggered.

---

## Key Workflows

### Building a Custom Plugin Widget

1. `wasabi_functions` create — type `"plugin"`, HTML/CSS/JS in `code` field, manifest in `meta`
2. Pin to dashboard — add widget with type `"plugin"` and `functionId` pointing to the function

### Creating a Database with Views

1. `wasabi_pages` create — `page_type: "database"`, include `columns` array
2. `wasabi_pages` update — add views (kanban, gantt, calendar, etc.) to config
3. `wasabi_data` create — seed initial rows

### Cross-App Data Import (e.g. from Excel via Cowork)

1. `wasabi_import` action `"schema"` — get target table's column definitions
2. Map spreadsheet columns to Wasabi columns
3. `wasabi_import` action `"import"` — bulk insert with optional `merge_key` for dedup

### Morning Briefing

1. `wasabi_dashboard` — workspace health, page list, unread notifications
2. `wasabi_analytics` — key metrics (inventory levels, project counts by status)
3. `wasabi_google` gmail summary — recent important emails

---

## Development

### Testing Locally

The server communicates via stdio, so you can test with piped JSON-RPC:

```bash
cd mcp-server
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}\n' | node index.js
```

### Adding New Tools

1. Add a `server.tool()` call in `index.js` with name, description, Zod schema, and handler
2. Handler should use `wasabiFetch()` to proxy to the Worker
3. Return `ok(result)` for success or `err(error)` for errors
4. Test with the pipe method above, then restart Claude Desktop

### Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol implementation
- `zod` — input schema validation (bundled with SDK)
- No build tools required — runs as raw ESM

---

## Security

- API key stored in `config.json` (gitignored, never committed)
- All requests authenticated via `X-Wasabi-Key` header
- MCP server runs locally — no network exposure
- Claude Desktop spawns the process on demand via stdio
