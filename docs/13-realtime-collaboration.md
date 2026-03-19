# 13 — Real-Time Collaboration & Conflict Resolution

**Last updated**: 2026-03-19
**Status**: Phases 1-3 complete. Phase 4 (live record updates) and Phase 5 (polish) pending.

### Multi-User Fixes Completed (2026-03-19)
- ✅ Google OAuth per-user isolation: `handleGoogleStatus` no longer falls back to global token for logged-in users
- ✅ Disconnect only removes the current user's token, not the global one
- ✅ Field-level conflict detection deployed to production

## Context

Wasabi supports 5-10 concurrent users. Without real-time sync, two users editing the same record causes silent data loss (last-write-wins with no detection). This plan implements Google Docs-style collaboration: field-level merge, live presence, and conflict resolution across all views.

## Requirements

- **Presence**: See who has which record open (colored border + avatar badge). Typing indicator when someone is actively editing.
- **Field-level merge**: Non-conflicting field changes merge automatically. Conflicting field changes surface a resolution UI.
- **Soft lock with override**: When another user is editing a record, show a banner but allow edits. Changes merge on save.
- **All views**: Table, kanban, gantt, calendar, cardGrid, form, activityFeed — all receive live updates.
- **Scale**: 5-10 concurrent users per workspace.

## Architecture Overview

```
Browser A ──WebSocket──┐
Browser B ──WebSocket──┤── Durable Object (TableRoom) ──── D1 Database
Browser C ──WebSocket──┘         │
                                 ├── Presence state (in-memory)
                                 ├── Field version tracking
                                 └── Change broadcast hub
```

### Three Layers

1. **Durable Object ("TableRoom")** — one per table, manages WebSocket connections, presence, and change broadcasting
2. **Field-level versioning in D1** — `cell_versions` JSON on each row for conflict detection
3. **Frontend presence + conflict UI** — colored borders, typing indicators, merge/conflict toasts

---

## Layer 1: Durable Object — TableRoom

### Purpose
Manages real-time WebSocket connections for a single table. Tracks who's connected, what record they're viewing/editing, and broadcasts changes to all participants.

### Location
`worker.js` — export a new Durable Object class `TableRoom`

### Wrangler Config
```toml
# wrangler-worker.toml
[durable_objects]
bindings = [
  { name = "TABLE_ROOMS", class_name = "TableRoom" }
]

[[migrations]]
tag = "v1"
new_classes = ["TableRoom"]
```

### WebSocket Endpoint
```
GET /ws/table/:tableId
→ Upgrade to WebSocket
→ Route to Durable Object instance (ID derived from tableId)
```

### Durable Object State (in-memory)

```javascript
class TableRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // WebSocket → { userId, userName, role, activeRecordId, isTyping, color }
  }
}
```

### WebSocket Message Protocol

All messages are JSON with a `type` field.

#### Client → Server

| Type | Payload | Description |
|------|---------|-------------|
| `join` | `{ userId, userName, role, color }` | User connects to table |
| `focus` | `{ recordId }` | User opened/selected a record |
| `blur` | `{}` | User closed record / deselected |
| `typing` | `{ recordId, field }` | User is actively editing a field |
| `stop_typing` | `{}` | User stopped editing |
| `save` | `{ recordId, cells, base_versions }` | User saving field changes (goes through DO for conflict check) |

#### Server → Client (broadcast)

| Type | Payload | Description |
|------|---------|-------------|
| `presence` | `{ users: [{ userId, userName, color, activeRecordId, isTyping, typingField }] }` | Full presence snapshot (sent on join/leave/focus/blur) |
| `user_joined` | `{ userId, userName, color }` | New user connected |
| `user_left` | `{ userId }` | User disconnected |
| `user_focus` | `{ userId, recordId }` | User focused on a record |
| `user_blur` | `{ userId }` | User unfocused |
| `user_typing` | `{ userId, recordId, field }` | User is typing in a field |
| `record_updated` | `{ recordId, cells, cell_versions, updatedBy }` | A record was saved — apply delta |
| `conflict` | `{ recordId, field, yourValue, theirValue, theirUser, currentVersion }` | Field-level conflict detected |

### Conflict Detection Flow (inside DO)

```
1. Client sends: save { recordId, cells: { Status: "Done" }, base_versions: { Status: 13 } }
2. DO reads current cell_versions from D1 for that row
3. For each changed field:
   a. If base_version matches current → accept, bump version, write to D1
   b. If base_version < current → CONFLICT: another user changed this field
4. For accepted fields: broadcast record_updated to all other clients
5. For conflicted fields: send conflict message back to the saving client
6. Return merged result to saving client
```

