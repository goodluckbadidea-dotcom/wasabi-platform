// ─── Notion Property Utilities ───
// Read and write Notion page properties in a schema-agnostic way.

/**
 * Read a Notion property value into a plain JS value.
 * Handles all property types. Returns null for empty/undefined.
 */
export function readProp(prop) {
  if (!prop) return null;

  switch (prop.type) {
    case "title":
      return prop.title?.map((t) => t.plain_text).join("") || null;

    case "rich_text":
      return prop.rich_text?.map((t) => t.plain_text).join("") || null;

    case "number":
      return prop.number;

    case "select":
      return prop.select?.name || null;

    case "status":
      return prop.status?.name || null;

    case "multi_select":
      return prop.multi_select?.map((s) => s.name) || [];

    case "date":
      if (!prop.date) return null;
      return {
        start: prop.date.start,
        end: prop.date.end,
        timeZone: prop.date.time_zone,
      };

    case "checkbox":
      return prop.checkbox;

    case "url":
      return prop.url || null;

    case "email":
      return prop.email || null;

    case "phone_number":
      return prop.phone_number || null;

    case "formula":
      if (!prop.formula) return null;
      const f = prop.formula;
      return f.string ?? f.number ?? f.boolean ?? f.date?.start ?? null;

    case "rollup":
      if (!prop.rollup) return null;
      const r = prop.rollup;
      if (r.type === "number") return r.number;
      if (r.type === "date") return r.date?.start || null;
      if (r.type === "array") return r.array?.map(readProp) || [];
      return null;

    case "relation":
      return prop.relation?.map((r) => r.id) || [];

    case "people":
      return prop.people?.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.person?.email,
      })) || [];

    case "files":
      return prop.files?.map((f) => ({
        name: f.name,
        url: f.file?.url || f.external?.url,
      })) || [];

    case "created_time":
      return prop.created_time || null;

    case "last_edited_time":
      return prop.last_edited_time || null;

    case "created_by":
      return prop.created_by?.name || null;

    case "last_edited_by":
      return prop.last_edited_by?.name || null;

    case "unique_id":
      if (!prop.unique_id) return null;
      const prefix = prop.unique_id.prefix || "";
      return `${prefix}${prefix ? "-" : ""}${prop.unique_id.number}`;

    default:
      return null;
  }
}

/**
 * Build a Notion property object for writes.
 * Takes a property type and value, returns the Notion API format.
 */
export function buildProp(type, value) {
  if (value === null || value === undefined) return undefined;

  switch (type) {
    case "title":
      return {
        title: [{ type: "text", text: { content: String(value) } }],
      };

    case "rich_text":
      return {
        rich_text: [{ type: "text", text: { content: String(value) } }],
      };

    case "number":
      return { number: typeof value === "number" ? value : parseFloat(value) || null };

    case "select":
      return { select: value ? { name: String(value) } : null };

    case "status":
      return { status: value ? { name: String(value) } : null };

    case "multi_select":
      const items = Array.isArray(value) ? value : [value];
      return { multi_select: items.map((v) => ({ name: String(v) })) };

    case "date":
      if (typeof value === "string") {
        return { date: { start: value } };
      }
      if (typeof value === "object") {
        return { date: { start: value.start, end: value.end || undefined } };
      }
      return { date: null };

    case "checkbox":
      return { checkbox: Boolean(value) };

    case "url":
      return { url: value ? String(value) : null };

    case "email":
      return { email: value ? String(value) : null };

    case "phone_number":
      return { phone_number: value ? String(value) : null };

    case "relation":
      const ids = Array.isArray(value) ? value : [value];
      return { relation: ids.map((id) => ({ id })) };

    case "people":
      const pIds = Array.isArray(value) ? value : [value];
      return { people: pIds.map((id) => ({ id })) };

    default:
      return undefined;
  }
}

/**
 * Extract all property values from a Notion page into a flat object.
 * Keys are property names, values are the readable values.
 */
export function extractProperties(page) {
  if (!page?.properties) return {};
  const result = {};
  for (const [name, prop] of Object.entries(page.properties)) {
    result[name] = readProp(prop);
  }
  return result;
}

/**
 * Get the title from a page (finds the title property automatically)
 */
export function getPageTitle(page) {
  if (!page?.properties) return "";
  for (const prop of Object.values(page.properties)) {
    if (prop.type === "title") {
      return readProp(prop) || "";
    }
  }
  return "";
}

/**
 * Get the property type map from a page (name → type)
 */
export function getPropertyTypes(page) {
  if (!page?.properties) return {};
  const types = {};
  for (const [name, prop] of Object.entries(page.properties)) {
    types[name] = prop.type;
  }
  return types;
}
