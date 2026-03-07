// ─── SystemManager ───
// Three-tab system management interface: Overview, Agent Configs, Chat.
// Replaces the "Coming in Phase 4" stub in App.jsx.
// No emojis. Dark theme. Inline CSS-in-JS.

import React, { useState, useCallback, useRef, useEffect } from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import ChatUI from "./ChatUI.jsx";
import { runAgent, extractChoices } from "../agent/runAgent.js";
import { SYSTEM_TOOLS } from "../agent/tools.js";
import { buildWasabiPrompt } from "../agent/wasabiPrompt.js";
import { createToolExecutor } from "../agent/toolExecutor.js";
import { queryAll } from "../notion/pagination.js";
import WasabiOrb from "./WasabiOrb.jsx";
import { IconGear } from "../design/icons.jsx";
import { getSessionUsage, getUsageHistory, formatCost, formatTokens } from "../utils/costTracker.js";

// ── Tab button style (matches WasabiPanel) ──
const tabBtn = (active) => ({
  padding: "7px 16px",
  border: "none",
  cursor: "pointer",
  fontFamily: FONT,
  fontSize: 12,
  fontWeight: 500,
  background: active ? C.accent : "transparent",
  color: active ? "#fff" : C.darkMuted,
  borderRadius: RADIUS.pill,
  transition: "background 0.14s, color 0.14s",
  outline: "none",
  whiteSpace: "nowrap",
});

// ── Stat card ──
function StatCard({ label, value, loading }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 100,
        background: C.darkSurf,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg,
        padding: "16px 14px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
      }}
    >
      <span
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: C.darkText,
          fontFamily: FONT,
          lineHeight: 1,
        }}
      >
        {loading ? "--" : value}
      </span>
      <span
        style={{
          fontSize: 10,
          color: C.darkMuted,
          fontFamily: FONT,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ── ID row ──
function IdRow({ label, id }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        padding: "3px 0",
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: C.darkMuted,
          fontFamily: FONT,
          minWidth: 60,
          flexShrink: 0,
        }}
      >
        {label}:
      </span>
      <span
        style={{
          fontSize: 11,
          color: C.darkText,
          fontFamily: MONO,
          opacity: id ? 0.7 : 0.3,
          wordBreak: "break-all",
        }}
      >
        {id || "not set"}
      </span>
    </div>
  );
}

