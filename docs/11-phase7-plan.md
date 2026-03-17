# Phase 7: Reliability, Navigation, and Multi-User Foundation

> **Status**: Planning complete. Ready for implementation.
> **Created**: 2026-03-16
> **Context**: This plan was developed through a collaborative deep-dive between Graham and Claude, analyzing the full codebase, identifying bugs, and designing fixes. All architectural decisions documented here were explicitly agreed upon.

---

## What is Wasabi

Wasabi is a **meta-platform for building custom AI-powered workspaces**. It pulls data from pre-existing databases (Notion, Google Sheets, Monday.com) or custom D1 databases and presents them through configurable views (Table, Kanban, Calendar, Gantt, Cards, Charts, Form, Document, Summary, Activity). A 41-tool Claude-powered AI agent can query data, build automations, create custom functions/plugins, and manage the workspace. Neurons (a visual knowledge graph) and cell links create connective tissue between data sources. The Knowledge Base gives the agent persistent memory.

**The Context Loop** (core architecture):
1. User connects data sources (Notion DBs, Google, D1 tables)
2. Pages organize those sources with multiple view types
3. The AI agent sees everything — page schema, data summary, KB entries, Neurons, Google context — fused into one system prompt per message
4. The agent builds back into the platform — automations, functions, views, plugins, notifications
5. Neurons and cell links connect otherwise separate data
6. The Knowledge Base shapes future agent responses

A bug in save/sync doesn't just break one view — it breaks the agent's context, automation triggers, Neuron connections, and cross-page links downstream.

---

## Priority Order

1. **Save Reliability** — If the app can't save data, it's non-functional
2. **Notion Auto-Sync** — Core feature, currently manual-only
3. **Navigation Persistence** — The app should feel like a persistent desk
4. **Naming Cleanup** — Remove vestigial zen/sashimi naming
5. **Multi-User Foundation** — Users, auth, roles, permissions, notifications

---

## Sprint 1: Save Reliability

### 1.1 Fix Task Modal Save (SashimiDrawer → RecordDrawer)

**Current bug**: The task editor drawer has two competing notes systems that don't sync. Notion tasks load with `notes: ""` — notes are never read from Notion fields.

**Decision**: Option B — Kill the Notes tab, use only inline notes in `cells.notes`.

**Changes**:
- Remove `TaskNotesTab` component from SashimiDrawer.jsx
- Remove the tab navigation (Details/Notes/Comments → Details/Comments)
- Keep the inline notes textarea in the Details tab as the single source of truth
- For Notion tasks: detect notes/description field in schema mapping (`_fieldMap.notes`), read it on load, write it back on save via `updatePage()`
- Remove `record_notes` table usage from task context (table can remain for other uses)

**Files**: `src/zen/SashimiDrawer.jsx`

### 1.2 Fix Comments Save

**Current bug**: Silent error swallowing in `fetchComments()` — catch block sets comments to `[]` with no logging. Potential `pageConfigId` mismatch (Notion DB ID vs page config ID).

**Changes**:
- Add `console.error` to the catch block in `fetchComments()`
- Add user-facing error state ("Failed to load comments" message in UI)
- Add user-facing error feedback on comment creation failure (not just console.error)
- Audit `pageConfigId` derivation: ensure it resolves to actual page config IDs consistently for both D1 and Notion tasks
- Add error state for delete failures

**Files**: `src/zen/SashimiDrawer.jsx`, potentially `src/lib/api.js`

### 1.3 Fix Drawer ↔ View Sync

**Current bug**: Edits in the drawer don't push back to the view in real-time, and vice versa.

**Changes**:
- When `handleSave()` completes in the drawer, call a callback that triggers view data refetch (not just `onSaved` with stale data — trigger `fetchData()` on the parent view)
- When a row is edited inline in a view while the drawer is open for that same record, update the drawer's local state via `updateDrawerItem()`
- Ensure `onSaved` callback in ZenTasksView triggers both `refreshZen()` and `refreshAI()` with fresh data

**Files**: `src/zen/SashimiDrawer.jsx`, `src/zen/ZenTasksView.jsx`, `src/core/PageShell.jsx`

