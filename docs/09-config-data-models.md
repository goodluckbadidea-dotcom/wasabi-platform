# 09 — Data Models & Configuration

## Overview

This document defines all data structures used throughout Wasabi, including TypeScript-style interfaces for each model. All primary data is stored in D1 (SQLite), with localStorage caching for instant UI loads.

---

## Page Config Object

The core data model for user-created pages and folders. Stored in D1 `page_configs` table.

```typescript
interface PageConfig {
  id: string;                          // UUID, primary key in D1
  parent_id: string | null;            // Parent folder ID
  title: string;                       // Display name
  icon: string;                        // Icon name (from design system)
  page_type: "workspace" | "folder" | "database" | "document" | "sheet" | "linked_notion" | "linked_monday";
  sort_order: number;                  // Display order within parent
  config: {
    // View definitions (type-specific)
    views?: Array<ViewConfig>;

    // Database/table schema
    columns?: Array<ColumnDefinition>;

    // Linked resource IDs
    databaseIds?: string[];            // Notion DB IDs (for linked_notion)
    notionPageId?: string;             // Notion page ID (for documents)

    // Workspace/folder settings
    settings?: {
      aiInstructions?: string;         // Custom AI prompt for this workspace
      defaultModel?: "auto" | "haiku" | "sonnet";
      autoSearchKb?: boolean;
      kbCategories?: string[];
      agentMode?: "auto" | "confirm" | "plan";
    };

    // Pin protection (admin can require PIN to access)
    pin_protected?: boolean;
    pin_hash?: string;                 // SHA-256 hash of PIN
  };
  created_at: string;                  // ISO date
  updated_at: string;                  // ISO date
}
```

**Factory Functions** (`src/config/pageConfig.js`):
```javascript
createWorkspaceConfig(name: string): PageConfig
createFolderConfig(name: string, icon?: string): PageConfig
createTableConfig(name: string, icon?: string, columns: ColumnDefinition[]): PageConfig
createLinkedNotionConfig(name: string, icon?: string, notionDbId: string): PageConfig
createLinkedMondayConfig(name: string, icon?: string, mondayBoardId: string): PageConfig
savePageConfig(pageConfig: PageConfig): Promise<string>      // Returns ID
archivePageConfig(pageConfigId: string): Promise<void>
```

---

## View Config Object

Configuration for a single view of a page (table, kanban, gantt, etc.).

```typescript
interface ViewConfig {
  type: "table" | "kanban" | "calendar" | "gantt" | "cardGrid" |
        "chart" | "form" | "summaryTiles" | "chat" | "activityFeed" | "document";
  label: string;                       // Display name
  position: "main" | "sidebar";        // UI placement
  config: {
    // Table view
    groupBy?: string;                  // Column name to group by
    sortBy?: string;                   // Column name to sort by
    filterBy?: Array<FilterConfig>;
    hiddenColumns?: string[];          // Hidden column names
    colorMapping?: Record<string, number>; // Option → color index

    // Kanban view
    statusField?: string;              // Status column name

    // Calendar view
    dateField?: string;                // Date column name

    // Gantt view
    startDateField?: string;
    endDateField?: string;

    // Chart view
    chartType?: "bar" | "line" | "pie" | "area";
    xAxis?: string;
    yAxis?: string;

    // Form view
    submitLabel?: string;
    successMessage?: string;
  };
}
```

---

## Table Row Object

Data row in a D1 table. Stored in `table_rows` table.

```typescript
interface TableRow {
  id: string;                          // UUID, primary key
  table_id: string;                    // Reference to page config
  cells: Record<string, any>;          // Column name → cell value
  cell_versions: {
    [columnName: string]: {
      version: number;                 // Edit version counter
      updated_at: string;
      updated_by?: string;             // User or device ID
      history?: Array<{
        version: number;
        value: any;
        updated_at: string;
        updated_by?: string;
      }>;
    };
  };
  sort_order: number;                  // Display order
  archived: 0 | 1;                     // Soft delete flag
  metadata: Record<string, any>;       // Extra fields
  sync_dirty: 0 | 1;                   // Needs Notion sync
  sync_retry_count: number;            // Failed sync attempts
  created_at: string;
  updated_at: string;
  updated_by: string | null;           // Last editor ID
}
```

**Key Features:**
- `cell_versions` tracks edit history per cell for conflict detection
- `updated_by` enables multi-user attribution
- `sync_dirty` flag for Notion sync queueing
- Soft delete via `archived` flag (not hard removed)

---

## Column Definition Object

Schema definition for a table column.

