// ─── Google OAuth & API Handlers (Gmail + Calendar + Sheets) ───
import { encryptSecret, decryptSecret } from '../crypto.js';

// Per-feature scope groups. A "grant" is a friendly name for one of these groups.
// Users opt in to grants individually; we request only the scopes for chosen grants.
const SCOPE_GROUPS = {
  gmail: [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
  ],
  calendar: [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
  ],
  sheets: [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ],
};

// Always requested so we can identify the connected account.
const BASE_SCOPES = ["https://www.googleapis.com/auth/userinfo.email"];

const VALID_GRANTS = Object.keys(SCOPE_GROUPS);

function grantsToScopeString(grants) {
  const set = new Set(BASE_SCOPES);
  for (const g of grants || []) {
    if (SCOPE_GROUPS[g]) SCOPE_GROUPS[g].forEach((s) => set.add(s));
  }
  return Array.from(set).join(" ");
}

// Derive the friendly grants array from a raw scope string (used for migrating
// existing tokens that pre-date the grants field).
function scopesToGrants(scopeString) {
  const scopes = (scopeString || "").split(/\s+/).filter(Boolean);
  const grants = [];
  for (const [name, groupScopes] of Object.entries(SCOPE_GROUPS)) {
    // Grant is considered active if ANY of its group scopes is present.
    if (groupScopes.some((s) => scopes.includes(s))) grants.push(name);
  }
  return grants;
}

function normalizeGrantsParam(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(",");
  return list.map((g) => g.trim()).filter((g) => VALID_GRANTS.includes(g));
}

/**
 * Get a valid Google access token for a specific user.
 * Checks user_connections first, then falls back to global connections.
 * Returns { access_token, email } or null if not connected.
 */
async function getGoogleAccessTokenForUser(env, userId) {
  // No userId (MCP/API key access) — use global connection
  if (!userId) return getGoogleAccessToken(env);
  // Per-user: only use their own token, NEVER fall back to global
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM user_connections WHERE user_id = ? AND key = 'google'"
    ).bind(userId).first();
    if (!row?.value) return null; // User has no Google connection
    const tokens = JSON.parse(await decryptSecret(row.value, env));
    if (!tokens.access_token || !tokens.refresh_token) return null;
    // Check expiry
    if (tokens.expires_at && Date.now() < tokens.expires_at - 60000) return tokens;
    // Refresh
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: tokens.refresh_token, grant_type: "refresh_token" }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const updated = { ...tokens, access_token: data.access_token, expires_at: Date.now() + (data.expires_in || 3600) * 1000 };
    await env.DB.prepare(
      "INSERT OR REPLACE INTO user_connections (user_id, key, value, updated_at) VALUES (?, 'google', ?, datetime('now'))"
    ).bind(userId, await encryptSecret(JSON.stringify(updated), env)).run();
    return updated;
  } catch { return null; }
}

/**
 * Get a valid Google access token, refreshing if expired.
 * Returns { access_token, email } or null if not connected.
 */
async function getGoogleAccessToken(env) {
  let row;
  try {
    row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'google'").first();
  } catch { return null; }
  if (!row?.value) return null;

  const tokens = JSON.parse(await decryptSecret(row.value, env));
  if (!tokens.access_token || !tokens.refresh_token) return null;

  // Check if token is still valid (with 60s buffer)
  if (tokens.expires_at && Date.now() < tokens.expires_at - 60000) {
    return tokens;
  }

  // Refresh the token
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();

    const updated = {
      ...tokens,
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    };

    // Persist refreshed tokens (encrypted)
    await env.DB.prepare(
      `UPDATE connections SET value = ?, updated_at = datetime('now') WHERE key = 'google'`
    ).bind(await encryptSecret(JSON.stringify(updated), env)).run();

    return updated;
  } catch {
    return null;
  }
}

