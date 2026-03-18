// ─── Wasabi Panel ───
// Collapsible tabbed panel that sits left of the sidebar.
// Tabs: Log, Chat, Notifications — matches original NotificationsInbox.
// Opens when user clicks the flame character at bottom of sidebar.
// No emojis — all SVG icons.

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";
import { TRANSITION } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { IconClose, IconLog, IconChat, IconSend, IconPaperclip } from "../design/icons.jsx";
import WasabiFlame from "./WasabiFlame.jsx";
import WasabiOrb from "./WasabiOrb.jsx";
import ChatUI from "./ChatUI.jsx";
import { runAgent, runAgentMultiPhase, extractQuestions, trimHistory } from "../agent/runAgent.js";
import { WASABI_TOOLS } from "../agent/tools.js";
import { buildWasabiPrompt } from "../agent/wasabiPrompt.js";
import { createToolExecutor } from "../agent/toolExecutor.js";
import { routeWithClassification, shouldEscalate, SONNET } from "../agent/aiRouter.js";
import { classifyQuery, formatClassifierResponse } from "../agent/queryClassifier.js";
import { buildNeuronContextSummary } from "../neurons/neuronStorage.js";
import { buildDataSummary, getTokenBudget, findWorkspaceAncestor } from "../agent/dataSummary.js";
import { fetchGoogleContext } from "../google/googleContext.js";
import BatchQueue from "./BatchQueue.jsx";
import * as api from "../lib/api.js";
// Legacy Notion imports removed — notifications now stored in D1
import { timeAgo } from "../utils/helpers.js";
import { downloadCSV, printPDF } from "../utils/reportExport.js";

// ── Tab button style ──
const tabBtn = (active) => ({
  flex: 1,
  padding: "7px 4px",
  border: "none",
  cursor: "pointer",
  fontFamily: FONT,
  fontSize: 10,
  background: active ? C.accent : "transparent",
  color: active ? "#fff" : C.darkMuted,
  borderRadius: 999,
  transition: "background 0.14s, color 0.14s",
  outline: "none",
});

// ── Log entry status colors (function for theme support) ──
function getStatusCol() {
  return {
    pending: { border: `1px solid ${C.darkBorder}`, bg: C.darkSurf2, dot: C.accent },
    processing: {
      border: "1px solid rgba(255,180,0,0.3)",
      bg: "rgba(255,180,0,0.06)",
      dot: "#C8960A",
    },
    actioned: { border: `1px solid ${C.darkBorder}`, bg: C.dark, dot: "#2A6B38" },
  };
}

const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 280;
const MAX_WIDTH = 640;

