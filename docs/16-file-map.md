# Wasabi Platform: Comprehensive File Map

**Last Updated:** 2026-03-20

This document maps every source file in the Wasabi codebase (excluding `node_modules/`, `dist/`, and `.git/`). Each entry includes:
- **File path** (relative to repo root)
- **Purpose** (1-2 sentences)
- **Key exports** (functions, components, constants)
- **Dependencies** (imports from other project files)
- **Line count** (approximate)

---

## Root Files

### `worker.js`
- **Purpose:** Cloudflare Worker backend. Handles all API routes for D1 storage, Notion proxy, Claude integration, real-time collaboration, and file upload.
- **Key exports:** Not a module — service worker entry point. Exports route handlers via `export default { fetch(...), ... }`.
- **Line count:** ~3,500 (partial read)
- **Key routes:** `/page`, `/pages`, `/database`, `/sync`, `/automations`, `/flows`, `/functions`, `/neurons`, `/notifications`, `/files`, `/user`, `/chat`
- **Dependencies:** External (Cloudflare SDK), Notion API, Claude API

### `index.html`
- **Purpose:** HTML shell for the React app. Loads fonts (DM Sans, DM Mono, Outfit), sets viewport, and mounts React into `#root`.
- **Key exports:** None (static HTML)
- **Line count:** 22

### `package.json`
- **Purpose:** npm manifest. Declares React 18, Vite build tooling, jsPDF for export.
- **Key exports:** None (configuration)
- **Dependencies:** react, react-dom, jspdf

### `vite.config.js`
- **Purpose:** Vite build configuration. Dev server on 0.0.0.0:5173, React plugin, dist output.
- **Key exports:** `default` (Vite config object)
- **Line count:** 14

### `wrangler.toml`
- **Purpose:** Wrangler configuration for Cloudflare. Defines D1 bindings, R2 buckets, environment variables.
- **Key exports:** None (configuration)

### `wrangler-worker.toml`
- **Purpose:** Alternative Wrangler config (possibly for local worker testing).
- **Key exports:** None (configuration)

---

## `src/` - Main Application

### `main.jsx`
- **Purpose:** React entry point. Renders App component into the DOM.
- **Key exports:** None (side effects only)
- **Dependencies:** React, React DOM, App.jsx
- **Line count:** 9

### `App.jsx`
- **Purpose:** Root component and app shell. Provides all context providers (Platform, Links, Neurons, Theme, UserSync). Routes between login, setup, and main UI. Manages page navigation, keyboard shortcuts, and notification system.
- **Key exports:** `default` (App component)
- **Key re-exports:** ChatPanel, TasksView, NotesView, DashboardView, GmailView, WorkspaceBrowser, KnowledgeHub (lazy-loaded)
- **Dependencies:** All context providers, core components (TopHeader, Navigation, PageShell), agent (automations), Google integration, neurons
- **Line count:** ~700+
- **Known patterns:** Lazy-load retry wrapper for stale chunk recovery; localStorage key migration for renamed features

---

## `src/agent/` - AI/Agentic System

### `aiRouter.js`
- **Purpose:** Multi-tier model routing. Routes prompts to Haiku (cheap, fast) or Sonnet (powerful reasoning) based on complexity scoring.
- **Key exports:** `SONNET`, `HAIKU`, `routeModel()`, `shouldEscalate()`
- **Line count:** ~120+
- **Routing logic:** Scores complexity factors (long prompt, keywords, multi-step, conversation depth, tool count, data analysis). Requires ≥2 factors to escalate to Sonnet.

### `automations.js`
- **Purpose:** Automation execution engine. Browser-only polling system that queries D1 `automation_rules` and executes on trigger conditions (schedule, status_change, field_change, page_created, manual).
- **Key exports:** `expandTemplate()`, `parseD1Rule()`, `evaluateTrigger()`, `createAutomationEngine()`
- **Dependencies:** api.js, notion client/pagination, helpers
- **Line count:** ~800+
- **Known patterns:** 5-minute default poll; 30-minute backoff; max 3 concurrent executions per tick

### `dataSummary.js`
- **Purpose:** Summarizes table/view data for agent context. Extracts row counts, column info, and key statistics for brief workspace summaries.
- **Key exports:** `summarizeDatabase()`, `summarizeView()`
- **Dependencies:** api.js, notion properties
- **Line count:** ~200+

### `flowExecutor.js`
- **Purpose:** Executes node-based automation flows. Traverses a graph of connected action nodes, evaluating conditions and executing tools.
- **Key exports:** `executeFlow()`
- **Dependencies:** toolExecutor, helpers
- **Line count:** ~400+
- **Known patterns:** Node graph with edges; condition evaluation; tool delegation

### `memory.js`
- **Purpose:** Persistent conversation memory for agents. Stores/retrieves agent chat history in D1 or localStorage.
- **Key exports:** `saveAgentMemory()`, `loadAgentMemory()`, `clearAgentMemory()`
- **Dependencies:** api.js, helpers
- **Line count:** ~200+

### `queryClassifier.js`
- **Purpose:** Classifies user queries into intent categories (search, create, update, analyze, navigate). Used to optimize tool selection and response strategy.
- **Key exports:** `classifyQuery()`
- **Dependencies:** None (pure logic)
- **Line count:** ~150+

### `runAgent.js`
- **Purpose:** Core agentic loop. Sends messages to Claude, executes tool calls, handles backoff/retries. Parameterized — used by Wasabi, page agents, and automation agents.
- **Key exports:** `trimHistory()`, `runAgent()`
- **Dependencies:** helpers, costTracker, api.js
- **Line count:** ~600+
- **Key features:** History trimming to prevent stale data anchoring; write tool approval gate; live status callbacks; backoff on rate limits

### `toolExecutor.js`
- **Purpose:** Executes tool calls from Claude. Routes to appropriate API methods (query_database, create_page, update_page, post_notification, etc.). Handles Notion, D1, Gmail, calendar, and file tools.
- **Key exports:** `executeWasabiTool()`, `executeToolCall()`
- **Dependencies:** api.js, notion client, sheets client, Monday client, helpers
- **Line count:** ~2,153 (largest agent file)
- **Key tool routing:** Database queries, CRUD, aggregations, automations, flows, neurons, KB, reports, email, calendar, Google Sheets, Monday.com, files

### `tools.js`
- **Purpose:** Tool definitions (schemas) for Claude's tool_use. Organized by tool type: database, CRUD, analytics, automations, integrations, etc.
- **Key exports:** `QUERY_DATABASE`, `CREATE_PAGE`, `UPDATE_PAGE`, `POST_NOTIFICATION`, `SEND_EMAIL`, `QUERY_ANALYTICS`, `ZEN_TOOLS_ADMIN`, `ZEN_TOOLS_EDITOR`, `ZEN_TOOLS_VIEWER`, etc.
- **Line count:** ~1,064
- **Total tools:** 50+ shared tools across admin/editor/viewer roles

### `wasabiPrompt.js`
- **Purpose:** System prompt generation for the main Wasabi agent. Builds prompt with role info, workspace summary, available tools, and usage guidelines.
- **Key exports:** `buildWasabiSystemPrompt()`
- **Dependencies:** dataSummary, helpers
- **Line count:** ~150+

