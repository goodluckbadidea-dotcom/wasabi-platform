// ─── Chat Panel ───
// Dual-tab chat panel.
// "Assistant" tab: Enhanced Haiku chat with database query, email, calendar + role-based tools.
// "Agent" tab: Full Wasabi agent with all tools.

import React, { useState, useRef, useCallback, useEffect } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { TRANSITION } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { IconClose } from "../design/icons.jsx";
import WasabiFlame from "../core/WasabiFlame.jsx";
import ChatUI from "../core/ChatUI.jsx";
import WasabiPanel from "../core/WasabiPanel.jsx";
import { HAIKU } from "../agent/aiRouter.js";
import { ASSISTANT_TOOLS_ADMIN, ASSISTANT_TOOLS_EDITOR, ASSISTANT_TOOLS_VIEWER } from "../agent/tools.js";
import { runAgent } from "../agent/runAgent.js";
import { buildAssistantContext } from "../agent/agentContext.js";
import { buildAssistantPrompt } from "../agent/wasabiPrompt.js";
import { fetchGoogleContext } from "../google/googleContext.js";
import * as api from "../lib/api.js";
import { useViewport } from "../context/ViewportContext.jsx";
import { buildFilteredNeuronContext } from "../neurons/neuronStorage.js";

const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 280;
const MAX_WIDTH = 640;
const TABLET_MAX_WIDTH = 400;

// Per-user cache key — must match useAICuratedTasks.js cacheKeyForUser()
function getTaskCacheKey(userId) {
  return userId ? `wasabi_ai_tasks_v10_${userId}` : "wasabi_ai_tasks_v10";
}
const TASK_CACHE_TTL = 15 * 60 * 1000;

// ── Get role-based tool set ──
function getToolsForRole(role) {
  if (role === "viewer") return ASSISTANT_TOOLS_VIEWER;
  if (role === "editor") return ASSISTANT_TOOLS_EDITOR;
  return ASSISTANT_TOOLS_ADMIN; // admin or single-user
}

// ── Build task context from localStorage cache ──
function getTaskContextFromCache(userId) {
  try {
    const raw = localStorage.getItem(getTaskCacheKey(userId));
    if (raw) {
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts < TASK_CACHE_TTL && Array.isArray(data) && data.length > 0) {
        return data.slice(0, 10).map((t) => {
          let line = `- [${t.done ? "x" : " "}] ${t.title}`;
          if (t.due) line += ` (due ${t.due})`;
          if (t.priority) line += ` [${t.priority}]`;
          if (t._aiReason) line += ` — ${t._aiReason}`;
          return line;
        }).join("\n");
      }
    }
  } catch { /* best effort */ }
  return "";
}

