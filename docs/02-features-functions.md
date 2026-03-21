# 02 — Features & Capabilities

## Product Context

Wasabi is an AI-native workspace where users build persistent semantic scaffolding -- through database views, knowledge bases, and relationship networks (Neurons) -- that makes AI interactions more accurate and contextual over time. It is not a Notion alternative; it is a platform for constructing the structured context that AI draws from. See `docs/00-wasabi-overview.md` for the full description.

---

## Two Interface Modes

Wasabi has two modes, toggled from the header. Persisted in `localStorage: wasabi-app-mode`.

| Mode | Internal Key | Source | Purpose |
|------|-------------|--------|---------|
| **Zen** | `zen` | `src/zen/` (19 files) | Personal productivity: tasks, calendar, email, notes, dashboard |
| **Workspace** | `samurai` | `src/views/` (28 files) + `src/core/` (37 files) | Shared data views, page builder, automations, flows |

---

## Zen Mode (`src/zen/`)

Personal productivity surface. User-scoped data. All components lazy-loaded.

### Views

| Component | File | Purpose |
|-----------|------|---------|
| TasksView | `src/zen/TasksView.jsx` | Personal task list + calendar integration |
| CalendarView | `src/zen/CalendarView.jsx` | Day/week/month calendar with Google Calendar sync |
| RecordDrawer | `src/zen/RecordDrawer.jsx` | Slide-out record editor (primary edit surface for all views) |
| ChatPanel | `src/zen/ChatPanel.jsx` | AI chat with context from current page/data |
| GmailView | `src/zen/GmailView.jsx` | Gmail inbox, read, compose, reply |
| DashboardView | `src/zen/DashboardView.jsx` | Customizable widget dashboard |
| WorkspaceBrowser | `src/zen/WorkspaceBrowser.jsx` | Folder-based page navigation |
| KnowledgeHub | `src/zen/KnowledgeHub.jsx` | Knowledge base browser |
| NotesView | `src/zen/NotesView.jsx` | Markdown scratchpad with live preview |
| ZenChatPanel | `src/zen/ZenChatPanel.jsx` | Extended AI chat for Zen mode |
| EmailThreadDrawer | `src/zen/EmailThreadDrawer.jsx` | Slide-out email thread viewer |

### Supporting Files

| File | Purpose |
|------|---------|
| `RecordDrawerContext.jsx` | Context provider for drawer open/close state |
| `TaskList.jsx` | Task rows, quick-add input, section grouping |
| `taskHelpers.js` | Task utility functions |
| `useTasksTable.js` | Hook for D1 task CRUD |
| `useAICuratedTasks.js` | Hook for AI-curated tasks from linked databases |
| `useDismissedTasks.js` | Hook for dismissed task tracking |
| `useInsight.js` | Hook for AI-generated insights |
| `calendar/` | Calendar sub-components (DayColumn, WeekListView, MonthGrid) |

### Record Editing

**All record editing happens through RecordDrawer.** Inline table editing is disabled. Clicking a row, card, event, or task opens the RecordDrawer slide-out panel for editing. This is the single edit surface for the entire application.

---

## Workspace Mode (`src/views/` + `src/core/`)

Shared database views. Workspace-scoped with per-page permissions.

### Data Views (`src/views/`)

| View | File | Purpose |
|------|------|---------|
| Table | `Table.jsx` | Spreadsheet-like grid with columns, filters, sorting. Cells are read-only; click opens RecordDrawer. |
| Kanban | `Kanban.jsx` | Card-based board grouped by status/select columns |
| Gantt | `Gantt.jsx` | Timeline bar chart for date-range records |
| Calendar | `Calendar.jsx` | Calendar view of date-based records |
| Form | `Form.jsx` | Public/private form for data collection |
| Sheet | `Sheet.jsx` | Linked Google Sheets viewer |
| LinkedSheet | `LinkedSheet.jsx` | Sheet with live Google Sheets connection |
| DocumentEditor | `DocumentEditor.jsx` | Rich text document with blocks |
| Document | `Document.jsx` | Document page container |
| CustomView | `CustomView.jsx` | User-authored HTML/JS views |
| NetworkGraph | `NetworkGraph.jsx` | Visual graph of record relationships |
| NotificationFeed | `NotificationFeed.jsx` | Notification inbox with filtering |
| ActivityFeed | `ActivityFeed.jsx` | Record activity/change log |
| CardGrid | `CardGrid.jsx` | Card grid layout with image/title/description |
| Charts | `Charts.jsx` | Data visualization (bar, line, pie, etc.) |
| SummaryTiles | `SummaryTiles.jsx` | Metric summary cards |
| ChatPanel | `ChatPanel.jsx` | Workspace-scoped AI chat |
| RecordDetail | `RecordDetail.jsx` | Full-page record detail view |

**Note:** `src/views/CalendarView.jsx` was deleted (dead code). The active calendar is `src/views/Calendar.jsx` for Workspace mode and `src/zen/CalendarView.jsx` for Zen mode.

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
| `toolExecutor.js` | 50+ tool implementations: CRUD pages/rows, email, calendar, automations |
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
2. **Neurons** (`neurons` + `neuron_nodes` D1 tables) — Named relationship clusters linking records, pages, and fields. AI queries these to understand connections.
3. **Page Structure** — Organization of pages, folders, and views tells the AI what matters
4. **Automation History** — Past execution logs provide operational patterns

---

## Neurons (`src/neurons/`)

Named relationship clusters that form the semantic scaffolding. 5 files:

| File | Purpose |
|------|---------|
| `NeuronsContext.jsx` | Global neurons state and CRUD |
| `NeuronOverlay.jsx` | Visual overlay rendering nodes + connections |
| `NeuronLines.jsx` | SVG lines connecting neuron nodes |
| `NeuronBadge.jsx` | Neuron indicator badge |
| `neuronStorage.js` | Persistence helpers |

### What Neurons Do

Neurons are named relationship clusters linking:
- Records across different tables
- Pages and views
- External data sources (calendars, emails)
- Arbitrary fields

Visual representation: nodes (circles) connected by lines, color-coded per neuron. Hover highlights connections; click navigates to the linked entity. The AI agent queries neurons to understand cross-table relationships and context.

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
| `PagesContext` | Page configs, CRUD, navigation state |
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
