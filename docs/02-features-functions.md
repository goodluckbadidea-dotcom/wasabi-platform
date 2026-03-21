# 02 — Features & Capabilities

## App Modes

Wasabi has two distinct modes, toggled from the header. Persistent in localStorage key: `wasabi-app-mode`.

| Mode | Internal Key | Description | Views |
|------|-------------|-------------|-------|
| **Sashimi** | `zen` | Minimal, focused interface | Tasks, Calendar, Notes, Gmail, Dashboard, Workspace Browser |
| **Sushi Roll** | `samurai` | Full platform with page builder | Page Builder, Data Views, Automations, Flows, Node Editor |

---

## Sashimi Mode (Zen)

The lightweight daily productivity interface. All components live in `src/zen/`.

### Views Overview

**All Sashimi views are lazy-loaded via React.lazy():**
- TasksView (primary view: tasks + calendar)
- NotesView (markdown editor)
- GmailView (email interface)
- DashboardView (widget grid)
- WorkspaceBrowser (Notion/Google workspace explorer)
- KnowledgeHub (knowledge base browser — minimal UI)
- CalendarView (standalone calendar, used by TasksView)

### 1. Tasks & Calendar (TasksView.jsx / CalendarView.jsx)

**Layout:** Split view — 40% Tasks (left) + 60% Calendar (right)

**Components:**
- `TasksView` (12479 lines) — Orchestrates task list + calendar
- `TaskList` (13685 lines) — Task rows and quick-add input
- `CalendarView` (17203 lines) — Calendar view switcher
- Calendar sub-components (in `zen/calendar/` folder)

#### TaskList Features

- **Quick-add input** at top ("Add a task...")
- **Three sections:**
  1. "YOUR TASKS" — Manual D1 tasks (editable)
  2. "FROM YOUR DATABASES" — AI-curated Notion tasks (read-only)
  3. "COMPLETED" — Collapsed by default
- **Per-task:** checkbox, title, priority/overdue badges, delete button
- **Clicking a task** opens SashimiDrawer for editing
- **Data sources:**
  - Manual tasks: D1 table (useZenTasks hook)
  - AI-curated: Notion databases filtered by AI (useAICuratedTasks hook)

#### Calendar Views

**Three switchable views:**

1. **Day View** (DayColumn.jsx)
   - Single-day hour grid (7 AM–10 PM, 30-min blocks)
   - Shows Google Calendar events + tasks with due dates
   - Click event/task to open SashimiDrawer
   - Colored by event/task color

2. **Week View** (WeekListView.jsx)
   - 21-day scrollable list (7 past + today + 13 future)
   - Compact event/task rows with time labels
   - Today highlighted in accent color
   - Single-click to open SashimiDrawer

3. **Month View** (MonthGrid.jsx)
   - Traditional month grid (Sunday–Saturday)
   - Event "pills" (colored, truncated title)
   - Task dots (indicator only, no text)
   - Left sidebar: calendar list with toggle + color indicator
   - Click event/task or date to open SashimiDrawer

#### Calendar Features

- **Google Calendar integration** — Displays events from all connected calendars
- **Task integration** — Shows tasks with due dates in all three views
- **Calendar filter sidebar** — Toggle individual calendars on/off
- **Per-calendar color coding** — Each calendar has a distinct color
- **Quick event creation** — "+" button in day/week views
- **Timezone-aware** — Converts event times to user's local time
- **All-day events** — Displayed separately in grid/list

#### SashimiDrawer (zen/SashimiDrawer.jsx)

Slide-in editor panel opened by clicking a task or event. Context: `zen/SashimiDrawerContext.jsx`.

**Task editor:**
- Title (editable for manual/D1, read-only for Notion)
- Due date (date picker)
- Priority (select: "Low", "Medium", "High")
- Notes (rich text or plain text)
- Delete button
- Uses `updateRow`/`deleteRow` API calls

**Event editor:**
- Summary (text field)
- Start/end datetime (datetime pickers)
- Description (rich text)
- Location (text field)
- Calendar color (color picker)
- Delete button
- Uses `updateCalendarEvent`/`deleteCalendarEvent` API calls

**Context methods:**
- `openDrawer(type, data)` — Opens drawer with task/event data
- `closeDrawer()` — Closes drawer
- `updateDrawerItem()` — Updates in-place without closing

### 2. Notes (NotesView.jsx / zen/NotesView.jsx)

**Markdown scratchpad with live preview.**

