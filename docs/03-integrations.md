# 03 — External Integrations

## Product Context

Wasabi is an AI-native workspace where users build persistent semantic scaffolding that makes AI more accurate over time. External integrations (Gmail, Calendar, Notion, Monday.com, Google Sheets) feed data into this scaffolding. All external API calls are proxied through the Cloudflare Worker (`worker.js`) so that credentials never reach the browser. See `docs/00-wasabi-overview.md` for the full platform description.

---

## Security Architecture

All external integrations share a common security model:

- **Proxy pattern:** The browser never calls external APIs directly. Every request goes through the worker, which attaches credentials and forwards the call.
- **Credential storage:** OAuth tokens and API keys are stored server-side in the `user_connections` D1 table (per-user) or the `connections` table (global/legacy).
- **CORS:** Implemented and enforced. The worker validates each request's `Origin` header against a whitelist defined in the `CORS_ORIGINS` environment variable (see CORS section below).
- **Auth chain:** Browser sends `Authorization: Bearer {JWT}` + `X-Wasabi-Key` headers. Worker validates both before proxying to external services.

---

## Google OAuth Flow

### How It Works

1. Frontend calls `GET /google/auth-url` to get the OAuth consent URL
2. User is redirected to Google's consent screen
3. Google redirects back to the worker's callback endpoint with an auth code
4. Worker exchanges the auth code for access + refresh tokens via Google's token endpoint
5. Tokens are stored per-user in `user_connections` table (key: `google`, value: JSON with `accessToken`, `refreshToken`, `expiresAt`)
6. Worker auto-refreshes expired access tokens using the stored refresh token

### OAuth Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/google/auth-url` | GET | Returns Google OAuth consent URL |
| `/google/status` | GET | Check if Google is connected for current user |
| `/google/disconnect` | POST | Revoke tokens and delete from `user_connections` |

### Token Storage

Tokens are stored per-user in the `user_connections` D1 table:

```
user_connections (
  user_id TEXT,
  key TEXT,          -- "google"
  value TEXT,        -- JSON: { accessToken, refreshToken, expiresAt }
  metadata TEXT,
  updated_at TEXT,
  PRIMARY KEY (user_id, key)
)
```

The worker checks `user_connections` first, then falls back to the global `connections` table for backward compatibility.

---

## Gmail API

All Gmail operations are proxied through the worker. The frontend client functions live in `src/lib/api.js`.

### Endpoints

| Action | Endpoint | Method | Purpose |
|--------|----------|--------|---------|
| summary | `/google/gmail/summary` | GET | Unread count + recent subject lines |
| search | `/google/gmail/messages` | POST | Search messages (query, maxResults, labelIds) |
| read | `/google/gmail/messages/{id}` | GET | Get full message by ID |
| send | `/google/gmail/send` | POST | Send email (to, subject, bodyText, threadId, inReplyTo, references) |
| draft | `/google/gmail/drafts` | POST | Create draft |
| modify draft | `/google/gmail/drafts/{id}` | PUT | Update existing draft |
| modify | `/google/gmail/modify/{id}` | POST | Modify labels (archive, trash, mark read/unread) |
| thread | `/google/gmail/threads/{id}` | GET | Get full thread by ID |

### Usage

The AI agent can search emails, read message content, send replies, manage drafts, and modify labels. The Gmail View (`src/features/GmailView.jsx`) provides the user-facing email interface with inbox, compose, and thread views.

### Google Context Injection

`src/google/googleContext.js` automatically injects Gmail and Calendar summaries into the AI system prompt:
- Fetches Gmail summary (unread count + 3 recent subjects)
- Fetches Calendar summary (upcoming events for today + next 7 days)
- Caches result for 5 minutes in sessionStorage
- Returns empty string if Google is not connected

---

## Google Calendar API

All Calendar operations are proxied through the worker.

### Endpoints

