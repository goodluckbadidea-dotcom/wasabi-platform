// ─── Wasabi Agent Runtime ───
// Core agentic loop. Parameterized — no module globals.
// Used by Wasabi, page agents, and automation agents.

import { sleep } from "../utils/helpers.js";
import { recordUsage } from "../utils/costTracker.js";
import { getConnection } from "../lib/api.js";

const MAX_BACKOFF = 60000;

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
 * @param {object} [opts.abortRef] - { current: boolean } for cancellation
 * @param {number} [opts.maxIterations] - Max loop iterations (default 12)
 * @param {number} [opts.maxTokens] - Max tokens per response (default 2048)
 * @returns {Promise<{ text: string, history: Array, toolCalls: Array }>}
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
  abortRef,
  maxIterations = 12,
  maxTokens = 2048,
}) {
  const history = [...messages];
  const allToolCalls = [];
  let finalText = "";

  for (let iter = 0; iter < maxIterations; iter++) {
    if (abortRef?.current) break;

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
    });

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

    // If no tool calls, we're done
    if (response.stop_reason !== "tool_use" || toolBlocks.length === 0) {
      break;
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

  return { text: finalText, history, toolCalls: allToolCalls };
}

/**
 * Call Claude API via the worker proxy with retry/backoff.
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

      // Track token usage for cost estimation
      if (data.usage) {
        try {
          recordUsage({
            model,
            inputTokens: data.usage.input_tokens || 0,
            outputTokens: data.usage.output_tokens || 0,
            source: "agent",
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

/**
 * Extract choices from agent response text.
 * Looks for lines like "1. **Option Name** — description"
 * or button-style markers like [Choice: Label]
 */
export function extractChoices(text) {
  if (!text) return [];

  const choices = [];

  // Pattern: [Choice: Label] or [choice: Label]
  const choiceRegex = /\[(?:Choice|choice|CHOICE):\s*(.+?)\]/g;
  let match;
  while ((match = choiceRegex.exec(text)) !== null) {
    choices.push({ label: match[1].trim(), raw: match[0] });
  }

  if (choices.length > 0) return choices;

  // Pattern: numbered bold options — "1. **Label** — description"
  const lines = text.split("\n");
  for (const line of lines) {
    const m = line.match(/^\d+\.\s+\*\*(.+?)\*\*/);
    if (m) {
      choices.push({ label: m[1].trim(), raw: line.trim() });
    }
  }

  return choices;
}
