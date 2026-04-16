# Security Posture & Known Issues

**Last Updated:** 2026-04-07

## Product Context

Wasabi is a self-hosted, multi-user AI-native workspace running on Cloudflare's edge infrastructure (Workers, D1, R2, Durable Objects). This document describes the security measures currently implemented, the architecture decisions behind them, and the known remaining issues.

---

## Section 1: Current Security Posture

The following security features are implemented and active in production.

| Feature | Implementation | Location |
|---------|---------------|----------|
| Password hashing | PBKDF2, 100k iterations, 16-byte salt | `worker.js` hashPassword/verifyPassword |
| JWT auth | 15-min access token (memory) + 7-day refresh (HttpOnly cookie) | `worker.js` signJwt, `src/lib/api.js` apiFetch auto-refresh |
| CORS | Origin whitelist via `CORS_ORIGINS` env var | `worker.js` getCorsHeaders() |
| Rate limiting | D1-backed, 5 failed auth attempts / 15 min per IP | `worker.js` checkRateLimit() |
| XSS prevention | JSON.stringify code injection, escapeHtml in iframeHelpers | `src/core/PluginWidget.jsx`, `src/lib/iframeHelpers.js` |
| Code sandbox | 5s timeout guard + infinite loop blocklist | `src/agent/toolExecutor.js` TIMEOUT_GUARD |
| Session management | active_sessions table, revocation, WebSocket broadcast | `worker.js`, UserRoom Durable Object |
| Role enforcement | getFreshRole() queries DB, not stale JWT claim | `worker.js` notification handlers |
| Per-user data scoping | Ownership verification on user tasks, server-side comment user_id | `src/features/useTasksTable.js`, `worker.js` |
| Notification scoping | All users (including admins) see only notifications targeted at them — no admin bypass | `worker.js` GET /notifications, `NotificationFeed.jsx` |
| Mention dedup guard | Duplicate @mention notifications for same record/target/actor skipped within 5 minutes | `worker.js` handleCreateComment, handleSaveNote |
| Input validation | Password policy (8+ chars, upper+lower+digit), invite expiration | `worker.js` registration handler |
| Plugin validation | Blocklist: eval, import, require, window, document, etc. | `worker.js` validatePluginCodeServer |
| Z-index isolation | Centralized Z scale prevents layer conflicts | `src/design/tokens.js` Z object |
| ARIA accessibility | role="dialog", aria-modal, aria-labelledby on dialogs; role="alert", aria-live on toasts | ConfirmDialog, NewRecordModal, ConflictToast, etc. |
| Tab deduplication | Only active browser tab maintains UserRoom WebSocket; prevents duplicate presence | `UserSyncContext.jsx` via localStorage active-tab tracking |
| Typing TTL guard | Typing indicators auto-expire after 8s to prevent ghost state from crashed browsers | `CollaborationContext.jsx` |
| Notion JWT auth | All Notion API calls routed through JWT-authenticated `apiFetch()`. Worker `getNotionKey()` validates key prefix (`ntn_`/`secret_`) before accepting. Raw fetch with Notion key as Bearer removed from 31 files. | `src/notion/client.js`, `worker.js` getNotionKey() |
| D1 credential encryption | All API keys and OAuth tokens in D1 (`connections` + `user_connections`) encrypted at rest using AES-256-GCM. DEK derived via HKDF from `WASABI_SECRET` with fixed salt `"wasabi-dek-v1"`. Ciphertext format: `enc:v1:{base64url-iv}:{base64url-ciphertext}`. Legacy plaintext values auto-migrated on next read/write (zero-downtime). Non-secret keys (schema_version, table_pin, external_api_whitelist, external_api:*) are not encrypted. | `worker/crypto.js` encryptSecret/decryptSecret, `worker/handlers/connections.js`, `worker/handlers/notion-sync.js`, `worker/automation/engine.js`, `worker/handlers/google.js` |
| Microsoft OAuth security | Popup postMessage payload XSS-hardened: `JSON.stringify(payload).replace(/</g, "\\u003c")`. OAuth state includes HMAC nonce encoded as btoa(JSON.stringify({ mode, userId, nonce })). Auth-exempt path uses `startsWith` not exact match to handle query strings. | `worker/handlers/microsoft.js` |
| Figma API proxy | Figma API key stored encrypted in D1 (same AES-256-GCM pattern). All Figma API calls proxied through worker with `X-FIGMA-TOKEN` header — key never exposed to frontend. Team ID stored unencrypted (non-secret config). | `worker/handlers/figma.js`, `worker/handlers/connections.js` NON_SECRET_KEYS |
| WCAG AA contrast | All 5 themes pass 4.5:1+ for muted text on all surfaces; surface/border/text token gaps widened | `src/design/tokens.js` |

