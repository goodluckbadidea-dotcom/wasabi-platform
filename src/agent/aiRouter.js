// ─── AI Router ───
// Multi-factor model routing. Haiku-first, Sonnet only when needed.
// 3-tier system: Cache (zero cost) → Haiku (cheap) → Sonnet (powerful).

export const SONNET = "claude-sonnet-4-20250514";
export const HAIKU = "claude-haiku-4-5-20251001";

// Patterns that genuinely need Sonnet's reasoning depth
const SONNET_KEYWORDS =
  /\b(build|create|design|refactor|architect|debug complex|multi.?step|workflow|setup from scratch|restructure|analyze.*and.*recommend|compare.*options|write.*code|implement|system|track|manage|dashboard|inventory|pipeline)\b/i;

// Patterns that indicate multi-step reasoning
const MULTI_STEP =
  /\b(and then|after that|step by step|first.*then|also.*make sure|followed by)\b/i;

// Patterns that indicate data analysis needing deeper reasoning
const DATA_ANALYSIS =
  /\b(analyze|summarize|compare|trend|insight|report|breakdown|overview|assessment|what does.*look like|how is.*doing)\b/i;

/**
 * Route a prompt to the optimal model tier.
 *
 * @param {object} opts
 * @param {string}      opts.text              - User prompt text
 * @param {string|null} [opts.override]        - "sonnet" | "haiku" | null (auto)
 * @param {number}      [opts.conversationDepth] - Number of messages so far
 * @param {number}      [opts.toolCount]       - Number of available tools
 * @returns {{ model: string, tier: "haiku"|"sonnet", reason: string }}
 */
export function routeModel({
  text,
  override = null,
  conversationDepth = 0,
  toolCount = 0,
}) {
  // Explicit override always wins
  if (override === "sonnet")
    return { model: SONNET, tier: "sonnet", reason: "user_override" };
  if (override === "haiku")
    return { model: HAIKU, tier: "haiku", reason: "user_override" };

  // ── Auto-routing: score complexity factors ──
  const factors = [];

  // Factor 1: Very long prompt
  if (text.length > 500) factors.push("long_prompt");

  // Factor 2: Keywords suggesting complex reasoning
  if (SONNET_KEYWORDS.test(text)) factors.push("complex_keywords");

  // Factor 3: Multi-step language
  if (MULTI_STEP.test(text)) factors.push("multi_step");

  // Factor 4: Deep conversation (>6 exchanges)
  if (conversationDepth > 6) factors.push("deep_conversation");

  // Factor 5: Many tools available (complex tool selection)
  // Raised threshold — with 17 tools this was always true
  if (toolCount > 12) factors.push("many_tools");

  // Factor 6: Data analysis queries that need reasoning
  if (DATA_ANALYSIS.test(text)) factors.push("data_analysis");

  // Need ≥2 factors to justify Sonnet cost
  const escalate = factors.length >= 2;

  return {
    model: escalate ? SONNET : HAIKU,
    tier: escalate ? "sonnet" : "haiku",
    reason: escalate ? factors.join("+") : "default_haiku",
  };
}

/**
 * Check if a Haiku response should trigger auto-escalation to Sonnet.
 * Fires on clearly weak or generic responses.
 *
 * @param {string}  responseText  - The text from Haiku's response
 * @param {string}  userText      - The original user prompt
 * @param {boolean} hadToolCalls  - Whether the response included tool calls
 * @returns {boolean}
 */
export function shouldEscalate(responseText, userText, hadToolCalls) {
  // Don't escalate if there were tool calls (agent is working)
  if (hadToolCalls) return false;

  // Don't escalate very short prompts (they should have short answers)
  if (userText.length < 30) return false;

  // Escalate if response is suspiciously short for a non-trivial prompt
  if (responseText.length < 20 && userText.length > 100) return true;

  // Escalate if response is generic/vague for a substantial question
  if (responseText.length < 80 && userText.length > 150) return true;

  // Escalate if response contains confusion markers
  if (
    /i('m| am) (not sure|unsure|unable|cannot|can't) (how|what|whether)/i.test(
      responseText,
    )
  )
    return true;

  // Escalate if response doesn't reference any specific data for a data question
  if (userText.length > 100 && !/\d/.test(responseText) && DATA_ANALYSIS.test(userText))
    return true;

  return false;
}

/**
 * Route using query classifier output for smarter model selection.
 * Falls back to keyword-based routeModel if no classification is provided.
 *
 * @param {object} opts
 * @param {object}      opts.classification     - Result from queryClassifier
 * @param {string|null} [opts.override]         - "sonnet" | "haiku" | null
 * @param {number}      [opts.conversationDepth] - Number of messages so far
 * @returns {{ model: string, tier: "haiku"|"sonnet", reason: string }}
 */
export function routeWithClassification({
  classification,
  override = null,
  conversationDepth = 0,
  hasSpecificKBContext = false,
}) {
  // Explicit override always wins
  if (override === "sonnet")
    return { model: SONNET, tier: "sonnet", reason: "user_override" };
  if (override === "haiku")
    return { model: HAIKU, tier: "haiku", reason: "user_override" };

  if (!classification) {
    return { model: HAIKU, tier: "haiku", reason: "no_classification" };
  }

  // Domain-specific KB context (non-general tags) → always Sonnet for accuracy
  if (hasSpecificKBContext) {
    return { model: SONNET, tier: "sonnet", reason: "kb_domain_context" };
  }

  // Simple queries with NO data tools → Haiku (greetings, simple text answers)
  if (classification.complexity === "simple" && classification.estimated_tools <= 1) {
    return { model: HAIKU, tier: "haiku", reason: "classifier_simple_no_tools" };
  }

  // Everything involving data tools (2+ estimated) → Sonnet
  // Haiku hallucinates data when synthesizing database query results
  const reason = classification.strategy === "parallel_fetch"
    ? "classifier_parallel_synthesis"
    : classification.complexity === "complex"
      ? "classifier_complex"
      : classification.estimated_tools >= 2
        ? "classifier_data_query"
        : conversationDepth > 8
          ? "classifier_deep_conversation"
          : "classifier_moderate_with_tools";

  return { model: SONNET, tier: "sonnet", reason };
}

/**
 * Check if a request is cacheable.
 * Only pure text responses (no tool use) from single-turn conversations.
 *
 * @param {object} opts
 * @param {Array}  [opts.tools]    - Tool definitions (empty = cacheable)
 * @param {Array}  opts.messages   - Conversation messages
 * @returns {boolean}
 */
export function isCacheable({ tools, messages }) {
  // Requests with tools are NOT cacheable (tool results vary)
  if (tools && tools.length > 0) return false;

  // Multi-turn conversations are NOT cacheable (context-dependent)
  if (messages.length > 2) return false;

  // Single-turn, no-tool requests ARE cacheable
  return true;
}
