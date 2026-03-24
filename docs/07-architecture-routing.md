# Application Architecture & Routing

## Product Context

Wasabi is an AI-native workspace where users build persistent semantic scaffolding — structured data, relationships, and domain knowledge — that makes AI interactions more accurate over time. The frontend is a React 18 SPA with no external routing library; navigation is driven entirely by state.

---

## Component Hierarchy

### Entry Point

```
main.jsx → ReactDOM.createRoot() → <React.StrictMode> → <App />
```

### App.jsx Structure

App.jsx is the root component. It wraps the entire application in a layered provider composition, then renders `AppContent` which contains the layout shell.

```
App
 └── ThemeProvider
      └── ViewportProvider
           └── PlatformProvider
                │   (internally wraps: AuthProvider → PagesProvider → NavigationProvider)
                └── ToastProvider
                     └── AuthProvider (re-export gate)
                          └── PagesProvider
                               └── NavigationProvider
                                    └── UserSyncProvider
                                         └── CollaborationProvider
                                              └── ColorMappingProvider
                                                   └── LinksProvider
                                                        └── NeuronsProvider
                                                             └── RecordDrawerProvider
                                                                  └── ErrorBoundary
                                                                       └── AppContent
```

### AppContent Renders

1. **CommandPalette** — Cmd+K overlay for searching pages, shortcuts, and actions
2. **TopHeader** — fixed 52px top bar with theme toggle, command palette trigger, user menu
3. **NeuronOverlay + NeuronLines** — conditional Neuron selection mode UI
4. **Main row layout:**
   - WasabiPanel (optional left chat panel)
   - Navigation (left sidebar)
   - Content area (flex: 1, renders active page/view)

---

## Provider Wrapping Order

Providers are nested in a specific order so that inner providers can consume outer ones. The actual wrapping order in App.jsx is:

| Order | Provider | Purpose |
|-------|----------|---------|
| 1 | ThemeProvider | Design tokens (C, SHADOW), theme name, applyTheme() |
| 2 | ViewportProvider | isNarrow, isTablet, isTouch, viewport width |
| 3 | PlatformProvider | Composes Auth + Pages + Navigation; exposes workerConnection, pages CRUD, feature flags |
| 4 | ToastProvider | showToast(msg, type), globalToast() for non-component code |
| 5 | AuthProvider | identity, login/register/logout, bootstrap state machine |
| 6 | PagesProvider | pages array, activePage, CRUD with toast feedback |
| 7 | NavigationProvider | sidebar state, search, folder navigation |

Additional providers nested after the core seven: UserSyncProvider, CollaborationProvider, ColorMappingProvider, LinksProvider, NeuronsProvider, RecordDrawerProvider.

PlatformProvider is a composition layer that internally nests AuthProvider, PagesProvider, and NavigationProvider, then merges their outputs into a single `usePlatform()` hook for backward compatibility.

---

## Routing: State-Based, No React Router

Wasabi does not use react-router or any URL-based routing library. Navigation is controlled by the `activePage` string stored in NavigationContext.

### Route Identifiers

The `activePage` value is either a system string or a page UUID:

| activePage value | Component | Description |
|-----------------|-----------|-------------|
| `"tasks"` or `null` | TasksView | Home: personal tasks + calendar |
| `"notes"` | NotesView | Notes scratchpad |
| `"dashboard"` | DashboardView | Customizable widget dashboard |
| `"gmail"` | GmailView | Gmail inbox/compose/reply |
| `"workspaces"` | WorkspaceBrowser | Folder-based page navigation |
| `"notifications"` | NotificationFeed | Notification inbox |
| `"knowledge-base"` | KnowledgeHub | Knowledge base management |
| `"automations"` | KnowledgeHub (tab) | Automation rules |
| `"functions"` | KnowledgeHub (tab) | Custom functions |
| `"build"` | KnowledgeHub (tab) | Plugin builder |
| `"system"` | SystemManager | Admin settings panel |
| `{page UUID}` | PageShell | User-created page (renders active view) |

### renderContent() Switch

In `AppContent`, the `renderContent()` function matches `activePage` against known string identifiers. If no string matches, it looks up the value as a page UUID in the `pages` array and renders `<PageShell>`. If nothing matches, it falls back to `<TasksView>`.

```javascript
const renderContent = () => {
  if (activePage === "system") return <SystemManager />;
  if (activePage === "dashboard") return <DashboardView />;
  if (activePage === "gmail") return <GmailView />;
  // ... other system routes ...

  const pageConfig = pages.find(p => p.id === activePage);
  if (pageConfig) return <PageShell pageConfig={pageConfig} />;

  return <TasksView />;  // fallback
};
```

