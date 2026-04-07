// ─── Rate Limiting (D1-backed) ───
/**
 * D1-backed rate limiter — persists across worker isolates.
 * Stores individual timestamps in `rate_limits` table so we can count
 * attempts within a sliding window.
 */
export async function checkRateLimit(db, key, maxAttempts = 5, windowSecs = 900) {
  const nowSecs = Math.floor(Date.now() / 1000);
  const windowStart = nowSecs - windowSecs;
  try {
    const { results } = await db
      .prepare("SELECT ts FROM rate_limits WHERE key = ? AND ts > ? ORDER BY ts ASC")
      .bind(key, windowStart)
      .all();
    if (results.length >= maxAttempts) {
      const oldestInWindow = results[0].ts;
      const retryAfter = oldestInWindow + windowSecs - nowSecs;
      return { limited: true, retryAfter: Math.max(retryAfter, 1) };
    }
    // Don't record here — caller records only on failure via recordRateLimitAttempt()
    return { limited: false };
  } catch (_) {
    // If the table doesn't exist yet (pre-migration), allow the request
    return { limited: false };
  }
}

// Record a failed auth attempt for rate limiting (only call on failure)
export async function recordRateLimitAttempt(db, key) {
  const nowSecs = Math.floor(Date.now() / 1000);
  try {
    await db.prepare("INSERT INTO rate_limits (key, ts) VALUES (?, ?)").bind(key, nowSecs).run();
  } catch (_) {}
}

// Clear rate limit entries on successful login (reset the window)
export async function clearRateLimit(db, key) {
  try {
    await db.prepare("DELETE FROM rate_limits WHERE key = ?").bind(key).run();
  } catch (_) {}
}
