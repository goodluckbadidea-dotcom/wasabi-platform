# State Management & Data Flow

## Product Context

Wasabi is an AI-native workspace built as a React 18 SPA. State management uses the React Context API exclusively — no Redux, Zustand, or other external state libraries. There are 11 context providers in `src/context/`, plus RecordDrawerContext in `src/features/`.

---

## Context Providers

All 11 providers live in `src/context/`. They are nested in App.jsx in a specific order (see 07-architecture-routing.md for the full wrapping hierarchy).

### 1. ThemeContext

**File:** `src/context/ThemeContext.jsx`

Manages the active theme and exposes mutable design token objects.

**Key state:**
- `themeName` — one of: "shoji", "obsidian", "hinoki", "kori", "sumi"
- `C` — color token object (mutated in place when theme changes)
- `SHADOW` — shadow token object (mutated in place when theme changes)

**Key methods:**
- `applyTheme(name)` — switches theme, updates C and SHADOW objects, persists to localStorage

**localStorage:** reads/writes `wasabi_theme`

---

### 2. ViewportContext

**File:** `src/context/ViewportContext.jsx`

Tracks viewport dimensions and device characteristics using `matchMedia` listeners (not resize events).

**Key state:**
- `isNarrow` — viewport width < BP.mobile (768px)
- `isTablet` — viewport width < BP.tablet (1194px)
- `isTouch` — device supports touch input
- `width` — current viewport width in pixels

No localStorage usage. Values update reactively via matchMedia change listeners.

---

### 3. PlatformContext

**File:** `src/context/PlatformContext.jsx`

Composition layer that wraps AuthProvider → **AuthGate** → PagesProvider → NavigationProvider internally, then merges their exports into a single `usePlatform()` hook for backward compatibility.

**Internal provider chain:**
```
AuthProvider → AuthGate → PagesProvider → NavigationProvider → {children}
```

The `AuthGate` component ensures PagesProvider and NavigationProvider never mount before authentication is confirmed. It renders LoginScreen for unauthenticated states and only passes through `{children}` when `isAuthenticated === true`.

**Key state (merged from sub-providers):**
- `workerConnection` — { workerUrl, secret } for the Cloudflare Worker
- `pages` — full page config array
- `activePage` — current route identifier
- Feature flags and connection status

**Key methods:**
- All CRUD operations from PagesProvider
- All auth operations from AuthProvider
- All navigation operations from NavigationProvider

**Important:** `usePlatform()` can only be called from components that render BELOW AuthGate (i.e., after authentication). Components rendered BY AuthGate (like LoginScreen) must use `useAuth()` directly.

---

### 4. ToastContext

**File:** `src/context/ToastContext.jsx`

Provides toast notification display for both component and non-component code.

**Key methods:**
- `showToast(message, type)` — displays a toast notification (type: "success", "error", "warning", "info")
- `globalToast()` — module-level function that can be called from non-component code (e.g., api.js error handlers) without needing React context access

---

### 5. AuthContext

**File:** `src/context/AuthContext.jsx`

Handles authentication, worker connection, and multi-user identity.

**Key state:**
- `identity` — `{ id, display_name, role }` or null when not logged in
- `multiUserEnabled` — boolean, whether workspace has multiple users
- `workerConnection` — `{ workerUrl, secret }`
- `isSetup` — boolean, whether initial setup is complete
- `isAuthenticated` — boolean
- `identityLoading` — boolean, true during bootstrap

**Bootstrap state machine:** `idle → booting → ready | error`
1. `idle` — initial state on mount
2. `booting` — calls `initDatabase()` (10s timeout) to run D1 schema migrations and detect multi-user mode; if multi-user, validates existing JWT via `authMe()` (10s timeout)
3. `ready` — bootstrap complete, auth state resolved
4. `error` — boot failed (e.g., worker unreachable), `bootError` message set

The `/init` endpoint uses a **schema version fast path** (see worker.js `CURRENT_SCHEMA_VERSION`). Returning users hit 2-3 queries instead of the full migration path. First boot or version bumps run batched DDL via `env.DB.batch()`.

**Auth gate location:** The `AuthGate` component in `PlatformContext.jsx` (not AppContent) checks `isSetup`, `identityLoading`, `isAuthenticated`, and `bootError` to decide whether to render `LoginScreen` or `{children}`. PagesProvider and NavigationProvider only mount after AuthGate passes.

**LoginScreen hook:** LoginScreen uses `useAuth()` directly (not `usePlatform()`), because it renders inside AuthGate above PagesProvider/NavigationProvider.