export function handleGoogleAuthUrl(request, env, userId, jsonResponse) {
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) return jsonResponse({ _error: "GOOGLE_CLIENT_ID not configured" }, 500);

  const reqUrl = new URL(request.url);
  const workerUrl = reqUrl.origin;
  const redirectUri = `${workerUrl}/google/callback`;

  // Caller specifies which grants to request via ?grants=gmail,sheets.
  // Default to gmail+calendar for backward compatibility with old clients.
  const grants = normalizeGrantsParam(reqUrl.searchParams.get("grants"))
    .filter((g, i, arr) => arr.indexOf(g) === i);
  const requested = grants.length ? grants : ["gmail", "calendar"];

  // Encode user ID + requested grants in state so the callback can resolve them.
  const stateObj = { workerUrl, userId: userId || null, grants: requested };
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: grantsToScopeString(requested),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: JSON.stringify(stateObj),
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  return jsonResponse({ url });
}

export async function handleGoogleCallback(request, env, jsonResponse) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(callbackHTML("error", error), {
      status: 400,
      headers: { ...jsonResponse.cors, "Content-Type": "text/html" },
    });
  }

  if (!code) {
    return new Response(callbackHTML("error", "No authorization code received"), {
      status: 400,
      headers: { ...jsonResponse.cors, "Content-Type": "text/html" },
    });
  }

  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response(callbackHTML("error", "Google OAuth not configured"), {
      status: 500,
      headers: { ...jsonResponse.cors, "Content-Type": "text/html" },
    });
  }

  const workerUrl = url.origin;
  const redirectUri = `${workerUrl}/google/callback`;

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return new Response(callbackHTML("error", `Token exchange failed: ${errText}`), {
        status: 502,
        headers: { ...jsonResponse.cors, "Content-Type": "text/html" },
      });
    }

    const tokenData = await tokenRes.json();

    // Fetch user email
    let email = "";
    try {
      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        email = userData.email || "";
      }
    } catch {}

    // Extract state (user ID + requested grants)
    let stateUserId = null;
    let requestedGrants = [];
    const stateParam = url.searchParams.get("state");
    try {
      const stateObj = JSON.parse(stateParam);
      stateUserId = stateObj.userId || null;
      requestedGrants = Array.isArray(stateObj.grants) ? stateObj.grants : [];
    } catch { /* state may be plain URL from old flow */ }

    // Compute the actual grants Google issued. Token response includes a `scope`
    // field listing what the user approved (may be a subset of what we asked for).
    const grantedScopes = tokenData.scope || "";
    const newGrants = scopesToGrants(grantedScopes);

    // Look up any existing token row so we can merge grants + preserve refresh_token
    // when Google omits it on incremental consent.
    let existing = null;
    try {
      if (stateUserId) {
        const row = await env.DB.prepare(
          "SELECT value FROM user_connections WHERE user_id = ? AND key = 'google'"
        ).bind(stateUserId).first();
        if (row?.value) existing = JSON.parse(await decryptSecret(row.value, env));
      } else {
        const row = await env.DB.prepare(
          "SELECT value FROM connections WHERE key = 'google'"
        ).first();
        if (row?.value) existing = JSON.parse(await decryptSecret(row.value, env));
      }
    } catch {}

    // Merge grants: union of (existing grants) ∪ (newly granted).
    // We don't shrink grants here — that's only done via /google/disconnect.
    const existingGrants = Array.isArray(existing?.grants)
      ? existing.grants
      : scopesToGrants(existing?.scopes || "");
    const mergedGrants = Array.from(new Set([...existingGrants, ...newGrants]));

    // Store tokens in D1
    const tokens = {
      access_token: tokenData.access_token,
      // Google sometimes omits refresh_token on subsequent consents — keep prior.
      refresh_token: tokenData.refresh_token || existing?.refresh_token || null,
      expires_at: Date.now() + (tokenData.expires_in || 3600) * 1000,
      email: email || existing?.email || "",
      scopes: grantedScopes,
      grants: mergedGrants,
    };

    const tokensJson = await encryptSecret(JSON.stringify(tokens), env);

    if (stateUserId) {
      // Store per-user in user_connections — this is the primary storage
      await env.DB.prepare(
        `INSERT INTO user_connections (user_id, key, value, updated_at)
         VALUES (?, 'google', ?, datetime('now'))
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      ).bind(stateUserId, tokensJson).run();
    } else {
      // No user context (shouldn't happen from UI, but handle MCP/direct access)
      await env.DB.prepare(
        `INSERT INTO connections (key, value, metadata, updated_at)
         VALUES ('google', ?, '{}', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      ).bind(tokensJson).run();
    }

    return new Response(callbackHTML("success", email), {
      status: 200,
      headers: { ...jsonResponse.cors, "Content-Type": "text/html" },
    });
  } catch (err) {
    return new Response(callbackHTML("error", err.message), {
      status: 500,
      headers: { ...jsonResponse.cors, "Content-Type": "text/html" },
    });
  }
}