### DO Lifecycle
- Created on first WebSocket connection to a table
- Evicted after all connections close + idle timeout (Cloudflare manages this)
- No persistent state needed — presence is ephemeral, versions are in D1

---

## Layer 2: Field-Level Versioning in D1

### Schema Change

```sql
ALTER TABLE table_rows ADD COLUMN cell_versions TEXT DEFAULT '{}';
```

`cell_versions` is a JSON object mapping field names to integer version counters:
```json
{ "Status": 14, "Title": 7, "Priority": 3, "Assignee": 1 }
```

### Modified PATCH /tables/:tableId/rows/:rowId

**Current behavior**: Merge cells, write to D1, broadcast notification.

**New behavior**:

```javascript
async function handleUpdateRow(env, tableId, rowId, body, user) {
  const existing = await env.DB.prepare(
    "SELECT cells, cell_versions, metadata FROM table_rows WHERE id = ? AND table_id = ?"
  ).bind(rowId, tableId).first();

  const currentCells = JSON.parse(existing.cells || "{}");
  const currentVersions = JSON.parse(existing.cell_versions || "{}");
  const baseVersions = body.base_versions || {}; // sent by client
  const incomingCells = body.cells || body;

  const accepted = {};
  const conflicts = {};
  const newVersions = { ...currentVersions };

  for (const [field, value] of Object.entries(incomingCells)) {
    const currentV = currentVersions[field] || 0;
    const baseV = baseVersions[field];

    // If no base_version sent (legacy client), accept unconditionally
    if (baseV === undefined || baseV >= currentV) {
      accepted[field] = value;
      newVersions[field] = currentV + 1;
    } else {
      // Conflict: base version is stale
      conflicts[field] = {
        yourValue: value,
        currentValue: currentCells[field],
        currentVersion: currentV,
      };
    }
  }

  // Merge accepted fields
  if (Object.keys(accepted).length > 0) {
    const mergedCells = { ...currentCells, ...accepted };
    await env.DB.prepare(
      `UPDATE table_rows SET cells = ?, cell_versions = ?, updated_at = datetime('now'), sync_dirty = 1
       WHERE id = ? AND table_id = ?`
    ).bind(JSON.stringify(mergedCells), JSON.stringify(newVersions), rowId, tableId).run();
  }

  return jsonResponse({
    accepted,
    conflicts: Object.keys(conflicts).length ? conflicts : undefined,
    cell_versions: newVersions,
  });
}
```

### Backward Compatibility
- If `base_versions` is not sent (old frontend, MCP, API calls), all fields are accepted unconditionally (current behavior preserved).
- `cell_versions` column defaults to `'{}'` — no migration needed for existing rows, versions start at 0.

---

## Layer 3: Frontend

### 3a. WebSocket Connection Manager

**New file**: `src/lib/tableSocket.js`

Singleton manager that opens/closes WebSocket connections per table.

```javascript
class TableSocket {
  constructor(tableId, userId, userName, color) { ... }
  connect() { /* open WS to /ws/table/:tableId */ }
  disconnect() { ... }
  send(type, payload) { ... }
  onMessage(handler) { ... }

  // Presence shortcuts
  focusRecord(recordId) { this.send("focus", { recordId }); }
  blurRecord() { this.send("blur", {}); }
  startTyping(recordId, field) { this.send("typing", { recordId, field }); }
  stopTyping() { this.send("stop_typing", {}); }

  // Save with conflict detection
  saveRecord(recordId, cells, baseVersions) {
    this.send("save", { recordId, cells, base_versions: baseVersions });
  }
}
```

### 3b. React Context — CollaborationContext

**New file**: `src/context/CollaborationContext.jsx`

Wraps `TableSocket` in React context. Provides:

```javascript
const {
  // Presence
  activeUsers,        // Map<userId, { userName, color, activeRecordId, isTyping, typingField }>
  getUsersOnRecord,   // (recordId) => [{ userId, userName, color, isTyping }]

  // Actions
  focusRecord,        // (recordId) => void
  blurRecord,         // () => void
  startTyping,        // (recordId, field) => void
  stopTyping,         // () => void

  // Live updates
  onRecordUpdated,    // callback when another user saves
  pendingConflicts,   // [{ recordId, field, yourValue, theirValue, theirUser }]
  resolveConflict,    // (recordId, field, chosenValue) => void
} = useCollaboration();
```

