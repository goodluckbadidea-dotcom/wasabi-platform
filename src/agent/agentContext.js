// ─── Agent Context Envelope ───
// Assembles all context for a single conversation turn into a single object.
// Built ONCE before invoking the classifier or agent, then passed through
// the entire pipeline. Only messages, toolCallLog, and iterationCount mutate.
//
// Phase 1 of multi-tier agent architecture. Does not change model calls,
// routing logic, or tool definitions — only restructures context assembly.

/**
 * buildAgentContext()
 *
 * Assembles the context envelope for a single conversation turn.
 * Call ONCE before invoking the classifier or agent.
 * Pass the returned envelope through every subsequent stage.
 *
 * @param {object} params
 * @param {object} params.user             - { workerUrl, claudeKey, notionKey, mondayKey }
 * @param {object|null} params.identity    - { id, display_name, role } or null (single-user)
 * @param {object} params.platformIds      - { rootPageId, kbDbId, notifDbId, configDbId, rulesDbId }
 * @param {object} [params.currentPageContext] - { pageName, databaseIds, schemaText }
 * @param {string} [params.dataSummary]    - Output of buildDataSummary()
 * @param {string} [params.workspaceSummary] - All workspace pages listing
 * @param {string} [params.neuronSummary]  - Output of buildNeuronContextSummary()
 * @param {string} [params.kbContext]      - KB search results as text
 * @param {string} [params.googleContext]  - Gmail/Calendar context
 * @param {string} [params.agentMode]      - "auto" | "confirm"
 * @param {string} [params.workspaceInstructions] - Custom AI instructions from workspace settings
 * @returns {object} AgentContext envelope
 */
export async function buildAgentContext({
  user,
  identity,
  platformIds,
  currentPageContext,
  dataSummary = "",
  workspaceSummary = "",
  neuronSummary = "",
  kbContext = "",
  googleContext = "",
  agentMode = "auto",
  workspaceInstructions = "",
}) {
  // Generate session ID for this conversation turn
  let sessionId;
  try {
    sessionId = crypto.randomUUID();
  } catch {
    sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Derive user identity fields
  const userId = identity?.id || "single-user";
  const role = identity?.role || null;

  // Map role → tier (unused in this phase, forward-compatible with multi-tier router)
  let userTier = "standard";
  if (role === "admin") userTier = "superuser";
  else if (role === "editor") userTier = "premium";

  // Format platformDbIds as string (matches existing buildWasabiPrompt param format)
  const platformDbIdsStr = platformIds
    ? Object.entries(platformIds)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
    : "";

  return {
    // --- Identity ---
    sessionId,
    userId,
    userTier,

    // --- Routing metadata (written by classifyAndRoute, read by router) ---
    dispatch: null,               // "DIRECT_WORKER" | "ORCHESTRATED" | "CALCULATE" | "ESCALATE"
    routeReason: null,
    estimatedWorkerCount: null,
    dataDomains: [],

    // --- Frozen context (assembled once, never mutated) ---
    frozenContext: {
      kbEntries: kbContext,
      neuronSummary,
      workspaceSummary,
      currentPageContext: currentPageContext || undefined,
      dataSummary,
      platformDbIds: platformDbIdsStr,
      googleContext,
      agentMode,
      workspaceInstructions,
      builtAt: Date.now(),
    },

    // --- Conversation state (mutates across the loop) ---
    messages: [],
    priorSummary: null,
    toolCallLog: [],
    iterationCount: 0,
  };
}


/**
 * buildEscalationHandoff()
 *
 * Builds a compressed briefing for handoff to a higher-tier model.
 * Called by the orchestrator when shouldEscalate() returns true.
 * Replaces passing the full message history to the escalation target.
 *
 * NOT CALLED in this phase — forward-compatible with multi-tier system.
 *
 * @param {object} envelope - AgentContext envelope
 * @returns {object} Handoff briefing
 */
export function buildEscalationHandoff(envelope) {
  return {
    originalRequest: envelope.messages.find((m) => m.role === "user")?.content ?? "",
    priorContext: envelope.priorSummary ?? null,
    toolFindings: envelope.toolCallLog.map((t) => ({
      tool: t.name,
      input: t.input,
      result: t.result,
    })),
    whatWasAttempted: envelope.routeReason,
    dataDomains: envelope.dataDomains,
    kbContext: envelope.frozenContext.kbEntries,
    iterationCount: envelope.iterationCount,
  };
}