/** Generate HTML for the OAuth callback popup page. */
function callbackHTML(status, detail) {
  const isSuccess = status === "success";
  return `<!DOCTYPE html><html><head><title>Wasabi - Google Auth</title>
<style>body{font-family:system-ui;background:#080809;color:#F2F2F3;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{text-align:center;padding:40px;border-radius:12px;background:#101012;border:1px solid #242428}
.icon{font-size:48px;margin-bottom:16px}
.msg{font-size:14px;color:#4E4E58;margin-top:8px}</style></head>
<body><div class="card">
<div class="icon">${isSuccess ? "&#10003;" : "&#10007;"}</div>
<h2>${isSuccess ? "Connected!" : "Connection Failed"}</h2>
<p class="msg">${isSuccess ? `Signed in as ${detail}` : detail}</p>
<p class="msg">You can close this window.</p>
</div>
<script>
try{window.opener&&window.opener.postMessage({type:"google-oauth-${status}",detail:"${detail}"},"*")}catch(e){}
setTimeout(function(){window.close()},3000);
</script></body></html>`;
}

// Read the token row for the given user (or global if userId is null).
// Returns { tokens, scope: "user"|"global" } or null if not connected.
async function readGoogleTokens(env, userId) {
  try {
    if (userId) {
      const row = await env.DB.prepare(
        "SELECT value FROM user_connections WHERE user_id = ? AND key = 'google'"
      ).bind(userId).first();
      if (!row?.value) return null;
      const tokens = JSON.parse(await decryptSecret(row.value, env));
      return { tokens, scope: "user" };
    }
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'google'").first();
    if (!row?.value) return null;
    const tokens = JSON.parse(await decryptSecret(row.value, env));
    return { tokens, scope: "global" };
  } catch {
    return null;
  }
}

