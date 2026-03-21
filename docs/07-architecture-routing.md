# Application Architecture & Routing

## Overview

Wasabi uses **state-based routing** (no react-router) with a layered provider composition pattern. The app is structured as:

```
main.jsx → App → [Providers] → AppContent → PageShell/Views
```

This document outlines the component hierarchy, provider nesting, routing system, and layout behavior.

---

## Component Hierarchy

### Entry Point: main.jsx

```javascript
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### Root Component: App.jsx

`App` is the root component that wraps everything in provider layers:

```
App
├── ThemeProvider
│   ├── PlatformProvider
│   │   ├── AuthProvider
│   │   ├── PagesProvider
│   │   └── NavigationProvider
│   ├── UserSyncProvider
│   ├── ColorMappingProvider
│   ├── LinksProvider
│   ├── NeuronsProvider
│   └── RecordDrawerProvider
│       └── ErrorBoundary
│           └── AppContent
```

### AppContent Component

`AppContent` is the main application layout. It renders:

1. **Command Palette** (conditional overlay)
2. **TopHeader** (fixed top bar with page controls)
3. **NeuronOverlay + NeuronLines** (selection mode UI)
4. **Main Row Layout:**
   - **Wasabi Panel** (optional left chat panel, 320px when open)
   - **Navigation** (left sidebar, 54px collapsed / 220px expanded)
   - **Content Area** (main view, flex: 1)

---

## Provider Composition & Order

Providers are applied in specific nesting order to ensure data availability:

### 1. ThemeProvider
**File:** `src/context/ThemeContext.jsx`

Manages theme state (light/dark) and CSS custom properties.

**State:**
- `theme` - current theme object
- `themeName` - "light" | "dark"
- `toggleTheme()` - switch theme

### 2. PlatformProvider (Composition Layer)
**File:** `src/context/PlatformContext.jsx`

Thin wrapper that composes three sub-providers for backward compatibility:

```javascript
export function PlatformProvider({ children }) {
  return (
    <AuthProvider>
      <PagesProvider>
        <NavigationProvider>
          {children}
        </NavigationProvider>
      </PagesProvider>
    </AuthProvider>
  );
}
```

Merges outputs into single `usePlatform()` hook.

### 3. AuthProvider
**File:** `src/context/AuthContext.jsx`

Authentication and worker connection state.

**State:**
- `user` - { workerUrl, notionKey, claudeKey, mondayKey, ... }
- `isAuthenticated` - boolean
- `isSetup` - boolean
- `workerConnection` - { workerUrl, secret }
- `identity` - { id, display_name, role } (multi-user mode)
- `multiUserEnabled` - boolean
- `platformIds` - { databaseId, tableId, ... }

**Functions:**
- `setUserKeys(keys)` - save user credentials
- `updateConnectionKey(key, value)` - update individual connection
- `completeSetup()` - finish initial setup
- `login(email, password)` - multi-user login
- `register(email, password, inviteCode)` - multi-user registration
- `logout()` - clear identity

### 4. PagesProvider
**File:** `src/context/PagesContext.jsx`

Page configuration and hierarchy management.

**State:**
- `pages` - array of page configs
- `pageTree` - nested hierarchy with folders/views
- `folders` - computed list of folder pages
- `globalDashboard` - auto-created global dashboard config
- `batchQueue` - operation log for undo/batch handling
- `saveStatus` - "idle" | "saving" | "saved" | "error"

**Functions:**
- `addPage(config)` - create new page
- `updatePageConfig(id, updates)` - modify page settings
- `removePage(id)` - delete page
- `getFolderPages(folderId)` - list pages in folder
- `addToQueue(op)`, `updateQueueItem(id, changes)`, etc. - batch operations

### 5. NavigationProvider
**File:** `src/context/NavigationContext.jsx`

Current page/folder selection state.

**State:**
- `activePage` - currently selected page ID (or system route like "system", "dashboard", etc.)
- `activeFolder` - currently selected folder ID
- `expandedNodes` - Set of node IDs expanded in sidebar tree

**Functions:**
- `setActivePage(id)` - navigate to page
- `setActiveFolder(id)` - navigate to folder
- `toggleExpand(nodeId)` - expand/collapse sidebar node

### 6. UserSyncProvider
**File:** `src/context/UserSyncContext.jsx`

Multi-device synchronization (WebSocket user room).

**Functions:**
- `onNavUpdate(callback)` - listen for navigation changes from other devices
- `sendNavUpdate(pageId, folderId)` - broadcast nav to other devices
- `onSessionRevoked(callback)` - listen for logout on another device

### 7. ColorMappingProvider
**File:** `src/context/ColorMappingContext.jsx`

Global color field mapping for table views.

**State:**
- `globalColorMapping` - { [fieldName]: colorValue }
- `globalColorField` - primary field used for colors

**Functions:**
- `setGlobalColorField(fieldName)` - set which field drives row colors
- `setGlobalColorMapping(mapping)` - update color values

### 8. LinksProvider
**File:** `src/context/LinksContext.jsx`

Manages neural relationships (Neurons) between records and pages.

**Functions:**
- Link/unlink records across tables
- Query relationship graph

### 9. NeuronsProvider
**File:** `src/neurons/NeuronsContext.jsx`

Manages Neuron overlay state and selection.

**Functions:**
- `toggleOverlay()` - show/hide Neuron selection mode

### 10. RecordDrawerProvider
**File:** `src/zen/RecordDrawerContext.jsx`

Opens drawer for detailed record editing.

**State:**
- `recordId` - currently open record
- `pageId` - page containing record

---

## Routing System (State-Based)

Wasabi does **not use react-router**. Routing is managed via `activePage` state in NavigationContext.

### Route Identifiers

Route identifier is stored in `activePage` (from `useNavigation()` or `usePlatform().activePage`):

| Route ID | Component | Description |
|----------|-----------|-------------|
| `null` | TasksView | Home: Tasks split view (To-Do + Calendar) |
| `"system"` | SystemManager | System settings & admin panel |
| `"wasabi"` | PageBuilder | Create new page (builder modal) |
| `"notes"` | NotesView | Notes scratchpad |
| `"dashboard"` | DashboardView | Dashboard with widgets |
| `"gmail"` | GmailView | Gmail integration view |
| `"workspaces"` | WorkspaceBrowser | Browse connected workspaces |
| `"knowledge"` | KnowledgeHub | Knowledge base, automations, functions, build |
| `"notifications"` | NotificationFeed | Notification list |
| `{page_id}` | PageShell | User-created page (renders selected view) |

### Navigation Flow

```javascript
// In AppContent, navigate via:
setActivePage("system")           // Go to system settings
setActivePage(pageId)             // Go to user page
setActivePage(null)               // Go to home (Tasks)

