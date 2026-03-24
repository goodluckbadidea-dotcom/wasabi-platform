# 04 — AI Agent System

## Product Context

In Wasabi, AI is a core collaborator, not a bolt-on feature. Users build persistent semantic scaffolding — Knowledge Base entries, Neurons, page hierarchies, automation rules — that accumulates over time. The AI draws from this scaffolding on every interaction, so each conversation builds on everything before it. The more a user organizes, the more accurate and contextual the AI becomes.

---

## How AI Uses the Scaffolding

The AI system prompt is assembled dynamically from four layers of persistent context:

1. **Knowledge Base** — User-curated domain rules, business context, and operational knowledge stored in the `knowledge_base` D1 table. All KB entries are injected directly into the system prompt so the AI has institutional memory without the user repeating themselves.

2. **Neurons** — Named relationship clusters linking records, pages, and fields across the workspace. The AI queries the neuron graph to understand connections (e.g., which vendors supply which SKUs, or which projects depend on which inventory items).

3. **Page Structure** — The hierarchy of pages, folders, and views tells the AI what matters and how data relates. A workspace summary of all pages is included so the AI can reason about cross-table operations.

4. **Data Summary** — `dataSummary.js` builds a compact representation of the current page's records within token budget constraints: it samples rows, includes key schema fields, and generates aggregate counts. This prevents context blowout while giving the AI enough data to reason.

---

## Agent Loop

**File:** `src/agent/runAgent.js`

The agent loop is the core execution cycle for all AI interactions:

```
User message
  → queryClassifier determines strategy, complexity, estimated tools
  → Model routing: Haiku (fast/cheap) or Sonnet (complex reasoning)
  → runAgent builds system prompt (KB + neurons + page context + data summary)
  → Claude API call with conversation history + tool definitions
  → If response contains tool_use blocks:
      → toolExecutor runs each tool against the worker API
      → Tool results fed back as tool_result messages
      → Loop continues (up to maxIterations = 12)
  → If stop_reason is end_turn → return final text to user
```

**Exit conditions:** `end_turn` stop reason, max iterations reached, abort signal set, or no more tool_use blocks.

**Write tool gating:** When `onToolApproval` is provided (confirm mode), write operations (create, update, delete, send) are collected and gated behind user approval before execution.

**History trimming:** `trimHistory(messages, maxPairs)` keeps only the last N user/assistant exchanges and drops old tool_result messages to prevent stale data from poisoning later responses.

---

## Query Classifier

**File:** `src/agent/queryClassifier.js`

Classifies each user message before it reaches the model to determine:

| Output | Values | Purpose |
|--------|--------|---------|
| Strategy | `direct` / `data` / `action` / `complex` | What kind of work the query requires |
| Complexity | low / medium / high | How much reasoning is needed |
| Estimated tools | count of tools likely needed | Informs iteration budget |
| Model route | Haiku or Sonnet | Cost/capability tradeoff |

**Routing logic:**
- Simple lookups, greetings, calendar checks → **Haiku** (claude-haiku-4-5-20251001) — fast and cheap
- Multi-step analysis, schema creation, cross-table reasoning → **Sonnet** — higher capability

---

## Tool Executor

**File:** `src/agent/toolExecutor.js`

Dispatches tool calls from the Claude response to the appropriate worker API endpoint. Over 50 tools organized by category:

| Category | Tools |
|----------|-------|
| **CRUD** | `query_database`, `create_page`, `update_page`, `get_page`, `cross_database_query`, `batch_operations`, `create_database`, `detect_schema`, `create_page_config` |
| **Email** | `search_emails`, `get_email`, `send_email`, `modify_email`, `create_email_draft` |
| **Calendar** | `list_calendar_events`, `create_calendar_event`, `update_calendar_event`, `delete_calendar_event` |
| **Automation** | `create_automation_rule`, `save_custom_function`, `list_custom_functions`, `run_custom_function`, `delete_custom_function`, `run_calculation` |
| **Neurons** | `query_neurons`, `create_neuron` |
| **Knowledge Base** | `update_knowledge_base`, `search_knowledge_base` |
| **Records** | `smart_match_records`, `process_uploaded_files`, `post_notification` |

### Tool Safety

Three layers protect against malicious or runaway code execution:

1. **`validatePluginCode` blocklist** — Scans function/plugin code for dangerous patterns (`eval`, `Function`, `import`, `require`, `fetch`, `XMLHttpRequest`, etc.) before execution. Blocks indirect bypass attempts.

2. **`TIMEOUT_GUARD` (5-second deadline)** — Wraps code execution in a timeout. If a function exceeds 5 seconds, execution is terminated and an error is returned.

3. **Infinite loop detection** — Scans code for `while(true)`, `for(;;)`, and similar patterns before execution to prevent resource exhaustion.

### Sandbox Helpers

