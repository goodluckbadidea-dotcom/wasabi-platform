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
 └── ViewportProvider
      └── ThemeProvider
           └── ToastProvider
                └── PlatformProvider
                │    └── AuthProvider
                │         └── AuthGate  ← renders LoginScreen when NOT authenticated
                │              └── PagesProvider      ← only mounts after auth
                │                   └── NavigationProvider  ← only mounts after auth
                │                        └── {children}
                └── UserSyncProvider
                     └── ColorMappingProvider
                          └── LinksProvider
                               └── NeuronsProvider
                                    └── RecordDrawerProvider
                                         └── ErrorBoundary
                                              └── AppContent
```

**Key architectural point:** The `AuthGate` component in PlatformContext ensures that `PagesProvider`, `NavigationProvider`, and all downstream providers (UserSyncProvider through AppContent) never mount until authentication is confirmed. This prevents pre-auth API calls and 401 storms.


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

| Order | Provider | Purpose | Available before auth? |
|-------|----------|---------|----------------------|
| 1 | ViewportProvider | isNarrow, isTablet, isTouch, viewport width | Yes |
| 2 | ThemeProvider | Design tokens (C, SHADOW), theme name, applyTheme() | Yes |
| 3 | ToastProvider | showToast(msg, type), globalToast() for non-component code | Yes |
| 4 | PlatformProvider | Composition layer containing AuthProvider → AuthGate → PagesProvider → NavigationProvider | Partially (AuthProvider yes, Pages/Nav no) |
| 5 | UserSyncProvider | Cross-device sync via UserRoom WebSocket | No (guards on identity) |
| 6 | ColorMappingProvider | Per-column color assignments for select/status fields | No (uses usePages) |
| 7 | LinksProvider | Cross-page record/field references | No (guards on isAuthenticated) |
| 8 | NeuronsProvider | Relationship clusters | No (guards on isAuthenticated) |
| 9 | RecordDrawerProvider | Drawer open/close state | No (pure state, no API calls) |

PlatformProvider is a composition layer that internally nests AuthProvider, **AuthGate**, PagesProvider, and NavigationProvider. The AuthGate component sits between AuthProvider and the data-fetching providers, ensuring nothing below mounts until authentication is confirmed.

`usePlatform()` merges all three sub-contexts (auth, pages, navigation) for backward compatibility. Components rendered by AuthGate (like LoginScreen) must use `useAuth()` directly — they cannot use `usePlatform()` because PagesProvider and NavigationProvider are not yet mounted.

**LoginScreen uses `useAuth()` (not `usePlatform()`).** This is required because LoginScreen renders inside AuthGate, above PagesProvider and NavigationProvider.

---

## Routing: State-Based, No React Router

Wasabi does not use react-router or any URL-based routing library. Navigation is controlled by the `activeRightPane` string stored in NavigationContext.

### Route Identifiers

The `activeRightPane` value is either a system string or a page UUID:

| activeRightPane value | Component | Description |
|-----------------|-----------|-------------|
| `"tasks"` or `null` | TasksView | Home: personal tasks + calendar |
| `"notes"` | NotesView | Notes scratchpad |
| `"dashboard"` | DashboardView | Customizable widget dashboard |
| `"inbox-unified"` | InboxView | Gmail inbox. Named `inbox-unified` historically (used to merge Gmail + Outlook); Outlook removed 2026-07-01. |
| `"figma"` | FigmaView | Figma project browser + import |
| `"workspaces"` | WorkspaceBrowser | Folder-based page navigation |
| `"notifications"` | NotificationFeed | Notification inbox |
| `"knowledge-base"` | KnowledgeHub | Knowledge base management |
| `"automations"` | KnowledgeHub (tab) | Automation rules |
| `"functions"` | KnowledgeHub (tab) | Custom functions |
| `"build"` | KnowledgeHub (tab) | Plugin builder |
| `"system"` | SystemManager | Admin settings panel |
| `{page UUID}` | PageShell | User-created page (renders active view) |

### renderContent() Switch

In `AppContent`, the `renderContent()` function matches `activeRightPane` against known string identifiers. If no string matches, it looks up the value as a page UUID in the `pages` array and renders `<PageShell>`. If nothing matches, it falls back to `<TasksView>`.

```javascript
const renderContent = () => {
  if (activeRightPane === "system") return <SystemManager />;
  if (activeRightPane === "dashboard") return <DashboardView />;
  if (activeRightPane === "inbox-unified") {
    return <InboxView />;
  }
  // ... other system routes ...

  const pageConfig = pages.find(p => p.id === activeRightPane);
  if (pageConfig) return <PageShell pageConfig={pageConfig} />;

  return <TasksView />;  // fallback
};
```

### Navigation Flow

```
User clicks sidebar item
  → setActiveRightPane(id) via NavigationContext
  → AppContent re-renders
  → renderContent() matches activeRightPane value
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
const FigmaView = lazyWithRetry(() => import("./features/FigmaView.jsx"));
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

The remaining horizontal space (flex: 1) renders the output of `renderContent()` — whichever component matches the current `activeRightPane`.

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

Authentication gating is handled by the `AuthGate` component inside PlatformContext (not in AppContent). AuthGate renders LoginScreen in three cases:

1. **No worker connection** (`!isSetup`) → render `<LoginScreen configError="..." />`
2. **Boot in progress** (`identityLoading`) → render `<LoginScreen loading />`
3. **Not authenticated** (`!isAuthenticated`) → render `<LoginScreen />` (shows login form)
4. **Authenticated** → render `{children}` (PagesProvider, NavigationProvider, and everything downstream)

AppContent only renders when the user is fully authenticated. It does not contain any auth gate logic — that responsibility was moved to PlatformContext.

### Bootstrap State Machine

The AuthContext bootstrap follows: `idle → booting → ready | error`.

During `booting`:
1. Calls `initDatabase()` — runs D1 schema creation/migration (10s timeout)
2. Detects multi-user mode and first-boot invite codes
3. If multi-user, calls `authMe()` — validates existing JWT (10s timeout)
4. Sets `identityLoading = false` when complete

The `/init` endpoint uses a **schema version fast path**: it checks a `schema_version` key in the `connections` table. If the version matches `CURRENT_SCHEMA_VERSION`, it skips all DDL and returns immediately (~2-3 queries). On first boot or after a version bump, it runs the full migration path with batched DDL statements (using `env.DB.batch()`) and writes the new version at the end.

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

Accessed via `activeRightPane === "system"`. Admin-only for most tabs.

---

## File Organization Reference

```
src/
├── App.jsx              → Root component, providers, routing, layout
├── main.jsx             → ReactDOM entry point
├── core/                → Shell: TopHeader, Navigation, PageShell, SystemManager/
├── views/               → Database view components (Table, Kanban, Gantt, etc.)
│   └── table/           → Table sub-modules: 16 files (styles, helpers, components, hooks)
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

- **`src/views/`** — Database-bound view components. Each renders a specific view type for a database page. Loaded by PageShell/ViewRenderer based on the active viewConfig type. Views receive `data`, `schema`, `onUpdate`, `onRefresh` props from PageShell. The Table view has been decomposed into `src/views/table/` (16 sub-module files) with `Table.jsx` serving as the orchestrator (~1,205 lines).

- **`src/features/`** — Standalone workspace panels and personal productivity views. These are top-level screens not tied to a specific database: TasksView, InboxView (Gmail), NotesView, DashboardView, KnowledgeHub, WorkspaceBrowser, ChatPanel, and the RecordDrawer system. Feature views manage their own data fetching.
