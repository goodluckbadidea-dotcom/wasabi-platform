// ─── Data Source Abstraction ───
// Normalizes data from D1 (standalone tables), Notion, and linked sheets
// into a common format that existing views can consume unchanged.
//
// All sources return Notion-compatible page objects:
//   { id, properties: { [fieldName]: { type, ...value } } }
// All schemas return the same classified format from notion/schema.js.

import { queryAll } from "../notion/pagination.js";
import { detectSchema } from "../notion/schema.js";
import { updatePage, createPage, archivePage } from "../notion/client.js";
import { listRows, createRows, updateRow, deleteRow, queryTable, getTableSchema, getConnection } from "./api.js";

// ─── Main entry: fetch data + schema from any source ───

export async function fetchDataSource(pageConfig, user) {
  const type = resolveSourceType(pageConfig);

  switch (type) {
    case "d1":
      return await fetchD1Table(pageConfig);
    case "notion":
      return await fetchNotionDb(pageConfig, user);
    case "linked_sheet":
    case "document":
    case "folder":
      return { data: [], schema: null, schemas: {} };
    default:
      return { data: [], schema: null, schemas: {} };
  }
}

// ─── Determine source type from page config ───

export function resolveSourceType(pageConfig) {
  const pt = pageConfig.page_type || pageConfig.pageType;
  if (pt === "database") return "d1";
  if (pt === "linked_notion") return "notion";
  if (pt === "linked_sheet") return "linked_sheet";
  if (pt === "document") return "document";
  if (pt === "folder") return "folder";
  // Legacy: pages with databaseIds are Notion-based
  if (pageConfig.databaseIds?.length) return "notion";
  return "none";
}

// ─── D1 Standalone Table ───

async function fetchD1Table(pageConfig) {
  const tableId = pageConfig.id;

  const [schemaRes, rowsRes] = await Promise.all([
    getTableSchema(tableId),
    listRows(tableId),
  ]);

  const columns = schemaRes.columns || [];
  const rows = rowsRes.rows || [];

  const schema = d1SchemaToClassified(tableId, pageConfig.title || pageConfig.name, columns);
  const data = rows.map((row) => d1RowToPage(row, columns));

  return { data, schema, schemas: { [tableId]: schema } };
}

// ─── Notion Linked Database ───

async function fetchNotionDb(pageConfig, user) {
  const conn = getConnection();
  const workerUrl = user?.workerUrl || conn?.workerUrl;
  const notionKey = user?.notionKey || ""; // worker falls back to D1 if empty
  if (!workerUrl) {
    return { data: [], schema: null, schemas: {} };
  }

  const dbIds = pageConfig.databaseIds || [];
  if (dbIds.length === 0) return { data: [], schema: null, schemas: {} };

  const schemas = {};
  for (const dbId of dbIds) {
    try {
      schemas[dbId] = await detectSchema(workerUrl, notionKey, dbId);
    } catch (err) {
      console.warn(`Schema fetch failed for ${dbId}:`, err.message);
    }
  }

  const primarySchema = schemas[dbIds[0]] || null;
  const allData = [];
  for (const dbId of dbIds) {
    const results = await queryAll(workerUrl, notionKey, dbId);
    allData.push(...results.map((r) => ({ ...r, _databaseId: dbId })));
  }

  return { data: allData, schema: primarySchema, schemas };
}

// ─── Update a record in any source ───

export async function updateRecord(pageConfig, recordId, fieldName, propPayload, user) {
  const type = resolveSourceType(pageConfig);

  if (type === "d1") {
    const tableId = pageConfig.id;
    const schemaRes = await getTableSchema(tableId);
    const col = schemaRes.columns.find((c) => c.name === fieldName);
    if (!col) throw new Error(`Column "${fieldName}" not found`);

    // Extract raw value from Notion-format property payload
    const rawValue = extractRawValue(propPayload, col.type);
    // Send partial cell update — worker merges with existing cells
    await updateRow(tableId, recordId, { cells: { [col.id]: rawValue }, merge_cells: true });
    return true;
  }

  // Notion: propPayload is already a Notion property object
  {
    const conn = getConnection();
    const wUrl = user?.workerUrl || conn?.workerUrl;
    const nKey = user?.notionKey || "";
    if (wUrl) {
      await updatePage(wUrl, nKey, recordId, { [fieldName]: propPayload });
      return true;
    }
  }

  throw new Error("Cannot update: no connection available");
}

// ─── Create a record in any source ───

export async function createRecord(pageConfig, properties, user) {
  const type = resolveSourceType(pageConfig);

  if (type === "d1") {
    const tableId = pageConfig.id;
    const schemaRes = await getTableSchema(tableId);
    const columns = schemaRes.columns || [];

    // Convert Notion-style properties to D1 cells
    const cells = {};
    for (const col of columns) {
      if (properties[col.name] !== undefined) {
        cells[col.id] = extractRawValue(properties[col.name], col.type);
      }
    }

    const result = await createRows(tableId, { cells });
    return result.ids?.[0];
  }

  // Notion: properties are already Notion-formatted
  {
    const conn = getConnection();
    const wUrl = user?.workerUrl || conn?.workerUrl;
    const nKey = user?.notionKey || "";
    if (wUrl) {
      const dbId = pageConfig.databaseIds?.[0];
      if (!dbId) throw new Error("No database connected");
      const page = await createPage(wUrl, nKey, dbId, properties);
      return page.id;
    }
  }

  throw new Error("Cannot create: no connection available");
}

// ─── Delete records in any source ───

