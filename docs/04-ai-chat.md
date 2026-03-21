# Wasabi Platform: AI Agent System

**Version:** March 2026
**Overview:** Wasabi features a conversational AI agent powered by Claude, integrated with your workspace data. The agent handles queries, tool execution, automations, and visual flows.

---

## Agent Architecture

### Core Files

| File | Purpose |
|------|---------|
| `runAgent.js` | Core agentic loop: Claude API calls + tool execution + retry logic |
| `tools.js` | Tool definitions (schemas) available to Claude |
| `toolExecutor.js` | Tool execution dispatch — maps tool names to API calls |
| `wasabiPrompt.js` | System prompt builder — injects KB, page context, date, etc. |
| `queryClassifier.js` | Classifies user queries to route to correct agent tier |
| `dataSummary.js` | Generates compact data summaries for agent context |
| `memory.js` | Knowledge base + conversation memory management |
| `automations.js` | Automation rule engine — D1 rules polling + execution |
| `flowExecutor.js` | Visual flow executor — node-graph traversal + branching |
| `costTracker.js` | Tracks Claude API usage costs per session |

---

## Agent Loop (`src/agent/runAgent.js`)

### Core Function

```javascript
export async function runAgent({
  messages,                    // Conversation history
  systemPrompt,                // System prompt text
  tools,                        // Tool definitions array
  model,                        // Claude model ID (e.g. "claude-3-5-sonnet")
  workerUrl,                    // Wasabi worker URL
  claudeKey,                    // Anthropic API key
  executeTool,                  // (toolName, input) => string result
  onToolCall,                   // Optional: callback on tool execution
  onToolApproval,               // Optional: async gate for write tools
  onStatus,                      // Optional: status/progress updates
  abortRef,                      // Optional: { current: boolean } for cancellation
  maxIterations = 12,            // Max loop iterations
  maxTokens = 2048,              // Max tokens per response
  tier = "unknown",              // "haiku"|"sonnet"|"unknown"
  routeReason = "",              // Why this tier was chosen
})
```

### Loop Behavior

**Iteration Process:**
1. **Send to Claude:** POST to Claude API with conversation messages + tools
2. **Parse Response:** Extract text + tool_use blocks
3. **Tool Execution:**
   - For each tool_use block: call `executeTool(name, input)`
   - If `onToolApproval` provided and tool is write operation: gate execution
   - Feed result back as tool_result message
4. **Retry Logic:** If stop_reason is `tool_use`, loop again
5. **Exit Conditions:**
   - stop_reason is `end_turn` → return final text
   - Iteration reaches `maxIterations` → break
   - `abortRef.current` is true → abort
   - No more tool_use blocks → return

### Write Tool Gating

**Write Tools:** `create_page`, `update_page`, `send_email`, `delete_calendar_event`, etc.

**Approval Flow (if `onToolApproval` provided):**
1. Collect all pending write tool blocks
2. Call `onToolApproval(writeBlocks)` (async)
3. If returns true: execute tools
4. If returns false: return error to Claude

**Usage:** Implements "confirm" agent mode before mutations

### History Trimming

```javascript
export function trimHistory(messages, maxPairs = 3)
// Keeps last N user/assistant exchanges
// Drops old tool_result messages (prevent hallucination anchoring)
```

**Purpose:** Prevent stale data from earlier failed attempts from poisoning later responses

---

## Tool Definitions (`src/agent/tools.js`)

### Shared Tools

**Available to all agents:**

| Tool | Purpose | Input Parameters |
|------|---------|------------------|
| `query_database` | Query any data source | `database_id`, `filter`, `sorts` |
| `get_page` | Fetch single Notion page | `page_id` |
| `create_page` | Create record in database | `database_id`, `properties` |
| `update_page` | Update record properties | `page_id`, `properties`, `database_id` |
| `post_notification` | Create user notification | `message`, `type`, `source`, `record_id` |

**Note:** Results capped at 200 rows (50 for direct Notion). If `truncated: true`, not all data returned.

### Wasabi-Specific Tools

