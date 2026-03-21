# 10 — Platform Overview & Philosophy

## What is Wasabi?

Wasabi is an **AI-powered, multi-mode productivity platform** that bridges fragmented data sources (Notion, Google, manual databases) into a unified workspace.

**Core premise:** Stop switching between apps. All your data — tasks, calendar, emails, documents, databases — lives in one "pane of glass" with a unified AI assistant that understands your full context.

**Two modes:**
- **Sashimi Mode** — Lightweight, daily-use: tasks, calendar, notes, email, dashboard
- **Sushi Roll Mode** — Full platform: custom data views, automations, flows, node editor

---

## Core Architectural Philosophy

### Principle 1: Zero External Dependencies

**Only React + ReactDOM as runtime dependencies.**

No CSS framework, state management library, router, UI component library, or icon library. Everything is custom-built:
- **Styling:** Inline `style={{}}` objects (no CSS-in-JS library)
- **State:** React Context + hooks (no Redux/Zustand)
- **Routing:** State-based (usePlatform hook, no React Router)
- **UI Components:** All custom (Drawer, Modal, Table, etc.)
- **Icons:** 65+ SVG components (no icon library)

**Benefits:**
- Lean bundle (minimal dependencies to update/audit)
- Zero dependency conflicts or breaking changes
- Full control over performance and behavior
- Clear mental model: it's "just React"

**Trade-off:** More code to maintain, but it's all visible and modifiable within the project.

### Principle 2: Mutable Design Tokens

**The `C` color object is mutated in place during theme changes.**

```javascript
// src/design/tokens.js
export const C = {
  dark: "#080809",
  accent: "#5CC63A",
  // ... 30+ other colors ...
};

// On theme change, ThemeContext does:
Object.assign(C, newThemeTokens);
// All components now see updated colors without re-import
```

**Why mutate instead of re-export?**
- Avoids prop-drilling theme values through every component
- Components import once and use the same reference forever
- Theme changes are instant (no re-renders due to import changes)
- Memory efficient (single C object vs. creating new objects per render)

**Contrast:** Most apps use Context or props to pass theme down the tree. Wasabi mutates a single shared object — less React overhead.

### Principle 3: Inline Styles Over CSS

All component styling uses inline `style={{}}` objects, never separate CSS files.

```javascript
<div style={{
  background: C.dark,
  padding: "12px 16px",
  borderRadius: RADIUS.lg,
  boxShadow: SHADOW.card,
}}>
  Content
</div>
```

**Benefits:**
- Styles live next to markup (single source of truth)
- Easy to override/customize per-instance
- No class name conflicts or CSS specificity issues
- No CSS minification/bundling overhead

**Limitations:**
- Cannot use CSS features like `:hover`, `:focus` (handled via onMouseEnter/onFocus)
- Larger component file sizes
- No media queries (breakpoints defined but unused)

### Principle 4: React Context + Hooks, Not a State Management Library

**Three-layer context composition:**

```
PlatformProvider
├── AuthProvider (user identity, auth state)
├── PagesProvider (page configs, data)
├── NavigationProvider (active page/folder, UI state)
└── Plus: ThemeProvider, NeuronsProvider, UserSyncProvider, etc.
```

**usePlatform() hook merges all contexts:**
```javascript
const {
  user, pages, activePage, setActivePage,
  identity, multiUserEnabled,
  // ... 20+ properties from multiple contexts
} = usePlatform();
```

**Why not Redux/Zustand?**
- Overkill for this app's data model (mostly CRUD operations)
- Adds bundle size and mental overhead
- React Context is sufficient for feature scope

### Principle 5: D1 as Source of Truth

**All persistent data lives in Cloudflare D1 (serverless SQLite).**

**Tables:**
- `page_configs` — User-created pages (with view definitions)
- `table_rows` — Data rows (local cache of Notion or manual data)
- `table_schemas` — Column definitions
- `automation_rules` — Automation triggers + actions
- `custom_functions` — User-defined transforms
- `connections` — OAuth tokens (Google, Notion, Claude API key)
- `notifications` — Notification feed
- Plus: sheet_data, documents, automation_flows, etc.

**Notion as secondary source:**
- Can read from Notion databases (API calls through worker)
- Can write back to Notion (sync two-way)
- Not the authoritative storage; D1 is
- Allows users to work in Notion if preferred

