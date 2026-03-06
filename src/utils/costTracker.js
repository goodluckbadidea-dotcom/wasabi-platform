// ─── API Cost Tracker ───
// Tracks Claude API usage (input/output tokens) per session.
// Provides running cost estimates and session summaries.
// Stores in localStorage for cross-page-load persistence within a session.

const STORAGE_KEY = "wasabi_cost_tracker";
const SESSION_KEY = "wasabi_cost_session_id";

// Token pricing (per million tokens) — Claude pricing as of 2025
const PRICING = {
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.00 },
  // Fallback for unknown models
  default: { input: 3.00, output: 15.00 },
};

function getSessionId() {
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

function loadTracker() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

function saveTracker(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

/**
 * Record a Claude API call's token usage.
 */
export function recordUsage({ model, inputTokens, outputTokens, source = "unknown" }) {
  const sessionId = getSessionId();
  const tracker = loadTracker();

  if (!tracker[sessionId]) {
    tracker[sessionId] = {
      startedAt: new Date().toISOString(),
      calls: [],
      totals: { inputTokens: 0, outputTokens: 0, estimatedCost: 0, callCount: 0 },
    };
  }

  const session = tracker[sessionId];
  const pricing = PRICING[model] || PRICING.default;
  const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;

  session.calls.push({
    timestamp: new Date().toISOString(),
    model,
    inputTokens,
    outputTokens,
    cost,
    source,
  });

  session.totals.inputTokens += inputTokens;
  session.totals.outputTokens += outputTokens;
  session.totals.estimatedCost += cost;
  session.totals.callCount += 1;

  // Keep only last 5 sessions to avoid unbounded storage
  const sessionIds = Object.keys(tracker).sort();
  while (sessionIds.length > 5) {
    delete tracker[sessionIds.shift()];
  }

  saveTracker(tracker);
}

/**
 * Get the current session's usage summary.
 */
export function getSessionUsage() {
  const sessionId = getSessionId();
  const tracker = loadTracker();
  const session = tracker[sessionId];

  if (!session) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      callCount: 0,
      startedAt: null,
    };
  }

  return {
    ...session.totals,
    startedAt: session.startedAt,
  };
}

/**
 * Get usage history across all stored sessions.
 */
export function getUsageHistory() {
  const tracker = loadTracker();
  return Object.entries(tracker).map(([id, data]) => ({
    sessionId: id,
    ...data.totals,
    startedAt: data.startedAt,
    callCount: data.calls.length,
  }));
}

/**
 * Format a cost value as a readable string.
 */
export function formatCost(cost) {
  if (cost < 0.01) return `$${(cost * 100).toFixed(2)}c`;
  return `$${cost.toFixed(4)}`;
}

/**
 * Format token count (e.g. 12345 -> "12.3k")
 */
export function formatTokens(count) {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

/**
 * Clear all stored usage data.
 */
export function clearUsageData() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {}
}
