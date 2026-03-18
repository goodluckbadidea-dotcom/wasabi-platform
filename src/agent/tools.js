// ─── Wasabi Tool Definitions ───
// Tool schemas for Claude's tool_use. Organized by agent type.

// ─── SHARED TOOLS (used by multiple agents) ───

const QUERY_DATABASE = {
  name: "query_database",
  description: "Query any data source by its page ID. Supports D1 tables, D1 sheets, linked Google Sheets (read-only), linked Monday.com boards, and linked Notion databases. Returns matching records with all properties. NOTE: Results are capped at 200 rows (50 for direct Notion). If `truncated: true` in the response, not all data was returned — tell the user how many records you received vs. the total count. ONLY use the EXACT values returned — NEVER estimate, round, or fabricate missing data.",
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
        description: "Properties to add. Each: {name, type, options?, format?, database_id?, synced_property_name?}.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            format: { type: "string" },
            database_id: { type: "string", description: "For relation type: the target database ID to link to." },
            synced_property_name: { type: "string", description: "For two-way relations: name of the backlink column created on the target database. Omit for one-way." },
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
        description: "Array of field definitions. Each has: name, type (title|rich_text|number|select|status|multi_select|date|checkbox|url|email|phone_number|relation). Optional: 'options' (select/multi_select/status), 'format' (number), 'relatedDbId' + 'synced' + 'syncedPropertyName' (for two-way relations).",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            format: { type: "string" },
            relatedDbId: { type: "string", description: "For relation type: the target database ID." },
            synced: { type: "boolean", description: "For relation type: true = two-way relation." },
            syncedPropertyName: { type: "string", description: "For two-way relations: backlink column name on target database." },
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
  description: "Create a new page with a standalone D1 database table and views. Use this to build custom pages — no Notion required. Define columns for the table schema and views for the layout.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Page display name." },
      icon: { type: "string", description: "Page icon emoji." },
      page_type: {
        type: "string",
        enum: ["database", "document", "sheet"],
        description: "Page type. 'database' = standalone table (default), 'document' = rich text doc, 'sheet' = spreadsheet grid.",
      },
      columns: {
        type: "array",
        description: "Column definitions for standalone database tables. Each column has: name (display name), type (text|number|select|multi_select|checkbox|date|url|email|phone), and optional id (auto-generated from name if omitted). For 'select' type, include options array.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string" },
            id: { type: "string" },
            options: { type: "array", items: { type: "string" } },
          },
          required: ["name", "type"],
        },
      },
      databaseIds: {
        type: "array",
        items: { type: "string" },
        description: "Optional: external database IDs to connect (Notion). Leave empty for standalone D1 tables.",
      },
      views: {
        type: "array",
        description: "Views to display. Each has: type (table|gantt|cardGrid|kanban|charts|form|summaryTiles|activityFeed|document|notificationFeed|calendar|sheet), position (main|sidebar|bottom), label (display name), and config (view-specific settings like { editable: true }).",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
            label: { type: "string" },
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
    required: ["name", "views", "columns"],
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
- Math/array helpers: sum(arr), avg(arr), min(arr), max(arr), groupBy(arr, key), sortBy(arr, key, dir), unique(arr, key), round(n, decimals)
- Date helpers: dateAdd(dateStr, days), dateDiff(dateStr1, dateStr2), weeksBetween(dateStr1, dateStr2)
- Smart matching: normalize(s), similarity(a, b), fuzzyMatch(a, b, threshold?), bestMatch(needle, haystack, key?), matchRows(sourceRows, targetRows, sourceKey, targetKey, threshold?) — use matchRows() to join datasets with different naming conventions

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

The code must define a function called 'execute' that receives a single object parameter with named datasets (matching input keys) and returns a result matching the declared output schema. Available sandbox helpers: sum, avg, min, max, groupBy, sortBy, unique, round, dateAdd, dateDiff, weeksBetween, normalize, similarity, fuzzyMatch, bestMatch, matchRows. IMPORTANT: When joining data from different databases, ALWAYS use matchRows(sourceRows, targetRows, sourceKey, targetKey) instead of exact key lookups — records across databases often have slightly different names.

Sheet data: When a dataset comes from a sheet, each row has column-letter keys (A, B, C...) or header names. For aggregating all values on a sheet, use datasets.mySheet._allCellValues which is a flat array of every numeric value in the sheet. Example: sum(datasets.mySheet._allCellValues).

Example: function execute({ sales, inventory }) { return Object.keys(groupBy(sales, "SKU")).map(sku => ({ sku, total: sum(sales.filter(r => r.SKU === sku).map(r => r.Units)) })); }`,
  input_schema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Optional ID for updating an existing function. Omit for new." },
      name: { type: "string", description: "Human-readable function name." },
      description: { type: "string", description: "What this function does." },
      type: {
        type: "string",
        enum: ["transform", "aggregation", "forecast", "alert", "pipeline", "view", "plugin"],
        description: "Function category: transform (reshape), aggregation (summarize), forecast (predict), alert (threshold check), pipeline (multi-step chain), view (dashboard spec), plugin (micro-plugin with manifest).",
      },
      inputs: {
        type: "object",
        description: "Declares input data sources. Each key is a dataset name. Value options: { source: 'query_database', database_id: 'xxx', columns: ['col1', 'col2'] } for database queries, or { source: 'external_api', url: 'https://...', method: 'GET', headers: {}, transform_path: 'data.results' } for external API data. The transform_path drills into the JSON response to extract the relevant data array.",
      },
      outputs: {
        type: "object",
        description: "Declares expected output shape. { type: 'table'|'number'|'chart_config', schema: { fieldName: 'string'|'number'|'date' } }.",
      },
      code: {
        type: "string",
        description: "JavaScript function body. Must define 'function execute(datasets) { ... return result; }'.",
      },
      write_back: {
        type: "object",
        description: "Optional write-back config. When set, after execution Wasabi suggests writing results back to a database. Properties: target_database_id (string), mode ('update'|'create'|'upsert'), match_key (string, field to match for updates), column_mapping (object mapping function output fields to database columns).",
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
      type: { type: "string", enum: ["transform", "aggregation", "forecast", "alert", "pipeline", "view", "plugin"], description: "Filter by function type." },
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
      config: {
        type: "object",
        description: "Optional runtime config overrides for plugins. Merged with manifest configSchema defaults. Only used for plugin-type functions.",
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

// ─── Custom Views ───

const SAVE_CUSTOM_VIEW = {
  name: "save_custom_view",
  description: `Create or update a custom dashboard/view spec. The view spec defines a grid layout of widgets. Each widget declares its own data source. The spec is stored as a custom function with type "view" and can be added to any page as a customView view block.

Widget types:
- metric: large number with label (for counts, totals, KPIs)
- chart: bar/pie/line SVG chart (for data visualization with categories)
- table: compact data table (for tabular data)
- text: static text block (for notes, descriptions)
- progress: progress bar with percentage (for goal tracking)
- list: ranked items with values (for top-N lists)
- html: sandboxed iframe rendering custom HTML/SVG/Canvas (for rich custom visualizations like clocks, gauges, animated graphics, interactive widgets). The linked function's code runs directly in the browser with full DOM access via a sandboxed iframe. Use this when the function creates visual output using DOM manipulation, Canvas, SVG, or any rendering that goes beyond simple data display.

IMPORTANT: When a function/plugin contains code that renders visual elements (draws on canvas, creates SVG, manipulates DOM, builds HTML), you MUST use widget type "html" — NOT "metric" or "chart". The "metric" type can only display a single number. The "html" type renders the function's code in a sandboxed iframe with full browser APIs (document, canvas, SVG, CSS, etc.).

Data source types per widget: "query" (uses page data filtered by databaseId), "function_result" (runs a saved custom function by ID), "static" (inline data values), "inline_html" (raw HTML/SVG/CSS string embedded directly — no function needed, great for custom visuals, animations, and interactive content).

Example inline_html widget:
{ "id": "w1", "type": "html", "title": "Custom SVG", "span": 2, "height": 400,
  "dataSource": { "type": "inline_html", "content": "<svg width=\\"100%\\" height=\\"100%\\"><circle cx=\\"50\\" cy=\\"50\\" r=\\"40\\" fill=\\"#7B61FF\\"/></svg>" } }

TIP: For creative/visual requests (SVG animations, interactive HTML, custom graphics), prefer "inline_html" over "function_result" — it's simpler and avoids the function creation step. Or use the create_html_view tool for a one-step solution.

The view spec JSON format:
{
  "version": 1,
  "title": "Dashboard Title",
  "layout": "grid",           // "grid" | "stack" | "columns"
  "columns": 2,               // for columns layout
  "widgets": [
    { "id": "w1", "type": "metric", "title": "Total Revenue", "span": 1,
      "dataSource": { "type": "query", "databaseId": "db_xxx", "field": "Revenue", "aggregation": "sum" } },
    { "id": "w2", "type": "chart", "title": "By Category", "span": 2, "chartType": "bar",
      "dataSource": { "type": "query", "databaseId": "db_xxx", "categoryField": "Category", "valueField": "Amount", "aggregation": "sum" } },
    { "id": "w3", "type": "table", "title": "Recent", "span": 2,
      "dataSource": { "type": "query", "databaseId": "db_xxx", "limit": 10 }, "columns": ["Name", "Status"] },
    { "id": "w4", "type": "text", "span": 1, "content": "Notes here." },
    { "id": "w5", "type": "progress", "title": "Q1", "span": 1,
      "dataSource": { "type": "static", "current": 73, "target": 100 } },
    { "id": "w6", "type": "list", "title": "Top 5", "span": 1,
      "dataSource": { "type": "function_result", "functionId": "fn_xxx" }, "labelField": "name", "valueField": "revenue" },
    { "id": "w7", "type": "html", "title": "Live Clock", "span": 2, "height": 300,
      "dataSource": { "type": "function_result", "functionId": "fn_yyy" } }
  ]
}

After saving, tell the user they can add it to a page by creating a page config view with type "customView" and config.functionId set to the returned ID.`,
  input_schema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Optional ID for updating an existing view. Omit for new." },
      name: { type: "string", description: "View name." },
      description: { type: "string", description: "What this dashboard shows." },
      view_spec: {
        type: "object",
        description: "The view spec JSON defining layout and widgets (see format above).",
      },
      code: {
        type: "string",
        description: "Optional JavaScript data transformation code that runs before rendering. Must define 'function execute(datasets) { ... }'.",
      },
      inputs: {
        type: "object",
        description: "Optional data source declarations (same format as save_custom_function inputs). Used when code needs to pre-fetch data.",
      },
      _confirmed: { type: "boolean", description: "Set to true after user approves the preview to actually save." },
    },
    required: ["name", "view_spec"],
  },
};

// ─── One-step HTML View ───

const CREATE_HTML_VIEW = {
  name: "create_html_view",
  description: `Create a custom HTML/SVG/CSS view in one step. Embeds raw HTML content directly into a view widget — no separate function creation needed. Perfect for creative visualizations, SVG animations, interactive widgets, custom graphics, gauges, clocks, or any rich visual content.

The HTML content runs inside a sandboxed iframe with access to:
- window.wasabi.colors (theme colors: bg, surface, text, muted, accent, etc.)
- window.wasabi.root (the #root DOM element)
- Full browser APIs: Canvas, SVG, CSS animations, requestAnimationFrame, etc.

Example uses: animated SVG scenes, interactive data visualizations, custom gauges, pixel art, generative art, mini-games, clocks, progress indicators.`,
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "View name/title." },
      html: {
        type: "string",
        description: "Raw HTML/SVG/CSS content string. Can be a full HTML document or a JS snippet that renders to #root. For JS snippets, the code runs inside a <script> tag with access to window.wasabi.colors and window.wasabi.root.",
      },
      page_id: {
        type: "string",
        description: "Optional: page config ID to add this view to. If omitted, the view is saved but not attached to a page.",
      },
      height: {
        type: "number",
        description: "Optional iframe height in pixels (default 400).",
      },
      description: { type: "string", description: "Optional description of the view." },
    },
    required: ["name", "html"],
  },
};

// ─── Micro-Plugins ───

const SAVE_PLUGIN = {
  name: "save_plugin",
  description: `Create a micro-plugin: a sandboxed function with extended capabilities, a manifest declaring permissions, and optional UI rendering output. Plugins can output data, view specs, or both. They go through stricter validation than regular functions.

The manifest declares:
- capabilities: list from ["read_data", "compute", "generate_view", "write_back", "external_api", "text_processing", "date_processing"]
- permissions: { maxExecutionMs: 5000, maxOutputRows: 1000 }
- ui.configSchema: form fields for user configuration at runtime. Each key defines a config field:
  { "threshold": { "type": "number", "default": 10, "label": "Alert Threshold" }, "period": { "type": "string", "enum": ["7d","30d","90d"], "default": "30d", "label": "Period" } }
- ui.outputType: "data" | "view" | "data+view"

Extended sandbox helpers available beyond the standard set:
- Always: currency(n, code), percent(n, decimals), compact(n), flatten(arr), pick(obj, keys), omit(obj, keys), chunk(arr, size), zip(a, b)
- With text_processing: trim(s), upper(s), lower(s), replace(s, find, rep), split(s, delim), join(arr, delim), slug(s), truncate(s, len), template(tmpl, data)
- With date_processing: now(), parseDate(s), monthsBetween(d1, d2), startOfWeek(d), formatDate(d, fmt)

The function must define 'function execute(datasets, config) { ... }' where config comes from the manifest's configSchema defaults merged with any runtime overrides.

For "data+view" outputType, return { data: [...], viewSpec: { version: 1, layout: "grid", widgets: [...] } }. The viewSpec uses the same widget format as save_custom_view.

IMPORTANT: If a plugin renders visual output (draws on canvas, creates SVG elements, manipulates DOM, builds custom HTML), when creating a custom view for it use widget type "html" with dataSource type "function_result" pointing to the plugin's ID. The "html" widget renders the plugin's code in a sandboxed iframe with full browser APIs. Do NOT use "metric" for visual plugins — "metric" only displays a number.`,
  input_schema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Optional ID for updating an existing plugin. Omit for new." },
      name: { type: "string", description: "Plugin name." },
      description: { type: "string", description: "What this plugin does." },
      manifest: {
        type: "object",
        description: "Plugin manifest declaring capabilities, permissions, and UI config schema.",
      },
      inputs: {
        type: "object",
        description: "Declares input data sources (same format as save_custom_function inputs).",
      },
      outputs: {
        type: "object",
        description: "Expected output shape: { type: 'table'|'number'|'data+view', schema: { ... } }.",
      },
      code: {
        type: "string",
        description: "JavaScript function body. Must define 'function execute(datasets, config) { ... return result; }'.",
      },
      _confirmed: { type: "boolean", description: "Set to true after user approves the dry-run preview to actually save." },
    },
    required: ["name", "manifest", "code"],
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

// ─── Automation Node Interpretation ───

const INTERPRET_AUTOMATION_NODES = {
  name: "interpret_automation_nodes",
  description: "Convert plain English automation node descriptions into structured configurations. Called by the 'Build with Wasabi' feature in the node editor.",
  input_schema: {
    type: "object",
    properties: {
      interpretations: {
        type: "array",
        description: "Array of interpreted node configurations.",
        items: {
          type: "object",
          properties: {
            node_id: { type: "string", description: "The node ID to update." },
            trigger_type: {
              type: "string",
              enum: ["schedule", "status_change", "field_change", "page_created", "manual"],
              description: "For 'when' nodes only: the interpreted trigger type.",
            },
            trigger_config: {
              type: "object",
              description: "For 'when' nodes only: trigger-specific config. schedule: {interval_minutes}. status_change: {database_id, field, from, to}. field_change: {database_id, field}. page_created: {database_id}.",
            },
            config: {
              type: "object",
              description: "For action nodes: structured config. update_page: {properties}. create_page: {databaseId, properties}. post_notification: {message, type}. send_email: {to, subject, body}.",
            },
          },
          required: ["node_id"],
        },
      },
    },
    required: ["interpretations"],
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
  SAVE_CUSTOM_VIEW,
  CREATE_HTML_VIEW,
  SAVE_PLUGIN,
  INTERPRET_AUTOMATION_NODES,
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

// ── Assistant tool sets by role ──
// Viewer: read-only (query databases, search emails, view calendar)
// Editor: read + lightweight writes (query, update records, email, calendar)
// Admin: editor tools (full agent access is via Agent tab)

export const ZEN_TOOLS_VIEWER = [
  QUERY_DATABASE,
  SEARCH_EMAILS,
  LIST_CALENDAR_EVENTS,
];

export const ZEN_TOOLS_EDITOR = [
  QUERY_DATABASE,
  UPDATE_PAGE,
  POST_NOTIFICATION,
  SEARCH_EMAILS,
  LIST_CALENDAR_EVENTS,
  CREATE_CALENDAR_EVENT,
];

export const ZEN_TOOLS_ADMIN = [
  QUERY_DATABASE,
  UPDATE_PAGE,
  POST_NOTIFICATION,
  SEARCH_EMAILS,
  LIST_CALENDAR_EVENTS,
  CREATE_CALENDAR_EVENT,
];

// Legacy export — defaults to admin tool set
export const ZEN_TOOLS = ZEN_TOOLS_ADMIN;
