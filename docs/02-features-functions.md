# 02 — Features & Functions

## App Modes

Wasabi has two modes, toggled via the header button:

| Mode | Internal Key | Description |
|------|-------------|-------------|
| **Sashimi** | `zen` | Minimal, focused — to-do list, calendar, notes, Gmail, dashboard |
| **Sushi Roll** | `samurai` | Full platform — page builder, data views, node editor, automations |

Mode persists in `localStorage` key: `wasabi-app-mode`.

---

## Sashimi Mode Features

All Sashimi components live in `src/zen/`:

### To-Do & Calendar (`src/zen/ZenTasksView.jsx`)
- Split view: **40% Tasks** (left) + **60% Calendar** (right)
- Orchestrates `TaskList`, `ZenCalendar`, and `SashimiDrawer`
- Tasks come from two sources: manual D1 tasks (`useZenTasks`) + AI-curated Notion tasks (`useAICuratedTasks`)

### Task List (`src/zen/TaskList.jsx`)
- Quick-add input at top
- Three sections: "YOUR TASKS" (manual), "FROM YOUR DATABASES" (AI-curated), completed
- Each task row: checkbox, title, priority/overdue badges, delete button
- `onTaskClick` opens the SashimiDrawer for editing

### Calendar (`src/zen/ZenCalendar.jsx`)
- Three views: **Day**, **Week** (list), **Month** (grid)
- Fetches Google Calendar events via `listCalendarEvents()`
- Shows both events and tasks with due dates
- Calendar filter sidebar (toggle individual calendars)
- Per-calendar color coding
- Quick event creation via "+" button

#### Calendar Sub-components (`src/zen/calendar/`)

| Component | File | Purpose |
|-----------|------|---------|
| DayColumn | `DayColumn.jsx` | Single-day hour grid (7 AM–10 PM), events + tasks |
| WeekListView | `WeekListView.jsx` | 21-day scrollable list (7 past + today + 13 future) |
| MonthGrid | `MonthGrid.jsx` | Traditional month grid with event pills + task dots |
| CalendarEventBlock | `CalendarEventBlock.jsx` | Positioned event block on hour grid |
| CalendarTaskBlock | `CalendarTaskBlock.jsx` | Positioned task block on hour grid |

### Sashimi Drawer (`src/zen/SashimiDrawer.jsx`)
- Slide-in editor panel for tasks and calendar events
- **Task editor**: title, due date, priority, notes (editable for manual/D1 tasks, read-only for Notion)
- **Event editor**: summary, start/end datetime, description, location, calendar color
- Uses `updateRow`/`deleteRow` for tasks, `updateCalendarEvent`/`deleteCalendarEvent` for events
- Context: `src/zen/SashimiDrawerContext.jsx` — provides `openDrawer(type, data)`, `closeDrawer()`, `updateDrawerItem()`

### Notes (`src/zen/ZenNotes.jsx`)
- Markdown scratchpad with live preview
- Auto-saves to localStorage key: `wasabi-zen-notes`
- Toolbar: bold, italic, heading, list, code, link
- Split view: editor left, preview right

### Dashboard (`src/zen/ZenDashboard.jsx`)
- Widget grid with drag-and-drop layout
- Uses `WidgetGrid` component from `src/components/WidgetGrid.jsx`
- Persists widget config to localStorage key: `wasabi-zen-dashboard-widgets`

### Gmail (`src/zen/ZenGmail.jsx`)
- Simplified single-column inbox
- Compose modal with To/Subject/Body fields
- Inline message expansion with full body + metadata
- Reply (pre-fills from/subject/threadId) + archive
- Auto mark-read on expand
- Unread badge in sidebar nav

### Chat Panel (`src/zen/ZenChatPanel.jsx`)
- Sashimi-specific AI chat (simplified vs full WasabiPanel)
- Lazy-loaded via `React.lazy()`

---

## Sushi Roll Mode Features

