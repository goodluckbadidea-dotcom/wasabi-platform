# 04 — AI & Chat

## AI Agent System

All AI/agent code lives in `src/agent/`:

| File | Purpose |
|------|---------|
| `aiRouter.js` | Routes AI calls to Claude or other providers |
| `runAgent.js` | Core agent loop — takes a prompt, runs tools, returns result |
| `tools.js` | Tool definitions available to the AI agent |
| `toolExecutor.js` | Executes tool calls from the AI agent |
| `wasabiPrompt.js` | System prompt for the Wasabi AI assistant |
| `queryClassifier.js` | Classifies user queries to determine routing |
| `dataSummary.js` | Generates data summaries for AI context |
| `memory.js` | AI conversation memory/context management |
| `automations.js` | Automation engine — rule evaluation + execution |
| `flowExecutor.js` | Visual flow execution engine |

### AI Routing (`src/agent/aiRouter.js`)

- Routes to Claude API via worker proxy
- `claudeProxy(body, claudeKey)` in `src/lib/api.js` — proxies to `POST /claude-proxy`
- Handles streaming responses, tool use, and context management

### Agent Loop (`src/agent/runAgent.js`)

The agent takes a user message, builds context (page data, schema, records), and runs a tool-use loop:
1. Classify query type
2. Build system prompt with relevant context
3. Call Claude API
4. If tool use requested → execute tool → feed result back → loop
5. Return final text response

### Available Tools (`src/agent/tools.js`)

Tools the AI can call during conversations:
- Database CRUD (query, create, update, delete records)
- Page/view management
- Data analysis and summarization
- Notion operations
- Calendar/Gmail operations (when Google connected)

### Tool Executor (`src/agent/toolExecutor.js`)

Maps tool names to actual API calls. Handles:
- Parameter validation
- Error handling and retry
- Result formatting for the AI

---

## Chat Panels

### WasabiPanel (`src/core/WasabiPanel.jsx`) — Sushi Roll Mode
- Full-featured chat with page context awareness
- Knows about active page, its data, and schema
- Can modify records, create views, run automations
- Shows tool execution feedback
- Width: ~320px sidebar panel

### ZenChatPanel (`src/zen/ZenChatPanel.jsx`) — Sashimi Mode
- Simplified chat for Sashimi mode
- Lazy-loaded: `React.lazy(() => import("./zen/ZenChatPanel.jsx"))`
- Focused on tasks, calendar, and general questions

### ChatPanel View (`src/views/ChatPanel.jsx`) — Page-Level Chat
- Embeddable chat view within a page
- Has full context of the page's data and schema

### Chat UI (`src/core/ChatUI.jsx`)
- Shared chat UI components (message bubbles, input, etc.)
- Used by both WasabiPanel and ZenChatPanel

---

## AI-Curated Tasks (`src/zen/useAICuratedTasks.js`)

Custom hook that:
1. Fetches tasks from connected Notion databases
2. Uses AI to prioritize and surface relevant tasks
3. Caches results with timestamps
4. Returns `{ aiTasks, loading, lastUpdated, refresh, error }`

Used by `ZenTasksView` to show "FROM YOUR DATABASES" section.

---

## Automations (`src/agent/automations.js`)

Rule-based automation engine:
- `createAutomationEngine()` — factory function
- Evaluates trigger conditions against data changes
- Executes action chains (notify, update record, call API, etc.)
- Managed via `src/core/AutomationPage.jsx`

## Flow Executor (`src/agent/flowExecutor.js`)

Executes visual node-based flows:
- Traverses node graph from trigger to outputs
- Handles branching (conditions), transformations, AI nodes
- Logs execution history via `createFlowExecution()` API

---

## Cost Tracking (`src/utils/costTracker.js`)

Tracks AI API usage costs per session. Helps monitor Claude API consumption.