- **Editor (left)** — Markdown input with syntax highlighting
- **Preview (right)** — Real-time rendered Markdown
- **Toolbar:** Bold, Italic, Heading, List, Code, Link buttons (insertions)
- **Auto-save** to localStorage key: `wasabi-zen-notes` (on 1-second debounce)
- **Markdown support:** Headers, bold/italic, lists, code blocks, links, blockquotes
- **No persistence to database** — Notes stay local only

### 3. Dashboard (DashboardView.jsx)

**Widget grid with drag-and-drop layout.**

- Uses `WidgetGrid` component from `src/components/WidgetGrid.jsx`
- **Available widgets:**
  - Upcoming calendar events
  - Unread email count
  - Task count/progress
  - Recent activity
  - Quick links
  - Custom notes
- **Layout:** User can drag widgets to reorder
- **Persistence:** Widget config saved to localStorage key: `wasabi-dashboard-widgets` (JSON)
- **Responsive:** Reflows on window resize

### 4. Gmail (GmailView.jsx / zen/GmailView.jsx)

**Simplified single-column email interface.**

**Inbox features:**
- **Gmail labels** (INBOX, SENT, DRAFT, SPAM, TRASH, STARRED)
- **Label buttons** to switch between labels
- **Email list** (infinite scroll, 50 emails per page)
- Per-email: sender, subject, preview, date, unread indicator
- **Unread badge** in sidebar nav

**Compose Modal:**
- To (email picker with auto-complete)
- Subject
- Body (rich text editor)
- Attachment support
- Send button

**Email Expansion:**
- Click email row to expand inline
- Shows full body + metadata (from, to, cc, date, labels)
- **Reply field** (pre-fills from/subject/threadId)
- Archive button
- Delete button
- Auto mark-read on expand

**Data source:**
- Google Calendar API for event list
- Gmail API for message CRUD
- Uses `getGmailSummary()` for unread count

### 5. Workspace Browser (zen/WorkspaceBrowser.jsx)

**Notion & Google workspace explorer.**

- **Notion section:**
  - Lists all connected Notion databases
  - Shows workspace name + database count
  - Click to add database as data source to Sushi Roll pages
- **Google section:**
  - Connected Google Drive (files, folders)
  - Shared drives list
- **Search** across both workspaces
- **Status indicators** — connection status, sync status

### 6. Knowledge Hub (zen/KnowledgeHub.jsx)

**Minimal knowledge base browser.**

- Lists pages from knowledge base tables (if configured)
- Search by title or content
- Click to open page details
- (Minimal UI, likely placeholder for future expansion)

---

## Sushi Roll Mode (Samurai)

The full platform for building custom data views and automations. Primary components in `src/core/`, `src/views/`.

### Page Builder (PageBuilder.jsx)

**Creates and configures custom pages.**

- **Page type selection:** Table, Sheet, Calendar, Kanban, Document, Gantt, Form, etc.
- **Data source linking:**
  - Notion database (linked read-only or sync)
  - Google Sheet (linked read-only)
  - D1 standalone table (full control)
  - Manual data entry
- **View configuration:**
  - Create multiple views of same data (Table + Kanban + Calendar)
  - Per-view filters, sorts, grouping
  - Custom column selection/ordering
- **Page properties:**
  - Title, icon, color
  - Parent folder
  - Share settings (read-only Notion: public/private)
- **Saves page config to D1 table:** `page_configs`

### Page Shell (PageShell.jsx)

**Runtime container for user-created pages.**

**Responsibilities:**
- Fetch page config from D1
- Resolve data source (Notion API, Google Sheets, D1 table)
- Fetch data with filters/sorts applied
- Manage data mutations (create, update, delete rows)
- Switch between views
- Handle refresh and sync
- Show loading/error states
- Manage access control (viewer/editor/admin roles)

**Key hooks:**
- `useColorMapping` — Maps record properties to colors
- `useViewPrefs` — Per-view user preferences (column widths, grouping, etc.)
- `CollaborationProvider` — Real-time sync via WebSocket (Durable Objects)

**Panels:**
- SubPageNav — Page header (title, refresh, view switcher, settings)
- ViewRenderer — Active view component
- ViewSettingsPanel — Configure current view (optional)
- SyncPanel — Notion sync status
- ConflictToast — Data conflict resolution
- PinLockOverlay — PIN protect sensitive data

### View Types (src/views/)

**Core data views:**