### 1.4 Harden Optimistic Updates

**Current bug**: `PagesContext.updatePageConfig()` updates React state immediately, D1 save is fire-and-forget with `.catch()` that only logs.

**Changes**:
- Add rollback mechanism: if D1 save fails, revert React state to previous value
- Surface save errors to the user (toast/notification)
- Add `beforeunload` event listener to warn if there are pending saves
- Add save indicator in UI (subtle "Saving..." / "Saved" / "Save failed" status)

**Files**: `src/context/PagesContext.jsx`, `src/config/pageConfig.js`, App.jsx (for save indicator)

---

## Sprint 2: Notion Auto-Sync

### 2.1 Queue-Based D1→Notion Sync

**Decision**: Queue-based approach. Fast edits, 3-second flush interval, max 3 concurrent Notion API calls.

**Architecture**:
```
handleUpdateRow() completes
  → Mark row as dirty: UPDATE table_rows SET sync_dirty = 1 WHERE id = ?
  → Return success to client immediately

Sync flush loop (runs every 3 seconds in worker via Durable Object or alarm):
  → SELECT * FROM table_rows WHERE sync_dirty = 1 LIMIT 10
  → For each dirty row:
    → Check sync_configs for matching table_id
    → If sync config exists and enabled:
      → Push row to Notion (create or update based on metadata.notion_page_id)
      → On success: SET sync_dirty = 0, update metadata.notion_page_id
      → On failure: SET sync_retry_count += 1, log error
  → Max 3 concurrent Notion API calls
```

**Schema changes** (worker.js D1_SCHEMA):
- Add column: `ALTER TABLE table_rows ADD COLUMN sync_dirty INTEGER DEFAULT 0`
- Add column: `ALTER TABLE table_rows ADD COLUMN sync_retry_count INTEGER DEFAULT 0`
- Add index: `CREATE INDEX idx_sync_dirty ON table_rows(sync_dirty) WHERE sync_dirty = 1`

**Worker changes**:
- Modify `handleUpdateRow()`: after successful update, set `sync_dirty = 1`
- Modify `handleCreateRow()`: after successful create, set `sync_dirty = 1`
- Modify `handleDeleteRow()`: if row has `notion_page_id`, archive Notion page
- New endpoint: `POST /sync/flush` — manually trigger flush (for testing/admin)
- Implement flush loop via Cloudflare Alarm or Durable Object (3-second interval)

**Duplicate prevention**:
- Before creating a Notion page, check if `notion_page_id` already exists in metadata
- Use idempotency: store a `sync_batch_id` per flush, skip rows already processed in same batch
- On conflict (row updated while syncing), re-read and re-push

**Files**: `worker.js` (handleUpdateRow, handleCreateRow, new flush logic), D1 schema migration

### 2.2 Notion→D1 Pull Improvements

**Current bug**: Pull creates/updates but doesn't handle Notion deletions. No delta tracking — every pull fetches ALL pages.

**Changes**:
- Add `last_edited_time` tracking per row from Notion's `last_edited_time` property
- On pull, use Notion's `filter` parameter with `last_edited_time > last_synced_at` for incremental sync
- Handle deleted Notion pages: if a D1 row has `notion_page_id` but the Notion page returns 404, mark row as archived
- Add a "Full Resync" option that ignores delta tracking

**Files**: `worker.js` (handleSyncPull)

### 2.3 Event-Driven Automation Triggers

**Decision**: Detect changes at the source (update endpoint), trigger immediately. No polling needed for field/status changes.

**Architecture**:
```
handleUpdateRow() completes successfully
  → Query: SELECT * FROM automation_rules
    WHERE table_id = ? AND trigger_type IN ('field_change', 'status_change') AND enabled = 1
  → For each matching rule:
    → Compare old cells vs new cells to detect which fields changed
    → If trigger condition matches (e.g., status field changed):
      → Fast path: execute template action inline (post_notification, update_field)
      → Slow path: queue agent execution (don't block the response)
  → Return original update response to client
```

