// ─── Wasabi Tool Definitions ───
// Tool schemas for Claude's tool_use. Organized by agent type.

// ─── SHARED TOOLS (used by multiple agents) ───

const QUERY_DATABASE = {
  name: "query_database",
  description: "Query any data source by its page ID. Supports D1 tables, D1 sheets, linked Google Sheets (read-only), linked Monday.com boards, and linked Notion databases. Returns matching records with all properties.",
  input_schema: {
    type: "object",
    properties: {
      database_id: {
        type: "string",
        description: "The database ID to query (Notion DB ID or D1 table ID).",
      },
      filter: {
        type: "object",
        description: "Optional Notion filter object. See Notion API docs for filter syntax.",
      },
      sorts: {
        type: "array",
        description: "Optional array of sort objects. E.g. [{property: 'Name', direction: 'ascending'}]",
      },
    },
    required: ["database_id"],
  },
};

const GET_PAGE = {
  name: "get_page",
  description: "Get a single Notion page by ID. Returns all properties.",
  input_schema: {
    type: "object",
    properties: {
      page_id: { type: "string", description: "The Notion page ID." },
    },
    required: ["page_id"],
  },
};

const CREATE_PAGE = {
  name: "create_page",
  description: "Create a new record/row in a database (D1 standalone table or Notion database). Provide the database_id and a properties object.",
  input_schema: {
    type: "object",
    properties: {
      database_id: { type: "string", description: "Target database ID." },
      properties: {
        type: "object",
        description: "Page properties in Notion API format. Use title, rich_text, select, number, date, checkbox, url, email, phone_number, multi_select, or relation types.",
      },
    },
    required: ["database_id", "properties"],
  },
};

const UPDATE_PAGE = {
  name: "update_page",
  description: "Update properties of an existing record. For D1 rows, provide database_id + page_id (the row ID). For Notion pages, just provide page_id.",
  input_schema: {
    type: "object",
    properties: {
      page_id: { type: "string", description: "The page/row ID to update. For D1 rows, this is the row ID." },
      database_id: { type: "string", description: "Optional: the D1 table ID when updating a D1 row." },
      properties: {
        type: "object",
        description: "Properties to update. For D1 rows, use flat key-value pairs (e.g. {\"Status\": \"Done\", \"Priority\": 3}). For Notion pages, use Notion API format.",
      },
    },
    required: ["page_id", "properties"],
  },
};

const POST_NOTIFICATION = {
  name: "post_notification",
  description: "Post a notification to the user's notification feed. Use for alerts, summaries, or status updates.",
  input_schema: {
    type: "object",
    properties: {
      message: { type: "string", description: "The notification message." },
      type: {
        type: "string",
        enum: ["notification", "alert", "summary"],
        description: "Notification type. 'alert' for urgent, 'summary' for reports.",
      },
      source: { type: "string", description: "Source label (e.g. page name or automation name)." },
    },
    required: ["message"],
  },
};

// ─── WASABI-ONLY TOOLS ───

const UPDATE_DATABASE = {
  name: "update_database",
  description: "Update a Notion database's schema: add, rename, or remove properties. Can also update the database title.",
  input_schema: {
    type: "object",
    properties: {
      database_id: { type: "string", description: "The database ID to update." },
      title: { type: "string", description: "Optional new title for the database." },
      add_properties: {
        type: "array",
        description: "Properties to add. Each: {name, type, options?}.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            format: { type: "string" },
          },
          required: ["name", "type"],
        },
      },
      rename_properties: {
        type: "object",
        description: "Map of old property name -> new name.",
      },
      remove_properties: {
        type: "array",
        items: { type: "string" },
        description: "Property names to remove from the schema.",
      },
    },
    required: ["database_id"],
  },
};

const CROSS_DATABASE_QUERY = {
  name: "cross_database_query",
  description: "Query multiple Notion databases in one call. Returns combined results. Useful for dashboards and cross-referencing.",
  input_schema: {
    type: "object",
    properties: {
      queries: {
        type: "array",
        description: "Array of query objects. Each has: database_id, filter (optional), sorts (optional), label (optional, for identifying results).",
        items: {
          type: "object",
          properties: {
            database_id: { type: "string" },
            filter: { type: "object" },
            sorts: { type: "array" },
            label: { type: "string" },
          },
          required: ["database_id"],
        },
      },
    },
    required: ["queries"],
  },
};

