# D1/Notion Sync Architecture

## Current State (2026-03-20)

Wasabi uses **Notion-linked databases in bypass mode**: data is NOT synced to D1. Instead:

1. **D1 is used only for:** Standalone tables, system config (pages, automations, etc.)
2. **Notion databases are read-only** from the Wasabi frontend
3. **All Notion reads go through the worker** (via Notion API proxy)
4. **No real-time sync back to Notion** - changes made in Wasabi stay in D1 only
5. **Notion data never written back to Notion** from Wasabi

---

## The Problem: Notion-Linked Databases Bypass D1

### Current Data Flow

```
Notion Database (in Notion)
  ↓ (frontend queries via worker proxy)
Wasabi Frontend (displays live Notion data)
  ↓ (user makes edits in Wasabi)
D1 Table (stores changes locally)
  ❌ (NOT synced back to Notion)
```

### What This Blocks

1. **Conflict Detection**
   - Can't track cell versions for Notion-linked DBs
   - Multiple users editing same Notion DB in Wasabi → lost updates
   - No version tracking in Notion API

2. **MCP (Model Context Protocol)**
   - Can't grant Claude access to Notion-linked data
   - D1 data can be passed to Claude via SQL
   - Notion data has no versioning/sync layer

3. **Automations & Rules**
   - Rules read D1 tables only
   - Notion-linked DB changes not visible to automations
   - No triggers on Notion data changes

4. **Search & Indexing**
   - Search only indexes D1 data
   - Notion-linked DBs not searchable

---

## Planned Sync Architecture (Not Yet Implemented)

### Design Goal

Make **D1 the source of truth** for ALL data:

```
Notion Database
  ↓ (periodic sync)
D1 Table (source of truth)
  ↓ (bidirectional sync)
Wasabi Frontend
  ↑ (reverse sync)
Notion Database (optional: sync back)
```

### Step 1: One-Way Sync (Notion → D1)

**Initialization:** When user links a Notion database

```javascript
async function syncNotionDbToD1(notionDbId) {
  // 1. Fetch schema from Notion
  const schema = await detectSchema(workerUrl, notionKey, notionDbId);

  // 2. Create D1 table with matching schema
  const tableId = await createD1Table(notionDbId, schema);

  // 3. Fetch all pages from Notion
  const pages = await queryAll(workerUrl, notionKey, notionDbId);

  // 4. Insert into D1
  await bulkInsertRows(tableId, pages);

  // 5. Mark page as "synced" (store notion_page_id in D1)
  await savePage Config({
    databaseIds: [notionDbId],
    d1TableId: tableId,
    lastSyncAt: now(),
  });
}
```

### Step 2: Periodic Sync (Keep D1 Updated)

**Schedule:** Every 5-30 minutes (configurable)

```javascript
async function syncNotionToD1Periodic(notionDbId, d1TableId) {
  // 1. Get cursor of last sync
  const lastCursor = await getLastSyncCursor(d1TableId);

  // 2. Query Notion for changes since last cursor
  const changes = await queryNotion(notionDbId, { startCursor: lastCursor });

  // 3. For each changed page:
  //    - If deleted: DELETE from D1
  //    - If updated: UPDATE in D1
  //    - If new: INSERT into D1

  // 4. Store new cursor for next sync
  await saveLastSyncCursor(d1TableId, changes.nextCursor);
}
```

### Step 3: Reverse Sync (D1 → Notion, Optional)

**Config:** Only if user enables "two-way sync"

```javascript
async function syncD1ToNotionOnChange(tableId, rowId, changes) {
  if (!isTwoWaySyncEnabled(tableId)) return;

  const notionDbId = getLinkedNotionDbId(tableId);
  const notionPageId = await mapRowToNotionPage(rowId);

  // Update Notion page properties
  await updatePage(notionDbId, notionPageId, changes);
}
```

---

## dataSource.js: Abstraction Layer

**File:** `src/lib/dataSource.js`

Normalizes reads from any source (D1, Notion, Monday) without the frontend caring about differences.

### Source Type Detection

```javascript
export function resolveSourceType(pageConfig) {
  const pt = pageConfig.page_type || pageConfig.pageType;

  if (pt === "database") return "d1";
  if (pt === "standalone_table") return "d1";
  if (pt === "linked_notion") return "d1";  // ← Data synced to D1
  if (pt === "linked_monday") return "monday";
  if (pt === "linked_sheet") return "linked_sheet";

  if (pageConfig.databaseIds?.length) return "d1";  // Legacy
  return "none";
}
```

### Fetch Normalization

```javascript
export async function fetchDataSource(pageConfig, user) {
  const type = resolveSourceType(pageConfig);

  switch (type) {
    case "d1":
      return await fetchD1Table(pageConfig);
    case "notion":
      return await fetchNotionDb(pageConfig, user);
    case "monday":
      return await fetchMondayBoard(pageConfig, user);
    default:
      return { data: [], schema: null };
  }
}
```

### Output Format (Normalized)

All sources return same format:

```javascript
{
  data: [
    {
      id: string,
      properties: {
        [fieldName]: {
          type: "title" | "text" | "number" | "select" | "multi_select" | ...,
          [typeSpecific]: value,
        },
      },
      created_time: ISO8601,
      last_edited_time: ISO8601,
      _databaseId?: string,  // for multi-db queries
    },
  ],
  schema: {
    id: string,
    title: string,
    fields: [
      {
        id: string,
        name: string,
        type: "title" | "text" | "number" | ...,
        config?: {},
      },
    ],
    // ... classified schema
  },
  schemas: {
    [dbId]: schema,  // multi-db support
  },
}
```

