// ─── Data Source Abstraction ───
// Normalizes data from D1 (standalone tables), Notion, and linked sheets
// into a common format that existing views can consume unchanged.
//
// All sources return Notion-compatible page objects:
//   { id, properties: { [fieldName]: { type, ...value } } }
// All schemas return the same classified format from notion/schema.js.

import { queryAll } from "../notion/pagination.js";
import { detectSchema } from "../notion/schema.js";
import { listRows, createRows, updateRow, deleteRow, queryTable, getTableSchema, getConnection, updateTableSchema, updateSubColumnSchema } from "./api.js";
import { fetchBoardItems, fetchBoardColumns } from "../monday/client.js";
import { mondayColumnsToSchema, mondayItemToPage } from "../monday/schema.js";
import { computeSubItemRollup } from "./subItemRollup.js";

// ─── Main entry: fetch data + schema from any source ───

export async function fetchDataSource(pageConfig, user) {
  const type = resolveSourceType(pageConfig);

  switch (type) {
    case "d1":
      return await fetchD1Table(pageConfig);
    case "notion":
      return await fetchNotionDb(pageConfig, user);
    case "monday":
      return await fetchMondayBoard(pageConfig, user);
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
  if (pt === "standalone_table") return "d1";
  if (pt === "linked_notion") return "d1"; // All data synced to D1 — Notion is sync layer, not read source
  if (pt === "linked_monday") return "monday";
  if (pt === "linked_sheet") return "linked_sheet";
  if (pt === "document") return "document";
  if (pt === "folder") return "folder";
  // Legacy: pages with databaseIds are D1-backed (data synced from Notion)
  if (pageConfig.databaseIds?.length) return "d1";
  return "none";
}

// ─── Column-name dedupe ───
// Multiple columns sharing the same `name` silently collide in the
// `page.properties` map built by d1RowToPage (keyed by col.name), which
// makes RecordDetail and Table cells show only one of them. Duplicate
// *prevention* lives in useColumnManagement (add/rename), but this repairs
// any collision that's already persisted so the app-facing schema is
// unambiguous. D1 storage is untouched — column IDs are preserved.
function dedupeColumnNames(cols) {
  const seen = new Map(); // base name -> next suffix to try
  const out = [];
  for (const col of cols) {
    const base = col?.name ?? "";
    if (!seen.has(base)) {
      seen.set(base, 2);
      out.push(col);
      continue;
    }
    // Find the next "{base} (N)" that isn't already taken by either an
    // earlier deduped entry or another real column in this list.
    let n = seen.get(base);
    const existingNames = new Set(out.map((c) => c?.name));
    let candidate = `${base} (${n})`;
    while (existingNames.has(candidate)) {
      n += 1;
      candidate = `${base} (${n})`;
    }
    seen.set(base, n + 1);
    out.push({ ...col, name: candidate });
  }
  return out;
}

// ─── D1 Standalone Table ───

async function fetchD1Table(pageConfig) {
  const tableId = pageConfig.id;

  let schemaRes, rowsRes;
  try {
    [schemaRes, rowsRes] = await Promise.all([
      getTableSchema(tableId).catch(() => ({ columns: [] })),
      listRows(tableId, { limit: 1000 }).catch(() => ({ rows: [] })),
    ]);
  } catch {
    schemaRes = { columns: [] };
    rowsRes = { rows: [] };
  }

  const dedupedColumns = dedupeColumnNames(schemaRes.columns || []);
  const dedupedSubColumns = dedupeColumnNames(schemaRes.sub_columns || []);

  // Phase 1 color-repair pass: backfill missing option colors so native
  // D1 tables render identically to linked-Notion tables. User-picked
  // colors are preserved. Fire-and-forget writeback if anything changed
  // — we always return the in-memory repaired shape so first paint is
  // correct even if the write is still in flight. Deterministic, so
  // concurrent opens converge on the same result.
  const { repaired: columns, changed: columnsChanged } = repairOptionColors(dedupedColumns);
  const { repaired: subColumns, changed: subColumnsChanged } = repairOptionColors(dedupedSubColumns);
  if (columnsChanged) {
    updateTableSchema(tableId, columns).catch((err) => {
      console.warn("[dataSource] option-color repair writeback failed (columns):", err?.message || err);
    });
  }
  if (subColumnsChanged) {
    updateSubColumnSchema(tableId, subColumns).catch((err) => {
      console.warn("[dataSource] option-color repair writeback failed (sub_columns):", err?.message || err);
    });
  }

  const rows = rowsRes.rows || [];

  const schema = d1SchemaToClassified(tableId, pageConfig.title || pageConfig.name, columns);
  schema._subColumns = subColumns;
  if (subColumns.length > 0) {
    schema._subSchema = d1SchemaToClassified(tableId, pageConfig.title || pageConfig.name, subColumns);
  }
  // Build parent cell lookup so sub-item rows can inherit parent fields
  const parentCellMap = {};
  for (const row of rows) {
    if (!row.parent_row_id) {
      parentCellMap[row.id] = row.cells;
    }
  }

  const data = rows.map((row) => d1RowToPage(row, columns, subColumns, parentCellMap));

  // ── Sub-item roll-up: attach _rollup to parent pages ──
  const subSchema = schema._subSchema || null;
  if (subSchema) {
    const childrenByParent = {};
    for (const page of data) {
      if (page._parentRowId) {
        (childrenByParent[page._parentRowId] ||= []).push(page);
      }
    }
    for (const page of data) {
      if (!page._parentRowId && childrenByParent[page.id]) {
        page._rollup = computeSubItemRollup(page, childrenByParent[page.id], schema, subSchema);
      }
    }
  }

  return { data, schema, schemas: { [tableId]: schema } };
}

// ─── Notion Linked Database ───

async function fetchNotionDb(pageConfig, user) {
  const dbIds = pageConfig.databaseIds || [];
  if (dbIds.length === 0) return { data: [], schema: null, schemas: {} };

  const schemas = {};
  for (const dbId of dbIds) {
    try {
      schemas[dbId] = await detectSchema(dbId);
    } catch (err) {
      console.warn(`Schema fetch failed for ${dbId}:`, err.message);
    }
  }

  const primarySchema = schemas[dbIds[0]] || null;
  const allData = [];
  for (const dbId of dbIds) {
    const results = await queryAll(dbId);
    allData.push(...results.map((r) => {
      const page = { ...r, _databaseId: dbId };
      // Inject system timestamp properties so readField() can find them.
      // Every Notion page has last_edited_time and created_time at the page level,
      // but readField() looks in page.properties — bridge the gap here.
      const sch = schemas[dbId];
      if (sch && page.properties) {
        const letName = sch.lastEditedTime?.name;
        if (letName && sch.lastEditedTime?.system && !page.properties[letName]) {
          page.properties[letName] = {
            type: "last_edited_time",
            last_edited_time: page.last_edited_time,
          };
        }
        const ctName = sch.createdTime?.name;
        if (ctName && sch.createdTime?.system && !page.properties[ctName]) {
          page.properties[ctName] = {
            type: "created_time",
            created_time: page.created_time,
          };
        }
      }
      return page;
    }));
  }

  return { data: allData, schema: primarySchema, schemas };
}

// ─── Monday.com Board ───

async function fetchMondayBoard(pageConfig, user) {
  const mondayKey = user?.mondayKey || "";
  const boardId = pageConfig.mondayBoardId;
  if (!boardId || !mondayKey) {
    return { data: [], schema: null, schemas: {} };
  }

  try {
    const [columns, items] = await Promise.all([
      fetchBoardColumns(mondayKey, boardId),
      fetchBoardItems(mondayKey, boardId),
    ]);

    const schema = mondayColumnsToSchema(boardId, pageConfig.name || "Monday Board", columns);
    const data = items.map((item) => {
      const page = mondayItemToPage(item, columns);
      // Inject system timestamp properties so readField() can find them
      if (page.properties) {
        const letName = schema.lastEditedTime?.name;
        if (letName && schema.lastEditedTime?.system && !page.properties[letName]) {
          page.properties[letName] = {
            type: "last_edited_time",
            last_edited_time: page.last_edited_time,
          };
        }
        const ctName = schema.createdTime?.name;
        if (ctName && schema.createdTime?.system && !page.properties[ctName]) {
          page.properties[ctName] = {
            type: "created_time",
            created_time: page.created_time,
          };
        }
      }
      return page;
    });

    return { data, schema, schemas: { [`monday_${boardId}`]: schema } };
  } catch (err) {
    console.warn(`[DataSource] Monday.com fetch failed for board ${boardId}:`, err.message);
    return { data: [], schema: null, schemas: {} };
  }
}

// ─── Update a record in any source ───

export async function updateRecord(pageConfig, recordId, fieldName, propPayload, user, cellVersions, { pinToken, isSubItem } = {}) {
  const type = resolveSourceType(pageConfig);

  if (type === "d1") {
    const tableId = pageConfig.id;
    const schemaRes = await getTableSchema(tableId);
    // Apply the same in-memory name-dedupe that fetchD1Table uses, so the
    // names we search for here match the names the caller supplies (the
    // caller built propertyName from page.properties, which is keyed by
    // deduped names via d1RowToPage). Without this, a sub-column that
    // shares a name with another sub-column in raw D1 storage would be
    // unreachable from updateRecord as "Name (2)".
    const parentCols = dedupeColumnNames(schemaRes.columns || []);
    const subCols = dedupeColumnNames(schemaRes.sub_columns || []);

    // Sub-item rows must resolve against the sub-column schema. Before
    // Phase 2a this function only consulted parent columns, so sub-item
    // cell edits on columns that didn't exist in the parent schema
    // silently wrote to the wrong col.id (or no-op'd). When caller knows
    // it's a sub-item (isSubItem === true), look up in sub_columns only.
    // When caller knows it's a parent (isSubItem === false), look up in
    // parent columns only. When caller didn't say (legacy undefined),
    // try parent then sub as a last-resort fallback.
    let col = null;
    let activeCols = null;
    if (isSubItem === true) {
      activeCols = subCols;
      col = subCols.find((c) => c.name === fieldName);
    } else if (isSubItem === false) {
      activeCols = parentCols;
      col = parentCols.find((c) => c.name === fieldName);
    } else {
      col = parentCols.find((c) => c.name === fieldName);
      if (col) {
        activeCols = parentCols;
      } else {
        col = subCols.find((c) => c.name === fieldName);
        activeCols = subCols;
      }
    }
    if (!col) {
      const scope = isSubItem === true ? "sub-item columns" : isSubItem === false ? "parent columns" : "parent or sub-item columns";
      throw new Error(`Column "${fieldName}" not found in ${scope} for table "${tableId}"`);
    }

    // Resolve effective type for extraction. Mirrors createRecord's logic:
    // d1SchemaToClassified marks col.type === "title" OR (idx === 0 && no
    // explicit title) as the title field, and buildProp produces title-format
    // props for it. extractRawValue must use "title" too — if it sees the raw
    // col.type ("text" for D1 tables that don't have a literal "title" type),
    // it reads prop.rich_text (which doesn't exist on a title payload) and
    // silently saves "". This was the root cause of "rename doesn't persist."
    const idx = activeCols.indexOf(col);
    const hasExplicitTitle = activeCols.some((c) => c.type === "title");
    const effectiveType = (col.type === "title" || (idx === 0 && !hasExplicitTitle))
      ? "title"
      : col.type;

    // Extract raw value from Notion-format property payload
    const rawValue = extractRawValue(propPayload, effectiveType);
    // Build update with base_versions for conflict detection
    const update = { cells: { [col.id]: rawValue }, merge_cells: true };
    if (cellVersions && cellVersions[col.id] !== undefined) {
      update.base_versions = { [col.id]: cellVersions[col.id] };
    }
    const result = await updateRow(tableId, recordId, update, { pinToken });
    return result;
  }

  throw new Error(`Cannot update: unsupported source type "${type}" for page "${pageConfig.id}"`);
}

// ─── Create a record in any source ───

export async function createRecord(pageConfig, properties, user, { pinToken, parentRowId } = {}) {
  const type = resolveSourceType(pageConfig);

  if (type === "d1") {
    const tableId = pageConfig.id;
    const schemaRes = await getTableSchema(tableId);
    // Apply the same in-memory name-dedupe that fetchD1Table uses. The
    // caller built `properties` using deduped names (keyed off
    // page.properties from d1RowToPage), so the raw schema from the
    // worker — which may contain literal duplicates like two columns
    // both named "Status" — would cause the loop below to resolve both
    // to the same properties[name] and silently drop one write.
    const parentCols = dedupeColumnNames(schemaRes.columns || []);
    const subCols = dedupeColumnNames(schemaRes.sub_columns || []);

    // Strict schema selection: sub-item creates MUST use sub_columns
    // only. Before Phase 2a this merged parent + sub columns, which
    // caused name collisions (e.g. "Status" present in both) to route
    // the sub-item's value to the parent column. The title-detection
    // index was also computed against the merged array, breaking title
    // resolution for sub-items.
    const activeCols = parentRowId ? subCols : parentCols;
    const hasExplicitTitle = activeCols.some((c) => c.type === "title");

    const cells = {};
    for (let i = 0; i < activeCols.length; i++) {
      const col = activeCols[i];
      if (properties[col.name] === undefined) continue;
      // d1SchemaToClassified treats col.type === "title" OR idx === 0 as
      // title, so buildProp produces title-format props. Match that
      // logic here (using the index within activeCols alone) so
      // extractRawValue reads the correct property key.
      let effectiveType = col.type;
      if (col.type === "title" || (i === 0 && !hasExplicitTitle)) {
        effectiveType = "title";
      }
      cells[col.id] = extractRawValue(properties[col.name], effectiveType);
    }

    const result = await createRows(tableId, { cells, parent_row_id: parentRowId || null }, { pinToken });
    return result.ids?.[0];
  }

  throw new Error(`Cannot create: unsupported source type "${type}" for page "${pageConfig.id}"`);
}

// ─── Delete records in any source ───

export async function deleteRecords(pageConfig, recordIds, user, { pinToken, cascade, confirmDependents } = {}) {
  const type = resolveSourceType(pageConfig);

  if (type === "d1") {
    const tableId = pageConfig.id;
    for (const id of recordIds) {
      try {
        const result = await deleteRow(tableId, id, { pinToken, cascade, confirmDependents });
        // If server returns 409 (has children OR has dependents), propagate it
        if (result?.hasChildren || result?.hasDependents) return result;
      } catch (err) {
        // 409 = needs caller decision (children or dependents) — propagate instead of throwing
        if (err.status === 409 && (err.data?.hasChildren || err.data?.hasDependents)) return err.data;
        throw err;
      }
    }
    return true;
  }

  throw new Error(`Cannot delete: unsupported source type "${type}" for page "${pageConfig.id}"`);
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
    figmaFiles: [],
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
    // Use explicit "title" type if set, otherwise first column is title
    const isTitle = col.type === "title" || (idx === 0 && !schema.title);
    const notionType = isTitle ? "title" : mapD1Type(col.type);
    const field = { name: col.name, id: col.id, type: notionType };

    if (isTitle && !schema.title) {
      schema.title = field;
    } else {
      switch (col.type) {
        case "title": // Explicit title type (from Notion-synced schemas)
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
        case "relation":
          schema.relations.push(field);
          break;
        case "people":
          schema.people.push(field);
          break;
        case "files":
          schema.files.push(field);
          break;
        case "figma_files":
          schema.figmaFiles.push(field);
          break;
      }
    }

    schema.allFields.push(field);
  });

  // Auto-inject system timestamp fields (data lives on row, not in cells)
  schema.lastEditedTime = { name: "Last Updated", id: "_last_edited_time", type: "last_edited_time", system: true };
  schema.createdTime = { name: "Created", id: "_created_time", type: "created_time", system: true };
  schema.allFields.push(schema.lastEditedTime);
  schema.allFields.push(schema.createdTime);

  return schema;
}