const CREATE_DATABASE = {
  name: "create_database",
  description: "Create a new Notion database. Define the schema with property names, types, and options.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Database title." },
      schema: {
        type: "array",
        description: "Array of field definitions. Each has: name (string), type (title|rich_text|number|select|status|multi_select|date|checkbox|url|email|phone_number|relation), and optional 'options' (for select/multi_select/status) or 'format' (for number).",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            format: { type: "string" },
          },
          required: ["name", "type"],
        },
      },
    },
    required: ["title", "schema"],
  },
};

const DETECT_SCHEMA = {
  name: "detect_schema",
  description: "Analyze a Notion database's schema. Returns all property names, types, options, and suggests which views would work well.",
  input_schema: {
    type: "object",
    properties: {
      database_id: { type: "string", description: "The database ID to analyze." },
    },
    required: ["database_id"],
  },
};

const CREATE_PAGE_CONFIG = {
  name: "create_page_config",
  description: "Create a new page config in the Wasabi platform (saved to D1). Defines the page name, icon, connected databases, views layout, and agent configuration.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Page display name." },
      icon: { type: "string", description: "Page icon emoji." },
      databaseIds: {
        type: "array",
        items: { type: "string" },
        description: "Connected Notion database IDs.",
      },
      views: {
        type: "array",
        description: "Views to display. Each has: type (table|gantt|cardGrid|kanban|charts|form|summaryTiles|activityFeed|document|notificationFeed|chat), position (main|sidebar|bottom), and config (view-specific settings).",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
            position: { type: "string" },
            config: { type: "object" },
          },
          required: ["type"],
        },
      },
      agentPrompt: {
        type: "string",
        description: "Custom system prompt for this page's agent. Describe its role and knowledge.",
      },
      parent_id: {
        type: "string",
        description: "Parent workspace or folder ID for the new page.",
      },
    },
    required: ["name", "databaseIds", "views"],
  },
};

const UPDATE_KNOWLEDGE_BASE = {
  name: "update_knowledge_base",
  description: "Write an entry to Wasabi's knowledge base for persistent memory. Always ask the user for permission first.",
  input_schema: {
    type: "object",
    properties: {
      key: { type: "string", description: "Unique key for this knowledge entry." },
      category: {
        type: "string",
        enum: ["general", "project", "preference", "workflow", "reference"],
        description: "Category: general (default), project (project-specific context), preference (user preferences), workflow (process/SOP), reference (data definitions & schemas).",
      },
      content: { type: "string", description: "The knowledge content to store." },
    },
    required: ["key", "category", "content"],
  },
};

const SEARCH_KNOWLEDGE_BASE = {
  name: "search_knowledge_base",
  description: "Search Wasabi's knowledge base for relevant context. Use before answering questions to check for stored preferences or patterns.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query text." },
      category: {
        type: "string",
        enum: ["general", "project", "preference", "workflow", "reference"],
        description: "Optional category filter.",
      },
    },
    required: ["query"],
  },
};

// ─── FILE PROCESSING TOOLS ───

const PROCESS_UPLOADED_FILES = {
  name: "process_uploaded_files",
  description: "Process uploaded files and propose actions. Parses file content, extracts structured data, and returns proposed operations (create records, update records, attach to existing). Use this after a user uploads files to analyze them and suggest next steps.",
  input_schema: {
    type: "object",
    properties: {
      files: {
        type: "array",
        description: "Array of file objects from the upload. Each has: name, type, text (content), size.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string" },
            text: { type: "string" },
          },
          required: ["name", "text"],
        },
      },
      target_database_id: {
        type: "string",
        description: "Optional: target database ID to create records in. If not provided, the agent will suggest a target.",
      },
      action: {
        type: "string",
        enum: ["analyze", "create_records", "index_to_kb"],
        description: "Action to perform: 'analyze' to parse and summarize, 'create_records' to bulk-insert rows into a D1 table or create Notion records from file data, 'index_to_kb' to save to knowledge base.",
      },
    },
    required: ["files", "action"],
  },
};