---

## Section 2: Security Architecture

### External API Credential Isolation

All external API calls (Notion, Google, Claude) are proxied through the Cloudflare Worker. API keys and OAuth tokens are stored as Worker environment variables or in D1 -- they are never exposed to the frontend client. The browser never makes direct requests to Notion, Google, or Claude APIs.

### JWT Storage

The access token (15-minute TTL) is stored **in JavaScript memory only** -- not in localStorage, not in sessionStorage. This means it is cleared on page refresh and cannot be accessed by XSS attacks targeting storage APIs.

The refresh token (7-day TTL) is stored as an **HttpOnly cookie**. HttpOnly cookies cannot be read by JavaScript (`document.cookie` does not include them). The refresh token is only sent to the worker's `/auth/refresh` endpoint.

### Token Refresh Flow

`apiFetch()` in `src/lib/api.js` intercepts 401 responses. When the access token expires:

1. `apiFetch` calls `/auth/refresh` with the HttpOnly cookie.
2. Worker validates the refresh token, checks it against `active_sessions`, and issues a new access token.
3. The new access token is stored in memory and the original request is retried.
4. If the refresh token is also expired or revoked, the user is logged out.

### Rate Limiting

Rate limiting is **D1-backed**, not in-memory. This means rate limit state persists across worker restarts and across Cloudflare edge locations. The current policy: 5 failed authentication attempts per IP address within a 15-minute window triggers a lockout.

### Session Revocation

Sessions are tracked in the `active_sessions` D1 table. When an admin revokes a session via SystemManager:

1. The session record is deleted from D1.
2. The worker sends a message to the target user's UserRoom Durable Object.
3. UserRoom broadcasts `session_revoked` to all of the user's connected WebSocket clients.
4. The frontend `UserSyncContext` receives the message and forces immediate logout.

### Role Enforcement

The worker does not trust the role claim in the JWT. Instead, `getFreshRole()` queries the `users` table in D1 on every request that requires role verification. This prevents privilege escalation via stale JWT claims if an admin downgrades a user's role.

### Plugin Sandboxing

Custom plugin code runs inside a sandboxed iframe with `allow-scripts` but without `allow-same-origin`. Additional protections:

- **Server-side validation** (`validatePluginCodeServer` in `worker.js`): blocks code containing `eval`, `Function`, `import`, `require`, `window`, `document`, `fetch`, `XMLHttpRequest`, and other dangerous APIs.
- **Client-side injection** (`PluginWidget.jsx`): code is serialized via `JSON.stringify` before injection into the iframe srcdoc, preventing template literal breakout.
- **Timeout guard** (`toolExecutor.js`): 5-second execution deadline. Infinite loop patterns (e.g., `while(true)`, `for(;;)`) are detected and blocked before execution.

---

## Section 3: Known Remaining Issues

### Secure Cookie on localhost

The refresh token cookie is set with the `Secure` flag, which requires HTTPS. This means refresh tokens do not work on `http://localhost` during local development. To test the full auth flow locally, use HTTPS (e.g., via `mkcert`) or deploy to a Cloudflare Workers preview environment.

### ARIA Coverage Gaps

