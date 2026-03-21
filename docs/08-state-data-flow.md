# State Management & Data Flow

## Overview

Wasabi uses **React Context API** for state management, structured into focused contexts that handle specific domains:

- **AuthContext** - User identity, credentials, worker connection
- **PagesContext** - Page configs, hierarchy, batch operations
- **NavigationContext** - Current page/folder selection
- **ThemeContext** - Theme (light/dark)
- **UserSyncContext** - Multi-device synchronization
- **ColorMappingContext** - Global row color mappings
- **CollaborationContext** - Real-time presence, typing, conflicts
- **LinksContext** - Neuron relationships
- **RecordDrawerContext** - Record detail drawer state

This doc describes each context's state shape, functions, and typical data flow patterns.

---

## Context Specifications

### AuthContext

**File:** `src/context/AuthContext.jsx`

#### State Shape

```javascript
{
  // Credentials
  user: {
    workerUrl: string,
    notionKey?: string,
    claudeKey?: string,
    mondayKey?: string,
  },

  // Connection
  workerConnection: {
    workerUrl: string,
    secret?: string,
  },

  // Setup & Auth Gates
  isAuthenticated: boolean,
  isSetup: boolean,
  isLoading: boolean,
  setupError: string | null,

  // Multi-user Identity
  identity: {
    id: string,
    display_name: string,
    role: "admin" | "editor" | "viewer",
  } | null,
  multiUserEnabled: boolean,
  identityLoading: boolean,
  adminInvite: string | null,

  // Platform IDs
  platformIds: {
    databaseId?: string,
    tableId?: string,
  },
}
```

#### Key Functions

```javascript
setUserKeys(keys)
updateConnectionKey(key, value) → Promise
getConnections() → { connections }
completeSetup()
initDatabase() → { multi_user?, admin_invite? }
login(email, password) → { user }
register(email, password, inviteCode) → { user }
logout()
hasRole(requiredRole)
```

#### Initialization Flow

1. Load from localStorage: `wasabi_user_keys`, `wasabi_connection`, `wasabi_platform_ids`
2. On workerConnection available: call `initDatabase()` + validate JWT
3. Persist changes to localStorage + D1

#### Known Issues

- **Race condition:** hasBootstrapped ref prevents re-init if workerConnection changes mid-flight
- **JWT storage:** Tokens in plaintext localStorage (XSS vulnerability)
- **No expiration check:** JWT validated only on load, not before use

---

### PagesContext

**File:** `src/context/PagesContext.jsx`

#### State Shape

```javascript
{
  pages: [
    {
      id: string,
      name: string,
      type: "page" | "folder",
      page_type: "database" | "document" | "linked_notion" | "linked_monday" | "worksheet" | "dashboard" | "workspace",
      databaseIds?: string[],
      views?: [
        {
          id?: string,
          label: string,
          type: "table" | "kanban" | "calendar" | "grid" | "document" | "gallery" | "timeline",
          config: { /* view-specific */ },
        },
      ],
      widgets?: [ /* dashboard widgets */ ],
    },
  ],

  pageTree: [ /* nested hierarchy */ ],
  folders: [ /* all folder pages */ ],
  globalDashboard: pageConfig | null,

  batchQueue: [
    {
      id: string,
      operation: "create" | "update" | "delete" | "move",
      pageId: string,
      timestamp: number,
      status: "pending" | "done" | "failed",
    },
  ],

  saveStatus: "idle" | "saving" | "saved" | "error",
}
```

#### Key Functions

```javascript
addPage(config) → Promise
updatePageConfig(id, updates) → Promise
removePage(id) → Promise
getFolderPages(folderId) → [pageConfig]
addToQueue(op), updateQueueItem(id, changes), removeQueueItem(id)
```

#### Initialization Flow

1. Load from localStorage: `wasabi_page_configs`
2. Sync from D1 (once): validate Notion page IDs, remove stale configs
3. Auto-create "My Workspace" if none exist
4. Auto-create global Dashboard if none exist

#### Known Issues

- **No validation:** Invalid view types silently ignored
- **Stale references:** Deleted Notion DBs remain until manual sync
- **Batch queue:** Unclear if undo is actually implemented

---

### NavigationContext

**File:** `src/context/NavigationContext.jsx`

#### State Shape

```javascript
{
  activePage: string | null,
  activeFolder: string | null,
  expandedNodes: Set<string>,
}
```

#### Key Functions

```javascript
setActivePage(id) → void
setActiveFolder(id) → void
toggleExpand(nodeId) → void
```

---

### ThemeContext

**File:** `src/context/ThemeContext.jsx`

#### State Shape

```javascript
{
  theme: { /* all design tokens from tokens.js */ },
  themeName: "light" | "dark",
  toggleTheme(): void,
}
```

Loads from localStorage: `wasabi_theme`. Updates CSS custom properties on change.

---

### UserSyncContext

**File:** `src/context/UserSyncContext.jsx`

Multi-device synchronization via WebSocket user room.

#### State Shape

```javascript
{
  onNavUpdate: (callback: (pageId, folderId) => void) => () => void,
  sendNavUpdate: (pageId, folderId) => void,
  onSessionRevoked: (callback: () => void) => () => void,
}
```

#### Data Flow

**Navigation Sync:**
```
Device A: setActivePage(id)
  → sendNavUpdate(id, folderId)
  → worker broadcasts to UserRoom
  → Device B receives and calls onNavUpdate callback
  → Device B: setActivePage(id)
```

---

### ColorMappingContext

**File:** `src/context/ColorMappingContext.jsx`

#### State Shape

```javascript
{
  globalColorField: string,
  globalColorMapping: { [value: string]: colorHex },
  setGlobalColorField: (fieldName) => void,
  setGlobalColorMapping: (mapping) => void,
}
```