/**
 * Extract key parent fields for sub-item inheritance.
 * Returns a flat object with priority, status, and dates from the parent row's cells.
 */
function buildParentFields(parentCells, columns) {
  if (!parentCells) return null;
  const result = { priority: null, status: null, dates: {} };
  for (const col of columns) {
    const value = parentCells[col.id];
    if (value === undefined || value === null) continue;
    const name = col.name.toLowerCase();
    if (col.type === "select" && name.includes("priority")) {
      result.priority = value;
    } else if (col.type === "select" && name.includes("status")) {
      result.status = value;
    } else if (col.type === "date") {
      result.dates[col.name] = value;
    }
  }
  return result;
}

/**
 * Convert a D1 table row → Notion-compatible page object.
 */
function d1RowToPage(row, columns, subColumns = [], parentCellMap = {}) {
  const properties = {};
  const isSubItem = !!row.parent_row_id;

  if (isSubItem) {
    // Sub-item rows: map ONLY sub-columns into properties
    let subHasTitle = false;
    subColumns.forEach((col, idx) => {
      const value = row.cells[col.id];
      const isTitle = col.type === "title" || (idx === 0 && !subHasTitle);
      if (isTitle) {
        const str = value != null ? String(value) : "";
        properties[col.name] = {
          type: "title",
          title: [{ type: "text", plain_text: str, text: { content: str } }],
        };
        subHasTitle = true;
      } else {
        properties[col.name] = wrapAsNotionProp(value, col.type);
      }
    });
  } else {
    // Parent rows: map ONLY parent columns into properties
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
  }

  // Inject system timestamp properties so readField() can find them
  properties["Last Updated"] = {
    type: "last_edited_time",
    last_edited_time: row.updated_at || row.created_at,
  };
  properties["Created"] = {
    type: "created_time",
    created_time: row.created_at,
  };

  // Parse owner_user_id — stored as JSON array string or legacy "default"/"unassigned"
  let ownerUserIds = [];
  if (row.owner_user_id && row.owner_user_id !== "default" && row.owner_user_id !== "unassigned") {
    try { ownerUserIds = JSON.parse(row.owner_user_id); } catch { ownerUserIds = [row.owner_user_id]; }
  }

  return {
    id: row.id,
    object: "page",
    properties,
    created_time: row.created_at,
    last_edited_time: row.updated_at,
    _source: "d1",
    _tableId: row.table_id,
    _sortOrder: row.sort_order,
    _ownerUserIds: ownerUserIds,
    _parentRowId: row.parent_row_id || null,
    _parentFields: isSubItem ? buildParentFields(parentCellMap[row.parent_row_id], columns) : null,
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
    case "date": {
      if (!value) return { type: "date", date: null };
      if (typeof value === "object" && value.start) {
        const d = { start: value.start };
        if (value.end) d.end = value.end;
        return { type: "date", date: d };
      }
      return { type: "date", date: { start: value } };
    }
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
    case "figma_files": {
      // Wasabi-native: array of { file_key, file_name, thumbnail_url }.
      // Coerce single object → single-element array. Drop entries with no file_key.
      const arr = Array.isArray(value) ? value : (value ? [value] : []);
      const normalized = arr
        .filter((v) => v && typeof v === "object" && v.file_key)
        .map((v) => ({
          file_key: String(v.file_key),
          file_name: String(v.file_name || ""),
          thumbnail_url: v.thumbnail_url ? String(v.thumbnail_url) : "",
        }));
      return { type: "figma_files", figma_files: normalized };
    }
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

  // Determine the property type: explicit `prop.type`, or infer from known keys
  // (buildProp produces `{ status: { name } }` without a `type` field)
  const kind = prop.type || targetType || inferPropKind(prop);

  switch (kind) {
    case "title":
      return prop.title?.map((t) => t.plain_text || t.text?.content || "").join("") || "";
    case "text":
    case "rich_text":
      return prop.rich_text?.map((t) => t.plain_text || t.text?.content || "").join("") || "";
    case "number":
      return prop.number;
    case "date": {
      if (!prop.date) return null;
      if (prop.date.end) return { start: prop.date.start, end: prop.date.end };
      return prop.date.start || null;
    }
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
    case "phone":
    case "phone_number":
      return prop.phone_number || null;
    case "status":
      return prop.status?.name || null;
    case "figma_files": {
      if (Array.isArray(prop)) return prop;
      if (Array.isArray(prop.figma_files)) return prop.figma_files;
      return [];
    }
    default:
      return null;
  }
}

/** Infer Notion property kind from object keys when `type` is absent */
function inferPropKind(prop) {
  if ("title" in prop) return "title";
  if ("rich_text" in prop) return "rich_text";
  if ("number" in prop) return "number";
  if ("date" in prop) return "date";
  if ("select" in prop) return "select";
  if ("multi_select" in prop) return "multi_select";
  if ("checkbox" in prop) return "checkbox";
  if ("url" in prop) return "url";
  if ("email" in prop) return "email";
  if ("phone_number" in prop) return "phone_number";
  if ("status" in prop) return "status";
  if ("figma_files" in prop) return "figma_files";
  return null;
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
    depends_on: "depends_on", // view-of-edges; cell stores nothing
    figma_files: "figma_files", // Wasabi-native: array passed through verbatim
  };
  return map[d1Type] || "rich_text";
}