**Key detail**: This also applies to rows updated via sync pull (Notion→D1). When `handleSyncPull` updates a row, it must also check automation rules. Data triggers automations regardless of origin.

**Changes**:
- Modify `handleUpdateRow()`: after update, read old cells (already fetched for merge), compare with new, check rules
- Add `checkAutomationTriggers(env, tableId, rowId, oldCells, newCells)` utility function
- Move schedule-based polling to a separate concern (keep for `schedule` trigger type only)
- Fast path actions execute inline; slow path (agent) uses `waitUntil()` to not block response

**Files**: `worker.js` (handleUpdateRow, new automation trigger utility), `src/agent/automations.js` (remove polling for field/status triggers)

### 2.4 Cache dataSummary Per Page

**Decision**: Cache in D1, invalidate on edit.

**Changes**:
- New table: `data_summary_cache (page_id TEXT PRIMARY KEY, summary TEXT, updated_at TEXT)`
- After `handleUpdateRow` / `handleCreateRow` / `handleDeleteRow`: invalidate cache for that table's page
- `GET /pages/:id/summary` endpoint: return cached summary if fresh, rebuild if stale
- Frontend: `WasabiPanel` fetches cached summary instead of rebuilding per chat message

**Files**: `worker.js` (new cache table, invalidation logic), `src/core/WasabiPanel.jsx` (fetch cached summary)

---

## Sprint 3: Navigation Persistence

### 3.1 Persist activePage and Core Navigation State

**Principle**: "Like a desk — you leave and come back, everything is as you left it."

**Persist to localStorage**:
| State | Key | Scope |
|-------|-----|-------|
| `activePage` | `wasabi_active_page` | Survives refresh |
| `activeFolder` | `wasabi_active_folder` | Survives refresh |
| `viewStates` (per-page active view index) | `wasabi_view_states` | Survives refresh |
| `expandedNodes` (sidebar tree) | `wasabi_expanded_nodes` | Survives refresh |
| `wasabiPanelOpen` (chat panel state) | `wasabi_panel_open` | Survives refresh |
| `wasabiPanelWidth` | `wasabi_panel_width` | Survives refresh |
| ZenWorkspaces `path` (drill-down) | `wasabi_workspace_path` | Survives refresh |
| Chat panel active tab (Zen/Wasabi) | `wasabi_chat_tab` | Survives refresh |

**Implementation**: Each piece of state gets a `useEffect` that writes to localStorage on change, and initializes from localStorage on mount.

**Files**: `src/context/NavigationContext.jsx`, `src/App.jsx`, `src/zen/ZenWorkspaces.jsx`, `src/zen/SashimiChatPanel.jsx`

### 3.2 Preserve Chat History Within Session

**Decision**: Chat survives navigation (not across browser sessions).

**Changes**:
- Lift `zenMessages` and `zenHistoryRef` out of SashimiChatPanel into a context or App-level state
- Lift `chatMessages` and `chatHistoryRef` out of WasabiPanel similarly
- Both persist as long as the browser tab is open, regardless of which page is active
- On page navigation, the Wasabi tab updates its page context but keeps conversation history

**Files**: `src/zen/SashimiChatPanel.jsx`, `src/core/WasabiPanel.jsx`, potentially new `ChatContext.jsx`

### 3.3 Fix Breadcrumb Navigation

**Root cause**: Two independent navigation systems — `Breadcrumb.jsx` calls `setActivePage("zen-workspaces")` for folder clicks, but `ZenWorkspaces.jsx` has its own local `path` state that doesn't update.

**Fix**: When navigating to a folder via breadcrumb, compute and pass the target path.

**Option chosen**: Have ZenWorkspaces listen to a navigation signal and reconstruct its `path` accordingly.

**Implementation**:
- Add `targetFolderPath` to NavigationContext (or a new nav signal)
- When Breadcrumb clicks a folder segment: set `activePage` to workspaces view AND set `targetFolderPath` to the computed path array from root to that folder
- ZenWorkspaces on mount/update: if `targetFolderPath` is set, apply it to local `path` state, then clear the signal
- When clicking a page segment in breadcrumb: navigate directly to that page (existing behavior, works)
- Persist `path` to localStorage (Sprint 3.1) so it also survives refresh