| Action | Endpoint | Method | Purpose |
|--------|----------|--------|---------|
| list | `/google/calendar/list` | GET | All calendars with colors |
| summary | `/google/calendar/summary` | GET | Upcoming events summary |
| events | `/google/calendar/events` | GET | Events in time range (timeMin, timeMax, maxResults) |
| create | `/google/calendar/events` | POST | Create event (summary, start, end, description, location, attendees) |
| update | `/google/calendar/events/{id}` | PATCH | Update event fields |
| delete | `/google/calendar/events/{id}` | DELETE | Delete event |
| freebusy | `/google/calendar/freebusy` | POST | Check free/busy availability (timeMin, timeMax) |

### Date Format

ISO 8601 with timezone: `2026-03-20T14:30:00-07:00`

### Used By

- `src/features/CalendarView.jsx` — Calendar View (day/week/month views)
- `src/views/Calendar.jsx` — Workspace mode calendar view
- `src/features/RecordDrawer.jsx` — Event editing
- `src/core/Navigation.jsx` — Next event label in sidebar

---

## Notion Integration

### Proxy Architecture

Wasabi does NOT access the Notion API directly from the browser. All Notion API calls route through the worker:

```
Browser → apiFetch() with JWT → Worker (/page/{id}, /database/{id}, /query, /blocks/{id}, /search)
  → Worker validates JWT, resolves Notion key via getNotionKey()
  → Worker adds Notion-Version header + Authorization (Notion key)
  → Forward to https://api.notion.com/v1/...
  → Return response to browser
```

This pattern exists because:
1. Notion API restricts cross-origin browser requests
2. API keys must stay server-side
3. Worker handles rate limiting and error transformation

### Auth Chain (March 2026)

All Notion client functions (`src/notion/client.js`) use `apiFetch()` from `src/lib/api.js`, which automatically attaches the user's JWT. The worker validates the JWT before proxying to Notion. Previously, the frontend passed `workerUrl` and `notionKey` params through the entire call chain and used raw `fetch()` with the Notion key as a Bearer token — this bypassed JWT auth entirely. The refactor removed `workerUrl`/`notionKey` params from 31 files across the codebase (notion client, pagination, schema, agent tools, React components).

**Worker-side `getNotionKey()` resolution order:**
1. Check `X-Notion-Key` header — only accepts keys prefixed with `ntn_` or `secret_` (rejects stale JWT tokens mistakenly passed as Notion keys)
2. Fall back to `connections` D1 table (global Notion key)
3. Return `null` if no key found (Notion integration is optional)

### Notion Proxy Routes (worker.js)

| Route | Method | Notion API Target |
|-------|--------|-------------------|
| `/page/{id}` | GET | `/pages/{id}` |
| `/page` | POST | `/pages` (create) |
| `/page/{id}` | PATCH | `/pages/{id}` (update) |
| `/database/{id}` | GET | `/databases/{id}` |
| `/database/{id}` | PATCH | `/databases/{id}` (update) |
| `/create-database` | POST | `/databases` (create) |
| `/blocks/{id}` | GET | `/blocks/{id}/children` |
| `/blocks/{id}` | PATCH | `/blocks/{id}/children` (append) |
| `/block/{id}` | PATCH | `/blocks/{id}` (update single) |
| `/block/{id}` | DELETE | `/blocks/{id}` (delete single) |
| `/query` | POST | `/databases/{id}/query` |
| `/search` | POST | `/search` |
| `/test` | GET | `/users/me` (connection test) |

### Frontend Client (`src/notion/client.js`)

Provides typed functions: `getDatabase()`, `createDatabase()`, `updateDatabase()`, `getPage()`, `createPage()`, `updatePage()`, `archivePage()`, `getBlocks()`, `appendBlocks()`, `queryAll()` (full pagination, max 50 requests), `queryLimited()`, `searchDatabases()`, `testConnection()`. All functions use `apiFetch()` internally — no raw `fetch()` calls, no `workerUrl`/`notionKey` parameters.

### Schema Detection (`src/notion/schema.js`)

`detectSchema()` fetches a Notion database and returns classified properties: title, selects, statuses, dates, numbers, relations, and 10+ other property type arrays. `autoDetectViews()` suggests view types based on the property mix. `schemaToText()` produces a human-readable summary for AI context.

### Property Reading/Writing (`src/notion/properties.js`)

`readProp()` converts Notion property objects to plain JS values. `buildProp()` constructs Notion API format objects for writes. Handles all property types: title, rich_text, select, status, date, number, checkbox, relation, formula, rollup, etc.