const SMART_MATCH_RECORDS = {
  name: "smart_match_records",
  description: "Search existing records in a database to find potential matches for uploaded data. Use this to avoid creating duplicates and to suggest linking files to existing records.",
  input_schema: {
    type: "object",
    properties: {
      database_id: {
        type: "string",
        description: "Database to search for matches.",
      },
      search_terms: {
        type: "array",
        items: { type: "string" },
        description: "Terms to search for (e.g. extracted names, IDs, or key values from uploaded files).",
      },
      match_field: {
        type: "string",
        description: "Optional: specific property name to match against.",
      },
    },
    required: ["database_id", "search_terms"],
  },
};

// ─── AUTOMATION TOOLS ───

const CREATE_AUTOMATION_RULE = {
  name: "create_automation_rule",
  description: "Create an automation rule in the Automation Rules database. Rules can trigger on schedule, status_change, field_change, page_created, or manual.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Rule name." },
      description: { type: "string", description: "What this rule does." },
      trigger: {
        type: "string",
        enum: ["schedule", "status_change", "field_change", "page_created", "manual"],
        description: "Trigger type.",
      },
      trigger_config: {
        type: "object",
        description: "Trigger-specific configuration. For schedule: {interval_minutes}. For status_change: {database_id, field, from, to}. For field_change: {database_id, field}. For page_created: {database_id}.",
      },
      instruction: {
        type: "string",
        description: "The instruction to execute when triggered. Can include {{field_name}} template variables for fast-path execution.",
      },
      database_id: { type: "string", description: "The database this rule operates on." },
      owner_page: { type: "string", description: "The page config ID that owns this rule." },
    },
    required: ["name", "trigger", "instruction", "database_id"],
  },
};

// ─── Neuron Tools ───

const QUERY_NEURONS = {
  name: "query_neurons",
  description: "Query the neuron connection graph. Returns all neurons and their connected nodes, or neurons connected to a specific node. Use this to discover relationships between items (rows, pages, folders, cells) before answering questions about context or connections.",
  input_schema: {
    type: "object",
    properties: {
      node_id: {
        type: "string",
        description: "Optional. If provided, returns only neurons connected to this specific node ID (a page ID, row ID, folder ID, etc.). If omitted, returns the full neuron graph.",
      },
    },
    required: [],
  },
};

const CREATE_NEURON = {
  name: "create_neuron",
  description: "Create a new neuron connection linking multiple items together. A neuron represents a semantic relationship between 2+ items (rows, pages, folders, cells). Suggest creating neurons when users discuss relationships between items.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Optional name for the neuron (e.g., 'Q3 Launch Plan'). Leave empty for anonymous connections.",
      },
      nodes: {
        type: "array",
        description: "Array of nodes to connect. Each node needs node_type, node_id, and node_label.",
        items: {
          type: "object",
          properties: {
            node_type: { type: "string", description: "Type: 'row', 'page', 'folder', 'cell', 'column', or 'document'." },
            node_id: { type: "string", description: "The unique identifier for this node." },
            node_label: { type: "string", description: "Human-readable label for this node." },
          },
          required: ["node_type", "node_id", "node_label"],
        },
      },
    },
    required: ["nodes"],
  },
};

// ─── CALCULATION TOOL ───

const RUN_CALCULATION = {
  name: "run_calculation",
  description: `Execute JavaScript code against queried datasets for precise, deterministic calculations. Use this instead of doing math in your head — especially for projections, running balances, time-series analysis, scoring, ranking, what-if scenarios, cumulative calculations, or anything involving more than simple arithmetic.

How to use:
1. First query your data with query_database or cross_database_query
2. Pass the query results as named datasets
3. Write JavaScript that processes the data and returns structured results
4. The result is returned to you for interpretation

Available in the sandbox:
- \`datasets\` — object with your named data arrays
- Helper functions: sum(arr), avg(arr), min(arr), max(arr), groupBy(arr, key), sortBy(arr, key, dir), unique(arr, key), round(n, decimals), dateAdd(dateStr, days), dateDiff(dateStr1, dateStr2), weeksBetween(dateStr1, dateStr2)

Your code must return a value — use an IIFE: (function() { ... return result; })()`,
  input_schema: {
    type: "object",
    properties: {
      datasets: {
        type: "object",
        description: "Named datasets from previous query results. Pass the actual record arrays. E.g., { inventory: [...records...], sales: [...records...], purchaseOrders: [...records...] }",
      },
      code: {
        type: "string",
        description: "JavaScript code to execute. Access data via `datasets` object and helpers via function names. Must return JSON-serializable data. Use an IIFE: (function() { const results = []; ... return results; })()",
      },
      description: {
        type: "string",
        description: "Brief description of what this calculation does (shown to user for transparency).",
      },
    },
    required: ["datasets", "code", "description"],
  },
};

