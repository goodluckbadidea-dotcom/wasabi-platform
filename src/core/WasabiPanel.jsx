// ─── Wasabi Panel ───
// Collapsible tabbed panel that sits left of the sidebar.
// Tabs: Log, Chat, Notifications — matches original NotificationsInbox.
// Opens when user clicks the flame character at bottom of sidebar.
// No emojis — all SVG icons.

import React, { useState, useRef, useCallback, useEffect } from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { IconClose, IconLog, IconChat, IconBell, IconSend, IconPaperclip } from "../design/icons.jsx";
import WasabiFlame from "./WasabiFlame.jsx";
import WasabiOrb from "./WasabiOrb.jsx";
import ChatUI from "./ChatUI.jsx";
import { runAgent, runAgentMultiPhase, shouldUseMultiPhase, extractChoices } from "../agent/runAgent.js";
import { WASABI_TOOLS } from "../agent/tools.js";
import { buildWasabiPrompt } from "../agent/wasabiPrompt.js";
import { createToolExecutor } from "../agent/toolExecutor.js";
import { routeModel, shouldEscalate, SONNET } from "../agent/aiRouter.js";
import { loadCachedNeurons } from "../neurons/neuronStorage.js";
import { buildDataSummary, getTokenBudget, findWorkspaceAncestor } from "../agent/dataSummary.js";
import BatchQueue from "./BatchQueue.jsx";
import * as api from "../lib/api.js";
// Legacy Notion imports removed — notifications now stored in D1
import { timeAgo } from "../utils/helpers.js";

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

