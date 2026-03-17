// ─── Role Utilities ───
// Shared helpers for role-based UI gating.

const ROLE_LEVEL = { admin: 3, editor: 2, viewer: 1 };

export function hasRole(userRole, minRole) {
  return (ROLE_LEVEL[userRole] || 0) >= (ROLE_LEVEL[minRole] || 99);
}

export function isAdmin(identity) {
  return identity?.role === "admin";
}

export function isViewer(identity) {
  return identity?.role === "viewer";
}
