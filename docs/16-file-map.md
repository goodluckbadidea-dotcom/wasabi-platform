# File Map

**Last Updated:** 2026-05-22 (Extensions feature additions)

Complete source file listing for the Wasabi platform. Excludes `node_modules/`, `dist/`, and `.git/`.

**Theme-safe style files (2026-04-16):** The following files had module-level style objects converted to getter functions so theme switches pick up fresh `C` values. New files with theme-dependent styles must follow the same pattern — see `docs/01-ui-ux.md` Theme Change Flow.

- `src/views/table/tableStyles.js` — `getStyles`, `getCtxItem`, `getInputFieldStyle`, `getGhostInputStyle`
- `src/views/RecordDetail.jsx` — `getDs`
- `src/views/WorkspaceSettings.jsx` — `getWs`
- `src/components/ViewToolbar.jsx` — `getTb` (exported as `getToolbarStyles`)
- `src/views/_CellComponents.jsx` — `getCellStyles`
- `src/core/VisualPageBuilder.jsx` — `getVs`
- `src/core/BuildPage.jsx` — `getFieldStyle`
- `src/core/TopHeader.jsx` — `getDropdownItemStyle`
- `src/features/RecordDrawer.jsx` — `getInputStyle`, `getLabelStyle`, `getTabBarStyle`
- `src/features/GmailView.jsx`, `OutlookView.jsx` — `getLabelStyle`, `getFieldStyle`, `getCancelBtnStyle`, `getSendBtnStyle`
- `src/features/EmailThreadDrawer.jsx` — `getLabelStyle`, `getFieldStyle`, `getActionBtnStyle`
- `src/context/ToastContext.jsx` — `getTypeConfig`
- `src/views/table/OptionsManagerModal.jsx` — `getCategoryMeta`
- `src/components/PagePermissionsPanel.jsx` — `getPermColors`
- `src/components/RecordComments.jsx` — `getS`

---

## Root Files

| File | Purpose |
|------|---------|
| `worker.js` | Cloudflare Worker backend (~1,880 lines). Routing-only entry point. Imports all handlers from `worker/` ES modules. Durable Objects (TableRoom, UserRoom) remain inline. |

---

## worker/ (ES Module Handler Directory)

Extracted from worker.js during the 2026-04-06 refactor. Each file is a named ES module with named exports.

| File | Purpose |
|------|---------|
| `worker/crypto.js` | `hashPassword`, `verifyPassword` (PBKDF2), `encryptSecret`, `decryptSecret` (AES-256-GCM), `signJwt`, `verifyJwt`. DEK derived via HKDF from `WASABI_SECRET`. |
| `worker/schema.js` | D1 schema definitions for all tables. Source of truth for CREATE TABLE statements. |
| `worker/handlers/init.js` | Database initialization, schema migrations, schema version tracking. **2026-05-07 (commit `3f7fdb2`):** added one-shot backfill for parent-owner propagation. Imports `propagateOwnersToAncestors` from `tables.js`; reads every sub-item with non-default `owner_user_id`; runs propagation for each. Self-disabling via `connections.parent_owner_backfill='done'` flag (same pattern as `relationships_initial_rebuild`). Re-run by manual `DELETE FROM connections WHERE key='parent_owner_backfill'` then triggering `/init`. |
| `worker/handlers/tables.js` | Table schema + row CRUD: `handleListRows`, `handleCreateRows`, `handleUpdateRow`, `handleArchiveRow`, plus schema GET/PATCH (`updateTableSchema`, `updateSubColumnSchema`). Row update fans out into status-change notifications, automation triggers, relationship-projection updates. **2026-05-07 (commit `3f7fdb2`):** new exported `propagateOwnersToAncestors(env, tableId, parentRowId, addedOwners, originRowId, user)` walks the parent chain (visited-set guards cycles) unioning new owners into each ancestor's `owner_user_id`; called from `handleUpdateRow` after the row UPDATE when `body.owner_user_id` is being set, and from `handleCreateRows` for each new sub-item with `parent_row_id` (using the creator's `user.sub`). Each propagation writes an `audit_log` row with `action='auto_assign_parent_owner'` and `details.added_owners`. Best-effort wrapper — never breaks the originating request if propagation fails. Race-safe (concurrent writes both compute supersets). Removal of an owner does NOT propagate. |
| `worker/handlers/auth.js` | Login, register, refresh, session management |
| `worker/handlers/connections.js` | API key CRUD (`connections` + `user_connections` tables). Encrypts secret keys on write, decrypts on read. **2026-05-05:** `agent_confirm_writes` added to `NON_SECRET_KEYS` (workspace-wide AI behavior toggle, plain string `"on"`/`"off"`). |
| `worker/handlers/google.js` | Google OAuth callback, status, disconnect, token refresh. All token values encrypted at rest. |
| `worker/handlers/microsoft.js` | Microsoft Entra OAuth: auth URL generation, callback (find/create user by email, issue JWT), status, disconnect, `getMicrosoftAccessToken()` with auto-refresh. |
| `worker/handlers/outlook.js` | Microsoft Graph API handlers: Outlook mail (summary, search, read, thread, send, modify, draft create/update) and calendar (summary, list, create, update, delete, free/busy). Phase 5C/D (2026-05-04) extended `handleOutlookModify` with archive/trash/flag/unflag actions and added `handleOutlookCreateDraft`, `handleOutlookUpdateDraft`, `handleOutlookFreeBusy`. |
| `worker/handlers/figma.js` | Figma REST API proxy: status, projects, files, file detail, import. Creates/reuses "Design Assets" page_config with predefined schema. De-duplicates imports by file key. **2026-05-11 (Phase 2):** comment endpoints — list / post / delete on `/files/:key/comments`. POST auto-prefixes the user-typed text with `[<display_name> via Wasabi]: ` so the actual Wasabi author is preserved behind the shared PAT identity. After post, extracts `@Name` from the raw text and fires `createNotificationInternal` per matched user (same pipeline as record comments — `notifications` table with `type='mention'`, `source='figma:{file_key}'`). **2026-05-11 (Phase 3b):** comment-link endpoints — list links for a record / list links for a comment / create / delete on `/comment-links`. Snapshot of `comment_message`, `comment_author`, `comment_created_at`, `record_name` stored on the row so the linked record's drawer can render without re-fetching Figma. UNIQUE on `(figma_comment_id, record_id)` returns 409 on duplicate. |
| `worker/handlers/extensions.js` | **In development (2026-05-15).** Extension + ExtensionSnapshot CRUD, snapshot generation (validate DATA → render `{{DATA}}` substitution → write to R2 → create Draft Reports DB row), publish lifecycle, R2 HTML serve route with visibility check, neuron/comment link management. Also hosts the hand-written ~100-line JSON Schema subset validator (`validateData`) used at snapshot-generation time. See `docs/02-features-functions.md` → "Extensions" and `docs/12-mcp-server.md` → "Tools 30 & 31". |
| `worker/handlers/notion-sync.js` | Notion→D1 sync: pull, push, flush, bootstrap. Lazy-decrypts Notion key if stored as plaintext. |
| `worker/handlers/pages.js` | Page config CRUD |
| `worker/handlers/users.js` | User management: list, invite, roles, sessions |
| `worker/handlers/files.js` | R2 file uploads and retrieval |
| `worker/handlers/relationships.js` | Unified relationships subsystem: GET/POST/DELETE handlers (Phase 1, 2026-04-24) + admin-only `POST /relationships/rebuild` (Phase 2a). Permission filter scopes results by `source_page_id`/`target_page_id` ACL. POST restricts origin to `user_declared` or `ai_inferred` (projection origins are written by `relationshipProjections.js`, not the public endpoint). Dedupe: 409 on duplicate `(source_type, source_id, target_type, target_id, type)` for active edges. DELETE is soft via `deleted_at`. Rebuild handler returns before/after origin counts so callers can verify drift recovery. |
| `worker/handlers/relationshipProjections.js` | Projection layer + rebuild script for relationships subsystem. Phase 2a (2026-04-24) filled in all five projectors (`projectParentRows`, `projectCellLinks`, `projectRelationColumns`, `projectNeuronNodes`, `projectMentions`) and added live-trigger helpers (`emitProjectedEdge`, `deleteProjectedEdge`, `deleteAllProjectedEdgesForEntity`, `deleteAllProjectedEdgesByTarget`, `refToFieldId`, `mapNeuronNodeTypeToEntityType`, `resolveRecordPageId`, `getRelationColumns`). All helpers wrap their writes in try/catch so projection failures cannot break user-visible saves. Rebuild contract: `DELETE FROM relationships WHERE origin LIKE 'projected_%'` followed by `rebuildProjections(env)` reproduces identical state. Idempotency enforced by partial UNIQUE INDEX `idx_rel_uniq_active` on (source_type, source_id, target_type, target_id, type) WHERE deleted_at IS NULL. |
| `worker/automation/engine.js` | Automation rule evaluation and execution. Lazy-decrypts Claude key if stored as plaintext. |
| `worker/handlers/extensions.js` | Extensions feature: CRUD for `extensions` (templates) + `extension_snapshots` (generated reports), JSON Schema validator (`validateData`, ~100 LOC), snapshot generation with `{{DATA}}` substitution + R2 write, publish + visibility, snapshot ↔ workspace links (neuron + record comment). Schema v9 introduced the tables; v12 (2026-05-22) added the `definition` field accepted in create/update. See `docs/18-extensions.md`. |
| `index.html` | HTML shell for React SPA. Loads fonts (DM Sans, DM Mono, Outfit), mounts into `#root`. |
| `package.json` | npm manifest. React 18, Vite 5, vitest, jsPDF. |
| `vite.config.js` | Vite build config. Dev server on 0.0.0.0:5173, React plugin. |
| `wrangler.toml` | Wrangler config for Cloudflare. D1 bindings, R2 buckets, env vars. |
| `wrangler-worker.toml` | Alternative Wrangler config (worker-specific deployment). |

