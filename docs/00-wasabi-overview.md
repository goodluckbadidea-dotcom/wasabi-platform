# Wasabi Platform

## What Wasabi Is

Wasabi is an AI-native workspace where users build persistent semantic scaffolding that makes AI interactions more accurate, contextual, and actionable over time.

Unlike conversational AI tools where each session starts from scratch, Wasabi lets users organize data visually — through database views, knowledge bases, and relationship networks (Neurons) — creating a cumulative structure that AI draws from. The more you organize, the better the AI understands your domain, your operations, and your intent.

The interface serves two purposes:

1. **For humans:** A GUI to visualize, organize, and manipulate data through familiar patterns (tables, kanban boards, calendars, documents) with mouse/touch interaction
2. **For AI:** A structured semantic network that provides context, relationships, and operational knowledge — eliminating the need to rebuild understanding each conversation

### Core Idea

Traditional AI workflow: User submits prompt → AI scrapes available data → AI builds temporary semantic connections → AI reasons → AI responds → connections are discarded.

Wasabi workflow: User organizes data visually over time → Neurons capture relationships → Knowledge base stores domain rules → Automations encode operational patterns → AI draws from this persistent scaffolding → Each interaction builds on everything before it.

The scaffolding is the product. The views, the AI, the automations — these are tools for building and leveraging that scaffolding.

---

## Three-Tier Platform Vision

### Tier 1: Team OS (Current)

Replace the tool stack (Notion + Slack + Zapier + Sheets) with one unified, self-hosted platform. Data views, email, calendar, automation, AI — all in one surface.

### Tier 2: Customizable AI Agent Platform (Emerging)

Users don't get an out-of-the-box solution. They build the operational agent they need through chat-driven development: custom automations, functions, plugins, and views. The AI learns from the scaffolding the user creates.

### Tier 3: Developer Platform (Future)

Two tiers of extensibility:

- **Accessible tier:** Via chat, users build custom apps/plugins/integrations using natural language and the built-in function/plugin/view builders
- **Super-user tier:** Via MCP server, developers directly manipulate Wasabi's data and logic to create entirely bespoke systems using the platform as foundation

> **In development (2026-05-15):** **Extensions** — a third extensibility
> pattern for *custom-coded reports*. Templates are hand-authored
> externally (e.g. in Cowork) and registered into Wasabi via MCP;
> snapshots are then generated from a template + a validated DATA blob,
> rendered to R2, and listed in an auto-bootstrapped "Reports" database
> for review and publish. The framework is wired end-to-end and shipped
> behind no flag, but is being shaken out on its first live template.
> See `docs/02-features-functions.md` → "Extensions" for the full
> overview.

---

## Architecture

Self-hosted on Cloudflare's edge infrastructure. Zero external runtime dependencies beyond React. All data lives in D1 (Cloudflare's SQLite) — fully owned by the user.

```
Browser (React 18 SPA)
  ├── src/core/           → Shell: TopHeader, Navigation, PageShell, SystemManager/
  ├── src/views/          → Data views: Table, Kanban, Gantt, Calendar, Form, Document
  ├── src/features/       → Features: TasksView, CalendarView, RecordDrawer, GmailView
  ├── src/agent/          → AI: runAgent, toolExecutor, queryClassifier, automations, flows
  ├── src/context/        → State: Auth, Pages, Theme, Navigation, Collaboration, Toast, Viewport
  ├── src/design/         → Tokens (C, Z, BP, RADIUS, SHADOW, FONT), animations, icons (65+)
  ├── src/components/     → Shared UI: ColumnBuilder, MultiSelectPicker, StateIndicators
  ├── src/neurons/        → Relationship mapping: NeuronsContext, NeuronLines, NeuronOverlay
  ├── src/hooks/          → Custom hooks: useViewPrefs, useKeyboardShortcuts
  └── src/lib/            → Utilities: api.js (fetch wrapper), iframeHelpers, tableSocket

Worker (Cloudflare Workers — single file: worker.js, ~9500 lines)
  ├── D1 Database         → 18+ tables: pages, rows, users, notifications, active_sessions, task_snoozes, etc.
  ├── R2 Storage          → File attachments (wasabi-docs bucket)
  ├── Durable Objects     → TableRoom (per-table WebSocket), UserRoom (per-user broadcast)
  ├── Cron Trigger        → Every 2 minutes: automation engine, sync, cleanup
  └── Schema Versioning   → /init fast path: checks schema_version, skips DDL for returning users
```

