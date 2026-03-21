// ─── Chat Panel (Wasabi Agent) ───
// Single global Wasabi agent with smart model routing.
// Haiku-first with auto-escalation to Sonnet when needed.
// Injects data summary for immediate awareness.

import React, { useState, useCallback, useRef, useMemo } from "react";
import ChatUI from "../core/ChatUI.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
import { runAgent, runAgentMultiPhase, extractQuestions, trimHistory } from "../agent/runAgent.js";
import { WASABI_TOOLS } from "../agent/tools.js";
import { buildWasabiPrompt } from "../agent/wasabiPrompt.js";
import { createToolExecutor } from "../agent/toolExecutor.js";
import { getConnection, searchKB as apiSearchKB } from "../lib/api.js";
import { C, FONT, RADIUS } from "../design/tokens.js";
import WasabiOrb from "../core/WasabiOrb.jsx";
import { buildNeuronContextSummary } from "../neurons/neuronStorage.js";
import { routeWithClassification, shouldEscalate, SONNET } from "../agent/aiRouter.js";
import { classifyQuery, formatClassifierResponse } from "../agent/queryClassifier.js";
import { buildDataSummary, getTokenBudget, findWorkspaceAncestor } from "../agent/dataSummary.js";
import { getGoogleStatus } from "../lib/api.js";
import { fetchGoogleContext } from "../google/googleContext.js";

