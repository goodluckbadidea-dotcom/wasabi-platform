# Real-Time Collaboration

**Last Updated:** 2026-03-31

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
- Dismiss requires confirmation via ConfirmDialog to prevent accidentally discarding unresolved conflicts

After conflict resolution via "Keep Mine", the response's updated `cell_versions` are captured and written back to `cellVersionsRef` to prevent stale versions on rapid sequential conflicts.

**Design tokens:** ConflictToast uses design system tokens (`C`, `RADIUS`, `SHADOW`, `FONT`) for all styling. ARIA attributes (`role="alert"`, `aria-live="assertive"`) are present for accessibility. Z-index uses `Z.toast` (9000).

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
| Server -> Client | `task_cache_invalidate` | `{...}` | User tasks cache should be cleared |
| Server -> Client | `notification_new` | `{notificationId}` | New notification created for this user |
| Server -> Client | `session_revoked` | `{sessionId}` | Admin revoked a session |

### HTTP Broadcast Endpoint

UserRoom exposes an HTTP endpoint for server-initiated messages. When the worker needs to notify a user (e.g., session revocation by admin), it sends an HTTP request to the UserRoom DO, which then broadcasts to all of that user's WebSocket connections.

This is used for:
- **Session revocation:** When an admin revokes a session via SystemManager, the worker calls UserRoom's HTTP endpoint, which broadcasts `session_revoked` to the target user's devices. The frontend `UserSyncContext` receives this and forces logout.
- **Instant notification push:** When `createNotificationInternal()` inserts a targeted notification (comment, @mention), it sends a `notification_new` message to the target user's UserRoom. Navigation.jsx subscribes via `UserSyncContext.onNotificationNew()` and immediately increments the sidebar badge count.

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

**Important:** Remote `record_updated` events are debounced at 300ms in CollaborationContext to prevent render thrashing when multiple users edit simultaneously. Without this debounce, rapid incoming updates can cause the view to "bounce" between states as each update triggers a re-render before the previous one settles.

### PresenceAvatars

**File:** `src/components/PresenceAvatars.jsx`

Renders colored avatar circles with initials for all active users in the table header. Uses design system tokens for all styling (no hardcoded colors or radii). Includes `title` attributes on each avatar for accessibility.

### RecordDetail Collaboration Banner

**File:** `src/views/RecordDetail.jsx`

When other users are focused on the same record, RecordDetail shows a collaboration banner below the header. The banner displays collaborator names and which specific fields are being edited (e.g., "Graham editing Status") rather than just an anonymous count. Uses design system gradient styling with `C.accent`.

**collabRef pattern:** RecordDetail uses a `collabRef` (useRef tracking the collab context) for its focus/blur and typing effects. The effect dependency arrays reference `page?.id` and `editingField` but NOT `collab` — this prevents a feedback loop where every presence update from the WebSocket would re-fire `focusRecord`/`blurRecord`, causing layout strobing when 2+ users view the same record. The banner and per-field typing indicators still read from `collab` directly for reactive re-renders.

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

### Reconnect Resilience (2026-03-24 fixes)

- **TableSocket** guards against double-connect: if a connection is already `OPEN` or `CONNECTING`, `connect()` is a no-op.
- **CollaborationContext** re-sends `focus` and `typing` state after reconnect so presence is restored without user action.
- **Tab deduplication:** `UserSyncContext` tracks the active browser tab via `localStorage` key `wasabi_user_ws_active_tab`. Only the active tab maintains the UserRoom WebSocket connection. On `visibilitychange`, the becoming-visible tab takes ownership and reconnects; the hidden tab disconnects. This prevents duplicate presence from multiple tabs.
- **Typing TTL:** Typing indicators auto-expire after 8 seconds of no `typing` message, preventing ghost indicators from crashed browsers.

---

## Known Limitations

1. **D1 tables only** -- Collaboration and conflict detection only work with D1-backed tables. Notion-linked databases in proxy mode have no cell versioning.
2. **No three-way merge** -- Conflicts use simple version comparison, not intelligent merging of sub-fields.
3. **No conflict persistence** -- Conflicts are cleared on page reload. No audit trail.
4. **No rollback** -- No way to undo a conflicted save or revert to a previous cell version.
5. **Typing indicator cleanup** -- Typing indicators now auto-expire after 8 seconds (TTL guard). If a browser crashes, the indicator clears within 8s rather than persisting indefinitely.
6. **Idle disconnect invisible** -- After 5 minutes idle, the connection closes silently. The next edit triggers reconnect.
7. **Table inline editing** -- Table view cells are read-only; all editing happens through RecordDrawer/RecordDetail. Inline edit presence indicators are not wired up in Table view.

---

## Changelog (2026-03-24 Session)

Comprehensive collaboration audit — 18 fixes across 4 phases:

**Phase A — Critical bugs (6 fixes):**
- TableSocket double-connect guard (OPEN/CONNECTING check)
- CollaborationContext `activeUsers` converted from object to reactive Map for proper re-renders
- Conflict detection `detectedAt` timestamp added for accurate auto-dismiss timing
- ConflictToast auto-dismiss timer uses per-conflict `detectedAt` instead of mount time
- `onRecordUpdate` callback ref made stable to prevent stale closure bugs
- CollabSyncBridge debounce timer cleanup on unmount (memory leak fix)

**Phase B — High severity (3 fixes):**
- Presence state (focus/typing) re-sent after WebSocket reconnect
- Typing indicator 8-second TTL guard against ghost indicators
- UserSyncContext tab deduplication via localStorage active-tab tracking

**Phase C — Design system (17 token fixes):**
- ConflictToast: all hardcoded colors/radii replaced with `C`, `RADIUS`, `SHADOW`, `FONT` tokens
- PresenceAvatars: hardcoded values replaced with design tokens
- CollaborationContext: logging border color uses `C.accent`
- ConflictToast: ARIA attributes added (`role="alert"`, `aria-live="assertive"`)
- PresenceAvatars: `title` attributes added for accessibility
- Both components: `animation` property uses `ANIM` tokens

**Phase D — UX polish (3 fixes):**
- Conflict "Keep Mine" resolution captures response `cell_versions` into `cellVersionsRef`
- Conflict dismiss requires ConfirmDialog instead of silent discard
- RecordDetail collaboration banner shows specific field names being edited

## Changelog (2026-03-31 Session)

**Collaboration UI fixes (2 fixes):**
- RecordDetail banner now shows collaborator names (e.g., "Graham editing Status") instead of anonymous count ("1 collaborator viewing")
- Fixed layout strobe/jumping when 2+ users view the same record. Root cause: `collab` in effect dependency arrays caused a blur/focus feedback loop between users. Fix: `collabRef` pattern — effects use a ref for stable action access, dependency arrays exclude `collab`

## Changelog (2026-04-01 Session)

**Cross-user task cache invalidation (1 fix):**
- `handleUpdateRow()` in worker.js now broadcasts `task_cache_invalidate` to ALL UserRoom DOs when `owner_user_id` changes (task reassignment), not just when status/done fields change. Previously, assigning a task to another user only invalidated the saving user's task cache — the assignee's cache stayed stale for up to 2 hours.