### Infrastructure

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 18, Vite 5 | SPA with lazy loading, inline styles |
| Backend | Cloudflare Workers | Single worker handles all API, auth, WebSocket, cron |
| Database | D1 (SQLite at edge) | Source of truth for all workspace data |
| Storage | R2 | File attachments, document exports |
| Real-time | Durable Objects | WebSocket rooms per table (TableRoom) and per user (UserRoom) |
| AI | Claude API | Haiku (fast/cheap) and Sonnet (complex) with 71+ tools |
| Auth | JWT + HttpOnly cookies | 15-min access token (memory), 7-day refresh token (cookie) |

### Key Technical Decisions

- **Zero build dependencies** beyond React, ReactDOM, Vite, vitest, and jspdf
- **Inline styles** with mutable design tokens — no CSS files, no CSS-in-JS library
- **5 themes** (Shoji, Obsidian, Hinoki, Kori, Sumi) — all derived from the token system in `src/design/tokens.js`
- **Single worker.js** handles all API routes, auth, WebSocket upgrade, cron, and OAuth
- **Schema version fast path** on `/init`: returning users skip all DDL (~2-3 queries in <1s instead of ~92). First boot and version bumps use batched DDL via `env.DB.batch()`. Version tracked in `connections` table as `schema_version`.
- **Auth gate in PlatformContext**: `AuthGate` component sits between AuthProvider and data-fetching providers (PagesProvider, NavigationProvider), ensuring nothing mounts pre-auth
- **AI routing**: `queryClassifier.js` determines complexity → Haiku (fast/cheap) or Sonnet (complex reasoning) with 71+ tools available to the agent
- **Real-time collaboration** via Durable Objects — field-level conflict detection with `cell_versions`

---

## Two Interface Modes

### Features (`src/features/`)

Personal productivity surface. User-scoped data.

| Component | File | Purpose |
|-----------|------|---------|
| TasksView | `src/features/TasksView.jsx` | Personal task list + calendar integration |
| CalendarView | `src/features/CalendarView.jsx` | Day/week/month calendar with Google Calendar sync |
| RecordDrawer | `src/features/RecordDrawer.jsx` | Slide-out record editor (primary edit surface for all views) |
| ChatPanel | `src/features/ChatPanel.jsx` | AI chat with context from current page/data |
| GmailView | `src/features/GmailView.jsx` | Gmail inbox, read, compose, reply |
| FigmaView | `src/features/FigmaView.jsx` | Browse Figma projects/files, import as Design Assets |
| DashboardView | `src/features/DashboardView.jsx` | Customizable widget dashboard |
| WorkspaceBrowser | `src/features/WorkspaceBrowser.jsx` | Folder-based page navigation |

### Workspace Mode (`src/views/`, `src/core/`)

Shared database views. Workspace-scoped with per-page permissions.

| View | File | Purpose |
|------|------|---------|
| Table | `src/views/Table.jsx` + `src/views/table/` (16 files) | Spreadsheet-like grid with columns, filters, sorting. Orchestrator in Table.jsx (~1,205 lines), sub-modules in table/ folder. |
| Kanban | `src/views/Kanban.jsx` | Card-based board grouped by status/select columns |
| Gantt | `src/views/Gantt.jsx` | Timeline bar chart for date-range records |
| Calendar | `src/views/Calendar.jsx` | Calendar view of date-based records |
| Form | `src/views/Form.jsx` | Public/private form for data collection |
| DocumentEditor | `src/views/DocumentEditor.jsx` | Rich text document with blocks |
| CustomView | `src/views/CustomView.jsx` | User-authored HTML/JS views |
| NetworkGraph | `src/views/NetworkGraph.jsx` | Visual graph of record relationships |
| NotificationFeed | `src/views/NotificationFeed.jsx` | Notification inbox with filtering |

### Shell Components (`src/core/`)

