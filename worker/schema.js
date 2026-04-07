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
  email TEXT,
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

CREATE TABLE IF NOT EXISTS user_dashboards (
  user_id TEXT PRIMARY KEY,
  widgets TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS record_views (
  user_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  last_viewed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, record_id)
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
`;
