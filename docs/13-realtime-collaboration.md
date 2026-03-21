# Real-Time Collaboration

**Last Updated:** 2026-03-21

## Product Context

Wasabi is a multi-user AI-native workspace. Real-time collaboration is critical: multiple users may view and edit the same table simultaneously, and each user may be active across multiple devices. The system uses two Cloudflare Durable Objects -- TableRoom (per-table) and UserRoom (per-user) -- to provide presence tracking, conflict detection, and cross-device synchronization via WebSockets.

---

## Architecture Overview

```
Browser A                    Browser B
    |                            |
    v                            v
CollaborationContext        CollaborationContext
(src/context/               (src/context/
 CollaborationContext.jsx)    CollaborationContext.jsx)
    |                            |
    v                            v
TableSocket                 TableSocket
(src/lib/tableSocket.js)    (src/lib/tableSocket.js)
    |                            |
    +------------ WS -----------+
                  |
                  v
          TableRoom Durable Object
          (one instance per table_id)
                  |
                  v
              D1 Database
          (cell_versions tracking)


Browser (any device)
    |
    v
UserSyncContext
(src/context/UserSyncContext.jsx)
    |
    v
UserSocket
(src/lib/userSocket.js)
    |
    v
UserRoom Durable Object
(one instance per user_id)
```

---

## TableRoom Durable Object

**Location:** `worker.js` (TableRoom class)
**Identity:** One instance per `tableId`. The DO name is the table ID.

### Purpose

Manages WebSocket connections for all users viewing a single table. Handles presence, typing indicators, focus tracking, and save operations with conflict detection.

### WebSocket Message Types

| Direction | Type | Payload | Purpose |
|-----------|------|---------|---------|
| Client -> Server | `join` | `{userId, userName, role}` | Register user in room |
| Client -> Server | `focus` | `{recordId}` | User opened a record for editing |
| Client -> Server | `blur` | `{}` | User closed the record |
| Client -> Server | `typing` | `{recordId, field}` | User is typing in a field |
| Client -> Server | `stop_typing` | `{}` | User stopped typing |
| Client -> Server | `save` | `{recordId, cells, base_versions}` | Save record with conflict check |
| Server -> Client | `presence` | `{users: [...]}` | Full list of active users |
| Server -> Client | `user_joined` | `{userId, userName, color}` | New user entered the table |
| Server -> Client | `user_left` | `{userId}` | User disconnected |
| Server -> Client | `record_updated` | `{recordId, cells, cell_versions, updatedBy, updatedByName}` | Another user saved a record |
| Server -> Client | `save_result` | `{recordId, accepted, conflicts, cell_versions}` | Result of save operation |

### Presence Tracking

`broadcastPresence()` sends the full list of active users (with userId, userName, color, activeRecordId, isTyping, typingField) to all connected clients whenever users join, leave, focus, or type.

User colors are deterministic -- derived from userId so each user always gets the same color.

### Conflict Detection

`handleSave()` implements optimistic merge using `cell_versions`:

1. Client sends `{recordId, cells, base_versions}` where `base_versions` is the cell version snapshot the user had when they started editing.
2. Server reads current `cell_versions` from D1.
3. For each field the user edited:
   - If `base_versions[field] >= currentVersion[field]`: no conflict. Accept the change, increment version.
   - If `base_versions[field] < currentVersion[field]`: conflict. Another user edited this field after the current user loaded it.
4. Server writes accepted fields to D1 and increments their versions.
5. Server returns `save_result` to the saving client with `accepted` fields and `conflicts` (if any).
6. Server broadcasts `record_updated` to all OTHER clients with the accepted changes.

If the same field was edited by two users, the server does NOT auto-resolve. It returns a conflict message containing both versions:

```
conflicts: {
  "Status": {
    yourValue: "In Progress",
    currentValue: "Done",
    currentVersion: 5
  }
}
```

### ConflictToast Component

**File:** `src/components/ConflictToast.jsx`