| View | File | Purpose |
|------|------|---------|
| **Table** | Table.jsx (3107 lines) | Spreadsheet-like grid with inline editing |
| **Sheet** | Sheet.jsx (1573 lines) | Full spreadsheet with formulas (Excel-like) |
| **Kanban** | Kanban.jsx (1640 lines) | Drag-and-drop kanban board (column = status/group) |
| **Calendar** | CalendarView.jsx (1227 lines) | Day/week/month calendar (Sushi Roll variant) |
| **Gantt** | Gantt.jsx (1640 lines) | Timeline/Gantt chart (row = record, bar = date range) |
| **Gallery** | CardGrid.jsx (11553 lines) | Card grid layout with image/title/description |
| **Form** | Form.jsx (12067 lines) | Single-record form (read-only or edit mode) |
| **Document** | DocumentEditor.jsx (1787 lines) | Rich document editor with blocks |
| **Chart** | Charts.jsx (13878 lines) | Data visualization (bar, line, pie, etc.) |
| **Network** | NetworkGraph.jsx (18056 lines) | Node/link graph visualization |
| **Custom** | CustomView.jsx (27806 lines) | User-defined SQL/function-based view |
| **Activity** | ActivityFeed.jsx (6734 lines) | Record activity/change log |

#### Table View Details

**Features:**
- Spreadsheet-like columns and rows
- Inline editing (click cell to edit)
- Column types: text, number, select, date, checkbox, relation, formula, rollup, etc.
- Column operations: sort, filter, hide, reorder, resize
- Row operations: edit, duplicate, delete, expand (detail drawer)
- Toolbar: add column, bulk operations, export, import
- Right-side detail drawer (open by clicking row or clicking "expand" icon)
- Search/filter UI
- Grouping by column (optional)
- Keyboard navigation (arrow keys, Enter to edit)

**Performance:**
- Virtual scrolling (only renders visible rows)
- 3100 lines of code — largest single component

#### Kanban View Details

**Features:**
- Columns represent groups (usually "Status" field)
- Cards represent records (one per row)
- Drag-and-drop card reordering (within/across columns)
- Card click opens detail drawer
- Toolbar: add column, filter, sort, group by alternate field
- Real-time sync of column membership via CollaborationProvider

#### Calendar View Details

**Features:**
- Three views: day, week (list), month (grid)
- Each event = one record with start/end date fields
- Color by: status, category, or user-selected color
- Drag event to reschedule (updates date field)
- Click event to open detail drawer
- Quick event creation via "+" button
- All-day events section
- Timezone display

#### Gantt View Details

**Features:**
- Rows = records
- Bar = date range (start date → end date fields)
- Color = status or custom coloring
- Drag bar left/right to adjust dates
- Toolbar: date range selector, zoom levels (day/week/month)
- Dependency lines (if relation field present)
- Progress indicator (if percent-complete field present)
- Click bar to open detail drawer

#### Form View Details

**Features:**
- Single-record layout (one row = one form)
- Field labels + inputs
- Field types: text, number, select, date, checkbox, relation, etc.
- Read-only mode (viewer) or edit mode (editor)
- Submit/Cancel buttons (edit mode)
- Previous/Next record navigation

#### Document Editor Details

**Features:**
- Block-based editor (similar to Notion)
- Block types: heading, paragraph, list, quote, code, image, table, embed
- Inline formatting: bold, italic, link, color
- Drag-and-drop block reordering
- Toolbar: insert block, format menu
- Saves to R2 (file storage)
- Version tracking

### Data Views (src/views/ vs src/zen/)

**Parallel structure exists for historical reasons:**

| Feature | src/views/ | src/zen/ | Notes |
|---------|-----------|---------|-------|
| CalendarView | Yes (1227 lines) | Yes (17203 lines) | Zen version is canonical (used by TasksView) |
| GmailView | Yes (841 lines) | Yes (37400 lines) | Zen version is canonical, more features |
| ChatPanel | Yes (455 lines) | Yes (476 lines) + ZenChatPanel | Zen version is canonical |

**Status:** Views version is mostly superseded by zen. Some dead code (CalendarView in views/) should be removed.

---

## Advanced Features

### 1. Neurons (Visual Knowledge Graph)

**Location:** `src/neurons/`

**Components:**
- `NeuronsContext.jsx` — Global neurons state
- `NeuronOverlay.jsx` — Visual overlay with nodes + connections
- `NeuronLines.jsx` — SVG lines connecting nodes

**What are neurons?**
Named relationship clusters linking:
- Pages
- Database views
- Records
- External data sources

