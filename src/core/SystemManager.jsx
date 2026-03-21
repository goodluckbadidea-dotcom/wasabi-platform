// ─── SystemManager ───
// Three-tab system management interface: Overview, Connections, Settings.
// Chat tab removed — use WasabiPanel chat instead.
// No emojis. Dark theme. Inline CSS-in-JS.

import React, { useState, useCallback, useRef, useEffect } from "react";
import { C, FONT, MONO, RADIUS, THEME_LIST, THEMES, VIEW_PALETTE } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { S } from "../design/styles.js";
import { useTheme } from "../context/ThemeContext.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
import { useColorMapping } from "../context/ColorMappingContext.jsx";
import WorkspaceSettings from "../views/WorkspaceSettings.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import { IconGear } from "../design/icons.jsx";
import { getSessionUsage, getUsageHistory, formatCost, formatTokens, getTierBreakdown, getAggregateUsage } from "../utils/costTracker.js";
import * as api from "../lib/api.js";
import { getConnections, setConnection as apiSetConnection, deleteConnection as apiDeleteConnection, checkHealth, factoryReset as apiFactoryReset, clearConnection, getGoogleAuthUrl, getGoogleStatus, disconnectGoogle, createInvite, listUsers, updateUser, deleteUser as apiDeleteUser } from "../lib/api.js";
import { isAdmin } from "../lib/roles.js";

