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
import { createToolExecutor } from "../agent/toolExecutor.js";

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
  const { user, platformIds, batchQueue, addToQueue, removeQueueItem, addPage } =
    usePlatform();
  const [tab, setTab] = useState("log");

  // ── Log state ──
  const [logInput, setLogInput] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const logTextRef = useRef(null);
  const logEndRef = useRef(null);

  // ── Chat state ──
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatChoices, setChatChoices] = useState([]);
  const chatHistoryRef = useRef([]);
  const chatAbortRef = useRef(false);

  // ── Notifications state (stub for Phase 4) ──
  const [notifications] = useState([]);

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

  // ── Chat: send message to Wasabi ──
  const toolExecutor = useCallback(
    (toolName, toolInput) => {
      if (!user?.workerUrl || !user?.notionKey) return Promise.resolve("{}");
      const executor = createToolExecutor({
        workerUrl: user.workerUrl,
        notionKey: user.notionKey,
        parentPageId: platformIds?.rootPageId,
        kbDbId: platformIds?.kbDbId,
        notifDbId: platformIds?.notifDbId,
        configDbId: platformIds?.configDbId,
        onPageCreated: addPage,
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
          {/* Entry list */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "12px 12px 6px",
            }}
          >
            {batchQueue.length === 0 && (
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
                <IconLog size={22} color="#888" style={{ marginBottom: 8 }} />
                <br />
                No entries yet
                <br />
                <span style={{ fontSize: 9, opacity: 0.6 }}>
                  Add notes or to-dos below
                </span>
              </div>
            )}

            {batchQueue.map((entry, idx) => {
              const sc = STATUS_COL[entry.status] || STATUS_COL.pending;
              const isEditing = editingId === entry.id;
              return (
                <div
                  key={entry.id}
                  style={{
                    marginBottom: 8,
                    borderRadius: 8,
                    border: sc.border,
                    background: sc.bg,
                    padding: "9px 10px",
                    opacity: entry.status === "actioned" ? 0.45 : 1,
                    transition: "opacity 0.3s",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 7,
                    }}
                  >
                    {/* Index */}
                    <span
                      style={{
                        fontSize: 8,
                        color: "#666",
                        flexShrink: 0,
                        marginTop: 3,
                        letterSpacing: "0.06em",
                        fontFamily: MONO,
                      }}
                    >
                      {String(idx + 1).padStart(2, "0")}
                    </span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      {isEditing ? (
                        <textarea
                          autoFocus
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              setEditingId(null);
                              // Save would go here
                            }
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            background: "#2A2A2A",
                            border: `1px solid ${C.accent}`,
                            borderRadius: 4,
                            fontFamily: FONT,
                            fontSize: 12,
                            color: "#E8E8E8",
                            resize: "none",
                            minHeight: 52,
                            padding: "4px 6px",
                            outline: "none",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            fontSize: 12,
                            color: "#E8E8E8",
                            lineHeight: 1.55,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            fontFamily: FONT,
                          }}
                        >
                          {entry.text || entry.action || "Log entry"}
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    {entry.status === "pending" && !isEditing && (
                      <div
                        style={{ display: "flex", gap: 2, flexShrink: 0 }}
                      >
                        <button
                          title="Edit"
                          onClick={() => {
                            setEditingId(entry.id);
                            setEditText(entry.text || "");
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: C.accent,
                            padding: 2,
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          title="Delete"
                          onClick={() => removeQueueItem(entry.id)}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: C.orange,
                            padding: 2,
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          <IconClose size={10} color="currentColor" />
                        </button>
                      </div>
                    )}

                    {/* Status dot */}
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: sc.dot,
                        flexShrink: 0,
                        marginTop: 5,
                      }}
                      title={entry.status}
                    />
                  </div>
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>

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
            {notifications.length === 0 && (
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
                  border: "1px solid #333",
                  background: notif.read ? "#1A1A1A" : "#2A2A2A",
                  padding: "9px 10px",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: "#E8E8E8",
                    lineHeight: 1.55,
                  }}
                >
                  {notif.text || notif.content}
                </div>
                {notif.timestamp && (
                  <div
                    style={{
                      fontSize: 9,
                      color: "#666",
                      marginTop: 4,
                      fontFamily: MONO,
                    }}
                  >
                    {new Date(notif.timestamp).toLocaleString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