// ── Lightweight tool executor for Assistant tools ──
async function executeChatTool(name, input) {
  try {
    switch (name) {
      case "query_database": {
        const dbId = input.database_id;
        if (!dbId) return JSON.stringify({ error: "database_id is required" });
        // Determine storage type from page config
        let pageType = null;
        try {
          const cfg = await api.getPageConfig(dbId);
          pageType = cfg?.page_type || null;
        } catch {}
        const limit = 200;
        // D1 table (default path)
        const queryBody = {};
        if (input.filter) queryBody.filters = input.filter;
        if (input.sorts) queryBody.sorts = input.sorts;
        queryBody.limit = limit;
        let rows;
        try {
          const res = await api.queryTable(dbId, queryBody);
          rows = res?.rows || [];
        } catch {
          const res = await api.listRows(dbId, { limit });
          rows = res?.rows || [];
        }
        return JSON.stringify({ count: rows.length, results: rows.slice(0, limit), truncated: rows.length >= limit, storage: "d1" });
      }
      case "update_page": {
        const pageId = input.page_id;
        const dbId = input.database_id;
        if (!pageId || !input.properties) return JSON.stringify({ error: "page_id and properties are required" });
        // D1 row update — flat key-value cells
        if (dbId) {
          await api.updateRow(dbId, pageId, { cells: input.properties });
          return JSON.stringify({ success: true, page_id: pageId, storage: "d1" });
        }
        // If no database_id, try as D1 row with page_id containing ":"
        if (pageId.includes(":")) {
          const [tableId, rowId] = pageId.split(":");
          await api.updateRow(tableId, rowId, { cells: input.properties });
          return JSON.stringify({ success: true, page_id: pageId, storage: "d1" });
        }
        return JSON.stringify({ error: "database_id is required for D1 row updates" });
      }
      case "post_notification":
        await api.createNotification({
          message: input.message,
          type: input.type || "notification",
          source: input.source || "wasabi",
        });
        return JSON.stringify({ success: true });
      case "search_emails":
        return JSON.stringify(await api.searchEmails(input.query || "", input.max_results || 10, input.label));
      case "list_calendar_events":
        return JSON.stringify(await api.listCalendarEvents(input.start_date, input.end_date, input.max_results));
      case "create_calendar_event":
        return JSON.stringify(await api.createCalendarEvent({
          summary: input.summary,
          start: input.start,
          end: input.end,
          description: input.description,
          location: input.location,
          attendees: input.attendees,
        }));
      case "query_neurons": {
        if (input.node_id) {
          const res = await api.getNeuronsByNode(input.node_id);
          return JSON.stringify({ count: (res.neurons || []).length, neurons: res.neurons || [] });
        }
        const res = await api.getNeuronGraph();
        return JSON.stringify({ count: (res.neurons || []).length, neurons: (res.neurons || []).slice(0, 50), truncated: (res.neurons || []).length > 50 });
      }
      case "query_neuron_data": {
        const res = await api.getHydratedNeuron(input.neuron_id);
        return JSON.stringify(res);
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}

// ════════════════════════════════════════════
// ChatPanel
// ════════════════════════════════════════════
export default function ChatPanel({
  onClose,
  activePageConfig,
  activePageData,
  pendingChatMessage,
  onClearPendingMessage,
}) {
  const { user, identity, pages } = usePlatform();
  const { isTablet } = useViewport();
  const maxW = isTablet ? TABLET_MAX_WIDTH : MAX_WIDTH;
  const canUseAgent = !identity || identity.role === "admin";

  // ── Tab state (persisted) ──
  const [activeTab, setActiveTab] = useState(() => {
    try { return localStorage.getItem("wasabi_chat_tab") || "assistant"; } catch { return "assistant"; }
  });

  // If user loses agent access, switch to assistant
  useEffect(() => {
    if (!canUseAgent && activeTab === "agent") setActiveTab("assistant");
  }, [canUseAgent, activeTab]);

  // Persist chat tab
  useEffect(() => {
    try { localStorage.setItem("wasabi_chat_tab", activeTab); } catch {}
  }, [activeTab]);

  // ── Chat state ──
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatStatus, setChatStatus] = useState("");
  const chatHistoryRef = useRef([]);
  const googleContextRef = useRef("");

  // ── Resize (persisted) ──
  const [panelWidth, setPanelWidth] = useState(() => {
    try { const v = localStorage.getItem("wasabi_panel_width"); return v ? parseInt(v, 10) : DEFAULT_WIDTH; } catch { return DEFAULT_WIDTH; }
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startWidth: 0 });
  const isResized = panelWidth !== DEFAULT_WIDTH;

  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: panelWidth };
    setIsDragging(true);
  }, [panelWidth]);

  useEffect(() => {
    if (!isDragging) return;
    const handleDragMove = (e) => {
      const delta = e.clientX - dragRef.current.startX;
      const newWidth = Math.min(maxW, Math.max(MIN_WIDTH, dragRef.current.startWidth + delta));
      setPanelWidth(newWidth);
    };
    const handleDragEnd = () => setIsDragging(false);

    document.addEventListener("mousemove", handleDragMove);
    document.addEventListener("mouseup", handleDragEnd);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleDragMove);
      document.removeEventListener("mouseup", handleDragEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  // Persist panel width
  useEffect(() => {
    try { localStorage.setItem("wasabi_panel_width", String(panelWidth)); } catch {}
  }, [panelWidth]);

  // ── Auto-switch to Wasabi tab when pendingChatMessage arrives ──
  useEffect(() => {
    if (pendingChatMessage) {
      setActiveTab("agent");
    }
  }, [pendingChatMessage]);

  // ── Chat send handler ──
  const handleChatSend = useCallback(async ({ text }) => {
    if (chatLoading || !text?.trim()) return;

    setChatMessages((prev) => [...prev, { role: "user", content: text }]);
    setChatLoading(true);
    setChatStatus("Thinking...");

    // Build history (keep last 6 exchanges = 12 messages)
    const newHistory = [
      ...chatHistoryRef.current.slice(-12),
      { role: "user", content: text },
    ];

    try {
      // Fetch Google context (cached, best effort)
      try {
        const gStatus = await api.getGoogleStatus();
        if (gStatus?.connected) {
          googleContextRef.current = await fetchGoogleContext();
        }
      } catch { /* best effort */ }

      const role = identity?.role || "admin";
      const taskContext = getTaskContextFromCache(identity?.id);

      // Build context envelope (assembled once per turn)
      const envelope = await buildAssistantContext({
        user,
        identity,
        pages,
        googleContext: googleContextRef.current,
        activePageConfig,
        activePageData,
        taskContext,
        neuronSummary: buildFilteredNeuronContext(text),
      });

      const systemPrompt = buildAssistantPrompt(envelope);

      const result = await runAgent({
        envelope,
        messages: newHistory,
        systemPrompt,
        tools: getToolsForRole(role),
        model: HAIKU,
        workerUrl: user?.workerUrl || "",
        claudeKey: user?.claudeKey || "",
        executeTool: executeChatTool,
        onStatus: setChatStatus,
        maxIterations: 3,
        maxTokens: 1024,
      });

      const reply = result.text || "I couldn't generate a response. Please try again.";

      // Update history from agent result (includes tool exchanges)
      chatHistoryRef.current = result.history
        ? result.history.slice(-12)
        : [...newHistory, { role: "assistant", content: reply }];

      setChatMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      console.error("[ChatPanel] Assistant error:", err);
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Something went wrong: ${err.message}` },
      ]);
    } finally {
      setChatLoading(false);
      setChatStatus("");
    }
  }, [chatLoading, user, identity, pages, activePageConfig, activePageData]);

  // ── Tab bar style ──
  const miniTabBtn = (active) => ({
    padding: "3px 8px", border: "none",
    background: active ? C.accent : "transparent",
    color: active ? "#fff" : C.darkMuted,
    fontSize: 9, fontWeight: 600, fontFamily: FONT,
    borderRadius: RADIUS.pill, cursor: "pointer", outline: "none",
    transition: "all 0.15s", letterSpacing: "0.03em",
  });

  return (
    <div style={{
      width: panelWidth,
      flexShrink: 0,
      background: C.darkSurf,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      minHeight: 0,
      fontFamily: FONT,
      position: "relative",
      transition: isDragging ? "none" : TRANSITION.panelResize,
    }}>
      {/* ── Header ── */}
      <div style={{
        padding: "14px 14px 0",
        flexShrink: 0,
        background: C.dark,
      }}>
        {/* Title row */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          marginBottom: 10,
        }}>
          <WasabiFlame size={24} />
          <span style={{
            fontFamily: FONT, fontSize: 13, fontWeight: 600,
            color: C.darkText, letterSpacing: "0.01em",
          }}>
            Wasabi
          </span>
          {/* Compact Assistant/Agent toggle */}
          <div style={{
            display: "flex", gap: 2, background: C.darkSurf2,
            borderRadius: RADIUS.pill, padding: 2, marginLeft: 6,
          }}>
            <button style={miniTabBtn(activeTab === "assistant")} onClick={() => setActiveTab("assistant")}>
              Assistant
            </button>
            {canUseAgent && (
              <button style={miniTabBtn(activeTab === "agent")} onClick={() => setActiveTab("agent")}>
                Agent
              </button>
            )}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
            {isResized && (
              <button
                onClick={() => setPanelWidth(DEFAULT_WIDTH)}
                title="Reset size"
                style={headerBtnStyle}
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
              style={headerBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.color = C.darkText; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
            >
              <IconClose size={12} color="currentColor" />
            </button>
          </div>
        </div>

      </div>

      {/* ── Assistant Tab ── */}
      {activeTab === "assistant" && (
        <ChatUI
          messages={chatMessages}
          onSend={handleChatSend}
          isLoading={chatLoading}
          statusText={chatStatus}
          allowFiles={false}
          agentName="Wasabi"
          agentIcon={<WasabiFlame size={20} />}
          placeholder="Ask anything..."
          compact={true}
        />
      )}

      {/* ── Wasabi Tab (kept mounted for state preservation) ── */}
      <div style={{
        display: activeTab === "agent" ? "flex" : "none",
        flex: 1, minHeight: 0, flexDirection: "column",
      }}>
        <WasabiPanel
          onClose={onClose}
          isThinking={false}
          activePageConfig={activePageConfig}
          activePageData={activePageData}
          pendingChatMessage={pendingChatMessage}
          onClearPendingMessage={onClearPendingMessage}
          embedded={true}
        />
      </div>

      {/* ── Resize handle ── */}
      <div
        onMouseDown={handleDragStart}
        style={{
          position: "absolute",
          top: 0,
          right: -3,
          bottom: 0,
          width: 6,
          cursor: "col-resize",
          zIndex: 10,
        }}
      />
    </div>
  );
}

const headerBtnStyle = {
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
};
