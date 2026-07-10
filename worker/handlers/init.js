// ─── Init / Health / Factory Reset Handlers ───
// Extracted from worker.js — zero logic changes.

import { D1_SCHEMA, D1_INDEXES, RELATIONSHIP_TYPE_SEEDS } from '../schema.js';
import { rebuildProjections } from './relationshipProjections.js';
import { propagateOwnersToAncestors } from './tables.js';

// ─── Route Handlers ───

async function handleHealth(env, jsonResponse) {
  const status = { ok: true, version: "2.0.0", d1: false, r2: false, notion: false, claude: false };

  // Check D1
  try {
    await env.DB.prepare("SELECT 1").first();
    status.d1 = true;
  } catch {}

  // Check R2
  try {
    if (env.DOCS) {
      await env.DOCS.head("__health__");
      status.r2 = true;
    }
  } catch {
    // R2 binding exists but head() on missing key throws — that's fine
    if (env.DOCS) status.r2 = true;
  }

  // Check if Notion connection exists
  try {
    const row = await env.DB.prepare("SELECT key FROM connections WHERE key = 'notion'").first();
    status.notion = !!row;
  } catch {}

  // Check if Claude connection exists
  try {
    const row = await env.DB.prepare("SELECT key FROM connections WHERE key = 'claude'").first();
    status.claude = !!row;
  } catch {}

  return jsonResponse(status);
}