### Navigation Flow

```
User clicks sidebar item
  → setActivePage(id) via NavigationContext
  → AppContent re-renders
  → renderContent() matches activePage value
  → Component renders with contentSwap animation
```

---

## Lazy Loading: lazyWithRetry()

All view components are loaded via `lazyWithRetry()`, a wrapper around `React.lazy()` that adds exponential backoff retry logic. This handles stale chunk errors that occur after deployments — when the browser has cached an old `index.html` that references chunk files that no longer exist on the server.

```javascript
const ChatPanel = lazyWithRetry(() => import("./features/ChatPanel.jsx"));
const TasksView = lazyWithRetry(() => import("./features/TasksView.jsx"));
const DashboardView = lazyWithRetry(() => import("./features/DashboardView.jsx"));
const GmailView = lazyWithRetry(() => import("./features/GmailView.jsx"));
const WorkspaceBrowser = lazyWithRetry(() => import("./features/WorkspaceBrowser.jsx"));
const KnowledgeHub = lazyWithRetry(() => import("./features/KnowledgeHub.jsx"));
// ... etc.
```

Each lazy view is wrapped in `ErrorBoundary` + `React.Suspense`:

```javascript
<ErrorBoundary fallbackLabel="Tasks">
  <React.Suspense fallback={<LoadingSpinner />}>
    <TasksView />
  </React.Suspense>
</ErrorBoundary>
```

---

## localStorage Migration System

App.jsx (lines ~77-99) contains a migration system that runs on mount. It renames legacy `zen_` prefixed localStorage keys to `wasabi_` prefixed keys. This is a one-time migration that fires on first load after the rename, ensuring users do not lose their saved preferences.

Migrated keys include sidebar state, panel open state, active page, and theme. After migration, the old `zen_` keys are removed from localStorage.

---

## Layout Structure

### Vertical Layout

```
┌──────────────────────────────────────────────┐
│              TopHeader (52px fixed)           │
├──────────────────────────────────────────────┤
│ [WasabiPanel] │ [Sidebar] │ [Content Area]   │
│   320px       │  56/220px │   flex: 1        │
│  (optional)   │           │                  │
└──────────────────────────────────────────────┘
```

### TopHeader

- Fixed height: 52px
- Contains: theme toggle, Cmd+K command palette trigger, user menu, page title breadcrumb
- Always visible, sits above the main row

### Sidebar (Navigation)

**File:** `src/core/Navigation.jsx`

Two states controlled by `wasabi_sidebar_collapsed` in localStorage:

| State | Width | Content |
|-------|-------|---------|
| Collapsed | 56px | Icon-only buttons for pages and system routes |
| Expanded | 220px | Full text labels, search field, folder tree |

Transition between states is animated. Toggle via Cmd+B keyboard shortcut.

The sidebar lists user pages, folders, and system navigation items (Tasks, Dashboard, Gmail, Knowledge Base, Notifications, System).

### WasabiPanel (Chat)

**File:** `src/features/ChatPanel.jsx` (lazy-loaded)

- Width: 320px
- **Desktop (wide viewports):** renders inline to the left of the sidebar, pushing content right
- **Narrow viewports (isNarrow from ViewportContext):** renders as an overlay with backdrop, fixed position, up to 85vw width
- Open state stored in localStorage: `wasabi_panel_open`
- Toggle via Cmd+. keyboard shortcut

### Content Area

The remaining horizontal space (flex: 1) renders the output of `renderContent()` — whichever component matches the current `activePage`.

---

## PageShell: View Orchestrator

**File:** `src/core/PageShell.jsx`

PageShell is the orchestrator for user-created pages. It receives a `pageConfig` and:

1. **Loads page configuration** — reads columns, view configs, and page type
2. **Fetches data** — queries D1 (or Notion/Monday for linked pages) via the worker API
3. **Determines active view** — reads the user's selected view from the page's viewConfigs
4. **Renders the active view** — switches on `viewType` to render the appropriate component

### View Type Switch

PageShell (or its internal ViewRenderer) selects a view component based on the active viewConfig's `type`:

