// ─── Role Utilities ───
// Shared helpers for role-based UI gating.

export function isAdmin(identity) {
  return identity?.role === "admin";
}
