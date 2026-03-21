# Wasabi Platform: External Integrations

**Version:** March 2026
**Overview:** Wasabi integrates with Gmail, Google Calendar, Notion, Monday.com, Google Sheets, and external APIs. All external calls are proxied through a Cloudflare Worker.

---

## API Layer Pattern

**Core Function:** `src/lib/api.js`
```javascript
async function apiFetch(path, options = {})
```

**Authentication:**
- `X-Wasabi-Key`: Wasabi worker secret (stored connection)
- `Authorization: Bearer {JWT}`: User JWT token
- Headers merged with options

**Connection Storage:**
```javascript
const connection = {
  workerUrl: "https://wasabi-worker.example.com",
  secret: "wasabi-xxxxx"
}
// Stored in localStorage under key: "wasabi_connection"
```

**API Functions:**

| Function | Purpose |
|----------|---------|
| `getConnection()` | Returns stored `{ workerUrl, secret }` |
| `saveConnection(workerUrl, secret)` | Persist connection to localStorage |
| `clearConnection()` | Remove stored connection |
| `getJwt()` | Retrieve JWT from localStorage |
| `saveJwt(token)` | Store JWT |
| `clearJwt()` | Remove JWT |

**Error Handling:**
- Response automatically parsed as JSON
- Non-200 status or `_error` field throws Error
- Error object has `.status` and `.data` properties
- Failed JSON parsing defaults to `{ _error: "HTTP {status}" }`

---

## Google Integration

### OAuth Flow

| Function | Endpoint | Method | Purpose |
|----------|----------|--------|---------|
| `getGoogleAuthUrl()` | `/google/auth-url` | GET | Returns OAuth consent URL |
| `getGoogleStatus()` | `/google/status` | GET | Check if Google is connected |
| `disconnectGoogle()` | `/google/disconnect` | POST | Revoke access token |

**Token Storage:** Connection key `google` stores `{ accessToken, refreshToken, expiresAt }`

### Gmail API

| Function | Endpoint | Method | Parameters |
|----------|----------|--------|------------|
| `getGmailSummary()` | `/google/gmail/summary` | GET | None |
| `searchEmails(query, maxResults, labelIds)` | `/google/gmail/messages` | POST | `{ q, maxResults, labelIds }` |
| `getEmail(messageId)` | `/google/gmail/messages/{id}` | GET | `messageId` |
| `sendEmail({to, subject, bodyText, threadId, inReplyTo, references})` | `/google/gmail/send` | POST | Email object |
| `createDraft({to, subject, bodyText})` | `/google/gmail/drafts` | POST | Draft object |
| `updateDraft(draftId, {to, subject, bodyText})` | `/google/gmail/drafts/{id}` | PUT | Draft updates |
| `modifyEmail(messageId, action)` | `/google/gmail/modify/{id}` | POST | `{ action }` or action object |
| `getThread(threadId)` | `/google/gmail/threads/{id}` | GET | `threadId` |

**Usage:** Agent can search emails, read message content, send replies, manage drafts, mark as read/archived/trash.

### Google Calendar API

| Function | Endpoint | Method | Parameters |
|----------|----------|--------|------------|
| `listCalendars()` | `/google/calendar/list` | GET | None |
| `getCalendarSummary()` | `/google/calendar/summary` | GET | None |
| `listCalendarEvents(timeMin, timeMax, maxResults)` | `/google/calendar/events` | GET | Query params |
| `createCalendarEvent({summary, start, end, description, location, attendees})` | `/google/calendar/events` | POST | Event object |
| `updateCalendarEvent(eventId, updates)` | `/google/calendar/events/{id}` | PATCH | Event updates |
| `deleteCalendarEvent(eventId)` | `/google/calendar/events/{id}` | DELETE | `eventId` |
| `checkFreeBusy(timeMin, timeMax)` | `/google/calendar/freebusy` | POST | `{ timeMin, timeMax }` |

**Date Format:** ISO 8601 with timezone
Example: `2026-03-20T14:30:00-07:00`

### Google Context Injection

**File:** `src/google/googleContext.js`

Automatically injects Gmail and Calendar context into agent system prompt:

```javascript
export async function fetchGoogleContext() → string
```

**Behavior:**
1. Fetches Gmail summary (unread count + 3 recent subjects)
2. Fetches Calendar summary (4 upcoming events today + next 7 days)
3. Builds markdown snippet: `## Google Context`
4. Caches result for 5 minutes in sessionStorage
5. Returns empty string if Google not connected

**Example Output:**
```
## Google Context
- **Gmail**: 2 unread emails. Recent: "Q1 Budget Review" from Finance; "Team Standup Notes" from Alex
- **Calendar**: Upcoming: "Team Sync" at 10:00 AM; "1:1 with Sarah" at 2:00 PM; "Board Meeting" at 4:00 PM
- Use Gmail and Calendar tools when the user asks about emails or events.
```