---

## `src/components/` - Shared UI Components

All components are React functional components (JSX). This directory contains reusable UI primitives used across views and pages.

### `Breadcrumb.jsx`
- **Purpose:** Navigation breadcrumb. Shows current page path with clickable ancestors.
- **Key exports:** `default` (Breadcrumb component)
- **Dependencies:** NavigationContext

### `ColumnBuilder.jsx`
- **Purpose:** UI for adding/editing table columns. Shows column type picker and property config.
- **Key exports:** `default` (ColumnBuilder component)
- **Dependencies:** design/tokens, components

### `ConflictToast.jsx`
- **Purpose:** Toast notification for real-time sync conflicts (e.g., two users editing the same cell).
- **Key exports:** `default` (ConflictToast component)
- **Line count:** ~100

### `EmptyState.jsx`
- **Purpose:** Empty state placeholder. Renders icon, title, and CTA when a view/table is empty.
- **Key exports:** `default` (EmptyState component)
- **Line count:** ~80

### `FormulaBar.jsx`
- **Purpose:** Spreadsheet formula editor. Shows/edits cell formula with syntax highlighting.
- **Key exports:** `default` (FormulaBar component)
- **Dependencies:** design/tokens, Sheet view context

### `InlineChart.jsx`
- **Purpose:** Mini chart widget. Renders bar, line, or pie charts from row data for dashboard cards.
- **Key exports:** `default` (InlineChart component)
- **Line count:** ~200+

### `MentionInput.jsx`
- **Purpose:** Text input with @mention completion. Used in comments and chat interfaces.
- **Key exports:** `default` (MentionInput component)
- **Dependencies:** api.js (for user list), helpers

### `MultiSelectPicker.jsx`
- **Purpose:** Multi-select dropdown picker. Used for multi_select property cells and filters.
- **Key exports:** `default` (MultiSelectPicker component)
- **Line count:** ~200+

### `PagePermissionsPanel.jsx`
- **Purpose:** Role-based access control UI. Shows/edits read/edit/admin roles for a page.
- **Key exports:** `default` (PagePermissionsPanel component)
- **Dependencies:** AuthContext, api.js

### `PinLockOverlay.jsx`
- **Purpose:** PIN entry dialog for restricted pages/records. Used in role-based access.
- **Key exports:** `default` (PinLockOverlay component)
- **Line count:** ~150

### `PresenceAvatars.jsx`
- **Purpose:** Shows avatars of users currently viewing/editing a page. Updates via CollaborationContext.
- **Key exports:** `default` (PresenceAvatars component)
- **Dependencies:** CollaborationContext

### `RecordComments.jsx`
- **Purpose:** Comments panel for a record. Shows threaded comments with @mentions.
- **Key exports:** `default` (RecordComments component)
- **Dependencies:** api.js, MentionInput

### `RecordDetailPortals.jsx`
- **Purpose:** React portals for record detail panels (notes, files, comments, activity). Used by RecordDetail and Zen RecordDrawer.
- **Key exports:** `default` (RecordDetailPortals component)
- **Line count:** ~300+

### `RecordFiles.jsx`
- **Purpose:** File list for a record. Shows uploaded files, download buttons, and delete actions.
- **Key exports:** `default` (RecordFiles component)
- **Dependencies:** api.js, files utility

### `RecordNotes.jsx`
- **Purpose:** Notes panel for a record. Markdown editor with save/edit.
- **Key exports:** `default` (RecordNotes component)
- **Dependencies:** api.js, markdown utility

### `SavedViewsDropdown.jsx`
- **Purpose:** Dropdown to switch between saved views of a table.
- **Key exports:** `default` (SavedViewsDropdown component)
- **Dependencies:** PagesContext

### `SelectPicker.jsx`
- **Purpose:** Single-select dropdown picker. Used for select property cells and status fields.
- **Key exports:** `default` (SelectPicker component)
- **Line count:** ~180

### `SheetToolbar.jsx`
- **Purpose:** Toolbar for Sheet view. Insert/delete rows/columns, resize, freeze, export.
- **Key exports:** `default` (SheetToolbar component)
- **Dependencies:** Sheet view

### `Spinner.jsx`
- **Purpose:** Loading spinner component. Used during data fetches.
- **Key exports:** `default` (Spinner component)
- **Line count:** ~40

### `SyncPanel.jsx`
- **Purpose:** Notion sync UI. Shows sync status, triggers manual pull/push, configures bidirectional sync.
- **Key exports:** `default` (SyncPanel component)
- **Dependencies:** api.js, PagesContext

### `ViewSettingsPanel.jsx`
- **Purpose:** View configuration panel. Filters, sorts, grouping, column visibility, aggregations.
- **Key exports:** `default` (ViewSettingsPanel component)
- **Dependencies:** design/tokens, api.js
- **Line count:** ~1,005

### `ViewToolbar.jsx`
- **Purpose:** Top toolbar for table/view. Filter chips, view type picker, column builder, export.
- **Key exports:** `default` (ViewToolbar component)
- **Dependencies:** FilterChips, ViewSettingsPanel, ColumnBuilder

### `WidgetGrid.jsx`
- **Purpose:** Dashboard grid layout. Renders widgets (charts, summaries, cards) in a responsive grid.
- **Key exports:** `default` (WidgetGrid component)
- **Dependencies:** design/tokens, InlineChart, DashboardWidget

---

## `src/config/` - Configuration & Templating

### `flowStorage.js`
- **Purpose:** D1 storage for automation flows. CRUD operations for node-based flows.
- **Key exports:** `createFlow()`, `updateFlow()`, `deleteFlow()`, `listFlows()`, `loadFlow()`
- **Dependencies:** api.js, helpers
- **Line count:** ~200+

### `linkStorage.js`
- **Purpose:** Manages link (neuron node) definitions. CRUD for linking records, pages, and fields.
- **Key exports:** `createLink()`, `updateLink()`, `deleteLink()`, `loadLinks()`
- **Dependencies:** api.js
- **Line count:** ~150+

### `linkTypeCompat.js`
- **Purpose:** Link type compatibility matrix. Defines which record types can be linked together.
- **Key exports:** `isCompatible()`, `LINK_TYPES`
- **Line count:** ~80

### `pageConfig.js`
- **Purpose:** Page configuration schema and helpers. Defaults for new pages, type-specific configs.
- **Key exports:** `defaultPageConfig()`, `validatePageConfig()`, `getPageIcon()`
- **Line count:** ~200+

### `setup.js`
- **Purpose:** Initial setup wizard flow. Guides new users through auth, worker connection, first database.
- **Key exports:** `setupSteps`, `validateSetup()`
- **Line count:** ~150+

### `templates.js`
- **Purpose:** Template definitions for new pages (table, sheet, dashboard, form, etc.). Pre-built configs.
- **Key exports:** `TABLE_TEMPLATE`, `SHEET_TEMPLATE`, `DASHBOARD_TEMPLATE`, `getTemplate()`
- **Line count:** ~250+

---

## `src/context/` - React Context Providers

All files export a Provider component and a custom hook. Centralized state management.

