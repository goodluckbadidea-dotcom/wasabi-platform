// ─── Auth handlers ───
import { hashPassword, verifyPassword, signJwt, buildAuthCookie, REFRESH_TOKEN_DAYS } from '../crypto.js';

export async function handleAuthRegister(env, body, jsonResponse) {
  const { invite_code, display_name, password } = body || {};
  if (!invite_code || !display_name?.trim()) {
    return jsonResponse({ _error: "invite_code and display_name required" }, 400);
  }
  if (!password || password.length < 10 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    return jsonResponse({ _error: "Password must be at least 10 characters with uppercase, lowercase, and a number" }, 400);
  }

  try {
    // Find the invite (pending user with unused invite code, OR existing user with cleared password for re-registration)
    // Also check invite hasn't expired (NULL invite_expires_at = no expiry for legacy invites)
    const invite = await env.DB.prepare(
      "SELECT id, role, display_name, password_hash FROM users WHERE invite_code = ? AND deleted_at IS NULL AND (invite_expires_at IS NULL OR invite_expires_at > datetime('now'))"
    ).bind(invite_code.trim()).first();

    if (!invite) {
      return jsonResponse({ _error: "Invalid, expired, or already used invite code" }, 400);
    }

    // Check display name uniqueness (exclude this user's own record)
    const nameCheck = await env.DB.prepare(
      "SELECT id FROM users WHERE display_name = ? AND id != ? AND deleted_at IS NULL"
    ).bind(display_name.trim(), invite.id).first();
    if (nameCheck) {
      return jsonResponse({ _error: "Display name already taken" }, 400);
    }

    // Hash password with PBKDF2
    const passwordHash = await hashPassword(password);

    // Update the user record: set display name, password, mark as registered
    const now = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE users SET display_name = ?, password_hash = ?, last_login_at = ?, invite_code = NULL WHERE id = ?"
    ).bind(display_name.trim(), passwordHash, now, invite.id).run();

    // Generate JWT with session ID (access + refresh tokens)
    const sessionId = crypto.randomUUID();
    const jwtPayload = { sub: invite.id, role: invite.role, name: display_name.trim(), jti: sessionId };
    const accessToken = await signJwt(jwtPayload, env); // 15 min
    const refreshToken = await signJwt(jwtPayload, env, REFRESH_TOKEN_DAYS * 86400); // 7 days
    // Record session
    try {
      const deviceInfo = (body._device_info || "").slice(0, 200);
      await env.DB.prepare(
        "INSERT INTO active_sessions (id, user_id, device_info) VALUES (?, ?, ?)"
      ).bind(sessionId, invite.id, deviceInfo).run();
    } catch (_) {}
    return jsonResponse(
      { ok: true, token: accessToken, user: { id: invite.id, display_name: display_name.trim(), role: invite.role } },
      200,
      { "Set-Cookie": buildAuthCookie(refreshToken) }
    );
  } catch (err) {
    return jsonResponse({ _error: `Registration failed: ${err.message}` }, 500);
  }
}

