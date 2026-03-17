# 07 — Architecture & Routing

## Component Hierarchy

```
App (src/App.jsx)
├── ThemeProvider
│   └── PlatformProvider
│       ├── AuthProvider
│       ├── PagesProvider
│       └── NavigationProvider
│           └── LinksProvider
│               └── NeuronsProvider
│                   └── SashimiDrawerProvider
│                       └── ErrorBoundary
│                           └── AppContent
│                               ├── CommandPalette (conditional)
│                               ├── TopHeader
│                               ├── NeuronOverlay
│                               ├── NeuronLines
│                               └── Main Row (flex)
│                                   ├── SashimiChatPanel (conditional)
│                                   ├── Gradient bridge line
│                                   ├── Navigation (sidebar)
│                                   └── Content Area
│                                       └── {renderContent()} — routed view
```

## Routing

**No react-router** — routing is state-based via `activePage` from `NavigationContext`.

### Routes

| activePage | Component | Description |
|------------|-----------|-------------|
| `"system"` | `SystemManager` | Settings |
| `"wasabi"` | `PageBuilder` | Page creation wizard |
| `"zen-notes"` | `ZenNotes` (lazy) | Notes scratchpad |
| `"zen-dashboard"` | `ZenDashboard` (lazy) | Widget dashboard |
| `"zen-gmail"` | `ZenGmail` (lazy) | Gmail inbox |
| `"zen-workspaces"` | `ZenWorkspaces` (lazy) | Workspaces browser |
| `"zen-knowledge"` | `ZenKnowledgeHub` (lazy) | KB, Automations, Functions, Build |
| `"zen-notifications"` | `NotificationFeed` | Notifications |
| workspace ID | `WorkspaceSettings` | Workspace config |
| folder ID | redirects to workspaces | Folders aren't pages |
| page config ID | `PageShell` | User page with views |
| `null` / default | `ZenTasksView` (lazy) | Default: To-Do + Calendar |

### Navigation Flow

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