### 3c. Presence UI Components

**Record border highlight** (all views):
```jsx
// In card/row rendering, check if another user has this record focused
const othersOnRecord = getUsersOnRecord(record.id);
const borderColor = othersOnRecord.length > 0 ? othersOnRecord[0].color : undefined;

<div style={{ borderLeft: borderColor ? `3px solid ${borderColor}` : undefined }}>
  {/* Avatar badges */}
  {othersOnRecord.map(u => <AvatarBadge key={u.userId} user={u} />)}
</div>
```

**Typing indicator**:
```jsx
{othersOnRecord.some(u => u.isTyping) && (
  <span className="typing-indicator">
    {othersOnRecord.filter(u => u.isTyping).map(u => u.userName).join(", ")} editing...
  </span>
)}
```

**Soft lock banner in RecordDrawer**:
```jsx
{othersOnRecord.length > 0 && (
  <div className="collab-banner">
    {othersOnRecord.map(u => u.userName).join(", ")} also editing.
    Changes merge automatically.
  </div>
)}
```

**Conflict toast**:
```jsx
{pendingConflicts.map(c => (
  <ConflictToast
    key={`${c.recordId}-${c.field}`}
    field={c.field}
    yourValue={c.yourValue}
    theirValue={c.theirValue}
    theirUser={c.theirUser}
    onKeepMine={() => resolveConflict(c.recordId, c.field, c.yourValue)}
    onAcceptTheirs={() => resolveConflict(c.recordId, c.field, c.theirValue)}
  />
))}
```

### 3d. User Colors

Each user gets a consistent color derived from their user ID (hash to palette index). Stored in `users` table or generated client-side:

```javascript
const USER_COLORS = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F"];
function userColor(userId) {
  let hash = 0;
  for (const ch of userId) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}
```

---

## Integration Points

### PageShell.jsx
- On mount: create `TableSocket` for `pageConfig.id` (if page_type is database)
- Pass `CollaborationContext` provider around the view tree
- On unmount: disconnect socket, send blur

### ViewRenderer.jsx
- Wrap all view components inside `CollaborationContext.Provider`
- Each view reads `activeUsers` and `getUsersOnRecord` to render presence

### RecordDrawer.jsx
- On open: call `focusRecord(recordId)`
- On close: call `blurRecord()`
- On field edit: call `startTyping(recordId, field)`
- On field blur: call `stopTyping()`
- On save: use `saveRecord(recordId, cells, baseVersions)` instead of direct API call
- Show soft lock banner if others are editing
- Show conflict resolution UI if conflicts returned

### dataSource.js / api.js
- `updateRecord()` now sends `base_versions` alongside `cells`
- Frontend tracks `cell_versions` per record (received from list/query responses and live updates)

---

## Implementation Phases

### Phase 1: Field-Level Versioning (no WebSocket yet) — COMPLETE ✅
**Files**: `worker.js`, `src/lib/dataSource.js`, `src/core/PageShell.jsx`, `src/components/ConflictToast.jsx`
**Commit**: `138b481` (2026-03-19)

1. ✅ Added `cell_versions` TEXT column + `updated_by` TEXT column to `table_rows`
2. ✅ Modified `handleUpdateRow` to support `base_versions` conflict detection
3. ✅ `cell_versions` included in both row list and query responses (parsed from JSON)
4. ✅ Frontend tracks `cell_versions` per record, passes `base_versions` through `dataSource.updateRecord` → `api.updateRow`
5. ✅ `ConflictToast` component: shows conflicted fields with "Keep mine" / "Accept theirs" buttons
6. ✅ Legacy clients (no `base_versions`) still work unconditionally — backward compatible
7. ✅ Worker deployed, init migration runs successfully

**Outcome**: Conflict detection works via polling. No real-time presence yet, but no more silent data loss.

**BLOCKER for full functionality**: Notion-linked databases have empty D1 table_rows — conflict detection only works on standalone D1 tables until the D1/Notion sync architecture is fixed. See `docs/14-d1-notion-sync-architecture.md`.

### Phase 2: Durable Object + WebSocket — COMPLETE ✅
**Files**: `worker.js` (TableRoom class), `wrangler-worker.toml`, `src/lib/tableSocket.js`

1. ✅ Created `TableRoom` Durable Object class with full message protocol
2. ✅ Added `/ws/table/:tableId` WebSocket upgrade endpoint with JWT + API key auth
3. ✅ Implemented join/leave/focus/blur/typing/save message handling
4. ✅ Built `TableSocket` client class with auto-reconnect (exponential backoff up to 30s)
5. ✅ Updated `wrangler-worker.toml` with DO binding + migration tag v1
6. ✅ Save-through-DO conflict detection (reads D1, detects conflicts, broadcasts accepted changes)

