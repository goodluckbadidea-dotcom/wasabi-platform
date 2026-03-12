// ─── Wasabi Agent Runtime ───
// Core agentic loop. Parameterized — no module globals.
// Used by Wasabi, page agents, and automation agents.
// Supports tier-aware routing and cache hints.

import { sleep } from "../utils/helpers.js";
import { recordUsage } from "../utils/costTracker.js";
import { getConnection } from "../lib/api.js";

const MAX_BACKOFF = 60000;

/** Tools that modify data — used by onToolApproval gate in "confirm" mode. */
const WRITE_TOOL_NAMES = new Set([
  "create_page", "update_page", "batch_operations", "create_database",
  "update_database", "create_page_config", "create_automation_rule",
  "create_neuron", "update_knowledge_base", "post_notification",
  "process_uploaded_files", "smart_match_records", "export_report",
  "delegate_task",
  // Gmail write tools
  "send_email", "modify_email", "create_draft",
  // Calendar write tools
  "create_calendar_event", "update_calendar_event", "delete_calendar_event",
]);

/**
 * Run an agent loop: send messages to Claude, execute tool calls, repeat.
 *
 * @param {object} opts
 * @param {Array} opts.messages - Conversation messages
 * @param {string} opts.systemPrompt - System prompt text
 * @param {Array} opts.tools - Tool definitions
 * @param {string} opts.model - Claude model ID
 * @param {string} opts.workerUrl - Worker proxy URL
 * @param {string} opts.claudeKey - Anthropic API key
 * @param {Function} opts.executeTool - (toolName, toolInput) => result string
 * @param {Function} [opts.onToolCall] - Callback: (toolName, toolInput, result) => void
 * @param {Function} [opts.onToolApproval] - Async callback: (writeBlocks) => boolean — gate for write tools
 * @param {Function} [opts.onStatus] - Callback: (statusText) => void — live progress updates
 * @param {object} [opts.abortRef] - { current: boolean } for cancellation
 * @param {number} [opts.maxIterations] - Max loop iterations (default 12)
 * @param {number} [opts.maxTokens] - Max tokens per response (default 2048)
 * @param {string} [opts.tier] - Routing tier: "haiku"|"sonnet"|"unknown"
 * @param {string} [opts.routeReason] - Why this tier was chosen
 * @returns {Promise<{ text: string, history: Array, toolCalls: Array, stopReason: string }>}
 */