// ─── BATCH & EXPORT TOOLS ───

const BATCH_OPERATIONS = {
  name: "batch_operations",
  description: "Execute multiple create/update operations in a single call. Use this when you need to create or update 3+ records at once. Each operation is executed sequentially and results are collected. Max 50 operations per batch.",
  input_schema: {
    type: "object",
    properties: {
      operations: {
        type: "array",
        description: "Array of operations. Each has: action ('create_page' or 'update_page'), and params (same input as that tool).",
        items: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["create_page", "update_page"], description: "Which tool to execute." },
            params: { type: "object", description: "Same input as the individual tool (create_page or update_page)." },
          },
          required: ["action", "params"],
        },
      },
    },
    required: ["operations"],
  },
};

// ─── Custom Functions ───

const SAVE_CUSTOM_FUNCTION = {
  name: "save_custom_function",
  description: `Create or update a reusable custom function that persists in the user's workspace. The function is validated before saving:
1. Syntax check — verifies the code parses correctly
2. Dry run — fetches real data from declared inputs and executes the function
3. Schema validation — checks output matches declared output shape
4. Presents results for user approval before finalizing

The code must define a function called 'execute' that receives a single object parameter with named datasets (matching input keys) and returns a result matching the declared output schema. Available sandbox helpers: sum, avg, min, max, groupBy, sortBy, unique, round, dateAdd, dateDiff, weeksBetween.

Example: function execute({ sales, inventory }) { return Object.keys(groupBy(sales, "SKU")).map(sku => ({ sku, total: sum(sales.filter(r => r.SKU === sku).map(r => r.Units)) })); }`,
  input_schema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Optional ID for updating an existing function. Omit for new." },
      name: { type: "string", description: "Human-readable function name." },
      description: { type: "string", description: "What this function does." },
      type: {
        type: "string",
        enum: ["transform", "aggregation", "forecast", "alert", "pipeline"],
        description: "Function category: transform (reshape), aggregation (summarize), forecast (predict), alert (threshold check), pipeline (multi-step chain).",
      },
      inputs: {
        type: "object",
        description: "Declares input data sources. Each key is a dataset name. Value: { source: 'query_database', database_id: 'xxx', columns: ['col1', 'col2'] }.",
      },
      outputs: {
        type: "object",
        description: "Declares expected output shape. { type: 'table'|'number'|'chart_config', schema: { fieldName: 'string'|'number'|'date' } }.",
      },
      code: {
        type: "string",
        description: "JavaScript function body. Must define 'function execute(datasets) { ... return result; }'.",
      },
      _confirmed: { type: "boolean", description: "Set to true after user approves the dry-run preview to actually save." },
    },
    required: ["name", "type", "inputs", "outputs", "code"],
  },
};

const LIST_CUSTOM_FUNCTIONS = {
  name: "list_custom_functions",
  description: "List all saved custom functions. Use to discover available functions before running them.",
  input_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["draft", "active", "disabled"], description: "Filter by status." },
      type: { type: "string", enum: ["transform", "aggregation", "forecast", "alert"], description: "Filter by function type." },
    },
  },
};

const RUN_CUSTOM_FUNCTION = {
  name: "run_custom_function",
  description: `Execute a saved custom function with live data. Automatically gathers input data by running query_database for each declared input source, then executes the function code in a sandbox. Use list_custom_functions first to see available functions and their IDs.`,
  input_schema: {
    type: "object",
    properties: {
      function_id: { type: "string", description: "The ID of the custom function to execute." },
      overrides: {
        type: "object",
        description: "Optional overrides for input data. Pass pre-fetched datasets to skip auto-gather for specific inputs.",
      },
    },
    required: ["function_id"],
  },
};

