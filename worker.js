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