export default function ChatPanel({ pageConfig, schema, data, onRefresh }) {
  const { user, platformIds, addPage, pages } = usePlatform();
  const [displayMessages, setDisplayMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [chatStatus, setChatStatus] = useState("");
  const [choices, setChoices] = useState([]);
  const [modelOverride, setModelOverride] = useState(null); // null = auto, "haiku" | "sonnet"
  const [lastTier, setLastTier] = useState(null); // tracks last auto-routed tier
  const historyRef = useRef([]);
  const abortRef = useRef(false);
  const pendingClassificationRef = useRef(null); // stored when showing clarifying questions

  // ── Tool approval state (for "confirm" mode) ──
  const [pendingApproval, setPendingApproval] = useState(null);

  const handleToolApproval = useCallback(async (writeBlocks) => {
    return new Promise((resolve) => {
      setPendingApproval({
        tools: writeBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input })),
        resolve,
      });
    });
  }, []);

  const handleApprovalDecision = useCallback((approved) => {
    if (pendingApproval?.resolve) pendingApproval.resolve(approved);
    setPendingApproval(null);
  }, [pendingApproval]);

  // Single Wasabi executor — full tool access, no scoping
  const toolExecutor = useCallback((toolName, toolInput) => {
    const conn = getConnection();
    const wUrl = user?.workerUrl || conn?.workerUrl;
    const executor = createToolExecutor({
      workerUrl: wUrl,
      notionKey: user?.notionKey || "",
      mondayKey: user?.mondayKey || "",
      parentPageId: platformIds?.rootPageId,
      kbDbId: platformIds?.kbDbId,
      notifDbId: platformIds?.notifDbId,
      configDbId: platformIds?.configDbId,
      rulesDbId: platformIds?.rulesDbId,
      onPageCreated: addPage,
      claudeKey: user?.claudeKey || "",
    });
    return executor(toolName, toolInput);
  }, [user, platformIds, addPage]);

  // Pre-compute data summary
  const dataSummary = useMemo(() => buildDataSummary(data, schema), [data, schema]);

  const handleSend = useCallback(async ({ text, files }) => {
    if (isLoading) return;

    setDisplayMessages((prev) => [...prev, { role: "user", content: text }]);
    setChoices([]);
    setIsLoading(true);
    setChatStatus("Preparing...");

    let agentText = text;
    if (files?.length) {
      const fileContents = files.map((f) => `[File: ${f.name}]\n${f.text || "[binary]"}`).join("\n\n");
      agentText += `\n\nFiles:\n${fileContents}`;
    }

    const userMsg = { role: "user", content: agentText };
    // Trim old history to prevent stale data from anchoring hallucinations
    const newHistory = [...trimHistory(historyRef.current, 3), userMsg];

    try {
      // Build rich neuron summary (includes node details when graph is cached)
      const neuronSummary = buildNeuronContextSummary();

      // Fetch Google context (best effort, cached 5 min)
      let googleContext = "";
      try {
        const gStatus = await getGoogleStatus();
        if (gStatus?.connected) {
          googleContext = await fetchGoogleContext();
        }
      } catch (err) { console.warn("[ChatPanel] Google context fetch:", err.message || err); }

      // Auto-search KB for relevant context (call D1 API directly, not toolExecutor)
      let kbContext = "";
      let hasSpecificKBContext = false;
      try {
        const kbResult = await apiSearchKB(agentText);
        if (kbResult?.results?.length > 0) {
          kbContext = kbResult.results.slice(0, 5).map((r) =>
            `- **${r.key || r.title || "Note"}** [${r.category || "general"}]: ${(r.content || r.value || "").slice(0, 300)}`
          ).join("\n");
          // Check if any KB hit has a non-general tag (domain-specific context → force Sonnet)
          hasSpecificKBContext = kbResult.results.slice(0, 5).some((r) =>
            r.category && r.category !== "general"
          );
        }
      } catch (err) { console.warn("[ChatPanel] KB search:", err.message || err); }

      // Build database IDs list — include D1 table ID if this page IS a database
      const dbIds = [...(pageConfig.databaseIds || [])];
      const pt = pageConfig.page_type || pageConfig.pageType;
      if ((pt === "database" || pt === "sheet") && pageConfig.id && !dbIds.includes(pageConfig.id)) {
        dbIds.push(pageConfig.id);
      }

      // Find workspace ancestor for custom AI instructions + agent mode
      const wsConfig = findWorkspaceAncestor(pageConfig.id || pageConfig.parentId, pages);
      const wsSettings = wsConfig?.settings || wsConfig?.config?.settings;
      const workspaceInstructions = wsSettings?.aiInstructions || "";
      const agentMode = wsSettings?.agentMode || "auto";

      // Build Wasabi prompt with page context + data summary
      const systemPrompt = buildWasabiPrompt({
        platformDbIds: Object.entries(platformIds || {}).map(([k, v]) => `${k}: ${v}`).join("\n"),
        currentPageContext: {
          pageName: pageConfig.name,
          databaseIds: dbIds,
          schemaText: schema ? JSON.stringify(schema, null, 2) : "",
        },
        dataSummary,
        neuronSummary,
        kbContext,
        currentDate: new Date().toISOString().split("T")[0],
        workspaceInstructions,
        agentMode,
        googleContext,
      });

      // ── Query Classification (Haiku pre-check) ──
      const conn = getConnection();
      const wUrl = user?.workerUrl || conn?.workerUrl;

      // If we have a stored classification from a clarification exchange, reuse it
      let classification;
      const storedClassification = pendingClassificationRef.current;

      if (storedClassification) {
        // User is answering a clarifying question — use the original classification
        classification = storedClassification;
        pendingClassificationRef.current = null; // consume it
        console.log("[QueryClassifier] Reusing stored classification:", classification.strategy, classification.complexity, `est:${classification.estimated_tools} tools`);
      } else {
        setChatStatus("Analyzing query...");
        classification = await classifyQuery({
          text: agentText,
          workspaceSummary: "", // Page-level chat — no workspace summary needed
          tools: WASABI_TOOLS,
          workerUrl: wUrl,
          claudeKey: user?.claudeKey || "",
          conversationDepth: historyRef.current.length,
        });
        console.log("[QueryClassifier]", classification.strategy, classification.complexity, `est:${classification.estimated_tools} tools`);
      }

      // ── Short-circuit: clarify first (or show plan for expensive queries) ──
      if (classification.needs_clarification || (classification.estimated_tools >= 5 && classification.plan_summary)) {
        const clarifyMsg = formatClassifierResponse(classification);
        if (clarifyMsg) {
          const extracted = extractQuestions(clarifyMsg);
          setDisplayMessages((prev) => [...prev, { role: "assistant", content: clarifyMsg.replace(/\[Q:.*?\]/g, "").trim() }]);
          setChoices(extracted);
          // Add clarification to history so the agent knows it asked these questions
          historyRef.current = [...newHistory, { role: "assistant", content: clarifyMsg }];
          // Store classification so the user's answer inherits the complexity
          pendingClassificationRef.current = { ...classification, needs_clarification: false };
          setIsLoading(false);
          setChatStatus("");
          return;
        }
      }

      // ── Smart model routing using classification ──
      const { model, tier, reason } = routeWithClassification({
        classification,
        override: modelOverride,
        conversationDepth: historyRef.current.length,
        hasSpecificKBContext,
      });
      setLastTier(tier);

      // ── Build execution hints from classification ──
      let classifierHints = "";
      if (classification.strategy === "parallel_fetch" && classification.data_sources?.length >= 2) {
        classifierHints = `\n## Execution Hint\nThis query involves ${classification.data_sources.length} data sources: ${classification.data_sources.join(", ")}. Query each source directly for accurate results.`;
      }
      if (classification.estimated_tools >= 5 && classification.plan_summary) {
        classifierHints += `\n## Query Plan\nBriefly state your plan in one sentence before executing, then proceed: "${classification.plan_summary}"`;
      }

      const finalSystemPrompt = classifierHints
        ? systemPrompt + classifierHints
        : systemPrompt;

      setChatStatus("Thinking...");
      const chatBudget = getTokenBudget(agentText, historyRef.current.length);

      const useMultiPhase = classification.complexity === "complex"
        && classification.estimated_tools >= 5
        && historyRef.current.length <= 2;

      const onAgentStatus = (s) => setChatStatus(s);

      let { text: reply, history, toolCalls, stopReason } = useMultiPhase
        ? await runAgentMultiPhase({
            messages: newHistory,
            systemPrompt: finalSystemPrompt,
            orientTools: WASABI_TOOLS,
            executeTools: WASABI_TOOLS,
            model,
            workerUrl: wUrl,
            claudeKey: user?.claudeKey || "",
            executeTool: toolExecutor,
            onToolApproval: agentMode === "confirm" ? handleToolApproval : undefined,
            onStatus: onAgentStatus,
            abortRef,
            maxTokens: chatBudget.maxTokens,
            tier,
            routeReason: reason,
          })
        : await runAgent({
            messages: newHistory,
            systemPrompt: finalSystemPrompt,
            tools: WASABI_TOOLS,
            model,
            workerUrl: wUrl,
            claudeKey: user?.claudeKey || "",
            executeTool: toolExecutor,
            onToolApproval: agentMode === "confirm" ? handleToolApproval : undefined,
            onStatus: onAgentStatus,
            abortRef,
            maxTokens: chatBudget.maxTokens,
            maxIterations: chatBudget.maxIterations,
            tier,
            routeReason: reason,
          });

      // Auto-escalation: if Haiku gave a weak response, retry with Sonnet
      if (tier === "haiku" && !modelOverride && shouldEscalate(reply, agentText, toolCalls.length > 0)) {
        console.log("[AI Router] Auto-escalating to Sonnet:", reason);
        setLastTier("sonnet");
        setChatStatus("Escalating to Sonnet...");
        const escalated = await runAgent({
          messages: newHistory,
          systemPrompt: finalSystemPrompt,
          tools: WASABI_TOOLS,
          model: SONNET,
          workerUrl: wUrl,
          claudeKey: user?.claudeKey || "",
          executeTool: toolExecutor,
          onStatus: onAgentStatus,
          abortRef,
          maxTokens: chatBudget.maxTokens,
          maxIterations: chatBudget.maxIterations,
          tier: "sonnet",
          routeReason: "auto_escalation",
        });
        reply = escalated.text;
        history = escalated.history;
        toolCalls = escalated.toolCalls;
        stopReason = escalated.stopReason;
      }

      historyRef.current = history;

      const extracted = extractQuestions(reply);
      let cleanReply = reply;
      for (const c of extracted) {
        cleanReply = cleanReply.replace(c.raw, "").trim();
      }

      const truncated = stopReason === "max_tokens";
      setDisplayMessages((prev) => [...prev, { role: "assistant", content: cleanReply, truncated }]);
      setChoices(extracted);

      // Refresh data after agent actions
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Chat error:", err);
      setDisplayMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${err.message}` },
      ]);
    } finally {
      setIsLoading(false);
      setChatStatus("");
    }
  }, [isLoading, user, platformIds, pageConfig, schema, dataSummary, toolExecutor, modelOverride, handleToolApproval, pages]);

  const handleChoice = useCallback((choice) => {
    handleSend({ text: typeof choice === "string" ? choice : choice.label });
  }, [handleSend]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Wasabi agent indicator + model toggle */}
      <div style={{
        padding: "8px 16px",
        borderBottom: `1px solid ${C.darkBorder}`,
        fontSize: 11,
        color: C.darkMuted,
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: C.darkSurf,
      }}>
        <WasabiOrb size={18} />
        <span>Wasabi</span>
        <span style={{ opacity: 0.4 }}>&middot;</span>
        <span style={{ opacity: 0.6, flex: 1 }}>{pageConfig.name}</span>
        <button
          onClick={() => {
            const next = modelOverride === null ? "sonnet" : modelOverride === "sonnet" ? "haiku" : null;
            setModelOverride(next);
          }}
          style={{
            background: modelOverride ? (modelOverride === "sonnet" ? C.accent + "22" : C.darkSurf2) : "transparent",
            border: `1px solid ${modelOverride ? (modelOverride === "sonnet" ? C.accent + "44" : C.darkBorder) : C.darkBorder}`,
            borderRadius: 999,
            padding: "2px 8px",
            fontSize: 9,
            color: modelOverride === "sonnet" ? C.accent : C.darkMuted,
            cursor: "pointer",
            fontFamily: "inherit",
            lineHeight: 1.4,
            transition: "all 0.15s",
            outline: "none",
          }}
          title={modelOverride === null ? "Auto model (click to pin Sonnet)" : modelOverride === "sonnet" ? "Pinned to Sonnet (click for Haiku)" : "Pinned to Haiku (click for Auto)"}
        >
          {modelOverride === null
            ? `Auto${lastTier ? ` (${lastTier})` : ""}`
            : modelOverride === "sonnet" ? "Sonnet" : "Haiku"}
        </button>
      </div>

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <ChatUI
          messages={displayMessages}
          onSend={handleSend}
          isLoading={isLoading}
          statusText={chatStatus}
          choices={choices}
          onChoice={handleChoice}
          allowFiles={true}
          agentName="Wasabi"
          agentIcon={<WasabiOrb size={28} />}
          placeholder={`Ask Wasabi about ${pageConfig.name}...`}
        />

        {/* ── Tool Approval Card (confirm mode) ── */}
        {pendingApproval && (
          <div style={{
            position: "absolute",
            bottom: 80,
            left: 12,
            right: 12,
            background: C.darkSurf,
            border: `1px solid ${C.accent}44`,
            borderRadius: RADIUS.lg,
            padding: "14px 16px",
            zIndex: 20,
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.accent, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Approve Actions
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
              {pendingApproval.tools.map((tool, i) => (
                <div key={i} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  background: C.darkSurf2,
                  borderRadius: RADIUS.md,
                  fontSize: 12,
                  color: C.darkText,
                }}>
                  <span style={{ fontWeight: 600, color: C.accent, fontSize: 11, flexShrink: 0 }}>
                    {tool.name.replace(/_/g, " ")}
                  </span>
                  <span style={{ color: C.darkMuted, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {tool.name === "create_page" && tool.input?.title ? `"${tool.input.title}"` :
                     tool.name === "update_page" && tool.input?.page_id ? `page ${tool.input.page_id.slice(0, 8)}...` :
                     tool.name === "batch_operations" && tool.input?.operations ? `${tool.input.operations.length} operations` :
                     tool.input?.database_id ? `db ${tool.input.database_id.slice(0, 8)}...` :
                     ""}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => handleApprovalDecision(true)}
                style={{
                  flex: 1,
                  padding: "8px 14px",
                  background: C.accent,
                  border: "none",
                  borderRadius: RADIUS.md,
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                Approve
              </button>
              <button
                onClick={() => handleApprovalDecision(false)}
                style={{
                  flex: 1,
                  padding: "8px 14px",
                  background: "transparent",
                  border: `1px solid ${C.darkBorder}`,
                  borderRadius: RADIUS.md,
                  color: C.darkMuted,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                Deny
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
