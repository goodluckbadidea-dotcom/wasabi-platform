// ─── Connection handlers ───
// Manages third-party API key storage in D1 (Notion, Claude, Monday, etc.)

import { encryptSecret, decryptSecret } from '../crypto.js';

// Keys that are configs/hashes — never encrypted
const NON_SECRET_KEYS = new Set(['schema_version', 'table_pin', 'external_api_whitelist', 'figma_team_id', 'agent_confirm_writes']);
function isSecretKey(key) {
  return !NON_SECRET_KEYS.has(key) && !key.startsWith('external_api:');
}

export async function handleGetConnections(env, jsonResponse) {
  try {
    const rows = await env.DB.prepare(
      "SELECT key, value, metadata, updated_at FROM connections ORDER BY key"
    ).all();
    // Decrypt secret values before returning
    const connections = await Promise.all(
      (rows.results || []).map(async (r) => ({
        key: r.key,
        value: isSecretKey(r.key) ? await decryptSecret(r.value, env) : r.value,
        metadata: JSON.parse(r.metadata || "{}"),
        updated_at: r.updated_at,
        connected: true,
      }))
    );
    return jsonResponse({ connections });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleSetConnection(env, body, jsonResponse) {
  const { key, value, metadata } = body;
  if (!key || !value) {
    return jsonResponse({ _error: "Missing key or value" }, 400);
  }

  try {
    const storedValue = isSecretKey(key) ? await encryptSecret(value, env) : value;
    await env.DB.prepare(
      `INSERT INTO connections (key, value, metadata, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, metadata = excluded.metadata, updated_at = datetime('now')`
    ).bind(key, storedValue, JSON.stringify(metadata || {})).run();

    return jsonResponse({ ok: true, key });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleDeleteConnection(env, key, jsonResponse) {
  if (!key) return jsonResponse({ _error: "Missing connection key" }, 400);

  try {
    await env.DB.prepare("DELETE FROM connections WHERE key = ?").bind(key).run();
    return jsonResponse({ ok: true, key });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}
