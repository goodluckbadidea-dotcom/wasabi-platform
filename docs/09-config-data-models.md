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
  | "last_edited_time"
  | "depends_on"     // view-of-edges (relationships table); cell stores nothing
  | "figma_files";   // array of { file_key, file_name, thumbnail_url }; Wasabi-native

interface SelectOption {
  name: string;
  color?: string;                 // Notion-style color name key: "red", "orange", "yellow",
                                  // "green", "blue", "purple", "pink", "brown", "gray".
                                  // Resolved through WASABI_COLORS → VIEW_PALETTE in design/tokens.js.
                                  // "default" or missing = backfilled by repairOptionColors()
                                  // on next fetchD1Table via assignOptionColor(idx) round-robin.
  category?: StatusCategory;      // (2026-04-15) Semantic category for status options only.
                                  // Enables progress roll-up. Stored in the options JSON blob.
                                  // Defaults to "not_started" when absent.
}

type StatusCategory =
  | "not_started"                 // Gray — default
  | "in_progress"                 // Blue
  | "complete"                    // Green
  | "on_hold"                     // Yellow
  | "cancelled";                  // Red
```

**Option color storage (2026-04-15):** Native D1 tables and linked-Notion tables share one color storage model — `col.options[i].color` on the schema itself. Every option-creation path in the frontend injects a color via `assignOptionColor(idx)` at add time, and `fetchD1Table` runs `repairOptionColors()` on load to backfill any option with missing or `"default"` color. User-picked colors (anything else) are preserved. The previous per-view `colorMapping` system is retained for Kanban/Gantt/CardGrid but the Table view reads color from schema options exclusively.

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

### Sub-Item Roll-Up (2026-04-15)

Parent page objects in the `data` array from `fetchD1Table` gain a `_rollup` property when they have sub-items:

```typescript
interface SubItemRollup {
  computedStart: Date | null;       // Earliest sub-item start date (across all date fields)
  computedEnd: Date | null;         // Latest sub-item end date
  progress: {
    total: number;                  // Total sub-items
    complete: number;               // Sub-items with status category "complete" or "cancelled"
    percent: number;                // Math.round(complete/total * 100)
  };
  hasConflict: boolean;             // Children's date range exceeds parent's manually-set range
  conflictDetails: {                // Only present when hasConflict is true
    parentStart: Date;
    parentEnd: Date;
    childrenStart: Date;
    childrenEnd: Date;
  } | null;
}
```

Computed by `computeSubItemRollup()` in `src/lib/subItemRollup.js`. Attached in `fetchD1Table` after page objects are built, before returning `{ data, schema }`. Only computed when `subSchema` exists (table has sub-columns). Available to all views — Table, Gantt, Kanban, Calendar, RecordDetail.

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

## Relationship (Phase 1, 2026-04-24)

Unified semantic edge between two workspace entities. Replaces the read surface
of six legacy systems (neurons, cell links, relation columns, parent/sub-item
hierarchy, mentions, plus the new native `depends_on`). Stored in the
`relationships` D1 table.

```typescript
interface Relationship {
  id: string;                       // UUID primary key
  type: string;                     // FK to relationship_types.type
  source_type: EntityType;
  source_id: string;
  source_page_id: string | null;    // Denormalized for permission filtering
  target_type: EntityType;
  target_id: string;
  target_page_id: string | null;
  directed: 0 | 1;                  // 0 = symmetric (endpoints interchangeable)
  origin: RelationshipOrigin;
  confidence: number | null;        // 0.0-1.0 for ai_inferred; NULL otherwise
  meta: Record<string, any> | null; // JSON; source-specific extras, evidence
  created_at: string;               // ISO 8601
  created_by: string | null;        // user_id for user_declared; 'system' for projected
  updated_at: string | null;
  deleted_at: string | null;        // Soft-delete; preserves audit history
}

type EntityType =
  | "record"        // table_rows row
  | "page"          // page_configs page
  | "field"         // specific column on a record
  | "user"          // workspace member
  | "neuron"        // neuron cluster
  | "comment";      // record comment

type RelationshipOrigin =
  | "user_declared"           // Native: user created via UI
  | "ai_inferred"              // Native: AI proposed (requires confidence < 1.0)
  | "projected_parent_row"     // Projected (Phase 2+): from table_rows.parent_row_id
  | "projected_cell_link"      // Projected: from cell_links
  | "projected_relation_col"   // Projected: from relation column array values
  | "projected_neuron_node"    // Projected: from neuron_nodes
  | "projected_mention";       // Projected: from notifications type='mention'