```typescript
interface ColumnDefinition {
  name: string;                        // Column identifier
  type: "title" | "rich_text" | "number" | "select" | "multi_select" |
        "date" | "checkbox" | "email" | "phone_number" | "url" |
        "formula" | "rollup" | "relation" | "people" | "files" |
        "created_time" | "last_edited_time" | "created_by" | "last_edited_by" | "unique_id" | "status";

  // Display properties
  hidden?: boolean;
  width?: number;                      // Column width in pixels

  // Options (for select/multi_select/status)
  options?: Array<{
    name: string;
    color?: string | number;           // Color index or hex
  }>;

  // Formula/rollup
  formula?: string;
  rollup_field?: string;
  rollup_function?: "count" | "sum" | "average" | "max" | "min" | "unique" | "or" | "and";

  // Relation
  relation_target_db?: string;
  relation_single_record?: boolean;
}
```

---

## Automation Rule Object

Single-action automation rule. Stored in `automation_rules` table.

```typescript
interface AutomationRule {
  id: string;
  name: string;
  description?: string;
  trigger_type: "schedule" | "status_change" | "field_change" | "page_created" | "manual";
  trigger_config: {
    // Schedule trigger
    cron?: string;                     // Cron expression

    // Status/field change trigger
    field?: string;                    // Column name
    from_value?: any;
    to_value?: any;
  };
  action_config: {
    instruction: string;               // Prompt for Claude AI
    type: "ai_action" | "webhook" | "update_record" | "create_record";
  };
  enabled: 0 | 1;
  scope_table_id?: string;             // Table this rule applies to
  fire_count: number;                  // Times rule has fired
  last_fired_at?: string;
  created_at: string;
  updated_at: string;
}
```

---

## Automation Flow Object

Multi-node workflow automation. Stored in `automation_flows` table.

```typescript
interface AutomationFlow {
  id: string;
  name: string;
  description?: string;
  flow_data: {
    nodes: Array<FlowNode>;
    connections: Array<FlowConnection>;
  };
  enabled: 0 | 1;
  run_count: number;
  last_run?: string;
  created_at: string;
  updated_at: string;
}

interface FlowNode {
  id: string;
  type: "trigger" | "action" | "condition" | "transform" | "wasabi_function";
  label: string;
  position?: { x: number; y: number };
  config: Record<string, any>;         // Node-specific config
}

interface FlowConnection {
  source: string;                      // From node ID
  target: string;                      // To node ID
  type: "success" | "error" | "default";
}
```

---

## Function Definition Object

Custom user-defined function. Stored in `custom_functions` table.

```typescript
interface FunctionDefinition {
  id: string;
  name: string;
  description?: string;
  type: "transform" | "aggregation" | "forecast" | "alert" | "pipeline" | "plugin";
  version: number;
  inputs: Record<string, {
    type: "string" | "number" | "array" | "object" | "date" | "boolean";
    required?: boolean;
  }>;
  outputs: Record<string, {
    type: "string" | "number" | "array" | "object" | "date" | "boolean";
  }>;
  code: string;                        // JavaScript function body
  status: "draft" | "active" | "disabled";
  created_by: string;
  last_run_at?: string;
  last_run_status?: "success" | "error";
  created_at: string;
  updated_at: string;
}
```

---

## Knowledge Base Entry Object

AI memory and business context. Stored in `knowledge_base` table.

```typescript
interface KnowledgeBaseEntry {
  id: string;
  key: string;                         // Unique identifier
  category: "business_context" | "user_preferences" | "data_schema" |
            "rules_and_policies" | "product_info" | "company_info";
  content: string;                     // Markdown or plain text
  source: "conversation" | "user_input" | "import" | "system";
  related_pages?: string[];            // Page IDs this entry relates to
  created_at: string;
  updated_at: string;
}
```

---

## Neuron Object

Named relationship cluster. Stored in `neurons` and `neuron_nodes` tables.

```typescript
interface Neuron {
  id: string;
  name: string;
  nodes: Array<NeuronNode>;
  created_at: string;
  updated_at: string;
}

interface NeuronNode {
  id: string;
  neuron_id: string;
  node_type: "page" | "record" | "field" | "value" | "integration";
  node_id: string;                     // ID of the node (page_id, record_id, etc.)
  node_label: string;                  // Display name
  page_config_id?: string;             // Page context
  meta: Record<string, any>;           // Extra data
  created_at: string;
}
```

---

## Link Object (Cross-Page References)

Cell link between pages/tables. Stored in `cell_links` table.

```typescript
interface CellLink {
  id: string;
  source_page_id: string;
  source_view_idx: number;
  source_ref: {
    record_id?: string;
    column_name?: string;              // For table cells
  };
  target_page_id: string;
  target_view_idx: number;
  target_ref: {
    record_id?: string;
    column_name?: string;
  };
  direction: "one_way" | "bidirectional";
  active: 0 | 1;
  source_field_type?: string;          // Column type for compatibility
  target_field_type?: string;
  created_at: string;
}
```