### Page Builder (`src/core/PageBuilder.jsx`)
- Full-featured page creation with data source linking
- Connects to Notion databases, Google Sheets, or manual D1 tables
- Configures views (table, kanban, calendar, etc.)

### Page Shell (`src/core/PageShell.jsx`)
- Runtime container for user-created pages
- Manages view switching, data fetching, and view toolbar

### View System (`src/views/`)

| View Type | File | Description |
|-----------|------|-------------|
| Table | `src/views/Table.jsx` | Spreadsheet-like data grid |
| Sheet | `src/views/Sheet.jsx` | Full spreadsheet with formulas |
| Kanban | `src/views/Kanban.jsx` | Drag-and-drop kanban board |
| Calendar | `src/views/CalendarView.jsx` | Day/week/month calendar (Sushi Roll) |
| Gantt/Timeline | `src/views/Gantt.jsx` | Timeline/Gantt chart view |
| Cards | `src/views/CardGrid.jsx` | Card grid layout |
| Form | `src/views/Form.jsx` | Data entry form |
| Document | `src/views/Document.jsx` | Block-based document editor |
| Chat | `src/views/ChatPanel.jsx` | AI chat view for pages |
| Summary | `src/views/SummaryTiles.jsx` | KPI summary tiles |
| Charts | `src/views/Charts.jsx` | Data visualizations |
| Activity | `src/views/ActivityFeed.jsx` | Activity/changelog feed |
| Gmail | `src/views/GmailView.jsx` | Full Gmail view (Sushi Roll) |

Supporting view files:
- `src/views/ViewRenderer.jsx` — routes view type to component
- `src/views/_viewHelpers.js` — shared view utilities
- `src/views/_CellComponents.jsx` — cell renderers for table/kanban
- `src/views/FilterChips.jsx` — filter UI components
- `src/views/RecordDetail.jsx` — record detail modal
- `src/views/NewRecordModal.jsx` — new record creation

### Node Editor (`src/core/NodeEditor.jsx`)
- Visual flow editor for automations
- Drag-and-drop node canvas with connections
- Node types: trigger, action, condition, transform, AI (Wasabi)

### Functions Panel (`src/core/FunctionsPanel.jsx`)
- Custom JavaScript function editor
- Create, test, and manage reusable functions
- Functions can be used in automations and flows

### Automations (`src/core/AutomationPage.jsx`)
- Rule-based automation management
- Trigger → Condition → Action chains
- Engine: `src/agent/automations.js`

### Neurons (Visual Linking System)

Files in `src/neurons/`:

| File | Purpose |
|------|---------|
| `NeuronsContext.jsx` | React context for neuron state (selection, overlay) |
| `NeuronOverlay.jsx` | Glass-pane overlay for neuron selection mode |
| `NeuronLines.jsx` | SVG connection lines between neuron nodes |
| `NeuronBadge.jsx` | Badge showing neuron connection count |
| `neuronStorage.js` | localStorage cache + D1 persistence for neurons |

Neurons connect pages, views, and records into a visual knowledge graph. Available in Sushi Roll mode only.

### Other Core Features

| Feature | File | Purpose |
|---------|------|---------|
| Command Palette | `src/core/CommandPalette.jsx` | Cmd+K quick navigation |
| Setup Wizard | `src/core/SetupWizard.jsx` | Initial worker connection setup |
| Onboarding | `src/core/Onboarding.jsx` | First-time user experience |
| Knowledge Base | `src/core/KnowledgeBase.jsx` | Stored knowledge entries |
| System Manager | `src/core/SystemManager.jsx` | Settings & configuration |
| Sidebar Tree | `src/core/SidebarTree.jsx` | Hierarchical page navigation |
| Link Picker | `src/core/LinkPicker.jsx` | Cross-page link creation |
| Keyboard Shortcuts | `src/utils/useKeyboardShortcuts.js` | Global keyboard bindings |
