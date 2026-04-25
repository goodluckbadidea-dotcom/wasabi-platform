// ─── Microsoft 365 Context Provider ───
// Fetches and caches Outlook + Calendar context for Wasabi's system prompt.
// Mirror of googleContext.js for Microsoft 365 users.
// Cached for 5 minutes to avoid excessive API calls.

import { getOutlookSummary, getOutlookCalendarSummary } from "../lib/api.js";

const CACHE_KEY = "wasabi_microsoft_context";
const CACHE_TTL = 5 * 60 * 1000;

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

function writeCache(context) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ context, ts: Date.now() }));
  } catch { /* ignore storage errors */ }
}

function buildContextString(mailResult, calResult) {
  const lines = ["## Microsoft 365 Context"];

  if (mailResult.status === "fulfilled" && mailResult.value) {
    const m = mailResult.value;
    const unread = m.unread || 0;
    let mailLine = `- **Outlook**: ${unread} unread email${unread !== 1 ? "s" : ""}`;
    if (m.recent?.length > 0) {
      const subjects = m.recent
        .slice(0, 3)
        .map((e) => `"${(e.subject || "(no subject)").slice(0, 40)}" from ${(e.fromName || e.from || "unknown")}`)
        .join("; ");
      mailLine += `. Recent: ${subjects}`;
    }
    lines.push(mailLine);
  }

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
      lines.push(`- **Outlook Calendar**: Upcoming: ${events}`);
    } else {
      lines.push("- **Outlook Calendar**: No upcoming events today");
    }
  }

  if (lines.length <= 1) return "";
  lines.push("- Use Outlook tools (search_outlook_messages, list_outlook_events, etc.) when the user asks about emails or events. The above is a brief snapshot for awareness.");
  return lines.join("\n");
}

export async function fetchMicrosoftContext() {
  const cached = readCache();
  if (cached !== null) return cached;

  try {
    const [mailResult, calResult] = await Promise.allSettled([
      getOutlookSummary(),
      getOutlookCalendarSummary(),
    ]);

    const context = buildContextString(mailResult, calResult);
    writeCache(context);
    return context;
  } catch {
    return "";
  }
}

export function clearMicrosoftContextCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch { /* ignore */ }
}