async function writeGoogleTokens(env, userId, tokens) {
  const json = await encryptSecret(JSON.stringify(tokens), env);
  if (userId) {
    await env.DB.prepare(
      `INSERT INTO user_connections (user_id, key, value, updated_at)
       VALUES (?, 'google', ?, datetime('now'))
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).bind(userId, json).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO connections (key, value, metadata, updated_at)
       VALUES ('google', ?, '{}', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).bind(json).run();
  }
}

async function deleteGoogleRow(env, userId) {
  if (userId) {
    await env.DB.prepare("DELETE FROM user_connections WHERE user_id = ? AND key = 'google'").bind(userId).run();
  } else {
    await env.DB.prepare("DELETE FROM connections WHERE key = 'google'").run();
  }
}

export async function handleGoogleStatus(env, userId, jsonResponse) {
  try {
    const result = await readGoogleTokens(env, userId);
    if (!result) return jsonResponse({ connected: false, grants: [] });
    const { tokens } = result;

    // Backfill grants for tokens that pre-date the grants field.
    let grants = Array.isArray(tokens.grants) ? tokens.grants : null;
    if (!grants) {
      grants = scopesToGrants(tokens.scopes || "");
      // Persist the migration so we only do this once.
      try {
        await writeGoogleTokens(env, userId, { ...tokens, grants });
      } catch { /* non-fatal — status will recompute on next call */ }
    }

    return jsonResponse({
      connected: true,
      email: tokens.email || "",
      scopes: tokens.scopes || "",
      grants,
    });
  } catch (err) {
    return jsonResponse({ connected: false, grants: [], error: err.message });
  }
}

export async function handleGoogleDisconnect(env, userId, request, jsonResponse) {
  try {
    // Optional: disconnect a single grant via ?grant=gmail. With no param,
    // disconnect everything (revoke token at Google + delete row).
    const reqUrl = new URL(request.url);
    const grantParam = reqUrl.searchParams.get("grant");
    const grant = grantParam && VALID_GRANTS.includes(grantParam) ? grantParam : null;

    const result = await readGoogleTokens(env, userId);
    if (!result) return jsonResponse({ ok: true });
    const { tokens } = result;

    if (grant) {
      // Per-grant disconnect: shrink the grants array. The OAuth token at
      // Google's end retains all scopes — revoking a single scope requires
      // re-authorization. Local gating prevents Wasabi from using the dropped
      // grant. Users who want full revocation can revoke at myaccount.google.com.
      const currentGrants = Array.isArray(tokens.grants)
        ? tokens.grants
        : scopesToGrants(tokens.scopes || "");
      const remaining = currentGrants.filter((g) => g !== grant);

      if (remaining.length === 0) {
        // No grants left — revoke at Google and delete the row.
        if (tokens.access_token) {
          await fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.access_token}`, { method: "POST" }).catch(() => {});
        }
        await deleteGoogleRow(env, userId);
        return jsonResponse({ ok: true, grants: [] });
      }

      await writeGoogleTokens(env, userId, { ...tokens, grants: remaining });
      return jsonResponse({ ok: true, grants: remaining });
    }

    // Full disconnect: revoke at Google + delete row.
    if (tokens.access_token) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.access_token}`, { method: "POST" }).catch(() => {});
    }
    await deleteGoogleRow(env, userId);
    return jsonResponse({ ok: true, grants: [] });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Gmail API Proxy Handlers ───

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export async function handleGmailSummary(env, userId, jsonResponse) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  try {
    // Get unread count
    const unreadRes = await fetch(`${GMAIL_API}/messages?q=is:unread+in:inbox&maxResults=1`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const unreadData = await unreadRes.json();
    const unread = unreadData.resultSizeEstimate || 0;

    // Get recent messages (just headers)
    const recentRes = await fetch(`${GMAIL_API}/messages?maxResults=5&labelIds=INBOX`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const recentData = await recentRes.json();
    const messages = recentData.messages || [];

    // Fetch headers for each recent message
    const recent = await Promise.all(
      messages.slice(0, 5).map(async (m) => {
        try {
          const msgRes = await fetch(`${GMAIL_API}/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          });
          const msg = await msgRes.json();
          const headers = msg.payload?.headers || [];
          return {
            id: m.id,
            threadId: m.threadId,
            subject: headers.find((h) => h.name === "Subject")?.value || "(no subject)",
            from: headers.find((h) => h.name === "From")?.value || "",
            date: headers.find((h) => h.name === "Date")?.value || "",
            snippet: msg.snippet || "",
            labelIds: msg.labelIds || [],
          };
        } catch { return null; }
      })
    );

    return jsonResponse({ unread, recent: recent.filter(Boolean) });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleGmailSearch(env, body, userId, jsonResponse) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  const { q, maxResults = 20, labelIds } = body;
  try {
    let url = `${GMAIL_API}/messages?maxResults=${maxResults}`;
    if (q) url += `&q=${encodeURIComponent(q)}`;
    if (labelIds) url += `&labelIds=${encodeURIComponent(labelIds)}`;

    const listRes = await fetch(url, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const listData = await listRes.json();
    const messageIds = listData.messages || [];

    // Fetch metadata for each message
    const messages = await Promise.all(
      messageIds.slice(0, maxResults).map(async (m) => {
        try {
          const msgRes = await fetch(`${GMAIL_API}/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          });
          const msg = await msgRes.json();
          const headers = msg.payload?.headers || [];
          return {
            id: m.id,
            threadId: m.threadId,
            subject: headers.find((h) => h.name === "Subject")?.value || "(no subject)",
            from: headers.find((h) => h.name === "From")?.value || "",
            to: headers.find((h) => h.name === "To")?.value || "",
            date: headers.find((h) => h.name === "Date")?.value || "",
            snippet: msg.snippet || "",
            labelIds: msg.labelIds || [],
          };
        } catch { return null; }
      })
    );

    return jsonResponse({
      messages: messages.filter(Boolean),
      resultSizeEstimate: listData.resultSizeEstimate || 0,
      nextPageToken: listData.nextPageToken || null,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleGmailGetMessage(env, messageId, userId, jsonResponse) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  try {
    const res = await fetch(`${GMAIL_API}/messages/${messageId}?format=full`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Gmail API error: ${errText}` }, res.status);
    }
    const msg = await res.json();

    // Extract body
    let body = "";
    let htmlBody = "";
    function extractBody(part) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        body = atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
      } else if (part.mimeType === "text/html" && part.body?.data) {
        htmlBody = atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
      }
      if (part.parts) part.parts.forEach(extractBody);
    }
    if (msg.payload) extractBody(msg.payload);

    const headers = msg.payload?.headers || [];
    return jsonResponse({
      id: msg.id,
      threadId: msg.threadId,
      messageId: headers.find((h) => h.name === "Message-ID" || h.name === "Message-Id")?.value || "",
      subject: headers.find((h) => h.name === "Subject")?.value || "",
      from: headers.find((h) => h.name === "From")?.value || "",
      to: headers.find((h) => h.name === "To")?.value || "",
      cc: headers.find((h) => h.name === "Cc")?.value || "",
      date: headers.find((h) => h.name === "Date")?.value || "",
      body,
      htmlBody,
      snippet: msg.snippet || "",
      labelIds: msg.labelIds || [],
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleGmailGetThread(env, threadId, userId, jsonResponse) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  try {
    const res = await fetch(`${GMAIL_API}/threads/${threadId}?format=full`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Gmail API error: ${errText}` }, res.status);
    }
    const thread = await res.json();

    const messages = (thread.messages || []).map((msg) => {
      let body = "";
      let htmlBody = "";
      function extractBody(part) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          body = atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
        } else if (part.mimeType === "text/html" && part.body?.data) {
          htmlBody = atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
        }
        if (part.parts) part.parts.forEach(extractBody);
      }
      if (msg.payload) extractBody(msg.payload);

      const headers = msg.payload?.headers || [];
      return {
        id: msg.id,
        threadId: msg.threadId,
        messageId: headers.find((h) => h.name === "Message-ID" || h.name === "Message-Id")?.value || "",
        subject: headers.find((h) => h.name === "Subject")?.value || "",
        from: headers.find((h) => h.name === "From")?.value || "",
        to: headers.find((h) => h.name === "To")?.value || "",
        cc: headers.find((h) => h.name === "Cc")?.value || "",
        date: headers.find((h) => h.name === "Date")?.value || "",
        references: headers.find((h) => h.name === "References")?.value || "",
        body,
        htmlBody,
        snippet: msg.snippet || "",
        labelIds: msg.labelIds || [],
      };
    });

    return jsonResponse({ threadId: thread.id, messages });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleGmailUpdateDraft(env, draftId, body, userId, jsonResponse) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  const { to, subject, bodyText, threadId } = body;
  if (!bodyText && !to && !subject) return jsonResponse({ _error: "Nothing to update" }, 400);

  try {
    const lines = [
      to ? `To: ${to}` : "",
      `Subject: ${subject || ""}`,
      `Content-Type: text/plain; charset=utf-8`,
      "",
      bodyText || "",
    ].filter((l, i) => i >= 3 || l);

    const raw = btoa(unescape(encodeURIComponent(lines.join("\r\n"))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const payload = { message: { raw } };
    if (threadId) payload.message.threadId = threadId;

    const res = await fetch(`${GMAIL_API}/drafts/${draftId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: draftId, ...payload }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Draft update failed: ${errText}` }, res.status);
    }
    const result = await res.json();
    return jsonResponse({ ok: true, id: result.id });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleGmailSend(env, body, userId, jsonResponse) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  const { to, subject, bodyText, threadId, inReplyTo, references } = body;
  if (!to || !bodyText) return jsonResponse({ _error: "Missing 'to' or 'bodyText'" }, 400);

  try {
    // Build RFC 2822 message
    const lines = [
      `To: ${to}`,
      `Subject: ${subject || "(no subject)"}`,
      `Content-Type: text/plain; charset=utf-8`,
    ];
    if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
    if (references) lines.push(`References: ${references}`);
    lines.push("", bodyText);

    const raw = btoa(unescape(encodeURIComponent(lines.join("\r\n"))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const payload = { raw };
    if (threadId) payload.threadId = threadId;

    const res = await fetch(`${GMAIL_API}/messages/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Send failed: ${errText}` }, res.status);
    }
    const result = await res.json();
    return jsonResponse({ ok: true, id: result.id, threadId: result.threadId });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleGmailCreateDraft(env, body, userId, jsonResponse) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  const { to, subject, bodyText } = body;
  if (!bodyText) return jsonResponse({ _error: "Missing 'bodyText'" }, 400);

  try {
    const lines = [
      to ? `To: ${to}` : "",
      `Subject: ${subject || ""}`,
      `Content-Type: text/plain; charset=utf-8`,
      "",
      bodyText,
    ].filter(Boolean);

    const raw = btoa(unescape(encodeURIComponent(lines.join("\r\n"))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const res = await fetch(`${GMAIL_API}/drafts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: { raw } }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Draft creation failed: ${errText}` }, res.status);
    }
    const result = await res.json();
    return jsonResponse({ ok: true, id: result.id, messageId: result.message?.id });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleGmailModify(env, messageId, body, userId, jsonResponse) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  const { action, addLabelIds, removeLabelIds } = body;

  // Map friendly actions to label modifications
  let add = addLabelIds || [];
  let remove = removeLabelIds || [];
  if (action === "archive") remove = [...remove, "INBOX"];
  else if (action === "trash") add = [...add, "TRASH"];
  else if (action === "star") add = [...add, "STARRED"];
  else if (action === "unstar") remove = [...remove, "STARRED"];
  else if (action === "mark_read") remove = [...remove, "UNREAD"];
  else if (action === "mark_unread") add = [...add, "UNREAD"];

  try {
    const res = await fetch(`${GMAIL_API}/messages/${messageId}/modify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Modify failed: ${errText}` }, res.status);
    }
    const result = await res.json();
    return jsonResponse({ ok: true, id: result.id, labelIds: result.labelIds });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Calendar API Proxy Handlers ───

const GCAL_API = "https://www.googleapis.com/calendar/v3";

export async function handleCalendarSummary(env, userId, jsonResponse) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  try {
    const now = new Date().toISOString();
    const endOfDay = new Date();
    endOfDay.setDate(endOfDay.getDate() + 2);

    const res = await fetch(
      `${GCAL_API}/calendars/primary/events?timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(endOfDay.toISOString())}&maxResults=5&singleEvents=true&orderBy=startTime`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Calendar API error: ${errText}` }, res.status);
    }
    const data = await res.json();
    const upcoming = (data.items || []).map((e) => ({
      id: e.id,
      summary: e.summary || "(no title)",
      start: e.start?.dateTime || e.start?.date || "",
      end: e.end?.dateTime || e.end?.date || "",
      location: e.location || "",
      status: e.status,
    }));
    return jsonResponse({ upcoming });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleCalendarList(env, userId, jsonResponse) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  try {
    const res = await fetch(`${GCAL_API}/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Calendar list error: ${errText}` }, res.status);
    }
    const data = await res.json();
    const calendars = (data.items || []).map((c) => ({
      id: c.id,
      summary: c.summary || c.id,
      backgroundColor: c.backgroundColor || "#4285f4",
      foregroundColor: c.foregroundColor || "#ffffff",
      primary: !!c.primary,
      selected: c.selected !== false,
      accessRole: c.accessRole || "reader",
    }));
    return jsonResponse({ calendars });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleCalendarListEvents(env, params, userId, jsonResponse) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  try {
    // Step 1: Fetch all calendars
    const calListRes = await fetch(`${GCAL_API}/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    let calendars = [];
    if (calListRes.ok) {
      const calData = await calListRes.json();
      calendars = (calData.items || [])
        .filter((c) => c.selected !== false)
        .map((c) => ({
          id: c.id,
          summary: c.summary || c.id,
          backgroundColor: c.backgroundColor || "#4285f4",
          primary: !!c.primary,
        }));
    }
    // Fallback: if calendar list fails, just use primary
    if (calendars.length === 0) {
      calendars = [{ id: "primary", summary: "Primary", backgroundColor: "#4285f4", primary: true }];
    }

    // Step 2: Fetch events from all calendars in parallel
    const qs = new URLSearchParams();
    if (params.timeMin) qs.set("timeMin", params.timeMin);
    if (params.timeMax) qs.set("timeMax", params.timeMax);
    qs.set("maxResults", params.maxResults || "50");
    qs.set("singleEvents", "true");
    qs.set("orderBy", "startTime");

    const eventPromises = calendars.map(async (cal) => {
      try {
        const res = await fetch(`${GCAL_API}/calendars/${encodeURIComponent(cal.id)}/events?${qs}`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.items || []).map((e) => ({
          id: e.id,
          summary: e.summary || "",
          description: e.description || "",
          start: e.start || {},
          end: e.end || {},
          location: e.location || "",
          status: e.status,
          attendees: (e.attendees || []).map((a) => ({ email: a.email, responseStatus: a.responseStatus })),
          htmlLink: e.htmlLink || "",
          calendarId: cal.id,
          calendarColor: cal.backgroundColor,
          calendarName: cal.summary,
        }));
      } catch {
        return [];
      }
    });

    const results = await Promise.all(eventPromises);
    const allEvents = results.flat();

    // Step 3: Sort by start time
    allEvents.sort((a, b) => {
      const aTime = a.start?.dateTime || a.start?.date || "";
      const bTime = b.start?.dateTime || b.start?.date || "";
      return aTime.localeCompare(bTime);
    });

    return jsonResponse({ events: allEvents, calendars });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleCalendarCreateEvent(env, body, userId, jsonResponse) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  const { summary, description, start, end, location, attendees } = body;
  if (!summary || !start || !end) return jsonResponse({ _error: "Missing summary, start, or end" }, 400);

  try {
    const event = {
      summary,
      description: description || "",
      location: location || "",
      start: start.includes("T") ? { dateTime: start } : { date: start },
      end: end.includes("T") ? { dateTime: end } : { date: end },
    };
    if (attendees?.length) {
      event.attendees = attendees.map((email) => (typeof email === "string" ? { email } : email));
    }

    const res = await fetch(`${GCAL_API}/calendars/primary/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Create event failed: ${errText}` }, res.status);
    }
    const result = await res.json();
    return jsonResponse({
      ok: true,
      id: result.id,
      summary: result.summary,
      start: result.start?.dateTime || result.start?.date,
      htmlLink: result.htmlLink,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleCalendarUpdateEvent(env, eventId, body, userId, jsonResponse) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  try {
    const update = {};
    if (body.summary !== undefined) update.summary = body.summary;
    if (body.description !== undefined) update.description = body.description;
    if (body.location !== undefined) update.location = body.location;
    if (body.start) update.start = body.start.includes("T") ? { dateTime: body.start } : { date: body.start };
    if (body.end) update.end = body.end.includes("T") ? { dateTime: body.end } : { date: body.end };
    if (body.attendees) update.attendees = body.attendees.map((e) => (typeof e === "string" ? { email: e } : e));

    const res = await fetch(`${GCAL_API}/calendars/primary/events/${eventId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(update),
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `Update event failed: ${errText}` }, res.status);
    }
    const result = await res.json();
    return jsonResponse({ ok: true, id: result.id, summary: result.summary });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleCalendarDeleteEvent(env, eventId, userId, jsonResponse) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  try {
    const res = await fetch(`${GCAL_API}/calendars/primary/events/${eventId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!res.ok && res.status !== 204) {
      const errText = await res.text();
      return jsonResponse({ _error: `Delete event failed: ${errText}` }, res.status);
    }
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleCalendarFreeBusy(env, body, userId, jsonResponse) {
  const tokens = await getGoogleAccessTokenForUser(env, userId);
  if (!tokens) return jsonResponse({ _error: "Google not connected" }, 401);

  const { timeMin, timeMax } = body;
  if (!timeMin || !timeMax) return jsonResponse({ _error: "Missing timeMin or timeMax" }, 400);

  try {
    const res = await fetch(`${GCAL_API}/freeBusy`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin,
        timeMax,
        items: [{ id: "primary" }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({ _error: `FreeBusy query failed: ${errText}` }, res.status);
    }
    const data = await res.json();
    const busy = data.calendars?.primary?.busy || [];
    return jsonResponse({ busy });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}
