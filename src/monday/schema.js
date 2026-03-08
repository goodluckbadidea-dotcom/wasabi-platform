// ─── Monday.com Schema Conversion ───
// Converts Monday.com column types → Notion-compatible classified schema.
// Converts Monday items → Notion-compatible page objects.
// This allows all existing views to render Monday data unchanged.

/**
 * Map Monday.com column type → Notion property type.
 */
const MONDAY_TYPE_MAP = {
  text: "rich_text",
  long_text: "rich_text",
  numbers: "number",
  date: "date",
  status: "status",
  color: "status",     // Monday "color" columns are status-like
  dropdown: "select",
  checkbox: "checkbox",
  link: "url",
  email: "email",
  phone: "phone_number",
  people: "people",
  timeline: "date",     // Timeline has start+end, we map to date
  tags: "multi_select",
  rating: "number",
  hour: "rich_text",
  formula: "formula",
  mirror: "rollup",
  file: "files",
  creation_log: "created_time",
  last_updated: "last_edited_time",
};

/**
 * Convert Monday.com board columns → Notion-compatible classified schema.
 * Same format returned by detectSchema() in notion/schema.js.
 */
export function mondayColumnsToSchema(boardId, boardName, columns) {
  const schema = {
    databaseId: `monday_${boardId}`,
    databaseTitle: boardName,
    title: null,
    selects: [],
    statuses: [],
    multiSelects: [],
    dates: [],
    numbers: [],
    richTexts: [],
    checkboxes: [],
    relations: [],
    urls: [],
    emails: [],
    phones: [],
    people: [],
    files: [],
    formulas: [],
    rollups: [],
    createdTime: null,
    lastEditedTime: null,
    createdBy: null,
    lastEditedBy: null,
    uniqueId: null,
    allFields: [],
    _source: "monday",
    _boardId: boardId,
  };

  // Monday "name" column is always the title (first column)
  const nameCol = columns.find((c) => c.id === "name" || c.type === "name");
  if (nameCol) {
    const titleField = { name: nameCol.title || "Name", id: nameCol.id, type: "title" };
    schema.title = titleField;
    schema.allFields.push(titleField);
  }

  for (const col of columns) {
    if (col.id === "name" || col.type === "name") continue; // Already handled as title

    const notionType = MONDAY_TYPE_MAP[col.type] || "rich_text";
    const field = { name: col.title, id: col.id, type: notionType };

    // Parse options from settings_str for select/status columns
    if (["status", "color", "dropdown", "tags"].includes(col.type)) {
      try {
        const settings = JSON.parse(col.settings_str || "{}");
        const labels = settings.labels || settings.labels_colors || {};
        field.options = Object.values(labels).map((label) => ({
          name: typeof label === "string" ? label : (label.name || label),
          color: typeof label === "object" ? (label.color || "default") : "default",
        })).filter((o) => o.name && o.name !== "");
      } catch {
        field.options = [];
      }
    }

    // Route to correct schema category
    switch (notionType) {
      case "rich_text":
        schema.richTexts.push(field);
        break;
      case "number":
        field.format = col.type === "rating" ? "number" : "number";
        schema.numbers.push(field);
        break;
      case "date":
        schema.dates.push(field);
        break;
      case "status":
        schema.statuses.push(field);
        break;
      case "select":
        schema.selects.push(field);
        break;
      case "multi_select":
        schema.multiSelects.push(field);
        break;
      case "checkbox":
        schema.checkboxes.push(field);
        break;
      case "url":
        schema.urls.push(field);
        break;
      case "email":
        schema.emails.push(field);
        break;
      case "phone_number":
        schema.phones.push(field);
        break;
      case "people":
        schema.people.push(field);
        break;
      case "files":
        schema.files.push(field);
        break;
      case "formula":
        schema.formulas.push(field);
        break;
      case "rollup":
        schema.rollups.push(field);
        break;
      case "created_time":
        schema.createdTime = field;
        break;
      case "last_edited_time":
        schema.lastEditedTime = field;
        break;
    }

    schema.allFields.push(field);
  }

  return schema;
}

/**
 * Convert a Monday.com item → Notion-compatible page object.
 */
export function mondayItemToPage(item, columns) {
  const properties = {};

  // Title = item name
  const nameCol = columns.find((c) => c.id === "name" || c.type === "name");
  const titleName = nameCol?.title || "Name";
  properties[titleName] = {
    type: "title",
    title: [{
      type: "text",
      plain_text: item.name || "",
      text: { content: item.name || "" },
    }],
  };

  // Column values
  for (const cv of (item.column_values || [])) {
    const col = columns.find((c) => c.id === cv.id);
    if (!col) continue;

    const propName = col.title;
    const notionType = MONDAY_TYPE_MAP[col.type] || "rich_text";

    properties[propName] = convertColumnValue(cv, col, notionType);
  }

  return {
    id: `monday_${item.id}`,
    object: "page",
    properties,
    created_time: item.created_at,
    last_edited_time: item.updated_at,
    _source: "monday",
    _mondayItemId: item.id,
    _mondayGroup: item.group?.title || null,
  };
}

/**
 * Convert a Monday column_value → Notion property object.
 */
function convertColumnValue(cv, col, notionType) {
  const text = cv.text || "";
  let parsed = null;
  try {
    if (cv.value) parsed = JSON.parse(cv.value);
  } catch {}

  switch (notionType) {
    case "rich_text":
      return {
        type: "rich_text",
        rich_text: [{
          type: "text",
          plain_text: text,
          text: { content: text },
        }],
      };

    case "number": {
      const num = parsed != null ? Number(parsed) : (text ? Number(text) : null);
      return { type: "number", number: isNaN(num) ? null : num };
    }

    case "date": {
      // Monday dates: { date: "2024-01-15", ... } or timeline: { from: "...", to: "..." }
      let start = null;
      let end = null;
      if (parsed?.date) start = parsed.date;
      if (parsed?.from) { start = parsed.from; end = parsed.to || null; }
      if (!start && text) start = text.split(" ")[0]; // Fallback to text
      return { type: "date", date: start ? { start, end } : null };
    }

    case "status":
    case "select": {
      // Monday status: { index: N, ... } — we use the text display value
      const name = text || (parsed?.label?.text) || null;
      return notionType === "status"
        ? { type: "status", status: name ? { name } : null }
        : { type: "select", select: name ? { name } : null };
    }

    case "multi_select": {
      // Monday tags: { tag_ids: [...] } — text shows comma-separated values
      const tags = text ? text.split(", ").map((t) => ({ name: t.trim() })) : [];
      return { type: "multi_select", multi_select: tags };
    }

    case "checkbox":
      return { type: "checkbox", checkbox: text === "v" || parsed?.checked === "true" || parsed?.checked === true };

    case "url":
      return { type: "url", url: parsed?.url || text || null };

    case "email":
      return { type: "email", email: parsed?.email || text || null };

    case "phone_number":
      return { type: "phone_number", phone_number: parsed?.phone || text || null };

    case "people":
      return { type: "people", people: [] }; // Can't resolve Monday user IDs to Notion format

    default:
      return {
        type: "rich_text",
        rich_text: [{
          type: "text",
          plain_text: text,
          text: { content: text },
        }],
      };
  }
}
