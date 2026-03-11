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
