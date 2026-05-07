# 17 — Microsoft 365 Integration Plan

**Status:** Phases 0–4 Complete (2026-04-07). Phase 5 (polish) pending.
**Prerequisites:** Worker refactoring (break worker.js into modules) — COMPLETE 2026-04-06
**Created:** 2026-03-31

---

## Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 | Worker refactoring — 9,430→1,880 lines, handlers extracted to `worker/` ES modules | ✅ Complete 2026-04-06 |
| Phase 1 | D1 credential encryption (AES-256-GCM) + Microsoft OAuth + ConnectionsTab row | ✅ Complete 2026-04-07 |
| Phase 2 | Outlook Mail: worker handlers + OutlookView.jsx + Navigation badge | ✅ Complete 2026-04-07 |
| Phase 3 | Outlook Calendar: worker handlers, CalendarView parallel fetch + normalization | ✅ Complete 2026-04-07 |
| Phase 4 | Frontend wiring: LoginScreen SSO button, AuthContext loginWithToken | ✅ Complete 2026-04-07 |
| Phase 5 | Polish: provider badges, default provider preference, agent tool routing | ⏳ Pending |

### What Was Actually Built (vs. Plan)

- **Separate OutlookView** instead of unified EmailView — Outlook inbox is its own sidebar page (`activeRightPane === "outlook"`), parallel to GmailView rather than merged. A unified view is the Phase 5 goal.
- **CalendarView merged** — Outlook Calendar events DO appear in the same CalendarView as Google. Events are normalized to Google's `{ start: { dateTime } }` shape before merge.
- **Login SSO flow** — "Sign in with Microsoft" button on LoginScreen. Uses `microsoft-oauth-login` postMessage. Wasabi user matched or created by email.
- **Link flow** — Separate `mode=link` popup flow in ConnectionsTab for users who already have a password account.
- **Encryption (Phase 1 renamed)** — AES-256-GCM encryption of all D1 credentials added before Microsoft work. Key: HKDF from `WASABI_SECRET`, format `enc:v1:{iv}:{ct}`.

### Actual Routes (vs. Plan)

The callback route is `/auth/microsoft/callback` (not `/microsoft/callback` as originally planned), because it's exempt from JWT auth and lives alongside `/auth/login`, `/auth/register`.

### Known Remaining Issues (Phase 5)

- No provider badge on emails/events to distinguish Outlook vs. Google source
- No default provider preference setting
- No agent tool routing for Microsoft (toolExecutor.js still uses Google-only tools for email/calendar)
- No `providerContext.js` — googleContext.js still only injects Google context into AI system prompt
- Free/busy endpoint not yet implemented
- Draft create/update endpoints not yet implemented
- Archive/trash/star mail actions not yet implemented (only read/unread mark supported)

---

## Goal

Add Microsoft 365 (Outlook Mail + Outlook Calendar) as a first-class integration alongside the existing Google integration. Users can connect one or both providers. Email and Calendar views become provider-agnostic unified surfaces.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| UI approach | Unified views (not separate Outlook views) | Wasabi is a one-stop workspace; users shouldn't care which provider powers their inbox |
| Feature scope | Full parity with Google integration | Same capabilities: inbox, search, read, send, reply, draft, archive/trash/star, calendar CRUD, free/busy |
| Multi-provider | Simultaneous connections supported | Team is on M365 but Google stays available; per-user choice |
| OAuth | Microsoft identity platform (Azure AD) | Standard OAuth 2.0 with PKCE, same pattern as Google |
| API | Microsoft Graph v1.0 | Single unified API for mail + calendar + user info |
| Agent tools | Parallel tool set using same names | Agent tools abstract over provider; no `outlook_` prefix |

---

## Azure AD App Registration (Setup Steps)

Before any code, Graham needs to register an app in Azure:

