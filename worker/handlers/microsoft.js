// ─── Microsoft OAuth & API Handlers (SSO + Outlook + Calendar) ───
import { encryptSecret, decryptSecret, signJwt, buildAuthCookie, REFRESH_TOKEN_DAYS } from '../crypto.js';

const MS_SCOPES = "openid profile email offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send Calendars.Read Calendars.ReadWrite";

function getMSConfig(env) {
  return {
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
    tenantId: env.MICROSOFT_TENANT_ID,
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * GET /auth/microsoft?mode=login|link
 * Returns the Microsoft OAuth authorization URL.
 * For link mode, requires a valid Wasabi JWT (user must be authenticated).
 * For login mode, no auth required.
 */
export async function handleMicrosoftAuthUrl(request, env, user, jsonResponse) {
  const { clientId, tenantId } = getMSConfig(env);
  if (!clientId || !tenantId) {
    return jsonResponse({ _error: "Microsoft OAuth not configured" }, 500);
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "login";

  if (mode === "link" && !user) {
    return jsonResponse({ _error: "Must be authenticated to link Microsoft account" }, 401);
  }

  const state = btoa(JSON.stringify({
    mode,
    userId: mode === "link" ? user.sub : null,
    nonce: crypto.randomUUID(),
  }));

  const redirectUri = `${url.origin}/auth/microsoft/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: MS_SCOPES,
    response_mode: "query",
    state,
    prompt: "select_account",
  });

  const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`;
  return jsonResponse({ url: authUrl });
}

/**
 * GET /auth/microsoft/callback?code=...&state=...
 * Exchanges the authorization code for tokens.
 * - mode=login: finds or creates a Wasabi user by email, returns JWT via postMessage
 * - mode=link: stores tokens for the existing user, returns success via postMessage
 */
export async function handleMicrosoftCallback(request, env, jsonResponse) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const stateParam = url.searchParams.get("state");

  if (error) {
    return msCallbackHTML("error", url.searchParams.get("error_description") || error, null, null, null, jsonResponse);
  }
  if (!code) {
    return msCallbackHTML("error", "No authorization code received", null, null, null, jsonResponse);
  }

  const { clientId, clientSecret, tenantId } = getMSConfig(env);
  if (!clientId || !clientSecret || !tenantId) {
    return msCallbackHTML("error", "Microsoft OAuth not configured", null, null, null, jsonResponse);
  }

  let mode = "login";
  let linkUserId = null;
  try {
    const stateObj = JSON.parse(atob(stateParam));
    mode = stateObj.mode || "login";
    linkUserId = stateObj.userId || null;
  } catch { /* use defaults */ }

  const redirectUri = `${url.origin}/auth/microsoft/callback`;

  try {
    // Exchange code for tokens
    const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: MS_SCOPES,
      }),
    });

    if (!tokenRes.ok) {
      const errData = await tokenRes.json().catch(() => ({}));
      return msCallbackHTML("error", errData.error_description || "Token exchange failed", null, null, null, jsonResponse);
    }

    const tokenData = await tokenRes.json();

    // Fetch user profile from Microsoft Graph
    const graphRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!graphRes.ok) {
      return msCallbackHTML("error", "Failed to fetch Microsoft profile", null, null, null, jsonResponse);
    }
    const profile = await graphRes.json();

    const email = (profile.mail || profile.userPrincipalName || "").toLowerCase().trim();
    if (!email) {
      return msCallbackHTML("error", "No email address on Microsoft account", null, null, null, jsonResponse);
    }

    const msDisplayName = profile.displayName || email.split("@")[0];
    const tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + (tokenData.expires_in || 3600) * 1000,
      email,
      display_name: msDisplayName,
      microsoft_id: profile.id,
    };
    const tokensJson = await encryptSecret(JSON.stringify(tokens), env);

    // ── Link mode: store tokens for the existing user ──
    if (mode === "link" && linkUserId) {
      await env.DB.prepare(
        `INSERT INTO user_connections (user_id, key, value, updated_at)
         VALUES (?, 'microsoft', ?, datetime('now'))
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      ).bind(linkUserId, tokensJson).run();

      return msCallbackHTML("success", email, null, null, null, jsonResponse);
    }

    // ── Login mode: find or create a Wasabi user by email ──
    // Ensure email column exists (idempotent migration)
    await env.DB.prepare("ALTER TABLE users ADD COLUMN email TEXT").run().catch(() => {});

    let wasabiUser = await env.DB.prepare(
      "SELECT id, display_name, role FROM users WHERE email = ? AND deleted_at IS NULL"
    ).bind(email).first();

    if (!wasabiUser) {
      // New user — pick a unique display_name
      let chosenName = msDisplayName;
      const nameConflict = await env.DB.prepare(
        "SELECT id FROM users WHERE display_name = ? AND deleted_at IS NULL"
      ).bind(chosenName).first();
      if (nameConflict) {
        chosenName = email.split("@")[0];
        const nameConflict2 = await env.DB.prepare(
          "SELECT id FROM users WHERE display_name = ? AND deleted_at IS NULL"
        ).bind(chosenName).first();
        if (nameConflict2) {
          chosenName = `${msDisplayName} ${crypto.randomUUID().slice(0, 4)}`;
        }
      }

      const newId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO users (id, display_name, role, email, last_login_at) VALUES (?, ?, 'viewer', ?, datetime('now'))"
      ).bind(newId, chosenName, email).run();
      wasabiUser = { id: newId, display_name: chosenName, role: "viewer" };
    } else {
      // Existing user — update last login and ensure email column is populated
      await env.DB.prepare(
        "UPDATE users SET last_login_at = datetime('now'), email = ? WHERE id = ?"
      ).bind(email, wasabiUser.id).run();
    }

    // Store Microsoft tokens for this user
    await env.DB.prepare(
      `INSERT INTO user_connections (user_id, key, value, updated_at)
       VALUES (?, 'microsoft', ?, datetime('now'))
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).bind(wasabiUser.id, tokensJson).run();

    // Issue Wasabi session tokens
    const sessionId = crypto.randomUUID();
    const jwtPayload = { sub: wasabiUser.id, role: wasabiUser.role, name: wasabiUser.display_name, jti: sessionId };
    const accessToken = await signJwt(jwtPayload, env);
    const refreshToken = await signJwt(jwtPayload, env, REFRESH_TOKEN_DAYS * 86400);

    try {
      await env.DB.prepare(
        "INSERT INTO active_sessions (id, user_id, device_info) VALUES (?, ?, 'microsoft-sso')"
      ).bind(sessionId, wasabiUser.id).run();
    } catch (_) {}

    return msCallbackHTML(
      "success", email, accessToken, refreshToken,
      { id: wasabiUser.id, display_name: wasabiUser.display_name, role: wasabiUser.role },
      jsonResponse
    );
  } catch (err) {
    return msCallbackHTML("error", err.message, null, null, null, jsonResponse);
  }
}

