import React, { useState, useCallback, useEffect } from "react";
import { C, FONT, MONO, RADIUS } from "../../design/tokens.js";
import { ANIM } from "../../design/animations.js";
import { S } from "../../design/styles.js";
import { usePlatform } from "../../context/PlatformContext.jsx";
import ConfirmDialog from "../ConfirmDialog.jsx";
import * as api from "../../lib/api.js";
import { createInvite, listUsers, updateUser, deleteUser as apiDeleteUser } from "../../lib/api.js";
import { isAdmin } from "../../lib/roles.js";

export default function UsersTab({ identity }) {
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
              onClick={() => { try { navigator.clipboard.writeText(lastInvite.invite_code); } catch (err) { console.warn("[SystemManager] clipboard write:", err.message); } }}
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
                    background: isDeactivated ? C.error + "18" : roleBadgeColor(u.role) + "18",
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
                        onMouseEnter={(e) => { e.currentTarget.style.background = C.error + "15"; }}
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
                        onMouseEnter={(e) => { e.currentTarget.style.background = C.error + "15"; }}
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
