# File Map

**Last Updated:** 2026-04-07

Complete source file listing for the Wasabi platform. Excludes `node_modules/`, `dist/`, and `.git/`.

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
| `worker/handlers/init.js` | Database initialization, schema migrations, schema version tracking |
| `worker/handlers/auth.js` | Login, register, refresh, session management |
| `worker/handlers/connections.js` | API key CRUD (`connections` + `user_connections` tables). Encrypts secret keys on write, decrypts on read. |
| `worker/handlers/google.js` | Google OAuth callback, status, disconnect, token refresh. All token values encrypted at rest. |
| `worker/handlers/microsoft.js` | Microsoft Entra OAuth: auth URL generation, callback (find/create user by email, issue JWT), status, disconnect, `getMicrosoftAccessToken()` with auto-refresh. |
| `worker/handlers/outlook.js` | Microsoft Graph API handlers: Outlook mail (summary, search, read, thread, send, modify) and calendar (summary, list, create, update, delete). |
| `worker/handlers/figma.js` | Figma REST API proxy: status, projects, files, file detail, import. Creates/reuses "Design Assets" page_config with predefined schema. De-duplicates imports by file key. |
| `worker/handlers/notion-sync.js` | Notion→D1 sync: pull, push, flush, bootstrap. Lazy-decrypts Notion key if stored as plaintext. |
| `worker/handlers/rows.js` | D1 table CRUD: create, read, update, delete rows |
| `worker/handlers/pages.js` | Page config CRUD |
| `worker/handlers/users.js` | User management: list, invite, roles, sessions |
| `worker/handlers/files.js` | R2 file uploads and retrieval |
| `worker/automation/engine.js` | Automation rule evaluation and execution. Lazy-decrypts Claude key if stored as plaintext. |
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
| `src/App.jsx` | Root component. Context providers, routing (login/setup/main), lazy loading, keyboard shortcuts. |

---

## src/core/ (36 files + SystemManager/)

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
| `LinkPicker.jsx` | Link/relation picker for connecting records |
| `LoginScreen.jsx` | Multi-user login with password + Microsoft SSO (popup OAuth flow, login mode only) |
| `MiniView.jsx` | Compact/minimal view renderer |
| `Navigation.jsx` | Left sidebar: page list, search, system nav |
| `NodeEditor.jsx` | Visual node editor for automation flows |
| `Onboarding.jsx` | First-time user onboarding flow |
| `PageBuilder.jsx` | Page layout builder |
| `PageShell.jsx` | Orchestrator: loads page config, fetches data, renders active view |
| `PluginWidget.jsx` | Sandboxed iframe plugin renderer |
| `SetupWizard.jsx` | First-run setup: worker URL, secret, admin creation |
| `SheetUrlDialog.jsx` | Google Sheets URL input dialog |
| `SubPageNav.jsx` | Sub-page navigation tabs |
| `TopHeader.jsx` | Top bar: theme toggle, command palette (Cmd+K), user menu |
| `ViewTypePicker.jsx` | View type selection dropdown |
| `VisualPageBuilder.jsx` | Drag-and-drop page layout builder |
| `WasabiFlame.jsx` | Animated flame logo component |
| `WasabiOrb.jsx` | Animated orb logo component |
| `WasabiPanel.jsx` | Full Wasabi agent chat panel. Pre-warms hydrated neuron cache, uses relevance-filtered neuron context. |

### src/core/SystemManager/ (9 files)

Settings panel with tabbed interface.

