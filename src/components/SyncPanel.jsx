// ─── Sync Panel ───
// Configure optional Notion sync for standalone D1 tables.
// Shows sync status, allows configure/push/pull/disconnect.

import React, { useState, useEffect, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import * as api from "../lib/api.js";

function buildSyncStyles() { return {
  container: {
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.lg,
    padding: 16,
    marginBottom: 12,
    fontFamily: FONT,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: C.darkText,
    letterSpacing: "0.01em",
  },
  badge: (connected) => ({
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: RADIUS.pill,
    background: connected ? "#2A6B3833" : "#88888833",
    color: connected ? "#7DC143" : "#AAAAAA",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  }),
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  label: {
    fontSize: 11,
    color: C.darkMuted,
    minWidth: 80,
  },
  value: {
    fontSize: 12,
    color: C.darkText,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  input: {
    flex: 1,
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "6px 10px",
    fontSize: 12,
    fontFamily: FONT,
    color: C.darkText,
    outline: "none",
  },
  select: {
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "6px 10px",
    fontSize: 12,
    fontFamily: FONT,
    color: C.darkText,
    outline: "none",
    cursor: "pointer",
  },
  btnRow: {
    display: "flex",
    gap: 8,
    marginTop: 12,
  },
  btn: (primary) => ({
    padding: "6px 14px",
    fontSize: 11,
    fontWeight: 600,
    fontFamily: FONT,
    border: primary ? "none" : `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    background: primary ? C.accent : "transparent",
    color: primary ? "#fff" : C.darkMuted,
    cursor: "pointer",
    transition: "opacity 0.12s",
  }),
  btnDanger: {
    padding: "6px 14px",
    fontSize: 11,
    fontWeight: 600,
    fontFamily: FONT,
    border: `1px solid #FF480044`,
    borderRadius: RADIUS.md,
    background: "transparent",
    color: "#FF6B3D",
    cursor: "pointer",
  },
  status: {
    fontSize: 11,
    color: C.darkMuted,
    marginTop: 8,
    lineHeight: 1.5,
  },
  error: {
    fontSize: 11,
    color: "#FF6B3D",
    marginTop: 8,
  },
}; }

export default function SyncPanel({ tableId }) {
  const styles = buildSyncStyles();
  const { user } = usePlatform();

  const [syncConfig, setSyncConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  // Setup form state
  const [showSetup, setShowSetup] = useState(false);
  const [notionDbId, setNotionDbId] = useState("");
  const [direction, setDirection] = useState("app_to_notion");
  const [configuring, setConfiguring] = useState(false);

  // Load sync status on mount
  useEffect(() => {
    if (!tableId) return;
    api.getSyncStatus(tableId)
      .then((result) => {
        if (result.configured) {
          setSyncConfig(result);
        }
      })
      .catch((err) => {
        console.warn("Failed to get sync status:", err);
      })
      .finally(() => setLoading(false));
  }, [tableId]);

  // ── Configure sync ──
  const handleConfigure = useCallback(async () => {
    const dbId = notionDbId.trim().replace(/.*\//, "").replace(/\?.*/g, "");
    if (!dbId) {
      setError("Enter a Notion database ID or URL");
      return;
    }
    if (!user?.notionKey) {
      setError("Add a Notion connection in System Manager first");
      return;
    }

    setConfiguring(true);
    setError("");
    try {
      const result = await api.configureSyncNotionDB(tableId, {
        notion_db_id: dbId,
        direction,
      });
      setSyncConfig({
        configured: true,
        ...result,
      });
      setShowSetup(false);
      setStatusMsg(`Linked to "${result.notion_title}". ${Object.keys(result.field_mapping || {}).length} field(s) mapped.`);
    } catch (err) {
      setError(err.message || "Failed to configure sync");
    } finally {
      setConfiguring(false);
    }
  }, [tableId, notionDbId, direction, user]);

  // ── Push ──
  const handlePush = useCallback(async () => {
    setSyncing(true);
    setError("");
    setStatusMsg("");
    try {
      const result = await api.syncPush(tableId);
      const { created, updated, errors } = result.pushed || {};
      setStatusMsg(`Push complete: ${created} created, ${updated} updated${errors ? `, ${errors} errors` : ""}`);
      // Refresh status
      const status = await api.getSyncStatus(tableId);
      if (status.configured) setSyncConfig(status);
    } catch (err) {
      setError(err.message || "Push failed");
    } finally {
      setSyncing(false);
    }
  }, [tableId]);

  // ── Pull ──
  const handlePull = useCallback(async () => {
    setSyncing(true);
    setError("");
    setStatusMsg("");
    try {
      const result = await api.syncPull(tableId);
      const { created, updated, errors } = result.pulled || {};
      setStatusMsg(`Pull complete: ${created} created, ${updated} updated${errors ? `, ${errors} errors` : ""}`);
      const status = await api.getSyncStatus(tableId);
      if (status.configured) setSyncConfig(status);
    } catch (err) {
      setError(err.message || "Pull failed");
    } finally {
      setSyncing(false);
    }
  }, [tableId]);

  // ── Disconnect ──
  const handleDisconnect = useCallback(async () => {
    try {
      await api.deleteSync(tableId);
      setSyncConfig(null);
      setStatusMsg("Sync disconnected");
    } catch (err) {
      setError(err.message || "Failed to disconnect");
    }
  }, [tableId]);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ fontSize: 11, color: C.darkMuted }}>Loading sync status...</div>
      </div>
    );
  }

  // ── Connected state ──
  if (syncConfig?.configured) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.title}>Notion Sync</span>
          <span style={styles.badge(true)}>Connected</span>
        </div>

        <div style={styles.row}>
          <span style={styles.label}>Notion DB</span>
          <span style={styles.value}>{syncConfig.notion_db_id}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>Direction</span>
          <span style={styles.value}>
            {syncConfig.direction === "two_way" ? "Two-way" : "App \u2192 Notion"}
          </span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>Fields</span>
          <span style={styles.value}>
            {Object.keys(syncConfig.field_mapping || {}).length} mapped
          </span>
        </div>
        {syncConfig.last_synced_at && (
          <div style={styles.row}>
            <span style={styles.label}>Last sync</span>
            <span style={styles.value}>{new Date(syncConfig.last_synced_at).toLocaleString()}</span>
          </div>
        )}

        <div style={styles.btnRow}>
          <button
            style={styles.btn(true)}
            onClick={handlePush}
            disabled={syncing}
          >
            {syncing ? "Syncing..." : "Push to Notion"}
          </button>
          {syncConfig.direction === "two_way" && (
            <button
              style={styles.btn(false)}
              onClick={handlePull}
              disabled={syncing}
            >
              Pull from Notion
            </button>
          )}
          <button
            style={styles.btnDanger}
            onClick={handleDisconnect}
          >
            Disconnect
          </button>
        </div>

        {statusMsg && <div style={styles.status}>{statusMsg}</div>}
        {error && <div style={styles.error}>{error}</div>}
      </div>
    );
  }

  // ── Setup form ──
  if (showSetup) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.title}>Configure Notion Sync</span>
        </div>

        <div style={{ ...styles.row, marginBottom: 12 }}>
          <span style={styles.label}>Notion DB</span>
          <input
            type="text"
            value={notionDbId}
            onChange={(e) => setNotionDbId(e.target.value)}
            placeholder="Paste Notion database ID or URL"
            style={styles.input}
          />
        </div>

        <div style={{ ...styles.row, marginBottom: 4 }}>
          <span style={styles.label}>Direction</span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            style={styles.select}
          >
            <option value="app_to_notion">App to Notion (one-way push)</option>
            <option value="two_way">Two-way sync</option>
          </select>
        </div>

        <p style={{ fontSize: 10, color: C.darkMuted, margin: "4px 0 0 88px", lineHeight: 1.4 }}>
          Fields are auto-mapped by matching column names.
        </p>

        <div style={styles.btnRow}>
          <button
            style={styles.btn(true)}
            onClick={handleConfigure}
            disabled={configuring}
          >
            {configuring ? "Configuring..." : "Connect"}
          </button>
          <button
            style={styles.btn(false)}
            onClick={() => { setShowSetup(false); setError(""); }}
          >
            Cancel
          </button>
        </div>

        {error && <div style={styles.error}>{error}</div>}
      </div>
    );
  }

  // ── Not connected — show setup button ──
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Notion Sync</span>
        <span style={styles.badge(false)}>Not connected</span>
      </div>
      <p style={{ fontSize: 11, color: C.darkMuted, lineHeight: 1.5, margin: "0 0 12px" }}>
        Optionally sync this table with a Notion database. Push changes to Notion or pull data in.
      </p>
      <button
        style={styles.btn(true)}
        onClick={() => setShowSetup(true)}
      >
        Configure Sync
      </button>
      {statusMsg && <div style={styles.status}>{statusMsg}</div>}
    </div>
  );
}