**Key methods:**
- `login(displayName, password)` — authenticates, receives JWT
- `register(displayName, password, inviteCode)` — creates account with invite code
- `logout()` — clears identity, revokes session
- `hasRole(requiredRole)` — checks if current identity meets minimum role

---

### 6. PagesContext

**File:** `src/context/PagesContext.jsx`

Manages the array of page configurations and provides CRUD operations.

**Key state:**
- `pages` — array of all PageConfig objects
- `pagesLoaded` — boolean, `true` after D1 sync completes (not just localStorage cache). Used by `useTasksTable` to avoid running against stale data.
- `activePage` — currently selected page ID or system route string
- `pageTree` — nested hierarchy computed from pages
- `folders` — computed list of folder-type pages
- `saveStatus` — "idle" | "saving" | "saved" | "error"

**Key methods:**
- `addPage(config)` — creates a new page, persists to D1, shows toast on success/error
- `updatePageConfig(id, updates)` — partial update, persists to D1
- `removePage(id)` — deletes page from D1
- `getFolderPages(folderId)` — returns child pages of a folder

Save operations display toast feedback via ToastContext (success/error messages).

---

### 7. NavigationContext

**File:** `src/context/NavigationContext.jsx`

Manages current navigation state: which page is active, which folder is selected, and sidebar UI state.

**Key state:**
- `activePage` — current page ID or system route string
- `activeFolder` — current folder ID
- `sidebarCollapsed` — boolean
- `searchQuery` — sidebar search text
- `expandedNodes` — Set of expanded folder node IDs
- `pendingRecordId` — record ID to auto-open after navigation (used by notification click-through; cleared after use by PageShell)

**Key methods:**
- `setActivePage(id)` — navigate to a page or system route
- `setActiveFolder(id)` — select folder context
- `setPendingRecordId(id)` — set a record to open after next page navigation (used by NotificationFeed)
- `clearPendingRecordId()` — clear after PageShell consumes it
- `toggleSidebar()` — collapse/expand sidebar
- `toggleExpand(nodeId)` — expand/collapse a folder in the sidebar tree

**localStorage:** reads/writes `wasabi_sidebar_collapsed`, `wasabi_active_page`

---

### 8. CollaborationContext

**File:** `src/context/CollaborationContext.jsx`

Manages real-time collaboration via WebSocket connection to a TableRoom Durable Object.

**Key state:**
- `activeUsers` — reactive `Map` of users currently viewing the same table (converted from plain object for proper React re-renders)
- `pendingConflicts` — array of field-level conflicts detected during save, each with a `detectedAt` timestamp for accurate auto-dismiss timing
- `cellVersionsRef` — ref tracking per-field version numbers for conflict detection base versions

**Key methods:**
- `focusRecord(recordId)` — broadcast that user is viewing a record
- `blurRecord()` — stop broadcasting focus
- `startTyping(recordId, field)` / `stopTyping()` — typing indicators with 8-second TTL auto-expiry
- `saveRecord(recordId, cells, baseVersions)` — save with conflict detection
- `onRecordUpdate(callback)` — subscribe to remote record changes (stable ref, no stale closures)
- `dismissConflict(recordId, field)` — clear a resolved conflict (requires ConfirmDialog confirmation)

**WebSocket messages handled:**
- `record_updated` — another user saved a record; triggers data refresh (300ms debounce)
- `save_result` — response to a save attempt (success or conflict); captures updated `cell_versions`
- `presence` — active users list update
- `user_joined` / `user_left` — presence changes

**Reconnect behavior:** After WebSocket reconnect, CollaborationContext automatically re-sends `focus` and `typing` state so presence is restored without user action. TableSocket guards against double-connect (OPEN/CONNECTING check).

Connection is per-table: `wss://{worker}/ws/table/{tableId}?token={jwt}`

---

### 9. UserSyncContext

**File:** `src/context/UserSyncContext.jsx`

Cross-device synchronization via WebSocket connection to a UserRoom Durable Object.

**Key state/methods:**
- `sendDashboardUpdate(widgets)` — broadcast dashboard changes to other devices
- `sendNavUpdate(pageId, folderId)` — broadcast navigation to other devices
- `onDashboardUpdate(callback)` — listen for dashboard changes from other devices
- `onNavUpdate(callback)` — listen for navigation changes from other devices
- `onSessionRevoked(callback)` — listen for session revocation (logout from another device)
- `onTaskCacheInvalidate(callback)` — listen for task cache invalidation
- `onNotificationNew(callback)` — listen for new notification push (instant badge update)

**session_revoked handling:** When the UserRoom broadcasts a `session_revoked` message (triggered when an admin revokes a session or the user logs out on another device), the callback clears local identity and redirects to the login screen.

