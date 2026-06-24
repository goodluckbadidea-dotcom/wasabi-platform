# 02 — Features & Capabilities

## Product Context

Wasabi is an AI-native workspace where users build persistent semantic scaffolding -- through database views, knowledge bases, and relationship networks (Neurons) -- that makes AI interactions more accurate and contextual over time. It is not a Notion alternative; it is a platform for constructing the structured context that AI draws from. See `docs/00-wasabi-overview.md` for the full description.

---

## Two Interface Modes

Wasabi has two modes, toggled from the header. Persisted in `localStorage: wasabi-app-mode`.

| Mode | Internal Key | Source | Purpose |
|------|-------------|--------|---------|
| **Features** | `features` | `src/features/` (19 files) | Personal productivity: tasks, calendar, email, notes, dashboard |
| **Workspace** | `samurai` | `src/views/` (28 files) + `src/core/` (37 files) | Shared data views, page builder, automations, flows |

---

## Features (`src/features/`)

Personal productivity surface. User-scoped data. All components lazy-loaded.

### Views

| Component | File | Purpose |
|-----------|------|---------|
| TasksView | `src/features/TasksView.jsx` | Personal task list + calendar integration |
| CalendarView | `src/features/CalendarView.jsx` | Day/week/month calendar with Google Calendar sync |
| RecordDrawer | `src/features/RecordDrawer.jsx` | Slide-out record editor (primary edit surface for all views). "Go to Task" button uses `navigateToRecord()` to open RecordDetail drawer after navigating to source database. |
| WasabiPanel | `src/core/WasabiPanel.jsx` | The Wasabi agent chat panel (only chat surface). Fetches Google + Microsoft 365 context in parallel via `Promise.allSettled` so connected users get email/calendar context in the system prompt. **2026-05-05:** the previous dual-tab `features/ChatPanel.jsx` (Assistant + Agent toggle) was removed; the floating panel now always runs the full agent. Hidden from viewers. Editors get a restricted tool set (no destructive admin tools). |
| GmailView | `src/features/GmailView.jsx` | Gmail inbox, read, compose, reply |
| FigmaView | `src/features/FigmaView.jsx` | Browse Figma team projects and files. Project sidebar, file thumbnail grid, search/filter, file detail panel. Multi-select import creates/reuses a "Design Assets" database with status tracking (Draft/In Review/Approved/Archived). De-duplicates by file key. **2026-05-11 (Phase 1):** "Open in App" button takes over the FigmaView area with an `<iframe src="https://www.figma.com/embed?embed_host=wasabi-platform&url=…">`. 48 px header strip (file icon + name + Open in Figma + Comments toggle + ×). Escape closes. Sign-in hint banner surfaces after 4s. **2026-05-11 (Phase 2):** Comments button in the header opens a 360 px native comment panel (`src/features/FigmaCommentPanel.jsx`) that reads/writes via the workspace Figma PAT — worker prefixes every outgoing message with `[<wasabi user> via Wasabi]: ` so the original author isn't lost behind the shared identity. Polls every 30s while open. No resolve action (Figma's public REST API doesn't expose one). |
| FigmaCommentPanel | `src/features/FigmaCommentPanel.jsx` | Side panel inside the Phase 1 viewer. Lists comments grouped into threads with replies via `parent_id`, supports posting, replying, deleting own comments, @-mentioning Wasabi users (reuses `<MentionInput>` + the same `extractMentions` → `notifications` pipeline as record comments — see Phase 2 below). Each comment has a "Link to record" action that opens `RecordPickerModal` for cross-system linking (Phase 3b). Strips the `[Name via Wasabi]:` prefix into a small badge so the body reads cleanly. |
| DashboardView | `src/features/DashboardView.jsx` | Customizable widget dashboard |
| WorkspaceBrowser | `src/features/WorkspaceBrowser.jsx` | Folder-based page navigation |
| KnowledgeHub | `src/features/KnowledgeHub.jsx` | Knowledge base browser |
| NotesView | `src/features/NotesView.jsx` | Markdown scratchpad with live preview |
| ~~ZenChatPanel~~ | _(removed)_ | Was extended AI chat panel; removed |
| EmailThreadDrawer | `src/features/EmailThreadDrawer.jsx` | Slide-out email thread viewer |

### Supporting Files