// ── Tab button style (matches WasabiPanel) ──
const tabBtn = (active) => ({
  padding: "6px 18px",
  border: "none",
  cursor: "pointer",
  fontFamily: FONT,
  fontSize: 12,
  fontWeight: active ? 600 : 400,
  background: active ? `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)` : "transparent",
  color: active ? "#fff" : C.darkMuted,
  borderRadius: RADIUS.lg,
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

// ── Connection row (for Connections tab) ──
const CONNECTION_DEFS = [
  { key: "notion", label: "Notion", placeholder: "ntn_...", description: "Connect a Notion integration to link databases and sync data." },
  { key: "claude", label: "Claude", placeholder: "sk-ant-...", description: "Anthropic API key for AI chat, automations, and agent tools." },
  { key: "monday", label: "Monday.com", placeholder: "eyJhbGc...", description: "Connect to Monday.com boards to sync items and columns." },
];

function ConnectionRow({ def, connected, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await onSave(def.key, value.trim(), { label: def.label });
      setEditing(false);
      setValue("");
    } catch (err) {
      console.error(`Failed to save ${def.key}:`, err);
    } finally {
      setSaving(false);
    }
  }, [def, value, onSave]);

  const handleDelete = useCallback(async () => {
    setSaving(true);
    try {
      await onDelete(def.key);
    } catch (err) {
      console.error(`Failed to delete ${def.key}:`, err);
    } finally {
      setSaving(false);
    }
  }, [def, onDelete]);

  return (
    <div style={{
      background: C.darkSurf,
      border: `1px solid ${C.darkBorder}`,
      borderRadius: RADIUS.lg,
      padding: "14px 16px",
      marginBottom: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: editing ? 10 : 0 }}>
        {/* Status dot */}
        <span style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: connected ? C.accent : C.darkMuted + "44",
        }} />
        {/* Name */}
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: C.darkText, fontFamily: FONT }}>
          {def.label}
        </span>
        {/* Status label */}
        <span style={{ fontSize: 10, color: connected ? C.accent : C.darkMuted, fontFamily: FONT }}>
          {connected ? "Connected" : "Not connected"}
        </span>
        {/* Actions */}
        {connected ? (
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setEditing((e) => !e)}
              style={{
                background: C.darkSurf2, border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.sm,
                color: C.darkMuted, fontFamily: FONT, fontSize: 11, padding: "3px 10px", cursor: "pointer",
              }}
            >
              Update
            </button>
            <button
              onClick={handleDelete}
              disabled={saving}
              style={{
                background: "transparent", border: `1px solid #FF480044`, borderRadius: RADIUS.sm,
                color: C.warning, fontFamily: FONT, fontSize: 11, padding: "3px 10px", cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.5 : 1,
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            style={{
              background: C.accent, border: "none", borderRadius: RADIUS.sm,
              color: "#fff", fontFamily: FONT, fontSize: 11, fontWeight: 600, padding: "4px 14px", cursor: "pointer",
            }}
          >
            Add
          </button>
        )}
      </div>

      {/* Description */}
      {!editing && (
        <p style={{ fontSize: 11, color: C.darkMuted, marginTop: 6, marginLeft: 18, lineHeight: 1.4 }}>
          {def.description}
        </p>
      )}

      {/* Edit form */}
      {editing && (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={def.placeholder}
            style={{
              flex: 1, background: C.dark, border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.md,
              color: C.darkText, fontFamily: MONO, fontSize: 12, padding: "8px 10px", outline: "none",
            }}
            onFocus={(e) => { e.target.style.borderColor = C.accent; }}
            onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
            autoFocus
          />
          <button
            onClick={handleSave}
            disabled={saving || !value.trim()}
            style={{
              background: saving ? C.darkSurf2 : C.accent, border: "none", borderRadius: RADIUS.pill,
              color: "#fff", fontFamily: FONT, fontSize: 12, fontWeight: 600, padding: "8px 16px",
              cursor: saving || !value.trim() ? "default" : "pointer", opacity: saving || !value.trim() ? 0.5 : 1,
            }}
          >
            {saving ? "..." : "Save"}
          </button>
          <button
            onClick={() => { setEditing(false); setValue(""); }}
            style={{
              background: C.darkSurf2, border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.md,
              color: C.darkMuted, fontFamily: FONT, fontSize: 12, padding: "8px 12px", cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ── Google OAuth connection row ──
function GoogleConnectionRow({ connected, email, onConnect, onDisconnect, loading, error }) {
  return (
    <div style={{
      background: C.darkSurf,
      border: `1px solid ${connected ? C.accent + "33" : error ? "#E0525233" : C.darkBorder}`,
      borderRadius: RADIUS.lg,
      padding: "14px 16px",
      marginBottom: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Status dot */}
        <span style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: connected ? C.accent : C.darkMuted + "44",
        }} />
        {/* Name */}
        <span style={{ fontSize: 13, fontWeight: 500, color: C.darkText, fontFamily: FONT }}>
          Google
        </span>
        <span style={{ flex: 1, fontSize: 10, color: C.darkMuted, fontFamily: FONT }}>
          Gmail + Calendar
        </span>
        {/* Status */}
        <span style={{ fontSize: 10, color: connected ? C.accent : C.darkMuted, fontFamily: FONT }}>
          {connected ? `Connected as ${email}` : "Not connected"}
        </span>
        {/* Action */}
        {connected ? (
          <button
            onClick={onDisconnect}
            disabled={loading}
            style={{
              background: "transparent", border: `1px solid #FF480044`, borderRadius: RADIUS.sm,
              color: C.warning, fontFamily: FONT, fontSize: 11, padding: "3px 10px",
              cursor: loading ? "default" : "pointer", opacity: loading ? 0.5 : 1,
            }}
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={onConnect}
            disabled={loading}
            style={{
              background: C.accent, border: "none", borderRadius: RADIUS.sm,
              color: "#fff", fontFamily: FONT, fontSize: 11, fontWeight: 600,
              padding: "4px 14px", cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? "..." : "Connect with Google"}
          </button>
        )}
      </div>
      <p style={{ fontSize: 11, color: C.darkMuted, marginTop: 6, marginLeft: 18, lineHeight: 1.4 }}>
        {connected
          ? "Gmail inbox, calendar events, and Google account access for Wasabi."
          : "Connect your Google account to access Gmail, Calendar, and more through Wasabi."}
      </p>
      {error && (
        <div style={{
          fontSize: 11, color: C.error, marginTop: 8, marginLeft: 18,
          lineHeight: 1.4, padding: "6px 10px",
          background: "#E0525210", borderRadius: RADIUS.sm,
          border: "1px solid #E0525222",
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SystemManager
// ════════════════════════════════════════════════════════════════════════════

export default function SystemManager() {
  const { user, platformIds, pages, updatePageConfig, workerConnection, updateConnectionKey, identity } = usePlatform();

  // ── Tab state ──
  const [tab, setTab] = useState("overview");

  // ── Overview stats ──
  const [stats, setStats] = useState({ pages: 0, kb: null, rules: null });
  const [statsLoading, setStatsLoading] = useState(true);
  const statsFetched = useRef(false);

  // ── Cost tracking ──
  const [costData, setCostData] = useState(null);
  const [tierData, setTierData] = useState(null);
  const [aggData, setAggData] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // ── Connections state ──
  const [connections, setConnections] = useState([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const connectionsFetched = useRef(false);

  // ── Google OAuth state ──
  const [googleStatus, setGoogleStatus] = useState({ connected: false, email: "" });
  const [googleLoading, setGoogleLoading] = useState(false);

  // Load connections when tab activates
  useEffect(() => {
    if (tab !== "connections" || connectionsFetched.current) return;
    connectionsFetched.current = true;
    setConnectionsLoading(true);
    Promise.all([
      getConnections().then((data) => setConnections(data.connections || [])),
      getGoogleStatus().then(setGoogleStatus).catch(() => {}),
    ])
      .catch((err) => console.warn("Failed to load connections:", err))
      .finally(() => setConnectionsLoading(false));
  }, [tab]);

  // Google OAuth: open popup and listen for result
  const [googleError, setGoogleError] = useState("");
  const handleGoogleConnect = useCallback(async () => {
    setGoogleLoading(true);
    setGoogleError("");
    try {
      const result = await getGoogleAuthUrl();
      if (!result?.url) {
        throw new Error(result?._error || "No auth URL returned — check Google OAuth configuration");
      }
      const popup = window.open(result.url, "google-auth", "width=500,height=700,left=200,top=100");

      if (!popup) {
        setGoogleError("Popup blocked — allow popups for this site and try again");
        setGoogleLoading(false);
        return;
      }

      // Listen for postMessage from callback page
      const onMessage = (e) => {
        if (e.data?.type?.startsWith("google-oauth-")) {
          window.removeEventListener("message", onMessage);
          if (e.data.type === "google-oauth-error") {
            setGoogleError(e.data.detail || "OAuth failed");
          }
          // Refresh status
          getGoogleStatus().then(setGoogleStatus).catch(() => {});
          setGoogleLoading(false);
        }
      };
      window.addEventListener("message", onMessage);

      // Fallback: poll if popup closes without message
      const pollId = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollId);
          window.removeEventListener("message", onMessage);
          getGoogleStatus().then(setGoogleStatus).catch(() => {});
          setGoogleLoading(false);
        }
      }, 1000);
    } catch (err) {
      console.error("Google OAuth failed:", err);
      const msg = err.message || "Connection failed";
      if (msg.includes("CLIENT_ID") || msg.includes("not configured")) {
        setGoogleError("Google OAuth not configured on the worker. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET secrets.");
      } else {
        setGoogleError(msg);
      }
      setGoogleLoading(false);
    }
  }, []);

  const handleGoogleDisconnect = useCallback(async () => {
    setGoogleLoading(true);
    try {
      await disconnectGoogle();
      setGoogleStatus({ connected: false, email: "" });
    } catch (err) {
      console.error("Google disconnect failed:", err);
    } finally {
      setGoogleLoading(false);
    }
  }, []);

  const handleSaveConnection = useCallback(async (key, value, metadata) => {
    await apiSetConnection(key, value, metadata);
    // Update local state
    setConnections((prev) => {
      const existing = prev.findIndex((c) => c.key === key);
      const entry = { key, metadata, connected: true, updated_at: new Date().toISOString() };
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = entry;
        return updated;
      }
      return [...prev, entry];
    });
    // Update legacy user keys in PlatformContext
    updateConnectionKey(key, value);
  }, [updateConnectionKey]);

  const handleDeleteConnection = useCallback(async (key) => {
    await apiDeleteConnection(key);
    setConnections((prev) => prev.filter((c) => c.key !== key));
    updateConnectionKey(key, "");
  }, [updateConnectionKey]);

  // ── Worker health ──
  const [health, setHealth] = useState(null);
  useEffect(() => {
    if (tab === "overview" || tab === "connections") {
      checkHealth().then(setHealth).catch(() => setHealth(null));
    }
  }, [tab]);

  // Load cost data when overview tab is active
  useEffect(() => {
    if (tab === "overview") {
      setCostData(getSessionUsage());
      setTierData(getTierBreakdown());
      setAggData(getAggregateUsage());
    }
  }, [tab]);

  useEffect(() => {
    if (statsFetched.current) return;
    statsFetched.current = true;

    const fetchStats = async () => {
      setStatsLoading(true);
      try {
        // Fetch counts from D1 (no Notion key required)
        const [kbResult, rulesResult] = await Promise.all([
          api.listKB().catch(() => ({ entries: [] })),
          api.listRules().catch(() => ({ rules: [] })),
        ]);

        const kbCount = (kbResult.entries || []).length;
        const rulesCount = (rulesResult.rules || []).length;
        setStats({ pages: pages.length, kb: kbCount, rules: rulesCount });
      } catch (err) {
        console.warn("Failed to fetch system stats:", err);
        setStats({ pages: pages.length, kb: 0, rules: 0 });
      } finally {
        setStatsLoading(false);
      }
    };

    fetchStats();
  }, [pages.length]);

  // Update page count when pages change
  useEffect(() => {
    setStats((prev) => ({ ...prev, pages: pages.length }));
  }, [pages.length]);

  // Chat tab removed — use WasabiPanel for all chat

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
          padding: "16px 32px 0",
          borderBottom: `1px solid ${C.darkBorder}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
            animation: ANIM.snapUp(0.03),
          }}
        >
          <IconGear size={22} color={C.accent} />
          <span
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: C.darkText,
              fontFamily: FONT,
            }}
          >
            System
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: 3,
            marginBottom: 12,
            background: C.darkSurf,
            borderRadius: RADIUS.lg,
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
            style={tabBtn(tab === "connections")}
            onClick={() => setTab("connections")}
          >
            Connections
          </button>
          <button
            style={tabBtn(tab === "settings")}
            onClick={() => setTab("settings")}
          >
            Settings
          </button>
          {(!identity || isAdmin(identity)) && (
            <button
              style={tabBtn(tab === "users")}
              onClick={() => setTab("users")}
            >
              Users
            </button>
          )}
          {(!identity || isAdmin(identity)) && (
            <button
              style={tabBtn(tab === "audit")}
              onClick={() => setTab("audit")}
            >
              Audit Log
            </button>
          )}
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
          <div style={{ padding: "24px 32px" }}>
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
            {(() => {
              // Show aggregate data when current session has no calls
              const hasCurrentSession = costData && costData.callCount > 0;
              const displayData = hasCurrentSession ? costData : (aggData && aggData.callCount > 0 ? aggData : costData);
              const displayTier = hasCurrentSession ? tierData : (aggData && aggData.callCount > 0 ? aggData : tierData);
              const usageLabel = hasCurrentSession ? "Session Usage" : (aggData && aggData.callCount > 0 ? `Usage (${aggData.sessionCount} session${aggData.sessionCount !== 1 ? "s" : ""})` : "Session Usage");

              return (
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
                    {usageLabel}
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <StatCard
                      label="API Calls"
                      value={displayData ? displayData.callCount : 0}
                      loading={!displayData}
                    />
                    <StatCard
                      label="Input Tokens"
                      value={displayData ? formatTokens(displayData.inputTokens) : "0"}
                      loading={!displayData}
                    />
                    <StatCard
                      label="Output Tokens"
                      value={displayData ? formatTokens(displayData.outputTokens) : "0"}
                      loading={!displayData}
                    />
                    <StatCard
                      label="Est. Cost"
                      value={displayData ? formatCost(displayData.estimatedCost) : "$0"}
                      loading={!displayData}
                    />
                  </div>

                  {/* ── AI Routing Breakdown ── */}
                  {displayTier && (displayTier.haikuCalls > 0 || displayTier.sonnetCalls > 0 || displayTier.cacheHits > 0) && (() => {
                    const totalCalls = (displayTier.haikuCalls || 0) + (displayTier.sonnetCalls || 0) + (displayTier.cacheHits || 0);
                    const allSonnetCost = (displayTier.haikuCost || 0) + (displayTier.sonnetCost || 0) + (displayTier.savedCost || 0);
                    const actualCost = (displayTier.haikuCost || 0) + (displayTier.sonnetCost || 0);
                    const maxBarCost = Math.max(allSonnetCost, actualCost, 0.001);

                    return (
                      <div style={{ marginTop: 16 }}>
                        <div style={{
                          fontSize: 10, color: C.darkMuted, fontFamily: FONT,
                          textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10,
                        }}>
                          AI Routing Breakdown
                        </div>
                        <div style={{
                          background: C.darkSurf,
                          border: `1px solid ${C.darkBorder}`,
                          borderRadius: RADIUS.lg,
                          padding: "14px 16px",
                        }}>
                          {/* Tier rows */}
                          {[
                            { label: "Cache Hits", count: displayTier.cacheHits || 0, color: C.accent, cost: "$0.00" },
                            { label: "Haiku", count: displayTier.haikuCalls || 0, color: C.accent, cost: formatCost(displayTier.haikuCost || 0) },
                            { label: "Sonnet", count: displayTier.sonnetCalls || 0, color: C.error, cost: formatCost(displayTier.sonnetCost || 0) },
                          ].map((row) => (
                            <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                              <span style={{ width: 8, height: 8, borderRadius: "50%", background: row.color, flexShrink: 0 }} />
                              <span style={{ fontSize: 11, color: C.darkText, fontFamily: FONT, minWidth: 80 }}>{row.label}</span>
                              <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: MONO, minWidth: 30, textAlign: "right" }}>{row.count}</span>
                              <div style={{ flex: 1, height: 4, background: C.darkSurf2, borderRadius: 2, overflow: "hidden" }}>
                                <div style={{
                                  height: "100%",
                                  width: `${Math.min(100, (row.count / (totalCalls || 1)) * 100)}%`,
                                  background: row.color,
                                  borderRadius: 2,
                                  transition: "width 0.3s",
                                }} />
                              </div>
                              <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: MONO, minWidth: 50, textAlign: "right" }}>{row.cost}</span>
                            </div>
                          ))}

                          {/* ── Savings comparison bar chart ── */}
                          {(displayTier.savedCost || 0) > 0 && (
                            <div style={{
                              marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.darkBorder}`,
                            }}>
                              <div style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                                Cost Savings from Haiku Routing
                              </div>
                              {/* All-Sonnet bar (what it would have cost) */}
                              <div style={{ marginBottom: 6 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                  <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT }}>If all Sonnet</span>
                                  <span style={{ fontSize: 10, color: C.error, fontFamily: MONO }}>{formatCost(allSonnetCost)}</span>
                                </div>
                                <div style={{ height: 14, background: C.darkSurf2, borderRadius: 3, overflow: "hidden" }}>
                                  <div style={{
                                    height: "100%",
                                    width: `${(allSonnetCost / maxBarCost) * 100}%`,
                                    background: "linear-gradient(90deg, #E05252, #E0525288)",
                                    borderRadius: 3,
                                  }} />
                                </div>
                              </div>
                              {/* Actual cost bar (with Haiku routing) */}
                              <div style={{ marginBottom: 8 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                  <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT }}>With routing</span>
                                  <span style={{ fontSize: 10, color: C.accent, fontFamily: MONO }}>{formatCost(actualCost)}</span>
                                </div>
                                <div style={{ height: 14, background: C.darkSurf2, borderRadius: 3, overflow: "hidden" }}>
                                  <div style={{
                                    height: "100%",
                                    width: `${(actualCost / maxBarCost) * 100}%`,
                                    background: `linear-gradient(90deg, ${C.accent}, ${C.accent}88)`,
                                    borderRadius: 3,
                                  }} />
                                </div>
                              </div>
                              {/* Savings summary */}
                              <div style={{
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                marginTop: 6,
                              }}>
                                <span style={{ fontSize: 11, color: C.accent, fontFamily: FONT, fontWeight: 600 }}>
                                  Saved
                                </span>
                                <span style={{ fontSize: 14, fontWeight: 700, color: C.accent, fontFamily: MONO }}>
                                  {formatCost(displayTier.savedCost)} ({((displayTier.savedCost / allSonnetCost) * 100).toFixed(0)}%)
                                </span>
                              </div>
                            </div>
                          )}

                          {(displayTier.cacheHits || 0) > 0 && (
                            <div style={{
                              marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.darkBorder}`,
                              display: "flex", justifyContent: "space-between", alignItems: "center",
                            }}>
                              <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>Cache Hit Rate</span>
                              <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: MONO }}>{displayTier.cacheHitRate}%</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

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
              );
            })()}
          </div>
        )}

        {/* ═══ CONNECTIONS TAB ═══ */}
        {tab === "connections" && (
          <div style={{ padding: "24px 32px" }}>
            {/* Worker status */}
            <div style={{
              background: C.darkSurf,
              border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.lg,
              padding: "14px 16px",
              marginBottom: 20,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                  background: health?.ok ? C.accent : C.warning,
                }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: C.darkText, fontFamily: FONT }}>
                  Worker
                </span>
                <span style={{ fontSize: 10, color: health?.ok ? C.accent : C.warning, fontFamily: FONT }}>
                  {health?.ok ? "Healthy" : "Unreachable"}
                </span>
              </div>
              {workerConnection?.workerUrl && (
                <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: MONO, marginLeft: 18, wordBreak: "break-all" }}>
                  {workerConnection.workerUrl}
                </div>
              )}
              {health && (
                <div style={{ display: "flex", gap: 8, marginTop: 8, marginLeft: 18, flexWrap: "wrap" }}>
                  {[
                    { label: "D1", ok: health.d1 },
                    { label: "R2", ok: health.r2 },
                  ].map((svc) => (
                    <span key={svc.label} style={{
                      fontSize: 9, fontFamily: MONO, padding: "2px 8px",
                      borderRadius: RADIUS.sm, border: `1px solid ${C.darkBorder}`,
                      background: svc.ok ? C.accent + "18" : C.darkSurf2,
                      color: svc.ok ? C.accent : C.darkMuted,
                    }}>
                      {svc.label}: {svc.ok ? "OK" : "off"}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Section label */}
            <div style={{
              fontSize: 10, color: C.darkMuted, fontFamily: FONT,
              textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12,
            }}>
              Integrations
            </div>

            {connectionsLoading ? (
              <div style={{ color: C.darkMuted, fontSize: 12, textAlign: "center", padding: 20 }}>
                Loading connections...
              </div>
            ) : (
              <>
                {CONNECTION_DEFS.map((def) => (
                  <ConnectionRow
                    key={def.key}
                    def={def}
                    connected={connections.some((c) => c.key === def.key)}
                    onSave={handleSaveConnection}
                    onDelete={handleDeleteConnection}
                  />
                ))}
                <GoogleConnectionRow
                  connected={googleStatus.connected}
                  email={googleStatus.email}
                  onConnect={handleGoogleConnect}
                  onDisconnect={handleGoogleDisconnect}
                  loading={googleLoading}
                  error={googleError}
                />
              </>
            )}
          </div>
        )}

        {/* ═══ SETTINGS TAB ═══ */}
        {tab === "settings" && <SettingsTab />}

        {/* ═══ USERS TAB ═══ */}
        {tab === "users" && (!identity || isAdmin(identity)) && <UsersTab identity={identity} />}

        {/* ═══ AUDIT LOG TAB ═══ */}
        {tab === "audit" && (!identity || isAdmin(identity)) && <AuditLogTab />}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PIN Setup Section (admin-only, used inside SettingsTab)
// ════════════════════════════════════════════════════════════════════════════

function PinSetupSection() {
  const { identity } = usePlatform();
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState(null); // null | 'saving' | 'saved' | 'error'

  // Only show to admins
  if (identity && identity.role !== "admin") return null;

  const handleSetPin = async () => {
    if (pin.length < 4) { setStatus("error"); return; }
    setStatus("saving");
    try {
      await api.setPin(pin);
      setStatus("saved");
      setPin("");
      setTimeout(() => setStatus(null), 2000);
    } catch { setStatus("error"); }
  };

  return (
    <>
      <div style={{
        fontSize: 10, color: C.darkMuted, fontFamily: FONT,
        textTransform: "uppercase", letterSpacing: "0.08em",
        marginTop: 40, marginBottom: 14,
      }}>
        PIN Lock
      </div>
      <div style={{
        background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg, padding: "16px 18px",
        display: "flex", alignItems: "center", gap: 16, marginBottom: 28,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText, fontFamily: FONT, marginBottom: 4 }}>
            Set Workspace PIN
          </div>
          <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, lineHeight: 1.4, marginBottom: 10 }}>
            Editors must enter this PIN to unlock protected pages. Enable protection per-page in View Settings.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="password"
              value={pin}
              onChange={(e) => { setPin(e.target.value); setStatus(null); }}
              placeholder="4+ digit PIN"
              maxLength={8}
              style={{
                background: C.dark, border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.pill, padding: "7px 12px",
                color: C.darkText, fontFamily: FONT, fontSize: 14,
                letterSpacing: "0.2em", width: 120, textAlign: "center",
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSetPin()}
            />
            <button
              onClick={handleSetPin}
              disabled={status === "saving"}
              style={{
                ...S.btnPrimary, padding: "7px 16px", fontSize: 12,
                opacity: status === "saving" ? 0.6 : 1,
              }}
            >
              {status === "saving" ? "Saving..." : status === "saved" ? "Saved" : "Set PIN"}
            </button>
            {status === "error" && (
              <span style={{ fontSize: 11, color: C.error }}>Min 4 characters</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Settings Tab (theme picker)
// ════════════════════════════════════════════════════════════════════════════

function SettingsTab() {
  const { themeName, setThemeName } = useTheme();
  const { globalColorMapping, globalConfig, updateGlobalDefaults } = useColorMapping();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [draftMapping, setDraftMapping] = useState(globalColorMapping || {});
  const [mappingDirty, setMappingDirty] = useState(false);

  // Sync draft when global config changes externally
  useEffect(() => {
    if (!mappingDirty) setDraftMapping(globalColorMapping || {});
  }, [globalColorMapping, mappingDirty]);

  const handleLogout = useCallback(() => {
    clearConnection();
    window.location.reload();
  }, []);

  const handleFactoryReset = useCallback(async () => {
    setResetting(true);
    try {
      // Server-side: delete all user data from D1 + R2
      await apiFactoryReset();
    } catch (_) {
      // If server call fails, still clear local state
    }

    // Clear all wasabi localStorage keys
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("wasabi") || k.startsWith("wasabi-"))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));

    // Hard reload to reset all state
    window.location.reload();
  }, []);

  return (
    <div style={{ padding: "24px 32px" }}>
      {/* Section: Appearance */}
      <div
        style={{
          fontSize: 10,
          color: C.darkMuted,
          fontFamily: FONT,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 14,
        }}
      >
        Appearance
      </div>

      {/* Label: Color Theme */}
      <div
        style={{
          fontSize: 11,
          color: C.darkMuted,
          fontFamily: FONT,
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        Color Theme
      </div>

      {/* Theme cards grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
          gap: 10,
          marginBottom: 28,
        }}
      >
        {THEME_LIST.map((t) => {
          const isActive = themeName === t.key;
          const theme = THEMES[t.key];
          // Show palette accent colors (indices 5-8) as preview dots
          const previewColors = theme.palette.slice(5, 9);
          return (
            <button
              key={t.key}
              onClick={() => setThemeName(t.key)}
              style={{
                position: "relative",
                background: C.darkSurf,
                border: `2px solid ${isActive ? t.accent : C.darkBorder}`,
                borderRadius: RADIUS.lg,
                padding: 0,
                cursor: "pointer",
                outline: "none",
                overflow: "hidden",
                transition: "border-color 0.15s, box-shadow 0.15s",
                boxShadow: isActive ? `0 0 0 2px ${t.accent}33` : "none",
                fontFamily: FONT,
              }}
            >
              {/* Accent bar */}
              <div style={{ height: 6, background: t.accent }} />

              {/* Preview palette dots */}
              <div
                style={{
                  display: "flex",
                  gap: 5,
                  padding: "10px 10px 6px",
                  justifyContent: "center",
                }}
              >
                {previewColors.map((pc, i) => (
                  <div
                    key={i}
                    style={{
                      width: 18, height: 18, borderRadius: "50%",
                      background: pc.hex,
                      border: `1px solid ${C.darkBorder}`,
                    }}
                  />
                ))}
              </div>

              {/* Label + description + check */}
              <div
                style={{
                  padding: "4px 10px 10px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 2,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? t.accent : C.darkText,
                    }}
                  >
                    {t.label}
                  </span>
                  {isActive && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <circle cx="6" cy="6" r="6" fill={t.accent} />
                      <path d="M3.5 6L5.5 8L8.5 4.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                {t.description && (
                  <span style={{ fontSize: 9, color: C.darkMuted, lineHeight: 1.2 }}>
                    {t.description}
                  </span>
                )}
                {t.mode && (
                  <span style={{
                    fontSize: 8, color: C.darkMuted, fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                    background: C.darkSurf2, borderRadius: RADIUS.sm,
                    padding: "2px 6px", marginTop: 2,
                  }}>
                    {t.mode}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Mode indicator (inherent to theme) */}
      <div style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT, marginBottom: 0 }}>
        Mode is set by theme selection
      </div>

      {/* ── Default Color Mapping ── */}
      <div
        style={{
          fontSize: 10,
          color: C.darkMuted,
          fontFamily: FONT,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginTop: 40,
          marginBottom: 14,
        }}
      >
        Default Color Mapping
      </div>

      <p style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, margin: "0 0 12px", lineHeight: 1.4 }}>
        Set global color defaults for status and priority values. Views inherit these unless overridden.
      </p>

      <div style={{
        background: C.darkSurf,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg,
        padding: "14px 16px",
        marginBottom: 12,
        maxHeight: 400,
        overflowY: "auto",
      }}>
        {Object.entries(draftMapping).map(([name, paletteIdx]) => (
          <div key={name} style={{ marginBottom: 10 }}>
            <div style={{
              fontSize: 11,
              fontWeight: 500,
              color: C.darkText,
              fontFamily: FONT,
              marginBottom: 4,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: VIEW_PALETTE[paletteIdx]?.hex || C.darkMuted,
                flexShrink: 0,
              }} />
              {name}
            </div>
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {VIEW_PALETTE.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setDraftMapping((prev) => ({ ...prev, [name]: idx }));
                    setMappingDirty(true);
                  }}
                  title={p.key}
                  style={{
                    width: 18, height: 18, borderRadius: RADIUS.sm,
                    background: p.hex,
                    border: paletteIdx === idx ? "2px solid #fff" : "2px solid transparent",
                    outline: paletteIdx === idx ? `2px solid ${C.accent}` : "none",
                    cursor: "pointer",
                    transition: "all 0.1s",
                    flexShrink: 0,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Save / Reset buttons */}
      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        <button
          onClick={() => {
            setDraftMapping(globalColorMapping || {});
            setMappingDirty(false);
          }}
          style={{
            flex: 1, padding: "8px 12px", fontSize: 12, fontWeight: 500,
            fontFamily: FONT, border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.md, background: "transparent",
            color: C.darkMuted, cursor: "pointer",
          }}
        >
          Reset
        </button>
        <button
          onClick={() => {
            updateGlobalDefaults({ colorMapping: draftMapping });
            setMappingDirty(false);
          }}
          disabled={!mappingDirty}
          style={{
            flex: 1, padding: "8px 12px", fontSize: 12, fontWeight: 600,
            fontFamily: FONT, border: "none", borderRadius: RADIUS.pill,
            background: mappingDirty ? C.accent : C.darkSurf2,
            color: mappingDirty ? "#fff" : C.darkMuted,
            cursor: mappingDirty ? "pointer" : "default",
            transition: "all 0.15s",
          }}
        >
          Save Defaults
        </button>
      </div>

      {/* ── Account ── */}
      <div
        style={{
          fontSize: 10,
          color: C.darkMuted,
          fontFamily: FONT,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginTop: 40,
          marginBottom: 14,
        }}
      >
        Account
      </div>

      <div
        style={{
          background: C.darkSurf,
          border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.lg,
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 28,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText, fontFamily: FONT, marginBottom: 4 }}>
            Log Out
          </div>
          <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, lineHeight: 1.4 }}>
            Disconnect from the current worker. Your data is preserved on the server.
          </div>
        </div>
        <button
          onClick={handleLogout}
          style={{
            background: "transparent",
            border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.pill,
            color: C.darkText,
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 600,
            padding: "7px 18px",
            cursor: "pointer",
            outline: "none",
            transition: "background 0.14s",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.darkBorder + "44"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          Log Out
        </button>
      </div>

      {/* ── PIN Lock ── */}
      <PinSetupSection />

      {/* ── Factory Reset ── */}
      <div
        style={{
          fontSize: 10,
          color: C.darkMuted,
          fontFamily: FONT,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 14,
        }}
      >
        Danger Zone
      </div>

      <div
        style={{
          background: C.darkSurf,
          border: `1px solid #E0525233`,
          borderRadius: RADIUS.lg,
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText, fontFamily: FONT, marginBottom: 4 }}>
            Factory Reset
          </div>
          <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, lineHeight: 1.4 }}>
            Erase all user data, connections, and pages. Resets the app to its original state.
          </div>
        </div>
        <button
          onClick={() => setShowResetConfirm(true)}
          disabled={resetting}
          style={{
            background: "transparent",
            border: `1px solid #E05252`,
            borderRadius: RADIUS.pill,
            color: C.error,
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 600,
            padding: "7px 18px",
            cursor: resetting ? "default" : "pointer",
            outline: "none",
            transition: "background 0.14s",
            opacity: resetting ? 0.5 : 1,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { if (!resetting) { e.currentTarget.style.background = "#E0525218"; } }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          {resetting ? "Resetting..." : "Reset"}
        </button>
      </div>

      {showResetConfirm && (
        <ConfirmDialog
          title="Factory Reset"
          message="This will erase ALL your data including pages, folders, connections, and settings. The app will reload to its original state. This cannot be undone."
          confirmLabel="Reset Everything"
          onConfirm={handleFactoryReset}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Workspaces Tab (embedded WorkspaceSettings per workspace)
// ════════════════════════════════════════════════════════════════════════════

function WorkspacesTab() {
  const { pages, updatePageConfig } = usePlatform();
  const [selectedId, setSelectedId] = useState(null);

  // Filter workspace pages
  const workspaces = (pages || []).filter(
    (p) => (p.page_type || p.pageType) === "workspace"
  );

  // Auto-select first workspace if none selected
  const selected = workspaces.find((w) => w.id === selectedId) || workspaces[0] || null;

  const handleUpdate = useCallback(
    (updates) => {
      if (selected) updatePageConfig(selected.id, updates);
    },
    [selected, updatePageConfig]
  );

  if (workspaces.length === 0) {
    return (
      <div style={{ padding: "40px 24px", textAlign: "center" }}>
        <div style={{
          fontSize: 14, color: C.darkMuted, fontFamily: FONT, marginBottom: 8,
        }}>
          No workspaces found
        </div>
        <div style={{
          fontSize: 12, color: C.darkMuted + "88", fontFamily: FONT, lineHeight: 1.5,
        }}>
          Create a workspace from the sidebar to configure AI instructions, model selection, and knowledge base settings.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Workspace selector (shown only when multiple workspaces exist) */}
      {workspaces.length > 1 && (
        <div style={{ padding: "16px 24px 0", flexShrink: 0 }}>
          <div style={{
            fontSize: 10, color: C.darkMuted, fontFamily: FONT,
            textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10,
          }}>
            Select Workspace
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {workspaces.map((w) => {
              const isActive = selected?.id === w.id;
              return (
                <button
                  key={w.id}
                  onClick={() => setSelectedId(w.id)}
                  style={{
                    padding: "6px 14px",
                    border: `1px solid ${isActive ? C.accent : C.darkBorder}`,
                    background: isActive ? C.accent + "18" : C.darkSurf,
                    borderRadius: RADIUS.pill,
                    color: isActive ? C.accent : C.darkMuted,
                    fontFamily: FONT,
                    fontSize: 12,
                    fontWeight: isActive ? 600 : 400,
                    cursor: "pointer",
                    outline: "none",
                    transition: "all 0.15s",
                  }}
                >
                  {w.name || "Untitled Workspace"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Embedded workspace settings */}
      {selected && (
        <WorkspaceSettings
          pageConfig={selected}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Users Tab (admin only)
// ════════════════════════════════════════════════════════════════════════════

function UsersTab({ identity }) {
  const { register } = usePlatform();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteRole, setInviteRole] = useState("editor");
  const [lastInvite, setLastInvite] = useState(null);
  const [confirmDeleteUser, setConfirmDeleteUser] = useState(null);
  const [confirmHardDelete, setConfirmHardDelete] = useState(null);
  const [hardDeleteTransfer, setHardDeleteTransfer] = useState("unassigned");
  const [resetResult, setResetResult] = useState(null);
  const [claimingUser, setClaimingUser] = useState(null); // user being claimed
  const [claimPassword, setClaimPassword] = useState("");
  const [claimError, setClaimError] = useState("");

  const refreshUsers = async () => {
    try {
      const res = await listUsers();
      setUsers(res.users || []);
    } catch (err) {
      console.warn("Failed to load users:", err);
    }
  };

  // Load users
  useEffect(() => {
    setLoading(true);
    refreshUsers().finally(() => setLoading(false));
  }, []);

  const handleInvite = async () => {
    try {
      const result = await createInvite(inviteRole);
      setLastInvite(result.invite);
      await refreshUsers();
    } catch (err) {
      console.error("Failed to create invite:", err);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await updateUser(userId, { role: newRole });
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: newRole } : u));
    } catch (err) {
      console.error("Failed to update role:", err);
    }
  };

  const handleSoftDelete = async (userId) => {
    try {
      await apiDeleteUser(userId);
      setConfirmDeleteUser(null);
      await refreshUsers();
    } catch (err) {
      console.error("Failed to deactivate user:", err);
    }
  };

  const handleRestore = async (userId) => {
    try {
      await api.restoreUser(userId);
      await refreshUsers();
    } catch (err) {
      console.error("Failed to restore user:", err);
    }
  };

  const handleHardDelete = async (userId) => {
    try {
      await api.hardDeleteUser(userId, hardDeleteTransfer);
      setConfirmHardDelete(null);
      setHardDeleteTransfer("unassigned");
      await refreshUsers();
    } catch (err) {
      console.error("Failed to permanently delete user:", err);
    }
  };

  const handleResetPassword = async (userId) => {
    try {
      const result = await api.resetUserPassword(userId);
      setResetResult({ userId, inviteCode: result.invite_code });
    } catch (err) {
      console.error("Failed to reset password:", err);
    }
  };

  const handleClaim = async (user) => {
    if (!claimPassword || claimPassword.length < 6) {
      setClaimError("Password must be at least 6 characters.");
      return;
    }
    try {
      setClaimError("");
      await register(user.invite_code, user.display_name, claimPassword);
      // Success — identity is now set, page will re-render as authenticated
      setClaimingUser(null);
      setClaimPassword("");
      await refreshUsers();
    } catch (err) {
      setClaimError(err.message || "Registration failed");
    }
  };

  const roleBadgeColor = (role) => {
    if (role === "admin") return C.accent;
    if (role === "editor") return "#5B9BD5";
    return C.darkMuted;
  };

  return (
    <div style={{ padding: "24px 32px", maxWidth: 640 }}>
      {/* Invite section */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: C.darkText, marginBottom: 12 }}>
          Invite New User
        </h3>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            style={{
              ...S.input,
              background: C.darkSurf,
              border: `1px solid ${C.darkBorder}`,
              color: C.darkText,
              padding: "8px 12px",
              fontSize: 13,
              borderRadius: RADIUS.pill,
              cursor: "pointer",
            }}
          >
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button onClick={handleInvite} style={{ ...S.btnPrimary, padding: "8px 18px", fontSize: 13 }}>
            Generate Invite
          </button>
        </div>

        {lastInvite && (
          <div style={{
            marginTop: 12,
            background: C.accent + "18",
            border: `1px solid ${C.accent}44`,
            borderRadius: RADIUS.pill,
            padding: "10px 14px",
            fontSize: 13,
            color: C.accent,
          }}>
            Invite code:{" "}
            <span
              onClick={() => { try { navigator.clipboard.writeText(lastInvite.invite_code); } catch {} }}
              style={{
                fontFamily: MONO,
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: "0.05em",
                cursor: "pointer",
              }}
              title="Click to copy"
            >
              {lastInvite.invite_code}
            </span>
            <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.7 }}>
              ({lastInvite.role}) — click to copy
            </span>
          </div>
        )}
      </div>

      {/* Team list */}
      <h3 style={{ fontSize: 14, fontWeight: 600, color: C.darkText, marginBottom: 12 }}>
        Team Members
      </h3>

      {(() => {
        const activeUsers = users.filter((u) => !u.deleted_at);
        const deactivatedUsers = users.filter((u) => !!u.deleted_at);

        const actionBtnStyle = {
          background: "transparent",
          padding: "4px 10px",
          fontSize: 11,
          borderRadius: RADIUS.sm,
          cursor: "pointer",
          fontFamily: FONT,
          fontWeight: 500,
          transition: "background 0.1s",
        };

        const renderUserCard = (u, isDeactivated = false) => {
          const isPending = !!u.invite_code;
          const isSelf = u.id === identity?.id;

          return (
            <React.Fragment key={u.id}>
            <div
              style={{
                background: C.darkSurf,
                border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.lg,
                padding: 14,
                display: "flex",
                alignItems: "center",
                gap: 12,
                opacity: isDeactivated ? 0.5 : 1,
              }}
            >
              {/* Avatar */}
              <span style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: isDeactivated
                  ? C.darkMuted + "44"
                  : `linear-gradient(135deg, ${roleBadgeColor(u.role)}, ${roleBadgeColor(u.role)}cc)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
              }}>
                {(u.display_name || "U").charAt(0).toUpperCase()}
              </span>

              {/* Name + status */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: C.darkText }}>
                    {u.display_name}
                  </span>
                  <span style={{
                    fontSize: 9,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: isDeactivated ? C.error : roleBadgeColor(u.role),
                    background: isDeactivated ? "#E0525218" : roleBadgeColor(u.role) + "18",
                    padding: "2px 6px",
                    borderRadius: RADIUS.pill,
                  }}>
                    {isDeactivated ? "deactivated" : u.role}
                  </span>
                  {isSelf && (
                    <span style={{ fontSize: 10, color: C.darkMuted, fontStyle: "italic" }}>you</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 2 }}>
                  {isDeactivated ? (
                    <>Deactivated {u.deleted_at ? new Date(u.deleted_at).toLocaleDateString() : ""}</>
                  ) : isPending ? (
                    <>
                      Pending invite:{" "}
                      <span style={{ fontFamily: MONO, fontWeight: 600 }}>{u.invite_code}</span>
                    </>
                  ) : (
                    <>Active — joined {u.created_at ? new Date(u.created_at).toLocaleDateString() : "unknown"}</>
                  )}

                  {/* Reset result banner */}
                  {resetResult?.userId === u.id && (
                    <div style={{ marginTop: 4, color: C.accent, fontFamily: MONO, fontWeight: 600 }}>
                      New invite code: {resetResult.inviteCode}
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              {!isSelf && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  {isDeactivated ? (
                    <>
                      <button
                        onClick={() => handleRestore(u.id)}
                        style={{ ...actionBtnStyle, border: `1px solid ${C.accent}44`, color: C.accent }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = C.accent + "15"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => setConfirmHardDelete(u)}
                        style={{ ...actionBtnStyle, border: `1px solid ${C.error}44`, color: C.error }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "#E0525215"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        Delete Forever
                      </button>
                    </>
                  ) : (
                    <>
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        style={{
                          background: C.dark,
                          border: `1px solid ${C.darkBorder}`,
                          color: C.darkText,
                          padding: "4px 8px",
                          fontSize: 11,
                          borderRadius: RADIUS.sm,
                          cursor: "pointer",
                          fontFamily: FONT,
                        }}
                      >
                        <option value="admin">Admin</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      {isPending && !identity && (
                        <button
                          onClick={() => { setClaimingUser(u); setClaimPassword(""); setClaimError(""); }}
                          style={{ ...actionBtnStyle, border: `1px solid ${C.accent}44`, color: C.accent }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = C.accent + "15"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          Claim Account
                        </button>
                      )}
                      {!isPending && (
                        <button
                          onClick={() => handleResetPassword(u.id)}
                          style={{ ...actionBtnStyle, border: `1px solid ${C.darkBorder}`, color: C.darkMuted }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = C.dark; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          Reset PW
                        </button>
                      )}
                      <button
                        onClick={() => setConfirmDeleteUser(u)}
                        style={{ ...actionBtnStyle, border: `1px solid ${C.error}44`, color: C.error }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "#E0525215"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        Deactivate
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Inline claim form */}
            {claimingUser?.id === u.id && (
              <div style={{
                background: C.accent + "0C",
                border: `1px solid ${C.accent}33`,
                borderRadius: RADIUS.lg,
                padding: 14,
                marginTop: 6,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}>
                <span style={{ fontSize: 12, color: C.darkText, fontWeight: 500, whiteSpace: "nowrap" }}>
                  Set password:
                </span>
                <input
                  type="password"
                  value={claimPassword}
                  onChange={(e) => setClaimPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  onKeyDown={(e) => e.key === "Enter" && handleClaim(u)}
                  style={{
                    ...S.input,
                    background: C.darkSurf,
                    border: `1px solid ${C.darkBorder}`,
                    color: C.darkText,
                    padding: "6px 10px",
                    fontSize: 12,
                    borderRadius: RADIUS.sm,
                    flex: 1,
                  }}
                  autoFocus
                />
                <button
                  onClick={() => handleClaim(u)}
                  style={{ ...S.btnPrimary, padding: "6px 14px", fontSize: 12 }}
                >
                  Register
                </button>
                <button
                  onClick={() => { setClaimingUser(null); setClaimPassword(""); setClaimError(""); }}
                  style={{ ...actionBtnStyle, border: `1px solid ${C.darkBorder}`, color: C.darkMuted }}
                >
                  Cancel
                </button>
                {claimError && (
                  <span style={{ fontSize: 11, color: C.error }}>{claimError}</span>
                )}
              </div>
            )}
          </React.Fragment>
          );
        };

        return loading ? (
          <div style={{ fontSize: 13, color: C.darkMuted, padding: 16 }}>Loading users...</div>
        ) : activeUsers.length === 0 && deactivatedUsers.length === 0 ? (
          <div style={{ fontSize: 13, color: C.darkMuted, padding: 16 }}>No users yet.</div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {activeUsers.map((u) => renderUserCard(u, false))}
            </div>

            {deactivatedUsers.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: C.darkMuted, marginBottom: 12 }}>
                  Deactivated Users
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {deactivatedUsers.map((u) => renderUserCard(u, true))}
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* Confirm soft delete */}
      {confirmDeleteUser && (
        <ConfirmDialog
          title={`Deactivate ${confirmDeleteUser.display_name}?`}
          message="This user will be deactivated and can be restored within 30 days. Their data will be preserved."
          onConfirm={() => handleSoftDelete(confirmDeleteUser.id)}
          onCancel={() => setConfirmDeleteUser(null)}
          confirmLabel="Deactivate"
        />
      )}

      {/* Confirm hard delete */}
      {confirmHardDelete && (
        <ConfirmDialog
          title={`Permanently delete ${confirmHardDelete.display_name}?`}
          message={
            <div>
              <p style={{ marginBottom: 10 }}>This cannot be undone. What should happen to their owned records?</p>
              <select
                value={hardDeleteTransfer}
                onChange={(e) => setHardDeleteTransfer(e.target.value)}
                style={{
                  background: C.dark,
                  border: `1px solid ${C.darkBorder}`,
                  color: C.darkText,
                  padding: "6px 10px",
                  fontSize: 12,
                  borderRadius: RADIUS.sm,
                  cursor: "pointer",
                  fontFamily: FONT,
                  width: "100%",
                }}
              >
                <option value="unassigned">Mark as unassigned</option>
                {users.filter((u) => !u.deleted_at && u.id !== confirmHardDelete.id).map((u) => (
                  <option key={u.id} value={u.id}>Transfer to {u.display_name}</option>
                ))}
              </select>
            </div>
          }
          onConfirm={() => handleHardDelete(confirmHardDelete.id)}
          onCancel={() => { setConfirmHardDelete(null); setHardDeleteTransfer("unassigned"); }}
          confirmLabel="Delete Forever"
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Audit Log Tab (admin only)
// ════════════════════════════════════════════════════════════════════════════
function AuditLogTab() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");
  const [resourceFilter, setResourceFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: LIMIT, offset };
      if (actionFilter) params.action = actionFilter;
      if (resourceFilter) params.resource_type = resourceFilter;
      const res = await api.getAuditLog(params);
      setEntries(res.entries || []);
    } catch (_) {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [actionFilter, resourceFilter, offset]);

  useEffect(() => { load(); }, [load]);

  const ACTION_COLORS = {
    create: "#4CAF50",
    update: "#FF9800",
    delete: "#F44336",
    login: "#2196F3",
    set_pin: "#9C27B0",
    verify_pin: "#00BCD4",
    grant_permission: "#8BC34A",
    revoke_permission: "#FF5722",
    factory_reset: "#F44336",
  };

  const selectStyle = {
    background: C.dark,
    border: `1px solid ${C.darkBorder}`,
    color: C.darkText,
    padding: "5px 8px",
    fontSize: 11,
    borderRadius: RADIUS.sm,
    cursor: "pointer",
    fontFamily: FONT,
  };

  return (
    <div style={{ padding: "16px 0" }}>
      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setOffset(0); }} style={selectStyle}>
          <option value="">All actions</option>
          {["create", "update", "delete", "login", "set_pin", "verify_pin", "grant_permission", "revoke_permission", "factory_reset"].map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select value={resourceFilter} onChange={(e) => { setResourceFilter(e.target.value); setOffset(0); }} style={selectStyle}>
          <option value="">All resources</option>
          {["user", "page", "row", "permission", "pin", "system"].map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button onClick={load} style={{ ...S.btnGhost, fontSize: 11, padding: "5px 10px" }}>
          Refresh
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: C.darkMuted }}>
          {entries.length} entries
        </span>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: C.darkMuted, padding: 40, fontSize: 13 }}>Loading...</div>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: "center", color: C.darkMuted, padding: 40, fontSize: 13 }}>No audit entries found.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {entries.map((e) => {
            const color = ACTION_COLORS[e.action] || C.darkMuted;
            let details = {};
            try { details = JSON.parse(e.details || "{}"); } catch (_) {}
            const ts = e.created_at ? new Date(e.created_at + "Z").toLocaleString() : "";
            return (
              <div key={e.id} style={{
                display: "grid",
                gridTemplateColumns: "140px 90px 80px 1fr",
                gap: 10,
                padding: "8px 10px",
                fontSize: 11,
                fontFamily: MONO,
                background: C.dark,
                borderRadius: RADIUS.sm,
                border: `1px solid ${C.darkBorder}`,
                alignItems: "center",
              }}>
                <span style={{ color: C.darkMuted }}>{ts}</span>
                <span style={{
                  color,
                  fontWeight: 600,
                  padding: "2px 6px",
                  borderRadius: RADIUS.sm,
                  background: `${color}18`,
                  textAlign: "center",
                  fontSize: 10,
                }}>
                  {e.action}
                </span>
                <span style={{ color: C.darkText }}>
                  {e.resource_type}{e.resource_id ? `:${e.resource_id.slice(0, 8)}` : ""}
                </span>
                <span style={{ color: C.darkMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.user_name || e.user_id?.slice(0, 8) || "system"}
                  {Object.keys(details).length > 0 && ` — ${JSON.stringify(details).slice(0, 80)}`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
        <button
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          style={{ ...S.btnGhost, fontSize: 11, padding: "5px 12px", opacity: offset === 0 ? 0.4 : 1 }}
        >
          Prev
        </button>
        <button
          disabled={entries.length < LIMIT}
          onClick={() => setOffset(offset + LIMIT)}
          style={{ ...S.btnGhost, fontSize: 11, padding: "5px 12px", opacity: entries.length < LIMIT ? 0.4 : 1 }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