**notification_new handling:** When the worker creates a targeted notification (comment, mention, etc.), it sends a POST to the target user's UserRoom DO, which broadcasts to all connected sockets. Navigation.jsx subscribes and immediately increments the unread badge count.

**Tab deduplication:** Only the active browser tab maintains the UserRoom WebSocket connection. Tracked via `localStorage` key `wasabi_user_ws_active_tab` with a unique tab ID. On `visibilitychange`, the becoming-visible tab takes ownership and reconnects; hidden tabs disconnect. This prevents duplicate presence entries from multiple open tabs.

Connection is per-user: `wss://{worker}/ws/user/{userId}?token={jwt}`

---

### 10. ColorMappingContext

**File:** `src/context/ColorMappingContext.jsx`

Manages per-column color assignments for select and status fields in table views.

**Key state:**
- `globalColorField` — which column drives row coloring
- `globalColorMapping` — `{ [optionValue]: colorHex }` map

**Key methods:**
- `setGlobalColorField(fieldName)` — set which column drives colors
- `setGlobalColorMapping(mapping)` — update the value-to-color map

---

### 11. LinksContext

**File:** `src/context/LinksContext.jsx`

Manages cell_links between tables — cross-page references that connect records or fields across different pages.

**Key methods:**
- `createLink(source, target)` — create a cross-page cell link
- `removeLink(linkId)` — delete a link
- `fetchSourceData(sourceRef, sourcePageConfigId)` — fetch data for a source ref with TTL caching. Supports three source types: D1 (via `getTableSchema` + `listRows`), Notion (via `queryAll`), and sheets (via `fetchSheetData`).
- `resolveLinksForView(targetPageConfigId, targetViewIdx)` — resolve all linked values for a target view. Returns a Map of cell keys to resolved values.

Links are stored in the `cell_links` D1 table and cached locally. Value resolution is delegated to `resolveRef()` in `src/config/linkStorage.js`, which handles D1 (`record_id` + `column_name`), Notion (`pageId` + `field`), and sheet (`rowIndex` + `column`) ref types.

---

## RecordDrawerContext (src/features/)

**File:** `src/features/RecordDrawerContext.jsx`

Not in `src/context/` — lives in `src/features/` because it is tightly coupled to the RecordDrawer component.

**Key state:**
- `recordId` — currently open record ID (null when closed)
- `pageId` — page containing the open record

**Key callbacks:**
- `notifySaved(recordId, updatedCells)` — called by RecordDrawer after a successful save; consumed by PageShell to refresh view data without full reload
- `notifyDeleted(recordId)` — called by RecordDrawer after a record is deleted; consumed by PageShell to remove the record from the view

These callbacks are the primary mechanism for drawer-to-view data synchronization.

---

## JWT Lifecycle

Wasabi uses a refresh token pattern with JWT. The access token is stored **in memory only** (the `_jwtInMemory` variable in `src/lib/api.js`), never in localStorage.

### Token Flow

```
1. User logs in (login endpoint)
   → Worker returns:
     - Access token (JWT, 15-min expiry) in response body
     - Refresh token (7-day expiry) as HttpOnly cookie

2. Access token stored in memory (_jwtInMemory in api.js)
   → Attached to every API request via Authorization header

3. Before each request, apiFetch() checks token expiry
   → If < 2 minutes remaining: triggers auto-refresh
   → Calls /auth/refresh endpoint (sends HttpOnly cookie)
   → Receives new access token in response body
   → Updates _jwtInMemory

4. If request returns 401:
   → apiFetch() attempts one refresh retry
   → Calls /auth/refresh endpoint
   → If refresh succeeds: retries original request with new token
   → If refresh fails: clears identity, redirects to login
```

### What Is NOT in localStorage

JWT tokens are never stored in localStorage. The `_jwtInMemory` variable in api.js is the sole location for the access token. The refresh token exists only as an HttpOnly cookie (not accessible to JavaScript).

---

## WebSocket Data Flow

### TableRoom (Per-Table Collaboration)

```
CollaborationContext connects to TableRoom DO
  → wss://{worker}/ws/table/{tableId}?token={jwt}
  → Sends: join, focus, blur, typing, stop_typing, save
  → Receives: presence, user_joined, user_left, record_updated, save_result, conflict
```

Used for: real-time presence, typing indicators, field-level conflict detection, live record updates.

### UserRoom (Per-User Cross-Device)

```
UserSyncContext connects to UserRoom DO
  → wss://{worker}/ws/user/{userId}?token={jwt}
  → Sends: dashboard_update, nav_update, task_cache_invalidate
  → Receives: devices, dashboard_update, nav_update, session_revoked, task_cache_invalidate, notification_new
```

