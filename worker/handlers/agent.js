// ─── Wasabi Agent Query (MCP-accessible, context-aware) ───
// Server-side agent that wraps Claude with Wasabi-specific context (KB, pages)
// and read-only tools. Called by the MCP `wasabi_agent_query` tool so Cowork/
// other MCP clients can ask the in-app Wasabi assistant questions that benefit
// from workspace context they don't otherwise have.
//
// Pattern mirrors executeRuleServer in worker/automation/engine.js.

import { CLAUDE_API } from '../schema.js';
import { safeParseJSON } from '../utils.js';
import { decryptSecret } from '../crypto.js';

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 8;

export async function handleAgentQuery(request, env, jsonResponse, claudeKeyRaw) {
  // ── Parse request body ──
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return jsonResponse({ error: "Missing 'prompt'" }, 400);

  const callerContext = body?.context ?? null;

  // ── Resolve API key (decrypt-safe for plaintext or enc:v1: values) ──
  if (!claudeKeyRaw) return jsonResponse({ error: "Missing Claude API key in workspace connections" }, 400);
  const apiKey = await decryptSecret(claudeKeyRaw, env);
  if (!apiKey) return jsonResponse({ error: "Failed to resolve Claude API key" }, 500);

  // ── Load workspace context: KB + pages ──
  let kbEntries = [];
  try {
    const res = await env.DB.prepare(
      "SELECT key, category, content FROM knowledge_base ORDER BY created_at DESC LIMIT 50"
    ).all();
    kbEntries = res?.results || [];
  } catch (err) {
    console.error("[agent] KB fetch failed:", err?.message || err);
  }

  let pages = [];
  try {
    const res = await env.DB.prepare(
      "SELECT id, title, page_type FROM page_configs ORDER BY created_at LIMIT 30"
    ).all();
    pages = res?.results || [];
  } catch (err) {
    console.error("[agent] pages fetch failed:", err?.message || err);
  }

  // ── Build system prompt ──
  const pagesSection = pages.length > 0
    ? "Workspace pages:\n" + pages.map((p) => `- ${p.title} (${p.page_type}) [id: ${p.id}]`).join("\n")
    : "Workspace pages: (none yet)";

  const kbSection = kbEntries.length > 0
    ? "Knowledge base entries:\n" + kbEntries.map((k) => `- [${k.category}] ${k.key}: ${k.content}`).join("\n")
    : "Knowledge base: (empty)";

  const contextSection = callerContext
    ? "\nAdditional caller-provided context:\n" + JSON.stringify(callerContext, null, 2)
    : "";

  const systemPrompt = [
    "You are the Wasabi workspace assistant accessed via MCP.",
    "Wasabi is a self-hosted Cloudflare-backed workspace (tables, KB, pages, automations).",
    "Answer the user's question using the workspace context below.",
    "You have read-only tools for querying tables, listing pages, and searching the KB.",
    "Be concise, factual, and cite specific records or KB entries when relevant.",
    "Do not invent data — if you can't find something, say so.",
    "",
    pagesSection,
    "",
    kbSection,
    contextSection,
  ].join("\n");

  // ── Read-only tool definitions ──
  const tools = [
    {
      name: "query_table",
      description: "Fetch rows from a workspace table by its table id (matches page_configs.id for table pages). Returns row id and parsed cells.",
      input_schema: {
        type: "object",
        properties: {
          table_id: { type: "string", description: "The table id to query." },
          limit: { type: "number", description: "Max rows to return (1-100, default 50)." },
        },
        required: ["table_id"],
      },
    },
    {
      name: "list_pages",
      description: "List all pages in the workspace (id, title, page_type).",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "search_kb",
      description: "Search knowledge base entries by keyword (LIKE match on key or content).",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term." },
        },
        required: ["query"],
      },
    },
  ];

  // ── Agent loop ──
  const messages = [{ role: "user", content: prompt }];
  let finalText = "";
  let iterations = 0;
  let stopReason = "max_iterations";

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    iterations = iter + 1;
    const reqBody = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
      tools,
    };

    const res = await fetch(CLAUDE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(reqBody),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[agent] Claude API error (${res.status}):`, errText);
      return jsonResponse({ error: `Claude API error (${res.status})`, detail: errText }, 502);
    }

    const data = await res.json();
    messages.push({ role: "assistant", content: data.content });

    const textBlocks = (data.content || []).filter((b) => b.type === "text").map((b) => b.text);
    if (textBlocks.length > 0) finalText = textBlocks.join("\n");

    const toolBlocks = (data.content || []).filter((b) => b.type === "tool_use");
    if (data.stop_reason !== "tool_use" || toolBlocks.length === 0) {
      stopReason = data.stop_reason || "end_turn";
      break;
    }

    // Execute tool calls
    const toolResults = [];
    for (const block of toolBlocks) {
      let result;
      try {
        result = await executeAgentTool(block.name, block.input, env, pages);
      } catch (err) {
        result = { error: err?.message || String(err) };
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return jsonResponse({
    response: finalText,
    model: MODEL,
    iterations,
    stop_reason: stopReason,
  });
}

// ── Read-only tool executor ──
async function executeAgentTool(name, input, env, cachedPages) {
  if (name === "list_pages") {
    return { pages: cachedPages || [] };
  }

  if (name === "query_table") {
    const tableId = input?.table_id;
    if (!tableId || typeof tableId !== "string") {
      return { error: "Missing or invalid 'table_id'" };
    }
    const limit = Math.min(Math.max(parseInt(input?.limit, 10) || 50, 1), 100);

    const res = await env.DB.prepare(
      "SELECT id, cells, updated_at FROM table_rows WHERE table_id = ? AND archived = 0 ORDER BY sort_order LIMIT ?"
    ).bind(tableId, limit).all();

    const rows = (res?.results || []).map((r) => ({
      id: r.id,
      cells: safeParseJSON(r.cells),
      updated_at: r.updated_at,
    }));

    return { table_id: tableId, count: rows.length, rows };
  }

  if (name === "search_kb") {
    const query = input?.query;
    if (!query || typeof query !== "string") {
      return { error: "Missing or invalid 'query'" };
    }
    const like = `%${query}%`;
    const res = await env.DB.prepare(
      "SELECT id, key, category, content FROM knowledge_base WHERE key LIKE ? OR content LIKE ? LIMIT 20"
    ).bind(like, like).all();
    return { query, count: res?.results?.length || 0, results: res?.results || [] };
  }

  return { error: `Unknown tool: ${name}` };
}
