// ─── Wasabi Tool Definitions ───
// Tool schemas for Claude's tool_use. Organized by agent type.

// ─── SHARED TOOLS (used by multiple agents) ───

const QUERY_DATABASE = {
  name: "query_database",
  description: "Query a Notion database with optional filters and sorts. Returns matching pages with all properties.",
  input_schema: {
    type: "object",
    properties: {
      database_id: {
        type: "string",
        description: "The Notion database ID to query.",
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
  description: "Create a new page in a Notion database. Provide the database_id and a properties object.",
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
  description: "Update properties of an existing Notion page.",
  input_schema: {
    type: "object",
    properties: {
      page_id: { type: "string", description: "The page ID to update." },
      properties: {
        type: "object",
        description: "Properties to update in Notion API format.",
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
  description: "Create a new page in the Wasabi platform. Defines the page name, icon, connected databases, views layout, and agent configuration.",
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
        enum: ["page_config", "user_preference", "business_context", "learned_pattern", "database_schema"],
        description: "Category of knowledge.",
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
        enum: ["page_config", "user_preference", "business_context", "learned_pattern", "database_schema"],
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
        description: "Action to perform: 'analyze' to parse and summarize, 'create_records' to create Notion records from file data, 'index_to_kb' to save to knowledge base.",
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

// ─── PAGE AGENT TOOLS ───

const ESCALATE_TO_WASABI = {
  name: "escalate_to_wasabi",
  description: "Escalate to the Wasabi global agent when the task is outside your scope (e.g. creating new databases, modifying page config, cross-database operations).",
  input_schema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Why you need to escalate." },
      context_summary: {
        type: "string",
        description: "Summary of the conversation so far so Wasabi has context.",
      },
    },
    required: ["reason", "context_summary"],
  },
};

// ─── DELEGATION + AUTOMATION TOOLS ───

const DELEGATE_TO_PAGE_AGENT = {
  name: "delegate_to_page_agent",
  description: "Delegate a task to a specific page agent. The page agent will execute the task within its scoped databases and return the result. Use this to avoid doing work that a page agent can handle.",
  input_schema: {
    type: "object",
    properties: {
      page_config_id: {
        type: "string",
        description: "The page config ID (Notion page ID) of the target page agent.",
      },
      task: {
        type: "string",
        description: "Description of the task to delegate. Be specific about what data to query/create/update.",
      },
    },
    required: ["page_config_id", "task"],
  },
};

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
  DELEGATE_TO_PAGE_AGENT,
  CREATE_AUTOMATION_RULE,
  PROCESS_UPLOADED_FILES,
  SMART_MATCH_RECORDS,
];

export const PAGE_TOOLS = [
  QUERY_DATABASE,
  GET_PAGE,
  CREATE_PAGE,
  UPDATE_PAGE,
  POST_NOTIFICATION,
  PROCESS_UPLOADED_FILES,
  SMART_MATCH_RECORDS,
  ESCALATE_TO_WASABI,
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