**Visual representation:**
- Nodes (circles) = pages, records, data sources
- Lines = relationships
- Color = neuron color
- Hover to highlight connections
- Click node to navigate

**Use case:** Map how Notion databases, emails, calendar events, and tasks all relate to a project. Visual context at a glance.

### 2. Automations (Automation Rules)

**Location:** `src/agent/automations.js` + worker.js automation handlers

**Trigger types:**
- `schedule` — Run on cron expression (e.g., every day at 9 AM)
- `page_created` — Run when new record added
- `status_change` — Run when field changes to specific value
- `field_change` — Run when any field changes
- `manual` — Triggered by user click

**Action types:**
- `instruction` — Claude instruction (e.g., "summarize new records")
- `notification` — Post notification
- `send_email` — Send email via Gmail
- `create_record` — Create new record
- `update_records` — Bulk update records
- `call_api` — HTTP request

**Examples:**
- "When status → 'Done', notify team"
- "Daily at 9 AM, summarize new tasks"
- "When new record added, create Notion entry"
- "When priority → 'High', send alert"

**Storage:** D1 table `automation_rules` (name, trigger, action, enabled, scope)

**Execution:**
- Server-side: Cloudflare Worker checks triggers periodically
- Client-side: useEffect watches for page events and fires automations
- Model: Claude Haiku (cost-optimized)

### 3. Flows (Visual Workflow Builder)

**Location:** `src/agent/flowExecutor.js`, `src/core/NodeEditor.jsx`

**What are flows?**
Node-based DAGs (directed acyclic graphs) for multi-step workflows.

**Node types:**
- **Input** — Start with data/parameters
- **Condition** — Branch based on logic
- **Transform** — Process/filter data
- **Tool** — Call external tools (update database, send email, etc.)
- **Output** — Return result

**Features:**
- Drag-and-drop node canvas
- Connect nodes with edges
- Test flow with sample data
- Visual execution history (nodes highlight on completion)
- Retry logic for failed nodes

**Execution:**
- Triggered manually or via automation
- Sequential node execution with dependency graph
- Results passed between connected nodes
- Error handling and retries
- Executes on server (Cloudflare Worker)

### 4. Functions & Transforms

**Location:** `src/agent/toolExecutor.js`

**Types:**
- `transform` — Map/filter data (e.g., "multiply all numbers by 2")
- `aggregation` — Summarize data (e.g., "sum revenue by month")
- `formula` — Calculated field (e.g., "=A + B * 2")
- `forecast` — Predictive (e.g., "forecast revenue next quarter")

**Execution:**
- `new Function()` sandbox (limited security, see code review issues)
- Access to: datasets, helpers (sum, average, filter, etc.)
- Returns transformed data

**Storage:** D1 table `custom_functions` (name, type, code, inputs, outputs)

### 5. AI Integration (Wasabi Panel & Automation)

**Location:** `src/agent/` (runAgent.js, toolExecutor.js, tools.js, etc.)

**Two agent tiers:**
- **Claude Haiku** — Fast, cost-optimized for automations
- **Claude Sonnet** — Powerful, used for complex queries and multi-phase tasks

**Routing logic** (`aiRouter.js`):
- Classify query complexity (simple, moderate, complex)
- Route to Haiku or Sonnet based on complexity
- Multi-phase execution for complex tasks

**Tool system** (tools.js):
- Query database (D1, Notion, Google Sheets)
- Get/create/update page (records)
- Create/update automations and flows
- Post notifications
- Send emails
- Query calendars and email
- Custom SQL queries

**Prompt engineering** (wasabiPrompt.js):
- System prompt with platform context
- Includes: data schema, recent activity, user preferences
- Tone: helpful, concise, professional

**Token budget management** (dataSummary.js):
- Estimate token usage for context
- Truncate large datasets to fit budget
- Prioritize recent/relevant data

**Example query:** "Show me high-priority tasks due today and create a calendar block for each"
- Haiku routes to Sonnet (complex, multi-step)
- Sonnet: query tasks (filter: priority=High, due=today)
- Sonnet: loop through results, call create_calendar_event for each
- Post notification: "Created 3 calendar blocks"

---

## Data Sources & Connectivity

### 1. D1 (SQLite Databases)

**Storage:** Cloudflare D1 (serverless SQLite)

**Tables (managed by platform):**
- `page_configs` — User-created pages
- `table_schemas` — Column definitions
- `table_rows` — Data rows
- `sheet_data` — Spreadsheet data (sheet view)
- `documents` — Document metadata (bodies in R2)
- `automation_rules` — Automation definitions
- `automation_flows` — Flow node definitions
- `custom_functions` — User-defined functions
- `connections` — External service credentials (Google, Notion, Claude)
- `notifications` — Notification feed (user-stored)