---

### CollaborationContext

**File:** `src/context/CollaborationContext.jsx`

Real-time presence, typing, and conflict detection via WebSocket (TableSocket).

#### State Shape

```javascript
{
  activeUsers: Map<userId, {
    userId: string,
    userName: string,
    color: string,
    activeRecordId?: string,
    isTyping: boolean,
    typingField?: string,
  }>,

  pendingConflicts: [
    {
      recordId: string,
      field: string,
      yourValue: any,
      theirValue: any,
      detectedAt: timestamp,
    },
  ],

  focusRecord: (recordId) => void,
  blurRecord: () => void,
  startTyping: (recordId, field) => void,
  stopTyping: () => void,
  saveRecord: (recordId, cells, baseVersions) => void,
  dismissConflict: (recordId, field) => void,
  onRecordUpdate: (callback) => unsubscribe,
}
```

#### Connection Flow

```javascript
new TableSocket(tableId, userId, userName, role)
  → WebSocket connect to worker /ws/table/{tableId}
  → Send "join" message
  → Receive "presence" with active users
```

#### Conflict Detection Algorithm

```javascript
for (field, value) in user_cells:
  currentVersion = cell_versions[field] || 0
  baseVersion = base_versions[field]

  if baseVersion === undefined OR baseVersion >= currentVersion:
    // Accept change
    accepted[field] = value
    newVersions[field] = currentVersion + 1
  else:
    // Conflict detected
    conflicts[field] = {
      yourValue: value,
      theirValue: currentCells[field],
      currentVersion: currentVersion,
    }
```

#### Known Issues

- **Only works with D1 tables:** Notion-linked DBs don't support conflict detection
- **No three-way merge:** Simple last-write-wins after version check
- **Doesn't work with Notion-linked databases**

---

### LinksContext

**File:** `src/context/LinksContext.jsx`

Manages Neuron relationships between records and pages.

---

### RecordDrawerContext

**File:** `src/zen/RecordDrawerContext.jsx`

Manages detail drawer for editing record.

#### State Shape

```javascript
{
  recordId: string | null,
  pageId: string | null,
  open: (recordId, pageId) => void,
  close: () => void,
}
```

---

## Custom Hooks

### useRecordDetail

**File:** `src/hooks/useRecordDetail.js`

Fetches single record by ID.

```javascript
const {
  record,
  schema,
  loading,
  error,
  updateCell,
} = useRecordDetail(tableId, recordId)
```

### useViewPrefs

**File:** `src/hooks/useViewPrefs.js`

Stores view preferences in localStorage.

### useTasksTable, useAICuratedTasks, useDismissedTasks, useInsight

**Files:** `src/zen/useTasksTable.js`, etc.

Specialized hooks for TasksView data.

---

## Data Source Abstraction Layer

**File:** `src/lib/dataSource.js`

Normalizes data from D1, Notion, Monday into common format.

#### Source Detection

```javascript
resolveSourceType(pageConfig) → "d1" | "notion" | "monday" | "linked_sheet" | "document"
```

#### Output Format (All Sources)

```javascript
{
  data: [
    {
      id: string,
      properties: { [fieldName]: { type, ...value } },
      created_time: ISO8601,
      last_edited_time: ISO8601,
      _databaseId?: string,
    },
  ],
  schema: { /* detected schema */ },
  schemas: { [dbId]: schema },
}
```

---

## WebSocket Connections

### TableSocket (tableSocket.js)

Real-time collaboration for single table.

**URL:** `wss://{worker}/ws/table/{tableId}?token={jwt}`

**Messages:**
- Client → Server: `join`, `focus`, `blur`, `typing`, `stop_typing`, `save`
- Server → Client: `presence`, `user_joined`, `user_left`, `record_updated`, `conflict`, `save_result`

### UserSocket (userSocket.js)

Multi-device synchronization.

**URL:** `wss://{worker}/ws/user/{userId}?token={jwt}`

**Messages:**
- Client → Server: `nav_update`
- Server → Client: `nav_update`, `session_revoked`

---

## localStorage Keys

| Key | Purpose |
|-----|---------|
| `wasabi_user_keys` | Credentials |
| `wasabi_connection` | Worker URL + secret |
| `wasabi_platform_ids` | Workspace IDs |
| `wasabi_page_configs` | Cached page list |
| `wasabi_jwt` | Auth token (multi-user) |
| `wasabi_sidebar_collapsed` | Sidebar state |
| `wasabi_panel_open` | Chat panel state |
| `wasabi_view_states` | View selection per page |
| `wasabi_theme` | Theme preference |

---

## Known Issues & Gaps

### 1. Race Condition in AuthContext Bootstrap
- If `workerConnection` changes while `initDatabase()` in flight, state consistency broken
- **Impact:** Multi-device switching may leave identity unvalidated

### 2. JWT Stored in Plain localStorage
- No expiration check before use
- Vulnerable to XSS attacks
- **Impact:** Token theft possible if XSS vulnerability exists

### 3. Unhandled Promise Rejections
- Many `.catch(() => {})` silence errors without logging
- No error propagation to UI
- **Impact:** Silent failures, difficult debugging

### 4. No Concurrent Fetch Cancellation
- If user navigates away while fetch in flight, setState on unmounted component
- No AbortController cleanup
- **Impact:** Memory leaks, console warnings

### 5. Conflict Detection Only in D1
- Notion-linked databases don't support conflict detection
- **Impact:** Lost updates if multiple users edit Notion-linked DB simultaneously

### 6. Notion Data Always Read from D1
- Frontend never directly queries Notion API
- All reads go through D1 (via worker)
- **Impact:** Limits real-time sync frequency, stale data possible