**Files**: `src/components/Breadcrumb.jsx`, `src/zen/ZenWorkspaces.jsx`, `src/context/NavigationContext.jsx`

### 3.4 Fix "Return to Workspace" Navigation

**Bug**: User is deep in a page, clicks Workspaces in sidebar, ends up at root instead of the folder containing the page they just left.

**Fix**: When user clicks "Workspaces" nav item while viewing a page:
- Look up the current page's `parentId` chain
- Compute the folder path
- Set `path` state in ZenWorkspaces to show that folder's contents
- User sees the folder that contained the page they were just viewing

**Files**: `src/core/Navigation.jsx`, `src/zen/ZenWorkspaces.jsx`

---

## Sprint 4: Naming Cleanup

### 4.1 Rename Strategy

All renames use **functional names**. No cascading failures because all references are hardcoded string literals (confirmed by audit — no dynamic string construction).

**Component Renames**:
| Old Name | New Name | File Rename |
|----------|----------|-------------|
| `SashimiDrawer` | `RecordDrawer` | `SashimiDrawer.jsx` → `RecordDrawer.jsx` |
| `SashimiDrawerContext` | `RecordDrawerContext` | `SashimiDrawerContext.jsx` → `RecordDrawerContext.jsx` |
| `useSashimiDrawer` | `useRecordDrawer` | (same file as context) |
| `SashimiChatPanel` | `ChatPanel` | `SashimiChatPanel.jsx` → `ChatPanel.jsx` |
| `ZenTasksView` | `TasksView` | `ZenTasksView.jsx` → `TasksView.jsx` |
| `ZenWorkspaces` | `WorkspaceBrowser` | `ZenWorkspaces.jsx` → `WorkspaceBrowser.jsx` |
| `ZenDashboard` | `DashboardView` | `ZenDashboard.jsx` → `DashboardView.jsx` |
| `ZenNotes` | `NotesView` | `ZenNotes.jsx` → `NotesView.jsx` |
| `ZenGmail` | `GmailView` | `ZenGmail.jsx` → `GmailView.jsx` |
| `ZenKnowledgeHub` | `KnowledgeHub` | `ZenKnowledgeHub.jsx` → `KnowledgeHub.jsx` |
| `ZenCalendar` | `CalendarView` | `ZenCalendar.jsx` → `CalendarView.jsx` |
| `useZenTasks` | `useTasksTable` | `useZenTasks.js` → `useTasksTable.js` |
| `useZenInsight` | `useInsight` | `useZenInsight.js` → `useInsight.js` |
| `zenTaskHelpers` | `taskHelpers` | `zenTaskHelpers.js` → `taskHelpers.js` |

**Route Identifier Renames** (string literals in App.jsx, Navigation.jsx, Breadcrumb.jsx, etc.):
| Old ID | New ID |
|--------|--------|
| `"zen-workspaces"` | `"workspaces"` |
| `"zen-dashboard"` | `"dashboard"` |
| `"zen-tasks"` (or `null`) | `null` (keep as default) |
| `"zen-notes"` | `"notes"` |
| `"zen-gmail"` | `"gmail"` |
| `"zen-knowledge"` | `"knowledge"` |
| `"zen-notifications"` | `"notifications"` |

**localStorage Key Renames**:
| Old Key | New Key |
|---------|---------|
| `"wasabi-zen-dashboard-widgets"` | `"wasabi-dashboard-widgets"` |
| `"wasabi_zen_table_id"` | `"wasabi_tasks_table_id"` |
| `"wasabi_zen_insight"` | `"wasabi_insight"` |
| `"wasabi-zen-hidden-calendars"` | `"wasabi-hidden-calendars"` |
| `"wasabi_zen_ai_tasks_v4"` | `"wasabi_ai_tasks_v4"` |

**Property Renames**:
| Old | New |
|-----|-----|
| `_zenInternal` | `_systemInternal` |

