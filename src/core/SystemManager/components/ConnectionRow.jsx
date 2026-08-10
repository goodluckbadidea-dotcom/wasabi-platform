import React, { useState, useCallback } from "react";
import { C, FONT, MONO, RADIUS } from "../../../design/tokens.js";

const CONNECTION_DEFS = [
  { key: "notion", label: "Notion", placeholder: "ntn_...", description: "Connect a Notion integration to link databases and sync data." },
  { key: "claude", label: "Claude", placeholder: "sk-ant-...", description: "Anthropic API key for AI chat, automations, and agent tools." },
  { key: "monday", label: "Monday.com", placeholder: "eyJhbGc...", description: "Connect to Monday.com boards to sync items and columns." },
  { key: "figma", label: "Figma", placeholder: "figd_...", description: "Personal access token for browsing Figma projects and importing design files." },
  { key: "figma_team_id", label: "Figma Team ID", placeholder: "123456789", description: "Team ID from your Figma team URL (figma.com/files/team/{id}).", inputType: "text" },
];

// `connected` = a credential row exists in D1. That governs which actions show
// (Add vs Update/Remove) — a dead token still needs Update/Remove, not Add.
//
// `liveStatus` (optional) = the result of actually exercising the credential
// against the provider. When supplied it overrides the dot + status label, so a
// stored-but-rejected token reads as broken instead of falsely "Connected".
//   { state: "checking" | "ok" | "error", label: string, detail?: string }
function ConnectionRow({ def, connected, liveStatus, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const dotColor = liveStatus
    ? (liveStatus.state === "ok" ? C.accent : liveStatus.state === "error" ? C.warning : C.darkMuted + "44")
    : (connected ? C.accent : C.darkMuted + "44");
  const statusColor = liveStatus
    ? (liveStatus.state === "ok" ? C.accent : liveStatus.state === "error" ? C.warning : C.darkMuted)
    : (connected ? C.accent : C.darkMuted);
  const statusLabel = liveStatus
    ? liveStatus.label
    : (connected ? "Connected" : "Not connected");

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
          background: dotColor,
        }} />
        {/* Name */}
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: C.darkText, fontFamily: FONT }}>
          {def.label}
        </span>
        {/* Status label */}
        <span style={{ fontSize: 10, color: statusColor, fontFamily: FONT }}>
          {statusLabel}
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

      {/* Live-status detail — only rendered when the credential is rejected */}
      {!editing && liveStatus?.detail && (
        <p style={{
          fontSize: 11, color: C.warning, fontFamily: FONT,
          marginTop: 6, marginLeft: 18, lineHeight: 1.4,
        }}>
          {liveStatus.detail}
        </p>
      )}

      {/* Edit form */}
      {editing && (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type={def.inputType || "password"}
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

export { CONNECTION_DEFS };
export default ConnectionRow;
