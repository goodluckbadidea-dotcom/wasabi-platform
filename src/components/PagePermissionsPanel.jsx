// ─── Page Permissions Panel ───
// Inline panel for managing per-page user permissions (owner/editor/viewer/none).
// Admin-only. Shown inside ViewSettingsPanel under the Protection section.

import React, { useState, useEffect, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { getPagePermissions, setPagePermission, removePagePermission } from "../lib/api.js";
import { listUserDirectory } from "../lib/api.js";

const PERM_ORDER = ["owner", "editor", "viewer", "none"];
const PERM_COLORS = {
  owner: "#FF9800",
  editor: C.accent,
  viewer: "#8BC34A",
  none: C.darkMuted,
};

export default function PagePermissionsPanel({ pageId }) {
  const [permissions, setPermissions] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null); // userId being saved

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [permRes, userRes] = await Promise.all([
        getPagePermissions(pageId),
        listUserDirectory(),
      ]);
      setPermissions(permRes.permissions || []);
      setUsers(userRes.users || []);
    } catch (err) { console.warn("[PagePermissionsPanel] load:", err.message || err); }
    setLoading(false);
  }, [pageId]);

  useEffect(() => { load(); }, [load]);

  const handleChange = useCallback(async (userId, newPerm) => {
    setSaving(userId);
    try {
      if (newPerm === "remove") {
        await removePagePermission(pageId, userId);
      } else {
        await setPagePermission(pageId, userId, newPerm);
      }
      await load();
    } catch (err) { console.warn("[PagePermissionsPanel] handleChange:", err.message || err); }
    setSaving(null);
  }, [pageId, load]);

  if (loading) {
    return <div style={{ fontSize: 11, color: C.darkMuted, padding: "8px 0" }}>Loading permissions...</div>;
  }

  // Build a merged list: all users with their current permission (if any)
  const permMap = {};
  for (const p of permissions) permMap[p.user_id] = p.permission;

  const selectStyle = {
    background: C.dark,
    border: `1px solid ${C.darkBorder}`,
    color: C.darkText,
    padding: "4px 6px",
    fontSize: 11,
    borderRadius: RADIUS.sm,
    cursor: "pointer",
    fontFamily: FONT,
    minWidth: 80,
  };

  return (
    <div style={{ padding: "4px 0" }}>
      {users.length === 0 ? (
        <div style={{ fontSize: 11, color: C.darkMuted }}>No users found.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {users.map((u) => {
            const perm = permMap[u.id] || null;
            const isSaving = saving === u.id;
            return (
              <div key={u.id} style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 8px",
                background: C.dark,
                borderRadius: RADIUS.sm,
                border: `1px solid ${C.darkBorder}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: 12,
                    background: `${C.accent}33`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 600, color: C.accent,
                    flexShrink: 0,
                  }}>
                    {(u.display_name || u.email || "?")[0].toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, color: C.darkText, fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {u.display_name || u.email}
                    </div>
                    <div style={{ fontSize: 10, color: C.darkMuted }}>{u.role}</div>
                  </div>
                </div>

                <select
                  value={perm || "no_access"}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "no_access") handleChange(u.id, "remove");
                    else handleChange(u.id, val);
                  }}
                  disabled={isSaving || u.role === "admin"}
                  style={{
                    ...selectStyle,
                    opacity: isSaving ? 0.5 : 1,
                    color: perm ? PERM_COLORS[perm] || C.darkText : C.darkMuted,
                  }}
                  title={u.role === "admin" ? "Admins always have full access" : ""}
                >
                  {u.role === "admin" ? (
                    <option value="no_access">Admin (full access)</option>
                  ) : (
                    <>
                      <option value="no_access">No access</option>
                      <option value="owner">Owner</option>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </>
                  )}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