| Tool | Purpose |
|------|---------|
| `update_database` | Add/rename/remove properties from Notion schema |
| `cross_database_query` | Query multiple databases in one call |
| `create_database` | Create new Notion database |
| `detect_schema` | Fetch and classify Notion database schema |
| `create_page_config` | Create Wasabi page config (D1 or linked) |
| `update_knowledge_base` | Write/update KB entries |
| `search_knowledge_base` | Search KB by keyword |
| `process_uploaded_files` | Process files from user upload |
| `smart_match_records` | Fuzzy-match records across tables |
| `create_automation_rule` | Create D1 automation rule |
| `query_neurons` | Search neuron (semantic link) graph |
| `create_neuron` | Create new neuron connection |
| `run_calculation` | Execute transform function on data |
| `batch_operations` | Batch create/update/delete rows |
| `save_custom_function` | Create/save transform or aggregation |
| `list_custom_functions` | List available custom functions |
| `run_custom_function` | Execute custom function |
| `delete_custom_function` | Delete custom function |

### Gmail/Calendar Tools

| Tool | Purpose |
|------|---------|
| `search_emails` | Search Gmail by query |
| `get_email` | Fetch email message by ID |
| `send_email` | Send email or reply |
| `modify_email` | Archive, trash, mark read, etc. |
| `create_email_draft` | Create unsent draft |
| `list_calendar_events` | Query events in time range |
| `create_calendar_event` | Create calendar event |
| `update_calendar_event` | Update event details |
| `delete_calendar_event` | Delete event |

---

## Tool Executor (`src/agent/toolExecutor.js`)

### Tool Dispatch

```javascript
export async function executeTool(toolName, toolInput, context)
// Dispatch tool call to appropriate handler
// Returns: { result, error?, metadata? }
```

### Data Source Routing

Determines where tool applies:
- **D1 Tables:** Query via `/tables/{id}/rows`
- **D1 Sheets:** Query via `/sheets/{id}`
- **Linked Google Sheets:** Fetch via `/sheets/fetch` proxy
- **Linked Monday.com:** Query via `/monday/graphql` proxy
- **Linked Notion:** Query via `/query` proxy
- **Transformations:** Execute in sandbox (see below)

### Sandbox Execution

**Custom Functions & Transforms:** Execute in restricted sandbox with whitelisted helpers:

**Available in Sandbox:**
```javascript
_sbSum(arr)         // Array sum
_sbAvg(arr)         // Average
_sbMin/Max(arr)     // Min/max
_sbGroupBy(arr, key) // Group array by key
_sbSortBy(arr, key, dir) // Sort array
_sbUnique(arr, key) // Unique values
_sbRound(n, decimals) // Round number
_sbDateAdd(dateStr, days) // Add days to date
_sbDateDiff(d1, d2) // Days between dates
_sbCurrency(n, currency) // Format as currency
_sbPercent(n, decimals) // Format as percent
_sbCompact(n)       // Compact number (K, M)
_sbFlatten(arr)     // Flatten nested array
_sbPick/Omit(obj, keys) // Pick/omit object keys
_sbChunk(arr, size) // Split array into chunks
```

**Security:** `eval()` and `new Function()` blocked; validation on function code

---

## System Prompt Builder (`src/agent/wasabiPrompt.js`)

### Prompt Construction

```javascript
export function buildWasabiPrompt({
  platformDbIds,          // Platform infrastructure DB IDs
  kbContext,              // Knowledge base context injection
  currentPageContext,     // { pageName, databaseIds, schemaText }
  dataSummary,            // Compact data summary
  workspaceSummary,       // All workspace pages
  neuronSummary,          // Neuron (semantic link) graph
  currentDate,            // Today's date (YYYY-MM-DD)
  workspaceInstructions,  // Custom AI instructions
  agentMode,              // "auto" | "confirm" | "plan"
  googleContext,          // Gmail/Calendar snippet
})
```

### Prompt Sections