**Google as integration:**
- Read-only: calendar events, Gmail messages, Drive files
- Write: create events, send emails, share files
- Not cached; fetched on-demand
- Credentials stored in D1 `connections` table

### Principle 6: AI-First (Claude Integration)

**Claude is deeply integrated, not bolted-on.**

**Two tiers:**
- **Claude Haiku** — Fast, cheap; used for automations and simple queries
- **Claude Sonnet** — Powerful; used for complex reasoning, multi-step tasks

**Smart routing** (src/agent/aiRouter.js):
- Classify query complexity
- Route to appropriate model
- Multi-phase execution for complex tasks

**Tool system** (src/agent/tools.js):
- Query any database (D1, Notion, Google Sheets)
- Create/update/delete records
- Send emails, create events
- Run automations and flows
- Post notifications
- 25+ tools available to Claude

**Example interaction:**
1. User: "Show me high-priority tasks due today and block time on my calendar"
2. System classifies as "complex" → routes to Sonnet
3. Sonnet uses tools to:
   - Query tasks (filter: priority=High, due=today)
   - For each task, call create_calendar_event
   - Post notification of created blocks
4. Results shown in UI

### Principle 7: Multi-User Real-Time Collaboration

**Implemented via WebSocket + Durable Objects.**

**Architecture:**
- `CollaborationContext` — WebSocket lifecycle management
- `UserSyncContext` — Presence and typing indicators
- Durable Objects (worker-side) — Per-workspace user rooms, per-table data rooms
- Broadcasting — Row changes sync to all connected clients in real-time
- Conflict resolution — Last-write-wins (timestamps + author tracking)

**Status:** Phases 1-3 complete (basic multi-user support, typing indicators, row sync).

### Principle 8: Mobile-First Design (Future)

**Currently desktop-only.** Breakpoints defined (`BP.mobile: 640px`, `BP.tablet: 1024px`) but not yet used. Responsive design is a known gap.

**Vision:** Sashimi mode (tasks, calendar, notes) should work great on mobile. Sushi Roll (data views, flows) requires more screen real estate.

---

## Core Concepts

### "One Pane of Glass"

**Problem it solves:** Users juggle multiple apps:
- Notion for databases
- Google Calendar for scheduling
- Gmail for email
- Slack for messages
- Jira/Linear for work tracking

Each app has its own interface, notifications, search, and context switching overhead.

**Solution:** Wasabi centralizes all data and provides unified:
- **Search** — Across all sources simultaneously
- **AI assistant** — Understands full context (tasks, calendar, emails, etc.)
- **Notifications** — All alerts in one feed
- **Navigation** — One sidebar for all data sources
- **Real-time sync** — Changes in any source flow through Wasabi

