// ─── Wasabi Platform Cloudflare Worker ───
// Backend with D1 storage, optional Notion + Claude proxy.
// Auth via shared secret (X-Wasabi-Key header).

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const CLAUDE_API = "https://api.anthropic.com/v1/messages";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Claude-Key, X-Wasabi-Key",
};

// ─── D1 Schema ───
const D1_SCHEMA = `
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
  sort_order INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sheet_data (
  id TEXT PRIMARY KEY,
  col_count INTEGER DEFAULT 26,
  row_count INTEGER DEFAULT 100,
  cells TEXT NOT NULL DEFAULT '{}',
  col_widths TEXT DEFAULT '{}',
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

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'notification',
  status TEXT DEFAULT 'unread',
  source TEXT DEFAULT '',
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
  created_at TEXT DEFAULT (datetime('now'))
);

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
`;

const D1_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_rows_table ON table_rows(table_id, archived);
CREATE INDEX IF NOT EXISTS idx_notif_status ON notifications(status);
`;

// ─── Auth Middleware ───
function authenticate(request, env) {
  const secret = env.WASABI_SECRET;
  // If no secret is configured, allow all requests (first-time setup)
  if (!secret) return true;
  const provided = request.headers.get("X-Wasabi-Key");
  return provided === secret;
}

// ─── Get Notion key: from D1 connections or request header ───
async function getNotionKey(request, env) {
  // First try the request header (backward compat)
  const headerKey = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (headerKey) return headerKey;
  // Then try D1 connections table
  try {
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'notion'").first();
    return row?.value || null;
  } catch {
    return null;
  }
}

// ─── Get Claude key: from D1 connections or request header ───
async function getClaudeKey(request, body, env) {
  // First try the request header/body (backward compat)
  const headerKey = request.headers.get("X-Claude-Key") || body?.claudeKey;
  if (headerKey) return headerKey;
  // Then try D1 connections table
  try {
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'claude'").first();
    return row?.value || null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ─── Public Routes (no auth required) ───

      // Health check
      if (path === "/health" && request.method === "GET") {
        return await handleHealth(env);
      }

      // ─── Auth Gate ───
      if (!authenticate(request, env)) {
        return jsonResponse({ _error: "Unauthorized" }, 401);
      }

      // ─── D1 Bootstrap ───
      if (path === "/init" && request.method === "POST") {
        return await handleInit(env);
      }

      // ─── Connections CRUD ───
      if (path === "/connections" && request.method === "GET") {
        return await handleGetConnections(env);
      }
      if (path === "/connections" && request.method === "POST") {
        const body = await request.json();
        return await handleSetConnection(env, body);
      }
      if (path.startsWith("/connections/") && request.method === "DELETE") {
        const key = path.split("/connections/")[1];
        return await handleDeleteConnection(env, key);
      }

      // ─── Page Config CRUD ───
      // Schema routes matched before single-page routes to avoid ID collision
      const schemaMatch = path.match(/^\/pages\/([^/]+)\/schema$/);
      if (schemaMatch) {
        const id = schemaMatch[1];
        if (request.method === "GET") return await handleGetSchema(env, id);
        if (request.method === "PATCH") {
          const body = await request.json();
          return await handleUpdateSchema(env, id, body);
        }
      }

      if (path === "/pages" && request.method === "GET") {
        return await handleListPages(env);
      }
      if (path === "/pages" && request.method === "POST") {
        const body = await request.json();
        return await handleCreatePage(env, body);
      }
      const pageConfigMatch = path.match(/^\/pages\/([^/]+)$/);
      if (pageConfigMatch) {
        const id = pageConfigMatch[1];
        if (request.method === "GET") return await handleGetPage(env, id);
        if (request.method === "PATCH") {
          const body = await request.json();
          return await handleUpdatePage(env, id, body);
        }
        if (request.method === "DELETE") return await handleDeletePage(env, id);
      }

      // ─── Table Row CRUD ───
      // Single-row routes matched before collection routes
      const rowMatch = path.match(/^\/tables\/([^/]+)\/rows\/([^/]+)$/);
      if (rowMatch) {
        const [, tableId, rowId] = rowMatch;
        if (request.method === "PATCH") {
          const body = await request.json();
          return await handleUpdateRow(env, tableId, rowId, body);
        }
        if (request.method === "DELETE") return await handleDeleteRow(env, tableId, rowId);
      }

      const tableRowsMatch = path.match(/^\/tables\/([^/]+)\/rows$/);
      if (tableRowsMatch) {
        const tableId = tableRowsMatch[1];
        if (request.method === "GET") return await handleListRows(env, tableId, url);
        if (request.method === "POST") {
          const body = await request.json();
          return await handleCreateRows(env, tableId, body);
        }
      }

      const queryMatch = path.match(/^\/tables\/([^/]+)\/query$/);
      if (queryMatch && request.method === "POST") {
        const tableId = queryMatch[1];
        const body = await request.json();
        return await handleQueryTable(env, tableId, body);
      }

      // ─── Sheet Routes ───
      const sheetFormulaMatch = path.match(/^\/sheets\/([^/]+)\/formula$/);
      if (sheetFormulaMatch && request.method === "POST") {
        const id = sheetFormulaMatch[1];
        const body = await request.json();
        return await handleSheetFormula(env, id, body);
      }

      const sheetResizeMatch = path.match(/^\/sheets\/([^/]+)\/resize$/);
      if (sheetResizeMatch && request.method === "POST") {
        const id = sheetResizeMatch[1];
        const body = await request.json();
        return await handleSheetResize(env, id, body);
      }

      const sheetMatch = path.match(/^\/sheets\/([^/]+)$/);
      if (sheetMatch) {
        const id = sheetMatch[1];
        if (request.method === "GET") return await handleGetSheet(env, id);
        if (request.method === "PATCH") {
          const body = await request.json();
          return await handleUpdateSheet(env, id, body);
        }
      }

      // ─── Document (R2) Routes ───
      const docBlocksMatch = path.match(/^\/docs\/([^/]+)\/blocks$/);
      if (docBlocksMatch && request.method === "PATCH") {
        const id = docBlocksMatch[1];
        const body = await request.json();
        return await handleUpdateDocBlocks(env, id, body);
      }

      const docExportMatch = path.match(/^\/docs\/([^/]+)\/export\/notion$/);
      if (docExportMatch && request.method === "GET") {
        const id = docExportMatch[1];
        return await handleExportDocNotion(env, id);
      }

      const docMatch = path.match(/^\/docs\/([^/]+)$/);
      if (docMatch) {
        const id = docMatch[1];
        if (request.method === "GET") return await handleGetDoc(env, id);
        if (request.method === "PUT") {
          const body = await request.json();
          return await handleSaveDoc(env, id, body);
        }
      }

      // ─── Notion Routes ───
      const notionKey = await getNotionKey(request, env);

      // Query database (with pagination)
      if (path === "/query" && request.method === "POST") {
        const body = await request.json();
        return await notionFetch(`/databases/${body.database_id}/query`, "POST", notionKey, {
          filter: body.filter,
          sorts: body.sorts,
          start_cursor: body.start_cursor,
          page_size: body.page_size || 100,
        });
      }

      // Get page
      if (path.startsWith("/page/") && request.method === "GET") {
        const pageId = path.split("/page/")[1];
        return await notionFetch(`/pages/${pageId}`, "GET", notionKey);
      }

      // Create page
      if (path === "/page" && request.method === "POST") {
        const body = await request.json();
        return await notionFetch("/pages", "POST", notionKey, body);
      }

      // Update page
      if (path.startsWith("/page/") && request.method === "PATCH") {
        const pageId = path.split("/page/")[1];
        const body = await request.json();
        return await notionFetch(`/pages/${pageId}`, "PATCH", notionKey, body);
      }

      // Get database schema
      if (path.startsWith("/database/") && request.method === "GET") {
        const dbId = path.split("/database/")[1];
        return await notionFetch(`/databases/${dbId}`, "GET", notionKey);
      }

      // Create database
      if (path === "/create-database" && request.method === "POST") {
        const body = await request.json();
        return await notionFetch("/databases", "POST", notionKey, body);
      }

      // Update database (schema / title)
      if (path.startsWith("/database/") && request.method === "PATCH") {
        const dbId = path.split("/database/")[1];
        const body = await request.json();
        return await notionFetch(`/databases/${dbId}`, "PATCH", notionKey, body);
      }

      // Update single block
      if (path.startsWith("/block/") && request.method === "PATCH") {
        const blockId = path.split("/block/")[1];
        const body = await request.json();
        return await notionFetch(`/blocks/${blockId}`, "PATCH", notionKey, body);
      }

      // Delete single block
      if (path.startsWith("/block/") && request.method === "DELETE") {
        const blockId = path.split("/block/")[1];
        return await notionFetch(`/blocks/${blockId}`, "DELETE", notionKey);
      }

      // Get blocks
      if (path.startsWith("/blocks/") && request.method === "GET") {
        const blockId = path.split("/blocks/")[1];
        return await notionFetch(`/blocks/${blockId}/children?page_size=100`, "GET", notionKey);
      }

      // Append blocks
      if (path.startsWith("/blocks/") && request.method === "PATCH") {
        const blockId = path.split("/blocks/")[1];
        const body = await request.json();
        return await notionFetch(`/blocks/${blockId}/children`, "PATCH", notionKey, body);
      }

      // Search
      if (path === "/search" && request.method === "POST") {
        const body = await request.json();
        return await notionFetch("/search", "POST", notionKey, body);
      }

      // Test Notion connection
      if (path === "/test" && request.method === "GET") {
        return await notionFetch("/users/me", "GET", notionKey);
      }

      // ─── Claude API ───
      if (path === "/claude" && request.method === "POST") {
        const body = await request.json();
        const claudeKey = await getClaudeKey(request, body, env);
        if (!claudeKey) {
          return jsonResponse({ _error: "Missing Claude API key" }, 400);
        }
        // Remove claudeKey from body before forwarding
        delete body.claudeKey;
        return await claudeFetch(claudeKey, body);
      }

      // ─── File proxy (download Notion files as base64) ───
      if (path === "/fetch-file" && request.method === "POST") {
        const { url: fileUrl } = await request.json();
        if (!fileUrl) return jsonResponse({ _error: "Missing file URL" }, 400);

        const fileRes = await fetch(fileUrl);
        if (!fileRes.ok) return jsonResponse({ _error: `File fetch failed: ${fileRes.status}` }, 502);

        const buffer = await fileRes.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
        const contentType = fileRes.headers.get("Content-Type") || "application/octet-stream";

        return jsonResponse({ base64, contentType, size: buffer.byteLength });
      }

      // ─── Linked Sheet proxy (fetch + parse CSV with caching) ───
      if (path === "/sheets/fetch" && request.method === "POST") {
        const { url: sheetUrl } = await request.json();
        if (!sheetUrl) return jsonResponse({ _error: "Missing sheet URL" }, 400);
        if (!sheetUrl.startsWith("https://")) return jsonResponse({ _error: "Only HTTPS URLs are supported" }, 400);

        let fetchUrl = sheetUrl;
        let sheetType = "csv";
        const gMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
        if (gMatch) {
          sheetType = "google_sheets";
          fetchUrl = `https://docs.google.com/spreadsheets/d/${gMatch[1]}/gviz/tq?tqx=out:csv`;
        }

        const cacheKey = new Request(`https://wasabi-cache.internal/sheets/${encodeURIComponent(sheetUrl)}`, { method: "GET" });
        const cache = caches.default;
        const cached = await cache.match(cacheKey);
        if (cached) return cached;

        const csvRes = await fetch(fetchUrl, { headers: { "User-Agent": "Wasabi-Platform/1.0" } });
        if (!csvRes.ok) {
          const status = csvRes.status;
          const msg = status === 401 || status === 403
            ? "This sheet is not publicly accessible. Make sure it is shared via 'Anyone with the link can view'."
            : `Failed to fetch sheet data (${status})`;
          return jsonResponse({ _error: msg }, 502);
        }
        const csvText = await csvRes.text();

        const { columns, rows } = parseCSV(csvText);
        const result = { columns, rows: rows.slice(0, 10000), cachedAt: Date.now(), sheetType, truncated: rows.length > 10000 };

        const response = jsonResponse(result);
        const cachedResponse = new Response(response.body, response);
        cachedResponse.headers.set("Cache-Control", "public, max-age=300");
        await cache.put(cacheKey, cachedResponse.clone());

        return cachedResponse;
      }

      // 404
      return jsonResponse({ error: "Not found", path }, 404);

    } catch (err) {
      return jsonResponse({ _error: err.message || "Internal server error" }, 500);
    }
  },
};