**Included in Order:**
1. **Identity:** "You are Wasabi, an AI assistant for managing..." (immutable)
2. **Data Integrity Preamble:** "You operate on real business data. Extreme accuracy..."
3. **Context:** Today's date, day of week
4. **Workspace Instructions:** User-provided custom instructions
5. **Agent Behavior:** Mode-specific instructions (auto/confirm/plan)
6. **Capabilities:** Capabilities list (data management, analysis, etc.)
7. **View Library:** Available view types (table, kanban, etc.)
8. **Inline Charts:** Chart code examples
9. **Templates:** Injected from config/templates.js
10. **Tools Guide:** How to use available tools
11. **System Builder:** Logic for building complex queries
12. **Analytical Responses:** Guidelines for analysis
13. **Rules:** Data integrity rules
14. **KB Context:** Knowledge base snippets
15. **Workspace Pages:** Summary of all databases
16. **Neuron Graph:** Semantic links
17. **Google Context:** Gmail/Calendar summary
18. **Page Context:** Current page schema + data summary

### Agent Behavior Modes

**"auto"** (default):
- Agent executes tools without asking
- Best for automation and quick queries

**"confirm"**:
- Agent asks before write operations (create, update, delete)
- Read operations execute immediately
- User approval gates all mutations

**"plan"**:
- Agent presents plan before execution
- Numbered steps with tools and affected data
- Requires user "Execute plan" confirmation

---

## Chat UI Components

### ChatUI (`src/core/ChatUI.jsx`)

Shared chat component with:
- Message rendering (user, assistant, tool status)
- Streaming support (live token display)
- Tool call feedback ("Updating record...", "Querying database...")
- Input with message history navigation
- Error handling + retry UI

**Props:**
```javascript
<ChatUI
  messages={[]}           // Conversation array
  onSend={(text) => {}}   // Send message callback
  isLoading={false}       // Disable input while processing
  tier="sonnet"           // Model tier display
  toolCalls={[]}          // Active tool execution status
  error={null}            // Error banner
/>
```

### ChatPanel (`src/views/ChatPanel.jsx`)

Embeddable chat within a page:
- Full page context awareness
- Can modify records in this page
- Inline data queries
- 455 lines

### ZenChatPanel (`src/zen/ZenChatPanel.jsx`)

Lightweight chat for Sashimi mode:
- Tasks, calendar, general queries
- 476 lines
- Lazy-loaded

---

## Knowledge Base & Memory (`src/agent/memory.js`)

### KB Functions

```javascript
export async function writeKB(category, key, content, source, related_pages)
// Create/update KB entry

export async function searchKB(query, category?)
// Search KB by keyword

export function kbResultsToText(results)
// Format KB results for agent context
```

**KB Storage:** D1 table `knowledge_base` with:
- `category` (e.g., "business_rules", "domain_knowledge")
- `key` (identifier)
- `content` (markdown text)
- `source` (where KB came from)
- `related_pages` (JSON array of page IDs)

### Conversation Memory

Conversation history stored in component state; no persistent backend storage.

---

## Automations Engine (`src/agent/automations.js`)

### Automation Model

Hardcoded as: `claude-haiku-4-5-20251001`

### D1 Rules

```javascript
export function parseD1Rule(row)
// Convert automation_rules row to normalized rule object

export function expandTemplate(template, data)
// Replace {{fieldName}} with values
```

**Trigger Types:**
- `schedule` (cron expression)
- `status_change` (field value changes)
- `field_change` (specific field changed)
- `page_created` (new record created)
- `manual` (user-triggered)

**Action Config:**
```javascript
{
  instruction: "Check inventory and alert if below {{ThresholdQty}}",
  // {{field}} variables expanded with data
}
```

**Polling:** Browser-side automation runs every 5 minutes (configurable)

---

## Flow Executor (`src/agent/flowExecutor.js`)

### Node Graph Execution

```javascript
export async function executeFlow(flow, context)
// Traverse flow graph from trigger node(s) to outputs
// Returns: execution results + history
```

### Node Types Supported

- **Trigger:** Entry point (schedule, manual, event)
- **Data Node:** Query database, fetch external data
- **Transform:** Run custom function on data
- **Branch:** Conditional splits (if/else)
- **AI Node:** Call Claude with context
- **Action:** Update records, send email, post notification
- **Output:** Return result

### Error Handling Issues (Known Issue #6)

**Location:** lines 211-243