---

## Notion Integration

### Architecture: Proxy Pattern

All Notion API calls route through Cloudflare Worker (`/page`, `/query`, `/database`, `/blocks`, etc.) to:
1. Add `X-Wasabi-Key` authentication header
2. Handle CORS (Notion API restricts cross-origin)
3. Manage rate limits
4. Transform error responses

**Connection Storage:** Key `notion` stores `{ apiKey, workspaceName }`

### Database Operations

**File:** `src/notion/client.js`

```javascript
getDatabase(workerUrl, notionKey, databaseId)
// Returns: Full database object with properties schema

createDatabase(workerUrl, notionKey, parentPageId, title, schema)
// schema: Array of { name, type, options?, format?, database_id?, synced_property_name? }

updateDatabase(workerUrl, notionKey, databaseId, payload)
// payload: { title?, description?, properties? }
```

### Page Operations

```javascript
getPage(workerUrl, notionKey, pageId)
// Returns: Page object with all properties

createPage(workerUrl, notionKey, databaseId, properties, children?)
// properties: Notion API format (see properties.js)

updatePage(workerUrl, notionKey, pageId, properties)

archivePage(workerUrl, notionKey, pageId)

unarchivePage(workerUrl, notionKey, pageId)

ensurePageActive(workerUrl, notionKey, pageId)
// Auto-unarchives if needed, returns page
```

### Block Operations

```javascript
getBlocks(workerUrl, notionKey, pageId)
// Returns: Array of block objects

appendBlocks(workerUrl, notionKey, parentId, children)
// children: Notion block array format

updateBlock(workerUrl, notionKey, blockId, blockData)

deleteBlock(workerUrl, notionKey, blockId)
```

### Search & Query

```javascript
queryAll(workerUrl, notionKey, databaseId, filter?, sorts?)
// Full pagination — returns ALL results
// Uses cursor-based pagination (100 per request)
// Safety valve: max 50 attempts

queryLimited(workerUrl, notionKey, databaseId, filter?, sorts?, limit = 50)
// Single request — returns first N results

searchDatabases(workerUrl, notionKey, query?)
// Returns: Array of accessible databases (max 50)

testConnection(workerUrl, notionKey)
// Returns: { ok: boolean, error?: string, data?: object }
```

**Filter Syntax (Notion API):**
```javascript
{
  property: "Status",
  select: { equals: "Done" }
}
```

### Schema Detection

**File:** `src/notion/schema.js`

```javascript
detectSchema(workerUrl, notionKey, databaseId)
// Fetches database and returns classifyProperties() result

classifyProperties(database)
// Returns: {
//   databaseId, databaseTitle,
//   title: { name, id, type },
//   selects: [{ name, options: [{name, color}] }],
//   statuses: [{ name, options, groups }],
//   dates: [{ name }],
//   numbers: [{ name, format }],
//   relations: [{ name, relatedDbId, synced }],
//   ... (and 10+ other property type arrays)
//   allFields: []
// }

autoDetectViews(schema)
// Suggests view types based on properties:
// ["table", "kanban", "gantt", "cardGrid", "charts", "summaryTiles", "form"]

suggestViewMappings(schema, viewType)
// Returns field-to-role mappings for specific view type
// Example: For kanban → { columnField, titleField, previewFields }

schemaToText(schema)
// Human-readable schema summary for agent context
```

### Property Reading & Writing

**File:** `src/notion/properties.js`

```javascript
readProp(prop)
// Converts Notion property object → plain JS value
// Handles all property types: title, rich_text, select, status, date, etc.
// Returns: string, number, array, object, or null

buildProp(type, value)
// Builds Notion property object for writes
// type: "title", "rich_text", "number", "select", "date", "checkbox", etc.
// Returns: Notion API format object

extractProperties(page)
// Returns flat object: { propertyName: readableValue, ... }

getPageTitle(page)
// Finds and returns title property value

getPropertyTypes(page)
// Returns: { propertyName: "type", ... }
```

---

## Monday.com Integration

### GraphQL Client

**File:** `src/monday/client.js`

All calls proxied through: `POST /monday/graphql`

```javascript
fetchBoards(mondayKey)
// Returns: Array of { id, name, columns: [{ id, title, type, settings_str }] }

fetchBoardColumns(mondayKey, boardId)
// Returns: Column array for specific board

fetchBoardItems(mondayKey, boardId)
// Returns: Array of { id, name, group, column_values, created_at, updated_at }
// Full pagination enabled
```

### Schema Mapping

**File:** `src/monday/schema.js`

