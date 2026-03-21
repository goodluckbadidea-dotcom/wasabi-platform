# D1/Notion Sync Architecture

**Last Updated:** 2026-03-21

## Product Context

Wasabi is an AI-native workspace that can link to external Notion databases. The sync architecture determines how Notion data flows into Wasabi's D1 database and (optionally) back to Notion. This is a core integration point: without sync, Notion-linked data cannot participate in automations, search, conflict detection, or MCP access.

---

## Current State

Notion databases can be linked to Wasabi pages. There are two operating modes:

### Mode 1: Proxy Mode (Default)

When a Notion database is first linked, Wasabi operates in proxy mode. The frontend queries the Notion API through the Cloudflare Worker -- no data is stored in D1.

```
Notion Database (source of truth)
    |
    | Notion API request (proxied through worker)
    v
Wasabi Frontend (displays live Notion data)
```

In this mode:
- Data is always fresh (direct from Notion API)
- No D1 storage is used for row data
- No conflict detection is possible
- Automations and search cannot access the data
- No MCP tool access to the data

### Mode 2: Sync Mode (Configured)

When a user configures sync via the `/sync/:tableId/configure` endpoint, Wasabi creates a `sync_configs` entry that maps the Notion database to a D1 table. Data is then pulled from Notion into D1, and dirty rows can be pushed back.

```
Notion Database
    |                    ^
    | pull               | push (dirty rows)
    v                    |
D1 Table (local copy)
    |
    v
Wasabi Frontend / MCP / Automations / Search
```

In this mode:
- D1 is the working copy; Notion is the upstream source
- Conflict detection via `cell_versions` works
- Automations and search can access the data
- MCP tools can read and write the data
- Changes made in Wasabi are marked dirty and pushed back to Notion

---

## Sync Endpoints

All endpoints are under `/sync/:tableId/`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/sync/:tableId/configure` | POST | Set up sync config (notion_db_id, direction, field_mapping) |
| `/sync/:tableId/push` | POST | Push dirty D1 rows to Notion |
| `/sync/:tableId/pull` | POST | Pull Notion pages into D1 (full or incremental) |
| `/sync/:tableId/status` | GET | Check sync status (last_synced_at, dirty row count) |
| `/sync/:tableId/flush` | POST | Force-process all dirty rows immediately |

---

## Sync Flow

### Pull (Notion to D1)

1. Worker fetches all pages from the linked Notion database via the Notion API.
2. For each Notion page:
   - If a matching D1 row exists (by `notion_page_id`): update the row's cells.
   - If no match: insert a new D1 row with `notion_page_id` set.
3. Update `last_synced_at` in the sync config.

### Push (D1 to Notion)

1. Query D1 for rows where `sync_dirty = 1`.
2. For each dirty row:
   - Look up the `notion_page_id` to find the corresponding Notion page.
   - Update the Notion page properties via the Notion API.
   - Set `sync_dirty = 0` on success.

---

## Dirty Row Tracking

The `table_rows` table includes a `sync_dirty` column:

| Value | Meaning |
|-------|---------|
| `0` | Clean -- row is in sync with Notion |
| `1` | Dirty -- row was modified in Wasabi and needs to be pushed to Notion |

When a user edits a synced row through the Wasabi UI or MCP, `sync_dirty` is set to `1`. The next push operation (manual or cron) processes these rows.

---

## Cron Flush

`runSyncFlushTick()` runs every 2 minutes via the worker's Cron Trigger. It:

1. Queries `sync_configs` for tables with configured sync.
2. For each synced table, checks for rows where `sync_dirty = 1`.
3. Pushes dirty rows to Notion.
4. Resets `sync_dirty = 0` on success.

This provides near-real-time sync without requiring the user to manually trigger pushes.

---

## D1 Schema (Sync-Related)

```sql
-- Sync configuration per table
CREATE TABLE sync_configs (
  table_id TEXT PRIMARY KEY,
  notion_db_id TEXT,
  direction TEXT,          -- "push" | "pull" | "bidirectional"
  field_mapping TEXT,      -- JSON mapping of Wasabi fields to Notion properties
  last_synced_at DATETIME,
  sync_status TEXT         -- "idle" | "syncing" | "failed"
);

-- Row data with sync tracking
CREATE TABLE table_rows (
  id TEXT,
  table_id TEXT,
  cells TEXT,              -- JSON of all cell values
  cell_versions TEXT,      -- JSON: { fieldName: version }
  sync_dirty INTEGER DEFAULT 0,  -- 0 = clean, 1 = needs push
  notion_page_id TEXT,     -- Maps D1 row to Notion page
  updated_at DATETIME,
  updated_by TEXT,
  PRIMARY KEY (id, table_id)
);
```

---

## Limitations

1. **No real-time sync** -- Sync is polling-based (2-minute cron interval). Changes made in Notion are not reflected in Wasabi until the next pull.
2. **Field mapping is manual** -- Users must configure which Wasabi columns map to which Notion properties. Auto-detection is not implemented.
3. **No webhook support** -- Notion webhooks would enable real-time pull, but Notion's webhook API is limited and would require an external server.
4. **Type mismatches** -- Notion property types (select, multi-select, relation) do not map 1:1 to Wasabi column types. Some data may be lossy on round-trip.
5. **No conflict resolution on pull** -- If the same row was edited in both Notion and Wasabi, pull overwrites the D1 version. Last write wins.
6. **Rate limits** -- Notion API allows 3-4 requests/second. Large databases may take significant time to sync.
7. **Schema drift** -- If the Notion database schema changes (columns added/removed), the sync config does not auto-update. The user must reconfigure.
