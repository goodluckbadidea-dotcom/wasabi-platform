# Configuration & Data Models

## Product Context

Wasabi is an AI-native workspace with all primary data stored in D1 (Cloudflare's edge SQLite). This document defines the data models for all D1 tables and key configuration objects used throughout the platform.

---

## PageConfig

The core data model for user-created pages and folders. Stored in the `page_configs` D1 table.

```typescript
interface PageConfig {
  id: string;                      // UUID primary key
  name: string;                    // Display name
  type: string;                    // Page type: "database", "document", "folder", etc.
  icon: string;                    // Icon identifier from design system
  parentId: string | null;         // Parent folder ID (null for root-level pages)
  sortOrder: number;               // Display order within parent
  _systemInternal: boolean;        // If true, page is system-managed (not user-deletable)

  columns: ColumnDefinition[];     // Table schema (for database-type pages)
  sub_columns: ColumnDefinition[]; // Sub-item column schema (separate from parent columns, IDs prefixed subcol_*)
  viewConfigs: ViewConfig[];       // Array of view configurations

  pin_protected: boolean;          // Whether page requires PIN to access
  owner_user_id: string | null;    // User who owns this page (for per-user scoping)

  created_at: string;              // ISO 8601 timestamp
  updated_at: string;              // ISO 8601 timestamp
}
```

Pages with `_systemInternal: true` are created automatically (e.g., the personal tasks table) and cannot be deleted by the user.

---

## ViewConfig

Configuration for a single view within a page. A page can have multiple views (e.g., a table view and a kanban view of the same data).

```typescript
interface ViewConfig {
  type: ViewType;
  label: string;                   // Display name for the view tab
  config: {
    // Common
    filters?: FilterConfig[];      // Array of filter rules
    sorts?: SortConfig[];          // Array of sort rules
    groupBy?: string;              // Column name to group by
    hiddenColumns?: string[];      // Column names to hide

    // Kanban
    statusField?: string;          // Column used for kanban lanes

    // Calendar
    dateField?: string;            // Column used for calendar placement

    // Gantt
    startDateField?: string;
    endDateField?: string;

    // Charts
    chartType?: string;            // "bar", "line", "pie", "area", "donut"
    xAxis?: string;
    yAxis?: string;

    // Form
    submitLabel?: string;
    successMessage?: string;

    // ... other view-specific config
  };
}

type ViewType =
  | "table"
  | "kanban"
  | "gantt"
  | "calendar"
  | "form"
  | "document"
  | "custom"
  | "network"
  | "activity"
  | "summary"
  | "cardgrid"
  | "charts";
```

---

## ColumnDefinition

Schema definition for a table column. Stored as part of the PageConfig's `columns` array.

```typescript
interface ColumnDefinition {
  id: string;                      // Unique column identifier
  name: string;                    // Display name
  type: ColumnType;
  options?: SelectOption[];        // For select, multi_select, status types

  // Display
  hidden?: boolean;
  width?: number;                  // Column width in pixels

  // Formula
  formula?: string;                // Formula expression

  // Rollup
  rollup_field?: string;
  rollup_function?: "count" | "sum" | "average" | "max" | "min";

  // Relation
  relation_target_db?: string;     // Target page config ID
  relation_single_record?: boolean;
}

type ColumnType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "date"
  | "checkbox"
  | "url"
  | "email"
  | "phone"
  | "people"
  | "files"
  | "formula"
  | "relation"
  | "rollup"
  | "status"
  | "created_time"
  | "last_edited_time";

interface SelectOption {
  name: string;
  color?: string | number;        // Color hex or color index
}
```

---

## TableRow

A data row in a D1 table. Stored in the `table_rows` table.

```typescript
interface TableRow {
  id: string;                      // UUID primary key
  table_id: string;                // Foreign key to page_configs.id
  cells: Record<string, any>;      // JSON: column ID → cell value (includes both parent col IDs and subcol_* IDs)
                                     // Date values: string ("2026-04-01") for single dates,
                                     //   or { start: string, end: string } for date ranges
  sort_order: number;              // Display order within the table
  parent_row_id: string | null;    // If set, this row is a sub-item of the referenced parent row
  created_at: string;              // ISO 8601
  updated_at: string;              // ISO 8601
  updated_by: string | null;       // User ID of last editor

  cell_versions: Record<string, number>;
    // JSON: column name → version number
    // Used for field-level conflict detection during concurrent edits
    // Each save increments the version for changed fields
    // Client sends base_versions; server compares to detect conflicts

  sync_dirty: 0 | 1;              // Whether row needs sync to external source
  sync_retry_count: number;        // Number of failed sync attempts
}
```

The `cell_versions` field is central to conflict detection. When User A saves a field, the server checks whether User A's `base_version` for that field matches the current `cell_versions` value. If it does not, another user has edited the field since User A loaded it, and a conflict is raised.

---

## User

Multi-user account. Stored in the `users` D1 table.

```typescript
interface User {
  id: string;                      // UUID primary key
  display_name: string;            // User's display name
  role: "admin" | "editor" | "viewer";
  password_hash: string;           // PBKDF2 format: "salt:hash"
                                   //   salt = 16 random bytes (hex)
                                   //   hash = PBKDF2-SHA256, 100k iterations (hex)
  invite_code: string | null;      // UNIQUE invite code for registration
  invite_expires_at: string | null; // ISO 8601, 7-day TTL
  created_at: string;              // ISO 8601
  last_login_at: string | null;    // ISO 8601
  deactivated_at: string | null;   // ISO 8601, set when account is deactivated
}
```

Password hashing uses PBKDF2 with SHA-256 and 100,000 iterations. The salt and hash are stored together in a single string with colon separator.

---

## JWT Payload

The access token payload structure.

```typescript
interface JWTPayload {
  sub: string;                     // user.id
  role: "admin" | "editor" | "viewer";
  name: string;                    // user.display_name
  jti: string;                     // Session ID (maps to active_sessions.id)
  iat: number;                     // Issued-at (Unix timestamp)
  exp: number;                     // Expiry (Unix timestamp, 15 min from iat)
}
```

The `jti` claim links the token to an ActiveSession record, enabling session revocation. The `role` claim is used for initial checks but the worker also calls `getFreshRole()` to query the users table directly, preventing stale JWT role claims from granting unauthorized access.

---

## ActiveSession

Tracks active login sessions for multi-device management. Stored in the `active_sessions` D1 table.

```typescript
interface ActiveSession {
  id: string;                      // UUID, same as JWT jti claim
  user_id: string;                 // Foreign key to users.id
  device_info: string;             // User-Agent or device description
  ip_address: string;              // Client IP at login time
  created_at: string;              // ISO 8601
  last_seen_at: string;            // ISO 8601, updated on each authenticated request
  revoked_at: string | null;       // ISO 8601, set when session is revoked
}
```

When a session is revoked (either by admin action or logout), `revoked_at` is set and the UserRoom Durable Object broadcasts a `session_revoked` message to all connected WebSocket clients for that user.

---

## AutomationRule

Single-action automation rule. Stored in the `automation_rules` D1 table.

```typescript
interface AutomationRule {
  id: string;                      // UUID primary key
  name: string;
  description: string | null;
  trigger_type: "schedule" | "status_change" | "field_change" | "page_created" | "manual";
  trigger_config: {                // JSON, varies by trigger_type
    cron?: string;                 // For schedule triggers
    field?: string;                // For field_change/status_change
    from_value?: any;
    to_value?: any;
  };
  action_config: {                 // JSON
    instruction: string;           // AI prompt — supports {{field}} template variables
    type?: string;                 // "ai_action", "webhook", etc.
  };
  enabled: 0 | 1;
  fire_count: number;              // Total times this rule has executed
  last_fired_at: string | null;    // ISO 8601
  scope_table_id: string | null;   // Page config ID this rule applies to
  created_at: string;
  updated_at: string;
}
```

The `action_config.instruction` field is an AI prompt that the automation engine sends to Claude when the rule fires. It supports `{{field}}` template variables that are replaced with actual record values at execution time.

---

## Flow

Multi-step automation workflow with a directed graph of nodes and edges. Stored in the `automation_flows` D1 table.

```typescript
interface Flow {
  id: string;                      // UUID primary key
  name: string;
  description: string | null;
  data: {                          // JSON graph structure
    nodes: FlowNode[];
    edges: FlowEdge[];
  };
  enabled: 0 | 1;
  run_count: number;               // Total executions
  created_at: string;
  updated_at: string;
}

interface FlowNode {
  id: string;
  type: "trigger" | "action" | "condition" | "delay";
  config: {
    instruction?: string;          // AI prompt for action nodes
    // ... node-type-specific config
  };
  label?: string;
  position?: { x: number; y: number };
}

interface FlowEdge {
  source: string;                  // From node ID
  target: string;                  // To node ID
}
```

---

## Neuron

Named relationship cluster linking records, pages, and fields across the workspace. Stored across two D1 tables: `neurons` and `neuron_nodes`.

```typescript
interface Neuron {
  id: string;                      // UUID primary key
  name: string;                    // Display name for this relationship cluster
  created_at: string;
  updated_at: string;
}

interface NeuronNode {
  id: string;                      // UUID primary key
  neuron_id: string;               // Foreign key to neurons.id
  node_type: "record" | "page" | "field" | "table";
  node_id: string;                 // ID of the referenced entity
  node_label: string;              // Display label
  page_config_id: string | null;   // Page context for this node
  meta: Record<string, any>;       // JSON, additional metadata
  created_at: string;
}
```

Neurons are the core of Wasabi's semantic scaffolding. They capture relationships that the AI uses to understand connections between data across the workspace.

---

## KnowledgeBase

AI memory and domain knowledge entries. Stored in the `knowledge_base` D1 table.

```typescript
interface KnowledgeBase {
  id: string;                      // UUID primary key
  key: string;                     // Unique identifier/slug
  category: string;                // e.g., "business_context", "rules_and_policies", "agent_config"
  content: string;                 // Markdown or plain text
  source: string;                  // e.g., "user_input", "conversation", "import", "system"
  related_pages: string | null;    // JSON array of page config IDs
  created_at: string;
  updated_at: string;
}
```

Knowledge base entries are injected into every AI system prompt, giving Claude persistent domain context.

---

## Notification

User notification. Stored in the `notifications` D1 table.

```typescript
interface Notification {
  id: string;                      // UUID primary key
  message: string;                 // Notification text
  type: string;                    // "notification", "alert", "summary"
  status: string;                  // "unread", "read"
  source: string;                  // Event source (e.g., "row_updated", "automation")
  target_user_id: string | null;   // User this notification is for
  record_id: string | null;        // Related record ID
  record_name: string | null;      // Related record display name
  page_config_id: string | null;   // Related page ID
  page_name: string | null;        // Related page display name
  actor_name: string | null;       // User who triggered the notification
  created_at: string;              // ISO 8601
}
```

---

## RateLimit

Rate limiting state for auth endpoints. Stored in the `rate_limits` D1 table.

```typescript
interface RateLimit {
  key: string;                     // Rate limit key (e.g., IP address or "login:{ip}")
  attempts: number;                // INTEGER, number of attempts in window
  ts: number;                      // INTEGER, Unix timestamp of first attempt in window
}
```

Rate limiting is enforced on authentication endpoints: 5 failed attempts per 15-minute window. The `ts` field tracks when the window started; if the current time exceeds `ts + 900` (15 minutes), the counter resets.

---

## Connection

External service credentials and configuration. Stored in the `connections` D1 table (or `user_connections` for per-user keys).

```typescript
interface Connection {
  key: string;                     // Connection identifier: "notion", "claude", "google", etc.
  value: string;                   // API key, OAuth token, or configuration value
  label: string;                   // Display label
  user_id: string | null;          // Owner user ID (null for workspace-level connections)
}
```

---

## Supporting Models

### CellLink (Cross-Page References)

Stored in the `cell_links` D1 table. Managed by LinksContext.

```typescript
interface CellLink {
  id: string;
  source_page_id: string;
  source_ref: {
    record_id?: string;
    column_name?: string;
  };
  target_page_id: string;
  target_ref: {
    record_id?: string;
    column_name?: string;
  };
  direction: "one_way" | "bidirectional";
  active: 0 | 1;
  created_at: string;
}
```

### RecordComment

Stored in `record_comments` D1 table. (The `record_notes` table is vestigial — Notes feature removed 2026-03-31.)

```typescript
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

### SyncConfig (Notion Sync)

Stored in `sync_configs` D1 table.

```typescript
interface SyncConfig {
  id: string;
  table_id: string;               // Page config ID
  notion_db_id: string;           // External Notion database ID
  direction: "push" | "pull" | "bidirectional";
  field_mapping: Record<string, string>;  // { "wasabi_column": "notion_property" }
  last_synced_at: string | null;
  enabled: 0 | 1;
  created_at: string;
}
```

### TaskSnooze

Per-user task snooze state for the AI-curated task list. Stored in the `task_snoozes` D1 table. Cross-device — snoozed on one device, hidden on all.

```typescript
interface TaskSnooze {
  id: string;                      // Composite key: "{task_id}:{user_id}"
  task_id: string;                 // Task record ID
  source: string;                  // Task source (e.g., "d1:{tableId}")
  user_id: string;                 // User who snoozed
  snooze_until: string;            // ISO 8601 — task hidden until this time
  reason: string | null;           // Snooze preset label (e.g., "2 hours", "Tomorrow")
  created_at: string;              // ISO 8601
}
```

Active snoozes are filtered by `snooze_until > datetime('now')` — expired snoozes are automatically ignored.

---

## D1 Table Summary

| Table | Primary Key | Purpose |
|-------|-------------|---------|
| `page_configs` | id (UUID) | Page/folder configuration |
| `table_rows` | id (UUID) | Data rows for database pages |
| `users` | id (UUID) | User accounts |
| `active_sessions` | id (UUID = jti) | Login session tracking |
| `connections` | key | Workspace-level service credentials |
| `user_connections` | user_id + key | Per-user service credentials |
| `notifications` | id (UUID) | User notifications |
| `automation_rules` | id (UUID) | Single-action automations |
| `automation_flows` | id (UUID) | Multi-step workflow automations |
| `neurons` | id (UUID) | Relationship cluster definitions |
| `neuron_nodes` | id (UUID) | Individual nodes within neurons |
| `knowledge_base` | id (UUID) | AI domain knowledge entries |
| `cell_links` | id (UUID) | Cross-page record/field references |
| `record_notes` | id (UUID) | Per-record notes (markdown) |
| `record_comments` | id (UUID) | Per-record discussion comments |
| `rate_limits` | key | Auth rate limiting state |
| `sync_configs` | id (UUID) | Notion sync configuration |
| `custom_functions` | id (UUID) | User-defined functions and plugins |
| `task_snoozes` | id (task_id:user_id) | Per-user task snooze state (cross-device) |