**Access:** Via worker.js endpoints; frontend queries through `fetchDataSource()` API

### 2. Notion Integration

**Read sources:**
- Notion database as data source (linked, read-only or sync)
- Query via Notion API proxy through worker

**Write targets:**
- Sync D1 records back to Notion (two-way sync)
- Create/update Notion pages from automations

**Architecture:**
- Frontend → Worker (X-Wasabi-Key auth)
- Worker → Notion API (X-Notion-Version, Authorization header)
- Results cached in D1 table `table_rows`

### 3. Google Integration

**Gmail:**
- Query messages (list, search, get)
- Create draft, send, reply
- Archive/delete
- Modify labels

**Google Calendar:**
- List calendars
- List events (with pagination)
- Create/update/delete events
- Fetch availability (freebusy)

**Google Drive:**
- List files/folders
- Share settings
- Export formats (PDF, CSV)

**OAuth flow:**
- Frontend redirects to Google OAuth consent screen
- Worker receives auth code, exchanges for access token
- Stores refresh token in D1 `connections` table
- Auto-refreshes expired tokens

### 4. R2 (File Storage)

**Use cases:**
- Document bodies (DocumentEditor saves to R2)
- File attachments (email attachments, uploads)
- Export files (PDF, CSV exports)

**Path structure:** `/workspaces/{workspace-id}/documents/{doc-id}` or similar

**Access:** Worker serves presigned URLs to frontend

---

## Real-Time Collaboration

**Status:** Implemented (Phases 1-3 complete)

**Mechanism:** WebSocket via Cloudflare Durable Objects

**User sync rooms:**
- One room per workspace
- Tracks connected users
- Broadcasts typing indicators, presence

**Data sync rooms:**
- One room per D1 table
- Broadcasts row changes (create, update, delete)
- Handles conflict resolution (last-write-wins)

**Frontend:** `src/context/CollaborationContext.jsx` + `src/context/UserSyncContext.jsx`

**Example:** User A edits a record in Table X → Broadcasts to all other users viewing Table X → They see update in real-time

---

## Known Gaps & Issues

### From Design Review

1. **Missing loading states** in Table, Kanban, and other views during data fetch
2. **Missing error states** in forms and data mutations (silent failures in some places)
3. **Missing empty state** messaging consistency across views
4. **Missing skeleton loaders** for data-loading views
5. **Inconsistent view naming:** Mix of `CalendarView.jsx` in views/ and zen/
6. **Duplicate GmailView implementations** (views vs zen) with subtle differences

### From Code Review

1. **XSS vulnerabilities** in PluginWidget.jsx and iframeHelpers.js (direct template interpolation)
2. **Race condition** in AuthContext bootstrap (multi-user state detection)
3. **Unencrypted JWT** in localStorage (should use httpOnly cookies)
4. **Missing input validation** in tool executor (new Function() sandbox is weak)
5. **Inconsistent error handling** across Notion client functions

### From Cleanup Review

1. **Dead code:** CalendarView.jsx in views/ (1227 lines, unused)
2. **Duplicate functions:** formatDate(), truncate() in GmailView files vs helpers
3. **Very large files needing refactoring:**
   - Table.jsx (3107 lines)
   - SystemManager.jsx (2281 lines)
   - toolExecutor.js (2153 lines)
   - DocumentEditor.jsx (1787 lines)
   - Sheet.jsx (1573 lines)
4. **Missing date constants centralization**
5. **Inconsistent style naming** (S vs styles vs ms)

---

## Summary

Wasabi offers two distinct experiences:
- **Sashimi (Zen Mode):** Lightweight, daily-use productivity tools (tasks, calendar, notes, email, dashboard)
- **Sushi Roll (Samurai Mode):** Full platform for data views, automations, flows, and custom workflows

Both modes are powered by:
- D1 (SQLite) as primary data store
- Notion, Google, and manual data sources as integration targets
- Claude AI for intelligent task curation, automation, and query answering
- Neurons for visual knowledge graphs
- Real-time collaboration via WebSockets (Durable Objects)
- Comprehensive tool system for AI agent interactions

**For developers:** Focus on one mode at a time. Zen components live in `src/zen/`, Sushi Roll views in `src/views/`. Test both integration paths: D1-native vs. Notion-linked data.