**Type Compatibility** (`src/config/linkTypeCompat.js`):
```typescript
TYPE_COMPAT_GROUPS = {
  text: ["title", "rich_text", "url", "email", "phone_number"],
  number: ["number"],
  select: ["select", "status"],
  multi_select: ["multi_select"],
  date: ["date"],
  checkbox: ["checkbox"],
  readonly: ["formula", "rollup", "relation", "people", "files", ...],
};

areTypesCompatible(sourceType: string, targetType: string): boolean
```

---

## Notification Object

User notification. Stored in `notifications` table.

```typescript
interface Notification {
  id: string;
  message: string;
  type: "notification" | "alert" | "summary";
  status: "unread" | "read" | "archived";
  source: string;                      // Event source (e.g., "row_updated")
  created_at: string;

  // MISSING: target_user_id (notifications are currently global)
  // See code review issue #3
}
```

**Issue:** Notifications lack `target_user_id`, so all users see all notifications (SECURITY).

---

## Record Note & Comment Objects

Stored in `record_notes` and `record_comments` tables.

```typescript
interface RecordNote {
  id: string;
  record_id: string;
  page_config_id: string;
  content: string;                     // Markdown
  created_at: string;
  updated_at: string;
}

interface RecordComment {
  id: string;
  record_id: string;
  page_config_id: string;
  user_id: string;
  user_name: string;
  content: string;
  created_at: string;
  updated_at: string;
}
```

---

## User & Authentication Objects

Multi-user workspace support. Stored in `users` and `user_connections` tables.

```typescript
interface User {
  id: string;
  display_name: string;
  role: "admin" | "editor" | "viewer";
  invite_code?: string;
  password_hash?: string;              // bcrypt or argon2 (not specified in code)
  created_at: string;
  last_login_at?: string;
}

interface JWT_Payload {
  sub: string;                         // User ID
  name: string;                        // display_name
  role: "admin" | "editor" | "viewer";
  iat: number;                         // Issue time (unix timestamp)
  exp: number;                         // Expiry time (unix timestamp)
  jti?: string;                        // Session ID (for revocation tracking)
}

interface UserConnection {
  user_id: string;
  key: string;                         // "notion", "claude", "google", etc.
  value: string;                       // API key or OAuth token
  metadata: Record<string, any>;
  updated_at: string;
}

interface UserState {
  user_id: string;
  last_page: string;                   // Last active page ID
  zen_tasks_table_id: string;          // Sashimi tasks table
  updated_at: string;
}

interface UserDashboard {
  user_id: string;
  widgets: Array<{
    id: string;
    type: "tasks" | "calendar" | "gmail" | "stats" | "chart";
    config: Record<string, any>;
  }>;
  updated_at: string;
}
```

---

## Calendar & Email Objects

Third-party integration data (not stored in D1, fetched from APIs).

```typescript
interface GoogleCalendar {
  id: string;
  summary: string;
  backgroundColor: string;             // Hex color
  primary: boolean;
  accessRole: "owner" | "reader" | "writer";
}

interface GoogleCalendarEvent {
  id: string;
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;                 // ISO date-time (timed event)
    date?: string;                     // ISO date (all-day)
  };
  end: {
    dateTime?: string;
    date?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: "accepted" | "declined" | "tentative" | "needsAction";
  }>;
  recurring?: boolean;
}

interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;                     // Preview text
  from: string;
  to?: string;
  subject: string;
  date: string;                        // ISO date-time
  isUnread: boolean;
  labels: string[];                    // ["INBOX", "UNREAD", etc.]
  body?: string;                       // Full HTML/text (only from getEmail)
}

interface GmailThread {
  id: string;
  messages: GmailMessage[];
  unreadCount: number;
}
```

---

## Task Object (Sashimi/Zen Tasks)

From `src/zen/taskHelpers.js` and `useZenTasks` hook.

```typescript
interface Task {
  // D1 table row
  id: string;
  table_id: string;
  cells: {
    // Sashimi task schema fields
    Task: string;                      // Task title
    Status?: string;                   // "To Do" | "In Progress" | "Done"
    Priority?: "High" | "Medium" | "Low";
    "Due Date"?: string;               // ISO date
    Notes?: string;
  };
  updated_at: string;

  // Computed properties
  done: boolean;                       // Status === "Done"
  due?: Date;                          // Parsed from "Due Date" cell
  overdue: boolean;                    // Due < today
  priority?: "high" | "medium" | "low";

  // AI-curated task additions
  source?: "manual" | "notion" | "gmail";
  database?: string;                   // Notion DB name
  overdueDays?: number;
  aiReason?: string;                   // Why Claude suggested this task
}
```