---

## src/

### Entry Points

| File | Purpose |
|------|---------|
| `src/main.jsx` | React entry point. Renders App into DOM. |
| `src/App.jsx` | Root component. Context providers, routing (login/setup/main), lazy loading, keyboard shortcuts. **2026-05-04 (commit `8dd0445`):** retired the lazy imports for `GmailView` and `OutlookView`. Route handler now treats `activeRightPane === "gmail" \|\| "outlook" \|\| "inbox-unified"` as redirects to `UnifiedInboxView`, so saved localStorage state pointing at the old surfaces still works. **2026-05-05:** lazy import points at `core/WasabiPanel.jsx` directly (the dual-tab `features/ChatPanel.jsx` wrapper was deleted alongside the Assistant feature). Cmd+. shortcut and the panel render are both gated on `identity?.role !== "viewer"` for defense-in-depth. **2026-05-07 (Phase 2 commit `10d5ea8`):** restructured to a dual-pane shell. `renderContent()` split into `renderLeftPane()` + `renderRightPane()`. Main row is now `[Sidebar | SplitPane(left, right)]`. WasabiPanel slide-out mount + `wasabiPanelOpen` state removed; Cmd+. shortcut and `KnowledgeHub.onOpenChat` callback rewired to `focusChatInLeftPane` (sets `activeLeftPane = "chat"` + uncollapses). New `calendar` right-pane route renders standalone `<CalendarView />`. Default for null `activeRightPane` is now `<DashboardView />` (was `<TasksView />`). Breadcrumb hoisted out of TopHeader and rendered at the top of the right pane (`16px 28px 0` padding to align with WorkspaceBrowser's internal breadcrumb). |

---

## src/core/ (37 files + SystemManager/)

App shell, navigation, settings. Loaded eagerly.

| File | Purpose |
|------|---------|
| `AutomationBuilder.jsx` | UI for creating/editing automation rules |
| `AutomationPage.jsx` | Page-level automation management view |
| `BatchQueue.jsx` | Batch operation queue display |
| `BuildPage.jsx` | Page creation/configuration builder |
| `ChatUI.jsx` | Chat interface container component |
| `CommandPalette.jsx` | Cmd+K searchable overlay for pages, shortcuts, actions |
| `ConfirmDialog.jsx` | Reusable confirmation modal for destructive actions |
| `ContextMenu.jsx` | Right-click context menu component |
| `CreateMenu.jsx` | New page/item creation menu |
| `DashboardWidget.jsx` | Individual widget renderer for dashboards |
| `DatabaseBrowser.jsx` | Database exploration/navigation UI |
| `Drawer.jsx` | Slide-out drawer container |
| `ErrorBoundary.jsx` | React error boundary with fallback UI |
| `FolderDropdown.jsx` | Folder picker dropdown for page organization |
| `FunctionBuilder.jsx` | UI for creating/editing custom functions |
| `FunctionsPanel.jsx` | Functions management panel |
| `InlineEdit.jsx` | Inline text editing component |
| `KnowledgeBase.jsx` | Knowledge base management UI |
| `LinkPicker.jsx` | Three-panel cross-page cell link picker (Pages → Views → Data Grid). D1 tables (primary), Notion, and linked sheet sources. Uses `resolveSourceType` to branch data loading. Schema type map uses `allFields` for compatibility checks (2026-04-15). **2026-05-04 (commit `8e5b95b`):** drill-down into sub-items. D1 fetch caches raw data (`schemaRes` incl. `sub_columns` + `allRows`) in `rawD1` state so drill-in/back doesn't refetch. `parentIdsWithChildren` Set drives which parent rows show a chevron in the new left-edge column of `LinkPickerGrid`. `subItemContext` state + `handleDrillIn` / `handleDrillBack` rebuild `viewData` from `sub_columns` + child rows when drilled in. Breadcrumb above the grid: "← Back  Page › Parent Title › Sub-items". `LinkPickerGrid` rows now `{ pageId, cells, hasChildren }` (sheet path unchanged); `onDrillIn` prop conditionally renders the chevron column. Sub-item links use the same `sourceRef` shape as parent links since row IDs are unique within a table. |
| `LoginScreen.jsx` | Multi-user login with password + Microsoft SSO (popup OAuth flow, login mode only) |
| `MiniView.jsx` | Compact/minimal view renderer |
| `Navigation.jsx` | Left sidebar: page list, search, system nav. **2026-05-04 (commit `8dd0445`):** retired the per-provider Outlook and Gmail buttons. The unified "Inbox" button (added in `e28f979`) is now the only mail surface, shown when EITHER provider is connected. Combined unread badge sums `unreadCount + outlookUnreadCount`. SYSTEM_PAGES set includes `inbox-unified`. **2026-05-05:** Wasabi flame button hidden when `identity?.role === "viewer"` — chat is editor + admin only. **2026-05-07 (Phase 2 `10d5ea8` + `221334d`):** routing split. Tasks / Notes buttons route to the LEFT pane via `setActiveLeftPane`; everything else still uses `setActiveRightPane` (right pane). New "Calendar" button in the right-pane group. Settings button removed (moved to TopHeader gear). The bottom rail is split by a thin gradient divider: right-pane items above (Workspaces / Dashboard / Calendar / Inbox / Figma / Notifications / Knowledge Base), left-pane residents below (Tasks, Notes, animated Wasabi flame as the chat trigger). The flame's onClick now calls `focusLeftPane("chat")` instead of toggling the slide-out. SYSTEM_PAGES set drops `"tasks"` and `"notes"` (left-pane routes). |
| `NodeEditor.jsx` | Visual node editor for automation flows |
| `Onboarding.jsx` | First-time user onboarding flow |
| `PageBuilder.jsx` | Page layout builder |
| `PageShell.jsx` | Orchestrator: loads page config, fetches data, renders active view. `handleUpdate` passes `isSubItem: !!record?._parentRowId` to `updateRecord` so sub-item cell edits route to `sub_columns` instead of silently resolving against parent columns (2026-04-15). Conflict resolver does the same lookup. **2026-05-05:** `views/ChatPanel.jsx` import removed (file deleted). Pages with a saved `activeView.type === "chat"` render an empty-state fallback that points users at the Wasabi panel. **2026-05-07 (commit `4325b7e`):** `fetchData` now has a Linked Sheet branch — calls `fetchSheetData(sheetUrl)`, converts rows to `{ [colName]: val }` objects, synthesizes a minimal schema (first column as title, rest as richTexts) and pushes both up via `onPageDataReady` so `WasabiPanel.buildDataSummary` can summarize the page for the AI. The `LinkedSheet` view continues to fetch its own richer copy independently; the duplicate fetch is the cost of keeping the formatting/image path separate from the AI-context path. Previously short-circuited on `isLinkedSheetPage` so the AI saw "0 records" on every linked-sheet page. |
| `PluginWidget.jsx` | Sandboxed iframe plugin renderer |
| `SetupWizard.jsx` | First-run setup: worker URL, secret, admin creation |
| `SheetUrlDialog.jsx` | Google Sheets URL input dialog |
| `SplitPane.jsx` | **NEW 2026-05-07 (Phase 2 `10d5ea8`).** Resizable two-pane layout primitive used as the dual-pane content shell in App.jsx. Props: `leftContent`, `rightContent`, `ratio` (0..1), `onRatioChange`, `leftCollapsed`, `onLeftCollapsedChange`, `isNarrow`. Draggable 5 px divider, min 280 px each side (clamped during drag). When `leftCollapsed`, left side hides and a reopen pill appears at the left edge. On `isNarrow` (viewport ≤ `BP.mobile = 768`), right pane fills the canvas; expanded left renders as a drawer overlay (`Z.panel`) with backdrop, toggle pill at left edge. Persistence is owned by `NavigationContext` (`splitRatio`, `leftPaneCollapsed`). |
| `SubPageNav.jsx` | Sub-page navigation tabs |
| `TopHeader.jsx` | Top bar: theme toggle, command palette (Cmd+K), user menu. **2026-05-07 (Phase 2 `10d5ea8`):** Settings gear icon added next to the user pill (admin only, replaces the old left-nav Settings button). Breadcrumb removed from this component — now lives at the top of the right pane in App.jsx. |
| `ViewTypePicker.jsx` | View type selection dropdown |
| `VisualPageBuilder.jsx` | Drag-and-drop page layout builder. On new D1 table creation, awaits `updateSubColumnSchema(pageId, [{id, name: "Name", type: "title"}])` after `savePageConfig` before calling `addPage` (2026-04-15) — guarantees default sub-column seed lands before navigation triggers the first fetch, so sub-item creation works out of the box. |
| `WasabiFlame.jsx` | Animated flame logo component |
| `WasabiOrb.jsx` | Animated orb logo component |
| `WasabiPanel.jsx` | The Wasabi agent chat panel — the only chat surface (rendered directly from `App.jsx` since 2026-05-05). Pre-warms hydrated neuron cache, uses relevance-filtered neuron context. **2026-05-05:** uses `getWasabiToolsForRole(identity?.role)` so editors get a restricted tool set (no destructive admin tools). Reads workspace-wide `agent_confirm_writes` from the connections table to decide whether to wire `onToolApproval` (replaces the old per-workspace `pageConfig.settings.agentMode`). The `Auto`/`Sonnet`/`Haiku` model-override pill renders inline in the header next to the "Wasabi" title (was a separate right-aligned row beneath the header). **2026-05-07 (commit `fa15334`):** `handleChatSend`'s `useCallback` deps array gained `activePageData`. Pre-existing stale-closure bug since 2026-03-11 — the function reads `activePageData?.schema` and `activePageData?.data` but the dep was missing, so the cached closure captured a stale null. Surfaced for linked sheets because PageShell's async `fetchSheetData` widens the race between `activePageConfig` updating and `activePageData` becoming non-null. D1 tables masked the bug because the AI naturally calls `query_database` regardless. |

### src/core/SystemManager/ (9 files)

Settings panel with tabbed interface.

| File | Purpose |
|------|---------|
| `index.js` | Barrel export |
| `SystemManager.jsx` | Main settings container with tab navigation |
| `OverviewTab.jsx` | System overview: stats, health, version |
| `ConnectionsTab.jsx` | External service connections (Notion, Google, Claude) |
| `SettingsTab.jsx` | General settings configuration. **2026-05-05:** new admin-only `AgentConfirmSection` toggle ("Confirm before write actions") backed by the `agent_confirm_writes` connection key. Replaces the per-workspace `agentMode` setting (workspace-wide single global toggle now). |
| `UsersTab.jsx` | User management: invite, roles, sessions |
| `AuditLogTab.jsx` | Activity audit log viewer |
| `components/ConnectionRow.jsx` | Single connection row component |
| `components/GoogleConnectionRow.jsx` | Google-specific connection row |
| `components/MicrosoftConnectionRow.jsx` | Microsoft-specific connection row (Outlook + Calendar) |
| `components/IdRow.jsx` | ID display row component |
| `components/StatCard.jsx` | Statistics card component |

---

## src/views/ (28 files + table/ subdirectory)

Database view components. Lazy-loaded by PageShell.

| File | Purpose |
|------|---------|
| `ActivityFeed.jsx` | Activity/changelog feed view |
| `Calendar.jsx` | Calendar view of date-based records. Sub-items excluded from main grid; shown in day popover on parent expand (2026-04-15). Owner display in popover via `showOwner` config (2026-04-16). **2026-05-04 (commit `32b696e`):** subscribes to `useLinks().resolveLinksForView` and stores `resolvedLinks` Map. `coerceLinkedDateValue` helper (top of file) parses resolved range strings back to `{start, end}` so the existing `readProp` / `parseDateStr` path keeps working. Date placement now respects links for both parent and sub-item rows. |
| `CardGrid.jsx` | Card grid gallery view. Owner display via `showOwner` config (2026-04-16). **2026-05-04 (commit `32b696e`):** subscribes to `resolveLinksForView` and exposes a `readFieldL(page, field)` wrapper that prefers linked values, falls back to `readField`. Used at six sites: filter (page-property match), search (across title/badge/body/metric), sort (a/b comparison), title, badge, body fields, metric fields. Linked values flow through every part of the card render. |
| `Charts.jsx` | Chart visualization view |
| `ConnectionRenderer.jsx` | Renders connection/relation visualizations |
| `CustomView.jsx` | User-authored HTML/JS custom views |
| `Document.jsx` | Document page component |
| `DocumentEditor.jsx` | Rich text document editor with blocks |
| `FilterChips.jsx` | Filter chip bar for view filtering. Supports synthetic `extraFields` for non-schema fields like owner (2026-04-16). |
| `Form.jsx` | Public/private form for data collection |
| `Gantt.jsx` | Timeline bar chart for date-range records. Collapsible parent/child hierarchy, computed range bars, conflict indicators, sub-item drag-to-reschedule, progress badges (2026-04-15). Owner display in sidebar via `showOwner` config (2026-04-16). **2026-05-04 (commit `32b696e`):** subscribes to `resolveLinksForView`, stores `resolvedLinks` Map. In `buildBars`, reads `resolvedLinks.get(\`${page.id}:${fieldName}\`)` before falling back to `readField`. `coerceLinkedDateValue` helper (top of file) parses resolved date-range strings back to `{start, end}` so the existing `parseDate` / `parseDateEnd` path keeps working. Sub-items inherit this for free since lookup keys on `page.id`. |
| `Kanban.jsx` | Card-based board grouped by status/select columns. Sub-items filtered out; parent cards show roll-up progress badge (2026-04-15). Owner display, filtering, and group-by via `showOwner` config + `__owner__` synthetic field (2026-04-16). **2026-05-04 (commit `32b696e`):** subscribes to `resolveLinksForView` and exposes `readFieldL` wrapper. All five `readField(page, …)` sites swapped: column grouping value, sort (a/b), card title, preview-fields existence check, preview-field display. Linked status fields drive column placement; linked dates / numbers sort cards correctly. |
| `LinkedSheet.jsx` | Linked Google Sheets viewer |
| `NetworkGraph.jsx` | Visual graph of record relationships |
| `NewRecordModal.jsx` | Modal for creating new records |
| `NodeCanvas.jsx` | Canvas for node-based flow editor |
| `NodeConfigPanel.jsx` | Configuration panel for flow nodes |
| `NodeRenderer.jsx` | Individual node renderer for flow editor |
| `NotificationFeed.jsx` | Notification inbox with filtering, sticky recently-read items in Unread tab |
| `RecordDetail.jsx` | Record detail drawer: Properties, Sub-Items (parent records only), **Dependencies** (D1 records, 2026-04-25), Comments, Files tabs. Accepts `parentTitle` prop for sub-items. `SelectEditor` supports inline option creation via the `onCreateOption` prop. Sub-Items tab (2026-04-15): `RecordSubItems` upgraded with status pills, date display, click-to-open nested RecordDetail, inline creation via `createRows`. `RollupSummary` component shows progress bar, date range, and conflict warning. **Dependencies tab (Phase 3 Step A, 2026-04-25):** new `RecordDependencies` component renders two sections — "Depends On" (upstream) and "Blocks" (downstream) — both backed by `depends_on` edges in the relationships table. Inline picker per section searches the same database, excludes self + already-linked. Status icons + pills mirror the Sub-Items styling. Click any item to open it nested; × removes the edge via `deleteEdge`. **2026-05-05:** `RecordDependencies` `recordsById` build is now two-pass — pass 1 reads parent rows via `schema.title.id` + `schema._columns` status; pass 2 reads sub-items via `schema._subColumns` title + status, prefixing each with the resolved parent title as a breadcrumb (`Parent › Sub Title`). Fixes a bug where every sub-item rendered as an 8-char UUID in the picker because sub-item cells aren't keyed by the parent's title column. |
| `SummaryTiles.jsx` | Summary tiles/metrics view |
| `Table.jsx` | Primary table/grid view — **orchestrator** (~1,205 lines). Wires hooks from `table/hooks/`, composes components from `table/`, manages virtual scrolling, keyboard navigation, and saved views. `handleCreateSchemaOption` (inline option creation from RecordDetail's `SelectEditor`) injects a color via `assignOptionColor` when adding a new option (2026-04-15). `subTitleField` returns `null` when `subColumns` is empty — no fallback to the parent title column name, which previously silently broke sub-item creation. **2026-05-05:** first column width `52px` → `80px` (parent `gtc`, sub-item `subGtc`, and `totalTableWidth`) to fit the larger unified sub-items button (18px icon + 12px count + padding) without clipping 3-digit counts. See `src/views/table/` below for extracted sub-modules. |
| `ViewRenderer.jsx` | View type router/dispatcher |
| `WorkspaceSettings.jsx` | Workspace settings view |
| `_CellComponents.jsx` | Shared cell renderer components |
| `_viewHelpers.js` | Shared view utility functions |

Note: `CalendarView.jsx` was deleted (dead code).

### src/views/table/ (17 files)

Extracted sub-modules for the Table view. Refactored from a 3,600-line monolith (2026-03-25).

| File | Purpose |
|------|---------|
| `index.js` | Barrel export — re-exports Table from `../Table.jsx` |
| `tableStyles.js` | Table style getter functions: `getStyles()`, `getCtxItem()`, `getInputFieldStyle()`, `getGhostInputStyle()`. Converted from module-level objects to functions (2026-04-16) so theme switches pick up fresh `C` values. Also exports standalone `pillStyle`, `toggleStyle`, `multiPillWrap` for CellDisplay's module-level renderers. **2026-05-04 (commits `d82056e` + `b7096cb`):** `gridRow.overflow` removed (was "hidden") so wrapped multi-pill content can grow the row vertically. `gridCell.overflow` retained as "hidden" — clips horizontal bleed from long single-line pills (e.g. "WAREHOUSED (DROPS FACILITY)" with `whiteSpace: nowrap`) without preventing the cell box from growing as flex content extends. Two-step fix: removing both broke horizontal clipping; reinstating cell-only kept both behaviors right. |
| `tableHelpers.js` | Constants (`ROW_HEIGHT`, `VIRT_BUFFER`, `COLUMN_TYPES`), `resolveColumns()`, type maps. Phase 3 Step B (2026-04-25): COLUMN_TYPES gains `depends_on` (uses `IconLink`) — automatically picked up by `AddColumnDialog`. |
| `OwnerCell.jsx` | `OwnerCellDisplay` (delegates to `OwnerAvatars` for icon-only rendering, 2026-04-16) + `OwnerPicker` for the owner column |
| `GhostRow.jsx` | `GhostCell` component for new row creation ghost input (68 lines) |
| `CellEditor.jsx` | Inline cell editor with type-specific inputs (text, number, date, select, multi-select, checkbox, URL, email, phone) (215 lines) |
| `CellDisplay.jsx` | Cell renderer with `CELL_RENDERERS` registry for read-only display. Select/multi_select/status renderers read option color from `schemaOptions` via `getSolidPillColor(value, options, schemaOptions)` — 3-arg form, no `colorMapping` override (2026-04-15 unification). `_CellComponents.jsx` used by Kanban/CardGrid is unchanged and still takes `colorMapping`. **2026-05-04 (commit `8e5b95b`):** accepts `linkedValue`, `linkInfo`, `onLinkClick` props that `TableRow` was already passing but the component had been silently dropping. When `linkInfo` is set, uses `linkedValue` instead of `value`; `coerceLinkedValue(linkedValue, type)` parses resolved strings back into renderer-friendly shapes (date ranges → `{start, end}`, multi-selects → arrays, checkbox/number → typed primitives). Linked output wraps in `LinkedWrapper` with a small `IconConnect` accent + left-border stripe; stale links (resolveRef returned undefined) get error-colored treatment + `(source missing)` placeholder. Click on the icon triggers `onLinkClick` (already wired in TableRow to call `removeLink`). |
| `ColumnContextMenu.jsx` | Column context menus: `ParentColumnContextMenu` (sort, hide, rename, manage options, type change, delete) + `SubColumnContextMenu` (rename, manage options, change type, delete — full parity with parent as of 2026-04-14). Both open on single-click header tap, double-click to rename, right-click for cursor-anchored menu. Shared `useClampedMenuPosition` hook (2026-04-15) measures the menu via ref after first paint and clamps `left`/`top` inside the viewport (floored at 8px); both menus get `maxHeight: calc(100vh - 24px)` + `overflowY: auto` so items near the viewport edge are reachable and scrollable. |
| `AddColumnDialog.jsx` | Add column dialogs: `AddColumnDialog` + `AddSubColumnDialog` with type picker, name input, options (250 lines) |
| `OptionsManagerModal.jsx` | Modal for managing select/multi_select/status column options: CRUD, drag-reorder, color picker (VIEW_PALETTE swatches). `handleAdd` injects a color via `assignOptionColor(prev.length)`. Status columns (2026-04-15): category dropdown per option (not_started/in_progress/complete/on_hold/cancelled) for semantic roll-up. `handleSetCategory` callback. Category preserved through save. |
| `CascadeDeleteDialog.jsx` | Confirmation dialog for deleting parent rows with sub-items (52 lines) |
| `DependencyDeleteDialog.jsx` | Phase 3 Step D dialog (2026-04-25). Surfaced when the worker returns 409 with `hasDependents=true` on delete — i.e. when other records depend on the row being deleted via `depends_on` edges. Lists up to 5 dependent task titles with "+N more…" overflow. Two buttons: Cancel and Delete anyway (red, destructive). Confirming retries the delete with `confirm_dependents=1`. |
| `DependsOnCell.jsx` | Phase 3 Step B cell renderer (2026-04-25) for the new `depends_on` column type. The cell stores nothing — it's a live view of `depends_on` edges where this record is the source. Loads via `useRelationships().loadForEntity(...)`, displays up to 3 title pills with "+N" overflow. Re-pulls when the context's `cacheVersion` bumps after any edge create/delete. Title resolution uses the `recordTitlesById` map passed down from Table.jsx (same-database only; cross-database edges show UUID prefix). |
| `TableToolbar.jsx` | Toolbar: search, new record, export, saved views dropdown, bulk actions, presence avatars, sub-item expand/collapse toggle (auto-sizing pill button, 2026-04-15) |
| `TableHeader.jsx` | Column headers with sort indicators, drag-to-resize, double-click rename, column visibility toggle (168 lines) |
| `TableRow.jsx` | Row rendering: parent rows, sub-item rows, expand/collapse, sub-item mini-headers (with chevron affordance, single-click opens `SubColumnContextMenu`, double-click inline rename, 250ms disambiguation timer), neuron badges. `colorMapping` prop drilling removed from `CellDisplay` sites and from hover-wash `getStatusColor` call (2026-04-15) — hover wash reads from schema options. Warns once per table when a sub-item row renders without `subSchema` (legacy fallback still renders parent schema so nothing crashes). **2026-05-04 (commit `d82056e`):** `height: ROW_HEIGHT` → `minHeight: ROW_HEIGHT` in both parent and sub-item row containers so rows grow when wrapped pills (multiPillWrap) need a second line. Trade-off: virtualization math in Table.jsx still computes by `ROW_HEIGHT * idx`, but `VIRT_BUFFER = 200` absorbs the slop for typical workspaces. **2026-05-05:** unified sub-item buttons. The chevron-expand button in the Name cell and the branch-icon "add sub-item" button in the checkbox cell collapsed into a single `IconSubItems` button in the checkbox cell. Click branches on `hasChildren` — toggles expand/collapse if children exist, otherwise calls `handleCreateSubItem` (which auto-expands as a side effect). Count badge inlined next to the icon. 18px icon + 12px count, 40×32 button, full opacity always (iPad-friendly tap target). |
| `TableFooter.jsx` | Row count display footer (41 lines) |

#### src/views/table/hooks/ (5 files)

| File | Purpose |
|------|---------|
| `useColumnManagement.js` | Column CRUD, reorder, resize, rename, add/delete/rename sub-columns, `handleChangeSubColType` (sub-item type change with options warning), schema persistence. Type-change warns and clears options when leaving select-like types. Add/rename paths auto-suffix duplicate column names (parent and sub) to prevent Notion-properties-by-name collisions. |
| `useTableData.js` | Data pipeline: text search, field filters, chip filters, sorting, debounced search. Sub-items separated before filtering and re-attached after (126 lines) |
| `useTableCellEdit.js` | Inline cell edit state: active cell tracking, value commit to API, blur handling (~107 lines). `handleCreateOption` injects a color via `assignOptionColor(existing.length)` when creating new select/status options through the in-cell `SelectPicker` "allow create" path (2026-04-15). |
| `useGhostRow.js` | Parent ghost row state: cell values, saving flag, commit-and-create logic (74 lines) |
| `useSubItemGhost.js` | Sub-item ghost row state: parent tracking, cell values, commit-and-create logic (81 lines) |

---

## src/features/ (21 files)

Personal productivity surface. User-scoped data. Lazy-loaded.

### Root Files (14)

| File | Purpose |
|------|---------|
| `CalendarView.jsx` | Day/week/month calendar with Google Calendar + Outlook Calendar sync. Fetches both providers in parallel; normalizes Outlook events to Google shape for unified display. **2026-05-04**: events now carry explicit `provider: "google" \| "microsoft"` field after normalization (Phase 5B provider tagging). Visual differentiation already exists via per-calendar color (Outlook events use #0078d4 Microsoft blue), so no further tile-level badges added. |
| `OutlookView.jsx` | Outlook inbox view: folder tabs (Inbox/Sent/Drafts), search, inline expand, compose, reply. Uses Microsoft Graph via worker. **2026-05-04: NO LONGER WIRED IN NAVIGATION OR APP ROUTING** — retired in commit `8dd0445` after the unified inbox shipped. The component file is intentionally retained on disk per CLAUDE.md "never delete working code." Restoring requires re-adding the lazy import + route block in App.jsx and the nav button block in Navigation.jsx. |
| `GmailView.jsx` | Gmail inbox, read, compose, reply. **2026-05-04: NO LONGER WIRED IN NAVIGATION OR APP ROUTING** — same status as `OutlookView.jsx`. File retained for revival if needed. |
| `UnifiedInboxView.jsx` | **(Phase 5A, 2026-05-04)** Unified Gmail + Outlook inbox in one surface and the ONLY mail surface as of commit `8dd0445`. Fetches both providers in parallel, normalizes to common shape (`{ key, provider, id, threadId\|conversationId, from, fromName, subject, snippet, date, isRead }`), sorts merged list by date DESC. Provider badges on each message (Gmail red, Outlook MS-blue with 4-square logo). Filter pills: All/Unread + per-provider toggle. Parallel cross-provider search (debounced). **Thread grouping (commit `e845f86`):** `groupThreads(messages)` groups by `g:${threadId}` / `o:${conversationId}` (falls back to message id), each group exposes `messages` (sorted), `latest`, `latestDate`, `isAnyUnread`, `sendersDisplay` (deduped participants with overflow), `messageCount`, `displaySubject` (prefers non-"Re:" form). One row per thread with sender list + count badge + most-recent snippet. Click expand fetches full conversation via `getThread` (Gmail) or `getOutlookThread` (Outlook), renders chronologically (oldest first). Mark-read on expand fans out to all unread messages in the thread via `Promise.all` on the correct provider tools. Reply targets the latest message in the thread. Compose new shows provider toggle when both connected. Exports `ProviderBadge` for reuse. App.jsx route: `inbox-unified` (also accepts legacy `gmail` / `outlook` activeRightPane values as redirects). Navigation.jsx shows the "Inbox" button when EITHER provider is connected (combined unread badge: `unreadCount + outlookUnreadCount`). |
| `DashboardView.jsx` | Customizable widget dashboard |
| `EmailThreadDrawer.jsx` | Email thread slide-out viewer |
| `FigmaView.jsx` | Figma project browser: project sidebar, file thumbnail grid, search/filter, detail panel, multi-select import to Design Assets database. **2026-05-11 (Phase 1):** "Open in App" button takes over the FigmaView area with an iframe at `figma.com/embed?embed_host=wasabi-platform&url=…`. 48 px header strip + escape-to-close + 4 s sign-in hint. **2026-05-11 (Phase 2):** Comments toggle in header → slide-in `<FigmaCommentPanel>`. **2026-05-11 (Phase 2 follow-up):** `consumePendingFigmaFile` effect on mount opens the in-app viewer directly when navigated to via a Figma `@`-mention notification click-through. |
| `FigmaCommentPanel.jsx` | **NEW 2026-05-11 (Phase 2 + Phase 3b).** 360 px side panel inside the in-app viewer. Lists Figma comments grouped into threads with replies via `parent_id`, polls every 30 s, supports posting, replying, deleting own comments (PAT identity is shared so "own" is detected by the `[<wasabi user> via Wasabi]:` prefix), @-mentioning Wasabi users via `<MentionInput>`, and "Link to record" → `<RecordPickerModal>` for Phase 3b cross-system linking. Comment posts route through worker `POST /figma/files/:key/comments` which auto-prefixes the message worker-side. |
| `ExtensionViewer.jsx` | **NEW 2026-05-15 (in development).** Renders an Extension snapshot (generated report) inside Wasabi. Fetches the rendered HTML via authed `fetchSnapshotHtml` (so workspace-visibility snapshots are reachable without exposing the URL publicly), drops it into a sandboxed `<iframe srcDoc>` with `sandbox="allow-scripts allow-popups"`. For templates with `theme_preference: "inherit"` it posts the current Wasabi theme tokens via `postMessage` on iframe load so the template can re-apply CSS variables. Surfaces a "Publish" CTA when the snapshot is `draft`, an "Open in new tab" link for public-visibility snapshots, and a back arrow to return to the Reports DB. Loaded by App.jsx when `activeRightPane` matches `extension-snapshot:<id>`. |
| `GmailView.jsx` | Gmail inbox, read, compose, reply |
| `ExtensionViewer.jsx` | **NEW 2026-05-15.** Sandboxed iframe renderer for extension snapshots (generated reports). Fetches snapshot HTML from the worker via authed `fetchSnapshotHtml`, drops into `srcDoc` with `sandbox="allow-scripts allow-popups"` (no allow-same-origin — template JS runs but can't read parent storage). When extension `theme_preference === "inherit"`, posts current Wasabi theme tokens (`bg/surface/raised/border/text/textMid/muted/accent`) via `postMessage` so the template can re-apply them as CSS variables. Header surfaces Draft → Publish action and external open-in-new-tab link. Opened from Reports DB row's "Open report" banner in `src/views/RecordDetail.jsx`. See `docs/18-extensions.md`. |
| `KnowledgeHub.jsx` | Knowledge base browser |
| `NotesView.jsx` | Personal notes view |
| `RecordDrawer.jsx` | Slide-out record editor (primary edit surface for all views). "Go to Task" uses `navigateToRecord()` for drawer-after-navigation. |
| `RecordDrawerContext.jsx` | Context provider for RecordDrawer state |
| `TaskList.jsx` | Task list rendering component. **2026-05-07 (commits `5c299a3`, `d08a3ea`):** added expansion state (`expandedIds` Set + `toggleExpand`). `TaskRow` accepts `isExpanded` + `onToggleExpand`, renders a chevron between the color bar and title when `task.subItems.length > 0`; click toggles inline expand (with `stopPropagation` so it doesn't open the record drawer). New `SubItemRow` component renders each sub indented 38px with 12px text, status-color dot in place of the parent's color bar, tree-line connector, due badge — click opens the sub's RecordDrawer. New `SubItemRollupChip` between title and DueBadge: shows the sub count, flips to the Overdue palette + "X/Y" label when any sub is overdue (matches DueBadge's `dateChipColors` mapping). Manual ("My Tasks") rows render flat — sub-item UI only on the AI-curated section. |
| `TasksView.jsx` | Personal task list with calendar integration |
| `WorkspaceBrowser.jsx` | Folder-based page navigation |
| ~~`ZenChatPanel.jsx`~~ | _(removed)_ |
| `taskHelpers.js` | Task utility functions, cache helpers (`getCached`, `setCache`, `getStaleCache`), interaction tracking with time decay (`persistInteraction`, `calculateDecayedAdjustment`, `loadInteractionLedger`, `mergeInteractionAdjustments`). **2026-05-07 (commits `7e32de3`, `9cd8a66`):** new `sortSubItemsByParentContext(subItems, parent)` — pure deterministic heuristic, no Claude call. Scoring favors own overdue, cascading-urgency boost when parent is overdue/due-soon, near-term due dates, urgent/high priority, and external-dependency hold states. Tie-breaks by most recent edit. `normalizeD1Task` now reads each status option's schema `category` field — done detection uses category first (`complete`/`cancelled` → done), keyword scan as fallback for un-categorized options. New top-level `_statusCategory` field on every normalized task; `_statusOptions` carries `{name, color, category}` instead of just `{name, color}`. |

### Hook Files (5)

| File | Purpose |
|------|---------|
| `useAICuratedTasks.js` | AI-powered task curation/prioritization hook. Scans D1 databases, enriches with per-user signals, calls Claude Haiku. Features: stale-while-revalidate (30min TTL, cache key v15), event-driven invalidation, interaction deprioritization with time decay, D1-backed snooze, interaction-aware Claude prompt with formula suggestions. Response parsing strips code fences (Haiku 4.5 wraps JSON despite instructions). Auto-scan checks for missing insight before skipping rescan. **Scan pipeline (2026-04-17):** single `listNotifications({ limit: 500 })` query for @mention detection. Role pre-filter before expensive enrichment. Viewers skip enrichment entirely. Consolidated `listTaskInteractions` fetch. Whitespace-normalized title matching for Claude response. Dependency-scan block removed. Limits: `MAX_DATABASES=25`, `MAX_ITEMS_PER_DB=1000`. Net scan API calls: ~16 regardless of task count. **Sub-items end-to-end (2026-05-07, commits `7e32de3`/`5c299a3`/`9cd8a66`/`3f10867`/`3f7fdb2`/`d08a3ea`):** schema fetch captures `subColumns` alongside `columns`. `topLevelOnly:true` removed from `listRows`; rows partition client-side by `parent_row_id`; sub-items normalize via `db.subColumns` and attach to each parent's `subItems[]` (sorted via `sortSubItemsByParentContext`). Per-user flag pass iterates sub-items too. `pruneSubItems` filters each surviving parent's `subItems[]` using the same per-row rule. `compressTask` emits `subItemCount` / `overdueSubItemCount` / `onHoldSubItemCount` (only when > 0). `applyRoleFilter` simplified to a single `isVisibleForNonAdmin` check after server-side parent-owner propagation landed (the band-aid "promote parent if any sub-item involves user" was removed in `3f7fdb2`). Cache key v11 → v12 → v13 → v14 → v15 across the session; cleanup loop now purges v8-v14. |
| `useDismissedTasks.js` | Dismissed task state management hook |
| `useInsight.js` | AI insight generation hook |
| `useTasksTable.js` | Task table data fetching/management hook |

### calendar/ Subdirectory (7)

| File | Purpose |
|------|---------|
| `CalendarEventBlock.jsx` | Calendar event block renderer |
| `CalendarFilterDropdown.jsx` | Calendar filter dropdown |
| `CalendarTaskBlock.jsx` | Calendar task block renderer |
| `DayColumn.jsx` | Day column component |
| `MonthGrid.jsx` | Month grid layout |
| `QuickCreateBar.jsx` | Quick event/task creation bar |
| `WeekListView.jsx` | Week list view layout |

---

## src/components/ (28 files)

Shared UI components used across views.

| File | Purpose |
|------|---------|
| `Breadcrumb.jsx` | Navigation breadcrumb with clickable ancestors |
| `FigmaCellPreview.jsx` | **NEW 2026-05-11 (Phase 3a).** Expanded card opened when a `figma_files` pill is clicked. Larger thumbnail + filename + **Open in App** (routes via `navigateToFigmaFile` → Phase 1 in-app viewer) + **Open in Figma** buttons. `z-index: Z.modal + 1`. Stops click propagation at the overlay because React events bubble through the React tree even across `createPortal` — without it, clicking × on the preview bubbled back into RecordDetail's field row `onClick` and reopened the picker. |
| `FigmaFilePicker.jsx` | **NEW 2026-05-11 (Phase 3a).** Workspace-wide multi-select picker for the `figma_files` cell type. Projects sidebar + thumbnail grid + search. Pre-seeds with the cell's existing selection so adding/removing is incremental. Commits the exact array shape the cell stores (`[{ file_key, file_name, thumbnail_url }, …]`). |
| `RecordPickerModal.jsx` | **NEW 2026-05-11 (Phase 3b).** Slim two-step record picker (database → row). Used from `FigmaCommentPanel` to attach a Figma comment to a Wasabi record. `z-index: Z.modal + 1` so it stacks above the comment panel. Reusable wherever a workspace-wide record picker is needed. |
| `ColumnBuilder.jsx` | Column type picker and property config |
| `ConflictToast.jsx` | Real-time sync conflict resolution UI (design tokens, ARIA, auto-dismiss with per-conflict timing) |
| `EmptyState.jsx` | Empty state placeholder component (new) |
| `InlineChart.jsx` | Inline sparkline/mini chart component |
| `MentionInput.jsx` | @-mention input with user autocomplete (used in RecordComments and RecordNotes). **2026-05-04 (commit `d82056e`):** auto-grow effect added for multiline mode — on value change, height resets to `auto` then sets to `scrollHeight`, capped at `MAX_AUTOGROW_PX = 220` (~10 lines). Past the cap, internal vertical scroll kicks in. Manual resize handle disabled (`resize: none`) since the textarea sizes itself. Multiline mode gets `minHeight: 38` so empty matches single-line height. |
| `MultiSelectPicker.jsx` | Multi-select tag picker |
| `OwnerAvatars.jsx` | Shared icon-only owner avatar circles (initial letter, gradient, tooltip). Used by Table, Kanban, Calendar, Gantt, CardGrid. |
| `PagePermissionsPanel.jsx` | Page-level permission management |
| `PinLockOverlay.jsx` | PIN lock overlay for secure pages |
| `PresenceAvatars.jsx` | Active user avatar display (design tokens, title attributes for accessibility) |
| `RecordComments.jsx` | Record-level comment thread. **2026-05-04 (commit `d82056e`):** input now passes `multiline rows={1}` to MentionInput so long comments grow the textarea instead of horizontally clipping. `inputRow` gained `alignItems: "flex-end"` so Send stays bottom-anchored as the textarea grows. Enter-to-send and Shift+Enter-newline preserved. |
| `RecordDetailPortals.jsx` | Portal components for record detail overlays. Schema switch (2026-04-15): passes `_subSchema` when `detailPage._parentRowId` is set, so sub-items opened from Calendar/other views get correct schema. |
| `RecordFiles.jsx` | File attachment management for records |
| `SavedViewsDropdown.jsx` | Saved views selector dropdown |
| `SelectPicker.jsx` | Single-select picker |
| `Spinner.jsx` | Loading spinner component |
| `StateIndicators.jsx` | Loading/error/empty state indicators (new) |
| `SyncPanel.jsx` | Notion sync status and controls panel |
| `ViewSettingsPanel.jsx` | View settings/configuration panel. `ColorMappingSection` (COLOR SOURCE dropdown + swatch grid) is hidden for Table views via `!isTable` gate (2026-04-15) — Table option colors live on the schema and are edited via Manage Options. Kanban/Gantt/CardGrid still render the section and consume `viewConfig.colorMapping`. |
| `ViewToolbar.jsx` | View-level toolbar (filters, sorts, group by) |
| `WidgetGrid.jsx` | Dashboard widget grid layout. 2026-05-04 fix: `WidgetPickerInline` was referencing `viewPrefs` (declared in outer `WidgetGrid` via `useViewPrefs()`) without it being in scope — clicking any "Pin a View" button silently threw `ReferenceError`. Added `const viewPrefs = useViewPrefs()` inside the inline picker. |

---

## src/context/ (11 files)

React context providers. Wrap the app in App.jsx.

| File | Purpose |
|------|---------|
| `AuthContext.jsx` | Authentication state, login/logout, token management |
| `CollaborationContext.jsx` | Real-time collaboration: reactive presence Map, typing with 8s TTL, conflict detection with timestamps, reconnect state restore |
| `ColorMappingContext.jsx` | Deterministic color assignment for users/categories |
| `LinksContext.jsx` | Cross-page cell link state, CRUD, and resolution. `fetchSourceData` handles D1 (via `getTableSchema` + `listRows`), Notion, and sheet sources with TTL caching (2026-04-15). **2026-05-04 (commit `8e5b95b`):** D1 path now includes `sub_columns` in the returned `d1Data` so the resolver can look up sub-item fields. Required for sub-item-to-anywhere linking to actually resolve a value. |
| `NavigationContext.jsx` | Page navigation state and history |
| `PagesContext.jsx` | Page configs, CRUD operations, page list |
| `PlatformContext.jsx` | Platform settings, worker URL, feature flags |
| `ThemeContext.jsx` | Theme state (5 themes), design token switching |
| `ToastContext.jsx` | Toast notification system (new) |
| `UserSyncContext.jsx` | Cross-device sync via UserRoom WebSocket, tab deduplication (single active tab owns connection) |
| `RelationshipsContext.jsx` | Phase 2b Step C (2026-04-25). `RelationshipsProvider` + `useRelationships()` hook for the unified relationships subsystem. Wraps `listRelationships`/`createRelationship`/`deleteRelationship` from `src/lib/api.js` with a per-entity 1-minute in-memory cache and concurrent-request deduplication. Exports: `loadRelationships(filters, opts)`, `loadForEntity(entity_type, entity_id, opts)`, `createEdge(body)`, `deleteEdge(id)`, `invalidateAll()`, `cacheVersion`. `cacheVersion` bumps after any create/delete so consumers (e.g. `DependsOnCell`) re-pull. Provider mounts in `App.jsx` next to `NeuronsProvider`. Phase 4's Relationships panel is what'll really exercise it. |
| `ViewportContext.jsx` | Responsive breakpoint detection (new) |

---

## src/agent/ (11 files)

AI agent system. Lazy-loaded.

| File | Purpose |
|------|---------|
| `agentContext.js` | Context envelope builder: `buildAgentContext()` for the single Wasabi agent. Accepts `microsoftContext` parameter alongside `googleContext` so the system prompt sees Outlook context for Microsoft 365 users. **2026-05-05:** `buildAssistantContext()` removed alongside the Assistant feature — the Wasabi panel now always runs the full agent. |
| `aiRouter.js` | Multi-tier model routing (Haiku for fast/cheap, Sonnet for complex) |
| `automations.js` | Automation execution engine: evaluates triggers, executes actions |
| `dataSummary.js` | Builds data context summaries for AI within token budget |
| `flowExecutor.js` | DAG-based flow execution: trigger, conditions, actions, delays |
| `memory.js` | Persistent conversation memory for agents |
| `queryClassifier.js` | Query intent classification for tool selection and routing |
| `runAgent.js` | Core agent loop: prompt, classify, route, execute tools, respond |
| `toolExecutor.js` | 71+ tool implementations: CRUD, email (Gmail + Outlook), calendar (Google + Outlook), automations, neuron CRUD. Phase 2b (2026-04-25) added `get_relationships` and `write_relationship`. **2026-05-04 expansion (reads)** added 17 read tools — `get_email_provider_status`, Outlook reads (`search_outlook_messages`, `get_outlook_message`, `get_outlook_thread`, `list_outlook_events`, `get_outlook_calendar_summary`), per-record context (`get_record_context` mega-tool with parallel `Promise.allSettled` fan-out, plus granular `get_record_comments`, `get_record_note`, `list_record_files`, `list_child_rows`), workspace structure (`list_pages`, `list_users`, `list_notifications`), and documents/permissions/links (`get_document`, `get_page_permissions`, `list_links`). **2026-05-04 Phase 5C/D (writes + freebusy)** added 8 Outlook write tools: `send_outlook_email`, `create_outlook_draft`, `update_outlook_draft`, `modify_outlook_message` (extended action enum: read/unread/flag/unflag/archive/trash), `create_outlook_event`, `update_outlook_event`, `delete_outlook_event`, `check_outlook_freebusy`. **2026-05-04 hotfix:** Gmail/Calendar tool cases referenced bare `input` instead of the `toolInput` parameter — every email/calendar call had been throwing `ReferenceError: Can't find variable: input` at runtime. Renamed all 14 references to `toolInput`. **2026-05-07 (commit `74bbdb0`):** `getFullPageConfig` now routes through `d1ToFrontend` (imported from `src/config/pageConfig.js`) so the agent sees the same flattened pageConfig shape every other frontend caller uses. The worker's `/pages/:id` returns `views` / `databaseIds` / `sheetUrl` etc. nested inside a `config` JSON blob, and `getFullPageConfig` was the lone caller that skipped the flatten transform. `fetchLinkedSheetRows` was returning `[]` because `pageConfig.views` was undefined; the same shape mismatch had been silently breaking AI access on `linked_notion` and `linked_monday` pages too. |
| `tools.js` | Tool definitions (schemas) for Claude's tool_use. Phase 2b (2026-04-25) added relationship tools. **2026-05-04 expansion** added 17 new read-tool definitions. **2026-05-04 Phase 5C/D** added 8 Outlook write-tool definitions (`SEND_OUTLOOK_EMAIL`, `CREATE_OUTLOOK_DRAFT`, `UPDATE_OUTLOOK_DRAFT`, `MODIFY_OUTLOOK_MESSAGE` with extended action enum, `CREATE_OUTLOOK_EVENT`, `UPDATE_OUTLOOK_EVENT`, `DELETE_OUTLOOK_EVENT`, `CHECK_OUTLOOK_FREEBUSY`). **2026-05-05:** `ASSISTANT_TOOLS_*` exports removed alongside the Assistant feature. New `getWasabiToolsForRole(role)` helper filters `WASABI_TOOLS` for non-admins (editors lose destructive tools: `delete_neuron`, `remove_neuron_node`, `delete_custom_function`, `delete_calendar_event`, `delete_outlook_event`, `send_email`, `send_outlook_email`, `modify_email`, `modify_outlook_message`, `save_plugin`, `create_page_config`, `batch_operations`). Admins get the full set. |
| `wasabiPrompt.js` | System prompt generation for the Wasabi agent. Context budget competition compresses workspace summary when neurons are rich. Accepts `microsoftContext` alongside `googleContext` (renders both as separate sections). "How to Answer Common Questions" guidance section explicitly tells the AI when to call `get_email_provider_status`, `get_record_context`, `list_users`, `list_pages`, `list_notifications`, `get_document`, etc. The email/calendar guidance enumerates Outlook writes alongside reads and tells the AI to use `check_outlook_freebusy` for multi-attendee scheduling instead of guessing availability. **2026-05-05:** `buildAssistantPrompt` removed alongside the Assistant feature. `getAgentBehaviorPrompt` simplified to two modes (`auto` / `confirm`) — `plan` mode dropped (was prompt-only, never enforced). |

---

## src/neurons/ (5 files)

Relationship mapping system.

| File | Purpose |
|------|---------|
| `NeuronBadge.jsx` | Badge showing neuron connection count |
| `NeuronLines.jsx` | SVG line renderer connecting neuron nodes |
| `NeuronOverlay.jsx` | Full-screen neuron visualization overlay |
| `NeuronsContext.jsx` | Context provider for neuron state and operations. Pre-warms hydrated cache on load. |
| `neuronStorage.js` | Neuron persistence: 3-tier caching (list/graph/hydrated), `buildFilteredNeuronContext()` for relevance-scored AI injection, `buildNeuronContextSummary()` for unfiltered fallback |

---

## src/design/ (5 files)

Design system: tokens, animations, icons, styles.

| File | Purpose |
|------|---------|
| `tokens.js` | Design tokens: C (colors), Z (z-index), BP (breakpoints), RADIUS, SHADOW, FONT, ANIM |
| `animations.js` | Keyframe animation definitions |
| `icons.jsx` | 65+ SVG icon components. **2026-05-05:** added `IconSubItems` — vertical stem + two right-going horizontals ending in dots (two stacked L's, tree-like). Used by the unified sub-items button in `TableRow.jsx` to replace the prior chevron + branch-SVG pair. Don't use `IconChevronDown` for sub-item expand controls — that glyph is reserved for column-header sort/menu triggers. |
| `styles.js` | Shared style objects and mixins |
| `interactions.js` | Interaction style helpers (hover, press states) |

---

## src/lib/ (6 files)

Utility functions, API client, WebSocket helpers.

| File | Purpose |
|------|---------|
| `api.js` | Fetch wrapper: auth headers, auto-refresh, error handling. `listRows(tableId, { limit, offset, archived, topLevelOnly })` — `topLevelOnly: true` sends `?parent_row_id=null` to exclude sub-items at the SQL level (2026-04-17, used by `useAICuratedTasks` scan). Phase 2b (2026-04-25) added unified relationships wrappers: `listRelationships(filters)`, `createRelationship(body)`, `deleteRelationship(id)`, `rebuildRelationships()`. Phase 3 Step D (2026-04-25): `deleteRow` accepts `confirmDependents` option that adds `?confirm_dependents=1` to the URL so the worker skips the dependent-prompt 409. |
| `dataSource.js` | Data source abstraction layer (D1, Notion, Monday normalization). Key functions: `fetchD1Table()` (loads up to 1000 rows, runs `dedupeColumnNames` + `repairOptionColors` with fire-and-forget writeback, builds `parentCellMap` for sub-item parent lookup, computes and attaches `page._rollup` to parent pages via `computeSubItemRollup` — 2026-04-15), `updateRecord()` (takes `isSubItem` option — routes column lookup strictly), `createRecord()` (uses `sub_columns` alone when `parentRowId` set), `d1RowToPage()` (converts D1 rows to Notion-compatible page objects), `d1SchemaToClassified()` (converts D1 column arrays to classified schema; `mapD1Type` passes `depends_on` through unchanged so `field.type` lands as `'depends_on'` in `allFields` for cell renderer dispatch — Phase 3 Step B 2026-04-25). Helpers: `assignOptionColor(idx)`, `repairOptionColors(cols)`, `dedupeColumnNames(cols)`, `normalizeOptions()` (preserves `category` field on status options — 2026-04-15). Exports: `STATUS_CATEGORIES` (2026-04-15). `deleteRecords()` propagates both `hasChildren` and `hasDependents` 409 responses (Phase 3 Step D). **2026-05-07 (commit `593358c`):** `updateRecord()` now mirrors `createRecord()`'s implicit-title detection — when `col.type === "title"` OR (`idx === 0` && no explicit title in `activeCols`), uses `"title"` as the effective type for `extractRawValue`. Without this, D1 tables that store the title column with `col.type = "text"` silently saved `""` on every rename because `buildProp("title", value)` emits a `{ title: [...] }` payload but `extractRawValue` switched on the raw `"text"` and read `prop.rich_text` (empty). |
| `subItemRollup.js` | **(2026-04-15)** Pure utility: `computeSubItemRollup(parentPage, childPages, parentSchema, subSchema)`. Computes timeline range (earliest/latest child dates), progress (status category roll-up: complete + cancelled = resolved), and conflict detection (children exceed parent dates). Returns `{ computedStart, computedEnd, progress, hasConflict, conflictDetails }`. |
| `iframeHelpers.js` | Iframe sandbox helpers, escapeHtml, auto-execute code |
| `roles.js` | Role constants and permission utilities |
| `tableSocket.js` | WebSocket client for table collaboration (TableRoom), double-connect guard |
| `userSocket.js` | WebSocket client for user sync (UserRoom) |

---

## src/hooks/ (2 files)

Custom React hooks.

| File | Purpose |
|------|---------|
| `useViewPrefs.js` | View preferences persistence (filters, sorts, column widths) |
| `useRecordDetail.js` | Record detail data fetching and state management |

---

## src/utils/ (8 files)

Utility and helper modules.

| File | Purpose |
|------|---------|
| `costTracker.js` | AI API cost tracking and budget management |
| `files.js` | File handling utilities |
| `fileProcessing.js` | File processing and parsing utilities |
| `markdown.js` | Markdown parsing and rendering utilities |
| `reportExport.js` | Report export (PDF via jsPDF) |
| `reportGenerator.js` | Report data generation |
| `useKeyboardShortcuts.js` | Keyboard shortcut registration hook |

---

## src/google/ (1 file)

| File | Purpose |
|------|---------|
| `googleContext.js` | Google OAuth state and API context. Fetches Gmail + Calendar summaries via `getGmailSummary` + `getCalendarSummary`, formats compact context block for system prompt injection. 5-min sessionStorage cache. |

---

## src/microsoft/ (1 file)

**(Added 2026-05-04)**

| File | Purpose |
|------|---------|
| `microsoftContext.js` | Microsoft 365 (Outlook + Calendar) context fetcher. Mirror of `googleContext.js`. Fetches `getOutlookSummary` + `getOutlookCalendarSummary` in parallel via `Promise.allSettled`, formats a "## Microsoft 365 Context" block with unread count, recent subjects, and upcoming events. 5-min sessionStorage cache, separate cache key (`wasabi_microsoft_context`) so Google and Microsoft contexts can coexist. Consumed by `WasabiPanel.jsx` via `getMicrosoftStatus().connected → fetchMicrosoftContext()` gate. |

---

## src/config/ (5 files)

Configuration and storage utilities.

| File | Purpose |
|------|---------|
| `flowStorage.js` | Flow/automation persistence helpers |
| `linkStorage.js` | Link persistence (D1 `cell_links` table), caching, and value resolution. `resolveRef` handles D1 (`record_id` + `column_name`), Notion, and sheet ref types (2026-04-15). **2026-05-04 (commit `8e5b95b`):** D1 branch detects sub-item rows via `row.parent_row_id` and looks up the column in `d1Data.sub_columns` instead of `d1Data.columns`. Same ref shape — no flag needed. |
| `linkTypeCompat.js` | Link type compatibility layer |
| `pageConfig.js` | Page configuration schema and defaults. Exports `loadPageConfigs` (worker `/pages` → `d1ToFrontend` per row → flat shape), `savePageConfig`, `archivePageConfig`, `validatePageConfigs`, `createDashboardConfig`, `createWorkspaceConfig`. **2026-05-07 (commit `74bbdb0`):** `d1ToFrontend(d1Page)` now exported (was private). The agent's `getFullPageConfig` in `toolExecutor.js` uses it to match the flattened shape the rest of the frontend reads — without it, agent code couldn't see `views`/`databaseIds`/`sheetUrl` because they were nested inside `config`. |
| `setup.js` | Initial setup configuration |
| `templates.js` | Page/view templates |

---

## src/notion/ (4 files)

Notion API integration layer.

| File | Purpose |
|------|---------|
| `client.js` | Notion API client (proxied through worker) |
| `pagination.js` | Notion API pagination utilities |
| `properties.js` | Notion property type mapping |
| `schema.js` | Notion database schema detection |

---

## src/sheets/ (1 file)

| File | Purpose |
|------|---------|
| `sheetClient.js` | Google Sheets API client |

---

## src/monday/ (1 file)

| File | Purpose |
|------|---------|
| `client.js` | Monday.com API client |

---

## docs/ (15 files)

| File | Purpose |
|------|---------|
| `00-wasabi-overview.md` | Product description, architecture, development guidelines |
| `01-ui-ux.md` | UI/UX patterns and design decisions |
| `02-features-functions.md` | Feature catalog and function reference |
| `03-integrations.md` | External integrations (Notion, Google, Monday) |
| `04-ai-chat.md` | AI chat system architecture |
| `05-d1-r2.md` | D1 database and R2 storage reference |
| `06-deployment.md` | Deployment and infrastructure guide |
| `07-architecture-routing.md` | Architecture and routing patterns |
| `08-state-data-flow.md` | State management and data flow |
| `09-config-data-models.md` | Configuration and data models |
| `12-mcp-server.md` | MCP server reference (this directory) |
| `13-realtime-collaboration.md` | Real-time collaboration system |
| `14-d1-notion-sync-architecture.md` | D1/Notion sync architecture |
| `15-security-and-known-issues.md` | Security posture and known issues |
| `16-file-map.md` | This file |

Note: docs 10, 11, and the `reviews/` directory were deleted. Two `.docx` analysis files also exist in this directory.

---

## mcp-server/ (3 source files)

| File | Purpose |
|------|---------|
| `index.js` | MCP server entry point (Node.js ESM, stdio transport) |
| `config.json` | Local config with workerUrl and apiKey (gitignored) |
| `config.example.json` | Config template |
| `package.json` | Dependencies (@modelcontextprotocol/sdk) |

---

## Other Root Files

| File | Purpose |
|------|---------|
| `.codesandbox/tasks.json` | CodeSandbox task configuration |