---

## Notion Sync

Bidirectional sync between D1 tables and Notion databases, managed via the `sync_configs` D1 table.

### Sync Routes (worker.js)

| Route | Method | Purpose |
|-------|--------|---------|
| `/sync/{tableId}/configure` | POST | Create or update sync config (notion_db_id, direction, field_mapping) |
| `/sync/{tableId}/push` | POST | Push D1 changes to Notion |
| `/sync/{tableId}/pull` | POST | Pull Notion changes to D1 (optional `?full=1` for full resync) |
| `/sync/{tableId}/status` | GET | Get sync status (last_synced_at, field_mapping, direction) |
| `/sync/{tableId}` | DELETE | Remove sync config |
| `/sync/flush` | POST | Process all dirty rows across all synced tables |
| `/sync/bootstrap` | POST | Auto-configure + full pull for all linked Notion databases |

### Sync Config Table

```
sync_configs (
  id TEXT PRIMARY KEY,
  table_id TEXT,
  notion_db_id TEXT,
  direction TEXT,        -- "push", "pull", "bidirectional"
  field_mapping TEXT,    -- JSON mapping of D1 columns to Notion properties
  enabled INTEGER,
  last_synced_at TEXT
)
```

### Sync Behavior

- **Pull:** Fetches all Notion pages, maps properties via field_mapping, upserts into D1 `table_rows`
- **Push:** Finds dirty D1 rows (modified since last sync), creates/updates corresponding Notion pages
- **Flush:** Processes all tables with enabled sync configs, pushing dirty rows
- **Bootstrap:** Auto-detects all linked Notion databases, configures sync, and performs a full pull
- Worker cron trigger (every 2 minutes) can run automated sync

---

## Monday.com Integration

### Architecture

Read-only GraphQL proxy. The worker forwards GraphQL queries to the Monday.com API.

### Route

| Route | Method | Purpose |
|-------|--------|---------|
| `/monday/graphql` | POST | Forward GraphQL query to `https://api.monday.com/v2` |

The worker retrieves the Monday API key from the `connections` table (key: `monday`) and sets it as the `Authorization` header.

### Frontend Client (`src/monday/client.js`)

| Function | Purpose |
|----------|---------|
| `fetchBoards(mondayKey)` | List all boards with columns |
| `fetchBoardColumns(mondayKey, boardId)` | Get column definitions for a specific board |
| `fetchBoardItems(mondayKey, boardId)` | Get all items with full pagination |

### Schema Mapping (`src/monday/schema.js`)

`mondayColumnsToSchema()` converts Monday column types to Wasabi schema format. `mondayItemToPage()` converts Monday items to a Notion-like page format for unified handling.

**Limitation:** Write support is not implemented. The integration is read-only.

---

## Google Sheets Integration

### Architecture

The worker fetches Google Sheets data as CSV via the public export URL, parses it, and returns structured data with caching.

### Route

| Route | Method | Purpose |
|-------|--------|---------|
| `/sheets/fetch` | POST | Fetch and parse sheet data (body: `{ url }`) |

### How It Works

1. Worker receives a Google Sheets URL
2. Extracts the spreadsheet ID and constructs a CSV export URL: `https://docs.google.com/spreadsheets/d/{id}/gviz/tq?tqx=out:csv`
3. Fetches the CSV data
4. Parses into `{ columns, rows }` format
5. Caches the response for **300 seconds** (5 minutes) via Cloudflare's Cache API
6. Returns structured data with `cachedAt` timestamp
7. Rows are truncated to 10,000 maximum

### Frontend Client (`src/sheets/sheetClient.js`)

| Function | Purpose |
|----------|---------|
| `detectSheetType(url)` | Returns `"google_sheets"`, `"csv"`, `"unsupported"`, or `null` |
| `extractGoogleSheetId(url)` | Parses document ID from URL |
| `validateSheetUrl(url)` | Validates URL format and type |
| `fetchSheetData(workerUrl, sheetUrl)` | Fetches parsed sheet data via worker proxy |
| `detectColumnTypes(columns, rows)` | Samples first 50 values per column to infer types |