### `AuthContext.jsx`
- **Purpose:** Authentication state. User identity, JWT tokens, multi-user roles (admin/editor/viewer), API keys for integrations.
- **Key exports:** `AuthProvider`, `useAuth()`
- **Line count:** ~400+

### `CollaborationContext.jsx`
- **Purpose:** Real-time collaboration state. User presence (who's viewing/editing), cursor positions, conflict resolution.
- **Key exports:** `CollaborationProvider`, `useCollaboration()`
- **Dependencies:** lib/tableSocket, lib/userSocket
- **Line count:** ~300+

### `ColorMappingContext.jsx`
- **Purpose:** Select field color palette mappings. Stores custom colors for status/select options.
- **Key exports:** `ColorMappingProvider`, `useColorMapping()`
- **Line count:** ~150

### `LinksContext.jsx`
- **Purpose:** Knowledge graph (neurons) state. Active neuron, selected nodes, link data.
- **Key exports:** `LinksProvider`, `useLinks()`
- **Dependencies:** neurons/neuronStorage
- **Line count:** ~200+

### `NavigationContext.jsx`
- **Purpose:** Page navigation state. Active page, active folder, breadcrumb trail.
- **Key exports:** `NavigationProvider`, `useNavigation()`
- **Line count:** ~180

### `PagesContext.jsx`
- **Purpose:** Page library state. List of all pages, folders, databases. CRUD operations.
- **Key exports:** `PagesProvider`, `usePages()`
- **Dependencies:** api.js
- **Line count:** ~300+

### `PlatformContext.jsx`
- **Purpose:** Thin composition layer. Merges Auth, Pages, and Navigation contexts. Backward compatibility.
- **Key exports:** `PlatformProvider`, `usePlatform()`
- **Dependencies:** AuthContext, PagesContext, NavigationContext
- **Line count:** ~150+

### `ThemeContext.jsx`
- **Purpose:** Theme state (dark/light mode). Provides color tokens and rebuild theme function.
- **Key exports:** `ThemeProvider`, `useTheme()`
- **Dependencies:** design/tokens
- **Line count:** ~200+

### `UserSyncContext.jsx`
- **Purpose:** Multi-user identity sync. Syncs user list, roles, and presence across tabs.
- **Key exports:** `UserSyncProvider`, `useUserSync()`
- **Dependencies:** api.js, AuthContext
- **Line count:** ~250+

---

## `src/core/` - Core UI Components

Large, complex components that form the application shell and major features.

### `AutomationBuilder.jsx`
- **Purpose:** Visual builder for automation rules. Drag-and-drop trigger/action pairing.
- **Key exports:** `default` (AutomationBuilder component)
- **Dependencies:** design/tokens, api.js
- **Line count:** ~500+

### `AutomationPage.jsx`
- **Purpose:** Page wrapper for automation list and builder. Shows all rules, create/edit/delete.
- **Key exports:** `default` (AutomationPage component)
- **Dependencies:** AutomationBuilder, api.js

### `BatchQueue.jsx`
- **Purpose:** Batch operation queue UI. Shows progress for bulk inserts, updates, deletes.
- **Key exports:** `default` (BatchQueue component)
- **Line count:** ~300+

### `BuildPage.jsx`
- **Purpose:** Page builder UI. Drag-and-drop page layout, add/remove components, configure properties.
- **Key exports:** `default` (BuildPage component)
- **Dependencies:** VisualPageBuilder, design/tokens, api.js
- **Line count:** ~819

### `ChatUI.jsx`
- **Purpose:** Reusable chat interface component. Message history, markdown rendering, file upload, choices.
- **Key exports:** `default` (ChatUI component)
- **Dependencies:** markdown utility, files utility, reportGenerator
- **Line count:** ~400+
- **Used by:** Wasabi agent, page agents, system manager, automation builder

### `CommandPalette.jsx`
- **Purpose:** Command palette (Cmd+K). Quick navigation, search pages, run automations, execute tools.
- **Key exports:** `default` (CommandPalette component)
- **Dependencies:** PlatformContext, api.js
- **Line count:** ~400+

### `ConfirmDialog.jsx`
- **Purpose:** Modal confirmation dialog. Used for destructive actions (delete, archive).
- **Key exports:** `default` (ConfirmDialog component)
- **Line count:** ~120

### `ContextMenu.jsx`
- **Purpose:** Right-click context menu. Shows actions for records, cells, etc.
- **Key exports:** `default` (ContextMenu component)
- **Line count:** ~180

### `CreateMenu.jsx`
- **Purpose:** Quick create menu. New page, database, sheet, document, etc.
- **Key exports:** `default` (CreateMenu component)
- **Dependencies:** pageConfig, api.js, PlatformContext
- **Line count:** ~300+

### `DashboardWidget.jsx`
- **Purpose:** Dashboard widget card. Renders chart, summary tile, or custom widget.
- **Key exports:** `default` (DashboardWidget component)
- **Dependencies:** InlineChart, design/tokens

### `DatabaseBrowser.jsx`
- **Purpose:** Modal to browse and link to Notion databases. Shows Notion workspace structure.
- **Key exports:** `default` (DatabaseBrowser component)
- **Dependencies:** notion/client, api.js, design/tokens
- **Line count:** ~1,640

### `Drawer.jsx`
- **Purpose:** Side drawer panel. Used for record detail, settings, etc.
- **Key exports:** `default` (Drawer component)
- **Line count:** ~150

### `ErrorBoundary.jsx`
- **Purpose:** React error boundary. Catches render errors, shows fallback UI, logs to console.
- **Key exports:** `default` (ErrorBoundary component)
- **Line count:** ~80

### `FolderDropdown.jsx`
- **Purpose:** Dropdown to select/navigate folders. Used in breadcrumb and page pickers.
- **Key exports:** `default` (FolderDropdown component)
- **Dependencies:** PagesContext

### `FunctionBuilder.jsx`
- **Purpose:** Custom function/formula editor. JavaScript code editor with syntax highlighting.
- **Key exports:** `default` (FunctionBuilder component)
- **Dependencies:** design/tokens, api.js
- **Line count:** ~684

### `FunctionsPanel.jsx`
- **Purpose:** List of custom functions (transforms, aggregations, formulas). CRUD operations.
- **Key exports:** `default` (FunctionsPanel component)
- **Dependencies:** FunctionBuilder, api.js
- **Line count:** ~400+

### `InlineEdit.jsx`
- **Purpose:** Inline text editing. Used for quick rename of pages, fields, etc.
- **Key exports:** `default` (InlineEdit component)
- **Line count:** ~100

### `KnowledgeBase.jsx`
- **Purpose:** Knowledge base management UI. View/edit KB entries, organize by category.
- **Key exports:** `default` (KnowledgeBase component)
- **Dependencies:** api.js
- **Line count:** ~500+

### `LinkPicker.jsx`
- **Purpose:** Modal to pick a linked record. Search and select related records.
- **Key exports:** `default` (LinkPicker component)
- **Dependencies:** api.js, design/tokens
- **Line count:** ~300+

### `LoginScreen.jsx`
- **Purpose:** Auth UI. Login/register/multi-user selection. Handles JWT flow.
- **Key exports:** `default` (LoginScreen component)
- **Dependencies:** AuthContext, api.js
- **Line count:** ~400+

### `MiniView.jsx`
- **Purpose:** Embedded view renderer. Render a table/chart/form inside a widget or modal.
- **Key exports:** `default` (MiniView component)
- **Dependencies:** ViewRenderer

### `Navigation.jsx`
- **Purpose:** Sidebar navigation. Icon bar + expandable page tree. Active page highlighting.
- **Key exports:** `default` (Navigation component)
- **Dependencies:** PlatformContext, NavigationContext, design/icons
- **Line count:** ~739

### `NodeEditor.jsx`
- **Purpose:** Flow node editor. Edit node properties (condition, instruction, tool). Used in AutomationBuilder and FlowBuilder.
- **Key exports:** `default` (NodeEditor component)
- **Dependencies:** design/tokens, api.js
- **Line count:** ~1,411

### `Onboarding.jsx`
- **Purpose:** Onboarding tutorial. Guided walkthrough for new users.
- **Key exports:** `default` (Onboarding component)
- **Dependencies:** PlatformContext

### `PageBuilder.jsx`
- **Purpose:** Visual page layout builder. Drag-and-drop zones, add sections, configure layout.
- **Key exports:** `default` (PageBuilder component)
- **Dependencies:** design/tokens, api.js
- **Line count:** ~300+

### `PageShell.jsx`
- **Purpose:** Page wrapper component. Routes to correct view type (Table, Sheet, Dashboard, etc.) based on page config.
- **Key exports:** `default` (PageShell component)
- **Dependencies:** ViewRenderer, all views
- **Line count:** ~200+

### `PluginWidget.jsx`
- **Purpose:** Renders a plugin widget from plugin manifest. Sandboxed iframe for custom UIs.
- **Key exports:** `default` (PluginWidget component)
- **Dependencies:** lib/iframeHelpers

### `SetupWizard.jsx`
- **Purpose:** Initial setup flow. Connect to Cloudflare Worker, add API keys, create first database.
- **Key exports:** `default` (SetupWizard component)
- **Dependencies:** setup config, api.js
- **Line count:** ~500+

### `SheetUrlDialog.jsx`
- **Purpose:** Modal to paste/configure Google Sheets URL for linking.
- **Key exports:** `default` (SheetUrlDialog component)
- **Dependencies:** api.js

### `SubPageNav.jsx`
- **Purpose:** Sub-page navigation. Shows child pages of a folder.
- **Key exports:** `default` (SubPageNav component)
- **Dependencies:** PagesContext

### `SystemManager.jsx`
- **Purpose:** Admin panel for system settings, user management, integration config, cost tracking.
- **Key exports:** `default` (SystemManager component)
- **Dependencies:** api.js, AuthContext, design/tokens
- **Line count:** ~2,281 (large admin interface)

### `TopHeader.jsx`
- **Purpose:** Top header bar. Shows page title, breadcrumb, right-side controls (Wasabi agent, settings, user menu).
- **Key exports:** `default` (TopHeader component)
- **Dependencies:** PlatformContext, design/icons, WasabiPanel

### `ViewTypePicker.jsx`
- **Purpose:** Modal to select view type for a page (Table, Sheet, Calendar, Form, etc.).
- **Key exports:** `default` (ViewTypePicker component)
- **Dependencies:** design/tokens

### `VisualPageBuilder.jsx`
- **Purpose:** Advanced page builder with drag-and-drop zones and layout grid.
- **Key exports:** `default` (VisualPageBuilder component)
- **Dependencies:** design/tokens, api.js
- **Line count:** ~1,345

### `WasabiFlame.jsx`
- **Purpose:** Animated logo component. Used as icon in UI.
- **Key exports:** `default` (WasabiFlame component)
- **Line count:** ~100

### `WasabiOrb.jsx`
- **Purpose:** Animated orb component (visual element). Used as loading indicator or accent.
- **Key exports:** `default` (WasabiOrb component)
- **Line count:** ~80

### `WasabiPanel.jsx`
- **Purpose:** Main Wasabi agent chat panel. Docked on right side, draggable, resizable.
- **Key exports:** `default` (WasabiPanel component)
- **Dependencies:** ChatUI, runAgent, tools, design/tokens
- **Line count:** ~690

---

## `src/design/` - Design System

### `animations.js`
- **Purpose:** CSS animation definitions and injection. Global animation library (fade, slide, pulse, spin).
- **Key exports:** `ANIM` (animation object), `injectAnimations()`, `injectInteractionStyles()`, `injectScrollbarStyles()`, `updateCSSCustomProperties()`
- **Line count:** ~500+

### `icons.jsx`
- **Purpose:** SVG icon library. 80+ icons (IconTrash, IconPlus, IconUser, etc.).
- **Key exports:** `Icon*` components (all exported as named exports)
- **Line count:** ~753

### `styles.js`
- **Purpose:** Shared style objects (rebuildable on theme change). Used by styled-components pattern.
- **Key exports:** `S` (styles object), `rebuildStyles()`
- **Dependencies:** tokens.js
- **Line count:** ~600+

### `tokens.js`
- **Purpose:** Design tokens (colors, typography, spacing, shadows, radii). Mutable and rebuildable on theme change.
- **Key exports:** `C` (color tokens), `FONT`, `MONO`, `RADIUS`, `SHADOW`, `getStatusColor()`, `getSolidPillColor()`
- **Line count:** ~250+
- **Color scheme:** Dark-first design; accent is green (#7DC143); semantic colors (success, warning, error)

---

## `src/google/` - Google Integration

### `googleContext.js`
- **Purpose:** Fetch Google Sheets and Gmail context for agent. Builds summaries of sheets and recent emails.
- **Key exports:** `fetchGoogleContext()`
- **Dependencies:** api.js, helpers
- **Line count:** ~150+

### `googleNeuronCleanup.js`
- **Purpose:** Cleanup routine for Gmail → Neuron nodes. Removes stale nodes when emails are deleted.
- **Key exports:** `cleanupGoogleNeuronNodes()`
- **Dependencies:** api.js, neurons
- **Line count:** ~100+

---

## `src/hooks/` - Custom React Hooks

### `useRecordDetail.js`
- **Purpose:** Hook for record detail panel state. Loads record data, manages edit mode, handles save/discard.
- **Key exports:** `useRecordDetail()`
- **Dependencies:** api.js
- **Line count:** ~200+

### `useViewPrefs.js`
- **Purpose:** Hook for view-specific preferences (column order, widths, hidden columns). Stores in localStorage.
- **Key exports:** `useViewPrefs()`
- **Line count:** ~150+

---

## `src/lib/` - Utilities & Libraries

### `api.js`
- **Purpose:** Centralized API client. All backend calls go through here. Handles auth (X-Wasabi-Key, JWT), error handling, connection state.
- **Key exports:** `apiFetch()`, `getConnection()`, `saveConnection()`, `getJwt()`, `saveJwt()`, `queryDatabase()`, `createPage()`, `updatePage()`, `updateTableSchema()`, `getTableSchema()`, `createAutomationRule()`, `listFunctions()`, `createFunction()`, `listNeurons()`, `createNeuron()`, `postNotification()`, `getGoogleStatus()`, `sheetFormula()`, `queryAnalytics()`, `queryRecords()`, `bulk operations`, `Gmail/calendar operations`, `Monday.com operations`, `file operations`, `sync operations`
- **Line count:** ~996 (second largest file — hub of all API interaction)
- **Dependencies:** helpers.js
- **Key pattern:** All endpoints prefixed with `/` (routed through Worker)

### `dataSource.js`
- **Purpose:** D1 data source abstraction. Schema validation, type conversion, query building.
- **Key exports:** `DataSource` class, `query()`, `queryOne()`, `create()`, `update()`, `delete()`, `bulkCreate()`
- **Dependencies:** helpers
- **Line count:** ~300+

### `iframeHelpers.js`
- **Purpose:** Utilities for plugin iframe communication. PostMessage wrapper, timeout handling.
- **Key exports:** `sendToFrame()`, `onFrameMessage()`, `initFrameHandshake()`
- **Line count:** ~100+

### `roles.js`
- **Purpose:** Role-based access control helpers. Permission checking (canRead, canEdit, canAdmin).
- **Key exports:** `canRead()`, `canEdit()`, `canAdmin()`, `getRoleLevel()`
- **Line count:** ~100

### `tableSocket.js`
- **Purpose:** WebSocket connection for real-time table updates. Subscribes to cell changes, row insertions, deletions.
- **Key exports:** `TableSocket` class, `subscribe()`, `unsubscribe()`, `send()`
- **Dependencies:** helpers
- **Line count:** ~250+

### `userSocket.js`
- **Purpose:** WebSocket connection for user presence and cursor tracking. Broadcasts user state across tabs.
- **Key exports:** `UserSocket` class, `broadcastPresence()`, `trackCursor()`
- **Dependencies:** helpers
- **Line count:** ~200+

---

## `src/monday/` - Monday.com Integration

### `client.js`
- **Purpose:** Monday.com GraphQL client. Proxied through Worker. Queries boards, items, columns.
- **Key exports:** `queryBoard()`, `queryItem()`, `updateItem()`, `createItem()`, `deleteItem()`
- **Dependencies:** api.js
- **Line count:** ~250+

### `schema.js`
- **Purpose:** Monday.com schema mapping. Converts Monday column types to Notion property types.
- **Key exports:** `MONDAY_TYPE_MAP`, `mapMondayToNotion()`, `mapNotionToMonday()`
- **Line count:** ~150+

---

## `src/neurons/` - Knowledge Graph System

### `NeuronBadge.jsx`
- **Purpose:** Visual badge showing a record is part of a neuron. Click to view connections.
- **Key exports:** `default` (NeuronBadge component)
- **Dependencies:** NeuronsContext, design/tokens

### `NeuronLines.jsx`
- **Purpose:** SVG lines between connected nodes. Renders the visual graph overlay.
- **Key exports:** `default` (NeuronLines component)
- **Dependencies:** NeuronsContext

### `NeuronOverlay.jsx`
- **Purpose:** Modal overlay showing neuron graph visualization. Interactive node selection and editing.
- **Key exports:** `default` (NeuronOverlay component)
- **Dependencies:** NeuronsContext, design/tokens
- **Line count:** ~400+

### `NeuronsContext.jsx`
- **Purpose:** Global neurons (knowledge graph) state. Manages neurons, nodes, graph indexing, badge lookups.
- **Key exports:** `NeuronsProvider`, `useNeurons()`, `isNeuronsMode()`, `dispatchNeuronSelect()`
- **Dependencies:** neuronStorage.js
- **Line count:** ~500+
- **Key pattern:** O(1) badge lookup via graph indexing; window events for cross-component selection

### `neuronStorage.js`
- **Purpose:** D1 storage for neurons. CRUD for neurons and nodes. Graph indexing.
- **Key exports:** `loadNeurons()`, `loadNeuron()`, `createNeuron()`, `deleteNeuron()`, `addNode()`, `removeNode()`, `loadNeuronGraph()`, `loadCachedNeurons()`
- **Dependencies:** api.js, helpers
- **Line count:** ~400+

---

## `src/notion/` - Notion API Integration

### `client.js`
- **Purpose:** Notion API client. All calls routed through Worker proxy. No globals.
- **Key exports:** `queryAll()`, `queryLimited()`, `getPage()`, `createPage()`, `updatePage()`, `getDatabase()`, `updateDatabase()`, `searchDatabases()`, `getUser()`, `listUsers()`
- **Dependencies:** pagination.js, properties.js, api.js
- **Line count:** ~350+

### `pagination.js`
- **Purpose:** Notion pagination helpers. Handles cursor-based pagination for large result sets.
- **Key exports:** `queryAll()`, `queryLimited()`
- **Line count:** ~150+

### `properties.js`
- **Purpose:** Notion property type conversions. Read/build property values for all property types (text, select, date, relation, etc.).
- **Key exports:** `readProp()`, `buildProp()`, `extractProperties()`, `getPageTitle()`
- **Dependencies:** helpers
- **Line count:** ~600+

### `schema.js`
- **Purpose:** Notion schema mapping. Maps Notion property types to internal representation.
- **Key exports:** `NOTION_TYPE_MAP`, `mapNotionToInternal()`, `mapInternalToNotion()`
- **Line count:** ~200+

---

## `src/sheets/` - Google Sheets Integration

### `sheetClient.js`
- **Purpose:** Google Sheets API client (via Worker proxy). Read/write sheets.
- **Key exports:** `readSheet()`, `writeSheet()`, `appendSheet()`, `updateSheetMetadata()`, `getSheetStructure()`
- **Dependencies:** api.js
- **Line count:** ~300+

---

## `src/utils/` - Utility Functions

### `costTracker.js`
- **Purpose:** Usage tracking and cost estimation. Logs API calls, token counts, calculates spend.
- **Key exports:** `recordUsage()`, `getCostSummary()`, `trackModelUsage()`
- **Dependencies:** helpers
- **Line count:** ~150+

### `fileProcessing.js`
- **Purpose:** File upload and processing. Handles file type validation, size limits, chunking for large files.
- **Key exports:** `validateFile()`, `processFile()`, `chunkFile()`
- **Line count:** ~250+

### `files.js`
- **Purpose:** File utility helpers. Parse, validate, format file metadata.
- **Key exports:** `parseFile()`, `formatFileSize()`, `getFileIcon()`
- **Dependencies:** helpers
- **Line count:** ~150+

### `helpers.js`
- **Purpose:** General utilities. UUID, debounce, throttle, formatDate, truncate, safeJSON, etc.
- **Key exports:** `uuid()`, `debounce()`, `throttle()`, `formatDate()`, `formatTime()`, `truncate()`, `safeJSON()`, `sleep()`, `pluralize()`
- **Line count:** ~400+

### `markdown.js`
- **Purpose:** Markdown rendering to HTML. Supports GFM, syntax highlighting, embeds.
- **Key exports:** `renderMarkdown()`, `escapeHtml()`
- **Line count:** ~200+

### `reportExport.js`
- **Purpose:** Report export to PDF/Excel. Formats data, applies styling, generates file.
- **Key exports:** `exportToPDF()`, `exportToExcel()`, `formatReportData()`
- **Dependencies:** jsPDF, file utilities
- **Line count:** ~300+

### `reportGenerator.js`
- **Purpose:** Report generation from table/chart data. Summaries, statistics, formatted output.
- **Key exports:** `generateReport()`, `downloadReport()`, `hasReportableContent()`, `formatReportOutput()`
- **Dependencies:** markdown.js, reportExport.js
- **Line count:** ~855

### `useKeyboardShortcuts.js`
- **Purpose:** Keyboard shortcut hook. Globally registers Cmd+K (command palette), Cmd+J (Wasabi), etc.
- **Key exports:** `useKeyboardShortcuts()`
- **Dependencies:** helpers
- **Line count:** ~150+

---

## `src/views/` - View Components (Data Display)

Large components that render different view types for tables/databases.

### `ActivityFeed.jsx`
- **Purpose:** Activity feed view. Shows timeline of changes (create, update, delete) on records.
- **Key exports:** `default` (ActivityFeed component)
- **Dependencies:** api.js, design/tokens
- **Line count:** ~300+

### `Calendar.jsx` (deprecated, see CalendarView)
- **Purpose:** Legacy calendar view.
- **Note:** Superseded by CalendarView.jsx

### `CalendarView.jsx`
- **Purpose:** Calendar grid view. Shows events and tasks by date. Supports date filters.
- **Key exports:** `default` (CalendarView component)
- **Dependencies:** design/tokens, api.js
- **Line count:** ~1,227

### `CardGrid.jsx`
- **Purpose:** Card grid view (kanban-like). Shows records as draggable cards grouped by a select field.
- **Key exports:** `default` (CardGrid component)
- **Dependencies:** design/tokens, api.js
- **Line count:** ~500+

### `Charts.jsx`
- **Purpose:** Charting view. Bar, line, pie charts from table aggregations.
- **Key exports:** `default` (Charts component)
- **Dependencies:** design/tokens, api.js
- **Line count:** ~600+

### `ChatPanel.jsx`
- **Purpose:** Chat panel for viewing/page context (note: differs from zen/ChatPanel).
- **Key exports:** `default` (ChatPanel component)
- **Dependencies:** ChatUI, design/tokens

### `ConnectionRenderer.jsx`
- **Purpose:** Renders related records via relation properties. Shows connected record cards.
- **Key exports:** `default` (ConnectionRenderer component)
- **Dependencies:** LinkPicker, design/tokens

### `CustomView.jsx`
- **Purpose:** Custom/user-defined view type. Extensible framework for plugin views.
- **Key exports:** `default` (CustomView component)
- **Dependencies:** api.js, design/tokens
- **Line count:** ~701

### `Document.jsx`
- **Purpose:** Document view. Renders rich text document with formatting.
- **Key exports:** `default` (Document component)
- **Dependencies:** api.js, markdown.js

### `DocumentEditor.jsx`
- **Purpose:** Document editor. WYSIWYG editor for document pages.
- **Key exports:** `default` (DocumentEditor component)
- **Dependencies:** api.js, design/tokens
- **Line count:** ~1,787 (large editor)

### `FilterChips.jsx`
- **Purpose:** Filter UI component. Shows active filters as editable chips.
- **Key exports:** `default` (FilterChips component), `applyChipFilters()`
- **Dependencies:** design/tokens
- **Line count:** ~400+

### `Form.jsx`
- **Purpose:** Form view. Renders records as fillable forms instead of table rows.
- **Key exports:** `default` (Form component)
- **Dependencies:** design/tokens, api.js
- **Line count:** ~500+

### `Gantt.jsx`
- **Purpose:** Gantt chart view. Timeline view with task bars.
- **Key exports:** `default` (Gantt component)
- **Dependencies:** design/tokens, api.js
- **Line count:** ~1,198

### `GmailView.jsx`
- **Purpose:** Gmail integration view. Shows Gmail inbox, threads, and allows compose.
- **Key exports:** `default` (GmailView component)
- **Dependencies:** api.js, design/tokens
- **Line count:** ~841

### `Kanban.jsx`
- **Purpose:** Kanban board view. Columns = select field values, cards = records.
- **Key exports:** `default` (Kanban component)
- **Dependencies:** design/tokens, api.js
- **Line count:** ~600+

### `LinkedSheet.jsx`
- **Purpose:** Linked Google Sheets view (read-only proxy).
- **Key exports:** `default` (LinkedSheet component)
- **Dependencies:** api.js, design/tokens

### `NetworkGraph.jsx`
- **Purpose:** Network graph visualization. Shows nodes (records) and edges (relations).
- **Key exports:** `default` (NetworkGraph component)
- **Dependencies:** design/tokens, api.js
- **Line count:** ~400+

### `NewRecordModal.jsx`
- **Purpose:** Quick record creation modal. Shows property form for new row/page.
- **Key exports:** `default` (NewRecordModal component)
- **Dependencies:** design/tokens, api.js

### `NodeCanvas.jsx`
- **Purpose:** Node-based workflow visualization. Used in automations and flows.
- **Key exports:** `default` (NodeCanvas component)
- **Dependencies:** design/tokens

### `NodeConfigPanel.jsx`
- **Purpose:** Panel to configure a flow/automation node. Shows properties, actions, conditions.
- **Key exports:** `default` (NodeConfigPanel component)
- **Dependencies:** design/tokens, api.js
- **Line count:** ~776

### `NodeRenderer.jsx`
- **Purpose:** Renders individual nodes in node canvas.
- **Key exports:** `default` (NodeRenderer component)
- **Dependencies:** design/tokens

### `NotificationFeed.jsx`
- **Purpose:** Notification center. Shows all notifications with archive/dismiss.
- **Key exports:** `default` (NotificationFeed component)
- **Dependencies:** api.js, design/tokens
- **Line count:** ~698

### `RecordDetail.jsx`
- **Purpose:** Modal/drawer showing full record detail. Properties, comments, files, activity.
- **Key exports:** `default` (RecordDetail component)
- **Dependencies:** RecordDetailPortals, api.js, design/tokens
- **Line count:** ~1,300

### `Sheet.jsx`
- **Purpose:** Spreadsheet view. Full spreadsheet grid with formulas, cell styling, freeze panes.
- **Key exports:** `default` (Sheet component)
- **Dependencies:** api.js, design/tokens, SheetToolbar, FormulaBar
- **Line count:** ~1,573

### `SummaryTiles.jsx`
- **Purpose:** Summary dashboard tiles. Shows key metrics (record count, avg, sum, etc.).
- **Key exports:** `default` (SummaryTiles component)
- **Dependencies:** api.js, design/tokens

### `Table.jsx`
- **Purpose:** Primary table view. Schema-agnostic, sortable, filterable, inline-editable data table.
- **Key exports:** `default` (Table component)
- **Dependencies:** api.js, notion/properties, design/tokens, FilterChips, RecordDetail
- **Line count:** ~3,107 (largest view component)
- **Key features:** Cell-level editing, column builder, owner tracking, record detail modal, multi-select, bulk operations

### `ViewRenderer.jsx`
- **Purpose:** Dispatcher that renders the correct view type based on page config.
- **Key exports:** `default` (ViewRenderer component)
- **Dependencies:** All view components, design/tokens

### `WorkspaceSettings.jsx`
- **Purpose:** Workspace settings page. User management, integrations, general settings.
- **Key exports:** `default` (WorkspaceSettings component)
- **Dependencies:** api.js, design/tokens, AuthContext

### `_CellComponents.jsx`
- **Purpose:** Reusable cell renderers for Table view. One component per property type (TextCell, SelectCell, DateCell, etc.).
- **Key exports:** `TextCell`, `SelectCell`, `MultiSelectCell`, `DateCell`, `CheckboxCell`, `NumberCell`, `RelationCell`, `PeopleCell`, etc.
- **Dependencies:** design/tokens, SelectPicker, MultiSelectPicker, LinkPicker

### `_viewHelpers.js`
- **Purpose:** Shared view utilities. Filter logic, sort logic, export formatting.
- **Key exports:** `applyFilters()`, `applySorts()`, `groupRecords()`, `formatForExport()`
- **Line count:** ~300+

---

## `src/zen/` - Zen Mode / Simplified Views

Zen mode provides a distraction-free, task-focused interface. Views are optimized for workflows.

### `CalendarView.jsx`
- **Purpose:** Zen calendar view. Task/event calendar with quick-create bar.
- **Key exports:** `default` (CalendarView component)
- **Dependencies:** calendar/*, design/tokens, useAICuratedTasks

### `ChatPanel.jsx`
- **Purpose:** Zen chat panel (dual-tab assistant/agent). Enhanced Assistant tab with role-based tools.
- **Key exports:** `default` (ChatPanel component)
- **Dependencies:** ChatUI, WasabiPanel, aiRouter, tools, api.js
- **Line count:** ~400+

### `DashboardView.jsx`
- **Purpose:** Zen dashboard. Widgets, quick stats, shortcuts to key data.
- **Key exports:** `default` (DashboardView component)
- **Dependencies:** WidgetGrid, api.js, design/tokens

### `EmailThreadDrawer.jsx`
- **Purpose:** Side drawer showing full email thread. Reply/forward UI.
- **Key exports:** `default` (EmailThreadDrawer component)
- **Dependencies:** api.js, design/tokens
- **Line count:** ~726

### `GmailView.jsx`
- **Purpose:** Zen Gmail inbox view. Simplified email interface with threading.
- **Key exports:** `default` (GmailView component)
- **Dependencies:** api.js, design/tokens, EmailThreadDrawer
- **Line count:** ~895

### `KnowledgeHub.jsx`
- **Purpose:** Zen knowledge hub. Quick access to documents, notes, KB entries.
- **Key exports:** `default` (KnowledgeHub component)
- **Dependencies:** api.js, design/tokens

### `NotesView.jsx`
- **Purpose:** Zen notes view. Quick note-taking, organizing, tagging.
- **Key exports:** `default` (NotesView component)
- **Dependencies:** api.js, markdown.js, design/tokens

### `RecordDrawer.jsx`
- **Purpose:** Zen record detail drawer. Streamlined record view with quick edits.
- **Key exports:** `default` (RecordDrawer component)
- **Dependencies:** RecordDrawerContext, api.js, design/tokens
- **Line count:** ~1,100

### `RecordDrawerContext.jsx`
- **Purpose:** Context for record drawer state. What record to show, edit mode, etc.
- **Key exports:** `RecordDrawerProvider`, `useRecordDrawer()`
- **Line count:** ~100

### `TaskList.jsx`
- **Purpose:** Zen task list. Shows tasks from configured task table.
- **Key exports:** `default` (TaskList component)
- **Dependencies:** api.js, design/tokens

### `TasksView.jsx`
- **Purpose:** Zen tasks view. Main task management interface with calendar, list, and AI curation.
- **Key exports:** `default` (TasksView component)
- **Dependencies:** useAICuratedTasks, useTasksTable, api.js, design/tokens
- **Line count:** ~600+

### `WorkspaceBrowser.jsx`
- **Purpose:** Zen workspace browser. Quick navigation to all databases, pages, shortcuts.
- **Key exports:** `default` (WorkspaceBrowser component)
- **Dependencies:** api.js, PagesContext, design/tokens
- **Line count:** ~916

### `ZenChatPanel.jsx`
- **Purpose:** Zen chat sidebar. Minimized chat UI for side-by-side workflow.
- **Key exports:** `default` (ZenChatPanel component)
- **Dependencies:** ChatUI, design/tokens

### `calendar/` Subdirectory (Calendar Components)

#### `CalendarEventBlock.jsx`
- **Purpose:** Single event block in calendar grid. Shows event title, time, attendees.
- **Key exports:** `default` (CalendarEventBlock component)

#### `CalendarFilterDropdown.jsx`
- **Purpose:** Calendar filter UI. Filter by calendar, event type, attendee.
- **Key exports:** `default` (CalendarFilterDropdown component)

#### `CalendarTaskBlock.jsx`
- **Purpose:** Task block in calendar grid. Shows task priority, completion.
- **Key exports:** `default` (CalendarTaskBlock component)

#### `DayColumn.jsx`
- **Purpose:** Single day column in week view. Shows events and tasks for one day.
- **Key exports:** `default` (DayColumn component)

#### `MonthGrid.jsx`
- **Purpose:** Month grid view. Shows all days of a month with events.
- **Key exports:** `default` (MonthGrid component)

#### `QuickCreateBar.jsx`
- **Purpose:** Quick event/task creation bar. Add event/task with minimal input.
- **Key exports:** `default` (QuickCreateBar component)

#### `WeekListView.jsx`
- **Purpose:** Week list view. Events and tasks listed in chronological order.
- **Key exports:** `default` (WeekListView component)

### `taskHelpers.js`
- **Purpose:** Task-related helpers. Parse tasks, compute due dates, prioritize.
- **Key exports:** `isTaskOverdue()`, `getTaskPriority()`, `formatTaskDueDate()`, `groupTasksByDate()`
- **Line count:** ~150+

### `useAICuratedTasks.js`
- **Purpose:** Hook that fetches and AI-curates tasks for the current day. Smart task ranking.
- **Key exports:** `useAICuratedTasks()`
- **Dependencies:** api.js, runAgent, tools
- **Line count:** ~1,115

### `useDismissedTasks.js`
- **Purpose:** Hook for managing dismissed tasks. Tracks dismissed task IDs in localStorage.
- **Key exports:** `useDismissedTasks()`
- **Line count:** ~80

### `useInsight.js`
- **Purpose:** Hook for generating workspace insights. Summary stats, trends, recommendations.
- **Key exports:** `useInsight()`
- **Dependencies:** api.js
- **Line count:** ~150+

### `useTasksTable.js`
- **Purpose:** Hook to identify and configure tasks table. Auto-detection or manual selection.
- **Key exports:** `useTasksTable()`
- **Dependencies:** PagesContext, api.js
- **Line count:** ~100+

---

## `mcp-server/` - MCP Server (Claude Integration)

### `index.js`
- **Purpose:** Local MCP server for Claude Desktop (Cowork). Proxies requests to remote Wasabi Worker. Speaks MCP protocol over stdio.
- **Key exports:** None (server binary)
- **Tools exposed:** wasabi_health, wasabi_pages, wasabi_data, wasabi_analytics, wasabi_search, wasabi_automations, wasabi_functions, wasabi_flows, wasabi_kb, wasabi_neurons, wasabi_notifications, wasabi_users, wasabi_files, wasabi_dashboard, wasabi_sync, wasabi_export, wasabi_import, wasabi_bulk_update, wasabi_sql, wasabi_backup, wasabi_agent_query, wasabi_google, wasabi_trigger, wasabi_schedule
- **Dependencies:** MCP SDK, zod, Node.js fs/path
- **Line count:** 1000+ (not fully read)
- **Key pattern:** Each tool group follows a similar pattern: fetch from Worker, parse JSON, return MCP-formatted response

### `config.json`
- **Purpose:** MCP server config. Worker URL and API key.
- **Example structure:**
  ```json
  {
    "workerUrl": "https://wasabi.example.workers.dev",
    "apiKey": "your-wasabi-key"
  }
  ```

### `config.example.json`
- **Purpose:** Template for config.json. Shows required fields.

### `package.json`
- **Purpose:** npm manifest for MCP server. Dependencies: @modelcontextprotocol/sdk, zod

---

## `docs/` - Documentation Files

### `01-ui-ux.md`
- **Topic:** UI/UX design, user flows, interaction patterns, accessibility

### `02-features-functions.md`
- **Topic:** Feature list, function descriptions, use cases

### `03-integrations.md`
- **Topic:** Integration guides (Notion, Google, Monday.com, Gmail, Calendar), setup instructions

### `04-ai-chat.md`
- **Topic:** AI agent system, tools, prompts, model routing

### `05-d1-r2.md`
- **Topic:** D1 database schema, R2 file storage, migrations

### `06-deployment.md`
- **Topic:** Deployment guide, environment setup, production checklist

### `07-architecture-routing.md`
- **Topic:** Application architecture, request routing, data flow

### `08-state-data-flow.md`
- **Topic:** State management, context providers, data synchronization

### `09-config-data-models.md`
- **Topic:** Data models, configuration schemas, validation

### `10-concepts-ideas-uses.md`
- **Topic:** Product concepts, feature ideas, use cases

### `11-phase7-plan.md`
- **Topic:** Phase 7 roadmap, planned features, technical debt

### `12-mcp-server.md`
- **Topic:** MCP server setup, tool documentation, Claude integration

### `13-realtime-collaboration.md`
- **Topic:** Real-time collaboration architecture, WebSocket setup, conflict resolution

### `14-d1-notion-sync-architecture.md`
- **Topic:** Notion sync architecture, bidirectional sync logic, data mapping

### `cleanup-review.md`
- **Topic:** Code cleanup review findings, refactoring notes

### `code-review.md`
- **Topic:** Code review feedback, architecture decisions, known issues

### `design-review.md`
- **Topic:** Design system review, component audit, visual consistency

### `wasabi-comprehensive-review.md`
- **Topic:** Comprehensive codebase review, architecture overview, critical paths

### `PHASE6_PLAN.md`
- **Topic:** Phase 6 completion notes and architecture decisions

---

## File Statistics

- **Total source files:** 190+
- **Total lines of code:** 71,280
- **Largest files:** Table.jsx (3,107 lines), SystemManager.jsx (2,281 lines), toolExecutor.js (2,153 lines), DocumentEditor.jsx (1,787 lines)
- **Largest directories:** src/views, src/core, src/agent
- **Main tech stack:** React 18, Vite, Cloudflare Workers (D1 + R2), Notion API, Google APIs

---

## Key Architecture Patterns

### 1. **Context-Based State Management**
- React Context for auth, pages, navigation, themes, collaboration
- No Redux; hooks-based for simplicity
- Cross-context actions wired in PlatformContext

### 2. **API Abstraction Layer**
- All backend calls through `api.js`
- Single point for auth, error handling, connection state
- Unified endpoint routing through Worker

### 3. **View Type Dispatch**
- PageShell routes to correct view based on page config
- ViewRenderer handles all view type rendering
- Supports Table, Sheet, Calendar, Gantt, Form, Chart, etc.

### 4. **Lazy Loading with Retry**
- App.jsx defines `lazyWithRetry()` for stale chunk recovery
- ChatPanel, TasksView, NotesView, etc. lazily loaded
- Auto-reload on final retry failure

### 5. **AI Integration**
- Multi-tier model routing (Haiku → Sonnet escalation)
- Tool-use pattern for Claude integration
- Parameterized agent loop in runAgent.js
- Role-based tool access (admin/editor/viewer)

### 6. **Real-Time Collaboration**
- WebSocket sockets for table and user presence
- Conflict detection and resolution
- Presence avatars and cursor tracking

### 7. **Knowledge Graph (Neurons)**
- Link records across databases via NeuronsContext
- O(1) badge lookups via graph indexing
- Visual overlay for neuron visualization

### 8. **Notion Sync**
- Bidirectional sync: D1 ↔ Notion
- Pull/push operations via sync endpoints
- Field mapping and schema validation

### 9. **Automation Engine**
- Browser-based polling (no server cron)
- Trigger evaluation (schedule, status_change, field_change, page_created)
- Tool execution via runAgent
- Node-based flows for complex workflows

### 10. **Design System**
- CSS-in-JS with rebuildable tokens on theme change
- Global animation library injection
- Dark-first color scheme with semantic colors
- Consistent spacing, typography, shadows

---

## Dependencies Between Key Modules

### `api.js` is a hub used by:
- All agent files (automations, runAgent, toolExecutor, tools)
- All context providers
- All views and components
- All integration clients (notion, sheets, monday, google)

### `design/tokens.js` is used by:
- `design/styles.js`
- All views and components
- ThemeContext for theme switching
- Chart and visualization components

### `PlatformContext` pulls from:
- AuthContext
- PagesContext
- NavigationContext
- Used by every major component

### `NeuronsContext` is used by:
- Table view (for badge rendering)
- Sheet view (for cell selection)
- Record detail (for linking)
- Neurons visualization components

---

## Critical Paths for Development

1. **Adding a new view type:** Create view in `src/views/`, add to ViewRenderer switch, define in page config templates
2. **Adding a new tool:** Define in `tools.js`, implement in `toolExecutor.js`, add to role-based tool sets
3. **Adding a new integration:** Create client in `src/[integration]/`, add to toolExecutor, expose via MCP server if needed
4. **Adding a new context:** Create in `src/context/`, export Provider and hook, add to PlatformProvider if global
5. **Modifying D1 schema:** Update schema in worker.js, create migration, test with both new and existing data

---

## Known Issues & Review Findings

- **Table.jsx is large (3,107 lines):** Consider splitting into smaller components (CellRenderer, HeaderRow, etc.)
- **toolExecutor.js is large (2,153 lines):** Could benefit from modular tool handlers
- **No formal testing framework:** Consider adding Jest + React Testing Library
- **Worker size limit approaching:** Monitor worker.js growth; may need to split endpoints into separate handlers
- **Real-time sync conflicts:** Basic resolution strategy; could be improved for concurrent edits
- **History trimming in runAgent:** May drop important context in long conversations; configurable maxPairs helps but needs monitoring

