# 08 — State & Data Flow

## React Contexts

### PlatformContext (`src/context/PlatformContext.jsx`)
Composition layer over three sub-contexts:

```
PlatformProvider
├── AuthProvider (src/context/AuthContext.jsx)
├── PagesProvider (src/context/PagesContext.jsx)
└── NavigationProvider (src/context/NavigationContext.jsx)
```

`usePlatform()` merges all three for backward compatibility. Provides:

**From AuthContext:**
- `user` — user object (workerUrl, notionKey, etc.)
- `setUserKeys(keys)` — update user credentials
- `isAuthenticated` — boolean
- `workerConnection` — { workerUrl, secret }
- `completeSetup(url, secret)` — finalize setup
- `updateConnectionKey(key, value)` — update single key
- `platformIds` / `setPlatformIds` — saved platform identifiers

**From PagesContext:**
- `pages` — array of all page configs
- `addPage(config)` — add page + navigate
- `removePage(id)` — remove page + clear nav
- `updatePageConfig(id, updates)` — update page config

**From NavigationContext:**
- `activePage` / `setActivePage` — current page ID
- `activeFolder` / `setActiveFolder` — current folder ID

### ThemeContext (`src/context/ThemeContext.jsx`)

Provides:
- `themeName` — current theme ID (e.g., "obsidian")
- `themeMode` — "dark" or "light" (inherent to theme)
- `appMode` — always "zen"
- `setThemeName(name)` — switch theme
- `toggleMode()` — cycle to next theme

### SashimiDrawerContext (`src/zen/SashimiDrawerContext.jsx`)

Provides:
- `drawerOpen` — boolean
- `drawerType` — "task" | "event" | null
- `drawerData` — the task/event object
- `openDrawer(type, data)` — open drawer with item
- `closeDrawer()` — close drawer
- `updateDrawerItem(updates)` — update item in place

### NeuronsContext (`src/neurons/NeuronsContext.jsx`)

Provides:
- `overlayActive` — boolean (selection mode on/off)
- `toggleOverlay()` — toggle neuron selection mode
- `selection` — array of selected neuron nodes
- `addToSelection(node)` / `removeFromSelection(nodeId)`
- `clearSelection()`
- `neurons` — all neuron groups
- `refreshNeurons()` — reload from D1

### LinksContext (`src/context/LinksContext.jsx`)

Provides cross-page link management:
- `links` — array of links
- `addLink(link)` / `removeLink(id)` / `updateLink(id, updates)`
- `getLinksForPage(pageId)`

---

## Custom Hooks

### useZenTasks (`src/zen/useZenTasks.js`)

Manual task management for Sashimi mode (D1-backed):

```js
const {
  tasks,        // Array of task objects
  loading,      // Boolean
  tableId,      // D1 table ID for tasks
  addTask,      // (title) => void
  toggleTask,   // (taskId) => void
  deleteTask,   // (taskId) => void
  refresh,      // () => void
} = useZenTasks();
```

### useAICuratedTasks (`src/zen/useAICuratedTasks.js`)

AI-prioritized tasks from connected databases:

```js
const {
  aiTasks,      // Array of task objects
  loading,      // Boolean
  lastUpdated,  // Date
  refresh,      // () => void
  error,        // Error | null
} = useAICuratedTasks();
```

### useRecordDetail (`src/hooks/useRecordDetail.js`)

Record detail modal state management for table/kanban views.

### useKeyboardShortcuts (`src/utils/useKeyboardShortcuts.js`)

Global keyboard shortcut bindings (Cmd+K for command palette, etc.).

---

## Data Flow Patterns

### Theme Change
```
User clicks theme button
  → toggleMode() in ThemeContext
  → applyTheme(nextTheme) mutates C object in place
  → rebuildStyles() updates shared style objects
  → React state update triggers re-render
  → All components read updated C values
```

### Task Creation (Sashimi)
```
User types in "Add a task..." input
  → handleAddTask(title) in ZenTasksView
  → addTask(title) from useZenTasks
  → createRows(tableId, [{cells: {title, done: false}}]) API call
  → refresh() fetches updated task list
  → TaskList re-renders with new task
```

### Calendar Event Click → Drawer Edit → Save
```
User clicks event in ZenCalendar
  → handleEventClick(event) calls openDrawer("event", event)
  → SashimiDrawer opens with EventEditor
  → User edits fields → handleSave()
  → updateCalendarEvent(eventId, updates) API call
  → closeDrawer() + onEventUpdated callback
  → calendarRefreshRef.current() triggers ZenCalendar refetch
```

### Page Navigation
```
User clicks page in sidebar
  → navigateToPage(id) in Navigation
  → setActivePage(id) in NavigationContext
  → AppContent re-renders
  → renderContent() matches new activePage
  → New component renders with contentSwap animation
```

---

## localStorage Keys

| Key | Purpose | Used By |
|-----|---------|---------|
| `wasabi_connection` | Worker URL + secret | `src/lib/api.js` |
| `wasabi-theme-name` | Current theme ID | `src/design/tokens.js` |
| `wasabi-zen-notes` | Notes content | `src/zen/ZenNotes.jsx` |
| `wasabi-zen-dashboard-widgets` | Dashboard widget config | `src/zen/ZenDashboard.jsx` |
| `wasabi-zen-tasks-table` | D1 table ID for tasks | `src/zen/useZenTasks.js` |
| `wasabi-sidebar-collapsed` | Sidebar state | `src/App.jsx` |
| `wasabi-wasabi-panel-open` | Chat panel state | `src/App.jsx` |
| `wasabi-hidden-calendars` | Calendar filter state | `src/zen/ZenCalendar.jsx` |
| `wasabi-neurons-cache` | Cached neuron data | `src/neurons/neuronStorage.js` |
| `wasabi-links-*` | Link storage | `src/config/linkStorage.js` |
| `wasabi-flow-*` | Flow storage | `src/config/flowStorage.js` |

---

## Error Handling

### ErrorBoundary (`src/core/ErrorBoundary.jsx`)

React error boundary wrapping major sections:
- Root app level
- Each view/feature (TaskList, Calendar, etc.)
- Accepts `fallbackLabel` prop for contextual error messages
- Catches render errors and displays recovery UI