| File | Purpose |
|------|---------|
| `index.js` | Barrel export |
| `SystemManager.jsx` | Main settings container with tab navigation |
| `OverviewTab.jsx` | System overview: stats, health, version |
| `ConnectionsTab.jsx` | External service connections (Notion, Google, Claude) |
| `SettingsTab.jsx` | General settings configuration |
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
| `Calendar.jsx` | Calendar view of date-based records |
| `CardGrid.jsx` | Card grid gallery view |
| `Charts.jsx` | Chart visualization view |
| `ChatPanel.jsx` | Chat panel integrated with views |
| `ConnectionRenderer.jsx` | Renders connection/relation visualizations |
| `CustomView.jsx` | User-authored HTML/JS custom views |
| `Document.jsx` | Document page component |
| `DocumentEditor.jsx` | Rich text document editor with blocks |
| `FilterChips.jsx` | Filter chip bar for view filtering |
| `Form.jsx` | Public/private form for data collection |
| `Gantt.jsx` | Timeline bar chart for date-range records |
| `Kanban.jsx` | Card-based board grouped by status/select columns |
| `LinkedSheet.jsx` | Linked Google Sheets viewer |
| `NetworkGraph.jsx` | Visual graph of record relationships |
| `NewRecordModal.jsx` | Modal for creating new records |
| `NodeCanvas.jsx` | Canvas for node-based flow editor |
| `NodeConfigPanel.jsx` | Configuration panel for flow nodes |
| `NodeRenderer.jsx` | Individual node renderer for flow editor |
| `NotificationFeed.jsx` | Notification inbox with filtering, sticky recently-read items in Unread tab |
| `RecordDetail.jsx` | Record detail drawer: Properties, Sub-Items (parent records only), Notes, Comments, Files tabs. Accepts `parentTitle` prop for sub-items. |
| `SummaryTiles.jsx` | Summary tiles/metrics view |
| `Table.jsx` | Primary table/grid view — **orchestrator** (~1,205 lines). Wires hooks from `table/hooks/`, composes components from `table/`, manages virtual scrolling, keyboard navigation, and saved views. See `src/views/table/` below for extracted sub-modules. |
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
| `tableStyles.js` | All table style objects (299 lines) |
| `tableHelpers.js` | Constants (`ROW_HEIGHT`, `VIRT_BUFFER`, `COLUMN_TYPES`), `resolveColumns()`, type maps (133 lines) |
| `OwnerCell.jsx` | `OwnerCellDisplay` + `OwnerPicker` for the owner column (192 lines) |
| `GhostRow.jsx` | `GhostCell` component for new row creation ghost input (68 lines) |
| `CellEditor.jsx` | Inline cell editor with type-specific inputs (text, number, date, select, multi-select, checkbox, URL, email, phone) (215 lines) |
| `CellDisplay.jsx` | Cell renderer with `CELL_RENDERERS` registry for read-only display (63 lines) |
| `ColumnContextMenu.jsx` | Right-click context menus: `ParentColumnContextMenu` (sort, hide, rename, manage options, type change, delete) + `SubColumnContextMenu` |
| `AddColumnDialog.jsx` | Add column dialogs: `AddColumnDialog` + `AddSubColumnDialog` with type picker, name input, options (250 lines) |
| `OptionsManagerModal.jsx` | Modal for managing select/multi_select/status column options: CRUD, drag-reorder, color picker (VIEW_PALETTE swatches) |
| `CascadeDeleteDialog.jsx` | Confirmation dialog for deleting parent rows with sub-items (52 lines) |
| `TableToolbar.jsx` | Toolbar: search, new record, export, saved views dropdown, bulk actions, presence avatars (221 lines) |
| `TableHeader.jsx` | Column headers with sort indicators, drag-to-resize, double-click rename, column visibility toggle (168 lines) |
| `TableRow.jsx` | Row rendering: parent rows, sub-item rows, expand/collapse, sub-item mini-headers, neuron badges (381 lines) |
| `TableFooter.jsx` | Row count display footer (41 lines) |

#### src/views/table/hooks/ (5 files)

| File | Purpose |
|------|---------|
| `useColumnManagement.js` | Column CRUD, reorder, resize, rename, add/delete/rename sub-columns, schema persistence. Type-change warns and clears options when leaving select-like types. |
| `useTableData.js` | Data pipeline: text search, field filters, chip filters, sorting, debounced search. Sub-items separated before filtering and re-attached after (126 lines) |
| `useTableCellEdit.js` | Inline cell edit state: active cell tracking, value commit to API, blur handling (107 lines) |
| `useGhostRow.js` | Parent ghost row state: cell values, saving flag, commit-and-create logic (74 lines) |
| `useSubItemGhost.js` | Sub-item ghost row state: parent tracking, cell values, commit-and-create logic (81 lines) |

