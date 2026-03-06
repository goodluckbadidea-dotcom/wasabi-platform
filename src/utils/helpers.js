// ─── Wasabi Platform Utilities ───

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
 * Throttle a function call
 */
export function throttle(fn, ms = 300) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      return fn(...args);
    }
  };
}

/**
 * Format a date string for display
 */
export function formatDate(dateStr, opts = {}) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
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
export function truncate(str, max = 80) {
  if (!str || str.length <= max) return str || "";
  return str.slice(0, max).trimEnd() + "...";
}

/**
 * Capitalize first letter
 */
export function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Sleep utility for async flows
 */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Clamp a number between min and max
 */
export function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

/**
 * Simple string hash (for deterministic color assignment)
 */
export function hashString(str) {
  let hash = 0;
  for (let i = 0; i < (str || "").length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

/**
 * Group an array by a key function
 */
export function groupBy(arr, keyFn) {
  const map = {};
  for (const item of arr) {
    const key = keyFn(item);
    if (!map[key]) map[key] = [];
    map[key].push(item);
  }
  return map;
}

/**
 * Sort array by multiple keys (stable)
 */
export function sortBy(arr, ...fns) {
  return [...arr].sort((a, b) => {
    for (const fn of fns) {
      const va = fn(a), vb = fn(b);
      if (va < vb) return -1;
      if (va > vb) return 1;
    }
    return 0;
  });
}

/**
 * Deep clone an object (simple — JSON-safe only)
 */
export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Safe JSON parse with fallback
 */
export function safeJSON(str, fallback = null) {
  try { return JSON.parse(str); }
  catch { return fallback; }
}