export async function runAgent({
  messages,
  systemPrompt,
  tools,
  model,
  workerUrl,
  claudeKey,
  executeTool,
  onToolCall,
  onToolApproval,
  onStatus,
  abortRef,
  maxIterations = 12,
  maxTokens = 2048,
  tier = "unknown",
  routeReason = "",
}) {
  const history = [...messages];
  const allToolCalls = [];
  let finalText = "";
  let lastStopReason = "end_turn";

  for (let iter = 0; iter < maxIterations; iter++) {
    if (abortRef?.current) break;

    // Notify caller which iteration we're on
    if (onStatus) {
      if (iter === 0) onStatus("Thinking...");
      else onStatus(`Running tools (step ${iter})...`);
    }

    // Call Claude via worker proxy
    const response = await callClaude({
      workerUrl,
      claudeKey,
      model,
      systemPrompt,
      messages: history,
      tools,
      maxTokens,
      abortRef,
      tier,
      routeReason,
    });

    lastStopReason = response.stop_reason || "end_turn";

    // Extract text and tool use blocks
    const textBlocks = [];
    const toolBlocks = [];

    for (const block of response.content || []) {
      if (block.type === "text") {
        textBlocks.push(block.text);
      } else if (block.type === "tool_use") {
        toolBlocks.push(block);
      }
    }

    // Append assistant message to history
    history.push({ role: "assistant", content: response.content });

    if (textBlocks.length > 0) {
      finalText = textBlocks.join("\n");
    }

    // If no tool calls, we're done.
    // Note: only check toolBlocks — Claude can return tool_use blocks even with
    // stop_reason !== "tool_use" (edge case). If we break without executing them,
    // the history has dangling tool_use IDs that cause 400 errors on the next turn.
    if (toolBlocks.length === 0) {
      break;
    }

    // Notify caller about tool execution
    if (onStatus) {
      const toolNames = toolBlocks.map((b) => b.name.replace(/_/g, " "));
      onStatus(`Running: ${toolNames.join(", ")}...`);
    }

    // ── Tool approval gate (for "confirm" mode) ──
    // If onToolApproval is set, separate write tools from read-only tools.
    // Write tools require user approval; read-only tools execute freely.
    if (onToolApproval) {
      const writeBlocks = toolBlocks.filter((b) => WRITE_TOOL_NAMES.has(b.name));
      const readBlocks = toolBlocks.filter((b) => !WRITE_TOOL_NAMES.has(b.name));

      if (writeBlocks.length > 0) {
        if (onStatus) onStatus("Waiting for approval...");
        const approved = await onToolApproval(writeBlocks);

        if (!approved) {
          // User denied — return rejection results for write tools, execute reads normally
          const rejectionResults = writeBlocks.map((b) => ({
            type: "tool_result",
            tool_use_id: b.id,
            content: JSON.stringify({ error: "User declined this action." }),
          }));

          const readResults = await Promise.all(
            readBlocks.map(async (block) => {
              const { id, name, input } = block;
              let result;
              try {
                result = await executeTool(name, input);
                if (typeof result !== "string") result = JSON.stringify(result);
              } catch (err) {
                result = JSON.stringify({ error: err.message });
              }
              allToolCalls.push({ name, input, result });
              if (onToolCall) onToolCall(name, input, result);
              return { type: "tool_result", tool_use_id: id, content: result };
            })
          );

          history.push({ role: "user", content: [...readResults, ...rejectionResults] });
          continue; // Next iteration — Claude sees rejections and responds
        }
      }
    }

    // Execute all tool calls in parallel
    const toolResults = await Promise.all(
      toolBlocks.map(async (block) => {
        const { id, name, input } = block;
        let result;
        try {
          result = await executeTool(name, input);
          if (typeof result !== "string") result = JSON.stringify(result);
        } catch (err) {
          result = JSON.stringify({ error: err.message });
        }

        allToolCalls.push({ name, input, result });
        if (onToolCall) onToolCall(name, input, result);

        return {
          type: "tool_result",
          tool_use_id: id,
          content: result,
        };
      })
    );

    // Append tool results as user message
    history.push({ role: "user", content: toolResults });
  }

  return { text: finalText, history, toolCalls: allToolCalls, stopReason: lastStopReason };
}

/**
 * Call Claude API via the worker proxy with retry/backoff.
 * Supports cache hints and tier-aware cost tracking.
 */
