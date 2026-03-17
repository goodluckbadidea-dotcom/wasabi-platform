# 03 — Integrations

## API Layer (`src/lib/api.js`)

All backend calls go through `apiFetch()` which:
- Reads worker URL + secret from `localStorage` key `wasabi_connection`
- Adds `X-Wasabi-Key` auth header
- Auto-parses JSON responses
- Throws structured errors with `status` and `data`

Connection management:
- `getConnection()` — reads saved worker URL + secret
- `saveConnection(workerUrl, secret)` — persists connection
- `clearConnection()` — removes connection

---

## Google Integration

### OAuth Flow

| Function | Endpoint | Purpose |
|----------|----------|---------|
| `getGoogleAuthUrl()` | `GET /google/auth-url` | Get OAuth consent URL |
| `getGoogleStatus()` | `GET /google/status` | Check if Google is connected |
| `disconnectGoogle()` | `POST /google/disconnect` | Revoke Google connection |

OAuth is handled server-side by the Cloudflare Worker. The frontend redirects to the auth URL, and the worker handles the callback + token storage.

### Gmail API

| Function | Endpoint | Purpose |
|----------|----------|---------|
| `getGmailSummary()` | `GET /google/gmail/summary` | Unread count + latest messages |
| `searchEmails(query, maxResults, labelIds)` | `GET /google/gmail/search` | Search inbox |
| `getEmail(messageId)` | `GET /google/gmail/message/{id}` | Get full message |
| `sendEmail({to, subject, bodyText, threadId, inReplyTo, references})` | `POST /google/gmail/send` | Send/reply |
| `createDraft({to, subject, bodyText})` | `POST /google/gmail/draft` | Create draft |
| `modifyEmail(messageId, action)` | `POST /google/gmail/modify` | Archive/read/unread/trash |

Used by:
- `src/zen/ZenGmail.jsx` (Sashimi mode)
- `src/views/GmailView.jsx` (Sushi Roll mode)
- `src/core/Navigation.jsx` (unread badge polling)

### Google Calendar API

| Function | Endpoint | Purpose |
|----------|----------|---------|
| `getCalendarSummary()` | `GET /google/calendar/summary` | Next event label |
| `listCalendars()` | `GET /google/calendar/calendars` | All calendars with colors |
| `listCalendarEvents(timeMin, timeMax, maxResults)` | `GET /google/calendar/events` | Events in range |
| `createCalendarEvent({summary, start, end, ...})` | `POST /google/calendar/events` | Create event |
| `updateCalendarEvent(eventId, updates)` | `PATCH /google/calendar/events/{id}` | Update event |
| `deleteCalendarEvent(eventId)` | `DELETE /google/calendar/events/{id}` | Delete event |
| `checkFreeBusy(timeMin, timeMax)` | `POST /google/calendar/freebusy` | Free/busy check |

Used by:
- `src/zen/ZenCalendar.jsx` (Sashimi mode)
- `src/views/CalendarView.jsx` (Sushi Roll mode)
- `src/zen/SashimiDrawer.jsx` (event editing)
- `src/core/Navigation.jsx` (next event label)

---

## Notion Integration

Files in `src/notion/`:

| File | Purpose |
|------|---------|
| `client.js` | Notion API proxy client — database queries, page CRUD |
| `properties.js` | Notion property type parsing/formatting |
| `schema.js` | Notion database schema introspection |
| `pagination.js` | Cursor-based pagination for Notion queries |

### Notion Proxy API

| Function | Endpoint | Purpose |
|----------|----------|---------|
| `notionProxy(path, method, body, notionKey)` | `POST /notion-proxy` | Proxied Notion API calls |

The worker proxies Notion API requests to avoid CORS issues. The frontend sends Notion API paths and the worker forwards them with proper auth.

### Notion Sync

| Function | Endpoint | Purpose |
|----------|----------|---------|
| `configureSyncNotionDB(tableId, {notion_db_id, direction, field_mapping})` | `POST /tables/{id}/sync/notion` | Setup sync |
| `syncPush(tableId)` | `POST /tables/{id}/sync/push` | Push D1 → Notion |
| `syncPull(tableId)` | `POST /tables/{id}/sync/pull` | Pull Notion → D1 |
| `getSyncStatus(tableId)` | `GET /tables/{id}/sync/status` | Check sync status |
| `deleteSync(tableId)` | `DELETE /tables/{id}/sync` | Remove sync config |

---

## External API Proxy

```js
proxyExternalApi({ url, method, headers, body, transform_path })
```
- Endpoint: `POST /proxy`
- Generic proxy for any external API call
- Optional `transform_path` for response data extraction

---

## Google Neuron Cleanup (`src/google/googleNeuronCleanup.js`)

Removes orphaned Google-linked neuron nodes when Google is disconnected. Called during app init.

## Google Context (`src/google/googleContext.js`)

Shared Google connection state utilities.