/**
 * GET /microsoft/status
 * Returns the current Microsoft connection status for the authenticated user.
 */
export async function handleMicrosoftStatus(env, userId, jsonResponse) {
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM user_connections WHERE user_id = ? AND key = 'microsoft'"
    ).bind(userId).first();
    if (!row?.value) return jsonResponse({ connected: false });
    const tokens = JSON.parse(await decryptSecret(row.value, env));
    return jsonResponse({ connected: true, email: tokens.email || "", display_name: tokens.display_name || "" });
  } catch (err) {
    return jsonResponse({ connected: false, error: err.message });
  }
}

/**
 * POST /microsoft/disconnect
 * Removes the Microsoft token for the authenticated user.
 */
export async function handleMicrosoftDisconnect(env, userId, jsonResponse) {
  try {
    await env.DB.prepare(
      "DELETE FROM user_connections WHERE user_id = ? AND key = 'microsoft'"
    ).bind(userId).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

/**
 * Get a valid Microsoft access token for a user, refreshing if expired.
 * Returns the full token object or null if not connected / refresh failed.
 * Exported for use in Phase 3 (Outlook/Calendar handlers).
 */
export async function getMicrosoftAccessToken(userId, env) {
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM user_connections WHERE user_id = ? AND key = 'microsoft'"
    ).bind(userId).first();
    if (!row?.value) return null;

    const tokens = JSON.parse(await decryptSecret(row.value, env));
    if (!tokens.access_token) return null;

    // Return if still valid (with 60s buffer)
    if (tokens.expires_at && Date.now() < tokens.expires_at - 60000) return tokens;

    // Refresh
    if (!tokens.refresh_token) return null;
    const { clientId, clientSecret, tenantId } = getMSConfig(env);
    if (!clientId || !clientSecret || !tenantId) return null;

    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: "refresh_token",
        scope: MS_SCOPES,
      }),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const updated = {
      ...tokens,
      access_token: data.access_token,
      // Microsoft may rotate the refresh token — use new one if provided
      refresh_token: data.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    };

    await env.DB.prepare(
      `INSERT OR REPLACE INTO user_connections (user_id, key, value, updated_at)
       VALUES (?, 'microsoft', ?, datetime('now'))`
    ).bind(userId, await encryptSecret(JSON.stringify(updated), env)).run();

    return updated;
  } catch {
    return null;
  }
}

/** Generates the HTML page returned to the browser after the OAuth callback. */
function msCallbackHTML(status, detail, accessToken, refreshToken, user, jsonResponse) {
  const isSuccess = status === "success";

  // Build the postMessage payload
  let msgPayload;
  if (isSuccess && accessToken) {
    msgPayload = { type: "microsoft-oauth-login", token: accessToken, refreshToken, user };
  } else if (isSuccess) {
    msgPayload = { type: "microsoft-oauth-link", detail };
  } else {
    msgPayload = { type: "microsoft-oauth-error", detail };
  }

  // Escape JSON for safe embedding in a <script> tag (prevent </script> injection)
  const safePayload = JSON.stringify(msgPayload)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");

  const displayText = isSuccess
    ? (accessToken ? `Signed in as ${escapeHtml(detail)}` : `Connected as ${escapeHtml(detail)}`)
    : escapeHtml(detail);

  return new Response(
    `<!DOCTYPE html><html><head><title>Wasabi - Microsoft Auth</title>
<style>body{font-family:system-ui;background:#080809;color:#F2F2F3;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{text-align:center;padding:40px;border-radius:12px;background:#101012;border:1px solid #242428}
.icon{font-size:48px;margin-bottom:16px}
.msg{font-size:14px;color:#4E4E58;margin-top:8px}</style></head>
<body><div class="card">
<div class="icon">${isSuccess ? "&#10003;" : "&#10007;"}</div>
<h2>${isSuccess ? "Success!" : "Authentication Failed"}</h2>
<p class="msg">${displayText}</p>
<p class="msg">You can close this window.</p>
</div>
<script>
try{window.opener&&window.opener.postMessage(${safePayload},"*")}catch(e){}
setTimeout(function(){window.close()},3000);
</script></body></html>`,
    {
      status: isSuccess ? 200 : 400,
      headers: { ...jsonResponse.cors, "Content-Type": "text/html" },
    }
  );
}
