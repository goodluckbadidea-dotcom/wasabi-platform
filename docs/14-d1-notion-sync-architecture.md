# 14 — D1/Notion Sync Architecture: Notion as Integration, Not Dependency

**Created**: 2026-03-19
**Status**: Planning → Implementation
**Priority**: Critical — blocks conflict detection, MCP, automations, search, and all multi-user features for Notion-linked databases

## The Problem

Wasabi has two separate data paths that should be one:

1. **Linked Notion databases** — `resolveSourceType()` returns `"notion"`, data fetched live from Notion API on every page load. Never written to D1.
2. **Standalone D1 tables** — `resolveSourceType()` returns `"d1"`, data lives in `table_rows`. All features work.

This means Wasabi's most important databases (Projects, Vendor CRM, Core Inventory) get **none** of the platform features:

| Feature | D1 tables | Linked Notion |
|---------|:-:|:-:|
| Conflict detection (cell_versions) | ✅ | ❌ |
| MCP tools (all 29) | ✅ | ❌ |
| Automations & triggers | ✅ | ❌ |
| Notifications on changes | ✅ | ❌ |
| Record ownership / permissions | ✅ | ❌ |
| Search across tables | ✅ | ❌ |
| Analytics / aggregations | ✅ | ❌ |
| Neurons / cell links | ✅ | ❌ |
| Comments & notes | ✅ | ❌ |
| Dashboard widget queries | ✅ | ❌ |
| Offline resilience | ✅ | ❌ |

## Design Principle

**Notion is an INTEGRATION, not a DEPENDENCY.** D1 is the source of truth. Notion is a sync target. If Notion is down, Wasabi still works.

## Architecture Change

```
BEFORE:
  linked_notion page → fetchNotionDb() → Notion API → render
  d1 page → getTableRows() → D1 → render

AFTER:
  ALL database pages → getTableRows() → D1 → render
                                          ↑↓
                                    Background sync
                                          ↑↓
                                      Notion API
```

## Implementation Plan

### Phase A: Auto-Sync on Database Link

**Goal**: When a Notion database is linked to a Wasabi page, automatically configure sync and pull all data into D1.

**Files**: `src/core/PageShell.jsx`, `src/lib/api.js`, `worker.js`

#### Steps:

1. **Modify `handleAddDatabase` in PageShell.jsx**
   - After updating pageConfig with the new databaseId, call:
     ```javascript
     await configureSyncNotionDB(pageConfig.id, { notion_db_id: dbId });
     await syncPull(pageConfig.id, true); // full=true for initial pull
     ```
   - Show a loading indicator during initial sync ("Syncing database...")

2. **Enhance `handleSyncConfigure` in worker.js**
   - After creating sync_config, also generate and save a `table_schemas` entry
   - Map Notion property types → D1 column types:
     - `title`, `rich_text` → `text`
     - `number` → `number`
     - `select` → `select` (with options from Notion)
     - `multi_select` → `multi_select` (with options)
     - `date` → `date`
     - `checkbox` → `checkbox`
     - `url` → `url`
     - `email` → `email`
     - `phone_number` → `phone`
     - `people` → `people`
     - `files` → `files`
     - `relation` → `relation`
     - `formula` → `text` (snapshot of computed value)
     - `rollup` → `text` (snapshot of computed value)
     - `status` → `select`
     - `created_time`, `last_edited_time` → `date`
     - `created_by`, `last_edited_by` → `text`

3. **Enhance `handleSyncPull` in worker.js**
   - Already transforms Notion properties to D1 cells ✅
   - Already creates/updates rows in table_rows ✅
   - Need to: also update the table_schemas entry when new Notion properties are detected (schema drift handling)
   - Need to: set `page_type` to `"database"` on the page_config after successful initial pull (so resolveSourceType returns "d1")

4. **Add initial sync endpoint for existing databases**
   - `POST /sync/bootstrap` — finds all page_configs with `notion_database_id` in databaseIds that have NO sync_config, creates sync configs, and runs full pulls
   - This handles the migration of existing linked databases

### Phase B: Switch Data Source Resolution

**Goal**: All synced databases read from D1 instead of Notion.

**Files**: `src/lib/dataSource.js`

#### Steps:

1. **Modify `resolveSourceType(pageConfig)`**
   - Current logic: checks `page_type` and presence of `notion_database_id` to return `"notion"`
   - New logic: if the page has a sync_config (indicated by page_type being "database" or a flag), return `"d1"`
   - Fallback: if page_type is still `"linked_notion"` (pre-migration), return `"notion"` temporarily

