# Real-time Collaboration System

## Overview

Wasabi implements **real-time presence and conflict detection** for multiple users editing the same table simultaneously. This is powered by:

1. **WebSocket connections** via Cloudflare Durable Objects (TableRoom)
2. **Cell versioning** for conflict detection (stored in D1)
3. **Presence tracking** (which users are viewing which records)
4. **Conflict resolution UI** (ConflictToast component)

---

## Architecture

### Components

```
PageShell
  └── CollaborationProvider (wraps table)
      ├── TableSocket (WebSocket client)
      ├── useCollaboration() hook
      └── ViewRenderer
          └── TableView / KanbanView / etc.
```

### Server-Side: TableRoom Durable Object

**File:** `worker.js` lines 8884+

Manages WebSocket connections for a single table. One TableRoom instance per table (DO identity = tableId).

#### Responsibilities

1. Accept WebSocket upgrade requests
2. Authenticate users (JWT validation)
3. Broadcast presence (who's viewing, typing)
4. Handle record saves with conflict detection
5. Track cell versions for optimistic concurrency control

#### WebSocket Lifecycle

```
Client connects to /ws/table/{tableId}
  → Request validated (JWT checked)
  → WebSocketPair created
  → Server-side WebSocket accepted via Hibernation API
  → Client receives 101 Upgrade response

Client sends "join" message
  → Session attached to WebSocket (userId, userName, role, etc.)
  → "user_joined" broadcast to all other clients
  → "presence" sent back listing all active users

... (messages exchanged) ...

Client disconnects or closes
  → "user_left" broadcast to all other clients
  → Session cleaned up
```

---

## What IS Implemented

### 1. Presence Tracking

Users viewing the same table see each other's names and colors.

**State in CollaborationContext:**
```javascript
activeUsers: Map<userId, {
  userId: string,
  userName: string,
  color: string,  // deterministic color per user
  activeRecordId?: string,  // which record they're editing
  isTyping: boolean,
  typingField?: string,
}>
```

**Component:** `PresenceAvatars.jsx`

Displays avatars of active users in the header:

```javascript
// Shows colored avatars with initials
<PresenceAvatars users={activeUsers} />
```

### 2. Typing Indicators

Users see real-time typing status in table cells.

**Flow:**

```
User focuses input → startTyping(recordId, field)
  → TableSocket.send({ type: "typing", recordId, field })
  → TableRoom broadcasts to all clients
  → Other users see "..." in the cell or typing color overlay
  → User exits field → stopTyping()
  → Broadcast "user_stop_typing"
```

### 3. Record Focus Tracking

Shows which record each user is currently editing.

**Messages:**
- `focus` - { recordId }
- `blur` - {}

**Display:** Avatar highlights or sidebar shows "User X is editing Record Y"

### 4. Cell Versioning & Conflict Detection

**Only works for D1-backed tables.** When user saves, TableRoom checks versions.

**Cell Version Storage (D1):**

```sql
CREATE TABLE table_rows (
  id TEXT,
  table_id TEXT,
  cells TEXT,  -- JSON of all cell values
  cell_versions TEXT,  -- JSON: { fieldName: version }
  updated_by TEXT,
  updated_at DATETIME,
  PRIMARY KEY (id, table_id)
)
```

**Conflict Detection Algorithm (in TableRoom.handleSave):**

```javascript
for (field, value) in user_cells:
  currentVersion = cell_versions[field] || 0
  baseVersion = base_versions[field]  // version user started with

  if baseVersion === undefined OR baseVersion >= currentVersion:
    // No conflict: cell hasn't changed since user started editing
    accepted[field] = value
    newVersions[field] = currentVersion + 1
  else:
    // Conflict: cell version is stale
    // User's base version < current version
    // Someone else edited this cell
    conflicts[field] = {
      yourValue: value,
      currentValue: currentCells[field],
      currentVersion: currentVersion,
    }
```

**Conflict Response to Client:**

```javascript
{
  type: "save_result",
  recordId: string,
  accepted: { field: value, ... },  // Fields that were saved
  conflicts: {
    field: { yourValue, currentValue, currentVersion }
  },
  cell_versions: { field: newVersion, ... },
}
```

### 5. Live Record Updates

When one user saves, all other clients receive the updated cells.

**Message from TableRoom to all other clients:**

```javascript
{
  type: "record_updated",
  recordId: string,
  cells: { field: value, ... },  // Only accepted changes
  cell_versions: { field: version, ... },
  updatedBy: userId,
  updatedByName: userName,
}
```

**Component Handling:** Tables subscribe to `onRecordUpdate()` callback and refetch affected rows.

### 6. Conflict Toast UI

**Component:** `ConflictToast.jsx`

Displays conflicts to user with resolution options:

```
┌─────────────────────────────────────┐
│ Conflict in "Status" field          │
│                                     │
│ Your version:   "In Progress"       │
│ Current version: "Done"             │
│                                     │
│ [Keep Mine] [Accept Theirs] [Merge]│
└─────────────────────────────────────┘
```

**Actions:**
- **Keep Mine** - User's value wins (re-save after incrementing version)
- **Accept Theirs** - Current server value wins (discard user's change)
- **Merge** (if applicable) - Fuzzy merge or manual edit

---

## What is NOT Implemented

### 1. ❌ Notion-Linked Database Support

Collaboration **only works with D1-backed tables**. Notion-linked databases:
- Don't track cell versions
- Lack conflict detection
- Have no real-time sync from Wasabi back to Notion

**Reason:** Notion API doesn't support version tracking. All Notion data flows through async sync, not real-time.

### 2. ❌ Three-Way Merge

Conflicts are resolved with simple version comparison. No intelligent three-way merge.

**Current:** Last-write-wins after base version check
**Missing:** Merging when both users edited different sub-fields

### 3. ❌ Rollback Mechanism

No way to undo a conflicted save or revert to previous version.

### 4. ❌ Conflict Persistence

Conflicts cleared on page reload. No history of conflicts.

### 5. ❌ Automatic Conflict Resolution

User must manually choose which version to keep. No AI merge.

### 6. ❌ Multi-Table Transactions

Saves are per-record, per-field. No transactions across records or tables.

---

## Implementation Details

### CollaborationContext (src/context/CollaborationContext.jsx)

Wraps a single table and provides collaboration state/actions.

**Constructor:**
```javascript
<CollaborationProvider tableId={tableId} userId={userId} userName={userName} role={role}>
  <TableView />
</CollaborationProvider>
```

**Provides:**
```javascript
{
  activeUsers,       // Map<userId, user>
  pendingConflicts,  // Array of conflict objects
  focusRecord,       // (recordId) => void
  blurRecord,        // () => void
  startTyping,       // (recordId, field) => void
  stopTyping,        // () => void
  saveRecord,        // (recordId, cells, baseVersions) => Promise
  dismissConflict,   // (recordId, field) => void
  onRecordUpdate,    // (callback) => unsubscribe
}
```

### TableSocket (src/lib/tableSocket.js)

WebSocket client for table collaboration.

**Connection:**
```javascript
const socket = new TableSocket(tableId, userId, userName, role);
socket.connect();
```

**Send Message:**
```javascript
socket.send(type, data);
// Internally: ws.send(JSON.stringify({ type, ...data }))
```

**Subscribe to Messages:**
```javascript
const unsub = socket.onMessage((msg) => {
  switch(msg.type) {
    case "presence": handlePresence(msg); break;
    case "user_joined": handleJoin(msg); break;
    case "record_updated": handleRecordUpdate(msg); break;
    case "conflict": handleConflict(msg); break;
  }
});
```

**Auto-Reconnect:**
- Exponential backoff: 1s, 2s, 4s, ... up to 30s
- Max 5 minute idle timeout (auto-disconnect if no activity)
- Manual `disconnect()` stops reconnection attempts

### Cell Version Tracking

In views, when user loads a record, fetch current cell versions as "base":

```javascript
const record = await fetchRecord(tableId, recordId);
const baseVersions = record.cell_versions;

// User edits fields...

// On save:
saveRecord(recordId, cells, baseVersions);
```

The TableRoom DO compares:
- `baseVersions[field]` (what user started with)
- Current `cell_versions[field]` in D1

---

## Usage Examples

### In a Table View

```javascript
import { CollaborationProvider, useCollaboration } from "../context/CollaborationContext.jsx";

function TableView({ tableId, userId, userName, role }) {
  return (
    <CollaborationProvider tableId={tableId} userId={userId} userName={userName} role={role}>
      <TableContent />
    </CollaborationProvider>
  );
}

function TableContent() {
  const { activeUsers, pendingConflicts, saveRecord, onRecordUpdate } = useCollaboration();

  // Show presence
  return (
    <div>
      <PresenceAvatars users={activeUsers} />
      {/* ... table rows ... */}
      {pendingConflicts.map(c => <ConflictToast key={`${c.recordId}-${c.field}`} conflict={c} />)}
    </div>
  );
}
```

### Handling Saves

```javascript
async function handleCellSave(recordId, field, value) {
  const record = records.find(r => r.id === recordId);
  const baseVersions = record.cell_versions;

  try {
    const result = await saveRecord(recordId, { [field]: value }, baseVersions);

    if (result.conflicts) {
      // ConflictToast will show conflicts from pendingConflicts state
      // User clicks "Keep Mine", "Accept Theirs", etc.
    } else {
      // Save successful, cells updated
      showToast("Saved");
    }
  } catch (err) {
    showError(`Save failed: ${err.message}`);
  }
}
```

---

## Known Issues & Limitations

### 1. Notion-Linked Databases Don't Support Collaboration
- No conflict detection
- No real-time updates from Wasabi → Notion
- All data flows through async sync only

### 2. No Merge Strategy for Multiple Conflicts
- If user edits 5 fields and 3 have conflicts, all 3 must be manually resolved
- No "merge and save" option that intelligently combines both versions

### 3. Conflicts Not Persisted
- Reload page → conflicts gone
- No audit trail of who changed what

### 4. Cell Version Overflow
- No rotation/cleanup of version numbers
- Over time, versions become large integers
- Could theoretically overflow (but unlikely in practice)

### 5. Typing Indicators Lost on Disconnect
- If user's browser crashes, typing indicator stays until timeout
- No graceful cleanup on network failure

### 6. Idle Timeout Disconnect
- After 5 minutes of inactivity, connection closes
- User doesn't see indicator they're disconnected
- Next edit triggers reconnect

---

## Future Improvements

### 1. Notion Sync Bi-Directional
- Sync Wasabi saves back to Notion in real-time
- Then enable conflict detection for Notion-linked DBs

### 2. Operational Transformation (OT)
- Replace simple versioning with OT
- Allow true concurrent editing without conflicts

### 3. Three-Way Merge
- Implement smart merge when both users edited
- Show side-by-side diff editor

### 4. Undo/Rollback
- Add version history per cell
- Allow reverting to any past version

### 5. Conflict History
- Log all conflicts with timestamps
- Show audit trail: "User A" vs "User B" in field X

