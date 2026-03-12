// ─── Query Classifier ───
// Lightweight Haiku pre-check that classifies user queries before tool execution.
// Cost: ~$0.001 per classification. Determines strategy:
//   "direct"        — simple query, execute immediately
//   "clarify"       — complex query, ask clarifying questions first
//   "parallel_fetch" — multi-source query, use parallel sub-agents

import { getConnection } from "../lib/api.js";
import { recordUsage } from "../utils/costTracker.js";

const HAIKU = "claude-haiku-4-5-20251001";

const CLASSIFIER_PROMPT = `You are a query complexity classifier for a workspace platform.
Analyze the user's message and determine the best execution strategy.

Available data sources:
{WORKSPACE_SUMMARY}

Available tools: {TOOL_NAMES}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "complexity": "simple" | "moderate" | "complex",
  "estimated_tools": <number 1-15>,
  "data_sources": ["<source names that need querying>"],
  "needs_clarification": <boolean>,
  "clarifying_questions": [
    { "question": "<question text>", "options": ["<option 1>", "<option 2>", "<option 3>"] }
  ],
  "strategy": "direct" | "clarify" | "parallel_fetch",
  "plan_summary": "<one sentence describing what you'd do>"
}

Rules:
- "simple": greeting, single lookup, quick question → 1-2 tools. strategy: "direct"
- "moderate": focused analysis on 1 data source → 2-4 tools. strategy: "direct"
- "complex": multi-source analysis, cross-referencing, reports → 5+ tools
  - If the user's intent is vague or could go multiple directions → strategy: "clarify", needs_clarification: true
  - If intent is clear but needs multiple data sources → strategy: "parallel_fetch"
- clarifying_questions: only include when needs_clarification is true. Max 3 questions, 2-4 options each.
  Questions should help you understand SCOPE (which data, time range, depth) not repeat the query.
- data_sources: list the specific workspace sources you'd need to query (by name from the available list)
- plan_summary: always filled — a brief sentence describing the execution approach`;

/** Skip classifier for trivially simple messages. */
function shouldSkipClassifier(text) {
  if (!text || text.length < 40) return true;
  // Single-word or very short messages
  if (text.split(/\s+/).length <= 5) return true;
  // Greetings and simple questions
  if (/^(hi|hey|hello|thanks|thank you|ok|sure|yes|no|got it)\b/i.test(text)) return true;
  return false;
}

/** Default result for skipped classification. */
const SIMPLE_DEFAULT = {
  complexity: "simple",
  estimated_tools: 1,
  data_sources: [],
  needs_clarification: false,
  clarifying_questions: [],
  strategy: "direct",
  plan_summary: "Respond directly",
};

/**
 * Classify a user query to determine execution strategy.
 *
 * @param {object} opts
 * @param {string}  opts.text             - User's message text
 * @param {string}  opts.workspaceSummary - Available data sources summary
 * @param {Array}   opts.tools            - Available tool definitions
 * @param {string}  opts.workerUrl        - Worker URL for Claude API
 * @param {string}  opts.claudeKey        - Claude API key
 * @param {number}  [opts.conversationDepth] - Number of messages in conversation
 * @returns {Promise<object>} Classification result
 */
export async function classifyQuery({
  text,
  workspaceSummary = "",
  tools = [],
  workerUrl,
  claudeKey,
  conversationDepth = 0,
}) {
  // Skip classifier for trivial messages
  if (shouldSkipClassifier(text)) {
    return SIMPLE_DEFAULT;
  }

  // Skip for ongoing conversations (classifier is most useful for new queries)
  if (conversationDepth > 4) {
    return { ...SIMPLE_DEFAULT, complexity: "moderate", strategy: "direct" };
  }

  // Build the classifier system prompt
  const toolNames = tools.map((t) => t.name).join(", ");
  const systemPrompt = CLASSIFIER_PROMPT
    .replace("{WORKSPACE_SUMMARY}", workspaceSummary || "(no workspace data)")
    .replace("{TOOL_NAMES}", toolNames || "(none)");

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
      body: JSON.stringify({
        model: HAIKU,
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: text }],
      }),
    });

    if (!res.ok) {
      console.warn("[QueryClassifier] API error, falling back to default:", res.status);
      return SIMPLE_DEFAULT;
    }

    const data = await res.json();

    // Track usage
    if (data.usage) {
      try {
        recordUsage({
          model: HAIKU,
          inputTokens: data.usage.input_tokens || 0,
          outputTokens: data.usage.output_tokens || 0,
          source: "classifier",
          tier: "haiku",
          routeReason: "query_classifier",
        });
      } catch {}
    }

    // Extract text from response
    const responseText = data.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("") || "";

    // Parse JSON from response (handle potential markdown wrapping)
    const jsonStr = responseText.replace(/```json\s*|```/g, "").trim();
    const result = JSON.parse(jsonStr);

    // Validate and sanitize
    return {
      complexity: ["simple", "moderate", "complex"].includes(result.complexity)
        ? result.complexity
        : "moderate",
      estimated_tools: Math.min(Math.max(Number(result.estimated_tools) || 2, 1), 20),
      data_sources: Array.isArray(result.data_sources) ? result.data_sources : [],
      needs_clarification: !!result.needs_clarification,
      clarifying_questions: Array.isArray(result.clarifying_questions)
        ? result.clarifying_questions.slice(0, 3).map((q) => ({
            question: String(q.question || ""),
            options: Array.isArray(q.options) ? q.options.slice(0, 4).map(String) : [],
          }))
        : [],
      strategy: ["direct", "clarify", "parallel_fetch"].includes(result.strategy)
        ? result.strategy
        : "direct",
      plan_summary: String(result.plan_summary || ""),
    };
  } catch (err) {
    console.warn("[QueryClassifier] Failed, falling back to default:", err.message);
    return SIMPLE_DEFAULT;
  }
}

/**
 * Format classifier's clarifying questions into a Wasabi-style response.
 * Returns a message string with [Q:|A:] format for display + extraction.
 *
 * @param {object} classification - Result from classifyQuery
 * @returns {string} Formatted response text
 */
export function formatClassifierResponse(classification) {
  if (!classification.needs_clarification || !classification.clarifying_questions?.length) {
    return "";
  }

  const lines = ["A few things to clarify before I dive in:\n"];

  for (const q of classification.clarifying_questions) {
    if (q.question && q.options?.length >= 2) {
      const optStr = q.options.map((o) => `A: ${o}`).join(" | ");
      lines.push(`[Q: ${q.question} | ${optStr}]`);
    }
  }

  if (classification.plan_summary) {
    lines.push(`\n*My initial plan: ${classification.plan_summary}*`);
  }

  return lines.join("\n");
}