1. Go to [Azure Portal](https://portal.azure.com) > Azure Active Directory > App registrations > New registration
2. Name: "Wasabi Platform"
3. Supported account types: "Accounts in any organizational directory and personal Microsoft accounts"
4. Redirect URI: `https://wasabi-worker.{account}.workers.dev/microsoft/callback` (Web type)
5. After creation, note the **Application (client) ID**
6. Certificates & secrets > New client secret > note the **secret value**
7. API permissions > Add:
   - `Mail.ReadWrite` — read/write mail
   - `Mail.Send` — send mail
   - `Calendars.ReadWrite` — read/write calendar events
   - `User.Read` — read user profile/email
   - `offline_access` — get refresh tokens
8. Store as Cloudflare Worker secrets:
   ```bash
   npx wrangler secret put MICROSOFT_CLIENT_ID -c wrangler-worker.toml
   npx wrangler secret put MICROSOFT_CLIENT_SECRET -c wrangler-worker.toml
   ```

---

## OAuth Flow

Mirrors the Google OAuth flow exactly:

```
1. User clicks "Connect with Microsoft" in Settings > Connections
2. Frontend calls GET /microsoft/auth-url
3. Worker builds authorization URL:
   - endpoint: https://login.microsoftonline.com/common/oauth2/v2.0/authorize
   - client_id, redirect_uri, response_type=code, scope, state={workerUrl, userId}
4. Frontend opens popup (500x700) to Microsoft consent screen
5. User approves → Microsoft redirects to /microsoft/callback with code
6. Worker exchanges code for tokens at:
   - https://login.microsoftonline.com/common/oauth2/v2.0/token
7. Worker fetches user email from https://graph.microsoft.com/v1.0/me
8. Tokens stored in user_connections (key='microsoft'):
   { access_token, refresh_token, expires_at, email, scopes }
9. Popup returns HTML with postMessage to opener
```

**Token refresh:** Same pattern — check `expires_at` with 60s buffer, POST to token endpoint with `grant_type=refresh_token`.

---

## Microsoft Graph API Mapping

### Mail (replaces Gmail API)

| Feature | Google (current) | Microsoft Graph |
|---------|-----------------|-----------------|
| List inbox | `GET gmail/v1/messages?q=...` | `GET /me/messages?$filter=...&$orderby=receivedDateTime desc` |
| Search | Gmail query syntax (`from:x subject:y`) | `$search="from:x subject:y"` or `$filter` OData |
| Get message | `GET gmail/v1/messages/{id}` | `GET /me/messages/{id}` |
| Get thread | `GET gmail/v1/threads/{id}` | `GET /me/messages/{id}?$expand=...` (conversations via `conversationId`) |
| Send email | `POST gmail/v1/messages/send` (base64 MIME) | `POST /me/sendMail` (JSON body — much simpler) |
| Reply | Same endpoint with `threadId` | `POST /me/messages/{id}/reply` |
| Create draft | `POST gmail/v1/drafts` | `POST /me/messages` (isDraft=true) |
| Update draft | `PUT gmail/v1/drafts/{id}` | `PATCH /me/messages/{id}` |
| Archive | Remove INBOX label | `POST /me/messages/{id}/move` (to Archive folder) |
| Trash | Add TRASH label | `DELETE /me/messages/{id}` or move to Deleted Items |
| Star | Add STARRED label | `PATCH /me/messages/{id}` set `flag.flagStatus=flagged` |
| Mark read/unread | Modify UNREAD label | `PATCH /me/messages/{id}` set `isRead=true/false` |
| Unread count | `GET gmail/v1/labels/INBOX` | `GET /me/mailFolders/inbox?$select=unreadItemCount` |

### Calendar (replaces Google Calendar API)

| Feature | Google (current) | Microsoft Graph |
|---------|-----------------|-----------------|
| List calendars | `GET calendar/v3/users/me/calendarList` | `GET /me/calendars` |
| List events | `GET calendar/v3/calendars/{id}/events` | `GET /me/calendarView?startDateTime=...&endDateTime=...` |
| Create event | `POST calendar/v3/calendars/primary/events` | `POST /me/events` |
| Update event | `PATCH calendar/v3/calendars/primary/events/{id}` | `PATCH /me/events/{id}` |
| Delete event | `DELETE calendar/v3/calendars/primary/events/{id}` | `DELETE /me/events/{id}` |
| Free/busy | `POST calendar/v3/freeBusy` | `POST /me/calendar/getSchedule` |

### Key Format Differences

**Email body:** Gmail uses base64-encoded MIME; MS Graph uses JSON `{ body: { contentType: "HTML", content: "..." } }`. MS Graph is simpler.

**Dates:** Google Calendar uses `{ dateTime: "2026-04-01T09:00:00-04:00", timeZone: "America/New_York" }`. MS Graph uses `{ dateTime: "2026-04-01T09:00:00", timeZone: "Eastern Standard Time" }` (IANA timezone names differ).

**Threads:** Gmail has first-class thread IDs. Outlook uses `conversationId` to group messages in a conversation — query with `$filter=conversationId eq '{id}'`.

---

## Worker Routes (New)

All behind JWT auth, same pattern as Google:

### Auth
| Route | Method | Purpose |
|-------|--------|---------|
| `/microsoft/auth-url` | GET | Generate OAuth consent URL |
| `/microsoft/callback` | GET | Handle OAuth callback (popup) |
| `/microsoft/status` | GET | Connection status + email |
| `/microsoft/disconnect` | POST | Revoke tokens + delete from DB |

### Mail
| Route | Method | Purpose |
|-------|--------|---------|
| `/microsoft/mail/summary` | GET | Unread count + recent messages |
| `/microsoft/mail/messages` | POST | Search/list messages |
| `/microsoft/mail/messages/:id` | GET | Get full message |
| `/microsoft/mail/threads/:id` | GET | Get conversation thread |
| `/microsoft/mail/send` | POST | Send email |
| `/microsoft/mail/reply` | POST | Reply to message |
| `/microsoft/mail/drafts` | POST | Create draft |
| `/microsoft/mail/drafts/:id` | PATCH | Update draft |
| `/microsoft/mail/modify/:id` | POST | Archive/trash/star/read |

### Calendar
| Route | Method | Purpose |
|-------|--------|---------|
| `/microsoft/calendar/list` | GET | List all calendars |
| `/microsoft/calendar/summary` | GET | Today + next 2 days events |
| `/microsoft/calendar/events` | GET | Events for date range |
| `/microsoft/calendar/events` | POST | Create event |
| `/microsoft/calendar/events/:id` | PATCH | Update event |
| `/microsoft/calendar/events/:id` | DELETE | Delete event |
| `/microsoft/calendar/freebusy` | POST | Check availability |

---

## Unified View Architecture

### Current State
```
GmailView.jsx       → Google-specific email UI
CalendarView.jsx    → Google Calendar + D1 tasks
```

### Target State
```
EmailView.jsx       → Provider-agnostic email UI
  ├── Uses connectedProviders state to determine data source(s)
  ├── Calls provider-neutral api.js functions
  └── Merges results from multiple providers if both connected

CalendarView.jsx    → Provider-agnostic calendar UI (already partially there)
  ├── Fetches from Google AND/OR Microsoft
  ├── Color-codes by provider + calendar
  └── Creates events on user's chosen default provider
```

### Provider Abstraction (api.js)

The api.js layer becomes the abstraction point. Each email/calendar function checks which provider(s) are connected and routes accordingly:

```javascript
// Example: searchEmails becomes provider-aware
export async function searchEmails(query, maxResults, options = {}) {
  const provider = options.provider || getDefaultEmailProvider();
  if (provider === 'google') {
    return apiFetch("/google/gmail/messages", { method: "POST", body: { q: query, maxResults } });
  }
  if (provider === 'microsoft') {
    return apiFetch("/microsoft/mail/messages", { method: "POST", body: { q: query, maxResults } });
  }
}

// Example: listCalendarEvents merges from all connected providers
export async function listCalendarEvents(timeMin, timeMax, options = {}) {
  const providers = options.providers || getConnectedCalendarProviders();
  const results = await Promise.all(
    providers.map(p => apiFetch(`/${p === 'google' ? 'google' : 'microsoft'}/calendar/events`, ...))
  );
  return mergeAndSortEvents(results); // normalize format, sort by start time
}
```

### Response Normalization

Both providers' responses need to be normalized into a common shape before reaching the UI:

```typescript
// Normalized email
interface WasabiEmail {
  id: string;
  provider: 'google' | 'microsoft';
  threadId: string;       // Gmail threadId or Outlook conversationId
  subject: string;
  from: { name: string, email: string };
  to: { name: string, email: string }[];
  date: string;           // ISO 8601
  snippet: string;
  body: string;           // HTML
  isRead: boolean;
  isStarred: boolean;
  labels: string[];       // normalized: 'inbox', 'sent', 'draft', 'starred', 'trash'
}

// Normalized calendar event
interface WasabiCalendarEvent {
  id: string;
  provider: 'google' | 'microsoft';
  calendarId: string;
  summary: string;
  description: string;
  location: string;
  start: string;          // ISO 8601
  end: string;            // ISO 8601
  allDay: boolean;
  attendees: { name: string, email: string, status: string }[];
  color: string;          // from calendar color
}
```

---

## Agent Tool Integration

The existing email/calendar tools (`search_emails`, `send_email`, `list_calendar_events`, etc.) stay the same from Claude's perspective. The `toolExecutor.js` implementation adds provider routing:

- If user has one provider connected: use that provider
- If user has both: use the provider relevant to the context (e.g., replying to an Outlook email uses Microsoft; if ambiguous, use the default)
- Agent can specify `provider` parameter to force a specific one

---

## Connection UI

`ConnectionsTab.jsx` gets a new `MicrosoftConnectionRow` alongside `GoogleConnectionRow`:

- "Connect with Microsoft" button → same popup OAuth flow
- Shows connected email address
- Disconnect button
- Status indicator (green dot = connected)

Both rows visible simultaneously. User can connect both.

---

## Context Injection for Agent

`googleContext.js` becomes `providerContext.js` (or similar):

- Fetches email summary from ALL connected providers
- Fetches calendar summary from ALL connected providers
- Merges into single context string for agent system prompt
- Cache key includes provider list to invalidate on connect/disconnect

---

## Implementation Phases

### Phase 0: Worker Refactoring (prerequisite)
Break worker.js into modules. Design module boundaries to accommodate Microsoft routes cleanly.

### Phase 1: Microsoft OAuth + Connection
- Azure AD app registration (manual, Graham)
- Worker: `/microsoft/auth-url`, `/callback`, `/status`, `/disconnect`
- Worker: token storage + refresh in user_connections
- Frontend: `MicrosoftConnectionRow` in ConnectionsTab
- Worker secrets: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`
- **Verification:** Can connect/disconnect Microsoft account from Settings

### Phase 2: Outlook Mail
- Worker: all `/microsoft/mail/*` proxy routes
- Frontend: response normalizer (MS Graph → WasabiEmail)
- api.js: provider-aware email functions
- Refactor GmailView → EmailView with provider abstraction
- **Verification:** Can read, search, send, reply, draft, archive/star Outlook emails

### Phase 3: Outlook Calendar
- Worker: all `/microsoft/calendar/*` proxy routes
- Frontend: response normalizer (MS Graph → WasabiCalendarEvent)
- api.js: provider-aware calendar functions
- Update CalendarView to merge events from both providers
- **Verification:** Can view, create, update, delete Outlook calendar events

### Phase 4: Agent Tools + Context
- Update toolExecutor.js email/calendar tool implementations for provider routing
- Refactor googleContext.js → providerContext.js for multi-provider context
- Test agent can search/send/create across both providers
- **Verification:** Agent can interact with Outlook mail and calendar via chat

### Phase 5: Polish
- Error states for disconnected providers
- Provider badges on emails/events (subtle icon showing source)
- Default provider preference in Settings
- Edge cases: both providers returning same calendar event (dedup by attendee match?)

---

## Estimated Scope

| Area | Files | Approx Lines |
|------|-------|-------------|
| Worker: OAuth + token refresh | 1 module | ~200 |
| Worker: Mail proxy routes | 1 module | ~500 |
| Worker: Calendar proxy routes | 1 module | ~350 |
| api.js: provider-aware wrappers | 1 file (extend) | ~200 |
| Response normalizers | 1-2 new files | ~200 |
| EmailView (refactored from GmailView) | 1 file (rewrite) | ~400 |
| CalendarView updates | 1 file (modify) | ~100 |
| MicrosoftConnectionRow | 1 new file | ~80 |
| ConnectionsTab updates | 1 file (modify) | ~30 |
| Agent tool updates | 2 files (modify) | ~100 |
| providerContext.js | 1 file (rewrite) | ~80 |
| **Total** | ~12 files | ~2,200 lines |

---

## Risk Areas

1. **Microsoft token scopes** — Azure AD is stricter about scope consent. Admin consent may be required for org-wide access. Test with a personal Microsoft account first.
2. **Outlook threading** — Outlook's `conversationId` is less reliable than Gmail's `threadId`. Some edge cases with forwarded messages creating new conversations.
3. **Rate limiting** — MS Graph has per-app and per-user throttling. May need retry logic with `Retry-After` header handling.
4. **Timezone handling** — MS Graph uses Windows timezone names ("Eastern Standard Time") not IANA ("America/New_York"). Need a mapping table.
5. **Unified view complexity** — Merging two providers' data in the UI while keeping actions provider-aware is the hardest part. Each email/event needs to carry its `provider` tag so actions route correctly.
