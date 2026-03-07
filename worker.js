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