Used for: syncing navigation across devices, broadcasting session revocation, instant notification badge updates.

### Instant Notification Push

```
User A @mentions User B in a comment or note
  → Worker inserts notification into D1
  → Worker sends POST to User B's UserRoom DO /broadcast endpoint
  → UserRoom broadcasts { type: "notification_new" } to all of User B's WebSocket connections
  → User B's Navigation.jsx receives event via UserSyncContext.onNotificationNew
  → Sidebar badge increments immediately (no polling delay)
```

The notification badge in Navigation.jsx also polls `getUnreadNotificationCount()` every 60 seconds as a fallback.

---

## localStorage Keys

Only these keys are used in the current implementation:

| Key | Purpose |
|-----|---------|
| `wasabi_connection` | Worker URL + secret |
| `wasabi_sidebar_collapsed` | Sidebar collapsed/expanded state |
| `wasabi_panel_open` | WasabiPanel (chat) open/closed state |
| `wasabi_active_page` | Last active page ID |
| `wasabi_theme` | Theme name |

**JWT is NOT in localStorage.** The access token lives in memory (`_jwtInMemory` in api.js). The refresh token is an HttpOnly cookie.

---

## Standard Data Flow Patterns

### User Action → API → Re-render

```
User action (click, type, etc.)
  → React component handler
  → apiFetch() [src/lib/api.js] with JWT in Authorization header
  → Cloudflare Worker endpoint [worker.js]
  → D1/R2 query
  → JSON response
  → Context state update (setState)
  → React re-render
```

### Real-Time Collaboration

```
User A saves record
  → CollaborationContext.saveRecord() sends via WebSocket
  → Worker writes to D1, checks cell_versions for conflicts
  → Worker broadcasts record_updated via TableRoom DO
  → User B's CollaborationContext receives update
  → onRecordUpdate callback fires
  → View re-renders with new data
```

### Cross-Device Navigation Sync

```
Device A: user navigates to page
  → UserSyncContext.sendNavUpdate(pageId, folderId)
  → Worker broadcasts via UserRoom DO
  → Device B receives nav_update
  → onNavUpdate callback fires
  → NavigationContext.setActivePage(pageId)
```

### AI Task Curation (Stale-While-Revalidate)

```
TasksView mounts
  → useAICuratedTasks hook initializes (cache key v11)
  → Mount effect: getStaleCache() → show data instantly (any age)
  → Auto-scan effect: getCached(key, 30min TTL) OR cacheDirty flag
    → If fresh + not dirty: skip scan
    → If stale or dirty: background scan (refreshing indicator, not spinner)
      → Find DBs (max 25) → fetch top-level rows (max 1000/DB, sub-items excluded)
      → Sort client-side by updated_at DESC
      → Single listNotifications → mentionedRecordIds Set
      → Single listTaskInteractions per source (combined map)
      → Set cheap flags (owner/assigned/mention) → apply role pre-filter
      → Filter snoozed tasks
      → [Non-viewers] record views, neuron, interaction-history enrichment
      → Claude Haiku ranks (interaction-aware prompt)
      → Whitespace-normalized title matching back to task objects
      → mergeInteractionAdjustments post-Claude → cache → display
```

**Call budget: ~16 calls per scan regardless of task count.** Per-task comment
fan-out replaced by single notifications query; duplicate interaction fetch
consolidated; viewers skip all enrichment (can't call Claude, fall through to
date-sort).

### AI Task Interaction Flow

```
User interacts with task (view, edit, comment, status change)
  → recordInteraction(taskId, type, detail)
    → 1. persistInteraction(userId) → user-scoped localStorage ledger (with time decay)
    → 2. logTaskInteraction() → D1 fire-and-forget (for Claude's next scan)
    → 3. setAiTasks() → immediate local re-sort with accumulated adjustment
    → 4. Update localStorage cache → reloads see adjustments
  → On next scan: mergeInteractionAdjustments(tasks, userId) applies ledger to fresh results
  → Claude sees: formulaSuggestion ("deprioritize 60%"), interactionBreakdown ("3 views today")
```

### AI Task Snooze Flow

```
User clicks Snooze button in RecordDrawer
  → snooze(taskId, until, reason)
    → POST /task-snoozes → D1 upsert (cross-device)
    → setAiTasks: remove from active list
    → setSnoozedTasks: add with snooze metadata
  → Snoozed section in TaskList shows collapsed list
  → Un-snooze: DELETE /task-snoozes/:id → markDirty() → rescan
  → Expired snoozes: automatically excluded on next scan (WHERE snooze_until > now)
```