async function handleInit(env, jsonResponse) {
  // ── Schema version fast path ──
  // Skip all DDL if the schema is already at the current version.
  // Reduces ~92 sequential D1 queries to 3 on returning page loads.
  const CURRENT_SCHEMA_VERSION = "16";
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM connections WHERE key = 'schema_version'"
    ).first();
    if (row?.value === CURRENT_SCHEMA_VERSION) {
      let multiUserEnabled = false;
      try {
        const registered = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM users WHERE password_hash IS NOT NULL AND deleted_at IS NULL"
        ).first();
        multiUserEnabled = registered && registered.count > 0;
      } catch {}
      const tables = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
      ).all();
      return jsonResponse({
        ok: true,
        tables: tables.results.map((t) => t.name),
        message: "Database initialized successfully",
        multi_user: multiUserEnabled,
      });
    }
  } catch {
    // connections table doesn't exist yet (first boot) — fall through to full init
  }

  // ── Full init (first boot, factory reset, or schema version bump) ──
  const statements = D1_SCHEMA.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  const indexStatements = D1_INDEXES.split(";").map((s) => s.trim()).filter((s) => s.length > 0);

  try {
    // Create tables (batched — single round-trip)
    await env.DB.batch(statements.map(sql => env.DB.prepare(sql)));

    // Migrations for existing databases (run BEFORE indexes, since indexes may reference new columns)
    const migrations = [
      "ALTER TABLE sheet_data ADD COLUMN row_heights TEXT DEFAULT '{}'",
      "ALTER TABLE sheet_data ADD COLUMN frozen TEXT DEFAULT '{}'",
      "ALTER TABLE sheet_data ADD COLUMN cell_styles TEXT DEFAULT '{}'",
      "ALTER TABLE custom_functions ADD COLUMN meta TEXT DEFAULT '{}'",
      "CREATE TABLE IF NOT EXISTS task_activity (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, source TEXT NOT NULL, last_activity_at TEXT NOT NULL, UNIQUE(task_id, source))",
      "CREATE INDEX IF NOT EXISTS idx_task_activity_lookup ON task_activity(task_id, source)",
      "ALTER TABLE table_rows ADD COLUMN sync_dirty INTEGER DEFAULT 0",
      "ALTER TABLE table_rows ADD COLUMN sync_retry_count INTEGER DEFAULT 0",
      "CREATE TABLE IF NOT EXISTS data_summary_cache (page_id TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', updated_at TEXT DEFAULT (datetime('now')))",
      // Sprint 5: Multi-user foundation
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', invite_code TEXT UNIQUE, password_hash TEXT, created_at TEXT DEFAULT (datetime('now')), last_login_at TEXT)",
      "CREATE TABLE IF NOT EXISTS user_connections (user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, metadata TEXT DEFAULT '{}', updated_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (user_id, key))",
      "CREATE INDEX IF NOT EXISTS idx_users_invite ON users(invite_code)",
      "CREATE INDEX IF NOT EXISTS idx_user_conn ON user_connections(user_id)",
      "ALTER TABLE page_configs ADD COLUMN pin_protected INTEGER DEFAULT 0",
      "ALTER TABLE notifications ADD COLUMN target_user_id TEXT DEFAULT 'all'",
      "ALTER TABLE table_rows ADD COLUMN owner_user_id TEXT DEFAULT 'default'",
      // Sprint 6: Account recovery
      "ALTER TABLE users ADD COLUMN deleted_at TEXT DEFAULT NULL",
      // Sprint 7: Per-user state persistence
      "CREATE TABLE IF NOT EXISTS user_state (user_id TEXT PRIMARY KEY, last_page TEXT, zen_tasks_table_id TEXT, updated_at TEXT DEFAULT (datetime('now')))",
      // Schema v14: per-user widget dashboards removed. Dashboards are now a
      // page type (created via createDashboardConfig, rendered by WidgetGrid)
      // and follow page permissions. Drop the legacy table on existing DBs.
      "DROP TABLE IF EXISTS user_dashboards",
      // Sprint 8: Record read receipts
      "CREATE TABLE IF NOT EXISTS record_views (user_id TEXT NOT NULL, record_id TEXT NOT NULL, last_viewed_at TEXT NOT NULL, PRIMARY KEY (user_id, record_id))",
      "CREATE INDEX IF NOT EXISTS idx_record_views_user ON record_views(user_id)",
      // Sprint 13: Enriched notifications
      "ALTER TABLE notifications ADD COLUMN record_id TEXT DEFAULT ''",
      "ALTER TABLE notifications ADD COLUMN record_name TEXT DEFAULT ''",
      "ALTER TABLE notifications ADD COLUMN page_config_id TEXT DEFAULT ''",
      "ALTER TABLE notifications ADD COLUMN page_name TEXT DEFAULT ''",
      "ALTER TABLE notifications ADD COLUMN actor_name TEXT DEFAULT ''",
      // Task interaction journal (per-user, typed interactions)
      "CREATE TABLE IF NOT EXISTS task_interactions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, source TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT 'default', interaction_type TEXT NOT NULL DEFAULT 'view', detail TEXT, created_at TEXT DEFAULT (datetime('now')))",
      "CREATE INDEX IF NOT EXISTS idx_task_interactions_lookup ON task_interactions(task_id, source)",
      "CREATE INDEX IF NOT EXISTS idx_task_interactions_user ON task_interactions(user_id, source)",
      // Cell links: field type columns + indexes
      "ALTER TABLE cell_links ADD COLUMN source_field_type TEXT DEFAULT ''",
      "ALTER TABLE cell_links ADD COLUMN target_field_type TEXT DEFAULT ''",
      "CREATE INDEX IF NOT EXISTS idx_cell_links_target ON cell_links(target_page_id, target_view_idx)",
      "CREATE INDEX IF NOT EXISTS idx_cell_links_source ON cell_links(source_page_id)",
      // Per-user view preferences (stored as JSON blob)
      "ALTER TABLE user_state ADD COLUMN view_prefs TEXT DEFAULT '{}'",
      // Record model: file-per-record support
      "ALTER TABLE files ADD COLUMN record_id TEXT DEFAULT ''",
      "CREATE INDEX IF NOT EXISTS idx_files_record ON files(record_id)",
      // Sprint 14: Real-time collaboration — field-level versioning
      "ALTER TABLE table_rows ADD COLUMN cell_versions TEXT DEFAULT '{}'",
      "ALTER TABLE table_rows ADD COLUMN updated_by TEXT DEFAULT NULL",
      // Tier 2: Resource-level permissions
      "CREATE TABLE IF NOT EXISTS page_permissions (page_id TEXT NOT NULL, user_id TEXT NOT NULL, permission TEXT NOT NULL DEFAULT 'viewer', granted_by TEXT, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (page_id, user_id))",
      "CREATE INDEX IF NOT EXISTS idx_page_perms_user ON page_permissions(user_id)",
      "ALTER TABLE page_configs ADD COLUMN created_by TEXT DEFAULT NULL",
      // Tier 3: Audit log
      "CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_name TEXT DEFAULT '', action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT DEFAULT '', details TEXT DEFAULT '{}', created_at TEXT DEFAULT (datetime('now')))",
      "CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)",
      "CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, resource_type)",
      "CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at DESC)",
      // Tier 3: Server-side PIN sessions
      "CREATE TABLE IF NOT EXISTS pin_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, page_id TEXT NOT NULL, expires_at TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS idx_pin_sessions_page ON pin_sessions(page_id, user_id)",
      // Multi-device sync: active sessions
      "CREATE TABLE IF NOT EXISTS active_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_info TEXT DEFAULT '', ip_address TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT DEFAULT (datetime('now')), revoked_at TEXT DEFAULT NULL)",
      "CREATE INDEX IF NOT EXISTS idx_sessions_user ON active_sessions(user_id)",
      // Phase 2C: Invite code expiration
      "ALTER TABLE users ADD COLUMN invite_expires_at TEXT",
      // D1-backed rate limiting (persists across worker isolates)
      "CREATE TABLE IF NOT EXISTS rate_limits (key TEXT NOT NULL, ts INTEGER NOT NULL)",
      "CREATE INDEX IF NOT EXISTS idx_rate_limits_key_ts ON rate_limits(key, ts)",
      // Sub-items: parent-child row hierarchy
      "ALTER TABLE table_rows ADD COLUMN parent_row_id TEXT DEFAULT NULL",
      "CREATE INDEX IF NOT EXISTS idx_rows_parent ON table_rows(table_id, parent_row_id)",
      // Sub-item independent schema
      "ALTER TABLE table_schemas ADD COLUMN sub_columns TEXT DEFAULT '[]'",
      // Phase 3b: snapshot the linked record's title so the "↗ [name]" pill
      // and the "From Figma" section can render the actual name instead of
      // a generic "record" fallback. Idempotent — try/catch above swallows
      // the duplicate-column error for tables that already have it.
      "ALTER TABLE figma_comment_links ADD COLUMN record_name TEXT DEFAULT ''",
      // ─── Extensions (custom-coded reports, generated via MCP) ───
      // Schema v9. Two tables: `extensions` (template definitions) and
      // `extension_snapshots` (concrete generated reports). Snapshot DATA
      // lives in D1 as a JSON blob; rendered HTML lives in R2 under
      // `extensions/{ext_slug}/{snap_slug}.html`.
      `CREATE TABLE IF NOT EXISTS extensions (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        icon TEXT DEFAULT '',
        description TEXT DEFAULT '',
        definition TEXT DEFAULT '',
        html TEXT NOT NULL DEFAULT '',
        data_schema TEXT DEFAULT '{}',
        sample_data TEXT DEFAULT '{}',
        theme_preference TEXT DEFAULT 'inherit',
        version INTEGER DEFAULT 1,
        status TEXT DEFAULT 'active',
        created_by TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      // Schema v12: `definition` field for existing rows (idempotent — try/catch
      // above swallows the duplicate-column error on databases that already have it).
      "ALTER TABLE extensions ADD COLUMN definition TEXT DEFAULT ''",
      "CREATE INDEX IF NOT EXISTS idx_extensions_slug ON extensions(slug)",
      "CREATE INDEX IF NOT EXISTS idx_extensions_status ON extensions(status)",
      `CREATE TABLE IF NOT EXISTS extension_snapshots (
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
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_snap_unique ON extension_snapshots(extension_id, slug)",
      "CREATE INDEX IF NOT EXISTS idx_ext_snap_extension ON extension_snapshots(extension_id)",
      "CREATE INDEX IF NOT EXISTS idx_ext_snap_status ON extension_snapshots(status)",
      // ─── Forms feature ───
      // Three tables: form_definitions (templates), form_connections (form↔record
      // relationships), form_submissions (actual fills, draft or submitted).
      // See docs/19-forms-feature.md for the full design.
      `CREATE TABLE IF NOT EXISTS form_definitions (
        id TEXT PRIMARY KEY,
        table_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'Untitled form',
        description TEXT DEFAULT '',
        form_type TEXT NOT NULL DEFAULT 'single_instance',
        fields TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        created_by TEXT DEFAULT ''
      )`,
      "CREATE INDEX IF NOT EXISTS idx_form_defs_table ON form_definitions(table_id)",
      `CREATE TABLE IF NOT EXISTS form_connections (
        id TEXT PRIMARY KEY,
        form_id TEXT NOT NULL,
        record_id TEXT NOT NULL,
        table_id TEXT NOT NULL,
        connected_at TEXT DEFAULT (datetime('now')),
        connected_by TEXT DEFAULT ''
      )`,
      "CREATE INDEX IF NOT EXISTS idx_form_conns_record ON form_connections(record_id)",
      "CREATE INDEX IF NOT EXISTS idx_form_conns_form_record ON form_connections(form_id, record_id)",
      // Column is `field_values` (not `values`) — `VALUES` is a SQL keyword
      // and using it unquoted here caused the whole CREATE TABLE to fail
      // silently, leaving form_submissions absent from every DB. Delete
      // cascades from the form/connection level would then error with
      // "no such table: form_submissions". If your DB has the old (broken)
      // shape lying around, the IF NOT EXISTS guard is fine — the table
      // just never got created in the first place.
      `CREATE TABLE IF NOT EXISTS form_submissions (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        form_id TEXT NOT NULL,
        record_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        field_values TEXT NOT NULL DEFAULT '{}',
        draft_owner_id TEXT DEFAULT NULL,
        submitted_at TEXT DEFAULT NULL,
        submitted_by TEXT DEFAULT NULL,
        edited_at TEXT DEFAULT NULL,
        edited_by TEXT DEFAULT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      "CREATE INDEX IF NOT EXISTS idx_form_subs_conn ON form_submissions(connection_id)",
      "CREATE INDEX IF NOT EXISTS idx_form_subs_record_status ON form_submissions(record_id, status)",
      "CREATE INDEX IF NOT EXISTS idx_form_subs_form_record ON form_submissions(record_id, form_id, status)",
      // Team Priorities: admin-set pins that pin tasks to the top of a
      // target user's AI-curated zen list. See project_admin_priorities.
      `CREATE TABLE IF NOT EXISTS task_pins (
        id TEXT PRIMARY KEY,
        target_user_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT '',
        pin_order INTEGER NOT NULL DEFAULT 0,
        pinned_by_user_id TEXT NOT NULL,
        reason TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(target_user_id, task_id)
      )`,
      "CREATE INDEX IF NOT EXISTS idx_task_pins_target ON task_pins(target_user_id, pin_order)",
      "CREATE INDEX IF NOT EXISTS idx_task_pins_task ON task_pins(task_id)",
      // ─── Schema v16: Extensions typing + Data Collection tables ───
      // Adds a `type` column to `extensions` so we can distinguish today's
      // MCP-generated reports from the new Data Collection extension type
      // (see docs/18-extensions.md). All existing rows default to
      // 'mcp_generated' automatically. `ext_config` is a JSON blob for
      // per-extension config (e.g. vendor CRM page id for Data Collection).
      "ALTER TABLE extensions ADD COLUMN type TEXT NOT NULL DEFAULT 'mcp_generated'",
      "ALTER TABLE extensions ADD COLUMN ext_config TEXT DEFAULT '{}'",
      "CREATE INDEX IF NOT EXISTS idx_extensions_type ON extensions(type)",
      // Data Collection catalog (Master Item Sheet)
      `CREATE TABLE IF NOT EXISTS dc_items (
        id TEXT PRIMARY KEY,
        extension_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        description TEXT DEFAULT '',
        channel TEXT DEFAULT '',
        markets TEXT DEFAULT '[]',
        type_key TEXT DEFAULT '',
        vendor_ref TEXT DEFAULT '',
        vendor_name TEXT DEFAULT '',
        count_mode TEXT NOT NULL DEFAULT 'case',
        case_size REAL DEFAULT NULL,
        weight_unit TEXT DEFAULT NULL,
        notes TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        archived INTEGER DEFAULT 0,
        created_by TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        updated_by TEXT DEFAULT ''
      )`,
      "CREATE INDEX IF NOT EXISTS idx_dc_items_ext ON dc_items(extension_id, archived)",
      "CREATE INDEX IF NOT EXISTS idx_dc_items_sku ON dc_items(sku)",
      "CREATE INDEX IF NOT EXISTS idx_dc_items_type ON dc_items(extension_id, type_key)",
      "CREATE INDEX IF NOT EXISTS idx_dc_items_channel ON dc_items(extension_id, channel)",
      // Submissions — one per workbook page fill
      `CREATE TABLE IF NOT EXISTS dc_submissions (
        id TEXT PRIMARY KEY,
        extension_id TEXT NOT NULL,
        market TEXT NOT NULL,
        page TEXT NOT NULL,
        category TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        counter_name TEXT DEFAULT '',
        counter_user_id TEXT DEFAULT '',
        share_link_id TEXT DEFAULT '',
        count_date TEXT DEFAULT NULL,
        submitted_at TEXT DEFAULT NULL,
        submitted_by TEXT DEFAULT '',
        edited_at TEXT DEFAULT NULL,
        edited_by TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      "CREATE INDEX IF NOT EXISTS idx_dc_subs_ext ON dc_submissions(extension_id, status)",
      "CREATE INDEX IF NOT EXISTS idx_dc_subs_market ON dc_submissions(extension_id, market, page)",
      "CREATE INDEX IF NOT EXISTS idx_dc_subs_submitted ON dc_submissions(submitted_at DESC)",
      // Submission entries — one per counted item within a submission
      `CREATE TABLE IF NOT EXISTS dc_submission_entries (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        count_mode TEXT NOT NULL,
        cases_count REAL DEFAULT NULL,
        units_count REAL DEFAULT NULL,
        weight_value REAL DEFAULT NULL,
        weight_unit TEXT DEFAULT NULL,
        case_size_snapshot REAL DEFAULT NULL,
        total_units REAL DEFAULT NULL,
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_dc_entries_unique ON dc_submission_entries(submission_id, item_id)",
      "CREATE INDEX IF NOT EXISTS idx_dc_entries_sub ON dc_submission_entries(submission_id)",
      "CREATE INDEX IF NOT EXISTS idx_dc_entries_item ON dc_submission_entries(item_id)",
      // Share links — anonymous submission tokens
      `CREATE TABLE IF NOT EXISTS dc_share_links (
        id TEXT PRIMARY KEY,
        extension_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        label TEXT DEFAULT '',
        scope_market TEXT DEFAULT '',
        scope_page TEXT DEFAULT '',
        submission_limit INTEGER DEFAULT NULL,
        submission_count INTEGER DEFAULT 0,
        expires_at TEXT DEFAULT NULL,
        revoked_at TEXT DEFAULT NULL,
        created_by TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      "CREATE INDEX IF NOT EXISTS idx_dc_share_ext ON dc_share_links(extension_id)",
      "CREATE INDEX IF NOT EXISTS idx_dc_share_active ON dc_share_links(extension_id, revoked_at)",
    ];
    for (const sql of migrations) {
      try { await env.DB.prepare(sql).run(); } catch (_) { /* column already exists */ }
    }
    // Cleanup expired unused invites (no password_hash = never registered)
    try {
      await env.DB.prepare(
        "DELETE FROM users WHERE invite_code IS NOT NULL AND password_hash IS NULL AND invite_expires_at IS NOT NULL AND invite_expires_at < datetime('now')"
      ).run();
    } catch (_) {}

    // Create indexes (batched — single round-trip, after migrations so new columns exist)
    await env.DB.batch(indexStatements.map(sql => env.DB.prepare(sql)));

    // Seed relationship_types taxonomy (idempotent via INSERT OR IGNORE)
    try {
      await env.DB.batch(RELATIONSHIP_TYPE_SEEDS.map(sql => env.DB.prepare(sql)));
    } catch (_) {}

    // One-shot initial rebuild of the relationships projections.
    // Mirrors all existing connections from the five legacy systems (sub-items,
    // cell links, relation columns, neurons, mentions) into the relationships
    // table the first time this code runs. Self-disabling via a connections-
    // table flag — re-rebuilds go through POST /relationships/rebuild.
    try {
      const flag = await env.DB.prepare(
        "SELECT value FROM connections WHERE key = 'relationships_initial_rebuild'"
      ).first();
      if (flag?.value !== 'done') {
        const counts = await rebuildProjections(env);
        console.log('[relationships] initial backfill counts:', JSON.stringify(counts));
        await env.DB.prepare(
          "INSERT INTO connections (key, value, metadata, updated_at) VALUES ('relationships_initial_rebuild', 'done', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, metadata = excluded.metadata, updated_at = datetime('now')"
        ).bind(JSON.stringify(counts)).run();
      }
    } catch (err) {
      console.error('[relationships] initial backfill failed:', err.message || err);
    }

    // One-shot backfill: union sub-item owners into each ancestor's owners.
    // Matches the live propagation in handleUpdateRow / handleCreateRows so
    // existing data lines up with the new write-time behavior. Self-disabling
    // via a connections-table flag — re-runs go through manual deletion of
    // the flag if the data drifts.
    try {
      const flag = await env.DB.prepare(
        "SELECT value FROM connections WHERE key = 'parent_owner_backfill'"
      ).first();
      if (flag?.value !== 'done') {
        const subRows = await env.DB.prepare(
          "SELECT id, table_id, parent_row_id, owner_user_id FROM table_rows WHERE parent_row_id IS NOT NULL AND owner_user_id IS NOT NULL AND owner_user_id NOT IN ('default', 'unassigned', '')"
        ).all();
        let processed = 0;
        for (const sub of (subRows.results || [])) {
          let owners = [];
          try { owners = JSON.parse(sub.owner_user_id); } catch { owners = [sub.owner_user_id]; }
          if (!Array.isArray(owners)) owners = [owners];
          if (owners.length > 0) {
            await propagateOwnersToAncestors(env, sub.table_id, sub.parent_row_id, owners, sub.id, null);
            processed++;
          }
        }
        console.log(`[parent_owner] backfill processed ${processed} sub-items`);
        await env.DB.prepare(
          "INSERT INTO connections (key, value, metadata, updated_at) VALUES ('parent_owner_backfill', 'done', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, metadata = excluded.metadata, updated_at = datetime('now')"
        ).bind(JSON.stringify({ processed })).run();
      }
    } catch (err) {
      console.error('[parent_owner] backfill failed:', err.message || err);
    }

    // ─── Reports DB bootstrap ───
    // Creates (or upgrades) the workspace-wide "Reports" database. Every
    // MCP-generated snapshot gets a row in this table. The flag value is
    // versioned ("v2", "v3", …) so future column/view config changes can
    // re-run the upsert. INSERT … ON CONFLICT DO UPDATE keeps the user's
    // page id stable, but blasts the config + columns to the canonical
    // shape defined here. Hand-edits to the Reports DB's structure get
    // overwritten on version bumps — by design, since these are
    // system-managed.
    const REPORTS_BOOTSTRAP_VERSION = 'v3';
    try {
      const flag = await env.DB.prepare(
        "SELECT value FROM connections WHERE key = 'extensions_reports_db_bootstrap'"
      ).first();
      if (flag?.value !== REPORTS_BOOTSTRAP_VERSION) {
        const reportsPageId = 'system_reports';
        const reportsColumns = [
          { id: 'title', name: 'Title', type: 'text', system: false },
          { id: 'extension', name: 'Report Type', type: 'text', system: false },
          { id: 'snapshot_slug', name: 'Reference', type: 'text', system: false },
          { id: 'status', name: 'Status', type: 'status', system: false, options: [
            { name: 'Draft', color: 'gray', category: 'in_progress' },
            { name: 'Published', color: 'green', category: 'complete' },
          ]},
          { id: 'visibility', name: 'Visibility', type: 'select', system: false, options: [
            { name: 'Workspace', color: 'blue' },
            { name: 'Public', color: 'orange' },
          ]},
          { id: 'generated_at', name: 'Generated', type: 'date', system: false },
          { id: 'generated_by', name: 'Generated by', type: 'text', system: false },
          { id: 'summary', name: 'Summary', type: 'text', system: false },
          { id: 'snapshot_id', name: 'Snapshot ID', type: 'text', system: true, hidden: true },
          { id: '_last_edited_time', name: 'Last Updated', type: 'last_edited_time', system: true },
          { id: '_created_time', name: 'Created', type: 'created_time', system: true },
        ];
        // visibleFields = columns the Table view shows on first load.
        // IMPORTANT: Wasabi's Table view builds `allColumns` from column
        // *display names* (see _viewHelpers.js → resolveColumns / dataSource.js
        // → schema.title.name), so both `visibleFields` and `columns` must
        // be arrays of NAMES, not ids.
        //
        // Hidden by default: Reference (slug, redundant w/ Title which already
        // includes it), Summary (long text, surfaced in the drawer instead),
        // Snapshot ID (internal id used by ExtensionViewer routing), and the
        // system Last Updated / Created timestamps (redundant w/ Generated).
        // Users can toggle any of these visible from the column menu.
        // `columns` snapshots the "known at save time" set so schema additions
        // later stay visible by default.
        const knownColumns = reportsColumns.map((c) => c.name);
        const visibleFields = ['Title', 'Report Type', 'Status', 'Visibility', 'Generated', 'Generated by'];
        // Sort / filter shapes follow Wasabi Table conventions:
        //   sort: { field: <displayName>, direction: 'asc'|'desc' }
        //   activeFilters: { <displayName>: [<value>, ...] }   (chip filter shape)
        const baseTableConfig = {
          visibleFields,
          columns: knownColumns,
          sort: { field: 'Generated', direction: 'desc' },
        };
        const reportsConfig = {
          views: [
            { label: 'All Reports', type: 'table', config: { ...baseTableConfig } },
            { label: 'Published', type: 'table', config: {
              ...baseTableConfig,
              activeFilters: { 'Status': ['Published'] },
            }},
            { label: 'Drafts', type: 'table', config: {
              ...baseTableConfig,
              activeFilters: { 'Status': ['Draft'] },
            }},
          ],
          _extensionsReportsDb: true,
        };
        await env.DB.prepare(
          `INSERT INTO page_configs (id, parent_id, title, icon, page_type, sort_order, config, created_by, created_at, updated_at)
           VALUES (?, NULL, 'Reports', 'document', 'database', 9999, ?, NULL, datetime('now'), datetime('now'))
           ON CONFLICT(id) DO UPDATE SET
             config = excluded.config,
             updated_at = datetime('now')`
        ).bind(reportsPageId, JSON.stringify(reportsConfig)).run();
        await env.DB.prepare(
          `INSERT INTO table_schemas (id, columns, created_at, updated_at)
           VALUES (?, ?, datetime('now'), datetime('now'))
           ON CONFLICT(id) DO UPDATE SET
             columns = excluded.columns,
             updated_at = datetime('now')`
        ).bind(reportsPageId, JSON.stringify(reportsColumns)).run();
        await env.DB.prepare(
          "INSERT INTO connections (key, value, metadata, updated_at) VALUES ('extensions_reports_db_bootstrap', ?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, metadata = excluded.metadata, updated_at = datetime('now')"
        ).bind(REPORTS_BOOTSTRAP_VERSION, JSON.stringify({ page_id: reportsPageId, column_count: reportsColumns.length, visible_count: visibleFields.length })).run();
        console.log(`[extensions] Reports DB bootstrap → ${REPORTS_BOOTSTRAP_VERSION}`);
      }
    } catch (err) {
      console.error('[extensions] Reports DB bootstrap failed:', err.message || err);
    }

    // ─── Inventory Collection extension bootstrap ───
    // Seeds the first Data Collection extension (slug: inventory-collection)
    // on fresh workspaces. Idempotent — only inserts if the row is missing.
    // Config includes the Vendor CRM page id so the item drawer can query it.
    const INVENTORY_BOOTSTRAP_VERSION = 'v1';
    try {
      const invFlag = await env.DB.prepare(
        "SELECT value FROM connections WHERE key = 'inventory_collection_bootstrap'"
      ).first();
      if (invFlag?.value !== INVENTORY_BOOTSTRAP_VERSION) {
        const invExtId = 'ext_inventory_collect';
        const existing = await env.DB.prepare(
          "SELECT id FROM extensions WHERE slug = 'inventory-collection'"
        ).first();
        const invConfig = {
          vendor_crm_page_id: 'b44ace79-05fb-4402-bcba-1f52cef2af97',
          vendor_name_field: 'Vendor Name',
          markets: [
            { key: 'OR',   label: 'Drops OR' },
            { key: 'CA',   label: 'Drops CA' },
            { key: 'NY',   label: 'Drops NY' },
            { key: 'NV',   label: 'Drops NV' },
            { key: 'HEMP', label: 'Drops HEMP' },
          ],
          channels: [
            { key: 'drops',       label: 'Drops',       swatch: '#5CC63A' },
            { key: 'smoky',       label: 'Smoky Flower',swatch: '#C86040' },
            { key: 'drops-hemp',  label: 'Drops Hemp',  swatch: '#9480C4' },
          ],
          pages: [
            { key: 'packaging', label: 'Packaging',           has_categories: true },
            { key: 'kitchen',   label: 'Kitchen & Supplies',  has_categories: false },
            { key: 'sales',     label: 'Sales & Marketing',   has_categories: false },
          ],
          item_types: [
            { key: 'tins',      label: 'Tins' },
            { key: 'mp',        label: 'Masterpacks' },
            { key: 'labels',    label: 'Compliance Labels' },
            { key: 'tamper',    label: 'Tamper Seals' },
            { key: 'cover',     label: 'Cover-up Labels' },
            { key: 'dram',      label: 'Drams' },
            { key: 'paper',     label: 'Paper Packages' },
            { key: 'kitchen',   label: 'Kitchen & Supplies' },
            { key: 'marketing', label: 'Sales & Marketing' },
          ],
        };
        if (!existing) {
          await env.DB.prepare(
            `INSERT INTO extensions
               (id, slug, name, icon, description, definition, html, data_schema, sample_data, theme_preference, version, status, type, ext_config, created_by, created_at, updated_at)
             VALUES (?, 'inventory-collection', 'Inventory', 'inventory', ?, ?, '', '{}', '{}', 'inherit', 1, 'active', 'data_collection', ?, '', datetime('now'), datetime('now'))`
          ).bind(
            invExtId,
            'iPad-optimized inventory workbooks per market. Rows pulled from the shared Master Item Sheet; counts submitted per page.',
            'Data Collection extension. Master Item Sheet is the catalog every market workbook pulls from. Weekly count sheets: Packaging (with Drops / Smoky Flower / Drops Hemp channels), Kitchen & Supplies, Sales & Marketing. Feeds downstream reports (inventory-production-v2).',
            JSON.stringify(invConfig)
          ).run();
          console.log('[extensions] Inventory Collection bootstrap → created extension row');
        } else {
          // Row exists — refresh the ext_config to the canonical shape
          await env.DB.prepare(
            `UPDATE extensions SET ext_config = ?, updated_at = datetime('now') WHERE slug = 'inventory-collection'`
          ).bind(JSON.stringify(invConfig)).run();
          console.log('[extensions] Inventory Collection bootstrap → refreshed ext_config');
        }
        // Sidebar page: a page_config with page_type=data_collection_extension
        // gets routed by App.jsx to DataCollectionView. Config carries the
        // extension slug so the view knows which DC extension to render.
        const invPageId = 'system_inventory_collection';
        const invPageConfig = {
          extension_slug: 'inventory-collection',
          _dataCollectionExtension: true,
          databaseIds: [],
          views: [],
        };
        await env.DB.prepare(
          `INSERT INTO page_configs (id, parent_id, title, icon, page_type, sort_order, config, created_by, created_at, updated_at)
           VALUES (?, NULL, 'Inventory', 'inventory', 'data_collection_extension', 8500, ?, NULL, datetime('now'), datetime('now'))
           ON CONFLICT(id) DO UPDATE SET
             config = excluded.config,
             page_type = excluded.page_type,
             updated_at = datetime('now')`
        ).bind(invPageId, JSON.stringify(invPageConfig)).run();
        await env.DB.prepare(
          "INSERT INTO connections (key, value, metadata, updated_at) VALUES ('inventory_collection_bootstrap', ?, '{}', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
        ).bind(INVENTORY_BOOTSTRAP_VERSION).run();
      }
    } catch (err) {
      console.error('[extensions] Inventory Collection bootstrap failed:', err.message || err);
    }

    // Bootstrap: if no users exist, create a default admin invite
    let adminBootstrap = null;
    try {
      const userCount = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
      if (!userCount || userCount.count === 0) {
        const adminId = crypto.randomUUID();
        const adminCode = crypto.randomUUID().slice(0, 8).toUpperCase();
        await env.DB.prepare(
          "INSERT INTO users (id, display_name, role, invite_code) VALUES (?, 'Admin', 'admin', ?)"
        ).bind(adminId, adminCode).run();
        adminBootstrap = { id: adminId, invite_code: adminCode, role: "admin" };
      }
    } catch {}

    // Backfill: set created_by and page_permissions for existing pages
    try {
      const firstAdmin = await env.DB.prepare(
        "SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL ORDER BY created_at LIMIT 1"
      ).first();
      if (firstAdmin) {
        // Set created_by on pages that don't have it
        await env.DB.prepare(
          "UPDATE page_configs SET created_by = ? WHERE created_by IS NULL"
        ).bind(firstAdmin.id).run();
        // Add owner permissions for all pages that don't have ANY permission entries (batched)
        const allPages = await env.DB.prepare("SELECT id FROM page_configs").all();
        const permStmts = (allPages.results || []).map(page =>
          env.DB.prepare(
            "INSERT OR IGNORE INTO page_permissions (page_id, user_id, permission, granted_by) VALUES (?, ?, 'owner', ?)"
          ).bind(page.id, firstAdmin.id, firstAdmin.id)
        );
        if (permStmts.length > 0) await env.DB.batch(permStmts);
      }
    } catch (_) {}

    // Write schema version so subsequent loads use the fast path
    try {
      await env.DB.prepare(
        "INSERT INTO connections (key, value, metadata, updated_at) VALUES ('schema_version', ?, '{}', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
      ).bind(CURRENT_SCHEMA_VERSION).run();
    } catch {}

    // Return table list
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    ).all();

    // Check if registered users exist (users with password_hash set)
    let multiUserEnabled = false;
    try {
      const registered = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM users WHERE password_hash IS NOT NULL AND deleted_at IS NULL"
      ).first();
      multiUserEnabled = registered && registered.count > 0;
    } catch {}

    return jsonResponse({
      ok: true,
      tables: tables.results.map((t) => t.name),
      message: "Database initialized successfully",
      multi_user: multiUserEnabled,
      ...(adminBootstrap ? { admin_invite: adminBootstrap } : {}),
    });
  } catch (err) {
    return jsonResponse({ _error: `Init failed: ${err.message}` }, 500);
  }
}

async function handleFactoryReset(env, jsonResponse) {
  const userTables = [
    "page_configs", "table_schemas", "table_rows",
    "documents", "automation_rules", "notifications", "knowledge_base",
    "cell_links", "sync_configs", "record_notes", "record_comments",
    "neurons", "neuron_nodes", "users", "user_connections",
    "page_permissions", "audit_log", "pin_sessions",
  ];
  try {
    for (const table of userTables) {
      try { await env.DB.prepare(`DELETE FROM ${table}`).run(); } catch (_) {}
    }
    // Also clear API connections (notion, claude, monday)
    try { await env.DB.prepare("DELETE FROM connections").run(); } catch (_) {}
    // Delete all R2 docs
    try {
      if (env.DOCS) {
        const listed = await env.DOCS.list();
        for (const obj of listed.objects || []) {
          await env.DOCS.delete(obj.key);
        }
      }
    } catch (_) {}
    return jsonResponse({ ok: true, message: "Factory reset complete. All user data erased." });
  } catch (err) {
    return jsonResponse({ _error: `Factory reset failed: ${err.message}` }, 500);
  }
}

export { handleHealth, handleInit, handleFactoryReset };