// Associated folder navigation:
setActiveFolder(folderId)         // Select folder context
```

### Rendering Logic (AppContent.renderContent)

```javascript
const renderContent = () => {
  if (activePage === "system") return <SystemManager />;
  if (activePage === "wasabi") return <PageBuilder />;
  if (activePage === "notes") return <NotesView />;
  if (activePage === "dashboard") return <DashboardView />;
  if (activePage === "gmail") return <GmailView />;
  if (activePage === "workspaces") return <WorkspaceBrowser />;
  if (activePage === "knowledge") return <KnowledgeHub />;
  if (activePage === "notifications") return <NotificationFeed />;

  // User page routing
  const activePageConfig = pages.find((p) => p.id === activePage);
  if (activePageConfig) {
    return <PageShell pageConfig={activePageConfig} ... />;
  }

  // Default fallback
  return <TasksView />;
};
```

---

## Layout Structure

### Top Layout: Responsive Row

```
┌─────────────────────────────────────────────────────┐
│                    TopHeader                        │
├─────────────────────────────────────────────────────┤
│  [WasabiPanel] [Sidebar] [    Main Content Area    ]│
│                                                      │
│  - WasabiPanel: 320px (optional, left)              │
│  - Sidebar: 54px (collapsed) or 220px (expanded)    │
│  - Content: flex: 1 (fills remaining)               │
└─────────────────────────────────────────────────────┘
```

### Sidebar (Navigation)
**File:** `src/core/Navigation.jsx`

- Left column: collapsible icon bar + expandable text menu
- Lists pages, folders, system routes
- Stores collapse state in localStorage: `wasabi_sidebar_collapsed`

### Wasabi Panel (Chat)
**File:** `src/zen/ChatPanel.jsx` (lazy-loaded)

- Left side overlay/inline panel for AI chat
- Width: 320px
- Can be hidden on narrow viewports (mobile)
- Stores open state in localStorage: `wasabi_panel_open`
- Toggle via Cmd+. keyboard shortcut

### Main Content Area

Renders current view (PageShell, Views, SystemManager, etc.) based on active route.

---

## Lazy Loading & Code Splitting

Components loaded with `lazyWithRetry()` to handle stale chunk errors after deploys:

```javascript
const ChatPanel = lazyWithRetry(() => import("./zen/ChatPanel.jsx"));
const TasksView = lazyWithRetry(() => import("./zen/TasksView.jsx"));
const NotesView = lazyWithRetry(() => import("./zen/NotesView.jsx"));
const DashboardView = lazyWithRetry(() => import("./zen/DashboardView.jsx"));
const GmailView = lazyWithRetry(() => import("./zen/GmailView.jsx"));
const WorkspaceBrowser = lazyWithRetry(() => import("./zen/WorkspaceBrowser.jsx"));
const KnowledgeHub = lazyWithRetry(() => import("./zen/KnowledgeHub.jsx"));
```

Each lazy view is wrapped in ErrorBoundary + Suspense:

```javascript
<ErrorBoundary fallbackLabel="Tasks">
  <React.Suspense fallback={<LoadingSpinner />}>
    <TasksView />
  </React.Suspense>