**Internal tab identifier** (SashimiChatPanel → ChatPanel):
| Old | New |
|-----|-----|
| `activeTab === "zen"` | `activeTab === "assistant"` |
| `activeTab === "wasabi"` | `activeTab === "agent"` |

**Migration**: Add a one-time migration function that reads old localStorage keys and copies values to new keys, then deletes old keys. Run on app init.

**Directory**: Keep `src/zen/` directory name or rename to `src/views/` — **decision needed** (suggest keeping `src/zen/` for now to avoid import path churn, rename in a later cleanup).

### 4.2 ThemeContext Cleanup

- Remove `appMode` constant entirely (currently hardcoded to `"zen"`)
- Remove no-op `setAppMode()` function
- Remove any context export of `appMode`, `setAppMode`, `toggleAppMode`
- Any consumer that destructures `appMode` gets cleaned up (confirmed: zero consumers currently)

**Files**: `src/context/ThemeContext.jsx`

---

## Sprint 5: Multi-User Foundation

### 5.1 Users Table and Auth

**Schema** (D1):
```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',  -- 'admin', 'editor', 'viewer'
  invite_code TEXT UNIQUE,
  password_hash TEXT,  -- for future email+password auth
  created_at TEXT DEFAULT (datetime('now')),
  last_login_at TEXT
);
```

**Auth flow** (Invite Code):
1. Admin creates invite via `POST /users/invite` → generates one-time code + assigns role
2. New user visits app → sees login screen → enters invite code + chooses display name
3. Worker validates code → creates user record → returns JWT session token
4. Frontend stores JWT in localStorage, sends as `Authorization: Bearer <token>` on all requests
5. Worker validates JWT on every request (replaces X-Wasabi-Key for user-scoped requests)
6. X-Wasabi-Key remains as the **worker-level secret** (protects the worker itself); JWT is the **user-level token**

**Admin bootstrap**: First user to set up the worker is automatically Admin. Or: Admin account created during `handleInit()` with a configurable password.

**Session**: JWT with 7-day expiry. Refresh on activity. Stored in localStorage.

**Files**: `worker.js` (new users table, auth endpoints, JWT middleware), `src/context/AuthContext.jsx` (JWT storage, login state), new `src/core/LoginScreen.jsx`

### 5.2 Role-Based Access Control

**Roles**:
| Permission | Admin | Editor | Viewer |
|------------|-------|--------|--------|
| View all data | Yes | Yes | Yes |
| Edit unlocked tables | Yes | Yes | No |
| Edit locked tables | Yes | With PIN | No |
| Create pages/workspaces | Yes | Yes | No |
| Create Neurons | Yes | Yes | No |
| Delete Neurons | Yes | No | No |
| Wasabi agent (full) | Yes | No | No |
| Zen assistant (limited) | Yes | Yes | Yes* |
| Create/edit automations | Yes | No | No |
| Edit Knowledge Base | Yes | No | No |
| Manage users/invites | Yes | No | No |
| View notifications | Own + All | Own | Own |

*Viewer Zen chat: read-only tools only (search, list). No create/update/delete.

**Implementation**:
- Worker middleware: extract `user_id` and `role` from JWT on every request
- Check role against required permission for each endpoint
- Frontend: hide UI elements based on role (e.g., hide Wasabi tab toggle for non-Admin)
- Chat panel: Admin sees both tabs. Editor/Viewer sees only Assistant tab. Wasabi flame button hidden or shows Assistant-only panel.

**Files**: `worker.js` (role checking middleware), `src/context/AuthContext.jsx` (role state), UI components (conditional rendering)

### 5.3 Table PIN Lock

**Schema** (D1):
```sql
ALTER TABLE page_configs ADD COLUMN pin_protected INTEGER DEFAULT 0;
```

**Global PIN**: Stored in `connections` table as key `"table_pin"` (hashed).

**Flow**:
1. Admin enables protection on a table via page settings → sets `pin_protected = 1`
2. Admin sets global PIN in System Settings (stored hashed in D1)
3. Editor opens protected table → sees data read-only with lock icon overlay
4. Editor clicks "Unlock for Editing" → PIN prompt modal
5. Correct PIN → unlock state stored in React state (NOT localStorage — ephemeral by design)
6. Unlock expires on: navigate away from page, browser close, or 30-minute timeout (whichever first)
7. Timer tracked via `setTimeout` in component, cleared on unmount