**Requirement:** Sheets must be publicly accessible ("Anyone with the link can view").

---

## External API Proxy

### Route

| Route | Method | Purpose |
|-------|--------|---------|
| `/proxy/external-api` | POST | Generic proxy for any external API call |

### Request Body

```javascript
{
  url: "https://api.example.com/endpoint",
  method: "GET",           // GET, POST, PUT, PATCH, DELETE
  headers: {},             // Custom headers to merge
  body: {},                // Request body (for POST/PUT/PATCH)
  transform_path: "data"   // Optional: extract nested response field
}
```

This allows the AI agent and custom functions to call third-party APIs without exposing credentials to the browser. Requires `X-Wasabi-Key` authentication and `editor` role minimum.

---

## CORS Configuration

**Status: IMPLEMENTED** — CORS is properly enforced via origin whitelist, not open `*`.

### Implementation (`worker.js`)

The `getCorsHeaders(request, env)` function:

1. Reads the `Origin` header from the request
2. Splits the `CORS_ORIGINS` env var (comma-separated) into an allowed list
3. Falls back to `http://localhost:5173,http://127.0.0.1:5173` for local development
4. If the request origin matches the whitelist, sets `Access-Control-Allow-Origin` to that specific origin
5. If no origin (same-origin/non-browser request), allows the request
6. If origin does not match, returns empty `Access-Control-Allow-Origin` (request denied)
7. Sets `Vary: Origin` header when returning a specific origin (correct caching behavior)

### Configuration

Set in `wrangler-worker.toml` or via Cloudflare dashboard:

```
CORS_ORIGINS = "https://wasabi-platform.pages.dev,http://localhost:5173,http://127.0.0.1:5173"
```

### Headers Returned

```
Access-Control-Allow-Origin: {matched origin}
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Claude-Key, X-Wasabi-Key, X-Wasabi-Pin-Token
Access-Control-Allow-Credentials: true
Vary: Origin
```

---

## API Client (`src/lib/api.js`)

All frontend API calls go through the `apiFetch()` function:

```javascript
async function apiFetch(path, options = {})
```

### Authentication Headers

- `X-Wasabi-Key` — Worker secret (from stored connection)
- `Authorization: Bearer {JWT}` — User JWT token

### Connection Storage

```javascript
// Stored in localStorage: "wasabi_connection"
{ workerUrl: "https://wasabi-worker.example.com", secret: "wasabi-xxxxx" }
```

### Helper Functions

| Function | Purpose |
|----------|---------|
| `getConnection()` | Returns stored `{ workerUrl, secret }` |
| `saveConnection(workerUrl, secret)` | Persist connection to localStorage |
| `clearConnection()` | Remove stored connection |
| `getJwt()` | Retrieve JWT from memory |
| `saveJwt(token)` | Store JWT in memory |
| `clearJwt()` | Remove JWT |

### Error Handling

- Response automatically parsed as JSON
- Non-200 status or `_error` field in response body throws an Error
- Error object has `.status` and `.data` properties
- Failed JSON parsing defaults to `{ _error: "HTTP {status}" }`

---

## Integration Summary

| Integration | Read | Write | Auth | Cache | Proxy Route |
|------------|------|-------|------|-------|-------------|
| Gmail | Full (summary, search, read, thread) | Full (send, draft, modify) | Google OAuth (per-user) | None | `/google/gmail/*` |
| Calendar | Full (list, events, freebusy) | Full (create, update, delete) | Google OAuth (per-user) | None | `/google/calendar/*` |
| Notion | Full (pages, databases, blocks, search) | Full (create, update, archive) | API key (per-user or global) | None | `/page/*`, `/database/*`, `/blocks/*`, `/query`, `/search` |
| Notion Sync | Pull + status | Push + flush | API key | sync_configs table | `/sync/{id}/*` |
| Monday.com | Full (boards, columns, items) | None | API key (global) | None | `/monday/graphql` |
| Google Sheets | Full (fetch + parse) | None | Public URL only | 300s (Cache API) | `/sheets/fetch` |
| External APIs | Proxy passthrough | Proxy passthrough | X-Wasabi-Key | None | `/proxy/external-api` |