const DELETE_CUSTOM_FUNCTION = {
  name: "delete_custom_function",
  description: "Permanently delete a saved custom function by ID.",
  input_schema: {
    type: "object",
    properties: {
      function_id: { type: "string", description: "The ID of the custom function to delete." },
    },
    required: ["function_id"],
  },
};

const EXPORT_REPORT = {
  name: "export_report",
  description: "Export data as a downloadable report. CSV downloads directly as a file. PDF opens a print dialog so the user can save as PDF. Query the data first, then format into headers and rows arrays.",
  input_schema: {
    type: "object",
    properties: {
      format: { type: "string", enum: ["csv", "pdf"], description: "Export format." },
      title: { type: "string", description: "Report title (used as filename and header)." },
      headers: { type: "array", items: { type: "string" }, description: "Column headers." },
      rows: {
        type: "array",
        items: { type: "array" },
        description: "Row data as arrays of values (one per row, matching headers order).",
      },
      summary: { type: "string", description: "Optional summary text shown at the top of PDF reports." },
    },
    required: ["format", "title", "headers", "rows"],
  },
};

const DELEGATE_TASK = {
  name: "delegate_task",
  description: "Delegate sub-tasks to parallel analysis agents for complex multi-part questions. Each sub-agent runs independently with read-only tools (query_database, search_knowledge_base, run_calculation). Max 5 sub-agents. Use when breaking down large analysis into 3+ focused, independent parts.",
  input_schema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        maxItems: 5,
        description: "Array of sub-tasks. Each gets its own agent.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Short label for this sub-task (e.g. 'Inventory Analysis')." },
            instruction: { type: "string", description: "What this sub-agent should analyze or compute. Be specific." },
            context: { type: "string", description: "Relevant data or context to pass to the sub-agent (e.g. database IDs, query results, rules)." },
          },
          required: ["label", "instruction"],
        },
      },
    },
    required: ["tasks"],
  },
};

// ─── GMAIL TOOLS ───

const SEARCH_EMAILS = {
  name: "search_emails",
  description: "Search the user's Gmail inbox. Uses Gmail search syntax (e.g. 'from:alice subject:budget', 'is:unread', 'after:2026/03/01'). Returns matching emails with subject, sender, date, and snippet.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Gmail search query. Examples: 'from:alice@co.com', 'subject:invoice', 'is:unread in:inbox', 'after:2026/03/01 before:2026/03/10'." },
      max_results: { type: "number", description: "Maximum number of emails to return (default 10, max 30)." },
      label: { type: "string", description: "Optional label filter: 'INBOX', 'SENT', 'DRAFT', 'STARRED', 'TRASH'." },
    },
    required: ["query"],
  },
};

const GET_EMAIL = {
  name: "get_email",
  description: "Get the full content of an email by its message ID. Returns subject, from, to, cc, date, body text, and labels.",
  input_schema: {
    type: "object",
    properties: {
      message_id: { type: "string", description: "The Gmail message ID." },
    },
    required: ["message_id"],
  },
};

const SEND_EMAIL = {
  name: "send_email",
  description: "Send an email. Can also reply to an existing thread by providing thread_id.",
  input_schema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address." },
      subject: { type: "string", description: "Email subject line." },
      body: { type: "string", description: "Email body text (plain text)." },
      thread_id: { type: "string", description: "Optional: Gmail thread ID to reply to." },
    },
    required: ["to", "body"],
  },
};

const MODIFY_EMAIL = {
  name: "modify_email",
  description: "Modify an email: archive, trash, star, unstar, mark as read, or mark as unread.",
  input_schema: {
    type: "object",
    properties: {
      message_id: { type: "string", description: "The Gmail message ID." },
      action: {
        type: "string",
        enum: ["archive", "trash", "star", "unstar", "mark_read", "mark_unread"],
        description: "Action to perform on the email.",
      },
    },
    required: ["message_id", "action"],
  },
};

const CREATE_EMAIL_DRAFT = {
  name: "create_draft",
  description: "Create a draft email without sending it. The user can review and send it later.",
  input_schema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Recipient email address (optional for drafts)." },
      subject: { type: "string", description: "Email subject line." },
      body: { type: "string", description: "Email body text (plain text)." },
    },
    required: ["body"],
  },
};