export default function WasabiPanel({ onClose, isThinking, activePageConfig, activePageData }) {
  const { user, platformIds, pages, batchQueue, addToQueue, updateQueueItem, removeQueueItem, addPage } =
    usePlatform();
  const [tab, setTab] = useState("log");

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

  // ── Notifications state ──
  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const notifFetched = useRef(false);

  const fetchNotifications = useCallback(async () => {
    setNotifLoading(true);
    try {
      const result = await api.listNotifications({ limit: 50 });
      const parsed = (result.notifications || []).map((row) => ({
        id: row.id,
        text: row.message || "",
        read: row.status === "read",
        timestamp: row.created_at || "",
        source: row.source || "",
      }));
      setNotifications(parsed);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    } finally {
      setNotifLoading(false);
    }
  }, []);

  // Fetch notifications when tab is first opened
  useEffect(() => {
    if (tab === "notifications" && !notifFetched.current) {
      notifFetched.current = true;
      fetchNotifications();
    }
  }, [tab, fetchNotifications]);

  const markNotifRead = useCallback(async (notifId) => {
    setNotifications((prev) => prev.map((n) => (n.id === notifId ? { ...n, read: true } : n)));
    try {
      await api.updateNotification(notifId, { status: "read" });
    } catch (err) {
      console.error("Failed to mark notification read:", err);
    }
  }, []);

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
    (toolName, toolInput) => {
      const conn = api.getConnection();
      const wUrl = user?.workerUrl || conn?.workerUrl;
      if (!wUrl) return Promise.resolve("{}");
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
      });
      return executor(toolName, toolInput);
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

      const newHistory = [...chatHistoryRef.current, { role: "user", content: agentText }];

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

        // Auto-search KB for relevant context
        setChatStatus("Searching knowledge base...");
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

        // Build neuron summary from cached data + proactive query for relevant connections
        const cachedNeurons = loadCachedNeurons();
        let neuronSummary = cachedNeurons.length > 0
          ? cachedNeurons.slice(0, 20).map((n) =>
              `- ${n.name || "(unnamed)"} (${n.node_count || 0} nodes, id: ${n.id})`
            ).join("\n")
          : "";

        // Proactive neuron query for non-trivial messages
        if (agentText.length > 50) {
          setChatStatus("Querying neurons...");
          try {
            const neuronResult = await toolExecutor("query_neurons", { query: agentText });
            const parsed = typeof neuronResult === "string" ? JSON.parse(neuronResult) : neuronResult;
            if (parsed?.neurons?.length > 0) {
              const connections = parsed.neurons.slice(0, 5).map((n) =>
                `- **${n.name || "Connection"}**: ${(n.nodes || []).map((nd) => nd.label || nd.source_title || "?").join(" ↔ ")}`
              ).join("\n");
              if (connections) neuronSummary += (neuronSummary ? "\n\n### Relevant Connections\n" : "") + connections;
            }
          } catch (_) { /* neuron query is best-effort */ }
        }

        // Find workspace ancestor for custom AI instructions
        let workspaceInstructions = "";
        if (activePageConfig) {
          const wsConfig = findWorkspaceAncestor(activePageConfig.id || activePageConfig.parentId, pages);
          const wsSettings = wsConfig?.settings || wsConfig?.config?.settings;
          if (wsSettings?.aiInstructions) workspaceInstructions = wsSettings.aiInstructions;
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
        });

        const conn = api.getConnection();
        const wUrl = user?.workerUrl || conn?.workerUrl;

        // ── Shared model routing ──
        const { model, tier, reason } = routeModel({
          text: agentText,
          override: modelOverride,
          conversationDepth: chatHistoryRef.current.length,
          toolCount: WASABI_TOOLS.length,
        });
        setLastTier(tier);

        setChatStatus("Thinking...");
        const chatBudget = getTokenBudget(agentText, chatHistoryRef.current.length);
        const useMultiPhase = shouldUseMultiPhase(agentText) && chatHistoryRef.current.length <= 2;

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
              onToolCall: undefined,
              onStatus: onAgentStatus,
              abortRef: chatAbortRef,
              maxTokens: chatBudget.maxTokens,
              tier,
              routeReason: reason,
              preContext: neuronSummary || "",
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
            systemPrompt,
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
        const extracted = extractChoices(reply);
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
    [chatLoading, user, platformIds, pages, activePageConfig, toolExecutor, modelOverride]
  );

  const handleChatChoice = useCallback(
    (choice) => {
      handleChatSend({ text: typeof choice === "string" ? choice : choice.label });
    },
    [handleChatSend]
  );

  const pendingCount = batchQueue.filter((e) => e.status === "pending").length;
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div
      style={{
        width: 320,
        flexShrink: 0,
        borderRight: `1px solid ${C.darkBorder}`,
        background: C.darkSurf,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minHeight: 0,
        fontFamily: FONT,
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          padding: "14px 14px 0",
          flexShrink: 0,
          borderBottom: `1px solid ${C.darkBorder}`,
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
          <button
            onClick={onClose}
            title="Close"
            style={{
              marginLeft: "auto",
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
            onMouseEnter={(e) => {
              e.currentTarget.style.color = C.darkText;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = C.darkMuted;
            }}
          >
            <IconClose size={12} color="currentColor" />
          </button>
        </div>

        {/* Tab bar */}
        <div
          style={{
            display: "flex",
            gap: 3,
            marginBottom: 12,
            background: C.darkSurf,
            borderRadius: 999,
            padding: 3,
          }}
        >
          <button style={tabBtn(tab === "log")} onClick={() => setTab("log")}>
            Log{pendingCount > 0 ? ` (${pendingCount})` : ""}
          </button>
          <button style={tabBtn(tab === "chat")} onClick={() => setTab("chat")}>
            Chat
          </button>
          <button
            style={tabBtn(tab === "notifications")}
            onClick={() => setTab("notifications")}
          >
            Inbox{unreadCount > 0 ? ` (${unreadCount})` : ""}
          </button>
        </div>
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
        </div>
      )}

      {/* ═══ NOTIFICATIONS TAB ═══ */}
      {tab === "notifications" && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "12px 12px 6px",
            }}
          >
            {/* Refresh button */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
              <button
                onClick={() => { notifFetched.current = false; fetchNotifications(); }}
                style={{ background: "none", border: "none", color: C.accent, fontSize: 10, cursor: "pointer", fontFamily: FONT, padding: "2px 6px" }}
              >
                Refresh
              </button>
            </div>

            {notifLoading && (
              <div style={{ textAlign: "center", color: C.darkMuted, fontSize: 10, marginTop: 20 }}>
                Loading notifications...
              </div>
            )}

            {!notifLoading && notifications.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  color: C.darkMuted,
                  fontSize: 10,
                  marginTop: 40,
                  lineHeight: 2,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                <IconBell size={22} color={C.darkMuted} style={{ marginBottom: 8 }} />
                <br />
                No notifications
                <br />
                <span style={{ fontSize: 9, opacity: 0.6 }}>
                  Automations and agents will post here
                </span>
              </div>
            )}
            {notifications.map((notif, idx) => (
              <div
                key={notif.id || idx}
                style={{
                  marginBottom: 8,
                  borderRadius: 8,
                  border: `1px solid ${notif.read ? C.darkBorder : C.accent + "44"}`,
                  background: notif.read ? C.dark : C.darkSurf2,
                  padding: "9px 10px",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                  {!notif.read && (
                    <div style={{ width: 6, height: 6, borderRadius: 3, background: C.accent, marginTop: 5, flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: C.darkText, lineHeight: 1.55 }}>
                      {notif.text || notif.content}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      {notif.source && (
                        <span style={{ fontSize: 9, color: C.accent, background: C.accent + "18", padding: "1px 5px", borderRadius: 3 }}>
                          {notif.source}
                        </span>
                      )}
                      {notif.timestamp && (
                        <span style={{ fontSize: 9, color: C.darkMuted, fontFamily: MONO }}>
                          {timeAgo(notif.timestamp)}
                        </span>
                      )}
                    </div>
                  </div>
                  {!notif.read && (
                    <button
                      onClick={() => markNotifRead(notif.id)}
                      style={{
                        background: "none",
                        border: `1px solid ${C.darkBorder}`,
                        borderRadius: 4,
                        color: C.darkMuted,
                        fontSize: 9,
                        cursor: "pointer",
                        padding: "2px 6px",
                        fontFamily: FONT,
                        flexShrink: 0,
                      }}
                    >
                      Read
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