```

**Two invariants:**

1. **Relationships connect entities, not other relationships.** No edge-on-edge
   tags. The moment we allow "this relationship has a meta-relationship," the
   model collapses.
2. **Projections are idempotent and fully rebuildable from source.** At any
   time, `DELETE FROM relationships WHERE origin LIKE 'projected_%'` followed
   by `rebuildProjections(env)` must reproduce identical state. Enforced by a
   partial UNIQUE INDEX added in Phase 2a (schema version 6, 2026-04-24):
   `CREATE UNIQUE INDEX idx_rel_uniq_active ON relationships(source_type, source_id, target_type, target_id, type) WHERE deleted_at IS NULL`.
   This lets users delete-then-recreate the same edge (soft-deleted rows
   don't conflict) and makes `INSERT OR IGNORE` the correct dedupe primitive
   — projection writes silently skip duplicates and respect existing native
   edges with the same tuple ("user-declared always wins").

**Dedupe rule:** one active edge per `(source_type, source_id, target_type,
target_id, type)` tuple. POST `/relationships` returns 409 on duplicate.

**Phase 1 scope:** schema + endpoints only. No projections written yet (Phase
2). No UI consumers (Phase 3+). Native writes restricted to
`origin: 'user_declared' | 'ai_inferred'` — projection origins are written by
projection code, not the public POST endpoint.

---

## RelationshipType

Type registry for the relationships subsystem. Each registered type carries a
display label, an inverse label (for the target side of a directed edge),
directionality, and a cascade hint that drives delete-time UX. Stored in the
`relationship_types` D1 table; seeded with the day-one taxonomy on `/init`.

```typescript
interface RelationshipType {
  type: string;                     // PRIMARY KEY (e.g., "depends_on")
  label: string;                    // Display label ("depends on")
  inverse_label: string | null;     // Target-side label; NULL for symmetric types
  directed: 0 | 1;
  cascade_hint: CascadeHint;        // Delete-time behavior signal
  deprecated_at: string | null;     // ISO 8601; set when retired (POST blocks new edges of deprecated types)
  description: string | null;
}

type CascadeHint =
  | "nullify"   // Delete endpoint → soft-delete the edge silently
  | "cascade"   // Delete endpoint → soft-delete dependents
  | "prompt"    // Delete endpoint → ask user (e.g., "task B depends on this — unblock / delete / cancel?")
  | "ignore";   // Delete endpoint → leave dangling