Custom functions execute in a restricted scope with whitelisted helper functions: `_sbSum`, `_sbAvg`, `_sbMin`, `_sbMax`, `_sbGroupBy`, `_sbSortBy`, `_sbUnique`, `_sbRound`, `_sbDateAdd`, `_sbDateDiff`, `_sbCurrency`, `_sbPercent`, `_sbCompact`, `_sbFlatten`, `_sbPick`, `_sbOmit`, `_sbChunk`.

---

## Data Summary

**File:** `src/agent/dataSummary.js`

Builds compact data context for the AI within token budget constraints:

- Samples the first N records from the current page (default 10)
- Includes key fields from the table schema
- Generates aggregate counts and summaries
- Returns markdown formatted for prompt injection
- Prevents massive context blowout on large tables

Cached summaries are stored in the `data_summary_cache` D1 table keyed by `page_id`.

---

## System Prompt Builder

**File:** `src/agent/wasabiPrompt.js`

Assembles the full system prompt in order:

1. Identity and data integrity preamble (immutable)
2. Current date and day of week
3. User-provided workspace instructions
4. Agent behavior mode instructions (auto / confirm / plan)
5. Capabilities list, view library, chart examples, templates
6. Tools guide and system builder
7. Analytical response guidelines and data integrity rules
8. KB context (all knowledge base entries)
9. Workspace pages summary (all databases)
10. Neuron graph (semantic links)
11. Google context (Gmail/Calendar summary, if connected)
12. Current page context: schema + data summary

### Agent Behavior Modes

| Mode | Behavior |
|------|----------|
| **auto** | Executes tools without asking. Best for automation and quick queries. |
| **confirm** | Asks before write operations (create, update, delete). Reads execute immediately. |
| **plan** | Presents a numbered plan before execution. Requires user confirmation. |

---

## Automations Engine

**File:** `src/agent/automations.js`

Automation rules are evaluated by the worker cron trigger, which fires every 2 minutes (`*/2 * * * *`). The cron handler iterates enabled rules, checks trigger conditions, and executes matching rules via Claude Haiku.

**Model:** `claude-haiku-4-5-20251001` (hardcoded)

### Trigger Types

| Type | Condition |
|------|-----------|
| `schedule` | Cron expression matches current time |
| `status_change` | A watched field value changed (detected via `rule_snapshots`) |
| `field_change` | A specific field was modified |
| `page_created` | A new record was created in the scoped table |
| `manual` | User-triggered via UI or MCP |

### Execution

The `action_config.instruction` field is an AI prompt that supports `{{fieldName}}` template variables. When a rule fires:

1. Template variables are expanded with current record data
2. The instruction is sent to Claude Haiku with relevant table context
3. The model can use tools (query, update, notify, email) to carry out the action
4. `fire_count` is incremented and `last_fired_at` is updated

---

## Flow Executor

**File:** `src/agent/flowExecutor.js`

Executes multi-step DAG-based workflows defined as node graphs. Flows are more powerful than single-action automation rules — they support branching, delays, and chained actions.

### Node Types

| Type | Purpose |
|------|---------|
| **trigger** | Entry point: schedule, manual, or event-based |
| **condition** | Branching logic (if/else splits) |
| **action** | Execute an operation: update records, send email, post notification. Uses `config.instruction` for AI-powered steps. |
| **delay** | Wait a specified duration before continuing |

### Execution Model

The executor traverses the graph from trigger nodes following edges. Each node's output feeds into connected nodes. Execution state is recorded per-node in `flow_executions.node_states`. Failed nodes can be retried based on the flow configuration.

---

## Cost Tracking

**File:** `src/agent/costTracker.js`

Token usage is recorded per API request:

- Input and output tokens tracked separately
- Cost calculated against model pricing
- Per-session accumulation displayed in the chat UI
- Usage data helps monitor AI spend across the workspace

---

## Chat UI Components

Two chat surfaces use the same agent loop (`runAgent`):

| Component | File | Context |
|-----------|------|---------|
| **WasabiPanel** | `src/core/WasabiPanel.jsx` | Desktop sidebar chat. Persistent across page navigation. Full workspace context. |
| **ChatPanel** | `src/features/ChatPanel.jsx` | Full-screen chat. Page-scoped context. Lazy-loaded. |

Both components render messages, display tool call feedback ("Querying database...", "Updating record..."), support streaming, and show the active model tier (Haiku/Sonnet).

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/agent/runAgent.js` | Agent loop: classify, route, call Claude, execute tools, respond |
| `src/agent/queryClassifier.js` | Determines strategy, complexity, model routing |
| `src/agent/toolExecutor.js` | 50+ tool implementations dispatched to worker API |
| `src/agent/tools.js` | Tool definitions (name, description, parameters) for Claude |
| `src/agent/wasabiPrompt.js` | System prompt builder — injects KB, neurons, page context, data summary |
| `src/agent/dataSummary.js` | Compact data context within token budget |
| `src/agent/automations.js` | Cron-triggered automation rule engine |
| `src/agent/flowExecutor.js` | DAG-based multi-step workflow executor |
| `src/agent/costTracker.js` | Token usage and cost tracking |
| `src/agent/memory.js` | Knowledge base read/write helpers |
