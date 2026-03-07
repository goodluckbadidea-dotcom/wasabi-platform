// ─── Page Templates ───
// Pre-built page configurations that Wasabi uses to scaffold new pages.
// Extracted from wasabiPrompt.js to be importable/exportable.

export const TEMPLATES = [
  {
    id: "project_management",
    name: "Project Management",
    description: "Gantt + Table + Kanban + Summary Tiles",
    schema: [
      { name: "Name", type: "title" },
      { name: "Status", type: "status", options: ["To Do", "In Progress", "Done", "Blocked"] },
      { name: "Priority", type: "select", options: ["High", "Medium", "Low"] },
      { name: "Assignee", type: "rich_text" },
      { name: "Start Date", type: "date" },
      { name: "Due Date", type: "date" },
      { name: "Notes", type: "rich_text" },
    ],
    views: [
      { type: "table", position: "main", config: {} },
      { type: "gantt", position: "main", config: {} },
      { type: "kanban", position: "main", config: {} },
      { type: "summaryTiles", position: "main", config: {} },
      { type: "chat", position: "main", config: {} },
    ],
    agentPrompt:
      "You are a project management assistant. Help users track tasks, manage timelines, and report on project health. Suggest priority adjustments and flag overdue items proactively.",
  },
  {
    id: "crm",
    name: "CRM",
    description: "Card Grid + Table + Activity Feed + Summary Tiles",
    schema: [
      { name: "Contact Name", type: "title" },
      { name: "Company", type: "rich_text" },
      { name: "Email", type: "email" },
      { name: "Phone", type: "phone_number" },
      { name: "Status", type: "select", options: ["Lead", "Active", "Closed", "Lost"] },
      { name: "Deal Value", type: "number" },
      { name: "Last Contact", type: "date" },
      { name: "Notes", type: "rich_text" },
    ],
    views: [
      { type: "table", position: "main", config: {} },
      { type: "cardGrid", position: "main", config: {} },
      { type: "activityFeed", position: "main", config: {} },
      { type: "summaryTiles", position: "main", config: {} },
      { type: "chat", position: "main", config: {} },
    ],
    agentPrompt:
      "You are a CRM assistant. Help users manage contacts, track deals, and follow up on leads. Summarize pipeline health and flag stale contacts.",
  },
  {
    id: "inventory",
    name: "Inventory",
    description: "Table + Charts + Summary Tiles + Form",
    schema: [
      { name: "Product Name", type: "title" },
      { name: "SKU", type: "rich_text" },
      { name: "Category", type: "select", options: ["Electronics", "Clothing", "Food", "Other"] },
      { name: "Quantity", type: "number" },
      { name: "Unit Cost", type: "number" },
      { name: "Reorder Point", type: "number" },
      { name: "Supplier", type: "rich_text" },
      { name: "Status", type: "status", options: ["In Stock", "Low", "Out of Stock"] },
    ],
    views: [
      { type: "table", position: "main", config: {} },
      { type: "charts", position: "main", config: {} },
      { type: "summaryTiles", position: "main", config: {} },
      { type: "form", position: "main", config: {} },
      { type: "chat", position: "main", config: {} },
    ],
    agentPrompt:
      "You are an inventory management assistant. Help users track stock levels, flag low inventory, calculate reorder quantities, and analyze category trends.",
  },
  {
    id: "operations",
    name: "Operations",
    description: "Kanban + Gantt + Notification Feed",
    schema: [
      { name: "Task Name", type: "title" },
      { name: "Status", type: "status", options: ["Backlog", "In Progress", "Review", "Done"] },
      { name: "Priority", type: "select", options: ["Critical", "High", "Medium", "Low"] },
      { name: "Owner", type: "rich_text" },
      { name: "Due Date", type: "date" },
      { name: "Category", type: "select", options: ["Engineering", "Design", "Marketing", "Support"] },
      { name: "Notes", type: "rich_text" },
    ],
    views: [
      { type: "table", position: "main", config: {} },
      { type: "kanban", position: "main", config: {} },
      { type: "gantt", position: "main", config: {} },
      { type: "notificationFeed", position: "main", config: {} },
      { type: "chat", position: "main", config: {} },
    ],
    agentPrompt:
      "You are an operations assistant. Help users manage task workflows, track blockers, and report on team velocity. Flag overdue items and suggest reassignments.",
  },
  {
    id: "finances",
    name: "Finances",
    description: "Table + Charts + Summary Tiles",
    schema: [
      { name: "Description", type: "title" },
      { name: "Amount", type: "number" },
      { name: "Category", type: "select", options: ["Income", "Expense", "Transfer"] },
      { name: "Date", type: "date" },
      { name: "Account", type: "rich_text" },
      { name: "Status", type: "status", options: ["Pending", "Cleared"] },
      { name: "Notes", type: "rich_text" },
    ],
    views: [
      { type: "table", position: "main", config: {} },
      { type: "charts", position: "main", config: {} },
      { type: "summaryTiles", position: "main", config: {} },
      { type: "chat", position: "main", config: {} },
    ],
    agentPrompt:
      "You are a financial tracking assistant. Help users categorize transactions, track balances, generate spending summaries, and identify trends.",
  },
  {
    id: "todo",
    name: "To-Do List",
    description: "Kanban + Table + Form",
    schema: [
      { name: "Task", type: "title" },
      { name: "Status", type: "status", options: ["To Do", "In Progress", "Done"] },
      { name: "Priority", type: "select", options: ["High", "Medium", "Low"] },
      { name: "Due Date", type: "date" },
      { name: "Tags", type: "multi_select", options: ["Work", "Personal", "Urgent"] },
      { name: "Notes", type: "rich_text" },
    ],
    views: [
      { type: "table", position: "main", config: {} },
      { type: "kanban", position: "main", config: {} },
      { type: "form", position: "main", config: {} },
      { type: "chat", position: "main", config: {} },
    ],
    agentPrompt:
      "You are a task management assistant. Help users organize their to-do list, set priorities, and track deadlines. Suggest what to focus on next.",
  },
];

/**
 * Get a template by ID.
 */
export function getTemplateById(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

/**
 * Generate the prompt text for Wasabi's system prompt.
 * Produces identical output to the previously hardcoded text.
 */
export function templatesToPromptText() {
  const lines = TEMPLATES.map((t, i) => {
    const schemaDesc = t.schema
      .map((f) => {
        let desc = f.name;
        if (f.options) desc += ` (${f.options.join("/")})`;
        return desc;
      })
      .join(", ");
    return `${i + 1}. **${t.name}** — ${t.description}. Schema: ${schemaDesc}.`;
  });

  return `## Templates
When a user picks a template, guide them through customization:

${lines.join("\n")}

After template selection, ask the user what they want to customize before creating.`;
}
