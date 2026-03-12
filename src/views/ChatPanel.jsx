// ─── Chat Panel (Wasabi Agent) ───
// Single global Wasabi agent with smart model routing.
// Haiku-first with auto-escalation to Sonnet when needed.
// Injects data summary for immediate awareness.

import React, { useState, useCallback, useRef, useMemo } from "react";
import ChatUI from "../core/ChatUI.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
import { runAgent, runAgentMultiPhase, shouldUseMultiPhase, extractChoices } from "../agent/runAgent.js";
import { WASABI_TOOLS } from "../agent/tools.js";
import { buildWasabiPrompt } from "../agent/wasabiPrompt.js";
import { createToolExecutor } from "../agent/toolExecutor.js";
import { getConnection } from "../lib/api.js";
import { C } from "../design/tokens.js";
import WasabiOrb from "../core/WasabiOrb.jsx";
import { loadCachedNeurons } from "../neurons/neuronStorage.js";
import { routeModel, shouldEscalate, SONNET } from "../agent/aiRouter.js";
import { buildDataSummary, getTokenBudget, findWorkspaceAncestor } from "../agent/dataSummary.js";

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
    const newHistory = [...historyRef.current, userMsg];

    try {
      // Build neuron summary from cached data
      const cachedNeurons = loadCachedNeurons();
      const neuronSummary = cachedNeurons.length > 0
        ? cachedNeurons.slice(0, 20).map((n) =>
            `- ${n.name || "(unnamed)"} (${n.node_count || 0} nodes, id: ${n.id})`
          ).join("\n")
        : "";

      // Auto-search KB for relevant context
      let kbContext = "";
      try {
        const kbResult = await toolExecutor("search_knowledge_base", { query: agentText });
        const parsed = typeof kbResult === "string" ? JSON.parse(kbResult) : kbResult;
        if (parsed?.results?.length > 0) {
          kbContext = parsed.results.slice(0, 5).map((r) =>
            `- **${r.key || r.title || "Note"}**: ${(r.content || r.value || "").slice(0, 300)}`
          ).join("\n");
        }
      } catch (_) { /* KB search is best-effort */ }

      // Build database IDs list — include D1 table ID if this page IS a database
      const dbIds = [...(pageConfig.databaseIds || [])];
      const pt = pageConfig.page_type || pageConfig.pageType;
      if ((pt === "database" || pt === "sheet") && pageConfig.id && !dbIds.includes(pageConfig.id)) {
        dbIds.push(pageConfig.id);
      }

      // Find workspace ancestor for custom AI instructions
      const wsConfig = findWorkspaceAncestor(pageConfig.id || pageConfig.parentId, pages);
      const wsSettings = wsConfig?.settings || wsConfig?.config?.settings;
      const workspaceInstructions = wsSettings?.aiInstructions || "";

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
      });

      // ── Haiku-first smart routing ──
      const { model, tier, reason } = routeModel({
        text: agentText,
        override: modelOverride,
        conversationDepth: historyRef.current.length,
        toolCount: WASABI_TOOLS.length,
      });
      setLastTier(tier);

      setChatStatus("Thinking...");
      const conn = getConnection();
      const wUrl = user?.workerUrl || conn?.workerUrl;
      const chatBudget = getTokenBudget(agentText, historyRef.current.length);
      const useMultiPhase = shouldUseMultiPhase(agentText) && historyRef.current.length <= 2;

      const onAgentStatus = (s) => setChatStatus(s);

      let { text: reply, history, toolCalls, stopReason } = useMultiPhase
        ? await runAgentMultiPhase({
            messages: newHistory,
            systemPrompt,
            orientTools: WASABI_TOOLS,
            executeTools: WASABI_TOOLS,
            model,
            workerUrl: wUrl,
            claudeKey: user?.claudeKey || "",
            executeTool: toolExecutor,
            onStatus: onAgentStatus,
            abortRef,
            maxTokens: chatBudget.maxTokens,
            tier,
            routeReason: reason,
          })
        : await runAgent({
            messages: newHistory,
            systemPrompt,
            tools: WASABI_TOOLS,
            model,
            workerUrl: wUrl,
            claudeKey: user?.claudeKey || "",
            executeTool: toolExecutor,
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
          systemPrompt,
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

      const extracted = extractChoices(reply);
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
  }, [isLoading, user, platformIds, pageConfig, schema, dataSummary, toolExecutor, modelOverride]);

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
    </div>
  );
}
