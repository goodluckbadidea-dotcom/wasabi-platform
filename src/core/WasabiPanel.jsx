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
import ChatUI from "./ChatUI.jsx";
import { runAgent, extractChoices } from "../agent/runAgent.js";
import { WASABI_TOOLS } from "../agent/tools.js";
import { buildWasabiPrompt } from "../agent/wasabiPrompt.js";
import { createToolExecutor, createDelegateFunction } from "../agent/toolExecutor.js";
import BatchQueue from "./BatchQueue.jsx";
import { queryAll } from "../notion/pagination.js";
import { updatePage } from "../notion/client.js";
import { readProp } from "../notion/properties.js";
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
  color: active ? "#fff" : "#888",
  borderRadius: 999,
  transition: "background 0.14s, color 0.14s",
  outline: "none",
});

// ── Log entry status colors ──
const STATUS_COL = {
  pending: { border: "1px solid #333", bg: "#2A2A2A", dot: C.accent },
  processing: {
    border: "1px solid rgba(255,180,0,0.3)",
    bg: "rgba(255,180,0,0.06)",
    dot: "#C8960A",
  },
  actioned: { border: "1px solid #333", bg: "#1A1A1A", dot: "#2A6B38" },
};

export default function WasabiPanel({ onClose, isThinking }) {
  const { user, platformIds, batchQueue, addToQueue, updateQueueItem, removeQueueItem, addPage } =
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
  const [chatChoices, setChatChoices] = useState([]);
  const chatHistoryRef = useRef([]);
  const chatAbortRef = useRef(false);

  // ── Notifications state ──
  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const notifFetched = useRef(false);

  const fetchNotifications = useCallback(async () => {
    const notifDbId = platformIds?.notifDbId;
    if (!user?.workerUrl || !user?.notionKey || !notifDbId) return;
    setNotifLoading(true);
    try {
      const results = await queryAll(user.workerUrl, user.notionKey, notifDbId, null, [
        { property: "Created", direction: "descending" },
      ]);
      const parsed = results.map((page) => {
        const props = page.properties || {};
        let message = "", readStatus = "unread", source = "", createdTime = page.created_time || "";
        for (const [key, prop] of Object.entries(props)) {
          const val = readProp(prop);
          const lk = key.toLowerCase();
          if (prop.type === "title") message = val || "";
          else if (lk === "status" || lk === "read") {
            if (prop.type === "checkbox") readStatus = val ? "read" : "unread";
            else readStatus = (val || "unread").toLowerCase();
          }
          else if (lk === "source" || lk === "from") source = val || "";
        }
        return { id: page.id, text: message, read: readStatus === "read", timestamp: createdTime, source };
      });
      setNotifications(parsed);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    } finally {
      setNotifLoading(false);
    }
  }, [user, platformIds]);

  // Fetch notifications when tab is first opened
  useEffect(() => {
    if (tab === "notifications" && !notifFetched.current) {
      notifFetched.current = true;
      fetchNotifications();
    }
  }, [tab, fetchNotifications]);

  const markNotifRead = useCallback(async (notifId) => {
    if (!user?.workerUrl || !user?.notionKey) return;
    setNotifications((prev) => prev.map((n) => (n.id === notifId ? { ...n, read: true } : n)));
    try {
      await updatePage(user.workerUrl, user.notionKey, notifId, { Status: { select: { name: "read" } } });
    } catch {
      try {
        await updatePage(user.workerUrl, user.notionKey, notifId, { Read: { checkbox: true } });
      } catch {}
    }
  }, [user]);

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
        const systemPrompt = buildWasabiPrompt({
          platformDbIds: platformIds
            ? Object.entries(platformIds).map(([k, v]) => `${k}: ${v}`).join("\n")
            : "",
        });

        const delegate = createDelegateFunction({
          workerUrl: user.workerUrl, notionKey: user.notionKey, claudeKey: user.claudeKey,
          kbDbId: platformIds?.kbDbId, notifDbId: platformIds?.notifDbId, configDbId: platformIds?.configDbId,
        });
        const executor = createToolExecutor({
          workerUrl: user.workerUrl, notionKey: user.notionKey,
          parentPageId: platformIds?.rootPageId, kbDbId: platformIds?.kbDbId,
          notifDbId: platformIds?.notifDbId, configDbId: platformIds?.configDbId,
          rulesDbId: platformIds?.rulesDbId, onPageCreated: addPage,
          delegateToPageAgent: delegate,
        });

        const { text: reply } = await runAgent({
          messages: [{ role: "user", content: item.text }],
          systemPrompt,
          tools: WASABI_TOOLS,
          model: "claude-sonnet-4-20250514",
          workerUrl: user.workerUrl,
          claudeKey: user.claudeKey,
          executeTool: (name, input) => executor(name, input),
          maxTokens: 1024,
          maxIterations: 6,
        });

        updateQueueItem(item.id, { status: "actioned", result: reply });
      } catch (err) {
        console.error("[BatchQueue] Processing failed:", err);
        updateQueueItem(item.id, { status: "actioned", result: `Error: ${err.message}` });
      }
    }

    setProcessProgress({ current: pending.length, total: pending.length });
    setIsProcessing(false);
  }, [batchQueue, isProcessing, user, platformIds, addPage, updateQueueItem]);

  // ── Chat: send message to Wasabi ──
  const toolExecutor = useCallback(
    (toolName, toolInput) => {
      if (!user?.workerUrl || !user?.notionKey) return Promise.resolve("{}");
      const delegate = createDelegateFunction({
        workerUrl: user.workerUrl,
        notionKey: user.notionKey,
        claudeKey: user.claudeKey,
        kbDbId: platformIds?.kbDbId,
        notifDbId: platformIds?.notifDbId,
        configDbId: platformIds?.configDbId,
      });
      const executor = createToolExecutor({
        workerUrl: user.workerUrl,
        notionKey: user.notionKey,
        parentPageId: platformIds?.rootPageId,
        kbDbId: platformIds?.kbDbId,
        notifDbId: platformIds?.notifDbId,
        configDbId: platformIds?.configDbId,
        rulesDbId: platformIds?.rulesDbId,
        onPageCreated: addPage,
        delegateToPageAgent: delegate,
      });
      return executor(toolName, toolInput);
    },
    [user, platformIds, addPage]
  );

  const handleChatSend = useCallback(
    async ({ text }) => {
      if (chatLoading || !text?.trim()) return;
      setChatMessages((prev) => [...prev, { role: "user", content: text }]);
      setChatChoices([]);
      setChatLoading(true);

      const newHistory = [...chatHistoryRef.current, { role: "user", content: text }];

      try {
        const systemPrompt = buildWasabiPrompt({
          platformDbIds: platformIds
            ? Object.entries(platformIds)
                .map(([k, v]) => `${k}: ${v}`)
                .join("\n")
            : "",
        });

        const { text: reply, history } = await runAgent({
          messages: newHistory,
          systemPrompt,
          tools: WASABI_TOOLS,
          model: "claude-sonnet-4-20250514",
          workerUrl: user.workerUrl,
          claudeKey: user.claudeKey,
          executeTool: toolExecutor,
          abortRef: chatAbortRef,
          maxTokens: 2048,
        });

        chatHistoryRef.current = history;
        const extracted = extractChoices(reply);
        let cleanReply = reply;
        for (const c of extracted) {
          cleanReply = cleanReply.replace(c.raw, "").trim();
        }
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: cleanReply },
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
      }
    },
    [chatLoading, user, platformIds, toolExecutor]
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
        background: "#1E1E1E",
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
          borderBottom: `1px solid #333`,
          background: "#1A1A1A",
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
              color: "#888",
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
              e.currentTarget.style.color = "#888";
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
            background: "#222222",
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
                background: "#1A1A1A",
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
                  color: "#E8E8E8",
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
                  background: logInput.trim() ? C.accent : "#333",
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
          <ChatUI
            messages={chatMessages}
            onSend={handleChatSend}
            isLoading={chatLoading}
            choices={chatChoices}
            onChoice={handleChatChoice}
            allowFiles={true}
            agentName="Wasabi"
            agentIcon={<WasabiFlame size={16} />}
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
              <div style={{ textAlign: "center", color: "#888", fontSize: 10, marginTop: 20 }}>
                Loading notifications...
              </div>
            )}

            {!notifLoading && notifications.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  color: "#888",
                  fontSize: 10,
                  marginTop: 40,
                  lineHeight: 2,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                <IconBell size={22} color="#888" style={{ marginBottom: 8 }} />
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
                  border: `1px solid ${notif.read ? "#333" : C.accent + "44"}`,
                  background: notif.read ? "#1A1A1A" : "#2A2A2A",
                  padding: "9px 10px",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                  {!notif.read && (
                    <div style={{ width: 6, height: 6, borderRadius: 3, background: C.accent, marginTop: 5, flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: "#E8E8E8", lineHeight: 1.55 }}>
                      {notif.text || notif.content}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      {notif.source && (
                        <span style={{ fontSize: 9, color: C.accent, background: C.accent + "18", padding: "1px 5px", borderRadius: 3 }}>
                          {notif.source}
                        </span>
                      )}
                      {notif.timestamp && (
                        <span style={{ fontSize: 9, color: "#666", fontFamily: MONO }}>
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
                        border: `1px solid #444`,
                        borderRadius: 4,
                        color: "#888",
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