| File | Purpose |
|------|---------|
| `RecordDrawerContext.jsx` | Context provider for drawer open/close state |
| `TaskList.jsx` | Task rows, quick-add input, section grouping. Per-task expansion state (`expandedIds` Set + `toggleExpand`). `TaskRow` renders a chevron between the color bar and title when `task.subItems.length > 0`; click toggles inline expand. Expanded parents render their `subItems[]` as `SubItemRow` components — indented 38px, 12px text, status-color dot in place of the parent's color bar, tree-line connector, click opens the sub-item's RecordDrawer. `SubItemRollupChip` between title and DueBadge shows the sub count; flips to the Overdue palette + "X/Y" label when any sub is overdue (matches DueBadge's `dateChipColors` mapping). Manual ("My Tasks") rows render flat — sub-item UI only appears in the AI-curated section. (2026-05-07) |
| `taskHelpers.js` | Task utility functions, cache helpers (`getCached`, `setCache`, `getStaleCache`), interaction tracking (`persistInteraction`, `mergeInteractionAdjustments`, `loadInteractionLedger`) |
| `useTasksTable.js` | Hook for D1 task CRUD. Auto-provisions per-user "User Tasks" table on first use. Gates on `pagesLoaded` to avoid running against stale localStorage cache. Trusts saved `zen_tasks_table_id` from D1 user_state. |
| `useAICuratedTasks.js` | Hook for AI-curated tasks: scans D1 databases, enriches with signals, calls Claude Haiku for prioritization. Features: stale-while-revalidate caching (2hr TTL, cache key v15), event-driven invalidation via dirty flags, interaction-based deprioritization with time decay (user-scoped), D1-backed snooze, interaction-aware Claude prompt with formula suggestions, pipeline-aware date reasoning, people column matching, cross-user cache invalidation. **Scan pipeline (2026-04-17):** single `listNotifications` query for @mention detection (replaces per-task comment fan-out), role pre-filter before expensive enrichment, viewers skip enrichment entirely, consolidated single `listTaskInteractions` fetch per source, whitespace-normalized title matching for Claude response. **Sub-items end-to-end (2026-05-07):** `topLevelOnly` removed; rows partition client-side by `parent_row_id`; sub-items normalize against `db.subColumns` and attach to each parent's `subItems[]` (sorted via `sortSubItemsByParentContext` — parent-aware heuristic, no Claude call). Per-user flag pass + `pruneSubItems` apply the same role rule to sub-items. `compressTask` emits `subItemCount` / `overdueSubItemCount` / `onHoldSubItemCount` so Claude factors child state into parent ranking. Limits: MAX_DATABASES=25, MAX_ITEMS_PER_DB=1000. Client-side sort by `updated_at DESC` so newer activity surfaces first. |
| `useDismissedTasks.js` | Hook for dismissed task tracking (session-scoped, sessionStorage) |
| `useInsight.js` | Hook for AI-generated insights (sidebar insight, 7-day cache, user-scoped via userId param) |
| `calendar/` | Calendar sub-components (DayColumn, WeekListView, MonthGrid) |

### Record Editing

**All record editing happens through RecordDrawer.** Inline table editing is disabled. Clicking a row, card, event, or task opens the RecordDrawer slide-out panel for editing. This is the single edit surface for the entire application.

---

## AI-Curated Task System

**Source:** `src/features/useAICuratedTasks.js` (~1,100 lines), `src/features/taskHelpers.js`

The AI task curation system scans all D1 databases for task-like records, enriches them with per-user signals, calls Claude Haiku for intelligent prioritization, and presents a ranked task list in TasksView.

### Architecture (2026-04-17)

```
Mount → Show cached data instantly (stale-while-revalidate)
  → If cache stale (>30min) or dirty flag set → background rescan:
    1. Scan page configs for task-like databases (scoring heuristic, max 25)
    2. Fetch all rows from each (max 1000 per DB, parents + sub-items in one call)
       → Sort client-side by updated_at DESC (newer activity first)
       → Partition by parent_row_id; normalize sub-items via db.subColumns;
         attach as parent.subItems[] sorted by sortSubItemsByParentContext
    3. Fetch per source: activity, interactions (single combined call)
    4. Single listNotifications query → mentionedRecordIds Set
    5. Set cheap per-user flags on all tasks AND each parent's sub-items
       (ownership, assignment, mention)
    6. ROLE PRE-FILTER → drop tasks the user can't see BEFORE expensive work
       → pruneSubItems() applies the same per-row rule to each surviving
         parent's subItems[]
    7. Fetch active snoozes from D1 → filter snoozed tasks out
    8. [Non-viewers only] record views, neuron enrichment, interaction history,
       interaction breakdown (viewers skip — they fall through to date-sort)
    9. Call Claude Haiku with enriched data + formula suggestions + sub-item
       rollup signals (subItemCount, overdueSubItemCount, onHoldSubItemCount)
    10. Whitespace-normalize titles when matching Claude response back
    11. Merge interaction adjustments → cache → display
```

**Scan API calls: ~16 regardless of task count.** (Was ~90 at 30 tasks, would have been ~3000 at 1000 tasks without the refactor.) Per-task comment fan-out was replaced by a single notifications query, since the `notifications` table with `type='mention'` is the authoritative source for @mentions.

### Caching Strategy (Stale-While-Revalidate)

- **Cache key:** `wasabi_ai_tasks_v15_{userId}` in localStorage. History: v11 raised limits / sub-items excluded (2026-04-17), v12 sub-items grouped under parents (2026-05-07), v13 schema-category-aware done detection, v14 sub-items honor role filter, v15 server-side parent-owner propagation. Cleanup loop purges v8–v14 on next mount.
- **Cache TTL:** 30 minutes (background rescan trigger, not hard expiry)
- **On mount:** `getStaleCache()` returns data regardless of age → instant display
- **Background refresh:** `refreshing` state shows subtle indicator, not loading spinner
- **Event-driven invalidation:** `cacheDirty` flag triggers rescan on next effect cycle
- **Dirty triggers:** RecordDrawer save/delete, WebSocket `task_cache_invalidate`, `markDirty()` callback

### Interaction-Based Deprioritization

When users interact with tasks, scores adjust immediately and persist across remounts and rescans:

| Interaction | Score Weight | Persisted |
|------------|-------------|-----------|
| `view` | -1 | localStorage + D1 |
| `field_edit` | -2 | localStorage + D1 |
| `file_upload` | -2 | localStorage + D1 |
| `comment` | -1 | localStorage + D1 |
| `status_change` | -6 | localStorage + D1 |
| `dismiss` | -15 | localStorage + D1 |

**Time decay:** Today = full weight, yesterday = 50%, 2+ days = 25%.

**Persistence layers:**
1. **localStorage interaction ledger** (`wasabi_task_interactions_{userId}`): user-scoped, accumulates per-task interactions with timestamps. `persistInteraction()` writes, `mergeInteractionAdjustments()` applies to task lists. All functions accept `userId` parameter for scoping.
2. **D1 `task_interactions` table**: fire-and-forget write via `logTaskInteraction()` so Claude sees history on next scan.
3. **Claude prompt**: includes `formulaSuggestion` (e.g., "deprioritize 60%") and `interactionBreakdown` (e.g., "3 views, 2 field_edits today"). Claude follows the suggestion unless new external urgency exists.

### Snooze Feature (D1-backed)

Users can snooze tasks from the RecordDrawer (3 preset buttons: 2 hours, Tomorrow, Next week). Snoozed tasks are hidden from the active list and appear in a collapsed "Snoozed" section in TaskList.

- **Storage:** D1 `task_snoozes` table (cross-device)
- **Endpoints:** `POST /task-snoozes` (upsert), `GET /task-snoozes?user_id=X` (active), `DELETE /task-snoozes/:id` (un-snooze)
- **API:** `snoozeTask()`, `getActiveSnoozes()`, `unsnoozeTask()` in `src/lib/api.js`
- **Expiry:** Snoozed tasks with `snooze_until < now` are automatically excluded from the snooze filter on next scan
- **UI:** RecordDrawer shows snooze buttons for non-manual (AI-curated) tasks. TaskList shows collapsed "Snoozed (N)" section with "Wake" buttons.

### Workspace Insight

Claude generates a one-line insight (max 120 chars) alongside the task ranking. Cached separately (`wasabi_insight_{userId}`, 7-day TTL) — user-scoped so multi-user workspaces don't overwrite each other's insights. Displayed in the navigation sidebar via `useInsight(userId)` hook (polls localStorage every 5s). Falls back to "Visit Tasks to generate your workspace insight" after 10s if no cached insight exists. Sidebar shows truncated insight (3 lines) with click-to-expand popover.

**Response parsing:** Haiku 4.5 wraps JSON in markdown code fences despite prompt instructions. Assistant message prefilling is not supported on Claude 4.5+ models. Response text has code fences stripped before `JSON.parse`. The insight field is extracted separately from task ranking so a failure in one doesn't block the other. `max_tokens` set to 4096 to prevent JSON truncation.

**claudeKey timing:** The auto-scan effect checks for missing insight when deciding whether to skip a rescan. If tasks are cached but insight was never generated (because the first scan ran before `claudeKey` loaded from D1), the scan re-runs once the key is available.

### People Column Matching

Assignee detection handles both string-type and people-type columns. People columns store values as arrays of `{name, id}` objects (e.g., `[{name: "Kat", id: "abc123"}]`). In `normalizeD1Task()`, array values are flattened to comma-separated names for display. In the enrichment step, user matching checks both display name (string match) and user ID (array `.some(p => p.id === userId)`).

### Pipeline-Aware Prioritization

The Claude prompt includes pipeline reasoning instructions for tasks with multiple date fields:
- **Date field → status mapping:** Claude matches date field names to status values semantically (e.g., "Design Timeline" → "Design" status)
- **Ahead/behind schedule:** If the task status has advanced past a date's stage but that date hasn't lapsed, the task is ahead of schedule (lower priority). If the date has passed but status hasn't advanced, the task is behind (higher priority).
- **All dates sent:** `compressTask()` includes all date fields (not just nearest) so Claude can reason about the full timeline.
- **Hold states (boost):** "Waiting on Vendor", "Waiting on Deposit", "Quality Check", "Awaiting PO" — external dependencies needing proactive check-ins
- **Pause states (lower):** "Paused" — intentional pause, don't nag

### Cross-User Task Cache Invalidation

When a record is saved with a status/done field change OR an `owner_user_id` change (task reassignment), the worker broadcasts `task_cache_invalidate` to ALL active UserRoom Durable Objects. This ensures all users' task caches refresh when tasks are reassigned or progressed, not just the saving user's cache.

### Sub-Item Owner Propagation (server-side, 2026-05-07)

When a sub-item gains an owner — via `handleUpdateRow` (owner column edit) or `handleCreateRows` (creator becomes owner) — the worker walks up the `parent_row_id` chain and unions the new owner into each ancestor's `owner_user_id`. Implementation: `propagateOwnersToAncestors(env, tableId, parentRowId, addedOwners, originRowId, user)` in `worker/handlers/tables.js`. Each propagation writes an `audit_log` entry with `action='auto_assign_parent_owner'` and `details.added_owners` so users can see why they have parent access.

- **Additive only.** Removing an owner from a sub does NOT propagate — they may own the parent for other reasons.
- **Comment @mentions do NOT propagate** as ownership — a mention is a notification, not an assignment.
- **Multi-level chains supported.** Walks the full ancestor chain; visited-set guards against cycles.
- **Race-safe.** Read-modify-write produces correct supersets even under concurrent writes.
- **One-shot backfill in `worker/handlers/init.js`** runs on first `/init` after deploy. Self-disabling via `connections.parent_owner_backfill='done'` flag — same pattern as `relationships_initial_rebuild`. Re-run by manual deletion of the flag.
- **Frontend impact:** `applyRoleFilter` in `useAICuratedTasks.js` no longer needs a "promote parent if any sub-item involves user" band-aid — parents always carry sub-item owners after propagation. `pruneSubItems` still runs to filter each parent's `subItems[]` by the same per-row rule.

---

## Date Range Support

Date fields support optional end dates. A single `date` column type handles both single dates and date ranges — no separate column type.

### Storage Format

- **Single date:** plain string in cells — `"2026-04-01"`
- **Date range:** object in cells — `{ start: "2026-04-01", end: "2026-04-15" }`
- **Backward compatible:** existing plain string values continue working unchanged

### Data Path

| Layer | File | Behavior |
|-------|------|----------|
| Table cell editor | `CellEditor.jsx` | End date input always visible. `commit()` returns `{ start, end }` when end date set, plain string otherwise. |
| Table cell display | `CellDisplay.jsx` | Shows "Jan 15 – Apr 1" (en-dash) for ranges, "Jan 15" for single dates. |
| Data source write | `dataSource.js` `wrapAsNotionProp()` | Preserves `{ start, end }` when value is an object. |
| Data source read | `dataSource.js` `extractRawValue()` | Returns `{ start, end }` for dates with end, plain string otherwise. |
| Record detail display | `RecordDetail.jsx` | Uses `formatDate()` with en-dash separator for ranges. |
| Record detail editor | `RecordDetail.jsx` `DateEditor` | Already supported — two date inputs with "Set" button. Returns `{ start, end }` or plain string. |
| Gantt view | `Gantt.jsx` | Already reads `value.end` via `parseDateEnd()` — works automatically. |
| Calendar view | `Calendar.jsx` | Already spans multi-day when `raw.end` exists — works automatically. |
| Sort (useTableData) | `useTableData.js` | Already normalizes `typeof value === "object"` to `value.start` — works automatically. |

### Not Yet Implemented (Phase 2)

- Notion sync round-trip for date ranges (worker.js `readNotionPropValue` / `buildNotionPropValue`)
- Agent toolExecutor date range handling

---

## Option Colors (Table View)

Select, multi_select, and status column options in the Table view render as colored pills in row cells, column-header filter chips, and the RecordDetail drawer. Colors come from one source of truth: `col.options[i].color` on the schema, resolved through the existing `WASABI_COLORS` → `VIEW_PALETTE` pipeline in `src/design/tokens.js`.

### Architecture (2026-04-15)

- **One source of truth.** Per-option color lives on the schema (`col.options[i].color`) as a Notion-style color name key (`"red"`, `"orange"`, `"yellow"`, `"green"`, `"blue"`, `"purple"`, `"pink"`, `"brown"`, `"gray"`). The same keys are understood by `getSolidPillColor` for all three render surfaces.
- **Auto-assign at creation time.** Every option-creation path injects a color via `assignOptionColor(optionIndex)` from `dataSource.js`, which round-robins over the palette keys deterministically by index. Sites covered:
  - `OptionsManagerModal.handleAdd` — new option added via the "Manage Options" modal
  - `Table.handleCreateSchemaOption` — inline "+ Create new option" from `SelectEditor` in RecordDetail (routes parent/sub via `page._parentRowId`)
  - `useTableCellEdit.handleCreateOption` — in-cell `SelectPicker` "allow create" path
- **Load-time repair.** `fetchD1Table` in `dataSource.js` runs `repairOptionColors(cols)` on both `columns` and `sub_columns` after `dedupeColumnNames`. Any option with `color === "default"` or missing gets backfilled. User-picked colors (anything else) are preserved. Changes are fire-and-forget written back via `updateTableSchema` / `updateSubColumnSchema` so first paint isn't blocked. Deterministic so concurrent opens converge. Self-heals legacy native D1 tables created before the auto-assign rule.
- **No separate view-level color system for Table.** The `ViewSettingsPanel.jsx` COLOR SOURCE section (`ColorMappingSection`) is hidden for Table views via `!isTable && <ColorMappingSection .../>`. `colorMapping` prop drilling is removed from `TableRow.jsx` → `CellDisplay.jsx`. Select renderers call `getSolidPillColor(value, options, schemaOptions)` — the 3-arg form without override.
- **Other views still use `colorMapping`.** Kanban, Gantt, and CardGrid continue to render `ColorMappingSection` in View Settings and consume `viewConfig.colorMapping` through `_CellComponents.jsx`. They were deliberately not touched in the 2026-04-15 unification — only the Table view was migrated. TaskList uses its own `ColorMappingContext` + `resolveUnifiedColor` path and is out of scope entirely.

### Editing option colors

- **Manage Options modal** (`OptionsManagerModal.jsx`) is the only editor. Right-click a column header → Manage Options → pick colors per option. User-picked colors are preserved across the repair pass.
- **Status category selector (2026-04-15):** For `type: "status"` columns only, the Manage Options modal also shows a category dropdown next to each option (not_started / in_progress / complete / on_hold / cancelled). Categories are stored on `option.category` inside the existing JSON blob. See "Status Categories" section under Sub-Items.
- Inline cell editing of option colors (Notion-style) was considered and rejected for this pass — modal-only, one-click-to-edit was the simpler target.

---

## Owner Display (2026-04-16)

Owner is a system field (`table_rows.owner_user_id`, JSON array of user IDs) displayed across all database views. The display uses a shared `OwnerAvatars` component (`src/components/OwnerAvatars.jsx`) that renders icon-only circles (initial letter, gradient background, tooltip on hover).

### Table View

- **Display:** Icon-only avatar circles in the Owner column (previously showed pill + name text). Size 20px. Multiple owners rendered side by side.
- **Toggle:** Existing `showOwnerColumn` config key in ViewSettingsPanel (unchanged).
- **Picker:** `OwnerPicker` in `OwnerCell.jsx` — multi-select dropdown for assigning owners. Unchanged.
- **Filtering:** Owner appears as a filter chip row ("OWNER") when the column is enabled. Uses synthetic `__owner__` field name in FilterChips. Resolves owner IDs to display names via `teamUsers`.

### Kanban, Calendar, Gantt, CardGrid

- **Toggle:** `showOwner` config key in ViewSettingsPanel (new, distinct from table's `showOwnerColumn`).
- **User fetch:** Each view calls `listUserDirectory()` on mount when `showOwner` is enabled.
- **Display locations:**
  - **Kanban:** After NeuronBadge in card title row (size 18)
  - **Calendar:** In day popover item, after event title (size 16)
  - **Gantt:** In sidebar row, after progress badge, before sidebarFields (size 16)
  - **CardGrid:** Below title in card body (size 18)
- **Display-only:** Non-table views show owner but do not provide a picker for editing.

### Owner Filtering

Owner filtering uses a synthetic `__owner__` field injected into the FilterChips pipeline via the `extraFields` prop. This keeps owner (a system field) separate from schema-based `people` columns.

- **FilterChips.jsx:** `getChipFields()` accepts optional `extraFields` array. `applyChipFilters()` accepts `opts.teamUsers` for resolving `__owner__` filter values. Component displays `field.label` (falling back to `field.name`).
- **Callers:** Table (via `useTableData`) and Kanban build `ownerExtraFields` from unique owner names in the data.

### Owner Group-By (Kanban)

Kanban supports grouping by owner. When `config.columnField === "__owner__"`, columns are built from unique owner display names + "Unassigned". Multi-owner pages appear in the first owner's column. Drag-and-drop between owner columns is a no-op (no automatic owner reassignment). The "Owner" option appears in the ViewSettingsPanel Group By dropdown when `showOwner` is enabled.

---

## Sub-Items (Table View)

Sub-items are hierarchical child records within a D1 table. They share the same `table_rows` D1 table as parent records, distinguished by `parent_row_id`.

### Architecture

- **Storage:** Same `table_rows` table. Sub-item rows have `parent_row_id` set to the parent record's ID.
- **Schema:** Sub-item columns are stored separately in the page config as `sub_columns` (not in the parent `columns` array). Each sub-column has a `subcol_*` prefixed ID.
- **Title column:** The first sub-column always gets `type: "title"`. If a sub-column was created before this rule existed, `d1SchemaToClassified` and `d1RowToPage` both treat `idx === 0` as title regardless of stored type.
- **Default seed (2026-04-15):** `VisualPageBuilder.jsx` awaits `updateSubColumnSchema(pageId, [{id, name: "Name", type: "title"}])` after `savePageConfig` before calling `addPage`. New native D1 tables ship with a single default "Name" title sub-column so sub-item creation works from day one. Navigation happens AFTER the seed lands so there's no race.

### Data Flow

1. **Write path (2026-04-15):** `createRecord()` in `dataSource.js` uses `sub_columns` alone when `parentRowId` is set — no more parent+sub merge, which previously caused name-collision values (e.g. "Status" in both schemas) to route to the parent column. Title-detection index is computed within the sub-column array alone. The `effectiveType` correction mirrors `d1SchemaToClassified` logic (explicit `type: "title"` or idx===0) so `extractRawValue` reads the correct property key regardless of raw column type. `updateRecord()` takes an `isSubItem` option in its bag and routes column lookups strictly: `true` → `sub_columns` only; `false` → `columns` only; undefined → legacy parent-then-sub fallback. Throws loud scoped errors on miss instead of silently resolving to the wrong `col.id`. Both functions apply `dedupeColumnNames` to the fresh worker schema before lookup so the UI-side deduped name (e.g. `"Status (2)"`) matches. `PageShell.handleUpdate` threads `isSubItem: !!record?._parentRowId`.
2. **Read path:** `d1RowToPage()` iterates both parent columns and `subColumns`. Sub-column title values are wrapped in Notion-compatible `{type: "title", title: [...]}` format (not `rich_text`) so the cell renderer displays them correctly. Sub-item rows map sub-columns only; parent rows map parent columns only (unconditional split).
3. **Schema classification:** `d1SchemaToClassified()` is called separately for sub-columns to produce `schema._subSchema`. The table view uses `subSchema` for sub-item rows and parent `schema` for regular rows.

### Table View Integration (Table.jsx + src/views/table/)

The table view's sub-item logic is spread across the orchestrator and extracted sub-modules:

- **Ghost row:** `useSubItemGhost` hook (`table/hooks/useSubItemGhost.js`) manages sub-item ghost row state (`subItemGhostParent`, `subItemGhostValues`, `subItemGhostSaving`). Ghost cell rendering in `GhostRow.jsx`.
- **Row rendering:** `TableRow.jsx` renders both parent and sub-item rows, including expand/collapse toggle, sub-item mini-headers (uppercase, 11px), and the branch icon for creating sub-items.
- **Editable headers:** Sub-item column headers have full parity with parent headers. **Single-click** opens `SubColumnContextMenu` (250ms timer to disambiguate from double-click, matching parent header behavior). **Double-click** renames inline. **Right-click** opens the same menu at cursor. A chevron (`IconChevronDown`) renders before the label as a visible dropdown affordance.
- **Sub-column menu contents:** `SubColumnContextMenu` (`ColumnContextMenu.jsx`) offers Rename, Manage Options (for select/multi_select/status types), Change Type (full D1 type submenu mirroring parent), and Delete — full parity with `ParentColumnContextMenu`.
- **Column management:** `useColumnManagement` hook (`table/hooks/useColumnManagement.js`) handles `handleAddSubCol`, `handleRenameSubCol`, `handleDeleteSubCol`, and `handleChangeSubColType` via `updateSubColumnSchema`. Add/rename paths auto-suffix duplicate names (`"Status"` → `"Status 2"`) on both parent and sub-column operations to prevent the Notion-compatible `properties` object (keyed by name) from silently overwriting fields.
- **Add column dialog:** `AddSubColumnDialog` (`AddColumnDialog.jsx`) for creating new sub-columns.
- **Display columns:** `subColsList` = visible sub-columns (from `schema._subColumns`). When `subColumns` is empty, `subTitleField` returns `null` (no fallback to the parent title column name — that fallback silently broke sub-item creation by keying the ghost row to a field `createRecord` couldn't find in sub_columns). New D1 tables always have sub_columns populated (default "Name" seeded at create) so this empty path stays cold.
- **Tree data:** `useTreeData` hook (`src/lib/useTreeData.js`) handles expand/collapse state, `displayList` flattening, and parent-child relationships.
- **Sub-item toggle (2026-04-15):** `TableToolbar.jsx` shows a single pill-shaped "Expand Sub-Items" / "Collapse Sub-Items" toggle button when the table has sub-item rows. Auto-sizes to fit label text. Derives state from `expandedRows.size > 0`. Replaces the previous dual "All" buttons which were confusing and clipped by the fixed-width button style.
- **Filter pipeline:** `useTableData` separates sub-items from parent rows before applying chip filters, dropdown filters, and search. After filtering, sub-items whose parent survived are re-attached. This prevents sub-items (which lack parent column values) from being incorrectly excluded by filters.

### Status Categories (2026-04-15)

Status options now carry a semantic `category` field: `"not_started"`, `"in_progress"`, `"complete"`, `"on_hold"`, `"cancelled"`. This enables meaningful progress roll-up.

- **Schema:** `normalizeOptions()` in `dataSource.js` preserves `category` on option objects. `STATUS_CATEGORIES` is exported for UI consumers. Options without a `category` default to `"not_started"` for backward compatibility.
- **UI:** `OptionsManagerModal.jsx` shows a category dropdown next to each option row — only for `type: "status"` columns (not select/multi_select). Dropdown shows icon + label for each category, colored to match semantics (gray/blue/green/yellow/red).
- **Auto-assign:** New status options get `category: "not_started"` by default, both from the Manage Options modal (`handleAdd`) and from inline creation (`handleCreateSchemaOption` in Table.jsx).
- **Storage:** Categories live inside the existing `options` JSON blob on each column. No D1 migration needed.

### Sub-Item Roll-Up (2026-04-15)

Parent records with sub-items now have computed roll-up data attached as `page._rollup`:

- **Utility:** `src/lib/subItemRollup.js` exports `computeSubItemRollup(parentPage, childPages, parentSchema, subSchema)`. Pure function, no side effects.
- **Progress:** Reads the first status field on sub-schema, resolves each child's status option category. `complete` + `cancelled` = resolved. Returns `{ total, complete, percent }`.
- **Timeline range:** Scans all date fields on sub-schema across all children. Returns `computedStart` (earliest) and `computedEnd` (latest).
- **Conflict detection:** When parent has manually set dates AND children's computed range exceeds them, `hasConflict: true` with `conflictDetails` showing both ranges (Option B — visual warning, no auto-expand).
- **Data layer:** `fetchD1Table` in `dataSource.js` groups children by `_parentRowId`, computes roll-up, and attaches to each parent page. Available to all views without per-view recomputation.

### View-Level Sub-Item Support (2026-04-15)

| View | Sub-item behavior |
|------|-------------------|
| **Table** | Full support: tree expand/collapse, inline creation, independent sub-schema, filter pipeline separation |
| **Gantt** | Collapsible hierarchy. Parents show expand chevron; sub-items render indented with 75% opacity bars. Computed range bar (translucent) behind parent spans `_rollup.computedStart` → `computedEnd`. Conflict indicator (amber triangle) when children exceed parent range. Sub-item drag-to-reschedule with correct schema routing. Progress badge in sidebar. |
| **Kanban** | Sub-items hidden (filtered out before grouping). Parent cards show progress badge from `_rollup` (e.g. "2/4"). |
| **Calendar** | Sub-items excluded from main grid. Day popover shows expand chevron on parent events; clicking reveals indented sub-item list. |
| **RecordDetail** | Schema switch for all views via `RecordDetailPortals.jsx`. Sub-items opened from any view get `_subSchema`. |

### RecordDetail Integration (RecordDetail.jsx)

- Sub-item records do NOT show the "Sub-Items" tab (sub-items cannot have sub-items).
- Sub-item records show a "Parent" field linking to the parent record. The parent record's title is displayed (passed as `parentTitle` prop from Table.jsx), not the raw row ID.
- **Schema switch:** When `detailPage._parentRowId` is set, RecordDetail is passed `subSchema` instead of the parent `schema` so select/status dropdowns read the correct option lists and field types. This now also applies in `RecordDetailPortals.jsx` (used by Calendar and other views).
- **Inline option creation:** The `SelectEditor` component inside RecordDetail renders a "+ Create new option" input at the bottom of the dropdown whenever `onCreateOption` is provided. Typing a name and pressing Enter (or clicking Add) calls `handleCreateSchemaOption` in Table.jsx, which:
  1. Detects parent vs. sub-item routing via `page._parentRowId`.
  2. Fetches the current schema via `getTableSchema`.
  3. Appends the new option (dedup by name) to the target column. Status columns get `category: "not_started"`.
  4. Calls `updateTableSchema` (parent) or `updateSubColumnSchema` (sub-item).
  5. Refreshes, then auto-selects the newly created option.
  This removes the prior requirement of opening Manage Options first to pre-populate options before a select/status field was usable — applies to both parent and sub-item records.
- **Sub-Items tab (2026-04-15):** `RecordSubItems` component upgraded from read-only title list to interactive panel:
  - Each sub-item row shows: status category icon, title (clickable → opens nested RecordDetail), status pill, date, and open indicator.
  - `RollupSummary` component above the list shows: progress bar with "X of Y done", computed date range, and conflict warning (amber banner when sub-items exceed parent timeline).
  - Inline creation: text input at bottom creates sub-items via `createRows` with `parent_row_id`.
  - Clicking a sub-item opens a nested `RecordDetail` with `subSchema`.

---

## Workspace Mode (`src/views/` + `src/core/`)

Shared database views. Workspace-scoped with per-page permissions.

### Data Views (`src/views/`)

| View | File | Purpose |
|------|------|---------|
| Table | `Table.jsx` + `table/` (17 files) | Spreadsheet-like grid with columns, filters, sorting, inline cell editing, sub-items, editable column headers, and options management modal. Orchestrator (~1,205 lines) + extracted sub-modules in `src/views/table/`. |
| Kanban | `Kanban.jsx` | Card-based board grouped by status/select columns |
| Gantt | `Gantt.jsx` | Timeline bar chart for date-range records |
| Calendar | `Calendar.jsx` | Calendar view of date-based records |
| Form | `Form.jsx` | Form for data collection. Falls back to `pageConfig.id` for D1 tables. Uses SelectPicker/MultiSelectPicker with inline option creation. |
| LinkedSheet | `LinkedSheet.jsx` | Read-only Google Sheets/CSV viewer |
| DocumentEditor | `DocumentEditor.jsx` | Rich text document with blocks |
| Document | `Document.jsx` | Document page container |
| CustomView | `CustomView.jsx` | User-authored HTML/JS views |
| NetworkGraph | `NetworkGraph.jsx` | Visual graph of record relationships |
| NotificationFeed | `NotificationFeed.jsx` | Notification inbox with filtering, click-through to source record, sticky recently-read items |
| ActivityFeed | `ActivityFeed.jsx` | Record activity/change log |
| CardGrid | `CardGrid.jsx` | Card grid layout with image/title/description |
| Charts | `Charts.jsx` | Data visualization (bar, line, pie, etc.) |
| SummaryTiles | `SummaryTiles.jsx` | Metric summary cards |
| ChatPanel | `ChatPanel.jsx` | Workspace-scoped AI chat |
| RecordDetail | `RecordDetail.jsx` | Record detail drawer with tabs: Properties, Sub-Items (D1 parent records only), Comments, Files. Receives `parentTitle` prop for sub-item records. DateEditor supports date ranges ({ start, end }), uses refs for Enter key handling to avoid stale React state. Save calls `onUpdate` per field (not batch) — parent views (Table, Kanban, Calendar, CardGrid) pass `onUpdate` directly (no wrapper). Collaboration banner shows user names via collabRef pattern. Text field inputs use `RADIUS.md` (rounded rectangle). |

**Note:** `src/views/CalendarView.jsx` was deleted (dead code). The active calendar is `src/views/Calendar.jsx` for Workspace mode and `src/features/CalendarView.jsx` for the Calendar View.

### View Supporting Files

| File | Purpose |
|------|---------|
| `ViewRenderer.jsx` | Routes page config to the correct view component |
| `_CellComponents.jsx` | Shared cell renderers for table/kanban/form |
| `_viewHelpers.js` | Shared utility functions for views |
| `NewRecordModal.jsx` | Modal for creating new records |
| `FilterChips.jsx` | Filter UI pills for view filtering |
| `ConnectionRenderer.jsx` | Renders connection/relation links |
| `NodeCanvas.jsx` | Canvas for node-based flow editor |
| `NodeConfigPanel.jsx` | Configuration panel for flow nodes |
| `NodeRenderer.jsx` | Individual node rendering in flow editor |
| `WorkspaceSettings.jsx` | Per-workspace settings panel |

### Shell Components (`src/core/`)

| Component | File | Purpose |
|-----------|------|---------|
| PageShell | `PageShell.jsx` | Orchestrator: loads page config, fetches data, renders active view |
| TopHeader | `TopHeader.jsx` | Top bar (52px): wordmark, breadcrumb, theme toggle, command palette, user menu |
| Navigation | `Navigation.jsx` | Left sidebar (56px collapsed / 220px expanded): page list, search, system nav |
| WasabiPanel | `WasabiPanel.jsx` | Right panel (320px default): AI chat, activity log, notifications |
| CommandPalette | `CommandPalette.jsx` | Cmd+K searchable overlay for pages, shortcuts, actions |
| ConfirmDialog | `ConfirmDialog.jsx` | Reusable confirmation modal for destructive actions |
| LoginScreen | `LoginScreen.jsx` | Multi-user login with password |
| SetupWizard | `SetupWizard.jsx` | First-run setup: worker URL, secret, admin creation |
| SystemManager/ | `SystemManager/` | Settings hub (9 files): overview, connections, settings, users, audit log |

### SystemManager (`src/core/SystemManager/`)

Refactored from a single file into a folder with 9 files:

| File | Purpose |
|------|---------|
| `SystemManager.jsx` | Main container with tab routing |
| `index.js` | Re-exports |
| `OverviewTab.jsx` | System overview / health dashboard |
| `ConnectionsTab.jsx` | Google, Notion, Monday.com, Claude connections |
| `SettingsTab.jsx` | Workspace preferences, theme, AI model settings |
| `UsersTab.jsx` | User management, invites, roles |
| `AuditLogTab.jsx` | Audit trail viewer |
| `components/ConnectionRow.jsx` | Individual connection status row |
| `components/GoogleConnectionRow.jsx` | Google OAuth connection row |
| `components/IdRow.jsx` | ID display row |
| `components/StatCard.jsx` | Statistic card widget |

### Other Core Components

| Component | File | Purpose |
|-----------|------|---------|
| PageBuilder | `PageBuilder.jsx` | Create/configure custom pages |
| VisualPageBuilder | `VisualPageBuilder.jsx` | Drag-and-drop page layout builder |
| AutomationBuilder | `AutomationBuilder.jsx` | Automation rule creator/editor |
| AutomationPage | `AutomationPage.jsx` | Automation management page |
| NodeEditor | `NodeEditor.jsx` | Visual flow/DAG editor |
| FunctionBuilder | `FunctionBuilder.jsx` | Custom function creator |
| FunctionsPanel | `FunctionsPanel.jsx` | Custom functions list panel |
| KnowledgeBase | `KnowledgeBase.jsx` | Knowledge base management |
| DatabaseBrowser | `DatabaseBrowser.jsx` | Browse and select databases |
| ChatUI | `ChatUI.jsx` | Shared chat UI component |
| BatchQueue | `BatchQueue.jsx` | Batch operation queue UI |
| BuildPage | `BuildPage.jsx` | Page creation wizard |
| ContextMenu | `ContextMenu.jsx` | Right-click context menu |
| CreateMenu | `CreateMenu.jsx` | "+" create new item menu |
| DashboardWidget | `DashboardWidget.jsx` | Individual dashboard widget |
| Drawer | `Drawer.jsx` | Generic slide-out drawer |
| ErrorBoundary | `ErrorBoundary.jsx` | React error boundary wrapper |
| FolderDropdown | `FolderDropdown.jsx` | Folder picker dropdown |
| InlineEdit | `InlineEdit.jsx` | Inline text editing component |
| LinkPicker | `LinkPicker.jsx` | Three-panel drill-down picker for cross-page cell links (Pages → Views → Data Grid). Supports D1, Notion, and linked sheet sources (2026-04-15). |
| MiniView | `MiniView.jsx` | Compact view preview |
| Onboarding | `Onboarding.jsx` | New user onboarding flow |
| PluginWidget | `PluginWidget.jsx` | Sandboxed plugin iframe |
| SheetUrlDialog | `SheetUrlDialog.jsx` | Google Sheets URL input dialog |
| SubPageNav | `SubPageNav.jsx` | Page header bar (title, refresh, view switcher) |
| ViewTypePicker | `ViewTypePicker.jsx` | View type selector |
| WasabiFlame | `WasabiFlame.jsx` | Animated flame logo |
| WasabiOrb | `WasabiOrb.jsx` | Animated orb decoration |

---

## AI System

### Components (`src/agent/`)

| File | Purpose |
|------|---------|
| `runAgent.js` | Agent loop: prompt, classify, route to model, execute tools, respond |
| `toolExecutor.js` | 71+ tool implementations: CRUD pages/rows, email (Gmail + Outlook full parity), calendar (Google + Outlook full parity incl. free/busy), automations, neuron CRUD, per-record context (`get_record_context` mega-tool), workspace structure (`list_pages`/`list_users`/`list_notifications`), documents, page permissions, cell links. 2026-05-04 expansions: read tools + Phase 5C/D Outlook write parity. |
| `queryClassifier.js` | Determines query complexity, routes to Haiku (fast/cheap) or Sonnet (complex) |
| `tools.js` | Tool definitions (name, description, parameters) for Claude |
| `automations.js` | Cron-triggered automation engine: evaluates rules, executes actions |
| `flowExecutor.js` | DAG-based flow execution: trigger, conditions, actions, delays |
| `dataSummary.js` | Builds data context for AI within token budget constraints |

### Query Routing

`queryClassifier.js` analyzes each user message and returns a routing decision:

- **Strategy** — how to approach the query
- **Complexity** — simple, moderate, complex
- **Model** — Haiku (fast, cost-optimized) or Sonnet (complex reasoning)

The agent has access to 50+ tools covering CRUD operations, email, calendar, automations, flows, functions, notifications, and custom queries.

### How AI Uses the Scaffolding

1. **Knowledge Base** (`knowledge_base` D1 table) — User-curated domain rules and business context, injected into every AI system prompt
2. **Neurons** (`neurons` + `neuron_nodes` D1 tables) — Named relationship clusters linking records, pages, and fields. AI receives hydrated neuron context (actual field values) filtered by relevance to the user's query. Full CRUD via 7 tools (see Neurons section). Context budget competition compresses workspace summary when neurons are rich.
3. **Page Structure** — Organization of pages, folders, and views tells the AI what matters
4. **Automation History** — Past execution logs provide operational patterns

---

## Neurons (`src/neurons/`)

Named relationship clusters that form the semantic scaffolding. 5 files:

| File | Purpose |
|------|---------|
| `NeuronsContext.jsx` | Global neurons state and CRUD. Pre-warms hydrated neuron cache on load. |
| `NeuronOverlay.jsx` | Visual overlay rendering nodes + connections |
| `NeuronLines.jsx` | SVG lines connecting neuron nodes |
| `NeuronBadge.jsx` | Neuron indicator badge |
| `neuronStorage.js` | Persistence, caching (list/graph/hydrated), and AI context builders |

### What Neurons Do

Neurons are named relationship clusters linking:
- Records across different tables
- Pages and views
- External data sources (calendars, emails)
- Arbitrary fields

Visual representation: nodes (circles) connected by lines, color-coded per neuron. Hover highlights connections; click navigates to the linked entity. The Wasabi agent uses neurons as its primary navigation tool for cross-table reasoning.

### Hydrated Neurons

The worker endpoint `GET /neurons/hydrated` returns neurons with actual field values from connected records (not just labels). For each node, the worker joins `neuron_nodes` → `table_rows` → `page_configs` to extract up to 3 key fields per row, prioritized by type: `status > select > date > number`. Cap: 30 neurons, 10 nodes each.

Single-neuron hydration is available via `GET /neurons/:id/hydrated` (no node cap).

### Neuron Caching (neuronStorage.js)

Three separate localStorage caches with 5-minute TTL:

| Cache | Key | Content |
|-------|-----|---------|
| List | `wasabi_neurons` | Neuron names + node counts |
| Graph | `wasabi_neuron_graph` | Full graph with node labels |
| Hydrated | `wasabi_neuron_hydrated` | Nodes with actual field values |

All three caches are invalidated together on any CRUD operation.

### AI Context Injection

`buildFilteredNeuronContext(query, maxNeurons)` scores neurons by keyword relevance to the user's message:
- Neuron name match: +3 per keyword
- Node label match: +2 per keyword
- Hydrated field value match: +1 per keyword

Falls back to `buildNeuronContextSummary()` (unfiltered, priority chain: hydrated → graph → list) when no keywords are extracted.

### AI Neuron Tools

The Agent has full CRUD tools for neurons:

| Tool | Purpose |
|------|---------|
| `query_neurons` | Query neuron graph by node ID or list all |
| `query_neuron_data` | Get hydrated data for a single neuron |
| `create_neuron` | Create neuron with initial nodes |
| `update_neuron` | Rename a neuron |
| `delete_neuron` | Delete neuron and all nodes |
| `add_neuron_node` | Add a node to an existing neuron |
| `remove_neuron_node` | Remove a node by entity ID |

Editors get neuron read + non-destructive write tools (`query_neurons`, `query_neuron_data`, `create_neuron`, `update_neuron`, `add_neuron_node`). The destructive ones (`delete_neuron`, `remove_neuron_node`) are admin-only.

Write tools require user approval when the workspace `agent_confirm_writes` setting is on (admin-set in SystemManager → Settings).

### Context Budget Competition

When neuron context is rich, the system compresses or skips the workspace summary to save tokens:
- If neuron + page tokens exceed 80% of the variable budget (~4000 tokens): compress workspace summary to page names only
- If neurons reference >80% of workspace databases: skip workspace summary entirely
- KB context and current page context are never compressed

---

## Automations

**Source:** `src/agent/automations.js` + worker.js cron trigger

### Trigger Types

| Trigger | Description |
|---------|-------------|
| `schedule` | Cron expression (e.g., every day at 9 AM) |
| `page_created` | When a new record is added |
| `status_change` | When a field changes to a specific value |
| `field_change` | When any field changes |
| `manual` | Triggered by user click |

### Action Configuration

Each rule has an `action_config.instruction` — an AI prompt that supports `{{field}}` template variables. The instruction is executed by Claude Haiku (cost-optimized).

**Storage:** D1 table `automation_rules` (name, trigger_type, trigger_config, action_config, enabled, scope_table_id)

**Execution:** Cloudflare Worker cron trigger runs every 2 minutes, evaluating all enabled schedule rules.

---

## Flows

**Source:** `src/agent/flowExecutor.js`, `src/core/NodeEditor.jsx`

Multi-step workflows defined as DAGs (directed acyclic graphs).

### Node Types

| Type | Purpose |
|------|---------|
| `trigger` | Start node (manual, schedule, event) |
| `action` | Execute an AI instruction or tool |
| `condition` | Branch based on logic |
| `delay` | Wait before continuing |

### Flow Structure

```
graph: {
  nodes: [{ id, type, config }],
  edges: [{ source, target }]
}
```

Action nodes use `config.instruction` for AI-powered steps. Flows execute on the server (Cloudflare Worker) and support retry logic for failed nodes.

---

## Custom Functions & Plugins

**Source:** `src/agent/toolExecutor.js`, `src/core/FunctionBuilder.jsx`

### Function Types

| Type | Purpose |
|------|---------|
| `transform` | Map/filter data |
| `aggregation` | Summarize data (sum, average, group) |
| `forecast` | Predictive analysis |
| `alert` | Conditional notifications |
| `pipeline` | Multi-step data processing |
| `view` | Custom view rendering (HTML/CSS/JS) |
| `plugin` | Full plugin with manifest (rendered in iframe) |

### Sandbox

User-authored code executes in a `new Function()` sandbox with:
- 5-second timeout (`setTimeout` deadline guard)
- Infinite loop detection
- `JSON.stringify` + `escapeHtml` for XSS prevention
- Blocked keywords list

**Storage:** D1 table `custom_functions` (name, type, code, inputs, outputs, meta, status)

---

## Extensions (custom-coded reports)  *(in development — 2026-05-15)*

> **Status: Under development.** The framework is wired end-to-end and
> deployed, but is being shaken out on a single live template
> ("Inventory & Production"). Schema and tool shapes may change before
> the feature is announced as stable.

**Source:** `worker/handlers/extensions.js`, `src/features/ExtensionViewer.jsx`, `src/core/BuildPage.jsx` (Extensions tab), `mcp-server/index.js` (tools 30 + 31)

An "Extension" is a **hand-coded HTML+CSS+JS template** with an embedded
`{{DATA}}` placeholder and a JSON Schema describing valid DATA shapes.
Unlike Views and Plugins (which are user-configurable in-app), Extensions
are authored externally — typically with Claude in Cowork on a local
`.html` file — and then registered into Wasabi via MCP.

### Core concepts

| Concept | What it is | Lives in |
|---------|------------|----------|
| **Extension** | Named template (e.g. "Inventory & Production"). Renderer code + DATA schema + sample DATA. One per report type. | D1 `extensions` table. Listed read-only in Knowledge Hub → Build → Extensions. |
| **Snapshot** | A concrete generated report = (Extension HTML) + (DATA blob) → rendered HTML stored in R2. One row in the Reports DB per snapshot. | D1 `extension_snapshots` (metadata + DATA). R2 at `extensions/{ext_slug}/{snap_slug}.html`. |
| **Reports DB** | Auto-created workspace database (page id `system_reports`). Each snapshot adds one row. Click → drawer → "Open report" CTA → renders inside Wasabi. | Bootstrapped on `/init` (v9+). Columns: Title, Report Type, Reference, Status, Visibility, Generated, Generated by, Summary. |

### MCP-driven authoring & generation

**Phase 1 — author** (external, one-time per template):

1. Build the template HTML locally with Claude/Cowork
2. Register via MCP: `wasabi_extensions create` with `name`, `html`, `data_schema`, `sample_data`, `theme_preference`

**Phase 2 — generate snapshots** (MCP, repeatable):

1. User drops source files (POs, photos, sheets) on desktop
2. Tells Claude: *"generate an Inventory & Production report using these files, slug 'q2-handoff'"*
3. Claude parses source files → builds DATA matching the template's schema
4. Claude calls `wasabi_extension_snapshots generate` → DATA validated, HTML rendered to R2, Draft row created in Reports DB
5. Claude calls `wasabi_search` / `wasabi_data` / `wasabi_neurons` to find related workspace records, proposes links in chat
6. User picks which connections to commit; Claude adds them via `wasabi_extension_snapshots add_link` (neurons or record comments)
7. User opens the Draft in Wasabi, clicks **Publish** in the ExtensionViewer

### Snapshot lifecycle

- `draft` → just generated; Reports DB row exists but flagged Draft
- `published` → after user hits Publish; visible in Reports DB as Published

### Visibility

- `workspace` (default) → authenticated workspace users only
- `public` → anyone with the URL can view (R2 HTML served without auth)

### Composition pattern

"Generate a new report using last week's data but the updated template":

1. `wasabi_extension_snapshots get_data id=<old_snapshot>` → returns DATA blob
2. Claude modifies the DATA as instructed
3. `wasabi_extension_snapshots generate` with the new DATA → new snapshot

Old snapshots stay frozen at their template version. The
`extension_snapshots.template_version` column records which version
rendered each snapshot.

### Validation

The worker has a hand-written ~100-line JSON Schema subset validator
(in `worker/handlers/extensions.js`) supporting: `type`, `required`,
`properties`, `additionalProperties`, `items`, `enum`, `minimum`,
`maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `pattern`.
Snapshots whose DATA fails validation are rejected with `422` and a
list of `validation_errors` referencing JSON paths.

### Frontend viewer

`src/features/ExtensionViewer.jsx` fetches the rendered HTML via the
authed API (so workspace-visibility snapshots are reachable inside
Wasabi without exposing the URL publicly), drops it into a sandboxed
`<iframe srcDoc>` with `sandbox="allow-scripts allow-popups"`, and
optionally `postMessage`s the current Wasabi theme tokens so templates
with `theme_preference: "inherit"` can adopt the user's active theme.

The drawer for a Reports DB row (`RecordDetail.jsx`) shows a prominent
"Open report" banner — clicking it routes to the
`extension-snapshot:<id>` `activeRightPane` value handled in `App.jsx`.

### In-app AI awareness

The in-app Wasabi agent gained three tools so it can answer questions
about generated reports without flailing through `query_database`:

- `list_extensions` — discover available templates
- `list_extension_snapshots` — find snapshots, optionally filtered by extension or status
- `get_snapshot_data` — read the validated DATA blob for a specific snapshot

`src/agent/wasabiPrompt.js` routes report-related questions to these
tools explicitly.

### Storage

| Table / store | Purpose |
|---------------|---------|
| D1 `extensions` | Template definitions (HTML, schema, sample, theme preference, version) |
| D1 `extension_snapshots` | Snapshot metadata + DATA blob + R2 key + lifecycle state |
| D1 `page_configs` row id `system_reports` | The Reports database itself (auto-bootstrapped, versioned via `connections.extensions_reports_db_bootstrap`) |
| R2 key `extensions/{ext_slug}/{snap_slug}.html` | Rendered HTML, ready to serve |

See `docs/09-config-data-models.md` for the full table schemas and
`docs/12-mcp-server.md` for the MCP tool surface.

---

## Knowledge Base

**Source:** `src/core/KnowledgeBase.jsx`, D1 table `knowledge_base`

User-curated domain rules and business context. Each entry has:
- `key` — unique identifier
- `category` — grouping (e.g., `business_rules`, `agent_config`)
- `content` — the knowledge text
- `source` — origin reference
- `related_pages` — linked page IDs

Knowledge base entries are injected into the AI system prompt on every agent interaction, giving the AI persistent domain awareness without requiring re-explanation.

---

## Notification System

### Overview

Notifications are **user-scoped** — every user (including admins) sees only notifications targeted at them. There is no admin bypass that shows all notifications.

### Notification Sources

| Source | Trigger | Target |
|--------|---------|--------|
| Comment on owned record | User A comments on a record owned by User B | Record owner(s) (excludes commenter) |
| @mention in comment | User types `@Name` in a record comment | The mentioned user (including self-mentions) |
| @mention in note | User types `@Name` in a record note | The mentioned user (including self-mentions) |
| Automation/system | Automation rule or system event | Specified target or broadcast |

### @Mention System

- **Regex:** `/@[\w]+(?=\s|$|[.,!?;:])/g` — matches `@` followed by word characters, terminated by whitespace, end-of-string, or punctuation
- **Resolution:** Extracted names are matched case-insensitively against `users.display_name`
- **Self-mentions:** Allowed. A user can @mention themselves and will receive the notification.
- **Dedup guard:** Duplicate mention notifications (same type, record, target, actor) within 5 minutes are skipped
- **Available in:** Record comments (`RecordComments.jsx`) via `MentionInput` component

### Notification Click-Through

When a user clicks "Go To Task" on a notification that has `record_id` and `page_config_id`:
1. `NavigationContext.pendingRecordId` is set to the target record ID
2. `setActiveRightPane(pageConfigId)` navigates to the database page
3. `PageShell` mounts, detects `pendingRecordId`, finds the matching row in data
4. Opens `RecordDetail` drawer for that record automatically
5. Clears `pendingRecordId`

### Sticky Recently-Read Items (Unread Tab)

When viewing the Unread tab, clicking a notification marks it as read but keeps it visible in the list (as a "sticky" item) so the user can expand, reply, or click through without the item vanishing mid-interaction. Sticky items show with dimmed/read styling. The sticky set is cleared when:
- The user switches between Unread/All tabs
- The user clicks Refresh
- The user clicks "Mark all read"

### Instant Badge (WebSocket Push)

The sidebar notification badge updates instantly via WebSocket, not just polling:
1. Worker's `createNotificationInternal()` inserts notification into D1
2. Worker sends `{ type: "notification_new" }` to target user's `UserRoom` Durable Object
3. `UserSyncContext` receives the message and fires `onNotificationNew` handlers
4. `Navigation.jsx` subscribes and increments `notifUnreadCount` immediately
5. Polling at 60s serves as fallback only

### Worker Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `createNotificationInternal()` | worker.js | Inserts notification + WebSocket push to target user |
| `extractMentions()` | worker.js | Regex extraction of @mention names from text |
| `handleCreateComment()` | worker.js | Comment creation + owner/mention notification triggers |

---

## Shared Components (`src/components/` — 25 files)

Reusable UI components used across multiple views:
- `OwnerAvatars.jsx` — Icon-only owner avatar circles (shared by Table, Kanban, Calendar, Gantt, CardGrid)
- `StateIndicators.jsx` — SkeletonLoader, EmptyState, ErrorState
- `ColumnBuilder.jsx` — Column type configuration
- `MultiSelectPicker.jsx` — Multi-select dropdown
- `WidgetGrid.jsx` — Dashboard widget grid
- And 20+ others for forms, pickers, and data display

---

## Context Providers (`src/context/` — 11 files)

React context providers wrapping the app in `App.jsx`:

| Context | Purpose |
|---------|---------|
| `AuthContext` | JWT auth, user session, refresh tokens |
| `PagesContext` | Page configs, CRUD, `pagesLoaded` flag, navigation state |
| `ThemeContext` | Theme switching, applyTheme() |
| `NavigationContext` | Route/view state management |
| `CollaborationContext` | Real-time sync via WebSocket (Durable Objects) |
| `ToastContext` | Global toast notification system |
| `ViewportContext` | Responsive breakpoints (isNarrow, isTablet, isTouch) |
| `UserSyncContext` | Per-user WebSocket room for presence |
| And 3 others | Supporting contexts |

---

## Data Sources

| Source | Storage | Access Pattern |
|--------|---------|----------------|
| D1 (SQLite) | Primary — all workspace data | Direct via worker.js API endpoints |
| Notion | Proxy — worker forwards to Notion API | Bidirectional sync via `sync_configs` table |
| Google Sheets | Cached — fetch + parse as CSV, 300s cache | Read-only, proxied through worker |
| Monday.com | Proxy — GraphQL forwarded through worker | Read-only, no write support |
| Figma | Proxy — REST API forwarded through worker | Browse projects/files, import as Design Assets records |
| R2 | File storage — documents, attachments, exports | Worker serves presigned URLs |

---

## Extensions (Custom-Coded Reports)

**Status:** In development (2026-05-22). Wired end-to-end and deployed; the
authoring workflow described here is canonical. See
[`docs/18-extensions.md`](18-extensions.md) for the full reference.

Extensions is Wasabi's generic report-generation feature. A user designs a
report as a self-contained HTML mockup, Claude (with filesystem access to
the user's source data folder) translates that into a live D1 template,
and Wasabi handles validation, snapshot lifecycle, and rendering. The
same workflow produces any report type — the platform layer is
data-agnostic.

### Two halves

- **Bootstrap (once per report type):** HTML mockup + source folder →
  Claude session → `wasabi_extensions create` writes template HTML
  (with `{{DATA}}` placeholder), strict JSON Schema, and a long-form
  markdown `definition` to the D1 row. After this the mockup file is
  vestigial.
- **Refresh / refine (recurring):** Fresh Claude session reads the D1
  row's `data_schema` + `definition`, parses new source data to match,
  validates, calls `wasabi_extension_snapshots update` or `generate`.

### Data model

- `extensions` (D1) — template definitions. Key fields: `html`,
  `data_schema`, `definition` (markdown for Claude),
  `sample_data` (dev-only fixture), `theme_preference`.
- `extension_snapshots` (D1) — concrete generated reports. Stores the
  validated DATA blob; rendered HTML lives in R2 at
  `extensions/{ext_slug}/{snap_slug}.html`. Lifecycle: `draft` → `published`.
- Reports DB (system page `system_reports`) — workspace-wide index of
  every snapshot, seeded by `worker/handlers/init.js`.

### Validation

The worker validates every snapshot DATA payload against the extension's
`data_schema` on generate and update. Bad shapes return `422` with a
`validation_errors` array. Schema discipline is the primary guardrail
against malformed snapshots.

### MCP authoring surface

- `wasabi_extensions` — template CRUD. Accepts `definition` field;
  tool description directs Claude to read `data_schema` + `definition`
  before any data write.
- `wasabi_extension_snapshots` — snapshot lifecycle. `get_data` reads
  prior DATA for diffing; `update` re-renders R2 HTML using the current
  template (so fixing template logic + re-pushing any snapshot picks up
  the fix).

### Frontend

- `src/features/ExtensionViewer.jsx` — sandboxed iframe renderer with
  Wasabi theme handshake via `postMessage`. Opened from a Reports DB
  row's "Open report" banner in `src/views/RecordDetail.jsx`.

### Authoring discipline

Six rules that make the workflow durable (full details in
[`docs/18-extensions.md`](18-extensions.md)):

1. **Local mockup is bootstrap-only.** After translation to D1, do not
   re-edit. The D1 row is the source of truth.
2. **All future edits via MCP on the D1 row** — template, schema,
   definition, data.
3. **`definition` is mandatory at create time** and updated whenever the
   conceptual model changes. Next session's Claude reads it first.
4. **Schema first, data second.** A strict `data_schema` catches bad
   shapes at the worker boundary. Class-of-bug → "should schema reject
   this?" — usually yes.
5. **Don't iterate template + data in the same change.** Push template,
   verify, then push data, verify.
6. **Discovery before push.** When updating data, produce a discovery
   report covering all source files first. Surface ambiguities as a
   batched interview, not a stream of one-off questions.

### Live extensions (in development)

- `inventory-production-v2` (`ext_2c786a9dc7fd`) — per-market packaging
  materials snapshot for the five Drops markets (NY, OR, CA, HEMP, NV).
  Tracks on-site inventory, at-Treeform warehoused inventory, and on-order
  shipments. Adds per-SKU stockout-risk analysis for markets with
  `sellThrough` metrics populated (CA only at time of writing). See
  `memory/project_extensions_feature.md` for current state.

---

## Cross-Page Cell Links

Cell links connect individual cell values across different pages/views. A user picks a source cell from one page and links it to a target cell on another, creating a one-way live reference.

### Architecture (2026-04-15)

- **LinkPicker** (`src/core/LinkPicker.jsx`) — Three-panel drill-down UI: Pages → Views → Data Grid. Supports three source types:
  - **D1 tables** (primary): fetches schema via `getTableSchema()` and rows via `listRows()`. Filters out sub-items. Builds lightweight schema with `allFields` for type compatibility checks.
  - **Notion databases** (legacy): uses `detectSchema()` + `queryAll()` through the Notion proxy. Requires `notionKey`.
  - **Linked Sheets**: fetches via `fetchSheetData()`. All cells treated as `rich_text`.
- **LinksContext** (`src/context/LinksContext.jsx`) — Global state for link CRUD and resolution. `fetchSourceData()` handles D1, Notion, and sheet sources with per-type caching (TTL-based). `resolveLinksForView()` resolves all links for a target page/view.
- **linkStorage** (`src/config/linkStorage.js`) — Persistence (D1 `cell_links` table) and value resolution. `resolveRef()` extracts cell values from D1 rows (by `record_id` + `column_name`), Notion pages (by `pageId` + `field`), or sheet rows (by `rowIndex` + `column`).

### Source Ref Types

| Type | Shape | Used for |
|------|-------|----------|
| `d1` | `{ type: "d1", record_id, column_name }` | Native D1 tables |
| `notion` | `{ type: "notion", pageId, field }` | Notion-linked databases |
| `sheet` | `{ type: "sheet", sheetUrl, rowIndex, column }` | Linked Google Sheets |

---

## Unified Relationships Subsystem (Phases 1–3, 2026-04-24 → 2026-04-25)

Wasabi has six independent ways to "connect things to other things" — neurons,
cell links, relation columns, parent/sub-item hierarchy, mentions, plus the
new `depends_on` task dependencies. The relationships subsystem is a unified
read + write surface that lets the AI agent and users query "what's connected
to this entity, and how?" with one call instead of six.

### Status at a glance

| Phase | Scope | Status |
|-------|-------|--------|
| **1** (2026-04-24) | Schema + endpoints + stub | ✅ Shipped |
| **2a** (2026-04-24) | Live mirroring of all five legacy systems | ✅ Shipped |
| **2b** (2026-04-25) | AI tools (`get_relationships`, `write_relationship`) + frontend `RelationshipsContext` + client API wrappers | ✅ Shipped |
| **3 Step A** (2026-04-25) | RecordDetail "Dependencies" tab | ✅ Shipped |
| **3 Step D** (2026-04-25) | Delete-time prompt when other records depend on the row | ✅ Shipped |
| **3 Step B** (2026-04-25) | Table "Depends on" column type | ✅ Shipped |
| **3 Step C** | Gantt dependency arrows | Skipped (decorative; revisit if needed) |
| **4** | First-class Relationships panel in RecordDetail with AI-inferred accept/reject | Pending |
| **5** | Per-system sunset migrations (rolling, opportunistic) | Pending |

### Architecture

| File | Purpose |
|------|---------|
| `worker/schema.js` | `relationships` + `relationship_types` table definitions, 5 indexes, `RELATIONSHIP_TYPE_SEEDS` constant for the day-one taxonomy |
| `worker/handlers/init.js` | Schema version bumped 4 → 5 to land the new tables; seeds executed via `INSERT OR IGNORE` after the index batch |
| `worker/handlers/relationships.js` | GET (with permission filter), POST (native writes only), DELETE (soft-delete via `deleted_at`) |
| `worker/handlers/relationshipProjections.js` | Five projector stubs + `rebuildProjections(env)` orchestrator. Phase 1 bodies are no-ops; the `DELETE FROM relationships WHERE origin LIKE 'projected_%'` slate-clear is in place so the idempotency contract is preserved when Phase 2 fills in projector bodies |
| `worker/auth.js` | `ROUTE_PERMISSIONS` entries: `/relationships` POST + DELETE require `editor`; GET falls through to default authenticated-user access (the edge-level filter inside the handler does the real scoping) |
| `worker.js` | Imports the three handlers and dispatches GET/POST/DELETE alongside the neurons/links blocks |

### Endpoints

**GET /relationships** — list edges, permission-filtered by caller ACL on
both `source_page_id` and `target_page_id`. Query params:

| Param | Default | Notes |
|-------|---------|-------|
| `entity_type` + `entity_id` | (omit for all) | Must be supplied together. Restricts edges to those touching the entity. |
| `direction` | `both` | `outgoing` (entity is source) / `incoming` (entity is target) / `both` |
| `types` (or `type`) | (all) | Comma-separated list of relationship types to filter on |
| `include_projected` | `true` | Set to `false` or `0` to exclude projected origins |
| `min_confidence` | `0` | Floor for AI-inferred edges; user-declared edges (NULL confidence) always pass |
| `include_deleted` | `false` | Set to `1` to include soft-deleted edges (cascade reasoning, audit) |

Response shape: `{ edges: [...], summary: { by_type: {...}, counts: { total } } }`

**POST /relationships** — create a native edge. Required body fields:
`type`, `source_type`, `source_id`, `target_type`, `target_id`, `origin`.
Optional: `source_page_id`, `target_page_id`, `confidence`, `meta`.

- `origin` must be `user_declared` or `ai_inferred`. Projected origins are
  rejected — those are written by `relationshipProjections.js` only.
- `ai_inferred` requires `confidence` as a number in `[0, 1)`.
- `type` must exist in `relationship_types` and not be deprecated.
- `directed` is read from the type registry, not the request body.
- Returns 409 on duplicate `(source_type, source_id, target_type, target_id, type)` for an active edge.

**DELETE /relationships/:id** — soft-delete via `deleted_at = now`. Idempotent
(returns `already_deleted: true` for already-deleted rows, 404 if the ID is
unknown).

### Permission filter

The list handler calls `buildPermissionFilter(env, user)`:

- **Admin and shared-secret (MCP) callers:** filter is bypassed.
- **Non-admin authenticated users:** the WHERE clause excludes edges whose
  `source_page_id` or `target_page_id` is restricted by an explicit
  `page_permissions.permission='none'` row for this user. Pages without any
  explicit permission row fall through to route-level role access — matching
  the default-open semantics of `checkPagePermission()` in `worker/auth.js`.

### Type taxonomy (day-one, seeded on /init)

| Type | Directed | Cascade | Source of truth |
|------|----------|---------|-----------------|
| `part_of` | yes | cascade | Phase 2 projection from `table_rows.parent_row_id` |
| `references` | yes | nullify | Phase 2 projection from `cell_links` |
| `related_to` | yes | nullify | Phase 2 projection from relation column arrays |
| `member_of_neuron` | yes | nullify | Phase 2 projection from `neuron_nodes` |
| `mentioned_in` | yes | ignore | Phase 2 projection from `notifications` (mention) |
| `depends_on` | yes | prompt | Phase 3 native (Gantt + Table column + RecordDetail) |
| `blocks` | yes | prompt | Phase 3 native (inverse of `depends_on`) |
| `similar_to` | no | ignore | AI-inferred (symmetric) |
| `conflicts_with` | no | prompt | Native (symmetric) |

### Idempotency contract

`DELETE FROM relationships WHERE origin LIKE 'projected_%'` followed by
`rebuildProjections(env)` must produce identical state. Native edges
(`user_declared`, `ai_inferred`) are never touched by rebuild. This contract
is documented at the top of `worker/handlers/relationshipProjections.js`.
Enforced by partial UNIQUE INDEX `idx_rel_uniq_active` on (source_type,
source_id, target_type, target_id, type) WHERE deleted_at IS NULL — added
in Phase 2a, schema version bumped 5 → 6.

### Phase 2a — live mirroring (2026-04-24)

All five legacy connection systems now keep the relationships table in sync
in real time as users mutate source data. Every write emits a projected edge
(or removes one) via origin-filtered helpers in
`worker/handlers/relationshipProjections.js`. Projection failures are caught
and logged so they cannot break user-visible saves; drift recovers on the
next `POST /relationships/rebuild`.

| Source system | Triggered on | Edge type | Origin |
|---|---|---|---|
| Sub-items (`parent_row_id`) | row create / update / delete (incl. cascade) | `part_of` | `projected_parent_row` |
| Cell links | POST/PATCH/DELETE `/links` | `references` | `projected_cell_link` |
| Relation column cells | row create / update (diff added vs removed IDs) / delete | `related_to` | `projected_relation_col` |
| Neurons | POST `/neurons`, POST/DELETE `/neurons/:id/nodes`, DELETE `/neurons/:id` | `member_of_neuron` | `projected_neuron_node` |
| @mentions in comments | `handleCreateComment` after notification creation | `mentioned_in` | `projected_mention` |

**Initial backfill** — automatic on first `/init` after the Phase 2a deploy
via a one-shot guard in `handleInit` keyed on the `relationships_initial_rebuild`
flag in the `connections` table. Self-disabling — re-runs go through
`POST /relationships/rebuild` instead. After the production backfill: 17
projected_cell_link + 12 projected_mention + 54 projected_parent_row edges.

### Phase 2b — AI tools + frontend infrastructure (2026-04-25)

**AI agent tools** (registered in `src/agent/tools.js` + executor in
`src/agent/toolExecutor.js`):

- `get_relationships({ entity_type, entity_id, types?, direction?, include_projected?, min_confidence? })` — read unified edges across all five sources + native edges. Permission filter applied server-side; AI cannot see edges in pages the user can't access. Available to the full agent and to all three assistant tiers (read-only).
- `write_relationship({ type, source_type, source_id, source_page_id?, target_type, target_id, target_page_id?, confidence, meta? })` — propose new edges. Origin is hardcoded to `ai_inferred` in the executor (the worker independently rejects mismatched origins as defense-in-depth). Confidence required in [0, 1). 409 duplicates returned as `{ skipped: true }` so the AI doesn't retry-loop. Available to the full agent only.

**Frontend infrastructure** (`src/context/RelationshipsContext.jsx` +
`src/lib/api.js` wrappers):

- `useRelationships()` hook exports `loadRelationships(filters, opts)`, `loadForEntity(entity_type, entity_id, opts)`, `createEdge(body)`, `deleteEdge(id)`, `invalidateAll()`, `cacheVersion`.
- 1-minute per-entity in-memory cache + concurrent-request deduplication.
- `cacheVersion` bumps after any write so consumers re-pull on the next render.
- Provider mounts in `App.jsx` next to `NeuronsProvider`.

### Phase 3 — first user-visible surfaces (2026-04-25)

**Step A — RecordDetail Dependencies tab.** New "Dependencies" tab in the
record drawer for D1-backed records (parent and sub-item rows). Two
sections: "Depends On" (upstream — this record is the source of a
`depends_on` edge) and "Blocks" (downstream — this record is the target).
Both sections write the same edge type; the picker just flips
source/target so the views are symmetric. Inline picker per section
searches the same database, excludes self + already-linked. Status icons
+ pills mirror the Sub-Items styling. × removes the edge via `deleteEdge`.
Click a name → opens that record nested.

**Step D — delete-time prompt.** When a user tries to delete a record that
other records have declared they depend on (active `depends_on` edges
where this row is the target), the worker returns 409 with
`hasDependents: true, dependentCount, dependentSample` (up to 5 dependent
titles, server-side resolved). PageShell catches this and opens
`DependencyDeleteDialog` listing the dependent task names. "Delete anyway"
retries the delete with `?confirm_dependents=1`; the projection sweep
auto-cleans the now-invalid edges. Origin filter (`depends_on` from
`user_declared`/`ai_inferred` only) ensures projected edges like
`part_of` from sub-items don't trigger this prompt — those still go
through the existing children-cascade flow.

**Step B — Table "Depends on" column type.** New column type in the
COLUMN_TYPES picker. The cell stores nothing — its content is a live view
of the relationships table. `DependsOnCell` loads outgoing `depends_on`
edges via `useRelationships().loadForEntity(...)` and displays up to 3
title pills with "+N" overflow. Title resolution uses a `recordTitlesById`
map memoized in Table.jsx from already-loaded `data` (zero extra fetches
for in-table titles; cross-database edges show UUID prefix until cross-db
resolution lands). Re-pulls when `cacheVersion` bumps after any
create/delete elsewhere in the app.

**Skipped: Step C (Gantt dependency arrows).** Decorative more than
useful for the current workflow. Revisit if a future user signal calls
for it.

---

## AI Tool Expansion — Read Coverage (2026-05-04)

**Source:** `src/agent/tools.js`, `src/agent/toolExecutor.js`, `src/agent/wasabiPrompt.js`, `src/microsoft/microsoftContext.js` (new).

The AI chat had 46 tools — but the app surfaced ~130 capabilities. Comments,
record notes, attached files, sub-items, page list, user directory,
notifications, document content, page permissions, cell links, and the entire
Microsoft 365 stack were dark to the AI. Practical effect: handoff reports
collapsed at "I can't access comments," and Outlook users got Gmail tools that
returned zero results then concluded "Google isn't connected."

Added 17 read tools across four buckets, plus prompt guidance and a Microsoft
context provider. Writes deferred — current rule is **read everything,
guardrails on writes**.

### `get_record_context` — One-Call Record Picture

Mega-tool that fans six fetches in parallel via `Promise.allSettled`:

- Record fields (via `queryTable` with `listRows` fallback)
- `listRecordComments`
- `getRecordNote`
- `listFilesByRecord` (toggleable)
- `listChildRows` (toggleable)
- `getLinksBySource`

Returns a single structured blob. Replaces 6–7 separate AI tool calls for any
"what's going on with X" question. Failures in one section don't kill the
others.

### Outlook / Microsoft 365 Tool Set

Mirror of the Gmail/Calendar set: `search_outlook_messages`,
`get_outlook_message`, `get_outlook_thread` (full conversation in chronological
order — critical for email-chain summaries), `list_outlook_events`,
`get_outlook_calendar_summary`. Plus `get_email_provider_status` which returns
both Google and Microsoft connection state in one call so the AI can route
correctly.

### Workspace Structure & Document Tools

- `list_pages` — full workspace page list (replaces "I'll guess if this page exists")
- `list_users` — user directory with names, roles, IDs
- `list_notifications` — read user's notification inbox
- `get_document` — full block-level content of Doc-type pages
- `get_page_permissions` — who has access to a page
- `list_links` — cell links by source or target page

### Microsoft 365 Context Provider

`src/microsoft/microsoftContext.js` mirrors `googleContext.js`. Both
`ChatPanel.jsx` and `WasabiPanel.jsx` now fetch both providers in parallel via
`Promise.allSettled` and inject both context blocks into the system prompt.
Without this, even with new tools the AI would default to Gmail because
"Microsoft Context" never appeared in the prompt.

### "How to Answer Common Questions" Prompt Section

Added to `_buildPrompt` in `wasabiPrompt.js`. Explicit rules: call
`get_email_provider_status` before choosing email tools; call
`get_record_context` for any record-level question; call
`list_pages`/`list_users`/`list_notifications`/`get_document` for the
respective surfaces. Includes the directive *"Never tell the user comments
are inaccessible — they are accessible."* Without this guidance the model
defaults to `query_database` for everything and never reaches for the new
tools.

### Tool Set Restructure (2026-05-05)

The Assistant feature was removed (single chat = the full Wasabi agent).
`ASSISTANT_TOOLS_*` and `ASSISTANT_READS` exports deleted. New
`getWasabiToolsForRole(role)` helper filters `WASABI_TOOLS` for non-admins:
admins get the full set, editors lose destructive admin-only tools (deletes,
sends, modifies, plugin saves, page-config writes, batch ops). Viewers get
no chat at all — the Wasabi flame button is hidden in `Navigation.jsx`.

### Deferred (Tier 3 reads + all writes)

- Reads: Flows CRUD, Figma tools, audit log query, sync controls, KB
  enumeration/deletion, user state/dashboard reads, connection status.
- Writes: `add_record_comment`, `save_record_note`, `update_document`,
  `set_page_permission`, `send_outlook_email`, calendar create/update/delete
  for Outlook, page admin (rename, reorder, delete) — all with confirm-mode
  gating per `agentMode`.

### Bug Fixes Bundled With This Work

- **`input/toolInput` ReferenceError** — every Gmail and Calendar tool call
  had been throwing at runtime (commit `c2e72d4`). See doc 15.
- **CORS missing `X-Cache-Hint`** — smart caching had been silently broken
  since 2026-03-10 (commit `a6c34e5`). Worker deploy. See doc 15.
- **Dashboard "Pin a View" silently failed** — `viewPrefs` out of scope
  inside `WidgetPickerInline` (commit `f0bf734`). See doc 15.

Commits: `c2e72d4`, `a6c34e5`, `162505e`, `f0bf734`.

---

## Microsoft 365 Phase 5 — Closed (2026-05-04)

**Source:** `worker/handlers/outlook.js`, `src/agent/tools.js`, `src/agent/toolExecutor.js`, `src/agent/wasabiPrompt.js`, `src/lib/api.js`, `src/features/UnifiedInboxView.jsx` (new), `src/features/CalendarView.jsx`, `src/App.jsx`, `src/core/Navigation.jsx`. Commits `4e94642` (worker, deployed `78652baa`) + `e28f979` (frontend).

Phase 5 had been pending since 2026-04-07 with the items "agent tools, unified views" still open. Closed in this session.

### 5C — Outlook Write AI Tools (8 new)
Brings Microsoft 365 to full Gmail parity in the AI surface. Worker handlers for send/modify/calendar already existed; this added missing draft endpoints and extended the modify action enum.

**Worker additions:**
- `handleOutlookCreateDraft` — POST /messages, returns id + conversationId.
- `handleOutlookUpdateDraft` — PATCH /messages/{id} for to/subject/body fields.
- `handleOutlookModify` extended action enum — now supports `archive` (move to Archive folder), `trash` (move to Deleted Items), `flag`/`unflag` (Microsoft equivalent of star), plus `mark_read`/`mark_unread` aliases for Gmail naming parity.
- Routes wired in `worker.js`: POST `/microsoft/mail/drafts`, PATCH `/microsoft/mail/drafts/:id`.

**API client (src/lib/api.js):** `createOutlookDraft`, `updateOutlookDraft`.

**AI tools (8 new):** `send_outlook_email`, `create_outlook_draft`, `update_outlook_draft`, `modify_outlook_message` (extended actions), `create_outlook_event`, `update_outlook_event`, `delete_outlook_event`, `check_outlook_freebusy`.

**Tool-set tiering:** Admin gets full Outlook write parity. Editor gets `create_outlook_event` + `create_outlook_draft` + `check_outlook_freebusy` (scheduling and drafting allowed; full send and delete are admin-only). Confirm-mode gating in `runAgent.js` applies automatically via `create_*`/`update_*`/`delete_*`/`send_*` name patterns.

**Prompt builder:** "How to Answer Common Questions" section enumerates Outlook writes alongside reads so the AI knows when to reach for them. Includes guidance to use `check_outlook_freebusy` for multi-attendee scheduling instead of guessing availability.

### 5D — Free/Busy Endpoint
- Worker handler `handleOutlookFreeBusy` calls `POST /me/calendar/getSchedule` against Microsoft Graph with `availabilityViewInterval: 30` (30-min granularity). Normalizes response to `{ calendars: [{ email, busy: [{ start, end, status, subject }] }] }`. Status enum: `free` / `tentative` / `busy` / `oof` / `workingElsewhere` / `unknown`.
- Worker route: POST `/microsoft/calendar/freebusy`.
- API client: `checkOutlookFreeBusy(timeMin, timeMax, attendees)`. Defaults to current user's calendar when no attendees given.
- AI tool: `check_outlook_freebusy(time_min, time_max, attendees?)`.

### 5A — Unified Inbox View

**New file:** `src/features/UnifiedInboxView.jsx` (~520 lines).

**Architecture:**
- Fetches Gmail + Outlook in parallel via `Promise.all` on `getGoogleStatus`/`getMicrosoftStatus` + `searchEmails`/`searchOutlookMessages`.
- Normalizes both into common shape: `{ key, provider, id, threadId|conversationId, from, fromName, subject, snippet, date, isRead }`. Key prefix `g:` or `o:` distinguishes provider for React keys.
- Merged list sorted by date DESC.

**UI:**
- Provider badges on every message — Gmail red with the M envelope, Outlook MS-blue with the four-square logo. `ProviderBadge` component exported for reuse.
- Filter pills: `All` / `Unread`, plus per-provider `Both` / `Gmail` / `Outlook`.
- Search bar searches both providers in parallel (debounced 400ms).
- Click message expands inline with full body, marks read on the correct provider via `modifyEmail`/`modifyOutlookMessage`.
- Reply opens compose modal locked to source provider.
- Compose new shows provider toggle when both connected (defaults to Outlook if Microsoft connected).

**Coexistence:** Does NOT replace `OutlookView` or `GmailView`. Per CLAUDE.md "never delete working code", existing single-provider views are preserved. Graham can decide later whether to retire them.

**Wiring:**
- `src/App.jsx`: lazy import `UnifiedInboxView`, route `activeRightPane === "inbox-unified"`.
- `src/core/Navigation.jsx`: new "Inbox" button shown when EITHER provider is connected. Combined unread badge (`unreadCount + outlookUnreadCount`). Placed above per-provider buttons. SYSTEM_PAGES set updated.

### 5B — Provider Tagging on Calendar Events
- `src/features/CalendarView.jsx`: every event normalized with `provider: "google" | "microsoft"` field after merging.
- Visual provider differentiation already existed via per-calendar color (`calendarColor: "#0078d4"` for Outlook). Color is the signal — no additional badges added in calendar tiles to avoid clutter.
- Provider field gives clean data for AI tool returns and any future UI consumers.

### Out of scope for this push (open backlog)
- Outlook attachment parsing (PDF/xlsx). Flagged earlier when Graham hit a Premier Press email chain where the latest quantities were in attachments and the AI couldn't see them.
- Tier 3 reads (Flows, Figma, audit log, sync, KB list, user state) still pending.

---

## Unified Inbox Consolidation (2026-05-04)

**Source:** `src/features/UnifiedInboxView.jsx`, `src/App.jsx`, `src/core/Navigation.jsx`. Commit `8dd0445`.

After Phase 5A shipped the Unified Inbox alongside `OutlookView` / `GmailView`, the navigation showed three nearly-identical email surfaces. Retired the single-provider buttons:

- `Navigation.jsx` no longer renders separate Outlook or Gmail buttons. The unified "Inbox" button is the only mail surface, shown when EITHER provider is connected.
- `App.jsx` removed the lazy imports for `GmailView` and `OutlookView`. The route handler now treats `activeRightPane === "gmail" || "outlook" || "inbox-unified"` as redirects to `UnifiedInboxView`, so any saved localStorage state pointing at the old surfaces still works.
- The `OutlookView.jsx` and `GmailView.jsx` files are intentionally retained on disk per CLAUDE.md "never delete working code." If we ever want to re-enable per-provider views, restore the imports + route blocks in two minutes.

---

## Inbox Thread Grouping (2026-05-04)

**Source:** `src/features/UnifiedInboxView.jsx`. Commit `e845f86`.

The first version of the Unified Inbox showed every email as its own row — an 8-message back-and-forth filled 8 inbox rows with the same subject. Graham flagged it as non-standard. Replaced with thread grouping that mirrors Gmail/Outlook's native UX:

### Thread grouping mechanics

`groupThreads(messages)` builds an array of thread aggregates from the flat message list. Grouping key:
- Gmail: `g:${threadId}` (falls back to `g:${id}` when no thread reference)
- Outlook: `o:${conversationId}` (falls back to `o:${id}`)

Each aggregate carries:
- `messages` (sorted newest-first within the thread)
- `latest` — the most recent message
- `latestDate`, `isAnyUnread`
- `sendersDisplay` — compacted unique participants ("Mark Brooks, Graham, Stuart" up to 3, then "+N")
- `messageCount` — visible-window count
- `displaySubject` — prefers the first non-"Re:" subject, falling back to the latest

Threads sort by `latestDate` DESC across both providers.

### List view behavior

- One row per thread.
- Provider badge (Gmail red / Outlook MS-blue) on each row.
- Sender list with overflow handling.
- Number badge next to senders when `messageCount > 1`.
- Subject prefers the non-"Re:" form when available.
- Most-recent snippet shown after the subject.
- Unread dot when ANY message in the thread is unread.

### Click-to-expand

Clicking a thread fetches the full conversation via `getThread(threadId)` (Gmail) or `getOutlookThread(conversationId)` (Outlook) — both endpoints already existed. The fetched messages render chronologically (oldest first, like Gmail's default) with sender + date + body per message. This means messages outside the 40-message inbox window are still visible on expand.

### Mark-read + reply

- Expanding a thread marks ALL unread messages in it as read on the correct provider in parallel via `Promise.all` (`modifyEmail` for Gmail, `modifyOutlookMessage` for Outlook). Local state updates without a refetch.
- The Reply button targets the latest message in the thread, so replies land on the active branch.

### Trade-off

Thread row's `messageCount` reflects only messages in the loaded inbox window (40 per provider). Very long threads may understate true thread length in the badge. The full thread loads on expand, so this only affects the at-a-glance count — same limitation as native Gmail/Outlook inbox UIs.

---

## Cell Links — Sub-Item Drill-Down + Cross-View Rendering (2026-05-04)

**Source:** `src/core/LinkPicker.jsx`, `src/context/LinksContext.jsx`, `src/config/linkStorage.js`, `src/views/table/CellDisplay.jsx`, `src/views/Gantt.jsx`, `src/views/Calendar.jsx`, `src/views/Kanban.jsx`, `src/views/CardGrid.jsx`. Commits `8e5b95b` + `32b696e`.

Two long-standing issues with cell links closed:

### Issue 1 — LinkPicker filtered out sub-items

`LinkPicker.jsx` had `(rowsRes.rows || []).filter((r) => !r.parent_row_id)` — sub-items were dropped on the floor, so sub-item-to-sub-item linking was impossible. Fixed:

- D1 fetch now stores raw data (schemaRes incl. `sub_columns` + all rows) in `rawD1` state so drill-in/back can switch view modes without refetching.
- Computes a `parentIdsWithChildren` Set so parent rows that have sub-items get a drill-in chevron in a new left-edge column.
- New `subItemContext` state. `handleDrillIn(rowEntry)` rebuilds viewData from `sub_columns` + rows filtered by `parent_row_id`. `handleDrillBack()` returns to the parent grid.
- Breadcrumb above the grid when drilled in: `← Back  |  Page Name › Parent Title › Sub-items`. Drill-in is disabled while in sub-item view (sub-items don't have grandchildren).
- `LinkPickerGrid` signature gained `onDrillIn`. Rows are now `{ pageId, cells, hasChildren }`. The chevron column is conditional on any row having children. Sheet path unchanged (still array-of-arrays).

Sub-item links use the same `sourceRef` shape as parent links — `{ type: "d1", record_id, column_name }`. Row IDs are unique within a table whether parent or sub-item, so no flag is needed in the ref.

### Issue 2 — Linked values invisible in views

`CellDisplay` accepted `value` but silently dropped the `linkedValue` and `linkInfo` props that `TableRow` was already passing. So a linked cell rendered the local (empty) value instead of the resolved source. And every other view (Gantt, Calendar, Kanban, CardGrid) read straight from `page.properties` without any link awareness — link rendering was Table-only and even there it didn't work.

#### Resolver fixes

- `linkStorage.resolveRef` for D1 type now branches on `row.parent_row_id`: sub-item rows look up their column in `sub_columns`, parent rows in `columns`. Same ref shape; the resolver picks the right schema set.
- `LinksContext.fetchSourceData` for D1 type now includes `sub_columns` in the returned `d1Data` alongside `columns`.

#### CellDisplay rendering

`CellDisplay` accepts new props: `linkedValue`, `linkInfo`, `onLinkClick`. When `linkInfo` is present:
- Uses `linkedValue` instead of `value`.
- `coerceLinkedValue(linkedValue, type)` parses the resolved string back into the renderer's expected shape: date strings like `"2026-05-01 – 2026-05-31"` parse to `{start, end}` for the date renderer; comma-joined multi-selects split back to arrays; `checkbox` and `number` coerce to typed primitives.
- Wraps the rendered output in `LinkedWrapper`: a small accent-colored link icon (uses `IconConnect`) plus a left-border accent stripe so users can tell at a glance that the value is sourced from another record. Stale links (resolveRef returned undefined) get error-colored treatment and `(source missing)` placeholder. Clicking the icon triggers `onLinkClick` to unlink.

#### Cross-view rendering pattern

Each non-Table view now follows the same wiring:

1. `import { useLinks } from "../context/LinksContext.jsx"`.
2. Derive `viewIdx` via `pageConfig.views.findIndex(v === config) ?? 0`.
3. Fetch `resolvedLinks` via `resolveLinksForView(pageConfig.id, viewIdx)` in a `useEffect`, store in state.
4. Wrap the field-read function so the link map is consulted before falling through to the regular read.

Per-view application:

- **Gantt** — In `buildBars`, before calling `readField(page, fieldName)`, check `resolvedLinks.get(\`${page.id}:${fieldName}\`)`. A `coerceLinkedDateValue` helper at the top of the file parses range strings back to `{start, end}` so the existing `parseDate` / `parseDateEnd` path keeps working. Sub-items inherit this for free since lookup keys on `page.id`.
- **Calendar** — Same `coerceLinkedDateValue` applied around the `readProp(page.properties[fieldToUse])` lookup. Both parent and sub-item date placement respect links.
- **Kanban** — `readFieldL` wrapper used at all five `readField(page, …)` sites: grouping value, sort comparison (a/b), card title, preview-fields existence check, preview-fields render. Linked status fields drive column placement; linked dates sort cards correctly.
- **CardGrid** — `readFieldL` wrapper at six sites: filter, search, sort, title, badge, body fields, metric fields.

`useMemo` dependency arrays include `resolvedLinks` (or the `readFieldL` callback that closes over it) so views re-derive when links resolve asynchronously.

### Result

Linking a cell from a parent record's date, sub-item's status, or any other field source produces a value that's visible in **every** view — table, timeline, calendar, kanban, card grid — with consistent rendering and a clear link affordance.

---

## Table UI — Variable Row Heights + Comment Auto-Grow (2026-05-04)

**Source:** `src/views/table/TableRow.jsx`, `src/views/table/tableStyles.js`, `src/components/RecordComments.jsx`, `src/components/MentionInput.jsx`. Commits `d82056e` + `b7096cb`.

Two superficial UI bugs that made dense content unreadable:

### Wrapped multi-select pills clipped by fixed row height

`ROW_HEIGHT = 36` was applied as a hard `height` on every row. `multiPillWrap` (`display: flex; flex-wrap: wrap`) wraps pills onto a second line for cells like Market with many state pills, but the row stayed 36px tall and the second line was hidden under the next row.

- `TableRow.jsx` — `height: ROW_HEIGHT` → `minHeight: ROW_HEIGHT` in both parent and sub-item row containers. Rows grow as their tallest cell needs.
- `tableStyles.js` — removed `overflow: "hidden"` from `gridRow` so the row can show grown content. Kept `overflow: "hidden"` on `gridCell` because removing it caused long single-line pills (`whiteSpace: nowrap`, e.g. "WAREHOUSED (DROPS FACILITY)") to bleed horizontally into the adjacent column. The cell's `overflow: hidden` clips horizontal overflow without preventing the cell box from growing vertically — wrapped flex content inside `multiPillWrap` extends the cell's content height, the cell box grows with it, and the row grows with the cell. Two separate fixes (`d82056e` introduced the row-grow path; `b7096cb` re-added cell overflow:hidden after observing the bleed regression).

**Trade-off documented:** virtualization math in `Table.jsx` still uses `ROW_HEIGHT * idx` to compute scroll positions. With variable row heights, the visible-window calc is slightly off, but `VIRT_BUFFER = 200` compensates for typical workspaces. Revisit if scroll-position bugs surface on large tables with many tall rows.

### Comment input clipped long messages

`RecordComments` used `MentionInput` without `multiline`, which renders a single-line `<input type="text">`. Long comments scrolled horizontally and the start of the message disappeared as the user typed.

- `RecordComments.jsx` — pass `multiline rows={1}` to `MentionInput`. `inputRow` gained `alignItems: "flex-end"` so the Send button stays anchored to the bottom edge as the textarea grows.
- `MentionInput.jsx` — added auto-grow effect: on value change in multiline mode, reset textarea height to `auto` then set to `scrollHeight`, capped at `MAX_AUTOGROW_PX = 220` (~10 lines). Past the cap, internal vertical scroll kicks in. Removed the manual resize handle (`resize: "none"`) since the textarea sizes itself. Multiline mode gets `minHeight: 38` so an empty textarea matches the previous single-line input height.

Enter-to-send and Shift+Enter-for-newline behavior preserved.

---

## Figma Integration (2026-05-11)

A four-phase build that turns Figma from a "browse files and import metadata" feature into a workable design-review surface inside Wasabi, plus first-class cross-references between Figma files/comments and Wasabi records.

### Phase 1 — In-app iframe viewer

**File:** `src/features/FigmaView.jsx`

"Open in App" button next to "Open in Figma" in the file detail panel. When clicked, FigmaView early-returns into a full-takeover view:
- 48 px header strip: Figma icon + file name + Comments button (filled accent pill) + Open in Figma (outline) + close ×
- `<iframe src="https://www.figma.com/embed?embed_host=wasabi-platform&url=https%3A%2F%2Fwww.figma.com%2Ffile%2F{key}">` fills remaining space
- Escape key closes (cleans up viewer state)
- Sign-in hint banner appears 4s after open and is dismissible — the embed authenticates via the viewer's own Figma session, so a "sign in" screen inside the iframe usually means they need to sign in to Figma in another tab

**Auth model:** This is the only Figma surface that requires per-user Figma sign-in. The PAT stored in `connections` powers the file listing and comments, but the iframe renders against the viewer's personal Figma session. Private team files only render if the viewer's Figma account can see them.

### Phase 2 — Native comment panel

**File:** `src/features/FigmaCommentPanel.jsx` (new), `worker/handlers/figma.js`

Toggleable side panel (360 px wide) that slides in to the right of the iframe. Reads/writes Figma comments via the workspace PAT through three worker endpoints:
- `GET /figma/files/:key/comments` — list (returns flat array with `parent_id` for thread linking)
- `POST /figma/files/:key/comments` — create (with optional `comment_id` for replies)
- `DELETE /figma/files/:key/comments/:id` — delete own comments

**Identity workaround:** All worker-side posts use the same PAT, so Figma sees every Wasabi comment as authored by the PAT owner. The worker prefixes every outgoing message with `[<wasabi user> via Wasabi]: ` so the actual author isn't lost. Frontend strips the prefix back into a small "GRAHAM VIA WASABI" badge so the message body reads cleanly.

**Limitations carried over:**
- No resolve action — Figma's public REST API doesn't expose one. Resolved comments show their state as a read-only badge; users still resolve in Figma proper.
- No pin positions on canvas — the iframe is cross-origin, can't draw on it. Pin coordinates (`client_meta`) come back from the API but aren't visualized.

**Auto-poll:** Every 30s while the panel is open. Manual refresh button.

### Phase 2 follow-up — @-mentions + click-through

**Files:** `worker/handlers/figma.js`, `src/components/MentionInput.jsx` (existing), `src/context/NavigationContext.jsx`, `src/views/NotificationFeed.jsx`, `src/features/FigmaCommentPanel.jsx`, `src/features/FigmaView.jsx`

Comments use the same `<MentionInput>` and `extractMentions` → `createNotificationInternal` pipeline as record comments:

- After a successful Figma POST, the worker scans the raw user-typed text (not the prefixed message — avoids self-mention from the `[Graham via Wasabi]:` prefix), matches `@Name` against the `users` table, and creates one `mention` notification per matched user (de-duped within a single comment).
- Notification shape: `type='mention'`, `source='figma:{file_key}'`, `record_name=<file name>`, `page_name='Figma'`.
- `NavigationContext` gains `pendingFigmaFile` + `navigateToFigmaFile(fileKey, fileName)` / `consumePendingFigmaFile`, mirroring the existing `pendingRecordId` pattern.
- `NotificationFeed.handleClickThrough` detects `source.startsWith('figma:')` and routes via `navigateToFigmaFile` instead of the record path.
- `FigmaView` consumes the pending file on mount and opens the in-app viewer directly at the targeted file.

The mention also appears in Figma proper as plain `@Kat …` text — Figma can't link Wasabi user identity natively, by design.

### Phase 3a — Figma cell type

**Files:** `src/views/table/tableHelpers.js`, `src/views/table/AddColumnDialog.jsx`, `src/views/table/CellDisplay.jsx`, `src/components/FigmaFilePicker.jsx` (new), `src/components/FigmaCellPreview.jsx` (new), `src/views/RecordDetail.jsx`, `src/notion/properties.js`, `src/lib/dataSource.js`

New column type `figma_files`. Cell stores a JSON array of `{ file_key, file_name, thumbnail_url }`. No DB migration — existing JSON cells.

**Pieces:**
- `COLUMN_TYPES` registers `figma_files` with `requiresFigma: true`. `AddColumnDialog` pings `/figma/status` once (60 s cache) and filters `requiresFigma` types out of both parent and sub-column pickers when no Figma connection.
- `wrapAsNotionProp` / `extractRawValue` / `inferPropKind` / `mapD1Type` round-trip the array as `{ type: 'figma_files', figma_files: [...] }`. `d1SchemaToClassified` adds `schema.figmaFiles` and the resolveColumns ordered list includes it.
- `buildProp("figma_files", arr)` returns `{ figma_files: [...] }` (Notion-shape wrapper, matching `multi_select` / `people`). `readProp` defensive-accepts both shapes.
- `FigmaFilePicker` is a workspace-wide multi-select modal: projects sidebar + thumbnail grid, search, pre-seeds with the cell's current selection so adding/removing is incremental. Commits the exact array shape the cell stores.
- `FigmaCellPreview` is the expanded card shown when a pill is clicked. Large thumbnail + filename + **Open in App** (routes via `navigateToFigmaFile`, lands in Phase 1) and **Open in Figma**. Critically: stops click propagation at the overlay boundary because React events bubble through the React tree even across `createPortal` — without that, clicking × on the preview reopens the editor.
- Compact pill renderer in `CellDisplay`: 14 px Figma icon + truncated filename in a 22 px pill. Empty cells show "+ Add file" placeholder. The generic null-value branch in `CellDisplay` is skipped for `figma_files` so the empty state stays interactive.
- `RecordDetail`: `figma_files` added to `EDITABLE_TYPES`. `FigmaFilesDisplay` renders pills in the drawer; `FigmaFilesEditor` wraps the picker as the inline editor. Same pills + same expanded preview as the table view.

**Decisions locked in planning:**
- Multi-file (array shape, not single).
- File-only refs (no frame/node pinning) — deferred.
- Compact pill render (no large thumbnail strip).
- Click pill → expanded preview with Open buttons (not direct open).
- Notion sync: skipped — column is Wasabi-native.

### Phase 3b — Comment ↔ record linking

**Files:** `worker/schema.js`, `worker/handlers/figma.js`, `worker/handlers/init.js`, `worker.js`, `src/lib/api.js`, `src/components/RecordPickerModal.jsx` (new), `src/features/FigmaCommentPanel.jsx`, `src/views/RecordDetail.jsx`

Bidirectional surfacing. From the Figma comment panel any comment can be linked to one or more Wasabi records; the linked record's drawer surfaces inbound Figma comments under a "From Figma" section in the Comments tab.

**Storage:** new `figma_comment_links` D1 table (schema v7 → v8 — see Data Models doc). Joins `(file_key, comment_id)` ↔ `(record_id, page_config_id)`, with a snapshot of the comment's `message` / `author` / `created_at` and the linked record's `record_name`. Snapshot drifts from Figma's source of truth; delete-and-re-link refreshes.

**Worker endpoints** (`/figma/comment-links` block, intentionally above the `/figma/files` block to avoid path-prefix shadowing — the catch-all `GET /figma/files` would otherwise swallow `/figma/files/:key/comments` and return "Missing project ID"):
- `GET /figma/comment-links?record_id=X` — inbound list for a record
- `GET /figma/comment-links?comment_id=X` — outbound list for a comment
- `POST /figma/comment-links` — create (409 on UNIQUE conflict for the same comment+record)
- `DELETE /figma/comment-links/:id`

**`RecordPickerModal`** is a slim two-step picker (database → row) — search by page title, then by row title. Lives at `Z.modal + 1` so it stacks above the FigmaCommentPanel.

**Source side (FigmaCommentPanel):** per-comment "Link to record" action opens the picker. After confirm, a small accent pill row appears under the message body: `↗ [Record Name] ×`. Click record name → navigates to the record via `navigateToRecord` (closes the comment panel). × removes the link.

**Target side (RecordDetail Comments tab):** new `FigmaCommentsFromRecord` section at the top of the Comments tab. One card per inbound link with file name (click → in-app viewer via `navigateToFigmaFile`), author + date, and the snapshot message body (with the `[Name via Wasabi]` prefix surfaced as a small badge). × removes the link.

**Auth on writes:** POST requires a Wasabi user (used to record `linked_by`). Reads are open within the workspace.

### Schema versions

- **v7 (Phase 3b initial):** Added `figma_comment_links` table.
- **v8 (record_name fix):** Idempotent `ALTER TABLE figma_comment_links ADD COLUMN record_name TEXT DEFAULT ''`. Links created on v7 still have an empty `record_name` and the UI falls back to the literal "record"; re-link to refresh the snapshot.

### Deferred (Phase B — not in this session)

- Frame-level pinning inside `figma_files` cells (file + specific node ref).
- Hover preview on pills.
- AI tool exposure — let the agent see/manipulate Figma files and comments.
- One-time backfill for v7 links missing `record_name`.

---

## Modal Portaling Pattern (2026-05-11)

Every viewport-anchored overlay (`position: fixed; inset: 0`) that's mounted deep inside a view or feature must be portaled to `document.body` via `ReactDOM.createPortal`. Otherwise some ancestor in the React tree creates a CSS containing block for `position: fixed` (transform, filter, backdrop-filter, will-change, contain) and the overlay's `inset: 0` collapses to that ancestor's box instead of the viewport — typically the right-pane wrapper, which ends above the BottomBar. The visible symptom: drawer/modal content (Save buttons, footers) is hidden behind the BottomBar.

**Portaled now:**
- `src/views/RecordDetail.jsx` (record drawer for table-view records)
- `src/core/Drawer.jsx` (base for the task/email/event RecordDrawer)
- `src/core/ConfirmDialog.jsx`
- `src/views/NewRecordModal.jsx`
- `src/core/ViewTypePicker.jsx`
- `src/core/LinkPicker.jsx` (z-index bumped to `Z.modal + 1` as well, since it can open from inside an already-portaled RecordDetail)
- `src/components/FigmaFilePicker.jsx`, `src/components/FigmaCellPreview.jsx`, `src/components/RecordPickerModal.jsx` (built-portaled from day one)

**Intentionally not portaled:** `CommandPalette`, `SearchModal`, `NeuronOverlay` — mounted at the AppContent root level, no constraining ancestor. `ContextMenu`, `FolderDropdown` popovers, inline dropdowns — anchored to their trigger by design.

**Event bubbling gotcha:** React events bubble through the React tree, not the DOM tree, even for portaled elements. A click inside `FigmaCellPreview` bubbles back up through `FigmaFilesDisplay` → the field row's `onClick` → `startEdit` and reopens the picker. Containers that open via `startEdit` need `stopPropagation` on the portal's outer overlay. The pattern: `onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose?.(); }}`.

---

## Sub-item Trailing Add Row (2026-05-11)

`TableRow.jsx`: when a parent is expanded with one or more children, a faint "+ Add sub-item" row renders at the bottom of the expanded children list. Click → calls the same `handleCreateSubItem(parentId)` as the unified sub-item button, which sets `subItemGhostParent` and reveals the inline ghost row.

**Why this row exists:** the 2026-05-05 unified sub-item button only creates when a parent has zero children; with one or more children, it toggles expand. Before this row, there was no remaining path to add another sub-item from the table view — users had to open RecordDetail → Sub-Items tab. The trailing row restores discoverable add-affordance to the table view itself. Hidden when the ghost row is already active (to avoid duplicate add UI).

---

## Drag-to-nest Table Rows (2026-06-17)

`useRowDrag.js` + `TableRow.jsx`. On any D1 table, hovering a row reveals a `⋮⋮` drag handle in the leftmost cell. Drag a row onto another row to make it a sub-item of the target. The depth cap is **3 levels** (top-level → child → grandchild); accepting a drop that would push any row past depth 2 returns `400 DEPTH_CAP_EXCEEDED` from the worker. Drag is disabled while a column sort is active (would conflict with stored `sort_order`) or on linked / read-only tables — handle dims with a tooltip explaining why.

Un-nest options:
- **Drop on the dashed zone below the table** (appears mid-drag for any sub-item) → `parent_row_id` becomes null.
- **Right-click any sub-item** → "Move to top level" menu entry.

The worker's `handleUpdateRow` validates the depth cap server-side (`getRowDepth` + `getSubtreeDepth` helpers in `worker/handlers/tables.js`). The original circular-reference check is preserved.

---

## Customizable Forms (2026-06-17)

A first-class forms system replacing the old auto-generated "Form" view. See `docs/19-forms-feature.md` for the full design — short summary:

**Concept:** Forms are templates defined on a table. Each form has a name, description, Form Type (single-instance vs. repeating), and an ordered list of fields. Two consumption paths:
1. **Create-new-record** (preserves today's behavior) — open from the table's Form tab, fill, submit → creates a new record.
2. **Attach-to-existing** (new) — from any record's drawer Forms tab, "Connect a form" → fill → submission attaches to the record.

**Hub model.** The table's Form tab is a directory of all forms defined on that table. Multiplicity is the first thing the user sees. Both surfaces (table-level Form tab + record-level Forms tab) draw from the same form definitions.

**Linked fields (bidirectional sync).** Each form field can optionally `link_to_column`. Linked field values are NOT stored on the submission — they're written through to the column on save and read live from the column on display. Editing the column or the submission updates both; no drift.

**Three buckets in the record drawer's Forms tab** (between Comments and Files): Drafts (per-user, in-progress) / Empty (connected, no submission yet) / Submitted (one or more completed). Repeating forms appear once in Submitted with a count badge + "+ Submit again" + expand-to-view-all.

**Field types in v1** (16): Short text, Long text, Number, Date, Date range, Single-select, Multi-select, Status, Checkbox, URL, Email, Phone, Person, Linked record, File upload, Figma file. **Layout blocks (3):** Section header, Description text, Divider. Person, Linked record, and File upload are placeholder text inputs in v1.

**Storage:** three D1 tables — `form_definitions` (templates), `form_connections` (form↔record relationships, the row that makes the Empty bucket non-empty), `form_submissions` (per-fill blobs with `status` = `draft` or `submitted`). Indexes on `(record_id)`, `(record_id, status)`, `(record_id, form_id, status)`.

**Permissions:**
- Form definition CRUD: anyone with edit rights to the table.
- Fill / submit: anyone with edit rights to the record.
- Draft editing: owner-only in v1 (the user who started the draft). Other users see the card and form in read-only.
- Submission editing: original submitter and admins. An "Edited [date] by [name]" stamp surfaces below the original "Submitted [date]."

**Deferred to v2** (tracked in plan doc): conditional show/hide, repeating sections, rating/scale, signature, multi-page forms, hidden/auto-filled fields, image/banner blocks; collaborative draft editing; surfacing form data to AI / automations / neurons.