2. **Modify `fetchDataSource()`**
   - The `"d1"` path already works — reads from `getTableRows()` and maps to view-compatible format
   - Verify: schema resolution works for synced databases (table_schemas populated in Phase A)

3. **Modify `updateRecord()`**
   - D1 path already writes to table_rows with merge_cells ✅
   - The sync_dirty flag on the row triggers push to Notion via cron ✅
   - No changes needed — just verify the sync push handles the mapped fields correctly

4. **Modify `createRecord()`**
   - D1 path creates a new table_row ✅
   - sync_dirty=1 triggers push to Notion ✅
   - Need to verify: the push creates a new Notion page with correct property mapping

5. **Modify `deleteRecords()`**
   - D1 path deletes/archives the row
   - Need to: also archive the corresponding Notion page on sync push

### Phase C: Migration of Existing Databases

**Goal**: Populate D1 for all currently linked Notion databases.

#### Steps:

1. **Run bootstrap sync**
   - Call `POST /sync/bootstrap` (from Phase A step 4)
   - This finds all linked Notion databases, configures sync, and runs full pull
   - Expected: Projects (32 records), Vendor CRM (~20), Core Inventory (~100+), Oregon Sell Thru (~50)

2. **Verify data integrity**
   - Compare row counts: D1 vs Notion for each synced database
   - Spot-check cell values for correct type transformation
   - Verify schema columns match expected types

3. **Update page_configs**
   - Set `page_type` to `"database"` for all successfully synced pages
   - This switches `resolveSourceType` to the D1 path

### Phase D: Keep D1 Fresh

**Goal**: D1 stays in sync with Notion changes made outside Wasabi.

#### Steps:

1. **Staleness check on page load**
   - When a synced database page is opened, check `sync_configs.last_synced_at`
   - If older than 5 minutes, trigger an incremental pull in the background
   - Don't block page render — show D1 data immediately, update if pull finds changes

2. **Cron pull (optional)**
   - Extend `runSyncFlushTick` to also run incremental pulls for active sync configs
   - "Active" = last accessed within 24 hours (tracked via user_state or record_views)
   - Rate limit: max 1 pull per table per 5 minutes

3. **Schema refresh**
   - On each pull, compare Notion database schema with D1 table_schemas
   - If new properties found, add them as new columns
   - If properties renamed, update column names
   - If properties removed, mark columns as hidden (don't delete data)

4. **Manual refresh button**
   - Already exists in SyncPanel — "Pull (incremental)" and "Full Resync"
   - Make this accessible from the page header (not buried in settings)

## Data Flow After Implementation

```
User edits record in Wasabi
  → Write to D1 table_rows (immediate)
  → Set sync_dirty = 1
  → Cron pushes to Notion (within 2 minutes)

User edits record in Notion
  → Next incremental pull detects change
  → Write to D1 table_rows
  → Frontend receives updated data on next fetch/refresh

New Notion database linked
  → Auto-configure sync
  → Full pull populates D1
  → Page renders from D1
  → Bidirectional sync active
```

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Large initial pull (1000+ records) | Paginated pull (Notion API returns max 100 per request). Show progress bar. |
| Schema drift (Notion columns change) | Schema refresh on each pull. Add new columns, don't delete old ones. |
| Relation properties (cross-DB links) | Store as text/ID references. Resolve display names via page_configs.titles endpoint. |
| Formula/rollup properties | Store as static snapshots. Update on sync. Mark as read-only in UI. |
| Concurrent Notion edits during sync | Incremental pull uses last_edited_time filter. Conflict detection (Phase 1) handles overlaps. |
| Initial migration breaks existing views | Gradual rollout: run bootstrap, verify data, then flip resolveSourceType. Keep "notion" fallback. |

## File Inventory

| File | Change | Phase |
|------|--------|-------|
| `worker.js` | handleSyncConfigure: auto-generate table_schemas. handleSyncPull: schema drift. New /sync/bootstrap endpoint. | A |
| `src/core/PageShell.jsx` | handleAddDatabase: auto-configure + pull on link | A |
| `src/lib/api.js` | Add bootstrapSync() function | A |
| `src/lib/dataSource.js` | resolveSourceType: return "d1" for synced databases. Remove Notion direct-fetch path. | B |
| `wrangler-worker.toml` | No changes needed | — |

## Success Criteria

1. All linked Notion databases have matching rows in D1 table_rows
2. MCP tools return actual data for linked databases (not empty)
3. Conflict detection works on Notion-sourced data
4. Automations can trigger on Notion-sourced record changes
5. Search finds records across all databases (not just standalone D1 tables)
6. Data persists if Notion API is temporarily unavailable
