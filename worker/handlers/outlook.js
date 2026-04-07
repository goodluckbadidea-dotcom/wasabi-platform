// ─── Microsoft Outlook & Calendar Handlers (Graph API) ───
import { getMicrosoftAccessToken } from './microsoft.js';

const GRAPH = "https://graph.microsoft.com/v1.0/me";

async function graphFetch(url, options, userId, env) {
  const tokens = await getMicrosoftAccessToken(userId, env);
  if (!tokens) return { error: "Microsoft not connected", status: 401 };
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { value: text }; }
  return { data, status: res.status, ok: res.ok };
}

// ─── Mail ───

export async function handleOutlookSummary(env, userId, jsonResponse) {
  if (!userId) return jsonResponse({ _error: "Not authenticated" }, 401);
  const tokens = await getMicrosoftAccessToken(userId, env);
  if (!tokens) return jsonResponse({ _error: "Microsoft not connected" }, 401);

  try {
    // Unread count from inbox
    const unreadRes = await fetch(
      `${GRAPH}/mailFolders/inbox/messages?$filter=isRead eq false&$count=true&$top=1&$select=id`,
      { headers: { Authorization: `Bearer ${tokens.access_token}`, ConsistencyLevel: "eventual" } }
    );
    const unreadData = await unreadRes.json();
    const unread = unreadData["@odata.count"] ?? 0;

    // Recent inbox messages (metadata only)
    const recentRes = await fetch(
      `${GRAPH}/mailFolders/inbox/messages?$top=5&$select=id,subject,from,receivedDateTime,bodyPreview,isRead,conversationId`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    const recentData = await recentRes.json();
    const recent = (recentData.value || []).map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      subject: m.subject || "(no subject)",
      from: m.from?.emailAddress?.address || "",
      fromName: m.from?.emailAddress?.name || "",
      date: m.receivedDateTime,
      snippet: m.bodyPreview || "",
      isRead: m.isRead,
    }));

    return jsonResponse({ unread, recent });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleOutlookSearch(env, body, userId, jsonResponse) {
  if (!userId) return jsonResponse({ _error: "Not authenticated" }, 401);
  const tokens = await getMicrosoftAccessToken(userId, env);
  if (!tokens) return jsonResponse({ _error: "Microsoft not connected" }, 401);

  const { q, maxResults = 20, folder = "inbox" } = body;
  try {
    let url = `${GRAPH}/mailFolders/${folder}/messages?$top=${maxResults}&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,conversationId`;
    // $search requires ConsistencyLevel header; omit when no query
    const headers = { Authorization: `Bearer ${tokens.access_token}` };
    if (q) {
      url += `&$search="${encodeURIComponent(q)}"`;
      headers["ConsistencyLevel"] = "eventual";
    }

    const res = await fetch(url, { headers });
    const data = await res.json();

    if (!res.ok) {
      return jsonResponse({ _error: data?.error?.message || `Graph error ${res.status}` }, res.status);
    }

    const messages = (data.value || []).map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      subject: m.subject || "(no subject)",
      from: m.from?.emailAddress?.address || "",
      fromName: m.from?.emailAddress?.name || "",
      to: (m.toRecipients || []).map((r) => r.emailAddress?.address).join(", "),
      date: m.receivedDateTime,
      snippet: m.bodyPreview || "",
      isRead: m.isRead,
    }));

    return jsonResponse({
      messages,
      nextLink: data["@odata.nextLink"] || null,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleOutlookGetMessage(env, messageId, userId, jsonResponse) {
  if (!userId) return jsonResponse({ _error: "Not authenticated" }, 401);
  const tokens = await getMicrosoftAccessToken(userId, env);
  if (!tokens) return jsonResponse({ _error: "Microsoft not connected" }, 401);

  try {
    const res = await fetch(
      `${GRAPH}/messages/${encodeURIComponent(messageId)}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview,isRead,conversationId`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return jsonResponse({ _error: err.error?.message || `Graph error ${res.status}` }, res.status);
    }
    const m = await res.json();
    return jsonResponse({
      id: m.id,
      conversationId: m.conversationId,
      subject: m.subject || "(no subject)",
      from: m.from?.emailAddress?.address || "",
      fromName: m.from?.emailAddress?.name || "",
      to: (m.toRecipients || []).map((r) => r.emailAddress?.address).join(", "),
      cc: (m.ccRecipients || []).map((r) => r.emailAddress?.address).join(", "),
      date: m.receivedDateTime,
      body: m.body?.contentType === "text" ? m.body.content : "",
      htmlBody: m.body?.contentType === "html" ? m.body.content : "",
      snippet: m.bodyPreview || "",
      isRead: m.isRead,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleOutlookGetThread(env, conversationId, userId, jsonResponse) {
  if (!userId) return jsonResponse({ _error: "Not authenticated" }, 401);
  const tokens = await getMicrosoftAccessToken(userId, env);
  if (!tokens) return jsonResponse({ _error: "Microsoft not connected" }, 401);

  try {
    const res = await fetch(
      `${GRAPH}/messages?$filter=conversationId eq '${encodeURIComponent(conversationId)}'&$orderby=receivedDateTime asc&$select=id,subject,from,toRecipients,receivedDateTime,body,bodyPreview,isRead`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return jsonResponse({ _error: err.error?.message || `Graph error ${res.status}` }, res.status);
    }
    const data = await res.json();
    const messages = (data.value || []).map((m) => ({
      id: m.id,
      subject: m.subject || "(no subject)",
      from: m.from?.emailAddress?.address || "",
      fromName: m.from?.emailAddress?.name || "",
      to: (m.toRecipients || []).map((r) => r.emailAddress?.address).join(", "),
      date: m.receivedDateTime,
      body: m.body?.contentType === "text" ? m.body.content : "",
      htmlBody: m.body?.contentType === "html" ? m.body.content : "",
      snippet: m.bodyPreview || "",
      isRead: m.isRead,
    }));
    return jsonResponse({ messages, conversationId });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleOutlookSend(env, body, userId, jsonResponse) {
  if (!userId) return jsonResponse({ _error: "Not authenticated" }, 401);
  const tokens = await getMicrosoftAccessToken(userId, env);
  if (!tokens) return jsonResponse({ _error: "Microsoft not connected" }, 401);

  const { to, subject, bodyText, bodyHtml, replyToId } = body;
  if (!to || !subject) return jsonResponse({ _error: "to and subject required" }, 400);

  try {
    const message = {
      subject,
      body: {
        contentType: bodyHtml ? "html" : "text",
        content: bodyHtml || bodyText || "",
      },
      toRecipients: [{ emailAddress: { address: to } }],
    };

    let url = `${GRAPH}/sendMail`;
    let payload = { message, saveToSentItems: true };

    // If replying to an existing message
    if (replyToId) {
      url = `${GRAPH}/messages/${encodeURIComponent(replyToId)}/reply`;
      payload = { message };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok && res.status !== 202) {
      const err = await res.json().catch(() => ({}));
      return jsonResponse({ _error: err.error?.message || `Send failed: ${res.status}` }, res.status);
    }
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleOutlookModify(env, messageId, body, userId, jsonResponse) {
  if (!userId) return jsonResponse({ _error: "Not authenticated" }, 401);
  const tokens = await getMicrosoftAccessToken(userId, env);
  if (!tokens) return jsonResponse({ _error: "Microsoft not connected" }, 401);

  const { action } = body;
  try {
    let patch = {};
    if (action === "read") patch = { isRead: true };
    else if (action === "unread") patch = { isRead: false };
    else return jsonResponse({ _error: `Unknown action: ${action}` }, 400);

    const res = await fetch(`${GRAPH}/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return jsonResponse({ _error: err.error?.message || `Modify failed: ${res.status}` }, res.status);
    }
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Calendar ───

export async function handleOutlookCalendarSummary(env, userId, jsonResponse) {
  if (!userId) return jsonResponse({ _error: "Not authenticated" }, 401);
  const tokens = await getMicrosoftAccessToken(userId, env);
  if (!tokens) return jsonResponse({ _error: "Microsoft not connected" }, 401);

  try {
    const now = new Date().toISOString();
    const weekOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const res = await fetch(
      `${GRAPH}/calendarView?startDateTime=${now}&endDateTime=${weekOut}&$top=10&$select=id,subject,start,end,location,isAllDay,organizer,attendees,bodyPreview&$orderby=start/dateTime`,
      { headers: { Authorization: `Bearer ${tokens.access_token}`, Prefer: 'outlook.timezone="UTC"' } }
    );
    const data = await res.json();
    const events = (data.value || []).map(mapEvent);
    return jsonResponse({ events });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleOutlookListEvents(env, query, userId, jsonResponse) {
  if (!userId) return jsonResponse({ _error: "Not authenticated" }, 401);
  const tokens = await getMicrosoftAccessToken(userId, env);
  if (!tokens) return jsonResponse({ _error: "Microsoft not connected" }, 401);

  const { timeMin, timeMax, maxResults = 50 } = query;
  try {
    const start = timeMin || new Date().toISOString();
    const end = timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const res = await fetch(
      `${GRAPH}/calendarView?startDateTime=${start}&endDateTime=${end}&$top=${maxResults}&$select=id,subject,start,end,location,isAllDay,organizer,attendees,bodyPreview&$orderby=start/dateTime`,
      { headers: { Authorization: `Bearer ${tokens.access_token}`, Prefer: 'outlook.timezone="UTC"' } }
    );
    const data = await res.json();
    return jsonResponse({ events: (data.value || []).map(mapEvent), nextLink: data["@odata.nextLink"] || null });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleOutlookCreateEvent(env, body, userId, jsonResponse) {
  if (!userId) return jsonResponse({ _error: "Not authenticated" }, 401);
  const tokens = await getMicrosoftAccessToken(userId, env);
  if (!tokens) return jsonResponse({ _error: "Microsoft not connected" }, 401);

  const { summary, start, end, description, location, attendees, isAllDay } = body;
  if (!summary || !start || !end) return jsonResponse({ _error: "summary, start, end required" }, 400);

  try {
    const event = {
      subject: summary,
      start: { dateTime: start, timeZone: "UTC" },
      end: { dateTime: end, timeZone: "UTC" },
      isAllDay: isAllDay || false,
      ...(description ? { body: { contentType: "text", content: description } } : {}),
      ...(location ? { location: { displayName: location } } : {}),
      ...(attendees?.length ? {
        attendees: attendees.map((email) => ({ emailAddress: { address: email }, type: "required" })),
      } : {}),
    };

    const res = await fetch(`${GRAPH}/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return jsonResponse({ _error: err.error?.message || `Create failed: ${res.status}` }, res.status);
    }
    const created = await res.json();
    return jsonResponse({ ok: true, event: mapEvent(created) });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleOutlookUpdateEvent(env, eventId, body, userId, jsonResponse) {
  if (!userId) return jsonResponse({ _error: "Not authenticated" }, 401);
  const tokens = await getMicrosoftAccessToken(userId, env);
  if (!tokens) return jsonResponse({ _error: "Microsoft not connected" }, 401);

  try {
    const patch = {};
    if (body.summary) patch.subject = body.summary;
    if (body.start) patch.start = { dateTime: body.start, timeZone: "UTC" };
    if (body.end) patch.end = { dateTime: body.end, timeZone: "UTC" };
    if (body.description !== undefined) patch.body = { contentType: "text", content: body.description };
    if (body.location !== undefined) patch.location = { displayName: body.location };

    const res = await fetch(`${GRAPH}/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return jsonResponse({ _error: err.error?.message || `Update failed: ${res.status}` }, res.status);
    }
    const updated = await res.json();
    return jsonResponse({ ok: true, event: mapEvent(updated) });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleOutlookDeleteEvent(env, eventId, userId, jsonResponse) {
  if (!userId) return jsonResponse({ _error: "Not authenticated" }, 401);
  const tokens = await getMicrosoftAccessToken(userId, env);
  if (!tokens) return jsonResponse({ _error: "Microsoft not connected" }, 401);

  try {
    const res = await fetch(`${GRAPH}/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!res.ok && res.status !== 204) {
      const err = await res.json().catch(() => ({}));
      return jsonResponse({ _error: err.error?.message || `Delete failed: ${res.status}` }, res.status);
    }
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

function ensureUtcSuffix(dt) {
  if (!dt || typeof dt !== "string") return dt;
  // Microsoft Graph returns datetimes without Z even when requested in UTC.
  // Without the suffix, new Date() treats them as local time, causing offset bugs.
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(dt)) return dt + "Z";
  return dt;
}

function mapEvent(e) {
  return {
    id: e.id,
    summary: e.subject || "",
    start: ensureUtcSuffix(e.start?.dateTime) || e.start?.date || "",
    end: ensureUtcSuffix(e.end?.dateTime) || e.end?.date || "",
    location: e.location?.displayName || "",
    isAllDay: e.isAllDay || false,
    organizer: e.organizer?.emailAddress?.address || "",
    attendees: (e.attendees || []).map((a) => a.emailAddress?.address).filter(Boolean),
    description: e.bodyPreview || "",
  };
}
