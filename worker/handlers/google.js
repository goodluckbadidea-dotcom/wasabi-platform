// ─── Google OAuth & API Handlers (Gmail + Calendar) ───
import { encryptSecret, decryptSecret } from '../crypto.js';

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

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

  const workerUrl = new URL(request.url).origin;
  const redirectUri = `${workerUrl}/google/callback`;

  // Encode user ID in state so the callback can store tokens per-user
  const stateObj = { workerUrl, userId: userId || null };
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
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

    // Store tokens in D1
    const tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + (tokenData.expires_in || 3600) * 1000,
      email,
      scopes: GOOGLE_SCOPES,
    };

    // Extract user ID from OAuth state for per-user storage
    let stateUserId = null;
    const stateParam = url.searchParams.get("state");
    try {
      const stateObj = JSON.parse(stateParam);
      stateUserId = stateObj.userId || null;
    } catch { /* state may be plain URL from old flow */ }

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

export async function handleGoogleStatus(env, userId, jsonResponse) {
  try {
    // Per-user: only show their own connection
    if (userId) {
      const userRow = await env.DB.prepare(
        "SELECT value FROM user_connections WHERE user_id = ? AND key = 'google'"
      ).bind(userId).first();
      if (!userRow?.value) return jsonResponse({ connected: false });
      const tokens = JSON.parse(await decryptSecret(userRow.value, env));
      return jsonResponse({ connected: true, email: tokens.email || "", scopes: tokens.scopes || "" });
    }
    // No userId (MCP/API key access) — check global
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'google'").first();
    if (!row?.value) return jsonResponse({ connected: false });
    const tokens = JSON.parse(await decryptSecret(row.value, env));
    return jsonResponse({ connected: true, email: tokens.email || "", scopes: tokens.scopes || "" });
  } catch (err) {
    return jsonResponse({ connected: false, error: err.message });
  }
}

export async function handleGoogleDisconnect(env, userId, jsonResponse) {
  try {
    // Per-user: only disconnect their own token
    if (userId) {
      const userRow = await env.DB.prepare(
        "SELECT value FROM user_connections WHERE user_id = ? AND key = 'google'"
      ).bind(userId).first();
      if (userRow?.value) {
        const tokens = JSON.parse(await decryptSecret(userRow.value, env));
        if (tokens.access_token) {
          await fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.access_token}`, { method: "POST" }).catch(() => {});
        }
        await env.DB.prepare("DELETE FROM user_connections WHERE user_id = ? AND key = 'google'").bind(userId).run();
      }
      // Always return ok — user is now disconnected (even if they had no token)
      return jsonResponse({ ok: true });
    }
    // No userId (MCP/API key access) — disconnect global
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'google'").first();
    if (row?.value) {
      const tokens = JSON.parse(await decryptSecret(row.value, env));
      if (tokens.access_token) {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.access_token}`, { method: "POST" }).catch(() => {});
      }
    }
    await env.DB.prepare("DELETE FROM connections WHERE key = 'google'").run();
    return jsonResponse({ ok: true });
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