export default function WasabiPanel({ onClose, isThinking, activePageConfig, activePageData, pendingChatMessage, onClearPendingMessage, embedded = false }) {
  const { user, platformIds, pages, batchQueue, addToQueue, updateQueueItem, removeQueueItem, addPage } =
    usePlatform();
  const [tab, setTab] = useState("log");

  // ── Resize state ──
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startWidth: 0 });
  const isResized = panelWidth !== DEFAULT_WIDTH;

  // Drag handlers
  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: panelWidth };
    setIsDragging(true);
  }, [panelWidth]);

  useEffect(() => {
    if (!isDragging) return;

    const handleDragMove = (e) => {
      const delta = e.clientX - dragRef.current.startX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + delta));
      setPanelWidth(newWidth);
    };

    const handleDragEnd = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleDragMove);
    document.addEventListener("mouseup", handleDragEnd);

    // Prevent text selection while dragging
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleDragMove);
      document.removeEventListener("mouseup", handleDragEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  const handleMinimize = useCallback(() => {
    setPanelWidth(DEFAULT_WIDTH);
  }, []);

  // ── Log state ──
  const [logInput, setLogInput] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const logTextRef = useRef(null);
  const logEndRef = useRef(null);

  // ── Batch processing state ──
  const [isProcessing, setIsProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(null);

  // ── Chat state ──
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatStatus, setChatStatus] = useState(""); // live status text during agent runs
  const [chatChoices, setChatChoices] = useState([]);
  const [modelOverride, setModelOverride] = useState(null); // null = auto, "haiku" | "sonnet"
  const [lastTier, setLastTier] = useState(null); // tracks last auto-routed tier
  const chatHistoryRef = useRef([]);
  const chatAbortRef = useRef(false);
  const pendingClassificationRef = useRef(null); // stored when showing clarifying questions

  // ── Tool approval state (for "confirm" mode) ──
  const [pendingApproval, setPendingApproval] = useState(null);
  // { tools: [{ id, name, input }], resolve: (approved: boolean) => void }

  const handleToolApproval = useCallback(async (writeBlocks) => {
    return new Promise((resolve) => {
      setPendingApproval({
        tools: writeBlocks.map((b) => ({ id: b.id, name: b.name, input: b.input })),
        resolve,
      });
    });
  }, []);

  const handleApprovalDecision = useCallback((approved) => {
    if (pendingApproval?.resolve) {
      pendingApproval.resolve(approved);
    }
    setPendingApproval(null);
  }, [pendingApproval]);

  // Auto-resize log textarea
  const autoResize = () => {
    if (!logTextRef.current) return;
    logTextRef.current.style.height = "auto";
    logTextRef.current.style.height =
      Math.min(logTextRef.current.scrollHeight, 140) + "px";
  };

  // Scroll log to bottom on new entries
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [batchQueue]);

  // ── Log: add entry ──
  const addLogEntry = useCallback(() => {
    const text = logInput.trim();
    if (!text) return;
    addToQueue({ text, status: "pending" });
    setLogInput("");
    if (logTextRef.current) logTextRef.current.style.height = "auto";
  }, [logInput, addToQueue]);

  // ── Batch processing ──
  const handleProcessAll = useCallback(async () => {
    const pending = batchQueue.filter((i) => i.status === "pending");
    if (pending.length === 0 || isProcessing) return;

    setIsProcessing(true);
    setProcessProgress({ current: 0, total: pending.length });

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      setProcessProgress({ current: i, total: pending.length });
      updateQueueItem(item.id, { status: "processing" });

      try {
        const batchWorkspaceSummary = (pages || []).map((p) => {
          const dbIds = [...(p.databaseIds || [])];
          const pt = p.page_type || p.pageType;
          const localTypes = ["database", "sheet", "linked_sheet", "linked_monday", "linked_notion"];
          if (localTypes.includes(pt) && p.id && !dbIds.includes(p.id)) {
            dbIds.push(p.id);
          }
          const dbStr = dbIds.length ? ` (databases: ${dbIds.join(", ")})` : "";
          const extra = [];
          if (pt === "linked_monday" && p.mondayBoardId) extra.push(`monday board: ${p.mondayBoardId}`);
          if (pt === "linked_sheet") extra.push("read-only");
          const extraStr = extra.length ? ` {${extra.join(", ")}}` : "";
          return `- **${p.name || "Untitled"}** (${pt || p.type || "page"})${dbStr}${extraStr}`;
        }).join("\n");

        const systemPrompt = buildWasabiPrompt({
          platformDbIds: platformIds
            ? Object.entries(platformIds).map(([k, v]) => `${k}: ${v}`).join("\n")
            : "",
          workspaceSummary: batchWorkspaceSummary || undefined,
        });

        const bConn = api.getConnection();
        const bUrl = user?.workerUrl || bConn?.workerUrl;
        const executor = createToolExecutor({
          workerUrl: bUrl, notionKey: user?.notionKey || "", mondayKey: user?.mondayKey || "",
          parentPageId: platformIds?.rootPageId, kbDbId: platformIds?.kbDbId,
          notifDbId: platformIds?.notifDbId, configDbId: platformIds?.configDbId,
          rulesDbId: platformIds?.rulesDbId, onPageCreated: addPage,
          claudeKey: user?.claudeKey || "",
        });

        const batchBudget = getTokenBudget(item.text, 0);
        const { text: reply } = await runAgent({
          messages: [{ role: "user", content: item.text }],
          systemPrompt,
          tools: WASABI_TOOLS,
          model: "claude-sonnet-4-20250514",
          workerUrl: bUrl,
          claudeKey: user?.claudeKey || "",
          executeTool: (name, input) => executor(name, input),
          maxTokens: batchBudget.maxTokens,
          maxIterations: batchBudget.maxIterations,
        });

        updateQueueItem(item.id, { status: "actioned", result: reply });
      } catch (err) {
        console.error("[BatchQueue] Processing failed:", err);
        updateQueueItem(item.id, { status: "actioned", result: `Error: ${err.message}` });
      }
    }

    setProcessProgress({ current: pending.length, total: pending.length });
    setIsProcessing(false);
  }, [batchQueue, isProcessing, user, platformIds, pages, addPage, updateQueueItem]);

  // ── Chat: send message to Wasabi ──
  const toolExecutor = useCallback(
    async (toolName, toolInput) => {
      const conn = api.getConnection();
      const wUrl = user?.workerUrl || conn?.workerUrl;
      if (!wUrl) return "{}";
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
      const result = await executor(toolName, toolInput);

      // Handle export_report side effects (CSV download / PDF print dialog)
      if (toolName === "export_report") {
        try {
          const parsed = typeof result === "string" ? JSON.parse(result) : result;
          if (parsed?.__exportAction) {
            if (parsed.format === "csv") {
              downloadCSV(parsed.title, parsed.headers, parsed.rows);
            } else if (parsed.format === "pdf") {
              printPDF(parsed.title, parsed.headers, parsed.rows, parsed.summary);
            }
          }
        } catch { /* export handling is best-effort */ }
      }

      return result;
    },
    [user, platformIds, addPage]
  );

  const handleChatSend = useCallback(
    async ({ text, files }) => {
      if (chatLoading || (!text?.trim() && !files?.length)) return;
      setChatMessages((prev) => [...prev, { role: "user", content: text || "(files attached)" }]);
      setChatChoices([]);
      setChatLoading(true);
      setChatStatus("Preparing...");

      // Build agent message with file contents
      let agentText = text || "";
      if (files?.length) {
        const fileContents = files.map((f) =>
          `[File: ${f.name} (${f.type}, ${f.size > 1024 ? (f.size / 1024).toFixed(1) + " KB" : f.size + " B"})]\n${f.text || "[binary]"}`
        ).join("\n\n");
        agentText += `\n\nUploaded Files:\n${fileContents}`;
      }

      // Trim old history to prevent stale data from anchoring hallucinations
      const newHistory = [...trimHistory(chatHistoryRef.current, 3), { role: "user", content: agentText }];

      try {
        // Build workspace summary so Wasabi knows about all pages + all data sources
        const workspaceSummary = (pages || []).map((p) => {
          const dbIds = [...(p.databaseIds || [])];
          const pt = p.page_type || p.pageType;
          // For D1 tables, sheets, and ALL linked sources — the page's own ID is the queryable database_id
          const localTypes = ["database", "sheet", "linked_sheet", "linked_monday", "linked_notion"];
          if (localTypes.includes(pt) && p.id && !dbIds.includes(p.id)) {
            dbIds.push(p.id);
          }
          const dbStr = dbIds.length ? ` (databases: ${dbIds.join(", ")})` : "";
          const source = p.sourceType ? ` [${p.sourceType}]` : "";
          // Show linked source details so agent knows what it's connecting to
          const extra = [];
          if (pt === "linked_monday" && p.mondayBoardId) extra.push(`monday board: ${p.mondayBoardId}`);
          if (pt === "linked_sheet") extra.push("read-only");
          const extraStr = extra.length ? ` {${extra.join(", ")}}` : "";
          return `- **${p.name || "Untitled"}** (${pt || p.type || "page"})${source}${dbStr}${extraStr}`;
        }).join("\n");

        // Build page context — now includes schema + data summary when available
        const pageSchema = activePageData?.schema;
        const pageData = activePageData?.data;
        const dataSummary = (pageData && pageSchema) ? buildDataSummary(pageData, pageSchema) : "";

        const currentPageContext = activePageConfig ? {
          pageName: activePageConfig.name,
          databaseIds: activePageConfig.databaseIds || [],
          schemaText: pageSchema ? JSON.stringify(pageSchema, null, 2) : "",
        } : undefined;

        // Auto-search KB for relevant context (call D1 API directly, not toolExecutor)
        setChatStatus("Searching knowledge base...");
        let kbContext = "";
        let hasSpecificKBContext = false;
        try {
          const kbResult = await api.searchKB(agentText);
          if (kbResult?.results?.length > 0) {
            kbContext = kbResult.results.slice(0, 5).map((r) =>
              `- **${r.key || r.title || "Note"}** [${r.category || "general"}]: ${(r.content || r.value || "").slice(0, 300)}`
            ).join("\n");
            // Check if any KB hit has a non-general tag (domain-specific context → force Sonnet)
            hasSpecificKBContext = kbResult.results.slice(0, 5).some((r) =>
              r.category && r.category !== "general"
            );
          }
        } catch (_) { /* KB search is best-effort */ }

        // Build rich neuron summary (includes full node details when graph is cached)
        let neuronSummary = buildNeuronContextSummary();

        // Fetch Google context (best effort, cached 5 min)
        let googleContext = "";
        try {
          const gStatus = await api.getGoogleStatus();
          if (gStatus?.connected) {
            googleContext = await fetchGoogleContext();
          }
        } catch (_) { /* best effort */ }

        // Find workspace ancestor for custom AI instructions + agent mode
        let workspaceInstructions = "";
        let agentMode = "auto";
        if (activePageConfig) {
          const wsConfig = findWorkspaceAncestor(activePageConfig.id || activePageConfig.parentId, pages);
          const wsSettings = wsConfig?.settings || wsConfig?.config?.settings;
          if (wsSettings?.aiInstructions) workspaceInstructions = wsSettings.aiInstructions;
          if (wsSettings?.agentMode) agentMode = wsSettings.agentMode;
        }

        const systemPrompt = buildWasabiPrompt({
          platformDbIds: platformIds
            ? Object.entries(platformIds)
                .map(([k, v]) => `${k}: ${v}`)
                .join("\n")
            : "",
          workspaceSummary: workspaceSummary || undefined,
          currentPageContext,
          dataSummary,
          kbContext,
          neuronSummary,
          currentDate: new Date().toISOString().split("T")[0],
          workspaceInstructions,
          agentMode,
          googleContext,
        });

        const conn = api.getConnection();
        const wUrl = user?.workerUrl || conn?.workerUrl;

        // ── Query Classification (Haiku pre-check) ──
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
            workspaceSummary: workspaceSummary || "",
            tools: WASABI_TOOLS,
            workerUrl: wUrl,
            claudeKey: user?.claudeKey || "",
            conversationDepth: chatHistoryRef.current.length,
          });
          console.log("[QueryClassifier]", classification.strategy, classification.complexity, `est:${classification.estimated_tools} tools`);
        }

        // ── Short-circuit: clarify first (or show plan for expensive queries) ──
        if (classification.needs_clarification || (classification.estimated_tools >= 5 && classification.plan_summary)) {
          const clarifyMsg = formatClassifierResponse(classification);
          if (clarifyMsg) {
            const extracted = extractQuestions(clarifyMsg);
            setChatMessages((prev) => [...prev, { role: "assistant", content: clarifyMsg.replace(/\[Q:.*?\]/g, "").trim() }]);
            setChatChoices(extracted);
            // Store classification so the user's answer inherits the complexity
            pendingClassificationRef.current = { ...classification, needs_clarification: false };
            setChatLoading(false);
            setChatStatus("");
            return;
          }
        }

        // ── Smart model routing using classification ──
        const { model, tier, reason } = routeWithClassification({
          classification,
          override: modelOverride,
          conversationDepth: chatHistoryRef.current.length,
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
        const chatBudget = getTokenBudget(agentText, chatHistoryRef.current.length);

        // Use multi-phase for complex system-building tasks (early conversation only)
        const useMultiPhase = classification.complexity === "complex"
          && classification.estimated_tools >= 5
          && chatHistoryRef.current.length <= 2;

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
              onToolCall: undefined,
              onToolApproval: agentMode === "confirm" ? handleToolApproval : undefined,
              onStatus: onAgentStatus,
              abortRef: chatAbortRef,
              maxTokens: chatBudget.maxTokens,
              tier,
              routeReason: reason,
              preContext: neuronSummary || "",
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
              abortRef: chatAbortRef,
              maxTokens: chatBudget.maxTokens,
              maxIterations: chatBudget.maxIterations,
              tier,
              routeReason: reason,
            });

        // Auto-escalation: if Haiku gave a weak response, retry with Sonnet
        if (tier === "haiku" && !modelOverride && shouldEscalate(reply, agentText, toolCalls.length > 0)) {
          console.log("[AI Router] Global chat auto-escalating to Sonnet:", reason);
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
            abortRef: chatAbortRef,
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

        chatHistoryRef.current = history;
        const extracted = extractQuestions(reply);
        let cleanReply = reply;
        for (const c of extracted) {
          cleanReply = cleanReply.replace(c.raw, "").trim();
        }

        // Detect truncated responses (Claude hit max_tokens)
        const truncated = stopReason === "max_tokens";

        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: cleanReply, truncated },
        ]);
        setChatChoices(extracted);
      } catch (err) {
        console.error("Wasabi chat error:", err);
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${err.message}` },
        ]);
      } finally {
        setChatLoading(false);
        setChatStatus("");
      }
    },
    [chatLoading, user, platformIds, pages, activePageConfig, toolExecutor, modelOverride, handleToolApproval]
  );

  const handleChatChoice = useCallback(
    (choice) => {
      handleChatSend({ text: typeof choice === "string" ? choice : choice.label });
    },
    [handleChatSend]
  );

  // ── Pending chat message handoff (from FunctionBuilder) ──
  useEffect(() => {
    if (!pendingChatMessage) return;
    // Switch to chat tab
    if (tab !== "chat") setTab("chat");
    // Auto-send after UI settles
    const timer = setTimeout(() => {
      handleChatSend({ text: pendingChatMessage });
      onClearPendingMessage?.();
    }, 400);
    return () => clearTimeout(timer);
  }, [pendingChatMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingCount = batchQueue.filter((e) => e.status === "pending").length;

  return (
    <div
      style={{
        width: embedded ? "100%" : panelWidth,
        flexGrow: embedded ? 1 : 0,
        flexShrink: 0,
        flexBasis: embedded ? 0 : "auto",
        borderRight: "none",
        background: C.darkSurf,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minHeight: 0,
        fontFamily: FONT,
        position: "relative",
        transition: isDragging && !embedded ? "none" : embedded ? undefined : TRANSITION.panelResize,
      }}
    >
      {/* ── Header (hidden when embedded in SashimiChatPanel) ── */}
      {!embedded && (
      <div
        style={{
          padding: "14px 14px 0",
          flexShrink: 0,
          background: C.dark,
        }}
      >
        {/* Character + close */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <WasabiFlame size={28} isThinking={isThinking} />
          <span
            style={{
              fontFamily: FONT,
              fontSize: 13,
              fontWeight: 600,
              color: C.darkText,
              letterSpacing: "0.01em",
            }}
          >
            Wasabi
          </span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 2 }}>
            {/* Minimize button — only visible when panel has been resized */}
            {isResized && (
              <button
                onClick={handleMinimize}
                title="Reset to default size"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: C.darkMuted,
                  padding: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: RADIUS.sm,
                  transition: "color 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = C.darkText; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>
            )}
            <button
              onClick={onClose}
              title="Close"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: C.darkMuted,
                padding: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: RADIUS.sm,
                transition: "color 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = C.darkText; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
            >
              <IconClose size={12} color="currentColor" />
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Tab bar (always visible, including when embedded) */}
      <div
        style={{
          display: "flex",
          gap: 3,
          margin: embedded ? "0 10px 8px" : "0 14px 12px",
          background: C.darkSurf,
          borderRadius: 999,
          padding: 3,
          flexShrink: 0,
          borderBottom: `1px solid ${C.darkBorder}`,
        }}
      >
        <button style={tabBtn(tab === "log")} onClick={() => setTab("log")}>
          Log{pendingCount > 0 ? ` (${pendingCount})` : ""}
        </button>
        <button style={tabBtn(tab === "chat")} onClick={() => setTab("chat")}>
          Chat
        </button>
      </div>

      {/* ═══ LOG TAB ═══ */}
      {tab === "log" && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* BatchQueue handles the item list + process button */}
          <BatchQueue
            items={batchQueue}
            onProcess={handleProcessAll}
            onUpdateItem={updateQueueItem}
            onRemoveItem={removeQueueItem}
            isProcessing={isProcessing}
            processProgress={processProgress}
          />

          {/* Log input */}
          <div style={{ padding: "10px 12px 14px", flexShrink: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 10,
                background: C.dark,
                border: "none",
                borderRadius: 999,
                padding: "10px 16px",
                boxShadow: "0 4px 24px rgba(0,0,0,0.22)",
              }}
            >
              <textarea
                ref={logTextRef}
                value={logInput}
                onChange={(e) => {
                  setLogInput(e.target.value);
                  autoResize();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    addLogEntry();
                  }
                }}
                placeholder="Add to log..."
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: C.darkText,
                  fontFamily: FONT,
                  fontSize: 13,
                  lineHeight: 1.6,
                  resize: "none",
                  maxHeight: 140,
                  minHeight: 24,
                }}
                rows={1}
              />
              <button
                onClick={addLogEntry}
                disabled={!logInput.trim()}
                style={{
                  width: 36,
                  height: 36,
                  border: "none",
                  borderRadius: "50%",
                  cursor: logInput.trim() ? "pointer" : "default",
                  background: logInput.trim() ? C.accent : C.darkBorder,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  transition: "background 0.15s",
                  outline: "none",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ CHAT TAB ═══ */}
      {tab === "chat" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Model toggle pill */}
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 10px 0" }}>
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
              {modelOverride === null ? "Auto" : modelOverride === "sonnet" ? "Sonnet" : "Haiku"}
            </button>
          </div>
          <ChatUI
            messages={chatMessages}
            onSend={handleChatSend}
            isLoading={chatLoading}
            statusText={chatStatus}
            choices={chatChoices}
            onChoice={handleChatChoice}
            allowFiles={true}
            agentName="Wasabi"
            agentIcon={<WasabiOrb size={28} />}
            placeholder="Ask Wasabi anything..."
            compact={true}
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
      )}

      {/* ── Drag handle (right edge, hidden when embedded) ── */}
      {!embedded && (
      <div
        onMouseDown={handleDragStart}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: 6,
          height: "100%",
          cursor: "col-resize",
          zIndex: 20,
          background: isDragging ? C.accent + "44" : "transparent",
          borderRight: `1px solid ${C.darkBorder}`,
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => { if (!isDragging) e.currentTarget.style.background = C.accent + "22"; }}
        onMouseLeave={(e) => { if (!isDragging) e.currentTarget.style.background = "transparent"; }}
      />
      )}
    </div>
  );
}