**Problem:** Retry logic error handling has subtle bugs
- `retried` flag only set on success, not after all retries fail
- Original error `err` logged again instead of final `retryErr`

**Impact:** Incorrect flow execution status reporting

---

## Cost Tracking (`src/utils/costTracker.js`)

### Usage Recording

```javascript
export function recordUsage(model, inputTokens, outputTokens)
// Track token usage for cost calculation
```

**Pricing (hardcoded):**
- claude-3-5-sonnet: $3/$15 per M tokens
- claude-3-5-haiku: $0.80/$4 per M tokens

**Per-Session Tracking:** Cost accumulated in session state, displayed in UI

---

## Data Summary (`src/agent/dataSummary.js`)

### Compact Context Generation

```javascript
export function generateDataSummary(records, schema, limit)
// Creates compact summary of records for agent prompt
// Avoids massive context bloat
```

**Strategy:**
- Sample first N records (default 10)
- Include key fields from schema
- Aggregate counts/summaries
- Return markdown for prompt injection

---

## Query Classifier (`src/agent/queryClassifier.js`)

### Query Routing

Classifies user queries to determine:
- **Agent tier:** Haiku (simple) vs Sonnet (complex)
- **Required context:** Page data, schema, KB, etc.
- **Tool set:** Which tools to enable

**Example Classifications:**
- "What's my next meeting?" → Haiku (Calendar)
- "Analyze Q1 sales trends" → Sonnet (Complex analysis)
- "Create a product database" → Sonnet (Schema management)

---

## Known Issues & Gaps

### Issue #5: Unhandled Promise Rejection (MAJOR)

**Location:** `src/context/PagesContext.jsx` lines 38-78

**Problem:** Async operations in useEffect without proper cleanup
- No AbortController for request cancellation
- `.catch(() => {})` silently swallows errors
- State updates may occur on unmounted component

**Impact:** Memory leaks, inconsistent state

---

### Issue #6: Flow Executor Error Reporting (MAJOR)

**Location:** `src/agent/flowExecutor.js` lines 211-243

**Problem:** Retry logic error handling has bugs
- `retried` flag doesn't properly track all retry failures
- Wrong error object logged on final failure

**Impact:** Flow execution status reports incorrectly

---

### Issue #8: Missing Input Validation (MODERATE)

**Location:** `src/agent/toolExecutor.js` sandbox execution

**Problem:** `new Function()` used for code execution with minimal validation
- Checks for `eval` and `new Function` in source code
- But indirect calls can bypass: `Function.constructor`, minification, obfuscation

**Impact:** Sandbox escape possible

**Fix:** Use proper sandboxing library (vm2, isolated-vm)

---

### Issue #13: Hardcoded Automation Model (MINOR)

**Location:** `src/agent/automations.js` line 21

**Problem:** Automation model hardcoded as Haiku
```javascript
const AUTOMATION_MODEL = "claude-haiku-4-5-20251001";
```

**Impact:** No flexibility for complex automation rules

**Fix:** Make configurable based on rule complexity

---

## Testing Checklist

- [ ] Agent loop: Multi-turn conversations with tool use
- [ ] Tool execution: All tool types (query, create, update, delete)
- [ ] Error handling: Invalid inputs, API failures, timeouts
- [ ] Tool gating: Write tools require approval in "confirm" mode
- [ ] History trimming: Old messages discarded, no hallucinations
- [ ] Automations: Rules trigger, execute correctly, log history
- [ ] Flows: Nodes execute in order, branching works, outputs captured
- [ ] Knowledge base: KB entries created, searched, injected in prompt
- [ ] Cost tracking: Token usage recorded, costs calculated correctly
- [ ] Cancellation: Abort signal stops agent loop promptly

---

## References

- **Agent Loop:** `src/agent/runAgent.js` main function
- **Tool Schemas:** `src/agent/tools.js` (40+ tool definitions)
- **System Prompt:** `src/agent/wasabiPrompt.js` (immutable identity)
- **Tool Dispatch:** `src/agent/toolExecutor.js` (execute_tool handler)
- **Code Review:** code-review.md (security + logic issues)