When the client receives a `save_result` with conflicts, `ConflictToast` displays a UI showing:
- The field name
- The user's attempted value
- The current server value
- Resolution options: Keep Mine (re-save with incremented version), Accept Theirs (discard user's change)

---

## UserRoom Durable Object

**Location:** `worker.js` (UserRoom class)
**Identity:** One instance per `userId`. The DO name is the user ID.

### Purpose

Cross-device synchronization for a single user. When something changes that affects the user (navigation update, task invalidation, session revocation), UserRoom broadcasts to all of that user's connected devices.

### WebSocket Message Types

| Direction | Type | Payload | Purpose |
|-----------|------|---------|---------|
| Client -> Server | `ping` | `{}` | Keepalive |
| Server -> Client | `pong` | `{}` | Keepalive response |
| Server -> Client | `dashboard_update` | `{...}` | Dashboard data changed |
| Server -> Client | `nav_update` | `{...}` | Navigation/page list changed |
| Server -> Client | `task_cache_invalidate` | `{...}` | Zen tasks cache should be cleared |
| Server -> Client | `session_revoked` | `{sessionId}` | Admin revoked a session |

### HTTP Broadcast Endpoint

UserRoom exposes an HTTP endpoint for server-initiated messages. When the worker needs to notify a user (e.g., session revocation by admin), it sends an HTTP request to the UserRoom DO, which then broadcasts to all of that user's WebSocket connections.

This is used for session revocation: when an admin revokes a session via SystemManager, the worker calls UserRoom's HTTP endpoint, which broadcasts `session_revoked` to the target user's devices. The frontend `UserSyncContext` receives this and forces logout.

---

## Frontend Integration

### CollaborationContext

**File:** `src/context/CollaborationContext.jsx`

Wraps a single table. Subscribes to the TableRoom WebSocket via `TableSocket`. Provides:

- `activeUsers` -- Map of users currently viewing the table
- `pendingConflicts` -- Array of unresolved conflict objects
- `focusRecord(recordId)` / `blurRecord()` -- Track which record the user is editing
- `startTyping(recordId, field)` / `stopTyping()` -- Typing indicators
- `saveRecord(recordId, cells, baseVersions)` -- Save with conflict detection
- `dismissConflict(recordId, field)` -- Clear a resolved conflict
- `onRecordUpdate(callback)` -- Subscribe to other users' saves

### UserSyncContext

**File:** `src/context/UserSyncContext.jsx`

Subscribes to the UserRoom WebSocket via `UserSocket`. Handles cross-device sync messages and session revocation.

### CollabSyncBridge

Located in `PageShell.jsx`. Listens for `record_updated` and `save_result` WebSocket events from the CollaborationContext and triggers data re-fetches with a 300ms debounce. This ensures the table view stays current when other users make changes.

### PresenceAvatars

**File:** `src/components/PresenceAvatars.jsx`

Renders colored avatar circles with initials for all active users in the table header.

---

## WebSocket Authentication

Both TableSocket and UserSocket authenticate via query parameters on the WebSocket upgrade URL:

```
wss://worker-url/ws/table/{tableId}?token={JWT}&key={SECRET}
```

The worker validates the JWT and shared secret before accepting the WebSocket upgrade. Invalid credentials result in a rejected connection.

---

## Auto-Reconnect

Both socket clients implement exponential backoff reconnection:

- Initial delay: 1 second
- Backoff multiplier: 2x
- Maximum delay: 30 seconds
- Idle timeout: 5 minutes of no activity triggers disconnect
- Manual `disconnect()` stops reconnection attempts

On reconnect, the client re-sends a `join` message to restore presence state.

---

## Known Limitations

1. **D1 tables only** -- Collaboration and conflict detection only work with D1-backed tables. Notion-linked databases in proxy mode have no cell versioning.
2. **No three-way merge** -- Conflicts use simple version comparison, not intelligent merging of sub-fields.
3. **No conflict persistence** -- Conflicts are cleared on page reload. No audit trail.
4. **No rollback** -- No way to undo a conflicted save or revert to a previous cell version.
5. **Typing indicator cleanup** -- If a browser crashes, the typing indicator persists until timeout rather than being cleaned up immediately.
6. **Idle disconnect invisible** -- After 5 minutes idle, the connection closes silently. The next edit triggers reconnect.