**Outcome**: Live WebSocket connections per table. Server can broadcast presence and record changes.

### Phase 3: Presence UI — COMPLETE ✅
**Files**: `src/context/CollaborationContext.jsx`, view components

1. ✅ Created `CollaborationContext` React context wrapping `TableSocket`
2. ✅ Wired into `PageShell` via `CollaborationProvider` (connect on mount, disconnect on unmount)
3. ✅ Added presence rendering to Table (colored left border on rows with other users)
4. ✅ Added presence rendering to Kanban (colored card border + name badge with typing indicator)
5. ✅ Added typing indicator to RecordDetail (startTyping on field edit, stopTyping on commit)
6. ✅ Added collaboration banner to RecordDetail ("X also viewing/editing. Changes merge automatically.")
7. ✅ RecordDrawer sends focus/blur events on open/close

**Outcome**: Users see who's editing what, across Table and Kanban views + record detail.

### Phase 4: Live Record Updates
**Files**: `TableRoom` DO, `CollaborationContext`, `RecordDrawer`

1. Route saves through Durable Object (client → DO → D1 → broadcast)
2. Apply incoming `record_updated` deltas to local state
3. Conflict detection + resolution UI (keep mine / accept theirs)
4. Handle reconnection (re-fetch state on WebSocket reconnect)

**Outcome**: Full Google Docs-style collaboration.

### Phase 5: Polish & Edge Cases
1. Offline queue — buffer saves during disconnect, replay on reconnect
2. Debounce typing indicators (don't flood WebSocket)
3. Graceful degradation — if DO is unavailable, fall back to polling
4. Rate limiting — prevent WebSocket spam
5. User color consistency — store in user profile or derive from ID

---

## File Inventory

| File | Change | Phase |
|------|--------|-------|
| `worker.js` | Add `cell_versions` to schema, modify handleUpdateRow, add TableRoom DO class, add /ws/table/:tableId endpoint | 1, 2 |
| `wrangler-worker.toml` | Add Durable Object binding + migration | 2 |
| `src/lib/tableSocket.js` | NEW — WebSocket client manager | 2 |
| `src/context/CollaborationContext.jsx` | NEW — React context for presence + conflicts | 3 |
| `src/core/PageShell.jsx` | Connect CollaborationContext on mount | 3 |
| `src/views/ViewRenderer.jsx` | Wrap views in CollaborationContext.Provider | 3 |
| `src/views/TableView.jsx` | Add presence borders + badges to rows | 3 |
| `src/views/KanbanView.jsx` | Add presence borders + badges to cards | 3 |
| `src/zen/RecordDrawer.jsx` | Focus/blur events, typing indicator, soft lock banner, conflict UI | 3, 4 |
| `src/lib/api.js` | Send base_versions with PATCH, track cell_versions | 1 |
| `src/lib/dataSource.js` | Pass base_versions through updateRecord | 1 |
| `src/components/ConflictToast.jsx` | NEW — conflict resolution UI | 1 |
| `src/components/AvatarBadge.jsx` | NEW — user presence badge | 3 |
| `src/components/CollabBanner.jsx` | NEW — soft lock banner for drawer | 3 |

---

## Cost & Performance Notes

- **Durable Objects pricing**: $0.15/million requests, $12.50/million GB-s duration. At 5-10 users, expect <$1/month.
- **WebSocket messages**: Lightweight JSON, typically <200 bytes each. No bandwidth concern.
- **D1 impact**: `cell_versions` adds ~100-500 bytes per row. Negligible.
- **Polling fallback**: If WebSocket fails, fall back to 5-second polling on `/tables/:tableId/rows`. Already happens via existing refresh timer in PageShell.

---

## Open Questions

1. **Should saves go through the Durable Object or directly to the Worker?** Going through DO adds latency but ensures broadcast ordering. Direct to Worker is faster but requires a separate notification to DO.
2. **Granularity of typing indicator** — field-level ("User B editing Status") or just record-level ("User B editing")?
3. **Conflict resolution for select fields** — if both users change Status, show a dropdown picker? Or just "keep mine / accept theirs"?
4. **Maximum concurrent WebSocket connections per DO** — Cloudflare limits to ~100 concurrent connections per DO instance. More than enough for 5-10 users per table.
