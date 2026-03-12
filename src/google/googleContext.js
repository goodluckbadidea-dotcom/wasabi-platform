// ─── Google Context Provider ───
// Fetches and caches Gmail + Calendar context for Wasabi's system prompt.
// Light auto-context: unread count + recent email subjects + upcoming events.
// Cached for 5 minutes to avoid excessive API calls.

import { getGmailSummary, getCalendarSummary } from "../lib/api.js";

const CACHE_KEY = "wasabi_google_context";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Read cached context from sessionStorage. */
function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { context, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return context;
  } catch {
    return null;
  }
}

/** Write context to sessionStorage cache. */
function writeCache(context) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ context, ts: Date.now() }));
  } catch { /* ignore storage errors */ }
}

/**
 * Build a compact context string from Gmail and Calendar summaries.
 * Designed to be injected into the system prompt without being noisy.
 */
function buildContextString(gmailResult, calResult) {
  const lines = ["## Google Context"];

  // Gmail summary
  if (gmailResult.status === "fulfilled" && gmailResult.value) {
    const g = gmailResult.value;
    const unread = g.unread || 0;
    let gmailLine = `- **Gmail**: ${unread} unread email${unread !== 1 ? "s" : ""}`;
    if (g.recent?.length > 0) {
      const subjects = g.recent
        .slice(0, 3)
        .map((e) => `"${(e.subject || "(no subject)").slice(0, 40)}" from ${(e.from || "unknown").split("<")[0].trim()}`)
        .join("; ");
      gmailLine += `. Recent: ${subjects}`;
    }
    lines.push(gmailLine);
  }

  // Calendar summary
  if (calResult.status === "fulfilled" && calResult.value) {
    const c = calResult.value;
    const upcoming = c.upcoming || [];
    if (upcoming.length > 0) {
      const events = upcoming
        .slice(0, 4)
        .map((ev) => {
          const time = ev.start?.dateTime
            ? new Date(ev.start.dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
            : "all day";
          return `"${(ev.summary || "Untitled").slice(0, 30)}" at ${time}`;
        })
        .join("; ");
      lines.push(`- **Calendar**: Upcoming: ${events}`);
    } else {
      lines.push("- **Calendar**: No upcoming events today");
    }
  }

  // Only return if we have actual data
  if (lines.length <= 1) return "";
  lines.push("- Use Gmail and Calendar tools when the user asks about emails or events. The above is a brief snapshot for awareness.");
  return lines.join("\n");
}

/**
 * Fetch Google context for Wasabi's system prompt.
 * Returns a compact string or empty string if Google is not connected.
 * Cached for 5 minutes.
 */
export async function fetchGoogleContext() {
  // Check cache first
  const cached = readCache();
  if (cached !== null) return cached;

  try {
    // Fetch Gmail and Calendar summaries in parallel
    const [gmailResult, calResult] = await Promise.allSettled([
      getGmailSummary(),
      getCalendarSummary(),
    ]);

    const context = buildContextString(gmailResult, calResult);
    writeCache(context);
    return context;
  } catch {
    return "";
  }
}

/** Clear the cached Google context (e.g., on disconnect). */
export function clearGoogleContextCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch { /* ignore */ }
}