```javascript
mondayColumnsToSchema(columns)
// Converts Monday columns → Wasabi schema format

mondayItemToPage(item, schema)
// Converts Monday item → Notion-like page format
```

**Limitations:** Read-only (no write support)

---

## Google Sheets Integration

### Sheet Detection & Validation

**File:** `src/sheets/sheetClient.js`

```javascript
detectSheetType(url)
// Returns: "google_sheets" | "csv" | "unsupported" | null

extractGoogleSheetId(url)
// Parses Google Sheets document ID from URL

validateSheetUrl(url)
// Returns: { valid: boolean, type: string|null, error: string|null }

fetchSheetData(workerUrl, sheetUrl)
// Returns: { columns: [], rows: [][], cachedAt: number, sheetType, truncated? }
// Proxies through: POST /sheets/fetch

detectColumnTypes(columns, rows)
// Samples first 50 values per column
// Returns: { [columnName]: "number"|"date"|"url"|"checkbox"|"text" }
```

**Supported Formats:**
- Google Sheets (live read access)
- HTTPS CSV URLs

**Unsupported (flagged for future):**
- Excel Online / SharePoint
- Airtable

---

## External API Proxy

**Route:** `POST /proxy/external-api`

```javascript
proxyExternalApi({ url, method, headers, body, transform_path })
```

Allows agents to call third-party APIs with authentication:
- URL: Target endpoint
- Method: GET, POST, PUT, PATCH, DELETE
- Headers: Custom headers to merge
- Body: Request body
- transform_path: Optional response transformation

**Security:** X-Wasabi-Key required; no token leakage

---

## CORS Configuration

**Current Policy (worker.js):**
```javascript
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Claude-Key, X-Wasabi-Key",
};
```

**Issue:** Allows all origins globally (see Known Issues below)

---

## Known Gaps & Issues

### Issue #1: CORS Validation Missing (MODERATE)

**Location:** `worker.js` lines 9-13

**Problem:** CORS header `*` applied globally enables CSRF attacks on:
- Notion proxy endpoints
- Google OAuth callbacks
- All sensitive operations

**Impact:** Malicious websites could make requests on user's behalf

**Recommendation:** Validate origin; only allow specific domains

---

### Issue #2: Inconsistent Error Handling (MODERATE)

**Location:** `src/notion/client.js` (multiple functions)

**Problem:** Different error response handling:
- `createPage()`: `res.json().catch(() => ({}))`
- `updatePage()`: `res.text().catch(() => "")`

**Impact:** Debugging difficult; inconsistent error details

**Recommendation:** Unified error handler for all Notion responses

---

### Issue #3: Notion-Linked Databases Bypass D1 (ARCHITECTURAL)

**Location:** `src/agent/toolExecutor.js` query_database handler

**Problem:** When user links a Notion database:
1. Agent queries go **directly to Notion API** (not D1)
2. Data **does not sync to D1**
3. **MCP server cannot access linked data** (empty results)

**Implications:**
- Notion-linked tables are read-only in agent
- No local search/filtering
- Users must have valid Notion token for access
- Two-tier data access pattern

**Design:** Intentional but creates limitations

---

### Issue #4: JWT Stored in Plain localStorage (MAJOR)

**Location:** `src/lib/api.js` lines 10-20

**Problem:** JWT tokens stored unencrypted in localStorage
- Vulnerable to XSS attacks
- Persists across browser sessions
- No expiration check before use

**Recommendation:** Move to memory-only + httpOnly cookies (P0 fix)

---

### Issue #5: Sheet Data Not Cached (LIMITATION)

**Problem:** Each sheet fetch is fresh; no persistent caching

**Impact:** Slow large sheet queries; repeated API calls

**Recommendation:** Implement TTL cache (5-15 min) per sheet URL

---

### Issue #6: Monday.com Write Support Missing (LIMITATION)

**Problem:** Only reads boards/items; mutations not implemented

**Impact:** Agents cannot create/update Monday items

**Recommendation:** Implement GraphQL mutations (P2)

---

## Testing Checklist

- [ ] Gmail: Search, read, send, draft, modify
- [ ] Calendar: List, create, update, delete, free/busy
- [ ] Notion: Query, create, update, schema detection, pagination
- [ ] Monday: List boards, fetch items, column detection
- [ ] Sheets: Fetch Google Sheets and CSV data, column type detection
- [ ] Errors: Invalid tokens, rate limits, network failures
- [ ] CORS: Cross-origin requests from multiple domains

---

## References

- **Worker Routes:** `worker.js` for all `/google`, `/notion`, `/monday`, `/sheets`, `/proxy` handlers
- **Tool Schemas:** `src/agent/tools.js` for agent tool definitions
- **Code Review:** See code-review.md for detailed security findings
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