---

## src/features/ (21 files)

Personal productivity surface. User-scoped data. Lazy-loaded.

### Root Files (14)

| File | Purpose |
|------|---------|
| `CalendarView.jsx` | Day/week/month calendar with Google Calendar + Outlook Calendar sync. Fetches both providers in parallel; normalizes Outlook events to Google shape for unified display. |
| `OutlookView.jsx` | Outlook inbox view: folder tabs (Inbox/Sent/Drafts), search, inline expand, compose, reply. Uses Microsoft Graph via worker. |
| `ChatPanel.jsx` | Dual-tab AI chat: Assistant (Haiku, role-based tools, neuron-aware) + Agent (full Wasabi agent) |
| `DashboardView.jsx` | Customizable widget dashboard |
| `EmailThreadDrawer.jsx` | Email thread slide-out viewer |
| `FigmaView.jsx` | Figma project browser: project sidebar, file thumbnail grid, search/filter, detail panel, multi-select import to Design Assets database |
| `GmailView.jsx` | Gmail inbox, read, compose, reply |
| `KnowledgeHub.jsx` | Knowledge base browser |
| `NotesView.jsx` | Personal notes view |
| `RecordDrawer.jsx` | Slide-out record editor (primary edit surface for all views). "Go to Task" uses `navigateToRecord()` for drawer-after-navigation. |
| `RecordDrawerContext.jsx` | Context provider for RecordDrawer state |
| `TaskList.jsx` | Task list rendering component |
| `TasksView.jsx` | Personal task list with calendar integration |
| `WorkspaceBrowser.jsx` | Folder-based page navigation |
| ~~`ZenChatPanel.jsx`~~ | _(removed)_ |
| `taskHelpers.js` | Task utility functions, cache helpers (`getCached`, `setCache`, `getStaleCache`), interaction tracking with time decay (`persistInteraction`, `calculateDecayedAdjustment`, `loadInteractionLedger`, `mergeInteractionAdjustments`) |

### Hook Files (5)

| File | Purpose |
|------|---------|
| `useAICuratedTasks.js` | AI-powered task curation/prioritization hook. Scans D1 databases, enriches with per-user signals, calls Claude Haiku. Features: stale-while-revalidate (2hr TTL), event-driven invalidation, interaction deprioritization with time decay, D1-backed snooze, interaction-aware Claude prompt with formula suggestions. Response parsing strips code fences (Haiku 4.5 wraps JSON despite instructions). Auto-scan checks for missing insight before skipping rescan. |
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

## src/components/ (24 files)

Shared UI components used across views.

| File | Purpose |
|------|---------|
| `Breadcrumb.jsx` | Navigation breadcrumb with clickable ancestors |
| `ColumnBuilder.jsx` | Column type picker and property config |
| `ConflictToast.jsx` | Real-time sync conflict resolution UI (design tokens, ARIA, auto-dismiss with per-conflict timing) |
| `EmptyState.jsx` | Empty state placeholder component (new) |
| `InlineChart.jsx` | Inline sparkline/mini chart component |
| `MentionInput.jsx` | @-mention input with user autocomplete (used in RecordComments and RecordNotes) |
| `MultiSelectPicker.jsx` | Multi-select tag picker |
| `PagePermissionsPanel.jsx` | Page-level permission management |
| `PinLockOverlay.jsx` | PIN lock overlay for secure pages |
| `PresenceAvatars.jsx` | Active user avatar display (design tokens, title attributes for accessibility) |
| `RecordComments.jsx` | Record-level comment thread |
| `RecordDetailPortals.jsx` | Portal components for record detail overlays |
| `RecordFiles.jsx` | File attachment management for records |
| `SavedViewsDropdown.jsx` | Saved views selector dropdown |
| `SelectPicker.jsx` | Single-select picker |
| `Spinner.jsx` | Loading spinner component |
| `StateIndicators.jsx` | Loading/error/empty state indicators (new) |
| `SyncPanel.jsx` | Notion sync status and controls panel |
| `ViewSettingsPanel.jsx` | View settings/configuration panel |
| `ViewToolbar.jsx` | View-level toolbar (filters, sorts, group by) |
| `WidgetGrid.jsx` | Dashboard widget grid layout |