```

**Day-one taxonomy** (seeded by `RELATIONSHIP_TYPE_SEEDS` in
`worker/schema.js`):

| Type | Directed | Cascade | Source of truth (Phase 2+) |
|------|----------|---------|----------------------------|
| `part_of` | yes | cascade | `projected_parent_row` |
| `references` | yes | nullify | `projected_cell_link` |
| `related_to` | yes | nullify | `projected_relation_col` |
| `member_of_neuron` | yes | nullify | `projected_neuron_node` |
| `mentioned_in` | yes | ignore | `projected_mention` |
| `depends_on` | yes | prompt | native (Phase 3 UI) |
| `blocks` | yes | prompt | native (inverse of `depends_on`) |
| `similar_to` | no | ignore | native (AI-inferred) |
| `conflicts_with` | no | prompt | native |

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
| `relationships` | id (UUID) | Unified relationship edges (Phase 1, 2026-04-24) |
| `relationship_types` | type (string) | Type registry for relationships subsystem |
| `figma_comment_links` | id (UUID) | Joins a Figma comment to a Wasabi record. Snapshot of message/author/created_at + record_name. Phase 3b, 2026-05-11. |
| `extensions` | id (e.g. `ext_…`) | Custom-coded report template definitions (HTML + DATA schema). In development, 2026-05-15. |
| `extension_snapshots` | id (UUID) | Concrete generated reports (DATA + R2 key + lifecycle). In development, 2026-05-15. |

---

## FigmaCommentLink (Phase 3b, 2026-05-11)

Joins a Figma comment (lives in Figma's API, not Wasabi) to a Wasabi
record. The snapshot fields let the linked record's drawer render
without round-tripping Figma on every open — the snapshot drifts from
Figma's source of truth, so users delete-and-re-link to refresh.

```typescript
interface FigmaCommentLink {
  id: string;                       // UUID primary key
  figma_file_key: string;           // Figma file the comment lives in
  figma_file_name: string;          // Denormalized for "From Figma" rendering
  figma_comment_id: string;         // Figma's comment id
  comment_message: string;          // Snapshot at link time
  comment_author: string;           // Figma user handle at link time
  comment_created_at: string;       // ISO 8601 from Figma
  record_id: string;                // Wasabi row id
  record_name: string;              // Wasabi row title at link time (snapshot)
  page_config_id: string;           // Wasabi page id (database the row lives in)
  linked_by: string | "";           // user.sub who created the link
  linked_at: string;                // ISO 8601, defaults to datetime('now')
}
```

**Uniqueness:** partial UNIQUE on `(figma_comment_id, record_id)` — the
same comment can't link to the same record twice. POST returns 409 on
duplicate.

**Schema versions:**
- **v7** (initial): table created with the columns above except `record_name`.
- **v8** (2026-05-11): idempotent `ALTER TABLE figma_comment_links ADD COLUMN record_name TEXT DEFAULT ''`. Links created on v7 keep an empty `record_name` and the source-side pill falls back to the literal word "record" until re-linked.

**Indexes:**
- `idx_fcl_unique` (UNIQUE) on `(figma_comment_id, record_id)`
- `idx_fcl_record` on `(record_id)` — drives the "From Figma" read for a record's Comments tab
- `idx_fcl_file` on `(figma_file_key)`

---

## figma_files cell type (Phase 3a, 2026-05-11)

New `figma_files` column type that lets a record reference one or more
Figma files. Cell stores a JSON array in the existing `cells` field on
`table_rows` — no DB migration. Wasabi-native (skipped from Notion sync,
no Notion equivalent).

```typescript
// Stored cell value (raw)
type FigmaFilesCell = Array<{
  file_key: string;        // Figma file key, source of truth
  file_name: string;       // Denormalized for instant render
  thumbnail_url: string;   // Denormalized; Figma's thumbnail URLs are signed/temporary
}>;
```

The Notion-shape wrap that `wrapAsNotionProp` / `buildProp` emit is
`{ type: "figma_files", figma_files: [...] }` — matches the convention
used by `multi_select` / `people`. `readProp` / `extractRawValue`
defensive-accept both shapes (raw array or wrapped) so older callers
don't break.

**Gating:** `COLUMN_TYPES` flags `figma_files` with `requiresFigma: true`. The Add Column dialog pings `/figma/status` once on mount (60 s cached) and filters the type out when no Figma connection is configured.

---

## Extension + ExtensionSnapshot  *(in development — 2026-05-15, schema v9–v11)*

> **Status: Under development.** The framework is wired end-to-end and
> deployed, but is being shaken out on a single live template. Schema
> and tool shapes may change before the feature is announced as stable.

Two new D1 tables added at schema version 9. See `docs/02-features-functions.md`
→ "Extensions" for the conceptual model and `docs/12-mcp-server.md` →
"Tools 30 & 31" for the MCP surface.

### Extension (template definition)

```typescript
interface Extension {
  id: string;                  // e.g. "ext_7d26b4549cbf"
  slug: string;                // URL-safe identifier, unique (e.g. "inventory-production")
  name: string;                // Display name (e.g. "Inventory & Production")
  icon: string;                // Icon id from the design system
  description: string;
  html: string;                // Full HTML template with a {{DATA}} placeholder
  data_schema: object;         // JSON Schema describing valid DATA shapes (stored as JSON text)
  sample_data: object;         // Canonical example DATA blob (stored as JSON text)
  theme_preference: 'inherit' | 'kori' | 'shoji' | 'hinoki' | 'sumi' | 'obsidian';
  version: number;             // Auto-incremented when html / data_schema / sample_data change
  status: 'active' | 'archived';
  created_by: string;          // User id
  created_at: string;
  updated_at: string;
}
```

### ExtensionSnapshot (generated report)

```typescript
interface ExtensionSnapshot {
  id: string;                  // UUID
  extension_id: string;        // FK → extensions.id
  slug: string;                // URL-safe, user-provided at generation time
                                 // (e.g. "q2-handoff", "05-15-2026"). Unique per extension.
  title: string;               // e.g. "Inventory & Production — 05.15.2026"
  data: object;                // The DATA blob that drove rendering (validated against extension.data_schema)
  html_key: string;            // R2 key: "extensions/{ext_slug}/{snap_slug}.html"
  template_version: number;    // Snapshot of extensions.version at generation time
  source_snapshot_id: string | null;   // If seeded from another snapshot (composition pattern)
  status: 'draft' | 'published';
  visibility: 'workspace' | 'public';
  reports_row_id: string | null;        // FK → table_rows.id (auto-created Reports DB row)
  generated_at: string;
  generated_by: string;        // User id (or "" for MCP server)
  published_at: string | null;
  published_by: string | null;
}
```

**Unique constraint:** `(extension_id, slug)` — one snapshot per (template, slug) pair.

### Reports DB (auto-bootstrapped page)

When the worker `/init` runs at schema v9+, it upserts a workspace-wide
page (`page_configs` id = `'system_reports'`, page_type = `'database'`,
title = `'Reports'`) and a matching `table_schemas` row. The config flag
`_extensionsReportsDb: true` lives in `page_configs.config` (and is
spread onto frontend page objects via `d1ToFrontend()` as
`page._extensionsReportsDb`).

Bootstrap is versioned via `connections.extensions_reports_db_bootstrap`
(`'v3'` as of 2026-05-18). Bumping the version string and re-deploying
forces the upsert to re-run with the latest canonical column/view config.

Default columns: `title`, `extension` (display name "Report Type"),
`snapshot_slug` (display name "Reference"), `status` (Draft/Published),
`visibility` (Workspace/Public), `generated_at`, `generated_by`,
`summary`, `snapshot_id` (hidden), plus system `_last_edited_time` and
`_created_time`. Default-visible columns: Title, Report Type, Status,
Visibility, Generated, Generated by.

### Snapshot ↔ workspace links

Snapshots participate in Wasabi's semantic graph via existing tables —
no new link table:

- **Neurons:** `neuron_nodes` with `node_type: 'extension_snapshot'`, `node_id: snapshot.id`. Created via `wasabi_extension_snapshots add_link kind=neuron`.
- **Record comments:** `record_comments` rows referencing the snapshot in their `content`. Created via `add_link kind=record_comment`.

Both surface to the relationships projection system automatically.
