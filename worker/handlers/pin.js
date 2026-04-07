// ─── PIN lock handlers ───
import { hashPassword, verifyPassword } from '../crypto.js';

export async function handleSetPin(env, body, jsonResponse) {
  const { pin } = body || {};
  if (!pin || pin.length < 4) {
    return jsonResponse({ _error: "PIN must be at least 4 characters" }, 400);
  }
  try {
    const hashed = await hashPassword(pin);
    await env.DB.prepare(
      "INSERT OR REPLACE INTO connections (key, value, updated_at) VALUES ('table_pin', ?, datetime('now'))"
    ).bind(hashed).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleVerifyPin(env, body, user, jsonResponse) {
  const { pin, page_id } = body || {};
  if (!pin) return jsonResponse({ _error: "PIN required" }, 400);
  try {
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'table_pin'").first();
    if (!row) return jsonResponse({ _error: "No PIN configured" }, 404);
    const valid = await verifyPassword(pin, row.value);
    if (!valid) return jsonResponse({ _error: "Incorrect PIN" }, 403);

    // Auto-migrate legacy PIN hash to PBKDF2
    if (!row.value.includes(":")) {
      const newHash = await hashPassword(pin);
      await env.DB.prepare(
        "UPDATE connections SET value = ?, updated_at = datetime('now') WHERE key = 'table_pin'"
      ).bind(newHash).run();
    }

    // Issue a server-side PIN session token (15 minute TTL)
    const pinToken = crypto.randomUUID();
    const userId = user?.sub || "anonymous";
    const pageId = page_id || "_global";
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    try {
      await env.DB.prepare(
        "INSERT INTO pin_sessions (token, user_id, page_id, expires_at) VALUES (?, ?, ?, ?)"
      ).bind(pinToken, userId, pageId, expiresAt).run();
    } catch (_) {}

    return jsonResponse({ ok: true, verified: true, pin_token: pinToken, expires_in: 900 });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}
