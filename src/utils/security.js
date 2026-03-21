// ─── Security Utilities ───
// Shared sanitization and validation functions.
// Tested in src/__tests__/security.test.js

/**
 * Escape HTML special characters to prevent XSS.
 * Handles &, <, >, ", and ' (single quote).
 */
export function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
