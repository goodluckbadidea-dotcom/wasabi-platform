// ─── Init / Health / Factory Reset Handlers ───
// Extracted from worker.js — zero logic changes.

import { D1_SCHEMA, D1_INDEXES, RELATIONSHIP_TYPE_SEEDS } from '../schema.js';

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
  const CURRENT_SCHEMA_VERSION = "5";
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
      "CREATE TABLE IF NOT EXISTS user_dashboards (user_id TEXT PRIMARY KEY, widgets TEXT NOT NULL DEFAULT '[]', updated_at TEXT DEFAULT (datetime('now')))",
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
      // Microsoft SSO: email column on users for identity linking
      "ALTER TABLE users ADD COLUMN email TEXT",
      "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
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