// ─── CALENDAR TOOLS ───

const LIST_CALENDAR_EVENTS = {
  name: "list_calendar_events",
  description: "List Google Calendar events for a date range. Returns event titles, times, locations, and attendees.",
  input_schema: {
    type: "object",
    properties: {
      start_date: { type: "string", description: "Start of date range in ISO 8601 format (e.g. '2026-03-11T00:00:00Z')." },
      end_date: { type: "string", description: "End of date range in ISO 8601 format." },
      max_results: { type: "number", description: "Maximum events to return (default 20)." },
    },
    required: ["start_date", "end_date"],
  },
};

const CREATE_CALENDAR_EVENT = {
  name: "create_calendar_event",
  description: "Create a new event on the user's Google Calendar.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Event title." },
      start: { type: "string", description: "Start time in ISO 8601 format (e.g. '2026-03-12T14:30:00-07:00'). For all-day events use date only: '2026-03-12'." },
      end: { type: "string", description: "End time in ISO 8601 format. For all-day events use the next day: '2026-03-13'." },
      description: { type: "string", description: "Optional event description." },
      location: { type: "string", description: "Optional event location." },
      attendees: {
        type: "array",
        items: { type: "string" },
        description: "Optional: array of attendee email addresses.",
      },
    },
    required: ["summary", "start", "end"],
  },
};

const UPDATE_CALENDAR_EVENT = {
  name: "update_calendar_event",
  description: "Update an existing Google Calendar event. Only provide fields you want to change.",
  input_schema: {
    type: "object",
    properties: {
      event_id: { type: "string", description: "The Google Calendar event ID." },
      summary: { type: "string", description: "New event title." },
      start: { type: "string", description: "New start time in ISO 8601 format." },
      end: { type: "string", description: "New end time in ISO 8601 format." },
      description: { type: "string", description: "New event description." },
      location: { type: "string", description: "New event location." },
    },
    required: ["event_id"],
  },
};

const DELETE_CALENDAR_EVENT = {
  name: "delete_calendar_event",
  description: "Delete an event from Google Calendar.",
  input_schema: {
    type: "object",
    properties: {
      event_id: { type: "string", description: "The Google Calendar event ID to delete." },
    },
    required: ["event_id"],
  },
};

// ─── TOOL SETS ───

export const WASABI_TOOLS = [
  QUERY_DATABASE,
  CROSS_DATABASE_QUERY,
  GET_PAGE,
  CREATE_PAGE,
  UPDATE_PAGE,
  CREATE_DATABASE,
  UPDATE_DATABASE,
  DETECT_SCHEMA,
  CREATE_PAGE_CONFIG,
  UPDATE_KNOWLEDGE_BASE,
  SEARCH_KNOWLEDGE_BASE,
  POST_NOTIFICATION,
  CREATE_AUTOMATION_RULE,
  PROCESS_UPLOADED_FILES,
  SMART_MATCH_RECORDS,
  QUERY_NEURONS,
  CREATE_NEURON,
  RUN_CALCULATION,
  SAVE_CUSTOM_FUNCTION,
  LIST_CUSTOM_FUNCTIONS,
  RUN_CUSTOM_FUNCTION,
  DELETE_CUSTOM_FUNCTION,
  BATCH_OPERATIONS,
  EXPORT_REPORT,
  DELEGATE_TASK,
  // Gmail tools
  SEARCH_EMAILS,
  GET_EMAIL,
  SEND_EMAIL,
  MODIFY_EMAIL,
  CREATE_EMAIL_DRAFT,
  // Calendar tools
  LIST_CALENDAR_EVENTS,
  CREATE_CALENDAR_EVENT,
  UPDATE_CALENDAR_EVENT,
  DELETE_CALENDAR_EVENT,
];

export const AUTO_TOOLS = [
  QUERY_DATABASE,
  CREATE_PAGE,
  UPDATE_PAGE,
  POST_NOTIFICATION,
];

export const SYSTEM_TOOLS = [
  QUERY_DATABASE,
  GET_PAGE,
  SEARCH_KNOWLEDGE_BASE,
  UPDATE_KNOWLEDGE_BASE,
];