async function callClaude({
  workerUrl,
  claudeKey,
  model,
  systemPrompt,
  messages,
  tools,
  maxTokens,
  abortRef,
  tier = "unknown",
  routeReason = "",
}) {
  const body = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  // Determine if this request is cacheable (no tools, single-turn)
  const cacheable = (!tools || tools.length === 0) && messages.length <= 2;

  let lastError;

  for (let attempt = 0; attempt < 5; attempt++) {
    if (abortRef?.current) throw new Error("Aborted");

    try {
      const conn = getConnection();
      const authHeaders = {
        "Content-Type": "application/json",
        "X-Claude-Key": claudeKey,
      };
      if (conn?.secret) authHeaders["X-Wasabi-Key"] = conn.secret;
      if (cacheable) authHeaders["X-Cache-Hint"] = "cacheable";

      const res = await fetch(`${workerUrl}/claude`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(body),
      });

      // Rate limited — backoff and retry
      if (res.status === 429 || res.status === 529) {
        const wait = Math.min(2000 * Math.pow(2, attempt), MAX_BACKOFF);
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Claude API error (${res.status}): ${errText}`);
      }

      const data = await res.json();

      // Check for cache hit from worker
      const cacheHit = res.headers.get("X-Cache") === "HIT";

      // Track token usage for cost estimation (with tier info)
      if (data.usage || cacheHit) {
        try {
          recordUsage({
            model,
            inputTokens: data.usage?.input_tokens || 0,
            outputTokens: data.usage?.output_tokens || 0,
            source: "agent",
            tier: cacheHit ? "cache_hit" : tier,
            cacheHit,
            routeReason,
          });
        } catch {}
      }

      return data;
    } catch (err) {
      lastError = err;
      if (err.message === "Aborted") throw err;
      // Network error — retry with backoff
      const wait = Math.min(2000 * Math.pow(2, attempt), MAX_BACKOFF);
      await sleep(wait);
    }
  }

  throw lastError || new Error("Claude API call failed after retries");
}

// ─── Multi-Phase Execution ───

/**
 * Read-only tools for the orient phase (cheap, fast context gathering).
 */
const ORIENT_TOOL_NAMES = new Set([
  "query_database",
  "search_knowledge_base",
  "query_neurons",
  "get_page",
]);

/**
 * Run a two-phase agent: Orient (gather context cheaply) → Execute (act with full context).
 * Only triggered for complex requests (long text + system-building keywords).
 *
 * @param {object} opts - Same as runAgent, plus:
 * @param {Array} opts.orientTools - Read-only tools for orient phase
 * @param {Array} opts.executeTools - Full tools for execute phase
 * @param {string} opts.orientModel - Model for orient phase (default: haiku)
 * @param {string} [opts.preContext] - Any pre-gathered context (neurons, KB, etc.)
 * @param {Function} [opts.onStatus] - Callback: (statusText) => void — live progress updates
 */
export async function runAgentMultiPhase({
  messages,
  systemPrompt,
  orientTools,
  executeTools,
  model,
  orientModel = "claude-haiku-4-5-20251001",
  workerUrl,
  claudeKey,
  executeTool,
  onToolCall,
  onToolApproval,
  onStatus,
  abortRef,
  maxTokens = 4096,
  tier = "unknown",
  routeReason = "",
  preContext = "",
}) {
  // ── Phase 1: Orient (cheap, read-only) ──
  const orientSystemPrompt = [
    systemPrompt,
    "\n## Orient Phase",
    "You are in the ORIENT phase. Gather context first before taking action.",
    "Search the knowledge base, check neurons for connections, and query relevant databases.",
    "Summarize your findings concisely. Do NOT create, update, or modify anything yet.",
    preContext ? `\n## Pre-gathered Context\n${preContext}` : null,
  ].filter(Boolean).join("\n");

  // Filter tools to read-only subset
  const readOnlyTools = (orientTools || []).filter((t) => ORIENT_TOOL_NAMES.has(t.name));

  let orientFindings = "";

  if (readOnlyTools.length > 0) {
    if (onStatus) onStatus("Gathering context...");
    try {
      const orientResult = await runAgent({
        messages,
        systemPrompt: orientSystemPrompt,
        tools: readOnlyTools,
        model: orientModel,
        workerUrl,
        claudeKey,
        executeTool,
        onToolCall,
        onStatus,
        abortRef,
        maxIterations: 4,
        maxTokens: 1024,
        tier: "haiku",
        routeReason: "orient_phase",
      });

      orientFindings = orientResult.text || "";
    } catch (err) {
      console.warn("[MultiPhase] Orient phase failed, proceeding to execute:", err.message);
    }
  }

  if (abortRef?.current) return { text: "", history: messages, toolCalls: [] };

  // ── Phase 2: Execute (full model, full tools) ──
  const executeSystemPrompt = [
    systemPrompt,
    orientFindings
      ? `\n## Pre-gathered Context (from orient phase)\n${orientFindings}`
      : null,
    preContext && !orientFindings
      ? `\n## Pre-gathered Context\n${preContext}`
      : null,
  ].filter(Boolean).join("\n");

  if (onStatus) onStatus("Executing...");

  return await runAgent({
    messages,
    systemPrompt: executeSystemPrompt,
    tools: executeTools || [],
    model,
    workerUrl,
    claudeKey,
    executeTool,
    onToolCall,
    onToolApproval, // Only active in execute phase — orient phase is read-only
    onStatus,
    abortRef,
    maxIterations: 12,
    maxTokens,
    tier,
    routeReason: routeReason || "execute_phase",
  });
}

/**
 * Extract questions from agent response text.
 * Uses the [Q: question | A: option1 | A: option2] format.
 * Returns structured question objects for the UI to render.
 *
 * @param {string} text - Agent response text
 * @returns {{ questions: Array<{ question: string, options: Array<{ label: string }>, raw: string }> }}
 */
export function extractQuestions(text) {
  if (!text) return [];

  const questions = [];

  // Match [Q: question text | A: answer1 | A: answer2 | ...]
  const regex = /\[Q:\s*(.+?)\s*(?:\|\s*A:\s*(.+?))\s*(?:\|\s*A:\s*(.+?))?\s*(?:\|\s*A:\s*(.+?))?\s*(?:\|\s*A:\s*(.+?))?\s*\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const question = match[1].trim();
    const options = [];
    for (let i = 2; i <= 5; i++) {
      if (match[i]) options.push({ label: match[i].trim() });
    }
    if (question && options.length >= 2) {
      questions.push({ question, options, raw: match[0] });
    }
  }

  return questions;
}