export async function handleAuthLogin(env, body, jsonResponse) {
  const { display_name, password } = body || {};

  if (!display_name?.trim() || !password) {
    return jsonResponse({ _error: "Invalid credentials" }, 401);
  }

  try {
    // Look up by display name (active users only)
    const user = await env.DB.prepare(
      "SELECT id, display_name, role, password_hash FROM users WHERE display_name = ? AND deleted_at IS NULL AND password_hash IS NOT NULL"
    ).bind(display_name.trim()).first();

    if (!user) {
      return jsonResponse({ _error: "Invalid credentials" }, 401);
    }

    // Verify password (supports both legacy SHA-256 and PBKDF2)
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return jsonResponse({ _error: "Invalid credentials" }, 401);
    }

    // Auto-migrate legacy hash to PBKDF2 on successful login
    if (!user.password_hash.includes(":")) {
      const newHash = await hashPassword(password);
      await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
        .bind(newHash, user.id).run();
    }

    // Update last login
    await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), user.id).run();

    const sessionId = crypto.randomUUID();
    const jwtPayload = { sub: user.id, role: user.role, name: user.display_name, jti: sessionId };
    const accessToken = await signJwt(jwtPayload, env); // 15 min (default)
    const refreshToken = await signJwt(jwtPayload, env, REFRESH_TOKEN_DAYS * 86400); // 7 days
    // Record session
    try {
      const deviceInfo = (body._device_info || "").slice(0, 200);
      await env.DB.prepare(
        "INSERT INTO active_sessions (id, user_id, device_info) VALUES (?, ?, ?)"
      ).bind(sessionId, user.id, deviceInfo).run();
    } catch (_) {}
    return jsonResponse(
      { ok: true, token: accessToken, refreshToken, user: { id: user.id, display_name: user.display_name, role: user.role } },
      200,
      { "Set-Cookie": buildAuthCookie(refreshToken) }
    );
  } catch (err) {
    return jsonResponse({ _error: `Login failed: ${err.message}` }, 500);
  }
}

export async function handleAuthMe(env, jwtPayload, jsonResponse) {
  try {
    const user = await env.DB.prepare(
      "SELECT id, display_name, role, created_at, last_login_at FROM users WHERE id = ?"
    ).bind(jwtPayload.sub).first();
    if (!user) return jsonResponse({ _error: "User not found" }, 404);

    // Issue a fresh access token so the client can repopulate memory after page refresh.
    // Also refresh the cookie so the 7-day window resets on activity.
    const jwtP = { sub: user.id, role: user.role, name: user.display_name, jti: jwtPayload.jti || null };
    const accessToken = await signJwt(jwtP, env); // 15 min
    const refreshToken = await signJwt(jwtP, env, REFRESH_TOKEN_DAYS * 86400); // 7 days
    return jsonResponse(
      { user, token: accessToken, refreshToken },
      200,
      { "Set-Cookie": buildAuthCookie(refreshToken) }
    );
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleAuthRefresh(env, jwtPayload, jsonResponse) {
  try {
    const user = await env.DB.prepare(
      "SELECT id, display_name, role FROM users WHERE id = ?"
    ).bind(jwtPayload.sub).first();
    if (!user) return jsonResponse({ _error: "User not found" }, 404);

    // Issue new access token, rotate refresh cookie
    const jwtP = { sub: user.id, role: user.role, name: user.display_name, jti: jwtPayload.jti || null };
    const accessToken = await signJwt(jwtP, env); // 15 min
    const refreshToken = await signJwt(jwtP, env, REFRESH_TOKEN_DAYS * 86400); // 7 days
    return jsonResponse(
      { ok: true, token: accessToken, refreshToken, user: { id: user.id, display_name: user.display_name, role: user.role } },
      200,
      { "Set-Cookie": buildAuthCookie(refreshToken) }
    );
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// GET /auth/users — display names of accounts that can sign in.
//
// Deliberately unauthenticated: it backs the login screen's user picker, which
// is needed before anyone has credentials. Returns ONLY display names — no ids,
// roles, timestamps or password state — so it discloses the roster and nothing
// more. Filtered to active accounts that have actually set a password, so
// deleted users and unredeemed invites never appear.
//
// This does hand an attacker a list of valid names, leaving only the password
// to guess. POST /auth/login is rate-limited per IP, which is what bounds that.
export async function handleAuthUsers(env, jsonResponse) {
  try {
    const res = await env.DB.prepare(
      `SELECT display_name FROM users
        WHERE deleted_at IS NULL
          AND password_hash IS NOT NULL
          AND display_name IS NOT NULL
        ORDER BY display_name COLLATE NOCASE ASC`
    ).all();
    return jsonResponse({ users: (res.results || []).map((r) => r.display_name) });
  } catch (err) {
    // Never block the login screen on this — the frontend falls back to a
    // free-text name field when the list is empty or unavailable.
    return jsonResponse({ users: [], _warning: err.message });
  }
}