export async function deleteRecords(pageConfig, recordIds, user) {
  const type = resolveSourceType(pageConfig);

  if (type === "d1") {
    const tableId = pageConfig.id;
    for (const id of recordIds) {
      await deleteRow(tableId, id);
    }
    return true;
  }

  // Notion: archive pages
  {
    const conn = getConnection();
    const wUrl = user?.workerUrl || conn?.workerUrl;
    const nKey = user?.notionKey || "";
    if (wUrl) {
      for (const id of recordIds) {
        await archivePage(wUrl, nKey, id);
      }
      return true;
    }
  }

  throw new Error("Cannot delete: no connection available");
}

// ─── Build Notion-compatible property payload for D1 ───
// This lets views call buildProp() from helpers.js and have it work for D1 too.

export function buildD1Prop(colType, value) {
  return wrapAsNotionProp(value, colType);
}

// ─── Conversion Helpers ───

/**
 * Convert D1 column schema → Notion-compatible classified schema.
 * This is the same format returned by detectSchema() in notion/schema.js.
 */
function d1SchemaToClassified(tableId, title, columns) {
  const schema = {
    databaseId: tableId,
    databaseTitle: title,
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
    _source: "d1",
    _columns: columns,
  };

  columns.forEach((col, idx) => {
    const notionType = idx === 0 ? "title" : mapD1Type(col.type);
    const field = { name: col.name, id: col.id, type: notionType };

    if (idx === 0) {
      schema.title = field;
    } else {
      switch (col.type) {
        case "text":
          schema.richTexts.push(field);
          break;
        case "number":
          field.format = col.format || "number";
          schema.numbers.push(field);
          break;
        case "date":
          schema.dates.push(field);
          break;
        case "select":
          field.options = normalizeOptions(col.options);
          schema.selects.push(field);
          break;
        case "multi_select":
          field.options = normalizeOptions(col.options);
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
        case "phone":
          field.type = "phone_number";
          schema.phones.push(field);
          break;
        case "status":
          field.options = normalizeOptions(col.options);
          schema.statuses.push(field);
          break;
      }
    }

    schema.allFields.push(field);
  });

  return schema;
}

/**
 * Convert a D1 table row → Notion-compatible page object.
 */
function d1RowToPage(row, columns) {
  const properties = {};

  columns.forEach((col, idx) => {
    const value = row.cells[col.id];
    if (idx === 0) {
      properties[col.name] = {
        type: "title",
        title: [{
          type: "text",
          plain_text: value != null ? String(value) : "",
          text: { content: value != null ? String(value) : "" },
        }],
      };
    } else {
      properties[col.name] = wrapAsNotionProp(value, col.type);
    }
  });

  return {
    id: row.id,
    object: "page",
    properties,
    created_time: row.created_at,
    last_edited_time: row.updated_at,
    _source: "d1",
    _tableId: row.table_id,
    _sortOrder: row.sort_order,
  };
}

/**
 * Wrap a raw D1 cell value as a Notion-compatible property object.
 */
function wrapAsNotionProp(value, colType) {
  switch (colType) {
    case "text":
      return {
        type: "rich_text",
        rich_text: [{
          type: "text",
          plain_text: value != null ? String(value) : "",
          text: { content: value != null ? String(value) : "" },
        }],
      };
    case "number":
      return { type: "number", number: value != null ? Number(value) : null };
    case "date":
      return { type: "date", date: value ? { start: value } : null };
    case "select":
      return { type: "select", select: value ? { name: String(value) } : null };
    case "multi_select": {
      const arr = Array.isArray(value)
        ? value
        : (value ? String(value).split(",").map((s) => s.trim()) : []);
      return { type: "multi_select", multi_select: arr.map((v) => ({ name: v })) };
    }
    case "checkbox":
      return { type: "checkbox", checkbox: !!value };
    case "url":
      return { type: "url", url: value || null };
    case "email":
      return { type: "email", email: value || null };
    case "phone":
      return { type: "phone_number", phone_number: value || null };
    case "status":
      return { type: "status", status: value ? { name: String(value) } : null };
    default:
      return {
        type: "rich_text",
        rich_text: [{
          type: "text",
          plain_text: value != null ? String(value) : "",
          text: { content: value != null ? String(value) : "" },
        }],
      };
  }
}

/**
 * Extract a raw value from a Notion-format property payload.
 * Handles both Notion API objects and raw values.
 */
function extractRawValue(prop, targetType) {
  if (prop === null || prop === undefined) return null;
  if (typeof prop !== "object") return prop;

  switch (prop.type) {
    case "title":
      return prop.title?.map((t) => t.plain_text).join("") || "";
    case "rich_text":
      return prop.rich_text?.map((t) => t.plain_text).join("") || "";
    case "number":
      return prop.number;
    case "date":
      return prop.date?.start || null;
    case "select":
      return prop.select?.name || null;
    case "multi_select":
      return (prop.multi_select || []).map((o) => o.name);
    case "checkbox":
      return !!prop.checkbox;
    case "url":
      return prop.url || null;
    case "email":
      return prop.email || null;
    case "phone_number":
      return prop.phone_number || null;
    case "status":
      return prop.status?.name || null;
    default:
      return null;
  }
}

function mapD1Type(d1Type) {
  const map = {
    text: "rich_text",
    number: "number",
    date: "date",
    select: "select",
    multi_select: "multi_select",
    checkbox: "checkbox",
    url: "url",
    email: "email",
    phone: "phone_number",
    status: "status",
  };
  return map[d1Type] || "rich_text";
}

function normalizeOptions(options) {
  if (!options) return [];
  return options.map((o) => ({
    name: typeof o === "string" ? o : o.name,
    color: typeof o === "string" ? "default" : (o.color || "default"),
  }));
}
