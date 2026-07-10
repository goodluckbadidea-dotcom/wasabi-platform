// ─── API Constants ───
export const NOTION_API = "https://api.notion.com/v1";
export const NOTION_VERSION = "2022-06-28";
export const CLAUDE_API = "https://api.anthropic.com/v1/messages";

// ─── D1 Schema ───
export const D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS connections (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS page_configs (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  title TEXT NOT NULL,
  icon TEXT DEFAULT '',
  page_type TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  config TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS table_schemas (
  id TEXT PRIMARY KEY,
  columns TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS table_rows (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  cells TEXT NOT NULL,
  cell_versions TEXT DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  sync_dirty INTEGER DEFAULT 0,
  sync_retry_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS sheet_data (
  id TEXT PRIMARY KEY,
  col_count INTEGER DEFAULT 26,
  row_count INTEGER DEFAULT 100,
  cells TEXT NOT NULL DEFAULT '{}',
  col_widths TEXT DEFAULT '{}',
  row_heights TEXT DEFAULT '{}',
  frozen TEXT DEFAULT '{}',
  cell_styles TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  word_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  trigger_type TEXT NOT NULL,
  trigger_config TEXT DEFAULT '{}',
  action_config TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 0,
  scope_table_id TEXT,
  fire_count INTEGER DEFAULT 0,
  last_fired_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Untitled',
  description TEXT DEFAULT '',
  flow_data TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 0,
  run_count INTEGER DEFAULT 0,
  last_run TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'notification',
  status TEXT DEFAULT 'unread',
  source TEXT DEFAULT '',
  target_user_id TEXT DEFAULT 'all',
  record_id TEXT DEFAULT '',
  record_name TEXT DEFAULT '',
  page_config_id TEXT DEFAULT '',
  page_name TEXT DEFAULT '',
  actor_name TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_base (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  category TEXT DEFAULT 'business_context',
  content TEXT NOT NULL,
  source TEXT DEFAULT 'conversation',
  related_pages TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cell_links (
  id TEXT PRIMARY KEY,
  source_page_id TEXT NOT NULL,
  source_view_idx INTEGER,
  source_ref TEXT NOT NULL,
  target_page_id TEXT NOT NULL,
  target_view_idx INTEGER,
  target_ref TEXT NOT NULL,
  direction TEXT DEFAULT 'one_way',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  source_field_type TEXT DEFAULT '',
  target_field_type TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_cell_links_target ON cell_links(target_page_id, target_view_idx);
CREATE INDEX IF NOT EXISTS idx_cell_links_source ON cell_links(source_page_id);

CREATE TABLE IF NOT EXISTS sync_configs (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  notion_db_id TEXT NOT NULL,
  direction TEXT DEFAULT 'app_to_notion',
  field_mapping TEXT DEFAULT '{}',
  last_synced_at TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS data_summary_cache (
  page_id TEXT PRIMARY KEY,
  summary TEXT NOT NULL DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS record_notes (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  page_config_id TEXT NOT NULL,
  content TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS record_comments (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  page_config_id TEXT NOT NULL,
  user_id TEXT DEFAULT 'default',
  user_name TEXT DEFAULT 'User',
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS neurons (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS neuron_nodes (
  id TEXT PRIMARY KEY,
  neuron_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_label TEXT DEFAULT '',
  page_config_id TEXT DEFAULT '',
  meta TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime_type TEXT DEFAULT 'application/octet-stream',
  size INTEGER DEFAULT 0,
  page_id TEXT DEFAULT '',
  record_id TEXT DEFAULT '',
  meta TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rule_snapshots (
  rule_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  value_hash TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (rule_id, record_id, field_name)
);

CREATE TABLE IF NOT EXISTS custom_functions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT DEFAULT 'transform',
  version INTEGER DEFAULT 1,
  inputs TEXT DEFAULT '{}',
  outputs TEXT DEFAULT '{}',
  code TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  created_by TEXT DEFAULT 'wasabi',
  last_run_at TEXT,
  last_run_status TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS function_executions (
  id TEXT PRIMARY KEY,
  function_id TEXT NOT NULL,
  function_name TEXT DEFAULT '',
  trigger_source TEXT DEFAULT 'chat',
  status TEXT DEFAULT 'success',
  input_summary TEXT DEFAULT '{}',
  output_summary TEXT DEFAULT '{}',
  mutations_count INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  error TEXT DEFAULT '',
  executed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS flow_executions (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  flow_name TEXT DEFAULT '',
  trigger_source TEXT DEFAULT 'manual',
  status TEXT DEFAULT 'running',
  node_states TEXT DEFAULT '{}',
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  error TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS task_activity (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  source TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  UNIQUE(task_id, source)
);

CREATE TABLE IF NOT EXISTS task_interactions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  source TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'default',
  interaction_type TEXT NOT NULL DEFAULT 'view',
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  invite_code TEXT UNIQUE,
  password_hash TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_login_at TEXT,
  invite_expires_at TEXT,
  deleted_at TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS user_connections (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS user_state (
  user_id TEXT PRIMARY KEY,
  last_page TEXT,
  zen_tasks_table_id TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS record_views (
  user_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  last_viewed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, record_id)
);

CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_page_id TEXT,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_page_id TEXT,
  directed INTEGER NOT NULL DEFAULT 1,
  origin TEXT NOT NULL,
  confidence REAL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT,
  updated_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS relationship_types (
  type TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  inverse_label TEXT,
  directed INTEGER NOT NULL,
  cascade_hint TEXT NOT NULL,
  deprecated_at TEXT,
  description TEXT
);
`;

// ─── D1 Indexes ───
export const D1_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_rows_table ON table_rows(table_id, archived);
CREATE INDEX IF NOT EXISTS idx_notif_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_record_notes_lookup ON record_notes(record_id, page_config_id);
CREATE INDEX IF NOT EXISTS idx_record_comments_lookup ON record_comments(record_id, page_config_id);
CREATE INDEX IF NOT EXISTS idx_nn_neuron ON neuron_nodes(neuron_id);
CREATE INDEX IF NOT EXISTS idx_nn_nodeid ON neuron_nodes(node_id);
CREATE INDEX IF NOT EXISTS idx_files_page ON files(page_id);
CREATE INDEX IF NOT EXISTS idx_files_record ON files(record_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_rule ON rule_snapshots(rule_id);
CREATE INDEX IF NOT EXISTS idx_custom_fn_status ON custom_functions(status);
CREATE INDEX IF NOT EXISTS idx_fn_exec_fn ON function_executions(function_id, executed_at);
CREATE INDEX IF NOT EXISTS idx_flow_exec_flow ON flow_executions(flow_id, started_at);
CREATE INDEX IF NOT EXISTS idx_task_activity_lookup ON task_activity(task_id, source);
CREATE INDEX IF NOT EXISTS idx_task_interactions_lookup ON task_interactions(task_id, source);
CREATE INDEX IF NOT EXISTS idx_task_interactions_user ON task_interactions(user_id, source);
CREATE INDEX IF NOT EXISTS idx_sync_dirty ON table_rows(sync_dirty) WHERE sync_dirty = 1;
CREATE INDEX IF NOT EXISTS idx_users_invite ON users(invite_code);
CREATE INDEX IF NOT EXISTS idx_user_conn ON user_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_record_views_user ON record_views(user_id);

CREATE TABLE IF NOT EXISTS task_snoozes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  source TEXT NOT NULL,
  user_id TEXT NOT NULL,
  snooze_until TEXT NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_snoozes_user ON task_snoozes(user_id);

-- Extensions: typed appendages attached to Wasabi. Two broad types:
-- mcp_generated (default) authors HTML rendered from a validated DATA blob.
-- data_collection authors Wasabi-native input surfaces backed by the dc_*
-- tables (items, submissions, submission_entries, share_links).
CREATE TABLE IF NOT EXISTS extensions (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '',
  description TEXT DEFAULT '',
  -- Long-form markdown conceptual model: glossary, calculation rules,
  -- source-document roles, field meanings, gotchas. Claude-facing context
  -- for any session that authors data or refines the template. Distinct
  -- from description (which is a short user-facing blurb).
  definition TEXT DEFAULT '',
  html TEXT NOT NULL DEFAULT '',
  data_schema TEXT DEFAULT '{}',
  -- Dev/test fixture only — NEVER used for real snapshot generation.
  -- Real data always flows: source folder → Claude+MCP parser → snapshot.
  sample_data TEXT DEFAULT '{}',
  theme_preference TEXT DEFAULT 'inherit',
  version INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  -- Type: 'mcp_generated' (default, HTML+DATA reports) or 'data_collection'
  -- (Wasabi-native input surfaces backed by dc_* tables).
  type TEXT NOT NULL DEFAULT 'mcp_generated',
  -- Optional per-extension config JSON. For data_collection extensions this
  -- holds things like the vendor CRM page id, workbook markets, page/category
  -- structure. MCP-generated extensions leave this empty.
  ext_config TEXT DEFAULT '{}',
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_extensions_slug ON extensions(slug);
CREATE INDEX IF NOT EXISTS idx_extensions_status ON extensions(status);

CREATE TABLE IF NOT EXISTS extension_snapshots (
  id TEXT PRIMARY KEY,
  extension_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  html_key TEXT NOT NULL DEFAULT '',
  template_version INTEGER DEFAULT 1,
  source_snapshot_id TEXT,
  status TEXT DEFAULT 'draft',
  visibility TEXT DEFAULT 'workspace',
  reports_row_id TEXT,
  generated_at TEXT DEFAULT (datetime('now')),
  generated_by TEXT DEFAULT '',
  published_at TEXT,
  published_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_snap_unique ON extension_snapshots(extension_id, slug);
CREATE INDEX IF NOT EXISTS idx_ext_snap_extension ON extension_snapshots(extension_id);
CREATE INDEX IF NOT EXISTS idx_ext_snap_status ON extension_snapshots(status);
CREATE INDEX IF NOT EXISTS idx_extensions_type ON extensions(type);

-- ─── Data Collection Extensions (dc_* tables) ───
-- Backing storage for extensions.type = 'data_collection'. Every DC
-- extension owns rows across these four tables via extension_id.
--
-- dc_items          — the Master Item Sheet catalog: one row per SKU / item.
-- dc_submissions    — one row per workbook page fill (market × page × counter).
-- dc_submission_entries — one row per counted item within a submission.
-- dc_share_links    — anonymous submission tokens for iPads without an account.

CREATE TABLE IF NOT EXISTS dc_items (
  id TEXT PRIMARY KEY,
  extension_id TEXT NOT NULL,
  sku TEXT NOT NULL,                     -- primary display code (may be a real SKU or a named item)
  description TEXT DEFAULT '',           -- secondary label ("100 Sheep · 20-pack")
  channel TEXT DEFAULT '',               -- product-line grouping ("drops" | "smoky" | "drops-hemp" | ...)
  markets TEXT DEFAULT '[]',             -- JSON string[]: markets this item applies to
  type_key TEXT DEFAULT '',              -- item-type ("tins" | "mp" | "labels" | "tamper" | "cover" | "dram" | "paper" | "kitchen" | "marketing")
  vendor_ref TEXT DEFAULT '',            -- Vendor CRM row id (table_rows.id in the vendor page)
  vendor_name TEXT DEFAULT '',           -- denormalized cache for display without a join
  count_mode TEXT NOT NULL DEFAULT 'case', -- 'case' | 'unit' | 'weight'
  case_size REAL DEFAULT NULL,           -- units-per-case when count_mode='case'
  weight_unit TEXT DEFAULT NULL,         -- 'lbs' | 'oz' | 'g' | 'kg' when count_mode='weight'
  notes TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_dc_items_ext ON dc_items(extension_id, archived);
CREATE INDEX IF NOT EXISTS idx_dc_items_sku ON dc_items(sku);
CREATE INDEX IF NOT EXISTS idx_dc_items_type ON dc_items(extension_id, type_key);
CREATE INDEX IF NOT EXISTS idx_dc_items_channel ON dc_items(extension_id, channel);

CREATE TABLE IF NOT EXISTS dc_submissions (
  id TEXT PRIMARY KEY,
  extension_id TEXT NOT NULL,
  market TEXT NOT NULL,                  -- e.g. "OR" | "CA" | "NY" | "NV" | "HEMP"
  page TEXT NOT NULL,                    -- e.g. "packaging" | "kitchen" | "sales"
  category TEXT DEFAULT '',              -- packaging sub-tab: "drops" | "smoky" | "drops-hemp"
  status TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'submitted'
  counter_name TEXT DEFAULT '',
  counter_user_id TEXT DEFAULT '',       -- populated when the submitter is a logged-in user
  share_link_id TEXT DEFAULT '',         -- populated when submitted via a share link
  count_date TEXT DEFAULT NULL,          -- YYYY-MM-DD of the physical count
  submitted_at TEXT DEFAULT NULL,
  submitted_by TEXT DEFAULT '',
  edited_at TEXT DEFAULT NULL,
  edited_by TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dc_subs_ext ON dc_submissions(extension_id, status);
CREATE INDEX IF NOT EXISTS idx_dc_subs_market ON dc_submissions(extension_id, market, page);
CREATE INDEX IF NOT EXISTS idx_dc_subs_submitted ON dc_submissions(submitted_at DESC);

CREATE TABLE IF NOT EXISTS dc_submission_entries (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  count_mode TEXT NOT NULL,              -- snapshot of item's mode at entry time
  cases_count REAL DEFAULT NULL,         -- when count_mode='case'
  units_count REAL DEFAULT NULL,         -- when count_mode='unit'
  weight_value REAL DEFAULT NULL,        -- when count_mode='weight'
  weight_unit TEXT DEFAULT NULL,         -- 'lbs' | 'oz' | 'g' | 'kg'
  case_size_snapshot REAL DEFAULT NULL,  -- units-per-case at entry time (protects against later item edits)
  total_units REAL DEFAULT NULL,         -- computed at write: cases * case_size, or units_count, or NULL for weight
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dc_entries_unique ON dc_submission_entries(submission_id, item_id);
CREATE INDEX IF NOT EXISTS idx_dc_entries_sub ON dc_submission_entries(submission_id);
CREATE INDEX IF NOT EXISTS idx_dc_entries_item ON dc_submission_entries(item_id);

CREATE TABLE IF NOT EXISTS dc_share_links (
  id TEXT PRIMARY KEY,
  extension_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,            -- ~32-char high-entropy random
  label TEXT DEFAULT '',                 -- human name ("NY lead — iPad 1")
  scope_market TEXT DEFAULT '',          -- optional: constrain writes to this market
  scope_page TEXT DEFAULT '',            -- optional: constrain writes to this page
  submission_limit INTEGER DEFAULT NULL,
  submission_count INTEGER DEFAULT 0,
  expires_at TEXT DEFAULT NULL,
  revoked_at TEXT DEFAULT NULL,
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dc_share_ext ON dc_share_links(extension_id);
CREATE INDEX IF NOT EXISTS idx_dc_share_active ON dc_share_links(extension_id, revoked_at);

CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_rel_type ON relationships(type);
CREATE INDEX IF NOT EXISTS idx_rel_source_page ON relationships(source_page_id);
CREATE INDEX IF NOT EXISTS idx_rel_target_page ON relationships(target_page_id);

-- Partial unique index: one active edge per (source, target, type) tuple.
-- Soft-deleted edges (deleted_at IS NOT NULL) are excluded so users can
-- delete-then-recreate the same edge. Projection code uses INSERT OR IGNORE
-- against this index to skip duplicates and respect existing native edges
-- (user_declared / ai_inferred always win).
CREATE UNIQUE INDEX IF NOT EXISTS idx_rel_uniq_active
  ON relationships(source_type, source_id, target_type, target_id, type)
  WHERE deleted_at IS NULL;

-- ─── Figma comment ↔ record links (Phase 3b, 2026-05-11) ───
-- Joins a Figma comment (lives in Figma's API, not Wasabi) to a Wasabi
-- record. Snapshot of message/author/created_at is kept so the linked
-- record's drawer can render the comment without re-fetching Figma.
-- Snapshot drifts from Figma's source of truth — the link can be deleted
-- and re-created to refresh.
CREATE TABLE IF NOT EXISTS figma_comment_links (
  id TEXT PRIMARY KEY,
  figma_file_key TEXT NOT NULL,
  figma_file_name TEXT DEFAULT '',
  figma_comment_id TEXT NOT NULL,
  comment_message TEXT DEFAULT '',
  comment_author TEXT DEFAULT '',
  comment_created_at TEXT DEFAULT '',
  record_id TEXT NOT NULL,
  record_name TEXT DEFAULT '',
  page_config_id TEXT NOT NULL,
  linked_by TEXT DEFAULT '',
  linked_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fcl_unique
  ON figma_comment_links(figma_comment_id, record_id);
CREATE INDEX IF NOT EXISTS idx_fcl_record ON figma_comment_links(record_id);
CREATE INDEX IF NOT EXISTS idx_fcl_file ON figma_comment_links(figma_file_key);
`;

// ─── Relationship Type Seed Rows ───
// Day-one taxonomy for the unified relationships subsystem. Idempotent via
// INSERT OR IGNORE. Populated during /init; new types can be added later by
// appending entries here and bumping the schema version.
export const RELATIONSHIP_TYPE_SEEDS = [
  `INSERT OR IGNORE INTO relationship_types (type, label, inverse_label, directed, cascade_hint, description) VALUES ('part_of', 'part of', 'has parts', 1, 'cascade', 'Child belongs to a parent entity. Sub-item hierarchy.')`,
  `INSERT OR IGNORE INTO relationship_types (type, label, inverse_label, directed, cascade_hint, description) VALUES ('references', 'references', 'referenced by', 1, 'nullify', 'Source cell pulls its value from a target cell.')`,
  `INSERT OR IGNORE INTO relationship_types (type, label, inverse_label, directed, cascade_hint, description) VALUES ('related_to', 'related to', NULL, 1, 'nullify', 'Relation-column edge. One edge per array element.')`,
  `INSERT OR IGNORE INTO relationship_types (type, label, inverse_label, directed, cascade_hint, description) VALUES ('member_of_neuron', 'member of', 'has member', 1, 'nullify', 'Entity belongs to a named neuron cluster.')`,
  `INSERT OR IGNORE INTO relationship_types (type, label, inverse_label, directed, cascade_hint, description) VALUES ('mentioned_in', 'mentioned in', 'mentions', 1, 'ignore', 'User was @-mentioned in a record comment.')`,
  `INSERT OR IGNORE INTO relationship_types (type, label, inverse_label, directed, cascade_hint, description) VALUES ('depends_on', 'depends on', 'blocks', 1, 'prompt', 'Source task is blocked until target task completes.')`,
  `INSERT OR IGNORE INTO relationship_types (type, label, inverse_label, directed, cascade_hint, description) VALUES ('blocks', 'blocks', 'depends on', 1, 'prompt', 'Inverse of depends_on; renderable either way.')`,
  `INSERT OR IGNORE INTO relationship_types (type, label, inverse_label, directed, cascade_hint, description) VALUES ('similar_to', 'similar to', NULL, 0, 'ignore', 'Symmetric semantic similarity. Usually AI-inferred.')`,
  `INSERT OR IGNORE INTO relationship_types (type, label, inverse_label, directed, cascade_hint, description) VALUES ('conflicts_with', 'conflicts with', NULL, 0, 'prompt', 'Symmetric conflict. Two entities in tension.')`,
];
