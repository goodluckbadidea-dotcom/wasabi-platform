# 10 — Concepts, Ideas & Uses

## What is Wasabi?

Wasabi is an AI-powered productivity platform that bridges multiple data sources (Notion, Google, manual databases) into a unified workspace. It operates in two modes:

- **Sashimi** — A focused, minimal interface for daily productivity: tasks, calendar, notes, email, and AI chat
- **Sushi Roll** — A full-featured platform for building custom data views, automations, and workflows

## Core Concepts

### "One pane of glass"
All your data — Notion databases, Google Calendar events, Gmail messages, manual tasks — accessible from a single interface without switching apps.

### AI-First
The Wasabi AI assistant has full context of your data and can:
- Curate and prioritize tasks across all sources
- Answer questions about your data
- Create, update, and delete records via natural language
- Run automations and flows

### Visual Knowledge Graph (Neurons)
Connect any pages, views, records, or external data sources into named groups. Neurons create a visual overlay showing how your information relates.

### Theming as Identity
5 Japanese-inspired themes aren't just color schemes — each is a complete aesthetic that transforms the entire UI. Themes are locked to their designed mode (dark/light) for visual consistency.

---

## Use Cases

### Personal Productivity (Sashimi Mode)
- Morning routine: check today's calendar, review AI-prioritized tasks, scan Gmail
- Quick task capture without context switching
- Notes for meeting minutes or brainstorming
- Dashboard with pinned widgets

### Project Management (Sushi Roll Mode)
- Link Notion databases as data sources
- Build custom views: table, kanban, timeline, calendar
- Create automations: "When status changes to Done, notify team"
- Track across multiple projects with Neurons

### Business Operations
- Connect multiple Notion databases for cross-functional visibility
- Build dashboards with KPI tiles and charts
- Create forms for data entry
- Export reports and documents

### Data Analysis
- Query and filter across connected databases
- AI-powered data summarization
- Custom functions for calculated fields
- Visual flow builder for data pipelines

---

## Architecture Philosophy

### Zero Dependencies (Almost)
Only React and ReactDOM as runtime dependencies. No:
- CSS framework (pure inline styles)
- State management library (React Context + hooks)
- Router (state-based routing)
- UI component library (all custom)
- Icon library (all inline SVG)

This keeps the bundle lean and eliminates dependency conflicts.

### Mutable Design Tokens
The `C` color object is mutated in place when themes change. This avoids prop-drilling theme values through every component — they all just import `C` directly.

### Worker-Based Backend
All server logic lives in a Cloudflare Worker, keeping the frontend a pure static SPA. The worker handles:
- D1 database operations
- R2 file storage
- Google OAuth token management
- API proxying (Notion, Claude)

---

## Future Ideas & Directions

### Potential Enhancements
- Real-time collaboration (WebSocket via Durable Objects)
- Mobile app (React Native or PWA)
- Plugin system for custom views/widgets
- Team workspaces with shared pages
- More data source integrations (Linear, Jira, GitHub, Slack)
- Offline support with local-first sync
- Advanced AI workflows (multi-step agents, scheduled analysis)
- Natural language automation builder
- Calendar event creation from AI chat
- Smart email drafting with context from tasks/calendar

### Design Exploration
- More themes (seasonal, high-contrast accessibility)
- Customizable dashboard layouts
- Mobile-optimized Sashimi mode
- Widget marketplace
- Zen-mode timer/focus features