// ─── Route Handlers ───

async function handleHealth(env) {
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

async function handleInit(env) {
  const statements = D1_SCHEMA.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  const indexStatements = D1_INDEXES.split(";").map((s) => s.trim()).filter((s) => s.length > 0);

  try {
    // Create tables
    for (const sql of statements) {
      await env.DB.prepare(sql).run();
    }
    // Create indexes
    for (const sql of indexStatements) {
      await env.DB.prepare(sql).run();
    }

    // Return table list
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    ).all();

    return jsonResponse({
      ok: true,
      tables: tables.results.map((t) => t.name),
      message: "Database initialized successfully",
    });
  } catch (err) {
    return jsonResponse({ _error: `Init failed: ${err.message}` }, 500);
  }
}

async function handleGetConnections(env) {
  try {
    const rows = await env.DB.prepare(
      "SELECT key, metadata, updated_at FROM connections ORDER BY key"
    ).all();
    // Never expose actual API key values — just metadata
    return jsonResponse({
      connections: rows.results.map((r) => ({
        key: r.key,
        metadata: JSON.parse(r.metadata || "{}"),
        updated_at: r.updated_at,
        connected: true,
      })),
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleSetConnection(env, body) {
  const { key, value, metadata } = body;
  if (!key || !value) {
    return jsonResponse({ _error: "Missing key or value" }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO connections (key, value, metadata, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, metadata = excluded.metadata, updated_at = datetime('now')`
    ).bind(key, value, JSON.stringify(metadata || {})).run();

    return jsonResponse({ ok: true, key });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleDeleteConnection(env, key) {
  if (!key) return jsonResponse({ _error: "Missing connection key" }, 400);

  try {
    await env.DB.prepare("DELETE FROM connections WHERE key = ?").bind(key).run();
    return jsonResponse({ ok: true, key });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Page Config Handlers ───

async function handleListPages(env) {
  try {
    const rows = await env.DB.prepare(
      "SELECT * FROM page_configs ORDER BY sort_order, created_at"
    ).all();
    // Parse JSON config for each page
    const pages = rows.results.map((r) => ({
      ...r,
      config: JSON.parse(r.config || "{}"),
    }));
    return jsonResponse({ pages });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleCreatePage(env, body) {
  const { title, icon, page_type, parent_id, sort_order, config, columns } = body;
  if (!title || !page_type) {
    return jsonResponse({ _error: "Missing title or page_type" }, 400);
  }

  const id = body.id || crypto.randomUUID();

  try {
    await env.DB.prepare(
      `INSERT INTO page_configs (id, parent_id, title, icon, page_type, sort_order, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(
      id,
      parent_id || null,
      title,
      icon || "",
      page_type,
      sort_order || 0,
      JSON.stringify(config || {})
    ).run();

    // If this is a standalone database, create the table schema
    if (page_type === "database" && columns) {
      await env.DB.prepare(
        `INSERT INTO table_schemas (id, columns, created_at, updated_at)
         VALUES (?, ?, datetime('now'), datetime('now'))`
      ).bind(id, JSON.stringify(columns)).run();
    }

    // If this is a sheet, initialize sheet_data
    if (page_type === "sheet") {
      const colCount = body.col_count || 26;
      const rowCount = body.row_count || 100;
      await env.DB.prepare(
        `INSERT INTO sheet_data (id, col_count, row_count, cells, col_widths, created_at, updated_at)
         VALUES (?, ?, ?, '{}', '{}', datetime('now'), datetime('now'))`
      ).bind(id, colCount, rowCount).run();
    }

    // If this is a standalone document, initialize document metadata + R2 content
    if (page_type === "document" && !config?.notionPageId) {
      const r2Key = `docs/${id}.json`;
      const initialContent = { version: 1, blocks: [] };
      await env.DOCS.put(r2Key, JSON.stringify(initialContent), {
        httpMetadata: { contentType: "application/json" },
      });
      await env.DB.prepare(
        `INSERT INTO documents (id, r2_key, version, word_count, created_at, updated_at)
         VALUES (?, ?, 1, 0, datetime('now'), datetime('now'))`
      ).bind(id, r2Key).run();
    }

    return jsonResponse({ ok: true, id }, 201);
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleGetPage(env, id) {
  try {
    const row = await env.DB.prepare("SELECT * FROM page_configs WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ _error: "Page not found" }, 404);
    return jsonResponse({ ...row, config: JSON.parse(row.config || "{}") });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUpdatePage(env, id, body) {
  const sets = [];
  const binds = [];

  if (body.title !== undefined) { sets.push("title = ?"); binds.push(body.title); }
  if (body.icon !== undefined) { sets.push("icon = ?"); binds.push(body.icon); }
  if (body.parent_id !== undefined) { sets.push("parent_id = ?"); binds.push(body.parent_id); }
  if (body.page_type !== undefined) { sets.push("page_type = ?"); binds.push(body.page_type); }
  if (body.sort_order !== undefined) { sets.push("sort_order = ?"); binds.push(body.sort_order); }
  if (body.config !== undefined) { sets.push("config = ?"); binds.push(JSON.stringify(body.config)); }

  if (sets.length === 0) return jsonResponse({ _error: "No fields to update" }, 400);

  sets.push("updated_at = datetime('now')");
  binds.push(id);

  try {
    await env.DB.prepare(
      `UPDATE page_configs SET ${sets.join(", ")} WHERE id = ?`
    ).bind(...binds).run();
    return jsonResponse({ ok: true, id });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleDeletePage(env, id) {
  try {
    // Delete page config
    await env.DB.prepare("DELETE FROM page_configs WHERE id = ?").bind(id).run();
    // Remove child pages (pages in folder, sub-pages)
    await env.DB.prepare("DELETE FROM page_configs WHERE parent_id = ?").bind(id).run();
    // Remove table schema if exists
    await env.DB.prepare("DELETE FROM table_schemas WHERE id = ?").bind(id).run();
    // Remove table rows if exists
    await env.DB.prepare("DELETE FROM table_rows WHERE table_id = ?").bind(id).run();
    // Remove sheet data if exists
    await env.DB.prepare("DELETE FROM sheet_data WHERE id = ?").bind(id).run();
    // Remove document metadata + R2 content if exists
    const docMeta = await env.DB.prepare("SELECT r2_key FROM documents WHERE id = ?").bind(id).first();
    if (docMeta?.r2_key) {
      try { await env.DOCS.delete(docMeta.r2_key); } catch {}
    }
    await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(id).run();
    return jsonResponse({ ok: true, id });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Table Schema Handlers ───

async function handleGetSchema(env, id) {
  try {
    const row = await env.DB.prepare("SELECT * FROM table_schemas WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ _error: "Schema not found" }, 404);
    return jsonResponse({ ...row, columns: JSON.parse(row.columns) });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUpdateSchema(env, id, body) {
  if (!body.columns) return jsonResponse({ _error: "Missing columns" }, 400);

  try {
    await env.DB.prepare(
      `INSERT INTO table_schemas (id, columns, created_at, updated_at)
       VALUES (?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(id) DO UPDATE SET columns = excluded.columns, updated_at = datetime('now')`
    ).bind(id, JSON.stringify(body.columns)).run();
    return jsonResponse({ ok: true, id });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Table Row Handlers ───

async function handleListRows(env, tableId, url) {
  const limit = Math.min(parseInt(url.searchParams.get("limit")) || 100, 10000);
  const offset = parseInt(url.searchParams.get("offset")) || 0;
  const includeArchived = url.searchParams.get("archived") === "true";

  try {
    let sql = "SELECT * FROM table_rows WHERE table_id = ?";
    if (!includeArchived) sql += " AND archived = 0";
    sql += " ORDER BY sort_order, created_at";
    sql += ` LIMIT ${limit} OFFSET ${offset}`;

    const rows = await env.DB.prepare(sql).bind(tableId).all();

    const parsed = rows.results.map((r) => ({
      ...r,
      cells: JSON.parse(r.cells || "{}"),
      metadata: JSON.parse(r.metadata || "{}"),
    }));

    return jsonResponse({ rows: parsed, has_more: rows.results.length === limit });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleCreateRows(env, tableId, body) {
  const rows = Array.isArray(body.rows) ? body.rows : [body];
  const created = [];

  try {
    for (const row of rows) {
      const id = row.id || crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO table_rows (id, table_id, cells, sort_order, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(
        id,
        tableId,
        JSON.stringify(row.cells || {}),
        row.sort_order || 0,
        JSON.stringify(row.metadata || {})
      ).run();
      created.push(id);
    }
    return jsonResponse({ ok: true, ids: created }, 201);
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUpdateRow(env, tableId, rowId, body) {
  const sets = [];
  const binds = [];

  try {
    if (body.cells !== undefined) {
      if (body.merge_cells) {
        // Merge mode: read existing cells, merge with new, write back
        const existing = await env.DB.prepare(
          "SELECT cells FROM table_rows WHERE id = ? AND table_id = ?"
        ).bind(rowId, tableId).first();
        const currentCells = existing ? JSON.parse(existing.cells || "{}") : {};
        const merged = { ...currentCells, ...body.cells };
        sets.push("cells = ?"); binds.push(JSON.stringify(merged));
      } else {
        sets.push("cells = ?"); binds.push(JSON.stringify(body.cells));
      }
    }
    if (body.sort_order !== undefined) { sets.push("sort_order = ?"); binds.push(body.sort_order); }
    if (body.archived !== undefined) { sets.push("archived = ?"); binds.push(body.archived ? 1 : 0); }
    if (body.metadata !== undefined) { sets.push("metadata = ?"); binds.push(JSON.stringify(body.metadata)); }

    if (sets.length === 0) return jsonResponse({ _error: "No fields to update" }, 400);

    sets.push("updated_at = datetime('now')");
    binds.push(rowId, tableId);

    await env.DB.prepare(
      `UPDATE table_rows SET ${sets.join(", ")} WHERE id = ? AND table_id = ?`
    ).bind(...binds).run();
    return jsonResponse({ ok: true, id: rowId });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleDeleteRow(env, tableId, rowId) {
  try {
    await env.DB.prepare(
      "UPDATE table_rows SET archived = 1, updated_at = datetime('now') WHERE id = ? AND table_id = ?"
    ).bind(rowId, tableId).run();
    return jsonResponse({ ok: true, id: rowId });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleQueryTable(env, tableId, body) {
  try {
    const limit = Math.min(body.limit || 1000, 10000);
    const offset = body.offset || 0;

    const rows = await env.DB.prepare(
      `SELECT * FROM table_rows WHERE table_id = ? AND archived = 0
       ORDER BY sort_order, created_at LIMIT ${limit} OFFSET ${offset}`
    ).bind(tableId).all();

    let parsed = rows.results.map((r) => ({
      ...r,
      cells: JSON.parse(r.cells || "{}"),
      metadata: JSON.parse(r.metadata || "{}"),
    }));

    // Apply filters on JSON cells (worker-side)
    if (body.filters && body.filters.length > 0) {
      parsed = applyRowFilters(parsed, body.filters);
    }

    // Apply sorts on JSON cells (worker-side)
    if (body.sorts && body.sorts.length > 0) {
      parsed = applyRowSorts(parsed, body.sorts);
    }

    return jsonResponse({ rows: parsed, total: parsed.length });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Sheet Handlers ───

async function handleGetSheet(env, id) {
  try {
    const row = await env.DB.prepare("SELECT * FROM sheet_data WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ _error: "Sheet not found" }, 404);
    return jsonResponse({
      ...row,
      cells: JSON.parse(row.cells || "{}"),
      col_widths: JSON.parse(row.col_widths || "{}"),
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUpdateSheet(env, id, body) {
  try {
    // Merge mode: read existing cells, merge with incoming
    if (body.cells) {
      const existing = await env.DB.prepare("SELECT cells FROM sheet_data WHERE id = ?").bind(id).first();
      if (!existing) return jsonResponse({ _error: "Sheet not found" }, 404);
      const currentCells = JSON.parse(existing.cells || "{}");
      // Merge: incoming cells override existing ones
      const merged = { ...currentCells };
      for (const [key, val] of Object.entries(body.cells)) {
        if (val === null || val === undefined) {
          delete merged[key]; // null = clear cell
        } else {
          merged[key] = val;
        }
      }
      await env.DB.prepare(
        "UPDATE sheet_data SET cells = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(JSON.stringify(merged), id).run();
    }

    if (body.col_widths) {
      const existing = await env.DB.prepare("SELECT col_widths FROM sheet_data WHERE id = ?").bind(id).first();
      const currentWidths = JSON.parse(existing?.col_widths || "{}");
      const mergedWidths = { ...currentWidths, ...body.col_widths };
      await env.DB.prepare(
        "UPDATE sheet_data SET col_widths = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(JSON.stringify(mergedWidths), id).run();
    }

    return jsonResponse({ ok: true, id });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleSheetFormula(env, id, body) {
  const { fn, range, target } = body;
  if (!fn || !range || !target) {
    return jsonResponse({ _error: "Missing fn, range, or target" }, 400);
  }

  try {
    const row = await env.DB.prepare("SELECT cells FROM sheet_data WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ _error: "Sheet not found" }, 404);
    const cells = JSON.parse(row.cells || "{}");

    // Parse range (e.g., "A2:A10")
    const rangeValues = parseCellRange(range, cells);
    const nums = rangeValues.map(Number).filter((n) => !isNaN(n));

    let result;
    switch (fn.toUpperCase()) {
      case "SUM":
        result = nums.reduce((a, b) => a + b, 0);
        break;
      case "AVG":
      case "AVERAGE":
        result = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        break;
      case "COUNT":
        result = rangeValues.filter((v) => v !== null && v !== undefined && v !== "").length;
        break;
      case "MIN":
        result = nums.length > 0 ? Math.min(...nums) : 0;
        break;
      case "MAX":
        result = nums.length > 0 ? Math.max(...nums) : 0;
        break;
      case "CONCAT":
        result = rangeValues.join("");
        break;
      default:
        return jsonResponse({ _error: `Unknown function: ${fn}` }, 400);
    }

    // Store result + formula in target cell
    cells[target] = { v: result, f: `${fn.toUpperCase()}(${range})` };

    await env.DB.prepare(
      "UPDATE sheet_data SET cells = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(JSON.stringify(cells), id).run();

    return jsonResponse({ ok: true, target, value: result, formula: `${fn.toUpperCase()}(${range})` });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleSheetResize(env, id, body) {
  const sets = [];
  const binds = [];

  if (body.col_count !== undefined) { sets.push("col_count = ?"); binds.push(body.col_count); }
  if (body.row_count !== undefined) { sets.push("row_count = ?"); binds.push(body.row_count); }

  if (sets.length === 0) return jsonResponse({ _error: "No dimensions to update" }, 400);

  sets.push("updated_at = datetime('now')");
  binds.push(id);

  try {
    await env.DB.prepare(
      `UPDATE sheet_data SET ${sets.join(", ")} WHERE id = ?`
    ).bind(...binds).run();
    return jsonResponse({ ok: true, id });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Sheet Helper: Parse Cell Range ───

function parseCellRange(range, cells) {
  // Parse "A2:A10" → list of cell values
  const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!match) return [];

  const [, startCol, startRow, endCol, endRow] = match;
  const values = [];

  const sc = colToIndex(startCol.toUpperCase());
  const ec = colToIndex(endCol.toUpperCase());
  const sr = parseInt(startRow);
  const er = parseInt(endRow);

  for (let c = sc; c <= ec; c++) {
    for (let r = sr; r <= er; r++) {
      const key = indexToCol(c) + r;
      const cell = cells[key];
      if (cell !== undefined && cell !== null) {
        // Cell can be { v: value, f?: formula } or plain value
        values.push(typeof cell === "object" ? cell.v : cell);
      }
    }
  }
  return values;
}

function colToIndex(col) {
  let idx = 0;
  for (let i = 0; i < col.length; i++) {
    idx = idx * 26 + (col.charCodeAt(i) - 64);
  }
  return idx;
}

function indexToCol(idx) {
  let col = "";
  while (idx > 0) {
    const rem = (idx - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    idx = Math.floor((idx - 1) / 26);
  }
  return col;
}

// ─── Document (R2) Handlers ───

async function handleGetDoc(env, id) {
  try {
    // Get metadata from D1
    const meta = await env.DB.prepare("SELECT * FROM documents WHERE id = ?").bind(id).first();
    if (!meta) return jsonResponse({ _error: "Document not found" }, 404);

    // Get content from R2
    const r2Key = meta.r2_key || `docs/${id}.json`;
    const obj = await env.DOCS.get(r2Key);
    let content = { version: 1, blocks: [] };
    if (obj) {
      const text = await obj.text();
      content = JSON.parse(text);
    }

    return jsonResponse({
      id: meta.id,
      version: meta.version,
      word_count: meta.word_count,
      created_at: meta.created_at,
      updated_at: meta.updated_at,
      content,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleSaveDoc(env, id, body) {
  const { content } = body;
  if (!content) return jsonResponse({ _error: "Missing content" }, 400);

  const r2Key = `docs/${id}.json`;

  try {
    // Calculate word count from blocks
    let wordCount = 0;
    if (content.blocks) {
      for (const block of content.blocks) {
        const text = block.content || "";
        wordCount += text.split(/\s+/).filter(Boolean).length;
      }
    }

    // Save content to R2
    await env.DOCS.put(r2Key, JSON.stringify(content), {
      httpMetadata: { contentType: "application/json" },
    });

    // Upsert D1 metadata
    await env.DB.prepare(
      `INSERT INTO documents (id, r2_key, version, word_count, created_at, updated_at)
       VALUES (?, ?, 1, ?, datetime('now'), datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         version = documents.version + 1,
         word_count = excluded.word_count,
         updated_at = datetime('now')`
    ).bind(id, r2Key, wordCount).run();

    // Get updated metadata
    const meta = await env.DB.prepare("SELECT version, word_count FROM documents WHERE id = ?").bind(id).first();

    return jsonResponse({
      ok: true,
      id,
      version: meta?.version || 1,
      word_count: meta?.word_count || wordCount,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleUpdateDocBlocks(env, id, body) {
  const { updates } = body;
  if (!updates || !Array.isArray(updates)) {
    return jsonResponse({ _error: "Missing updates array" }, 400);
  }

  const r2Key = `docs/${id}.json`;

  try {
    // Read current content
    const obj = await env.DOCS.get(r2Key);
    let content = { version: 1, blocks: [] };
    if (obj) {
      content = JSON.parse(await obj.text());
    }

    // Apply updates
    for (const update of updates) {
      const { action, block, blockId, index } = update;
      switch (action) {
        case "add":
          if (typeof index === "number") {
            content.blocks.splice(index, 0, block);
          } else {
            content.blocks.push(block);
          }
          break;
        case "update":
          content.blocks = content.blocks.map((b) =>
            b.id === blockId ? { ...b, ...block } : b
          );
          break;
        case "delete":
          content.blocks = content.blocks.filter((b) => b.id !== blockId);
          break;
        case "move": {
          const fromIdx = content.blocks.findIndex((b) => b.id === blockId);
          if (fromIdx >= 0 && typeof index === "number") {
            const [item] = content.blocks.splice(fromIdx, 1);
            content.blocks.splice(index, 0, item);
          }
          break;
        }
      }
    }

    // Save updated content
    await env.DOCS.put(r2Key, JSON.stringify(content), {
      httpMetadata: { contentType: "application/json" },
    });

    // Update D1 metadata
    let wordCount = 0;
    for (const block of content.blocks) {
      const text = block.content || "";
      wordCount += text.split(/\s+/).filter(Boolean).length;
    }

    await env.DB.prepare(
      `UPDATE documents SET version = version + 1, word_count = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(wordCount, id).run();

    return jsonResponse({ ok: true, id, blockCount: content.blocks.length });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

async function handleExportDocNotion(env, id) {
  const r2Key = `docs/${id}.json`;

  try {
    const obj = await env.DOCS.get(r2Key);
    if (!obj) return jsonResponse({ _error: "Document not found" }, 404);

    const content = JSON.parse(await obj.text());
    const notionBlocks = (content.blocks || []).map(wasabiBlockToNotion);

    return jsonResponse({ blocks: notionBlocks });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// Convert Wasabi block format → Notion block API format
function wasabiBlockToNotion(block) {
  const richText = block.content
    ? [{ type: "text", text: { content: block.content } }]
    : [];

  switch (block.type) {
    case "heading_1":
      return { type: "heading_1", heading_1: { rich_text: richText } };
    case "heading_2":
      return { type: "heading_2", heading_2: { rich_text: richText } };
    case "heading_3":
      return { type: "heading_3", heading_3: { rich_text: richText } };
    case "bulleted_list_item":
      return { type: "bulleted_list_item", bulleted_list_item: { rich_text: richText } };
    case "numbered_list_item":
      return { type: "numbered_list_item", numbered_list_item: { rich_text: richText } };
    case "to_do":
      return { type: "to_do", to_do: { rich_text: richText, checked: block.checked || false } };
    case "toggle":
      return { type: "toggle", toggle: { rich_text: richText } };
    case "quote":
      return { type: "quote", quote: { rich_text: richText } };
    case "callout":
      return {
        type: "callout",
        callout: {
          rich_text: richText,
          icon: block.icon ? { type: "emoji", emoji: block.icon } : { type: "emoji", emoji: "💡" },
        },
      };
    case "code":
      return { type: "code", code: { rich_text: richText, language: block.language || "plain text" } };
    case "image":
      return {
        type: "image",
        image: { type: "external", external: { url: block.url || "" } },
      };
    case "bookmark":
      return { type: "bookmark", bookmark: { url: block.url || "" } };
    case "divider":
      return { type: "divider", divider: {} };
    default:
      return { type: "paragraph", paragraph: { rich_text: richText } };
  }
}

// ─── Row Filter/Sort Helpers ───

function applyRowFilters(rows, filters) {
  return rows.filter((row) =>
    filters.every((f) => {
      const val = row.cells[f.column];
      const cmp = f.value;
      switch (f.op) {
        case "equals": return val === cmp;
        case "not_equals": return val !== cmp;
        case "contains": return String(val || "").toLowerCase().includes(String(cmp).toLowerCase());
        case "not_contains": return !String(val || "").toLowerCase().includes(String(cmp).toLowerCase());
        case "starts_with": return String(val || "").toLowerCase().startsWith(String(cmp).toLowerCase());
        case "ends_with": return String(val || "").toLowerCase().endsWith(String(cmp).toLowerCase());
        case "is_empty": return val === null || val === undefined || val === "";
        case "is_not_empty": return val !== null && val !== undefined && val !== "";
        case "gt": return Number(val) > Number(cmp);
        case "gte": return Number(val) >= Number(cmp);
        case "lt": return Number(val) < Number(cmp);
        case "lte": return Number(val) <= Number(cmp);
        default: return true;
      }
    })
  );
}

function applyRowSorts(rows, sorts) {
  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const va = a.cells[s.column] ?? "";
      const vb = b.cells[s.column] ?? "";
      const dir = s.direction === "desc" ? -1 : 1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
    }
    return 0;
  });
}

// ─── Notion API Helper ───
async function notionFetch(endpoint, method, notionKey, body) {
  if (!notionKey) {
    return jsonResponse({ _error: "Missing Notion API key" }, 401);
  }

  const headers = {
    Authorization: `Bearer ${notionKey}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };

  const opts = { method, headers };
  if (body && method !== "GET") {
    opts.body = JSON.stringify(body);
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${NOTION_API}${endpoint}`, opts);

    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const wait = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(2000 * Math.pow(2, attempt), 16000);
      await sleep(wait);
      continue;
    }

    const data = await res.json().catch(() => ({ _error: "Failed to parse response" }));

    if (!res.ok) {
      return jsonResponse({
        _error: data.message || `Notion API error: ${res.status}`,
        status: res.status,
        code: data.code,
      }, res.status);
    }

    return jsonResponse(data);
  }

  return jsonResponse({ _error: "Rate limited — max retries exceeded" }, 429);
}

// ─── Claude API Helper ───
async function claudeFetch(claudeKey, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(CLAUDE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429 || res.status === 529) {
      const wait = Math.min(2000 * Math.pow(2, attempt), 30000);
      await sleep(wait);
      continue;
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return jsonResponse({
        _error: errData.error?.message || `Claude API error: ${res.status}`,
        type: errData.error?.type,
      }, res.status);
    }

    const data = await res.json();
    return jsonResponse(data);
  }

  return jsonResponse({ _error: "Claude rate limited — max retries exceeded" }, 429);
}

// ─── Utilities ───
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── CSV Parser (state machine, handles quoted fields) ───
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuoted = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuoted) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuoted = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"' && field.length === 0) {
        inQuoted = true;
        i++;
      } else if (ch === ",") {
        row.push(field);
        field = "";
        i++;
      } else if (ch === "\r" || ch === "\n") {
        row.push(field);
        field = "";
        if (ch === "\r" && i + 1 < text.length && text[i + 1] === "\n") i++;
        i++;
        if (row.length > 0 && row.some((c) => c.length > 0)) rows.push(row);
        row = [];
      } else {
        field += ch;
        i++;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.length > 0)) rows.push(row);
  }

  if (rows.length === 0) return { columns: [], rows: [] };
  const columns = rows[0];
  return { columns, rows: rows.slice(1) };
}