// Valid status option categories for semantic roll-up.
// "not_started" is the default for backward compatibility.
export const STATUS_CATEGORIES = [
  "not_started",
  "in_progress",
  "complete",
  "on_hold",
  "cancelled",
];

function normalizeOptions(options) {
  if (!options) return [];
  return options.map((o) => {
    const opt = {
      name: typeof o === "string" ? o : (o.name || o.label),
      color: typeof o === "string" ? "default" : (o.color || "default"),
    };
    // Preserve category for status options (default: "not_started")
    if (typeof o === "object" && o.category) {
      opt.category = STATUS_CATEGORIES.includes(o.category)
        ? o.category
        : "not_started";
    }
    return opt;
  });
}

// ─── Option color auto-assignment ───
// Round-robin over the existing in-app palette keys understood by
// WASABI_COLORS / NOTION_TO_PALETTE_IDX in src/design/tokens.js. These
// are identifiers into the app's own palette, NOT a Notion dependency —
// we reuse the same key space so a single `getSolidPillColor` chain
// serves both native D1 and linked-Notion-derived tables.
const OPTION_COLOR_PALETTE = [
  "red", "orange", "yellow", "green", "blue", "purple", "pink", "brown", "gray",
];

export function assignOptionColor(optionIndex) {
  const i = Math.max(0, optionIndex | 0);
  return OPTION_COLOR_PALETTE[i % OPTION_COLOR_PALETTE.length];
}

// Walk a column array and backfill any missing/"default" option color on
// select-like columns. Returns { repaired, changed } — `changed` is true
// iff at least one option was actually rewritten. User-picked colors
// (anything not "default") are left alone. Deterministic by option index
// so concurrent repairs from different clients converge.
const SELECT_LIKE_TYPES = new Set(["select", "multi_select", "status"]);

function repairOptionColors(cols) {
  let changed = false;
  const repaired = (cols || []).map((col) => {
    if (!col || !SELECT_LIKE_TYPES.has(col.type) || !Array.isArray(col.options)) {
      return col;
    }
    let colChanged = false;
    const newOptions = col.options.map((opt, idx) => {
      // Support both string and object option shapes defensively.
      if (typeof opt === "string") {
        colChanged = true;
        return { name: opt, color: assignOptionColor(idx) };
      }
      if (!opt.color || opt.color === "default") {
        colChanged = true;
        return { ...opt, color: assignOptionColor(idx) };
      }
      return opt;
    });
    if (!colChanged) return col;
    changed = true;
    return { ...col, options: newOptions };
  });
  return { repaired, changed };
}