**Example workflow:**
- Morning: Check Sashimi dashboard (today's tasks, calendar, unread emails)
- Afternoon: Switch to Sushi Roll, build a custom report from 3 Notion databases
- Evening: AI assistant curates tasks for tomorrow based on calendar and new emails

### AI-First

**Claude is not a chat plugin; it's the platform's brain.**

- **Task curation:** AI prioritizes tasks across manual + Notion databases daily
- **Query answering:** "What's our Q4 revenue vs. budget?"
- **Automation:** Triggers run AI instructions (e.g., "summarize new records")
- **Data mutations:** "Mark all Q4 items done" executes via Claude tool calls
- **Workflow design:** Node editor is visual way to chain Claude operations

**Token budget management:**
- Large datasets truncated to fit token limits
- Recent/relevant data prioritized
- Graceful fallback if data too large

### Visual Knowledge Graph (Neurons)

**Concept:** Named clusters linking related information.

**What you can link:**
- Pages (Notion databases, user-created pages)
- Records (individual rows)
- External data sources
- Any combination above

**Visual representation:**
- Nodes (colored circles) — Each represents an entity
- Edges (lines) — Show relationships
- Overlay on main view (click toggle to show/hide)
- Hover to highlight one neuron

**Use case:** "Q1 Project Neuron"
- Nodes: Notion database (project tracker), Google Sheet (budget), Calendar (milestones), Slack channel (team comms)
- Visual map showing how everything connects
- Click node to jump to that resource

**Future ideas:**
- AI-suggested neurons ("These 4 resources seem related")
- Automatic neurons from automation flows
- Neurons as favorites/bookmarks

### Theming as Identity

**5 Japanese-inspired themes, each complete visual transformation:**

| Theme | Mood | Use Case |
|-------|------|----------|
| Obsidian (dark, Wasabi green) | Focused, tech | Default, high contrast |
| Shoji (light, warm) | Minimal, paper-like | Daytime, warm ambiance |
| Hinoki (dark, wood) | Warm, natural | Evening, cozy work |
| Kori (light, ice blue) | Cool, professional | Corporate, clean |
| Sumi (dark, ink) | Sophisticated, neutral | Design-conscious users |

**Design philosophy:**
- Each theme is locked to its designed mode (dark/light)
- Colors aren't random; they're thought through
- Theme affects accent color, palette, overall mood
- Users select a theme to set aesthetic + mood for their workspace

**Personal insight:** Theme choice is identity. Users don't pick Obsidian for darkness; they pick it for the vibe.

---

## Use Cases

### Personal Productivity (Sashimi Mode)

**Morning routine (5 min):**
1. Open Wasabi → Sashimi mode
2. Check today's calendar (Google Calendar events + task due dates)
3. Review AI-curated task list (sorted by priority + deadline)
4. Quick scan of unread Gmail
5. Jot notes in Notes view for the day

**Throughout day:**
- Quick task creation ("Add a task...")
- Calendar event management (drag to reschedule)
- Gmail compose/reply
- Dashboard widgets for at-a-glance status

**Evening:**
- Mark completed tasks as done
- Review tomorrow's calendar + AI curated tasks
- Capture loose notes
- Check notifications feed

**Tools used:** TasksView, CalendarView, NotesView, GmailView, DashboardView, ChatPanel

### Project Management (Sushi Roll Mode)

**Setup:**
- Link 2–3 Notion databases (tasks, designs, bugs)
- Create 3 views per database (table, kanban, calendar)
- Set up automations (e.g., "When status → Done, archive row")

**Daily use:**
- Switch between kanban (prioritization) and calendar (timeline) views
- AI assistant: "Show me all overdue tasks across projects"
- Export reports (custom charts, PDF)
- Update automations as processes evolve

**Tools used:** PageBuilder, data views (Table, Kanban, Calendar, Gantt), Automations, Flows, AI Chat

### Business Operations

**Multi-database visibility:**
- Finance: Link accounting database (invoices, expenses, revenue)
- Operations: Link project database (milestones, resources)
- HR: Link people database (roles, reports)

**Dashboard:**
- KPI tiles (revenue, headcount, project status)
- Activity feed (recent changes)
- Quick links to critical views

**Reporting:**
- Custom views (table with filters, exports)
- Charts (revenue by quarter, headcount trend)
- Scheduled reports via automations ("Email board summary every Monday")

**Tools used:** DashboardView, custom Views, Automations (scheduled), Charts, Export

### Data Analysis

**Connect data:**
- Notion databases (CRM, product feedback)
- Google Sheets (financial data)
- D1 tables (internal logs)

**Transform:**
- Custom functions (calculate CAC, LTV, etc.)
- Formulas (compound calculations)
- Flows (multi-step data pipelines)

**Visualize:**
- Network graph (show customer → company → product relationships)
- Charts (trends, distributions)
- Tables (drill down into raw data)

**Export:**
- CSV for Excel analysis
- PDF for presentations
- Charts for reports

**Tools used:** CustomView, Functions, Flows, Charts, Export

---

## Future Vision

### Near-term (Next 3 months)

1. **Mobile Sashimi** — Responsive design for tasks, calendar, notes on phones/tablets
2. **More integrations** — Slack, Linear, Jira, GitHub as data sources
3. **Import/export** — Bulk CSV import, more export formats
4. **Offline support** — Draft tasks/notes offline, sync when online
5. **Plugin system** — Custom widgets, views, data sources

### Medium-term (3–6 months)

1. **Team workspaces** — Shared pages, permissions, invites
2. **Advanced AI workflows** — Multi-step agent with memory, scheduled analysis
3. **Mobile Sushi Roll** — Simplified data views for tablets
4. **Marketplace** — Pre-built templates, automations, flows
5. **API for third-party apps** — Embed Wasabi data elsewhere

### Long-term (6+ months)

1. **Semantic search** — Search by meaning, not just keywords
2. **Smart automations** — ML models for task prioritization, anomaly detection
3. **Predictive insights** — Forecast revenue, churn, resource needs
4. **Voice interface** — "Add task due tomorrow," "Show my calendar"
5. **Open source components** — Contribute design system, components to community

---

## Architecture Overview (Visual)

```
┌─────────────────────────────────────────────────────────────────┐
│                      React SPA (Frontend)                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ PlatformProvider (Auth + Pages + Navigation + Theme)   │   │
│  │ ├─ TopHeader (logo, breadcrumb, user menu)            │   │
│  │ ├─ Navigation (sidebar)                               │   │
│  │ ├─ WasabiPanel (chat, log, notifications)            │   │
│  │ └─ Main Content                                        │   │
│  │    ├─ Sashimi Mode (zen/): Tasks, Calendar, Notes    │   │
│  │    └─ Sushi Roll Mode (samurai/): PageShell + Views  │   │
│  │       ├─ Table, Kanban, Calendar, Gantt, etc.        │   │
│  │       ├─ PageBuilder                                  │   │
│  │       ├─ Automations, Flows, Functions               │   │
│  │       └─ Neurons (visual knowledge graph)             │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                            ↕ (via worker.js)
┌─────────────────────────────────────────────────────────────────┐
│               Cloudflare Worker (Backend)                        │
│  ├─ D1 (SQLite): page_configs, table_rows, automations, etc.  │
│  ├─ R2 (Storage): document bodies, file attachments            │
│  ├─ Durable Objects: user rooms, data sync rooms (WebSocket)  │
│  ├─ Auth: JWT verification, multi-user identity               │
│  └─ Integrations:                                               │
│     ├─ Notion API proxy (read/write databases)                │
│     ├─ Google OAuth + APIs (Calendar, Gmail, Drive)           │
│     └─ Anthropic Claude API (AI model calls)                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions & Trade-offs

| Decision | Benefit | Trade-off |
|----------|---------|-----------|
| Inline styles only | Single source of truth, dynamic theming | Larger component code, no advanced CSS |
| Mutable C object | Instant theme changes, no prop drilling | Non-standard pattern, harder to debug |
| D1 as source of truth | Consistent data, offline-safe | Not real-time until sync completes |
| Claude integration | Context-aware AI, natural language automation | API costs, token budget limits |
| Zero UI library | Lean bundle, full control | More code to maintain, slower dev |
| Context-based routing | No router overhead, full state access | Non-standard, steeper learning curve |
| WebSocket via Durable Objects | Real-time sync, low latency | Infrastructure lock-in (Cloudflare) |

---

## For Developers Working Here

### Mental Models

1. **Everything is data.** Tasks, calendar events, Notion records, automations — all rows in D1 or external APIs.
2. **Claude is a tool.** Not a chat interface; a persistent agent that handles queries, automations, and mutations.
3. **Theme as state.** The `C` object is global mutable state (unusual but intentional). Mutations propagate instantly.
4. **Context, not Redux.** Embrace React Context + hooks. No action/reducer pattern.
5. **Inline styles are normal.** No CSS files. Style objects are data.

### Debugging Tips

- **Theme not updating?** Check ThemeContext's `applyTheme()` — is it mutating C?
- **Data not syncing?** Check CollaborationContext — is WebSocket connected? Check Durable Object rooms.
- **Claude call failed?** Check token budget (dataSummary.js). Check API key in D1 connections table.
- **View not rendering?** Check PageShell data fetching. Check ViewRenderer routing logic.

### Adding Features

**Workflow:**
1. Define data model (D1 table or external API structure)
2. Create UI component (using C, S, ANIM tokens)
3. Add context hook if needed (global state)
4. Wire up API calls (via worker.js)
5. Add error handling and loading states
6. Test both Notion-linked and D1-native paths

---

## Summary

Wasabi is a **deeply opinionated, zero-dependency platform** built on four pillars:

1. **Mutable Design Tokens** — Fast theme switching, no prop drilling
2. **D1 as Source of Truth** — Consistent, conflict-free data
3. **AI-First** — Claude integrated at the core, not bolted-on
4. **Two Modes** — Minimal daily interface (Sashimi) + full platform (Sushi Roll)

**Philosophy:** Simplicity over abstraction. Custom code over frameworks. Data over UI framework features.

**Result:** A lean, fast, cohesive platform that's easy to reason about and modify.