Dialogs and modals have ARIA attributes (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`). However, not all interactive components have complete ARIA coverage. Some custom dropdowns, inline editors, and view-specific controls lack `aria-label` or keyboard navigation support.

### Auth Bootstrap Race Condition

The initial auth check on page load uses a boot state machine (`idle → booting → ready | error`) to prevent duplicate init attempts. However, there is no `AbortController` to cancel in-flight requests if the component unmounts during the bootstrap sequence. In practice this is benign (the request completes or fails silently), but it is technically a race condition.

### Auth Gate Architecture

The auth gate lives in `PlatformContext.jsx` as the `AuthGate` component, positioned between `AuthProvider` and `PagesProvider`/`NavigationProvider`. This ensures data-fetching providers never mount before authentication completes. Components rendered by AuthGate (currently only `LoginScreen`) must use `useAuth()` directly — they **cannot** use `usePlatform()`, `usePages()`, or `useNavigation()` because those providers are not mounted yet. If new pre-auth components are added in the future, they must follow this same constraint.

### Bare Catch Blocks

Approximately 134 bare `catch` blocks remain in the codebase. The majority are intentional -- guarding `localStorage` access, `JSON.parse` calls, and optional feature detection where the failure mode is "do nothing." Roughly 10 API-level catch blocks that previously swallowed errors have been fixed to surface error state to the user.

### Sub-Item Data Path Fixes (Resolved 2026-03-25, updated 2026-03-31)

A series of fixes addressed data-path mismatches in the sub-item system:

1. **Ghost row schema** — Ghost row used parent schema for title validation and type lookup. Fixed to use sub-item schema (`subColumns`).
2. **Creation write path** — `createRecord()` mapped sub-column names incorrectly into the `cells` object and used the wrong schema. Fixed to map sub-column names to cells and use sub-item column definitions.
3. **Read path** — `d1RowToPage()` did not map sub-column cells into properties. Fixed to iterate sub-columns and produce Notion-compatible property objects.
4. **Title type mismatch** — Sub-columns created before the `type: "title"` enforcement fix stored the first column with `type: "text"` instead of `type: "title"`. `d1SchemaToClassified` treated `idx === 0` as title regardless of stored type, but `d1RowToPage` used the raw column type. Fixed by making `d1RowToPage` mirror the same title detection logic as `d1SchemaToClassified`.
5. **Write path title type** — `extractRawValue()` used the raw column type to determine how to read the value. Fixed to use the classified title type so writes go through the correct extraction path.
6. **Record detail** — Sub-item records incorrectly showed the "Sub-Items" tab (sub-items cannot have sub-items). Fixed to hide the tab and show `parentTitle` in the header.
7. **RecordDetail sub-item title display (2026-03-31)** — `RecordSubItems` in the detail drawer read cell values by `schema?.title?.name` (column name, e.g. `"Task"`), but D1 cells are keyed by `col.id` (e.g. `"subcol_1743..."`). All sub-items fell back to showing the raw UUID prefix. Fixed to resolve the title column ID from `schema._subColumns` and look up `cells[titleColId]`, matching the write path in `createRecord()`.

### Editable Column Headers — Double-Click Delay

Both parent and sub-item column headers use a 250ms `setTimeout` to disambiguate single-click (context menu) from double-click (inline rename). This introduces a perceptible delay on single-click but enables one-click access to Rename, Manage Options, Change Type, and Delete. Sub-item headers use the same pattern as of 2026-04-14 — previously they only responded to double-click and right-click, creating a discoverability gap.

### Conflict Detection Scope

Real-time conflict detection only works for D1-backed tables. Notion-linked databases in proxy mode have no cell versioning and no conflict detection. Multiple users editing the same Notion-linked data in Wasabi can produce lost updates.

### Duplicate User Tasks Table Creation (Resolved 2026-03-31)

`useTasksTable.js` had a race condition that created a new "User Tasks" table on every login. The ownership check ran against the stale localStorage page cache before D1 sync completed, causing false "stale table" detection. When verification failed, the hook destructively nulled out the saved `zen_tasks_table_id` and provisioned a new table. Additionally, `handlePutUserState` in worker.js had an INSERT path that clobbered `zen_tasks_table_id` with null on unrelated field writes.

Fixes:
1. PagesContext exposes `pagesLoaded` flag (true after D1 sync). `useTasksTable` gates on it.
2. Removed the destructive null-out — hook now trusts the saved ID from user_state.
3. Worker `handlePutUserState` uses INSERT OR IGNORE + conditional UPDATE instead of a single INSERT...ON CONFLICT that clobbered unset fields.
4. D1 cleanup: deleted 347 duplicate page_configs and orphaned rows.

### File Upload Bug in RecordDetail (Resolved 2026-03-31)

`handleListFiles` in worker.js queried `FROM rows` (table does not exist — should be `FROM table_rows`) and used the column name `page_config_id` (should be `table_id`). This caused a SQL error and "Failed to load files" on every Files tab open for record-scoped file listings. Fixed to use the correct table and column names.

### Notes Feature Removal (2026-03-31)

The Notes tab was removed from RecordDetail and DocumentEditor. It was redundant with Comments, which serves the same purpose. Removed: `RecordNotes.jsx` component, the Notes tab + panel from both views, and the `GET/PUT /records/:id/notes` worker endpoints (`handleGetNote`, `handleSaveNote`). The `record_notes` D1 table is retained until a scheduled schema migration drops it.

### RecordDetail Save Path (Resolved 2026-03-31, updated 2026-04-01)

RecordDetail's `handleSave` passed all pending changes as a single batch object to `onUpdate(page.id, properties)`, but PageShell's `handleUpdate` expects per-field calls `onUpdate(pageId, fieldName, propPayload)`. Fixed to iterate and call per-field.

**Second fix (2026-04-01):** Table.jsx and RecordDetailPortals.jsx still had wrapper functions expecting the old batch signature `(pageId, propertiesObject)`. The wrapper ran `Object.entries()` on a string (the field name), silently corrupting all saves from RecordDetail — not just date ranges. Fixed by passing `onUpdate` directly (no wrapper). Affected views: Table, Kanban, Calendar, CardGrid.

### DateEditor Enter Key (Resolved 2026-04-01)

The DateEditor component in RecordDetail used React state (`start`, `end`) in `onKeyDown` handlers, but `setState` from `onChange` is async — pressing Enter could read stale values. Fixed by using refs (`startRef`, `endRef`) updated synchronously alongside state, and a shared `commit()` function used by both Enter handlers and the Set button.

### Workspace Insight Never Generating (Resolved 2026-04-01)

Two issues prevented the sidebar workspace insight from generating:

1. **claudeKey race condition:** The auto-scan effect in `useAICuratedTasks.js` skipped rescans when the task cache was fresh, even if insight was never generated. The first scan often ran before `claudeKey` loaded from D1 via `getConnections()`, skipping the Claude call entirely. Fixed: the auto-scan effect now also checks for missing insight before skipping.

2. **AI response parsing failure:** Claude Haiku 4.5 wraps JSON responses in markdown code fences despite prompt instructions to return raw JSON. Assistant message prefilling (the standard technique for forcing clean JSON) is not supported on Claude 4.5+ models. Fixed: removed the broken prefill approach and added targeted code fence stripping (`replace` for `` ```json `` / `` ``` `` wrappers) before `JSON.parse`.

### Delete Record Flow — 409 hasChildren (Resolved 2026-04-01)

`deleteRecords()` in `dataSource.js` expected `deleteRow()` to return `{ hasChildren: true }` when a record had sub-items (worker returns HTTP 409). But `apiFetch()` throws on non-2xx responses, so `deleteRecords()` never saw the response — it threw a generic error, and PageShell showed "Delete failed — please try again." Fixed: `deleteRecords()` now catches 409 errors and returns the `hasChildren` data. `handleDelete()` in PageShell prompts the user to choose how to handle sub-items (orphan or cancel) before retrying with cascade.

### AI Insight Truncation (Resolved 2026-04-01)

The AI insight was permanently stuck on the fallback message ("Visit Tasks to generate your workspace insight"). Root cause: `max_tokens: 1024` caused Claude's JSON response to be truncated mid-object. The fragile regex parser then failed silently. Fixed: increased `max_tokens` to 4096, replaced regex with brace-matching extraction (`rawText.indexOf("{")` / `lastIndexOf("}")`), added `stop_reason === "max_tokens"` warning.

### Multi-User Task Cache Scoping (Resolved 2026-04-01)

Three localStorage cache keys were shared across all users on the same browser, causing cross-user data pollution:
1. **Insight cache** (`wasabi_insight`): Users overwrote each other's AI-generated insights. Fixed: key is now `wasabi_insight_{userId}`. `useInsight()` accepts userId parameter.
2. **Interaction ledger** (`wasabi_task_interactions`): User A's task interactions (views, edits, dismissals) affected User B's priority scores. Fixed: key is now `wasabi_task_interactions_{userId}`. All ledger functions accept userId parameter.
3. **Cross-user cache invalidation**: Assigning a task to another user only invalidated the saving user's task cache. Fixed: worker broadcasts `task_cache_invalidate` to all UserRoom DOs on owner changes.

### Record Creation Title Type Mismatch (Resolved 2026-04-02)

`createRecord()` in `dataSource.js` used raw `col.type` (often `"text"`) as the `effectiveType` for `extractRawValue()`. But `d1SchemaToClassified` treats idx===0 as `"title"`, so the ghost row's `buildProp("title", val)` creates `{ title: [{...}] }`. When `extractRawValue` received `effectiveType: "text"`, it read `prop.rich_text` (undefined) and returned empty string — silently dropping all titles on creation.

The title correction was initially scoped to sub-items only (`if (parentRowId)`), which meant regular record creation on tables where the first column had raw `type: "text"` also lost titles. Fixed by removing the `parentRowId` guard and applying the title type correction universally — matching `d1SchemaToClassified` logic (explicit `type: "title"` or idx===0) for both parent and sub-column schemas.

### Chip Filters Excluding Sub-Items from Tree (Resolved 2026-04-02)

`useTableData.js` ran all rows (including sub-items) through the chip filter, dropdown filter, and search pipeline. Sub-items lack parent column values (status, channel, market, etc.), so `applyChipFilters` returned `false` for every sub-item when any chip filter was active. This made sub-items invisible in the tree even though `useTreeData` could build the parent→child mapping.

Fixed by separating sub-items (rows with `_parentRowId`) from parent rows before the filter pipeline, then re-attaching sub-items whose parent survived filtering. Sub-items are now always visible when their parent is visible, regardless of active filters or search text.

### Sub-Item Column Management Parity (Resolved 2026-04-14)

Sub-item columns were second-class compared to parent columns. Multiple gaps fixed over one session:

1. **Row limit** — `fetchD1Table()` loaded only 500 rows, which meant sub-items below the cutoff were invisible. Raised to 1000.
2. **d1RowToPage property split** — Parent and sub-item rows were both iterating the same column list, leaving sub-item properties empty for any column whose value was null. Fixed to map parent columns for parent rows and sub-columns for sub-items, unconditionally regardless of null values, so RecordDetail shows every configured field.
3. **Parent field inheritance** — Sub-items now carry `_parentFields` (priority, status, date range) from their parent row, used by task helpers and AI curation.
4. **Sub-item owner column** — New `showSubItemOwnerColumn` config gate with full grid/render support in TableRow.
5. **Context menu parity** — `SubColumnContextMenu` gained Manage Options, Change Type (full D1 type submenu), matching `ParentColumnContextMenu`. Previously only Rename + Delete.
6. **Single-click dropdown on sub-item headers** — Sub-item mini-header cells now open the context menu on single click (250ms timer), matching parent header UX. A chevron icon renders as a visible affordance. Double-click still inline-renames.
7. **Duplicate column name prevention** — Because Notion-compatible `properties` objects are keyed by column name (not ID), two columns with the same name silently overwrote each other. `handleAddCol`/`handleAddSubCol` auto-suffix duplicates (`"Status"` → `"Status 2"`). `handleRenameCol`/`handleRenameSubCol` alert and abort on collision.
8. **Inline option creation in RecordDetail** — `SelectEditor` previously only allowed picking from existing options. Newly created select/status columns had no options, making the dropdown unusable until the user opened Manage Options from the column header. Fixed by adding a "+ Create new option" input at the bottom of the dropdown. The handler (`handleCreateSchemaOption` in Table.jsx) branches on `page._parentRowId` to call `updateTableSchema` or `updateSubColumnSchema`, then auto-selects the new option after refresh.
9. **TDZ crash** — An earlier iteration placed `handleManageSubOptions` above the `subSchema` useMemo, with `subSchema` in its useCallback deps — const TDZ error at render time. Fixed by moving both sub-option handlers to immediately after the `subSchema` declaration.

### Table Color Unification + Sub-Item Data-Layer Fixes (Resolved 2026-04-15)

Phases 1, 2a, 2b, 2c of the table unification project — seven commits over one session fixing a tangled set of color-rendering and sub-item write-path bugs. Native D1 tables now render and mutate identically to linked-Notion tables. See `project_table_color_and_subitems.md` in memory for the full session record.

1. **Sub-column context menu clipped by viewport** — `SubColumnContextMenu` and `ParentColumnContextMenu` rendered at fixed `{x,y}` with no `maxHeight`/`overflowY` and no viewport clamping. Menu items near the bottom edge (especially Delete) were unreachable. Fixed with a shared `useClampedMenuPosition` hook in `ColumnContextMenu.jsx` — measures the menu via ref after first paint and clamps `left`/`top` inside the viewport, floored at 8px. Both menus also get `maxHeight: calc(100vh - 24px)` + `overflowY: auto`.

2. **Duplicate column name collision** — Two sub-columns both literally named "Status" in D1 storage (from a linked-Notion sync with similarly-named properties) collided in `page.properties` — the second silently overwrote the first, making one unreadable in RecordDetail and collapsing cell values. Fixed with `dedupeColumnNames(cols)` in `dataSource.js`, applied inside `fetchD1Table`, `updateRecord`, and `createRecord`. First occurrence keeps its name; duplicates are renamed in memory to `"Name (2)"`, `"Name (3)"`, etc. D1 storage is NOT mutated — the rename is cosmetic/key-level only so the UI can address both columns, with IDs untouched.

3. **Color divergence between cells and RecordDetail** — Native D1 tables had two competing color systems. System 1: per-option color on `col.options[i].color` (schema-owned, read by every surface via `getSolidPillColor`'s `WASABI_COLORS` branch). System 2: per-view `viewConfig.colorMapping` (palette indices) set via the ViewSettingsPanel COLOR SOURCE picker but only read by table row cells — RecordDetail bypassed it, and only one column could be mapped at a time. Native D1 options had `color: "default"` so System 1 returned nothing and cells/drawer drifted. Fixed by unifying on System 1: new `assignOptionColor(idx)` round-robins over in-app palette keys; new `repairOptionColors(cols)` backfills missing colors in `fetchD1Table` with fire-and-forget writeback; every option-creation site (OptionsManagerModal, Table.handleCreateSchemaOption, useTableCellEdit.handleCreateOption) now injects a color at add time. The COLOR SOURCE section is hidden for Table views in `ViewSettingsPanel.jsx` (Kanban/Gantt/CardGrid still use it). `colorMapping` prop drilling removed from `TableRow.jsx` → `CellDisplay.jsx`.

4. **Sub-item cell edits resolved against the wrong schema** — `updateRecord()` in `dataSource.js` only ever looked up columns in parent `columns`, never `sub_columns`. Sub-item cell edits on columns that didn't exist in the parent schema silently resolved to the wrong `col.id` (or no-op'd). Fixed by adding an `isSubItem` option to `updateRecord`'s options bag. When `true`, lookup is scoped to `sub_columns` only; when `false`, parent only; when `undefined` (legacy callers), try parent then sub as a fallback. Throws a loud scoped error on miss instead of silent failure. `PageShell.handleUpdate` and the conflict resolver both thread `isSubItem: !!record?._parentRowId` through.

5. **Sub-item creation merged parent + sub columns** — `createRecord()` merged `[...columns, ...subColumns]` into a single `allColumns` array when `parentRowId` was set. Name collisions (e.g. "Status" in both schemas) routed the sub-item's value to the parent column via `find()` returning the parent match first. Title-detection index was also computed against the merged array, breaking the first-sub-column-is-title heuristic. Fixed: when `parentRowId` is set, `createRecord` uses `sub_columns` alone and computes title index within that array.

6. **Hotfix — `dedupeColumnNames` in write paths** — `updateRecord` and `createRecord` pulled raw schema from `getTableSchema()` (which still has literal duplicate column names from D1 storage) and searched against that. Meanwhile `d1RowToPage` keyed `page.properties` by deduped names, so RecordDetail sent propertyName `"Status (2)"` to `updateRecord`, which couldn't find it in raw sub_columns and threw "Column not found". Fixed by applying `dedupeColumnNames` to both `columns` and `sub_columns` inside `updateRecord` and `createRecord` before any `.find()` or iteration.

7. **Native D1 tables had no sub_columns seeded** — `createTableConfig` in `pageConfig.js` creates only parent `columns`; the worker's `handleCreatePage` inserts a `table_schemas` row with `sub_columns: '[]'`. Sub-item ghost row rendered with no editable fields, creation produced empty sub-items, and RecordDetail showed "Untitled" with no Name field. Fixed by awaiting `updateSubColumnSchema(pageId, [{id, name: "Name", type: "title"}])` after `savePageConfig` in `VisualPageBuilder.jsx`, before `addPage` — guarantees the seed lands before navigation triggers the first `fetchD1Table`. Also removed the silent parent-title fallback in `Table.jsx` `subTitleField` — it used to return `schema?.title?.name` (the parent title column name) when `subColumns` was empty, which rendered an editable ghost keyed by the wrong field name. Now returns `null` so the ghost renders no cells when sub_columns is genuinely absent. Existing empty-sub_columns tables are NOT auto-migrated (Graham rebuilds manually).

8. **Hotfix — seed race** — First attempt at item 7 fired `updateSubColumnSchema` as fire-and-forget. `addPage` + navigation raced the write, so the first fetch saw empty `sub_columns`, the ghost fell through the (then-still-present) parent-title fallback, and sub-items persisted with empty cells. Fixed by awaiting the seed call, which also forced item 7's fallback removal as a belt-and-suspenders.

9. **TableRow silent fallback warning** — `TableRow.jsx` line 54 had `const activeSchema = isSubItem && subSchema ? subSchema : schema` — silently falling back to parent schema when `subSchema` was missing. Still falls back (to avoid crashes) but now logs `[TableRow] Sub-items rendering with parent schema for table "..."` once per table so the mismatch is visible. Should stay cold after item 7 lands for new tables.

10. **`_parentFields` audit (no fix)** — The 2026-04-14 session added `_parentFields` (priority/status/date inheritance from parent row) to sub-item page objects in `d1RowToPage`. Audit confirmed **zero consumers** read it anywhere in the codebase. Scaffolding is intentionally left in place (no deletes). If inheritance display is ever wanted in RecordDetail or table cells, that's a separate feature — this session's scope was bugfix, not new features.

### Sub-Item Enhancement: Status Categories, Roll-Up, View Parity (2026-04-15)

Major sub-item upgrade across 10 files (1,175 lines added). Not bug fixes — new features:

1. **Status categories** — Status options gain semantic `category` field (`not_started`, `in_progress`, `complete`, `on_hold`, `cancelled`). `normalizeOptions()` in `dataSource.js` preserves category. `OptionsManagerModal.jsx` shows category dropdown for status columns. `handleCreateSchemaOption` in Table.jsx assigns `category: "not_started"` to new status options. No D1 migration — categories stored in existing options JSON blob.

2. **Sub-item roll-up** — New `src/lib/subItemRollup.js` utility computes timeline range, progress, and conflict detection from child pages. `fetchD1Table` in `dataSource.js` attaches `page._rollup` to parent pages with children. Available to all views.

3. **RecordSubItems upgrade** — `RecordDetail.jsx`: Sub-Items tab upgraded from read-only title list to interactive panel with status category icons, status pills, date display, click-to-open nested RecordDetail, inline creation via `createRows`, and `RollupSummary` component (progress bar, date range, conflict warning).

4. **Gantt hierarchy** — `Gantt.jsx`: Collapsible parent/child rows, sub-item bars from `subSchema` date fields, computed range bar (translucent) behind parent, conflict indicator (amber triangle), sub-item drag-to-reschedule with correct schema routing, progress badge in sidebar, schema switch for RecordDetail.

5. **Kanban sub-item filtering** — `Kanban.jsx`: Sub-items filtered out before grouping. Parent cards show progress badge from `_rollup`.

6. **Calendar sub-item handling** — `Calendar.jsx`: Sub-items excluded from main event grid. Day popover shows expand chevron on parent events; clicking reveals indented sub-item list.

7. **RecordDetailPortals schema switch** — `RecordDetailPortals.jsx`: Passes `_subSchema` when `detailPage._parentRowId` is set, so sub-items opened from Calendar/other views get correct schema.

### NewRecordModal Rich Text Textarea Clipping (Resolved 2026-04-07)

The `rich_text` textarea in `NewRecordModal.jsx` inherited `borderRadius: RADIUS.pill` (999px) from the shared `ms.input` style. When the textarea grew with multiline content, the extreme pill radius clipped text at the corners, making content unreadable. Fixed by overriding `borderRadius` to `RADIUS.md` (10px) on the rich_text textarea only. Single-line inputs retain the pill shape.

### Console and Error Hygiene

All `console.log` debug statements have been removed from production code. Error handling uses the ToastContext system for user-visible errors and silent catch for non-critical failures (localStorage, optional features).