**Files**: `worker.js` (PIN storage/validation endpoint), new `src/components/PinLockOverlay.jsx`, `src/core/PageShell.jsx` (lock state management)

### 5.4 Per-User Notifications

**Schema change**:
```sql
ALTER TABLE notifications ADD COLUMN target_user_id TEXT DEFAULT 'all';
```

**Routing**:
- `target_user_id = 'all'` → everyone sees it
- `target_user_id = '<specific_user_id>'` → only that user sees it
- Admin always sees all notifications regardless of target
- `post_notification` tool gains optional `target_user` parameter
- Automations specify target: explicit user ID, `"owner"` (task/item owner), or `"all"`

**Item ownership**: Add `owner_user_id` to `table_rows` for tracking who created/owns a record. Automations can use this for implicit targeting ("notify the owner").

**Files**: `worker.js` (notification filtering by user), `src/views/NotificationFeed.jsx` (filter by current user), `src/agent/tools.js` (update post_notification tool)

### 5.5 Google OAuth Per-User

**Current**: One set of Google tokens stored globally in `connections` table.

**Change**: Each user can optionally connect their own Google account.

**Schema**:
```sql
CREATE TABLE IF NOT EXISTS user_connections (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,  -- 'google'
  value TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);
```

**Flow**: When a user connects Google, tokens stored under their `user_id`. Gmail/Calendar endpoints use the requesting user's tokens. Users who haven't connected Google don't see Gmail nav item.

**Files**: `worker.js` (user-scoped connection storage, OAuth callback with user context)

---

## Implementation Notes

### Order of Operations
Each sprint builds on the previous. Do not start Sprint 2 before Sprint 1 is solid — unreliable saves make auto-sync dangerous (it would sync broken data to Notion).

### Testing Strategy
- Sprint 1: Manual testing of each save path (D1 task, Notion task, comments). Verify data persists across refresh.
- Sprint 2: Test sync with a real Notion database. Verify no duplicates on rapid edits. Test automation triggers with a simple rule.
- Sprint 3: Refresh the browser at every navigation state. Verify all state restores. Test breadcrumb clicks at every hierarchy level.
- Sprint 4: Global search-and-replace with build verification. Run the app end-to-end after all renames.
- Sprint 5: Create test accounts with each role. Verify permission boundaries. Test PIN lock/unlock cycle.

### Migration Considerations
- localStorage key renames (Sprint 4) need a migration function
- D1 schema changes (Sprints 2, 5) need migration endpoints or versioned init
- Existing single-user data needs to be assigned to the Admin user (Sprint 5)

### Files Most Affected (Across All Sprints)
| File | Sprints | Changes |
|------|---------|---------|
| `worker.js` | 1, 2, 3, 5 | Save fixes, sync queue, automation triggers, auth, users, PIN, notifications |
| `src/zen/SashimiDrawer.jsx` | 1, 4 | Notes consolidation, comments fix, rename to RecordDrawer |
| `src/App.jsx` | 1, 3, 4 | Save indicator, navigation persistence, route renames |
| `src/context/NavigationContext.jsx` | 3 | Persist state, breadcrumb signal |
| `src/zen/ZenWorkspaces.jsx` | 3, 4 | Path persistence, breadcrumb fix, rename |
| `src/context/PagesContext.jsx` | 1 | Rollback mechanism, error surfacing |
| `src/core/WasabiPanel.jsx` | 2, 3 | Cached dataSummary, chat history lift |
| `src/zen/SashimiChatPanel.jsx` | 3, 4 | Chat persistence, rename |
| `src/context/AuthContext.jsx` | 5 | JWT auth, role state, login flow |
| `src/core/Navigation.jsx` | 3, 4 | Return-to-workspace fix, route renames |
| `src/components/Breadcrumb.jsx` | 3, 4 | Navigation fix, route renames |
