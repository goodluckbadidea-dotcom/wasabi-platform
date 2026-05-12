// ─── MCP Workspace Context ───
// Single-call endpoint that returns everything an external AI client (Cowork,
// Claude Desktop, custom MCP host) needs to understand the workspace without
// making N follow-up calls. Mirrors the in-app `agentContext` shape: pages
// with schemas + row counts, KB summary, integration status, recent activity.
//
// GET /mcp/context?row_counts=true&schemas=true&kb=true&activity=true&integrations=true

import { safeParseJSON } from '../utils.js';

const DEFAULT_KB_LIMIT = 30;
const DEFAULT_ACTIVITY_LIMIT = 20;

export async function handleMcpContext(request, env, user, jsonResponse) {
  const url = new URL(request.url);
  const includeRowCounts = url.searchParams.get("row_counts") !== "false";
  const includeSchemas = url.searchParams.get("schemas") !== "false";
  const includeKb = url.searchParams.get("kb") !== "false";
  const includeActivity = url.searchParams.get("activity") !== "false";
  const includeIntegrations = url.searchParams.get("integrations") !== "false";
  const kbLimit = Math.min(parseInt(url.searchParams.get("kb_limit"), 10) || DEFAULT_KB_LIMIT, 200);
  const activityLimit = Math.min(parseInt(url.searchParams.get("activity_limit"), 10) || DEFAULT_ACTIVITY_LIMIT, 100);

  const ctx = {
    timestamp: new Date().toISOString(),
    user: user ? { id: user.sub, role: user.role, name: user.name || null } : null,
    workspace: { name: "Wasabi" },
  };

  // ── Pages with schemas + row counts ──
  try {
    const pagesRes = await env.DB.prepare(
      "SELECT id, parent_id, title, icon, page_type, sort_order, config, created_at, updated_at FROM page_configs ORDER BY sort_order, created_at"
    ).all();
    const pageRows = pagesRes?.results || [];

    let schemaMap = {};
    if (includeSchemas && pageRows.length > 0) {
      const schemaRes = await env.DB.prepare(
        "SELECT id, columns FROM table_schemas"
      ).all();
      for (const s of schemaRes?.results || []) {
        schemaMap[s.id] = safeParseJSON(s.columns);
      }
    }

    let rowCountMap = {};
    if (includeRowCounts && pageRows.length > 0) {
      const countRes = await env.DB.prepare(
        "SELECT table_id, COUNT(*) AS total, SUM(CASE WHEN parent_row_id IS NULL THEN 1 ELSE 0 END) AS top_level FROM table_rows WHERE archived = 0 GROUP BY table_id"
      ).all();
      for (const c of countRes?.results || []) {
        rowCountMap[c.table_id] = { total: c.total, top_level: c.top_level, sub_items: c.total - c.top_level };
      }
    }

    ctx.pages = pageRows.map((p) => {
      const config = safeParseJSON(p.config);
      const views = Array.isArray(config?.views) ? config.views : [];
      const out = {
        id: p.id,
        parent_id: p.parent_id || null,
        title: p.title,
        icon: p.icon || "",
        page_type: p.page_type,
        view_count: views.length,
        view_types: views.map((v) => v?.type).filter(Boolean),
        view_labels: views.map((v) => v?.label || v?.type).filter(Boolean),
      };
      if (includeRowCounts && rowCountMap[p.id]) {
        out.row_count = rowCountMap[p.id].total;
        out.top_level_count = rowCountMap[p.id].top_level;
        out.sub_item_count = rowCountMap[p.id].sub_items;
      } else if (includeRowCounts && p.page_type === "database") {
        out.row_count = 0;
      }
      if (includeSchemas && schemaMap[p.id]) {
        out.columns = schemaMap[p.id].map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          options: Array.isArray(c.options) ? c.options.map((o) => o.label || o.name).slice(0, 20) : undefined,
        }));
      }
      return out;
    });
    ctx.page_count = ctx.pages.length;
    ctx.database_count = ctx.pages.filter((p) => p.page_type === "database").length;
  } catch (err) {
    ctx.pages = [];
    ctx._pages_error = err?.message || String(err);
  }

  // ── Knowledge base summary ──
  if (includeKb) {
    try {
      const res = await env.DB.prepare(
        "SELECT id, key, category, content, source, created_at FROM knowledge_base ORDER BY created_at DESC LIMIT ?"
      ).bind(kbLimit).all();
      ctx.knowledge_base = (res?.results || []).map((k) => ({
        id: k.id,
        key: k.key,
        category: k.category,
        content: typeof k.content === "string" && k.content.length > 400 ? k.content.slice(0, 400) + "…" : k.content,
        source: k.source,
        created_at: k.created_at,
      }));
      const categoriesRes = await env.DB.prepare(
        "SELECT category, COUNT(*) AS count FROM knowledge_base GROUP BY category ORDER BY count DESC"
      ).all();
      ctx.kb_categories = (categoriesRes?.results || []).map((c) => ({ category: c.category, count: c.count }));
    } catch (err) {
      ctx.knowledge_base = [];
      ctx._kb_error = err?.message || String(err);
    }
  }

  // ── Integration status ──
  if (includeIntegrations) {
    ctx.integrations = {};
    const services = [
      { key: "claude", label: "claude" },
      { key: "notion", label: "notion" },
      { key: "monday", label: "monday" },
      { key: "figma", label: "figma" },
    ];
    for (const s of services) {
      try {
        const row = await env.DB.prepare("SELECT key FROM connections WHERE key = ?").bind(s.key).first();
        ctx.integrations[s.label] = { connected: !!row };
      } catch {
        ctx.integrations[s.label] = { connected: false };
      }
    }
    // Per-user OAuth integrations (Google + Microsoft) — stored in user_connections
    // (user_id, key='google'|'microsoft', value=encrypted token bundle).
    if (user?.sub) {
      try {
        const guc = await env.DB.prepare(
          "SELECT 1 FROM user_connections WHERE user_id = ? AND key = 'google' LIMIT 1"
        ).bind(user.sub).first();
        ctx.integrations.google = { connected: !!guc };
      } catch { ctx.integrations.google = { connected: false }; }
      try {
        const muc = await env.DB.prepare(
          "SELECT 1 FROM user_connections WHERE user_id = ? AND key = 'microsoft' LIMIT 1"
        ).bind(user.sub).first();
        ctx.integrations.microsoft = { connected: !!muc };
      } catch { ctx.integrations.microsoft = { connected: false }; }
    } else {
      // Fallback: report any user with a connected token (workspace-level visibility)
      try {
        const gAny = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM user_connections WHERE key = 'google'"
        ).first();
        ctx.integrations.google = { connected: (gAny?.n || 0) > 0, _user_count: gAny?.n || 0 };
      } catch { ctx.integrations.google = { connected: false }; }
      try {
        const mAny = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM user_connections WHERE key = 'microsoft'"
        ).first();
        ctx.integrations.microsoft = { connected: (mAny?.n || 0) > 0, _user_count: mAny?.n || 0 };
      } catch { ctx.integrations.microsoft = { connected: false }; }
    }
  }

  // ── Recent activity (record views + notifications + audit log) ──
  if (includeActivity) {
    try {
      const taskRes = await env.DB.prepare(
        "SELECT user_id, record_id, last_viewed_at FROM record_views ORDER BY last_viewed_at DESC LIMIT ?"
      ).bind(activityLimit).all();
      ctx.recent_record_views = taskRes?.results || [];
    } catch {
      ctx.recent_record_views = [];
    }
    try {
      const notifRes = await env.DB.prepare(
        "SELECT id, message, type, status, source, record_id, record_name, page_config_id, page_name, actor_name, target_user_id, created_at FROM notifications ORDER BY created_at DESC LIMIT ?"
      ).bind(activityLimit).all();
      ctx.recent_notifications = notifRes?.results || [];
    } catch {
      ctx.recent_notifications = [];
    }
    try {
      const auditRes = await env.DB.prepare(
        "SELECT id, user_id, user_name, action, resource_type, resource_id, details, created_at FROM audit_log ORDER BY created_at DESC LIMIT ?"
      ).bind(activityLimit).all();
      ctx.recent_audit_log = (auditRes?.results || []).map((r) => ({ ...r, details: safeParseJSON(r.details) }));
    } catch {
      ctx.recent_audit_log = [];
    }
  }

  // ── Users in workspace ──
  try {
    const usersRes = await env.DB.prepare(
      "SELECT id, display_name, role, deleted_at FROM users WHERE deleted_at IS NULL ORDER BY role DESC, display_name"
    ).all();
    ctx.users = (usersRes?.results || []).map((u) => ({ id: u.id, display_name: u.display_name, role: u.role }));
    ctx.user_count = ctx.users.length;
  } catch (err) {
    ctx.users = [];
    ctx._users_error = err?.message || String(err);
  }

  return jsonResponse(ctx);
}