// ── Agent config row (expandable) ──
function AgentRow({ page, onSave }) {
  const [expanded, setExpanded] = useState(false);
  const [prompt, setPrompt] = useState(
    page.agentConfig?.prompt || ""
  );
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(page.id, {
        agentConfig: { ...page.agentConfig, prompt },
      });
    } catch (err) {
      console.error("Failed to save agent config:", err);
    } finally {
      setSaving(false);
    }
  }, [page, prompt, onSave]);

  const dbCount = page.databaseIds?.length || page.agentConfig?.databases?.length || 0;
  const model = page.agentConfig?.model || "claude-haiku-4-5-20251001";

  return (
    <div
      style={{
        borderRadius: RADIUS.lg,
        border: `1px solid ${C.darkBorder}`,
        background: C.darkSurf,
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      {/* Header row */}
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          cursor: "pointer",
          transition: "background 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = C.darkSurf2;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        {/* Icon */}
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: RADIUS.sm,
            background: C.darkSurf2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            flexShrink: 0,
            color: C.darkText,
            fontFamily: FONT,
            border: `1px solid ${C.darkBorder}`,
          }}
        >
          {page.icon && page.icon !== "page" ? page.icon : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.darkMuted} strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          )}
        </span>

        {/* Name */}
        <span
          style={{
            flex: 1,
            fontSize: 13,
            color: C.darkText,
            fontFamily: FONT,
            fontWeight: 500,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {page.name || "Untitled"}
        </span>

        {/* Model badge */}
        <span
          style={{
            fontSize: 9,
            color: C.darkMuted,
            background: C.darkSurf2,
            border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.pill,
            padding: "2px 8px",
            fontFamily: MONO,
            flexShrink: 0,
          }}
        >
          {model.includes("haiku") ? "Haiku" : model.includes("sonnet") ? "Sonnet" : model.split("-")[0]}
        </span>

        {/* DB count */}
        <span
          style={{
            fontSize: 10,
            color: C.darkMuted,
            fontFamily: MONO,
            flexShrink: 0,
          }}
        >
          {dbCount} db{dbCount !== 1 ? "s" : ""}
        </span>

        {/* Expand arrow */}
        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          style={{
            flexShrink: 0,
            transition: "transform 0.15s",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <path
            d="M1 1L5 5L9 1"
            stroke={C.darkMuted}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div
          style={{
            padding: "0 12px 12px",
            borderTop: `1px solid ${C.darkBorder}`,
          }}
        >
          {/* Agent prompt */}
          <div style={{ marginTop: 10 }}>
            <label
              style={{
                fontSize: 10,
                color: C.darkMuted,
                fontFamily: FONT,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 4,
                display: "block",
              }}
            >
              Agent Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                minHeight: 100,
                background: C.dark,
                border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.md,
                fontFamily: MONO,
                fontSize: 11,
                color: C.darkText,
                padding: "8px 10px",
                resize: "vertical",
                outline: "none",
                lineHeight: 1.6,
              }}
              onFocus={(e) => {
                e.target.style.borderColor = C.accent;
              }}
              onBlur={(e) => {
                e.target.style.borderColor = C.darkBorder;
              }}
            />
          </div>

          {/* Scoped databases */}
          <div style={{ marginTop: 10 }}>
            <label
              style={{
                fontSize: 10,
                color: C.darkMuted,
                fontFamily: FONT,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 4,
                display: "block",
              }}
            >
              Scoped Databases
            </label>
            {(page.databaseIds || page.agentConfig?.databases || []).map(
              (dbId, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 11,
                    fontFamily: MONO,
                    color: C.darkText,
                    opacity: 0.65,
                    padding: "2px 0",
                    wordBreak: "break-all",
                  }}
                >
                  {dbId}
                </div>
              )
            )}
            {(page.databaseIds || page.agentConfig?.databases || []).length ===
              0 && (
              <span
                style={{
                  fontSize: 11,
                  color: C.darkMuted,
                  opacity: 0.5,
                  fontFamily: FONT,
                }}
              >
                None
              </span>
            )}
          </div>

          {/* Tool list */}
          <div style={{ marginTop: 10 }}>
            <label
              style={{
                fontSize: 10,
                color: C.darkMuted,
                fontFamily: FONT,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 4,
                display: "block",
              }}
            >
              Tools
            </label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
              }}
            >
              {(page.agentConfig?.tools || []).map((tool, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: 10,
                    fontFamily: MONO,
                    color: C.darkMuted,
                    background: C.dark,
                    border: `1px solid ${C.darkBorder}`,
                    borderRadius: RADIUS.sm,
                    padding: "2px 6px",
                  }}
                >
                  {tool}
                </span>
              ))}
              {(!page.agentConfig?.tools ||
                page.agentConfig.tools.length === 0) && (
                <span
                  style={{
                    fontSize: 11,
                    color: C.darkMuted,
                    opacity: 0.5,
                    fontFamily: FONT,
                  }}
                >
                  Default tools
                </span>
              )}
            </div>
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              marginTop: 12,
              padding: "7px 18px",
              border: "none",
              borderRadius: RADIUS.md,
              background: saving ? C.darkSurf2 : C.accent,
              color: "#fff",
              fontFamily: FONT,
              fontSize: 12,
              fontWeight: 600,
              cursor: saving ? "default" : "pointer",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!saving) e.currentTarget.style.background = C.accentDim;
            }}
            onMouseLeave={(e) => {
              if (!saving) e.currentTarget.style.background = C.accent;
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SystemManager
// ════════════════════════════════════════════════════════════════════════════

export default function SystemManager() {
  const { user, platformIds, pages, updatePageConfig } = usePlatform();

  // ── Tab state ──
  const [tab, setTab] = useState("overview");

  // ── Overview stats ──
  const [stats, setStats] = useState({ pages: 0, kb: null, rules: null });
  const [statsLoading, setStatsLoading] = useState(true);
  const statsFetched = useRef(false);

  // ── Cost tracking ──
  const [costData, setCostData] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Load cost data when overview tab is active
  useEffect(() => {
    if (tab === "overview") {
      setCostData(getSessionUsage());
    }
  }, [tab]);

  useEffect(() => {
    if (
      statsFetched.current ||
      !user?.workerUrl ||
      !user?.notionKey ||
      !platformIds
    )
      return;
    statsFetched.current = true;

    const fetchStats = async () => {
      setStatsLoading(true);
      try {
        const promises = [];

        // KB count
        if (platformIds.kbDbId) {
          promises.push(
            queryAll(user.workerUrl, user.notionKey, platformIds.kbDbId)
              .then((r) => r.length)
              .catch(() => 0)
          );
        } else {
          promises.push(Promise.resolve(0));
        }

        // Rules count
        if (platformIds.rulesDbId) {
          promises.push(
            queryAll(user.workerUrl, user.notionKey, platformIds.rulesDbId)
              .then((r) => r.length)
              .catch(() => 0)
          );
        } else {
          promises.push(Promise.resolve(0));
        }

        const [kbCount, rulesCount] = await Promise.all(promises);
        setStats({ pages: pages.length, kb: kbCount, rules: rulesCount });
      } catch (err) {
        console.warn("Failed to fetch system stats:", err);
        setStats({ pages: pages.length, kb: 0, rules: 0 });
      } finally {
        setStatsLoading(false);
      }
    };

    fetchStats();
  }, [user, platformIds, pages.length]);

  // Update page count when pages change
  useEffect(() => {
    setStats((prev) => ({ ...prev, pages: pages.length }));
  }, [pages.length]);

  // ── Chat state ──
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatChoices, setChatChoices] = useState([]);
  const chatHistoryRef = useRef([]);
  const chatAbortRef = useRef(false);

  // ── Chat tool executor ──
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
        onPageCreated: null,
      });
      return executor(toolName, toolInput);
    },
    [user, platformIds]
  );

  // ── Chat send handler ──
  const handleChatSend = useCallback(
    async ({ text }) => {
      if (chatLoading || !text?.trim()) return;
      setChatMessages((prev) => [...prev, { role: "user", content: text }]);
      setChatChoices([]);
      setChatLoading(true);

      const newHistory = [
        ...chatHistoryRef.current,
        { role: "user", content: text },
      ];

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
          tools: SYSTEM_TOOLS,
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
        console.error("System chat error:", err);
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
      handleChatSend({
        text: typeof choice === "string" ? choice : choice.label,
      });
    },
    [handleChatSend]
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: C.dark,
        fontFamily: FONT,
        overflow: "hidden",
      }}
    >
      {/* ── Tab bar ── */}
      <div
        style={{
          flexShrink: 0,
          padding: "14px 20px 0",
          borderBottom: `1px solid ${C.darkBorder}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <IconGear size={18} color={C.darkText} />
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: C.darkText,
              fontFamily: FONT,
            }}
          >
            System Manager
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: 3,
            marginBottom: 12,
            background: C.darkSurf,
            borderRadius: RADIUS.pill,
            padding: 3,
            width: "fit-content",
          }}
        >
          <button
            style={tabBtn(tab === "overview")}
            onClick={() => setTab("overview")}
          >
            Overview
          </button>
          <button
            style={tabBtn(tab === "configs")}
            onClick={() => setTab("configs")}
          >
            Agent Configs
          </button>
          <button
            style={tabBtn(tab === "chat")}
            onClick={() => setTab("chat")}
          >
            Chat
          </button>
        </div>
      </div>

      {/* ── Tab content ── */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          minHeight: 0,
        }}
      >
        {/* ═══ OVERVIEW TAB ═══ */}
        {tab === "overview" && (
          <div style={{ padding: "20px 24px" }}>
            {/* Platform status */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 20,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: C.accent,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 13,
                  color: C.darkText,
                  fontFamily: FONT,
                  fontWeight: 500,
                }}
              >
                Connected
              </span>
            </div>

            {/* Platform DB IDs */}
            <div
              style={{
                background: C.darkSurf,
                border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.lg,
                padding: "12px 14px",
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: C.darkMuted,
                  fontFamily: FONT,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 8,
                }}
              >
                Platform Database IDs
              </div>
              <IdRow label="root" id={platformIds?.rootPageId} />
              <IdRow label="KB" id={platformIds?.kbDbId} />
              <IdRow label="config" id={platformIds?.configDbId} />
              <IdRow label="notif" id={platformIds?.notifDbId} />
              <IdRow label="rules" id={platformIds?.rulesDbId} />
            </div>

            {/* Stats row */}
            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <StatCard
                label="Pages"
                value={stats.pages}
                loading={false}
              />
              <StatCard
                label="KB Entries"
                value={stats.kb ?? 0}
                loading={statsLoading}
              />
              <StatCard
                label="Automation Rules"
                value={stats.rules ?? 0}
                loading={statsLoading}
              />
            </div>

            {/* ── Session Usage (Cost Tracking) ── */}
            <div style={{ marginTop: 24 }}>
              <div
                style={{
                  fontSize: 10,
                  color: C.darkMuted,
                  fontFamily: FONT,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 12,
                }}
              >
                Session Usage
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <StatCard
                  label="API Calls"
                  value={costData ? costData.callCount : 0}
                  loading={!costData}
                />
                <StatCard
                  label="Input Tokens"
                  value={costData ? formatTokens(costData.inputTokens) : "0"}
                  loading={!costData}
                />
                <StatCard
                  label="Output Tokens"
                  value={costData ? formatTokens(costData.outputTokens) : "0"}
                  loading={!costData}
                />
                <StatCard
                  label="Est. Cost"
                  value={costData ? formatCost(costData.estimatedCost) : "$0"}
                  loading={!costData}
                />
              </div>

              {/* Session History (collapsible) */}
              <div style={{ marginTop: 14 }}>
                <button
                  onClick={() => setHistoryOpen((o) => !o)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: FONT,
                    fontSize: 11,
                    color: C.darkMuted,
                    padding: "4px 0",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <svg
                    width="8"
                    height="5"
                    viewBox="0 0 8 5"
                    fill="none"
                    style={{
                      transition: "transform 0.15s",
                      transform: historyOpen ? "rotate(180deg)" : "rotate(0deg)",
                    }}
                  >
                    <path d="M0.5 0.5L4 4.5L7.5 0.5" stroke={C.darkMuted} strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  Session History
                </button>

                {historyOpen && (() => {
                  const history = getUsageHistory().sort((a, b) =>
                    (b.startedAt || "").localeCompare(a.startedAt || "")
                  ).slice(0, 5);

                  if (history.length === 0) {
                    return (
                      <div style={{ fontSize: 11, color: C.darkMuted, padding: "8px 0", opacity: 0.6 }}>
                        No session history yet.
                      </div>
                    );
                  }

                  return (
                    <div
                      style={{
                        marginTop: 8,
                        background: C.darkSurf,
                        border: `1px solid ${C.darkBorder}`,
                        borderRadius: RADIUS.lg,
                        overflow: "hidden",
                      }}
                    >
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr>
                            {["Started", "Calls", "Tokens In", "Tokens Out", "Cost"].map((h) => (
                              <th
                                key={h}
                                style={{
                                  textAlign: "left",
                                  padding: "6px 10px",
                                  fontSize: 9,
                                  fontWeight: 600,
                                  textTransform: "uppercase",
                                  letterSpacing: "0.06em",
                                  color: C.darkMuted,
                                  borderBottom: `1px solid ${C.darkBorder}`,
                                  fontFamily: FONT,
                                }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((s, i) => (
                            <tr key={s.sessionId || i}>
                              <td style={{ padding: "5px 10px", fontSize: 11, fontFamily: MONO, color: C.darkText, borderBottom: `1px solid ${C.edgeLine}` }}>
                                {s.startedAt ? new Date(s.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "--"}
                              </td>
                              <td style={{ padding: "5px 10px", fontSize: 11, fontFamily: MONO, color: C.darkText, borderBottom: `1px solid ${C.edgeLine}` }}>
                                {s.callCount}
                              </td>
                              <td style={{ padding: "5px 10px", fontSize: 11, fontFamily: MONO, color: C.darkText, borderBottom: `1px solid ${C.edgeLine}` }}>
                                {formatTokens(s.inputTokens)}
                              </td>
                              <td style={{ padding: "5px 10px", fontSize: 11, fontFamily: MONO, color: C.darkText, borderBottom: `1px solid ${C.edgeLine}` }}>
                                {formatTokens(s.outputTokens)}
                              </td>
                              <td style={{ padding: "5px 10px", fontSize: 11, fontFamily: MONO, color: C.darkText, borderBottom: `1px solid ${C.edgeLine}` }}>
                                {formatCost(s.estimatedCost)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ═══ AGENT CONFIGS TAB ═══ */}
        {tab === "configs" && (
          <div style={{ padding: "16px 20px" }}>
            {pages.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  color: C.darkMuted,
                  fontSize: 12,
                  marginTop: 48,
                  lineHeight: 2,
                }}
              >
                No pages configured yet.
                <br />
                <span style={{ fontSize: 11, opacity: 0.6 }}>
                  Create a page to see its agent config here.
                </span>
              </div>
            )}

            {pages.map((page) => (
              <AgentRow
                key={page.id}
                page={page}
                onSave={updatePageConfig}
              />
            ))}
          </div>
        )}

        {/* ═══ CHAT TAB ═══ */}
        {tab === "chat" && (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <ChatUI
              messages={chatMessages}
              onSend={handleChatSend}
              isLoading={chatLoading}
              choices={chatChoices}
              onChoice={handleChatChoice}
              allowFiles={true}
              agentName="Wasabi"
              agentIcon={<WasabiOrb size={28} />}
              placeholder="System chat -- query KB, check configs..."
            />
          </div>
        )}
      </div>
    </div>
  );
}
