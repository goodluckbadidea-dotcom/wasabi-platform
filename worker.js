// ─── Wasabi Platform Cloudflare Worker ───
// Generalized Notion + Claude API proxy. No hardcoded DB IDs.
// All database IDs and API keys passed from client per-request.

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const CLAUDE_API = "https://api.anthropic.com/v1/messages";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Claude-Key",
};

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const notionKey = request.headers.get("Authorization")?.replace("Bearer ", "");

    try {
      // ─── Notion Routes ───

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

      // Update single block (/block/ singular — distinct from /blocks/ plural)
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

      // Test connection
      if (path === "/test" && request.method === "GET") {
        return await notionFetch("/users/me", "GET", notionKey);
      }

      // ─── Claude API ───
      if (path === "/claude" && request.method === "POST") {
        const body = await request.json();
        const claudeKey = request.headers.get("X-Claude-Key") || body.claudeKey;
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

        // Detect sheet type and build fetch URL
        let fetchUrl = sheetUrl;
        let sheetType = "csv";
        const gMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
        if (gMatch) {
          sheetType = "google_sheets";
          fetchUrl = `https://docs.google.com/spreadsheets/d/${gMatch[1]}/gviz/tq?tqx=out:csv`;
        }

        // Check Cloudflare cache (5-min TTL)
        const cacheKey = new Request(`https://wasabi-cache.internal/sheets/${encodeURIComponent(sheetUrl)}`, { method: "GET" });
        const cache = caches.default;
        const cached = await cache.match(cacheKey);
        if (cached) return cached;

        // Fetch the CSV
        const csvRes = await fetch(fetchUrl, { headers: { "User-Agent": "Wasabi-Platform/1.0" } });
        if (!csvRes.ok) {
          const status = csvRes.status;
          const msg = status === 401 || status === 403
            ? "This sheet is not publicly accessible. Make sure it is shared via 'Anyone with the link can view'."
            : `Failed to fetch sheet data (${status})`;
          return jsonResponse({ _error: msg }, 502);
        }
        const csvText = await csvRes.text();

        // Parse CSV
        const { columns, rows } = parseCSV(csvText);
        const result = { columns, rows: rows.slice(0, 10000), cachedAt: Date.now(), sheetType, truncated: rows.length > 10000 };

        // Store in cache with 5-min TTL
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

  // Retry with backoff for rate limits
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
  // Last field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.length > 0)) rows.push(row);
  }

  if (rows.length === 0) return { columns: [], rows: [] };
  const columns = rows[0];
  return { columns, rows: rows.slice(1) };
}