| viewType | Component | Description |
|----------|-----------|-------------|
| `table` | Table | Spreadsheet-like grid |
| `kanban` | Kanban | Card board grouped by status/select |
| `gantt` | Gantt | Timeline bar chart |
| `calendar` | Calendar | Date-based calendar |
| `form` | Form | Data collection form |
| `sheet` | Sheet | Linked Google Sheets viewer |
| `document` | DocumentEditor | Rich text block editor |
| `custom` | CustomView | User-authored HTML/JS |
| `network` | NetworkGraph | Visual relationship graph |
| `activity` | ActivityFeed | Activity/audit log |
| `summary` | SummaryTiles | Aggregate metric tiles |
| `cardgrid` | CardGrid | Card grid layout |
| `charts` | Charts | Data visualization charts |

### ViewErrorBoundary

Each view rendered by PageShell is wrapped in a `ViewErrorBoundary`, a per-view error boundary that catches rendering errors and displays a fallback UI specific to that view. This prevents a single broken view from crashing the entire application.

---

## RecordDrawerContext

**File:** `src/features/RecordDrawerContext.jsx`

RecordDrawerContext provides `notifySaved` and `notifyDeleted` callback refs that enable the RecordDrawer (the slide-out record editor) to notify the parent view when a record has been saved or deleted.

This is consumed by PageShell, which registers callbacks so that when a user saves or deletes a record in the drawer, the underlying table/view data is refreshed without a full page reload. This is the primary mechanism for drawer-to-view data synchronization.

---

## Auth Gates & Setup Flow

AppContent checks authentication state before rendering the main layout:

1. **No worker connection** (`!isSetup`) → render `<SetupWizard />`
2. **Multi-user enabled, no identity** → render `<LoginScreen />`
3. **Authenticated** → render full app layout

The AuthContext bootstrap state machine follows: `idle → booting → ready`. During `booting`, it calls `initDatabase()` to create D1 tables (if needed) and detect multi-user mode, then validates any existing JWT via `authMe()`.

---

## Keyboard Shortcuts

Registered in AppContent via `useKeyboardShortcuts()`:

| Shortcut | Action |
|----------|--------|
| Cmd+K | Toggle command palette |
| Cmd+B | Toggle sidebar collapsed/expanded |
| Cmd+Shift+T | Cycle theme (Shoji → Obsidian → Hinoki → Kori → Sumi) |
| Cmd+. | Toggle WasabiPanel |
| Cmd+N | Create new page |
| Cmd+I | Go to Inbox/Notifications |
| Cmd+H | Go to Home (Tasks) |
| Cmd+J | Toggle Neurons overlay |
| Cmd+Up | Previous page |
| Cmd+Down | Next page |
| Escape | Close WasabiPanel |

---

## SystemManager

**Location:** `src/core/SystemManager/` (refactored into folder, 9 files)

| File | Purpose |
|------|---------|
| `index.js` | Re-exports |
| `SystemManager.jsx` | Tab container and routing |
| `OverviewTab.jsx` | System health, stats |
| `ConnectionsTab.jsx` | API key management (Notion, Claude, Google) |
| `SettingsTab.jsx` | Workspace settings |
| `UsersTab.jsx` | User management, invites, roles |
| `AuditLogTab.jsx` | Activity audit log |
| `components/` | Shared sub-components |

Accessed via `activePage === "system"`. Admin-only for most tabs.

---

## File Organization Reference

```
src/
├── App.jsx              → Root component, providers, routing, layout
├── main.jsx             → ReactDOM entry point
├── core/                → Shell: TopHeader, Navigation, PageShell, SystemManager/
├── views/               → Database view components (Table, Kanban, Gantt, etc.)
├── features/            → Personal productivity (Tasks, Gmail, Dashboard, RecordDrawer)
├── context/             → 11 React context providers
├── design/              → Design tokens (C, Z, FONT, RADIUS, SHADOW), animations, icons
├── agent/               → AI agent system (runAgent, toolExecutor, queryClassifier)
├── components/          → Shared UI (ColumnBuilder, MultiSelectPicker, StateIndicators)
├── neurons/             → Relationship mapping (NeuronsContext, NeuronLines, NeuronOverlay)
├── hooks/               → Custom hooks (useViewPrefs, useKeyboardShortcuts)
└── lib/                 → Utilities (api.js, iframeHelpers, tableSocket)
```

### views/ vs features/ Pattern

- **`src/views/`** — Database-bound view components. Each renders a specific view type for a database page. Loaded by PageShell/ViewRenderer based on the active viewConfig type. Views receive `data`, `schema`, `onUpdate`, `onRefresh` props from PageShell.

- **`src/features/`** — Standalone workspace panels and personal productivity views. These are top-level screens not tied to a specific database: TasksView, GmailView, NotesView, DashboardView, KnowledgeHub, WorkspaceBrowser, ChatPanel, and the RecordDrawer system. Feature views manage their own data fetching.