| Component | File | Purpose |
|-----------|------|---------|
| PageShell | `src/core/PageShell.jsx` | Orchestrator: loads page config → fetches data → renders active view |
| TopHeader | `src/core/TopHeader.jsx` | Top bar: theme toggle, command palette (Cmd+K), user menu |
| Navigation | `src/core/Navigation.jsx` | Left sidebar: page list, search, system nav items |
| SystemManager | `src/core/SystemManager/` | Settings: overview, connections, settings, users, audit log (9 files) |
| CommandPalette | `src/core/CommandPalette.jsx` | Cmd+K searchable overlay for pages, shortcuts, actions |
| ConfirmDialog | `src/core/ConfirmDialog.jsx` | Reusable confirmation modal for destructive actions |
| LoginScreen | `src/core/LoginScreen.jsx` | Multi-user login with password |
| SetupWizard | `src/core/SetupWizard.jsx` | First-run setup: worker URL, secret, admin creation |

---

## AI System

### Components

| File | Purpose |
|------|---------|
| `src/agent/runAgent.js` | Agent loop: prompt → classify → route to model → execute tools → respond |
| `src/agent/agentContext.js` | Context envelope builders for Agent and Assistant modes |
| `src/agent/toolExecutor.js` | Tool implementations: CRUD pages/rows, Gmail, Google Calendar, automations, neuron CRUD, per-record context, workspace structure, documents, permissions |
| `src/agent/queryClassifier.js` | Determines query complexity → routes to Haiku or Sonnet |
| `src/agent/tools.js` | Tool definitions (name, description, parameters) for Claude. Role-based assistant tool sets. |
| `src/agent/wasabiPrompt.js` | System prompt builder for Agent and Assistant. Context budget competition. |
| `src/agent/automations.js` | Cron-triggered automation engine: evaluates rules, executes actions |
| `src/agent/flowExecutor.js` | DAG-based flow execution: trigger → conditions → actions → delays |
| `src/agent/dataSummary.js` | Builds data context for AI within token budget constraints |

### How AI Uses the Scaffolding

1. **Knowledge Base** (`knowledge_base` D1 table) — User-curated domain rules, business context. Injected into every AI system prompt.
2. **Neurons** (`neurons` D1 table + `src/neurons/`) — Named relationship clusters linking records, pages, and fields across the workspace. AI receives **hydrated** neuron context (actual field values from connected records, not just labels) filtered by relevance to the user's query. Full CRUD tools let the AI create, rename, delete neurons and add/remove nodes conversationally. When neurons are rich enough, the system automatically compresses or skips the workspace summary to save tokens.
3. **Page Structure** — The organization of pages, folders, and views tells the AI what matters and how data relates.
4. **Automation History** — Past automation executions provide operational patterns the AI learns from.

---

## Data Flow

### Standard Request

```
User action → React component → apiFetch() [src/lib/api.js]
  → Worker endpoint [worker.js] → D1/R2 query
  → JSON response → Context state update → Re-render
```

### Real-time Collaboration

```
User A saves record → Worker writes to D1
  → Worker broadcasts via TableRoom Durable Object → WebSocket
  → User B's CollaborationContext receives update → Re-render
```

### AI Agent Loop

```
User message → queryClassifier (strategy/complexity/model)
  → runAgent builds system prompt (KB + page context + data summary)
  → Claude API call → tool_use response → toolExecutor runs tool
  → Tool result → back to Claude → final response to user
```

---

## Security Posture (March 2026)

| Feature | Status | Implementation |
|---------|--------|---------------|
| Password hashing | PBKDF2, 100k iterations | `worker.js` hashPassword/verifyPassword |
| JWT auth | Refresh token pattern | 15-min access (memory) + 7-day refresh (HttpOnly cookie) |
| CORS | Origin whitelist | `CORS_ORIGINS` env var, validated per request |
| Rate limiting | D1-backed | 5 failed attempts / 15 min on auth endpoints |
| XSS prevention | Escaped code execution | JSON.stringify in PluginWidget, escapeHtml in iframeHelpers |
| Code sandbox | Timeout + blocklist | 5s deadline guard + infinite loop detection in toolExecutor |
| Session management | Multi-device | active_sessions table, revocation, WebSocket broadcast |
| Role enforcement | DB lookup per request | getFreshRole() queries users table, not stale JWT claim |
| Per-user scoping | Ownership verification | User tasks, comments, notifications filtered by target_user_id (no admin bypass) |
| Instant notifications | WebSocket push via UserRoom DO | Badge updates instantly on @mention or comment, 60s polling fallback |
| Input validation | Password policy | Min 8 chars, uppercase + lowercase + digit |
| Invite codes | Expiration | 7-day TTL on invite codes |

