# 09 — Configuration & Data Models

## Page Config (`src/config/pageConfig.js`)

Page configs are the core data model for user-created pages. Stored in D1.

### Page Config Shape

```js
{
  id: "uuid",
  name: "My Page",
  type: "page" | "folder" | "workspace" | "dashboard",
  pageType: "linked_notion" | "linked_sheets" | "manual" | "document",
  parentId: "parent-folder-id" | null,
  databaseIds: ["notion-db-id"],   // For linked_notion pages
  sheetUrl: "...",                  // For linked_sheets pages
  notionPageId: "...",              // For document pages
  views: [                          // Array of view configs
    {
      type: "table" | "kanban" | "calendar" | "gantt" | "cards" | "chart" | "form" | "summary" | "chat" | "activity" | "document",
      label: "Table View",
      config: {
        groupBy: "Status",
        sortBy: "Date",
        colorMapping: { "High": 9, "Low": 3 },
        hiddenColumns: ["internal_id"],
        // ... view-specific settings
      }
    }
  ],
  colorIndex: 5,                    // For folders
  icon: "chart",                    // Optional icon name
  createdAt: "ISO date",
  updatedAt: "ISO date",
}
```

### Factory Functions

```js
import { savePageConfig, archivePageConfig, createFolderConfig, createWorkspaceConfig, createDashboardConfig } from "./config/pageConfig.js";
```

---

## Task Object (Sashimi)

From `useZenTasks`:

```js
{
  id: "row-uuid",
  title: "Task title",
  done: false,
  due: "2026-03-14T14:00:00Z" | "2026-03-14" | null,
  priority: "high" | "medium" | "low" | null,
  notes: "Optional notes",
  source: "manual",                // or "notion" for AI tasks
  tableId: "d1-table-id",
}
```

AI-curated tasks may also include:
```js
{
  // ... same fields plus:
  database: "Notion DB Name",
  overdueDays: 5,                  // Days overdue
  aiReason: "High priority, due soon",
}
```

---

## Calendar Event Object

From Google Calendar API:

```js
{
  id: "google-event-id",
  calendarId: "calendar-id",
  calendarColor: "#4285F4",
  summary: "Meeting Title",
  description: "Event description",
  location: "Conference Room A",
  start: {
    dateTime: "2026-03-14T14:00:00-07:00",  // Timed event
    date: "2026-03-14",                       // All-day event
  },
  end: {
    dateTime: "2026-03-14T15:00:00-07:00",
    date: "2026-03-15",
  },
  attendees: [{ email: "..." }],
}
```

---

## Calendar Object

From `listCalendars()`:

```js
{
  id: "calendar-id",
  summary: "Work Calendar",
  backgroundColor: "#4285F4",
  primary: true,
  accessRole: "owner",
}
```

---

## Gmail Message Object

From `searchEmails()` / `getEmail()`:

```js
{
  id: "message-id",
  threadId: "thread-id",
  snippet: "Preview text...",
  from: "sender@example.com",
  to: "recipient@example.com",
  subject: "Email Subject",
  date: "2026-03-14T10:30:00Z",
  isUnread: true,
  labels: ["INBOX", "UNREAD"],
  body: "Full email body HTML/text",  // Only from getEmail()
}
```

---

## Neuron Object

```js
{
  id: "neuron-uuid",
  name: "Project Alpha Links",
  nodes: [
    {
      id: "node-uuid",
      type: "page" | "view" | "record" | "google-calendar" | "google-gmail",
      pageId: "page-config-id",
      viewIdx: 0,
      recordId: "record-id",
      label: "Display Label",
    }
  ],
  createdAt: "ISO date",
  updatedAt: "ISO date",
}
```

---

## Link Object (Cross-Page)

```js
{
  id: "link-uuid",
  sourcePageId: "page-id",
  sourceViewIdx: 0,
  targetPageId: "page-id",
  targetViewIdx: 1,
  fieldMapping: { "Status": "Status", "Priority": "Priority" },
  syncDirection: "source-to-target" | "bidirectional",
}
```

---

## Automation Rule

```js
{
  id: "rule-uuid",
  name: "Auto-assign on creation",
  enabled: true,
  trigger: {
    type: "record_created" | "record_updated" | "schedule",
    tableId: "table-id",
    conditions: { /* filter criteria */ },
  },
  actions: [
    {
      type: "update_record" | "create_record" | "send_notification" | "call_api",
      config: { /* action-specific config */ },
    }
  ],
}
```

---

## Flow Object (Visual Automation)

```js
{
  id: "flow-uuid",
  name: "Process New Orders",
  enabled: true,
  nodes: [
    {
      id: "node-id",
      type: "trigger" | "action" | "condition" | "transform" | "wasabi",
      position: { x: 100, y: 200 },
      config: { /* node-specific config */ },
    }
  ],
  connections: [
    { from: "node-id-1", to: "node-id-2", port: "yes" | "no" | "default" }
  ],
}
```

---

## Custom Function

```js
{
  id: "function-uuid",
  name: "Calculate Margin",
  description: "Calculates profit margin from cost and price",
  type: "transform" | "validation" | "enrichment",
  inputs: [{ name: "cost", type: "number" }, { name: "price", type: "number" }],
  outputs: [{ name: "margin", type: "number" }],
  code: "return { margin: ((price - cost) / price) * 100 };",
  status: "active" | "draft",
  meta: {},
}
```

---

## Setup / Connection Config

```js
// Stored in localStorage as "wasabi_connection"
{
  workerUrl: "https://wasabi-worker.username.workers.dev",
  secret: "user-secret-key"
}
```

## Templates (`src/config/templates.js`)

Pre-built page templates for quick start:
- Each template defines name, description, icon, page type, and default views
- Used by PageBuilder and Onboarding