---

## Current D1 Schema for Notion Sync

```sql
CREATE TABLE page_configs (
  id TEXT PRIMARY KEY,
  -- ... page config fields ...
  databaseIds TEXT,  -- JSON array of Notion DB IDs
  d1TableId TEXT,    -- D1 table ID if synced
  lastSyncAt DATETIME,
  syncStatus TEXT,  -- "idle" | "syncing" | "failed"
);

CREATE TABLE table_rows (
  id TEXT,
  table_id TEXT,
  cells TEXT,  -- JSON of all cell values
  cell_versions TEXT,  -- JSON: { fieldName: version }
  sync_dirty BOOLEAN,  -- Needs sync back to Notion?
  notion_page_id TEXT,  -- Maps D1 row to Notion page
  updated_at DATETIME,
  updated_by TEXT,
  PRIMARY KEY (id, table_id)
);

CREATE TABLE sync_cursors (
  table_id TEXT PRIMARY KEY,
  notion_cursor TEXT,  -- Notion query cursor for incremental sync
  last_sync_time DATETIME,
);
```

---

## Migration Path

### Phase 1: Detection (Current)
- Frontend knows about linked Notion DBs via `databaseIds`
- Reads still go directly to Notion via worker proxy
- No D1 tables created

### Phase 2: One-Way Sync (Planned)
- User clicks "Sync to D1" on Notion-linked page
- Creates D1 table, imports all Notion data
- Enables conflict detection (cell versioning)
- Enables automations/search on that DB

### Phase 3: Periodic Sync (Planned)
- Standalone sync service keeps D1 in sync with Notion
- Runs every 5-30 minutes
- Incremental: only fetches changed pages

### Phase 4: Two-Way Sync (Optional)
- Enable reverse sync: D1 changes → Notion
- User controls this per-table
- Respects Notion property types (select, text, etc.)

### Phase 5: Full Replacement
- All Notion data flows through D1
- Notion is purely a source of truth (read-only from Wasabi)
- Wasabi can have internal-only fields in D1

---

## Known Issues & Gaps

### 1. No Sync Conflict Resolution

**Problem:** If same page edited in both Notion and Wasabi:

```
Notion: Title = "Project A"
Wasabi: Title = "Project A Updated"

Periodic sync runs → overwrites Wasabi change
```

**No detection of conflicts.** Last write wins.

### 2. No Rollback Plan

**Problem:** If sync corrupts data:

```
D1 table accidentally cleared
→ Next sync overwrites it with bad data
→ No way to restore
```

**No backups, no version history, no undo.**

### 3. Notion API Limitations

**Sync constraints:**
- No cursor-based pagination for incremental syncs (Notion deprecated it)
- No "deleted pages" marker — must query all pages each time
- Rate limits: 3-4 requests/second
- Schema changes not detected automatically

### 4. Bidirectional Sync is Lossy

**Example:**
- Notion: "Status" = select with values ["Todo", "Done"]
- Wasabi: Edit to "InProgress" (doesn't exist in Notion)
- Sync back to Notion → fails or truncates

**Types don't map 1:1 between systems.**

### 5. Multi-DB Joins Not Supported

**Problem:** Page has 2 linked Notion DBs:

```
databaseIds: ["db1", "db2"]
```

**If data synced separately:**
- db1 → d1_table_1
- db2 → d1_table_2

**But which rows to fetch? Both? In what order?**

Currently undefined behavior.

---

## Implementation Checklist (For Future)

- [ ] Add `d1TableId` field to page_configs
- [ ] Add sync status tracking to page_configs
- [ ] Create `syncNotionToD1()` function in worker
- [ ] Create periodic sync job (Cron DO or scheduled fetch)
- [ ] Add UI: "Sync Notion DB to D1" button
- [ ] Add UI: "Sync Status" indicator
- [ ] Implement conflict detection using cell_versions
- [ ] Add rollback mechanism (backup before sync)
- [ ] Optional: bidirectional sync with conflict resolution
- [ ] Optional: real-time webhooks from Notion (requires external server)

---

## Why Current Design Was Chosen

### Rationale for Bypass Mode

1. **Simplicity:** No sync complexity at launch
2. **Speed:** Direct Notion reads are fast enough for small DBs
3. **Flexibility:** Users can edit in Notion and see changes immediately
4. **Minimal Code:** No sync service needed

### Trade-offs Accepted

- ❌ No conflict detection
- ❌ No automations on Notion data
- ❌ No full-text search on Notion data
- ❌ No offline support
- ✅ Simple architecture
- ✅ Always in sync with Notion
- ✅ Read-only changes don't require sync

### When to Switch to D1 Sync

**Switch when:**
1. Multiple users need to edit same Notion DB in Wasabi
2. Automations need to trigger on Notion data
3. Search needs to index Notion data
4. Offline support needed
5. Performance becomes issue (large DBs)

---

## Testing Sync

### Manual Test Plan

```
1. Create Notion DB with 3 pages
2. Link to Wasabi page
3. Verify frontend reads all 3 pages
4. Create new page in Notion
5. Verify Wasabi sees it (no refresh)
6. Edit a page field in Wasabi
7. Refresh Wasabi → verify change persisted locally
8. Edit same field in Notion
9. Refresh Wasabi → which wins?
```

### Automated Tests Needed

- [ ] syncNotionToD1 imports all pages correctly
- [ ] Incremental sync doesn't duplicate rows
- [ ] Deleted pages are handled
- [ ] Schema changes are detected
- [ ] Cell versions match after sync
- [ ] Conflict detection triggers correctly