---

## Current State (April 2026)

- Multi-user beta with 5 users (admin + 4 viewers)
- Security hardened across all critical vectors
- Design system: centralized tokens for colors (C), z-index (Z), fonts (FONT), radius (RADIUS), shadows (SHADOW), animations (ANIM)
- Responsive: ViewportContext with iPad breakpoints (`BP.mobile = 768`, `BP.tablet = 1194`)
- Accessibility: ARIA attributes on dialogs, focus management, keyboard navigation
- Test infrastructure: vitest with 29 security unit tests
- Toast notification system for save/error/warning feedback
- Loading states: SkeletonLoader, EmptyState, ErrorState components
- WCAG AA contrast: all 5 themes pass 4.5:1+ for muted text on surfaces (surface, surfaceRaised, border, textMuted updated)
- Column options management: OptionsManagerModal for select/multi_select/status CRUD, reorder, color assignment
- Form view: inline option creation via SelectPicker/MultiSelectPicker, databaseId fallback to pageConfig.id
- Type-change safety: warning when changing column type away from select-like types with existing options
- Date range support: date fields support optional end dates ({ start, end } objects), displayed as "Jan 15 – Apr 1" in table cells
- Real-time collaboration: presence banner shows user names, collabRef pattern prevents layout strobe
- RecordDetail save: per-field onUpdate calls to PageShell (not batch), all parent views pass onUpdate directly
- User Tasks table: pagesLoaded gate prevents duplicate creation on login
- RecordDrawer "Go to Task" navigates to source database AND opens RecordDetail drawer via `navigateToRecord()`
- AI task curation: Haiku 4.5 response parsing handles code fence wrapping; claudeKey race condition resolved
- 0 hardcoded error/warning colors (all tokenized)
- 0 console.log debug statements in production code

---

## Development Guidelines

### File Organization

- `src/core/` — App shell, navigation, settings. Loaded eagerly.
- `src/views/` — Database view components. Lazy-loaded by PageShell.
- `src/features/` — Personal productivity components. Lazy-loaded.
- `src/components/` — Shared UI components used by multiple views.
- `src/context/` — React context providers. Wrap the app in `App.jsx`.
- `src/design/` — Design system: tokens, animations, icons, styles.
- `src/agent/` — AI agent system. Lazy-loaded.
- `src/lib/` — Utility functions, API client, WebSocket helpers.
- `src/neurons/` — Relationship mapping system.
- `src/hooks/` — Custom React hooks.

### Style Rules

- **Always use design tokens** — `C.error` not `"#E05252"`, `Z.modal` not `200`, `FONT` not `"'Outfit'..."`
- **Inline styles only** — no CSS files, no styled-components
- **All record editing through RecordDrawer** — table cells are read-only (click opens drawer)
- **All overlays use `C.overlayBg`** — never hardcode `rgba(0,0,0,...)`
- **Z-index must use Z tokens** — `Z.modal`, `Z.dropdown`, `Z.toast`, etc.
- **ARIA on all dialogs** — `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
- **iPad-aware** — use `useViewport()` for responsive behavior, test at 768px and 1194px

### Adding a New View

1. Create component in `src/views/NewView.jsx`
2. Add lazy import in `App.jsx` via `lazyWithRetry()`
3. Register view type in `PageShell.jsx` renderContent switch
4. Add view option in `ViewTypePicker.jsx`

### Worker API Patterns

- All routes go through `extractUser()` which checks Authorization header then cookie
- `checkRoutePermission()` enforces role-based access
- Responses use `jsonResponse()` helper with optional headers (Set-Cookie, CORS)
- Rate limiting via `checkRateLimit()` / `recordRateLimitAttempt()` on auth endpoints