</ErrorBoundary>
```

---

## Auth Gates & Setup Flow

### Three-Tier Authentication

1. **Setup Wizard** - First boot, no worker URL configured
2. **Login Screen** - Multi-user enabled, user not logged in (JWT missing/invalid)
3. **App** - Authenticated user with credentials

```javascript
if (!isSetup) {
  return <SetupWizard />;
}
if (multiUserEnabled && !identity && !identityLoading) {
  return <LoginScreen />;
}
if (!isAuthenticated) {
  return <SetupWizard />;
}
// Render app...
```

### Setup Initialization

Auth bootstrap (AuthContext) runs:

1. Call `initDatabase()` to create D1 tables and detect multi-user mode
2. If JWT exists, call `authMe()` to validate and restore identity
3. Load connection keys (Notion, Claude, Monday) from D1

---

## Keyboard Shortcuts

Registered in AppContent via `useKeyboardShortcuts()`:

| Shortcut | Action |
|----------|--------|
| Cmd+K | Toggle command palette |
| Cmd+N | New page |
| Cmd+B | Toggle sidebar |
| Cmd+. | Toggle Wasabi panel |
| Cmd+I | Go to Inbox |
| Escape | Close Wasabi panel |
| Cmd+J | Toggle Neurons overlay |
| Cmd+H | Go to home |
| Cmd+↑ | Previous page |
| Cmd+↓ | Next page |

---

## View Rendering (PageShell)

User pages render through `PageShell` component:

**File:** `src/core/PageShell.jsx`

1. Determines page type (database, document, linked_sheet, etc.)
2. Fetches data from source (D1, Notion, Monday, linked sheets)
3. Renders **ViewRenderer** which picks appropriate view component based on active view type

**Page Types:**
- `database` / `standalone_table` - D1-backed table
- `linked_notion` - Notion database (data synced to D1)
- `linked_monday` - Monday.com board
- `document` - Rich text document editor
- `linked_sheet` - Google Sheets
- `worksheet` - Wasabi native sheet editor
- `dashboard` - Dashboard with widgets

---

## Known Issues & Gaps

### 1. Missing CollaborationContext Documentation
- CollaborationProvider exists but not fully documented in this architecture
- Used to wrap TableShell for real-time presence/conflicts
- Integration points with PageShell unclear in current implementation

### 2. Route Naming Inconsistencies
- System routes like "system", "wasabi", "gmail" lack formal route registry
- Page IDs are strings (UUIDs) but system routes use semantic names
- No single place defines all valid routes — scattered in renderContent()

### 3. No Explicit Route Guards
- Auth gates are checked at AppContent level but no formal route protection system
- Some system routes (e.g., "system") may be accessible without proper role/permissions

### 4. Sidebar State Not Synced Across Devices
- `setSidebarCollapsed()` only persists locally to localStorage
- Opening sidebar on device A doesn't sync to device B
- NavUpdate only syncs page/folder selection, not sidebar state

### 5. ErrorBoundary Granularity
- Each lazy view has ErrorBoundary but main content layout does not
- Layout errors (sidebar, header) are not caught
- Top-level ErrorBoundary might be too broad

### 6. Suspense Fallbacks Inconsistent
- Some views show "Loading..." text, others don't
- No unified loading state (spinner component) across async views

---

## Best Practices for Adding New Routes

1. Add route ID to Route Identifiers table above
2. Add case in `renderContent()` to handle the route
3. If rendering a lazy component, wrap in ErrorBoundary + Suspense
4. Document state dependencies (which contexts the route needs)
5. Add keyboard shortcut if user-facing (via useKeyboardShortcuts)

Example:

```javascript
// src/App.jsx
const MyView = lazyWithRetry(() => import("./views/MyView.jsx"));

