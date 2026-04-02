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
| ChatPanel | `src/features/ChatPanel.jsx` | Dual-tab AI chat: Assistant (Haiku, lightweight tools, neuron-aware) and Agent (full Wasabi agent with all tools) |
| GmailView | `src/features/GmailView.jsx` | Gmail inbox, read, compose, reply |
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
| `TaskList.jsx` | Task rows, quick-add input, section grouping |
| `taskHelpers.js` | Task utility functions, cache helpers (`getCached`, `setCache`, `getStaleCache`), interaction tracking (`persistInteraction`, `mergeInteractionAdjustments`, `loadInteractionLedger`) |
| `useTasksTable.js` | Hook for D1 task CRUD. Auto-provisions per-user "User Tasks" table on first use. Gates on `pagesLoaded` to avoid running against stale localStorage cache. Trusts saved `zen_tasks_table_id` from D1 user_state. |
| `useAICuratedTasks.js` | Hook for AI-curated tasks: scans D1 databases, enriches with signals, calls Claude Haiku for prioritization. Features: stale-while-revalidate caching (2hr TTL), event-driven invalidation via dirty flags, interaction-based deprioritization with time decay (user-scoped), D1-backed snooze, interaction-aware Claude prompt with formula suggestions, pipeline-aware date reasoning, people column matching, cross-user cache invalidation |
| `useDismissedTasks.js` | Hook for dismissed task tracking (session-scoped, sessionStorage) |
| `useInsight.js` | Hook for AI-generated insights (sidebar insight, 7-day cache, user-scoped via userId param) |
| `calendar/` | Calendar sub-components (DayColumn, WeekListView, MonthGrid) |

### Record Editing

**All record editing happens through RecordDrawer.** Inline table editing is disabled. Clicking a row, card, event, or task opens the RecordDrawer slide-out panel for editing. This is the single edit surface for the entire application.

---

## AI-Curated Task System

**Source:** `src/features/useAICuratedTasks.js` (~1,200 lines), `src/features/taskHelpers.js`

The AI task curation system scans all D1 databases for task-like records, enriches them with per-user signals, calls Claude Haiku for intelligent prioritization, and presents a ranked task list in TasksView.

### Architecture

```
Mount → Show cached data instantly (stale-while-revalidate)
  → If cache stale (>2hrs) or dirty flag set → background rescan:
    1. Scan page configs for task-like databases (scoring heuristic)
    2. Fetch rows from each (max 5 DBs, 30 items each)
    3. Fetch activity data, interaction history, record views, comments
    4. Enrich: ownership, @mentions, staleness, dependencies, neurons
    5. Fetch active snoozes from D1 → filter snoozed tasks out
    6. Merge interaction adjustments from localStorage ledger
    7. Build interaction breakdown for Claude prompt
    8. Call Claude Haiku with enriched data + formula suggestions
    9. Merge interaction adjustments into results → cache → display
```

### Caching Strategy (Stale-While-Revalidate)

- **Cache key:** `wasabi_ai_tasks_v10_{userId}` in localStorage
- **Cache TTL:** 2 hours (background rescan trigger, not hard expiry)
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

## Sub-Items (Table View)

Sub-items are hierarchical child records within a D1 table. They share the same `table_rows` D1 table as parent records, distinguished by `parent_row_id`.

### Architecture

- **Storage:** Same `table_rows` table. Sub-item rows have `parent_row_id` set to the parent record's ID.
- **Schema:** Sub-item columns are stored separately in the page config as `sub_columns` (not in the parent `columns` array). Each sub-column has a `subcol_*` prefixed ID.
- **Title column:** The first sub-column always gets `type: "title"`. If a sub-column was created before this rule existed, `d1SchemaToClassified` and `d1RowToPage` both treat `idx === 0` as title regardless of stored type.

### Data Flow

1. **Write path:** `createRecord()` in `dataSource.js` merges `sub_columns` into the column lookup when `parentRowId` is present, so sub-column cell values are correctly mapped by `subcol_*` IDs. The `effectiveType` correction mirrors `d1SchemaToClassified` logic (explicit `type: "title"` or idx===0) for both parent and sub-column schemas, ensuring `extractRawValue` reads the correct property key regardless of raw column type.
2. **Read path:** `d1RowToPage()` iterates both parent columns and `subColumns`. Sub-column title values are wrapped in Notion-compatible `{type: "title", title: [...]}` format (not `rich_text`) so the cell renderer displays them correctly.
3. **Schema classification:** `d1SchemaToClassified()` is called separately for sub-columns to produce `schema._subSchema`. The table view uses `subSchema` for sub-item rows and parent `schema` for regular rows.

### Table View Integration (Table.jsx + src/views/table/)

The table view's sub-item logic is spread across the orchestrator and extracted sub-modules:

- **Ghost row:** `useSubItemGhost` hook (`table/hooks/useSubItemGhost.js`) manages sub-item ghost row state (`subItemGhostParent`, `subItemGhostValues`, `subItemGhostSaving`). Ghost cell rendering in `GhostRow.jsx`.
- **Row rendering:** `TableRow.jsx` renders both parent and sub-item rows, including expand/collapse toggle, sub-item mini-headers (uppercase, 11px), and the branch icon for creating sub-items.
- **Editable headers:** Double-click a sub-item header to rename inline. Right-click opens `SubColumnContextMenu` (`ColumnContextMenu.jsx`) with Rename and Delete options.
- **Column management:** `useColumnManagement` hook (`table/hooks/useColumnManagement.js`) handles `handleAddSubCol`, `handleRenameSubCol`, `handleDeleteSubCol` via `updateSubColumnSchema`.
- **Add column dialog:** `AddSubColumnDialog` (`AddColumnDialog.jsx`) for creating new sub-columns.
- **Display columns:** `subColsList` = visible sub-columns, or falls back to `[subTitleField]` if no sub-columns exist. Computed in the Table.jsx orchestrator.
- **Tree data:** `useTreeData` hook (`src/lib/useTreeData.js`) handles expand/collapse state, `displayList` flattening, and parent-child relationships.
- **Filter pipeline:** `useTableData` separates sub-items from parent rows before applying chip filters, dropdown filters, and search. After filtering, sub-items whose parent survived are re-attached. This prevents sub-items (which lack parent column values) from being incorrectly excluded by filters.

### RecordDetail Integration (RecordDetail.jsx)

- Sub-item records do NOT show the "Sub-Items" tab (sub-items cannot have sub-items).
- Sub-item records show a "Parent" field linking to the parent record. The parent record's title is displayed (passed as `parentTitle` prop from Table.jsx), not the raw row ID.

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
| LinkPicker | `LinkPicker.jsx` | Link/URL picker |
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
| `toolExecutor.js` | 55+ tool implementations: CRUD pages/rows, email, calendar, automations, neuron CRUD |
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

Visual representation: nodes (circles) connected by lines, color-coded per neuron. Hover highlights connections; click navigates to the linked entity. Both the Agent and Assistant AI modes use neurons as their primary navigation tool for cross-table reasoning.

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

The Assistant (lightweight chat) has read-only access: `query_neurons` and `query_neuron_data`.

Write tools (`update_neuron`, `delete_neuron`, `add_neuron_node`, `remove_neuron_node`) require user approval in confirm mode.

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
2. `setActivePage(pageConfigId)` navigates to the database page
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

## Shared Components (`src/components/` — 24 files)

Reusable UI components used across multiple views:
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
| R2 | File storage — documents, attachments, exports | Worker serves presigned URLs |
