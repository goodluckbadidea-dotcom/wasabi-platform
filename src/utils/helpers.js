// ─── Wasabi Platform Utilities ───

// ── Date Constants ──
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_NAMES_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Generate a UUID v4
 */
export function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Debounce a function call
 */
export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Format a date string for display
 */
export function formatDate(dateStr, opts = {}) {
  if (!dateStr) return "";
  try {
    // Parse date-only strings (e.g. "2024-01-15") as local time, not UTC.
    // new Date("2024-01-15") treats it as UTC midnight, which shifts to the
    // previous day in western timezones. Split and construct locally instead.
    let d;
    const dateOnly = String(dateStr).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (dateOnly) {
      d = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    } else {
      d = new Date(dateStr);
    }
    if (isNaN(d.getTime())) return dateStr;
    const { short = false, time = false } = opts;
    if (short) {
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    const datePart = d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    if (time) {
      const timePart = d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      return `${datePart} ${timePart}`;
    }
    return datePart;
  } catch {
    return dateStr;
  }
}

/**
 * Relative time (e.g., "2 hours ago", "just now")
 */
export function timeAgo(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDate(dateStr, { short: true });
}

/**
 * Truncate text with ellipsis
 */
/**
 * Email-style date: time if today, "Mon 5" if this year, "Mon 5, 2024" otherwise.
 * Used by Gmail views and email thread drawers.
 */
export function formatEmailDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function truncate(str, max = 80) {
  if (!str || str.length <= max) return str || "";
  return str.slice(0, max).trimEnd() + "...";
}

/**
 * Sleep utility for async flows
 */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Safe JSON parse with fallback
 */
export function safeJSON(str, fallback = null) {
  try { return JSON.parse(str); }
  catch { return fallback; }
}