// In renderContent():
if (activePage === "myview") {
  return (
    <ErrorBoundary fallbackLabel="My View">
      <React.Suspense fallback={<LoadingSpinner />}>
        <MyView />
      </React.Suspense>
    </ErrorBoundary>
  );
}
```

1. User clicks sidebar item → `setActivePage(id)` via `NavigationContext`
2. `AppContent` re-renders → `renderContent()` matches `activePage` value
3. Component renders with `contentSwap` animation

## Lazy Loading

Components loaded via `React.lazy()` in `src/App.jsx`:

```js
const ZenTasksView = React.lazy(() => import("./zen/ZenTasksView.jsx"));
const ZenNotes = React.lazy(() => import("./zen/ZenNotes.jsx"));
const ZenDashboard = React.lazy(() => import("./zen/ZenDashboard.jsx"));
const ZenGmail = React.lazy(() => import("./zen/ZenGmail.jsx"));
const ZenWorkspaces = React.lazy(() => import("./zen/ZenWorkspaces.jsx"));
const ZenKnowledgeHub = React.lazy(() => import("./zen/ZenKnowledgeHub.jsx"));
const SashimiChatPanel = React.lazy(() => import("./zen/SashimiChatPanel.jsx"));
```

All wrapped in `<React.Suspense>` with loading fallbacks.

## Layout Behavior

### Desktop (width > 1024px)
- Sidebar: inline, collapsible (54px ↔ 220px)
- SashimiChatPanel: inline left panel (~320px)
- Content: fills remaining space

### Tablet/Narrow (width ≤ 1024px)
- SashimiChatPanel: overlay with backdrop (fixed position, 85vw max)
- Sidebar: may auto-collapse
- Content: full width

### iPad Detection
```js
const isNarrow = window.innerWidth < 1024;
```
- Chat panel renders as overlay when `isNarrow`
- Sidebar collapsed by default

## File Structure

```
src/
├── App.jsx                 — Root component, routing, layout
├── main.jsx                — React DOM entry point
├── agent/                  — AI agent system
├── components/             — Shared UI components
├── config/                 — Configuration utilities
├── context/                — React contexts (auth, pages, nav)
├── core/                   — Core app components (shell, nav, panels)
├── design/                 — Design system (tokens, animations, icons)
├── google/                 — Google integration utilities
├── hooks/                  — Custom React hooks
├── lib/                    — API client
├── monday/                 — Monday.com integration (unused?)
├── neurons/                — Neuron linking system
├── notion/                 — Notion integration
├── sheets/                 — Google Sheets integration
├── utils/                  — General utilities
├── views/                  — View components (table, kanban, etc.)
└── zen/                    — Zen mode components
    └── calendar/           — Calendar sub-components
```

---

## views/ vs zen/ Pattern

- **`src/views/`** — Database-bound view components. Each renders a specific view type
  (Table, Calendar, Kanban, Gantt, CardGrid, Form, etc.) for a database page. These are
  loaded by `ViewRenderer.jsx` based on the page config's active view type. Views receive
  `data`, `schema`, `onUpdate`, `onRefresh` props from `PageShell.jsx`.

- **`src/zen/`** — Standalone workspace panels and personal productivity views.
  These are top-level screens not tied to a specific database: `TasksView` (unified
  to-do + calendar), `GmailView` (email client), `NotesView`, `DashboardView`,
  `KnowledgeHub`, `WorkspaceBrowser`, `ChatPanel`, and the `RecordDrawer` system.
  Zen views manage their own data fetching and state.

**Naming convention:** If a component renders database data through the view system,
it belongs in `views/`. If it is a standalone panel or personal workspace feature,
it belongs in `zen/`.

**Shared components:** Some components exist in both directories with different
implementations (e.g., `CalendarView`). The `zen/` version is the primary one used
by the app; `views/` versions may be legacy or database-specific variants.