---

## Document & Sheet Objects

Stored in D1 `documents` and `sheet_data` tables.

```typescript
interface Document {
  id: string;
  r2_key: string;                      // R2 storage path
  version: number;
  word_count: number;
  content: Array<DocumentBlock>;       // Loaded from R2
  created_at: string;
  updated_at: string;
}

interface DocumentBlock {
  id: string;
  type: "heading" | "paragraph" | "list" | "code" | "image" | "table" | "quote" | "divider";
  content: string;                     // Markdown or HTML
  metadata?: Record<string, any>;
}

interface Spreadsheet {
  id: string;
  col_count: number;
  row_count: number;
  cells: Record<string, any>;          // Key: "A1", value: cell content
  col_widths: Record<string, number>;  // Column letter → width
  row_heights: Record<string, number>; // Row number → height
  frozen?: {
    rows?: number;
    columns?: number;
  };
  cell_styles: Record<string, {
    bold?: boolean;
    italic?: boolean;
    color?: string;
    background?: string;
    // ... more CSS properties
  }>;
  created_at: string;
  updated_at: string;
}
```

---

## Sync Configuration Object

Notion ↔ D1 sync settings. Stored in `sync_configs` table.

```typescript
interface SyncConfig {
  id: string;
  table_id: string;
  notion_db_id: string;
  direction: "app_to_notion" | "notion_to_app" | "bidirectional";
  field_mapping: Record<string, string>; // { "D1_column": "Notion_property" }
  last_synced_at?: string;
  enabled: 0 | 1;
  created_at: string;
}
```

---

## localStorage Keys & Purposes

The frontend caches frequently-used data in localStorage for offline support and instant loads:

| Key | Purpose | TTL |
|-----|---------|-----|
| `wasabi_jwt` | Auth token | Session (7 days) |
| `wasabi_page_configs` | Page hierarchy cache | Never (cleared on update) |
| `wasabi_flows` | Flow definitions | None (refreshed on load) |
| `wasabi_links` | Cell links | 5 minutes |
| `wasabi_neurons` | Neuron graph | None |
| `wasabi_kb` | Knowledge base entries | None |
| `wasabi_user_keys` | User's API keys (Notion, Claude, Google) | Never |
| `wasabi_connection` | Worker URL + secret | Never |
| `wasabi_setup_complete` | Setup wizard state | Never |

---

## Configuration Files

### `src/config/pageConfig.js`
Page config CRUD and factory functions.

### `src/config/setup.js`
First-time setup workflow. Creates Notion databases for platform infrastructure.

### `src/config/templates.js`
Pre-built page templates (Project Management, CRM, Inventory, Operations, Finances, To-Do).

### `src/config/flowStorage.js`
Flow persistence (D1 + localStorage).

### `src/config/linkStorage.js`
Link persistence (D1 + 5-min cache).

### `src/config/linkTypeCompat.js`
Field type compatibility rules for links.

---

## Context Provider Objects

React Context shapes used throughout the app.

```typescript
// From src/context/AuthContext.jsx
interface AuthContext {
  user: User | null;
  isAuthenticated: boolean;
  identity: { sub: string; name: string; role: string } | null;
  multiUserEnabled: boolean;
  identityLoading: boolean;

  workerConnection: { workerUrl: string; secret: string } | null;
  login(displayName: string, password: string): Promise<void>;
  register(displayName: string, password: string, inviteCode: string): Promise<void>;
  logout(): Promise<void>;
  hasRole(minRole: "admin" | "editor" | "viewer"): boolean;
}

// From src/context/PagesContext.jsx
interface PagesContext {
  pages: PageConfig[];
  pageTree: Record<string, PageConfig[]>;  // Parent ID → children
  folders: PageConfig[];
  activePage: string | null;
  addPage(config: PageConfig): void;
  updatePageConfig(id: string, updates: Partial<PageConfig>): void;
  removePage(id: string): void;
  getFolderPages(folderId: string): PageConfig[];
}

// From src/context/PlatformContext.jsx
interface PlatformContext extends AuthContext, PagesContext {
  // Combined for backward compatibility
  completeSetup(): Promise<void>;
  updateConnectionKey(key: string, value: string): Promise<void>;
}
```

---

## Known Issues & Gaps

See code review for details:

1. **Missing validation** — Data structures not validated on save (no JSON schema)
2. **Incomplete cell_versions** — History array not fully used for conflict resolution UI
3. **Type safety missing** — No TypeScript, so no compile-time type checking
4. **Weak password policy** — No minimum length on passwords
5. **Notification target_user_id missing** — All users see all notifications
6. **JWT stored in localStorage** — Vulnerable to XSS (should use httpOnly cookies)
