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
 * @param {string} [params.agentMode]      - "auto" | "confirm" | "plan"
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
/**
 * buildAssistantContext()
 *
 * Assembles the context envelope for an Assistant conversation turn.
 * Same AgentContext shape as the agent envelope — shared type, lighter fill.
 * KB, neurons, and workspace instructions are left empty (assistant doesn't use them).
 * Active page context IS included so the assistant knows what the user is viewing.
 *
 * @param {object} params
 * @param {object} params.user             - { workerUrl, claudeKey }
 * @param {object|null} params.identity    - { id, display_name, role } or null
 * @param {object[]} params.pages          - Workspace pages array from PlatformContext
 * @param {string} [params.googleContext]  - Gmail/Calendar context if available
 * @param {object} [params.activePageConfig] - Current page config the user is viewing
 * @param {object} [params.activePageData]   - Current page data (rows/records)
 * @param {string} [params.taskContext]    - AI-curated tasks text (from localStorage cache)
 * @returns {object} AgentContext envelope
 */
export async function buildAssistantContext({
  user,
  identity,
  pages,
  googleContext = "",
  activePageConfig = null,
  activePageData = null,
  taskContext = "",
}) {
  // Generate session ID
  let sessionId;
  try {
    sessionId = crypto.randomUUID();
  } catch {
    sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  const userId = identity?.id || "single-user";
  const role = identity?.role || null;

  let userTier = "standard";
  if (role === "admin") userTier = "superuser";
  else if (role === "editor") userTier = "premium";

  // Build workspace summary from pages (same logic as ChatPanel's buildWorkspaceSummary)
  let workspaceSummary = "";
  if (pages?.length) {
    const lines = pages
      .filter((p) => !p._systemInternal)
      .map((p) => {
        const pt = p.page_type || p.pageType || p.type || "page";
        const dbIds = [...(p.databaseIds || [])];
        const localTypes = ["database", "sheet", "linked_sheet", "linked_monday", "linked_notion"];
        if (localTypes.includes(pt) && p.id && !dbIds.includes(p.id)) dbIds.push(p.id);
        const dbStr = dbIds.length ? ` (database_id: ${dbIds.join(", ")})` : "";
        return `- ${p.name || "Untitled"} [${pt}]${dbStr}`;
      });
    if (lines.length) {
      workspaceSummary = `Use query_database with the database_id to look up data.\n${lines.join("\n")}`;
    }
  }

  // Build active page context if available
  let currentPageContext = null;
  if (activePageConfig) {
    const pageName = activePageConfig.title || activePageConfig.name || "Untitled";
    const databaseIds = activePageConfig.databaseIds || [];
    const pageId = activePageConfig.id;
    if (pageId && !databaseIds.includes(pageId)) databaseIds.push(pageId);

    // Build lightweight schema text from columns if available
    let schemaText = "";
    if (activePageConfig.columns?.length) {
      const cols = activePageConfig.columns.map((c) => `${c.name} (${c.type})`);
      schemaText = cols.join(", ");
    }

    // Build data summary — record count + sample field values
    let dataSummary = "";
    if (activePageData?.rows?.length) {
      dataSummary = `${activePageData.rows.length} records loaded.`;
    }

    currentPageContext = { pageName, databaseIds, schemaText, dataSummary };
  }

  return {
    // --- Identity ---
    sessionId,
    userId,
    userTier,

    // --- Routing metadata (populated for future cheap-model routing) ---
    dispatch: "DIRECT_WORKER",
    routeReason: "assistant",
    estimatedWorkerCount: 1,
    dataDomains: [],

    // --- Frozen context (assembled once, never mutated) ---
    frozenContext: {
      kbEntries: "",
      neuronSummary: "",
      workspaceSummary,
      currentPageContext,
      dataSummary: "",
      platformDbIds: "",
      googleContext,
      agentMode: "assistant",
      workspaceInstructions: "",
      taskContext,
      builtAt: Date.now(),
    },

    // --- Conversation state (mutates across the loop) ---
    messages: [],
    priorSummary: null,
    toolCallLog: [],
    iterationCount: 0,
  };
}


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