---

## src/context/ (11 files)

React context providers. Wrap the app in App.jsx.

| File | Purpose |
|------|---------|
| `AuthContext.jsx` | Authentication state, login/logout, token management |
| `CollaborationContext.jsx` | Real-time collaboration: reactive presence Map, typing with 8s TTL, conflict detection with timestamps, reconnect state restore |
| `ColorMappingContext.jsx` | Deterministic color assignment for users/categories |
| `LinksContext.jsx` | Link/relation management between records |
| `NavigationContext.jsx` | Page navigation state and history |
| `PagesContext.jsx` | Page configs, CRUD operations, page list |
| `PlatformContext.jsx` | Platform settings, worker URL, feature flags |
| `ThemeContext.jsx` | Theme state (5 themes), design token switching |
| `ToastContext.jsx` | Toast notification system (new) |
| `UserSyncContext.jsx` | Cross-device sync via UserRoom WebSocket, tab deduplication (single active tab owns connection) |
| `ViewportContext.jsx` | Responsive breakpoint detection (new) |

---

## src/agent/ (11 files)

AI agent system. Lazy-loaded.

| File | Purpose |
|------|---------|
| `agentContext.js` | Context envelope builders: `buildAgentContext()` (full agent) + `buildAssistantContext()` (lightweight assistant) |
| `aiRouter.js` | Multi-tier model routing (Haiku for fast/cheap, Sonnet for complex) |
| `automations.js` | Automation execution engine: evaluates triggers, executes actions |
| `dataSummary.js` | Builds data context summaries for AI within token budget |
| `flowExecutor.js` | DAG-based flow execution: trigger, conditions, actions, delays |
| `memory.js` | Persistent conversation memory for agents |
| `queryClassifier.js` | Query intent classification for tool selection and routing |
| `runAgent.js` | Core agent loop: prompt, classify, route, execute tools, respond |
| `toolExecutor.js` | 55+ tool implementations: CRUD, email, calendar, automations, neuron CRUD |
| `tools.js` | Tool definitions (schemas) for Claude's tool_use. Role-based assistant tool sets (admin/editor/viewer). |
| `wasabiPrompt.js` | System prompt generation for Agent and Assistant. Context budget competition compresses workspace summary when neurons are rich. |

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
| `icons.jsx` | 65+ SVG icon components |
| `styles.js` | Shared style objects and mixins |
| `interactions.js` | Interaction style helpers (hover, press states) |

---

## src/lib/ (6 files)

Utility functions, API client, WebSocket helpers.

| File | Purpose |
|------|---------|
| `api.js` | Fetch wrapper: auth headers, auto-refresh, error handling |
| `dataSource.js` | Data source abstraction layer (D1, Notion, Monday normalization). Key functions: `createRecord()` (single write path for all records including sub-items), `d1RowToPage()` (converts D1 rows to Notion-compatible page objects, handles sub-column title wrapping), `d1SchemaToClassified()` (converts D1 column arrays to classified schema). |
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
| `googleContext.js` | Google OAuth state and API context |

---

## src/config/ (5 files)

Configuration and storage utilities.

| File | Purpose |
|------|---------|
| `flowStorage.js` | Flow/automation persistence helpers |
| `linkStorage.js` | Link/relation storage utilities |
| `linkTypeCompat.js` | Link type compatibility layer |
| `pageConfig.js` | Page configuration schema and defaults |
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
