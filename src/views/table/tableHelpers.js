// ─── Table View Helpers ───
// Constants, type maps, and the enhanced resolveColumns function.

import {
  IconChevronDown, IconArrowDown, IconCalendar, IconCheckSquare,
  IconLink, IconMail, IconPhone, IconStatusDot, IconUser,
} from "../../design/icons.jsx";
import { getFieldType } from "../_viewHelpers.js";

// ─── Owner Column Constants ───
export const OWNER_COL_NAME = "Owner";
export const OWNER_COL_WIDTH = 180;

// D1 type → Notion property type mapping
export const D1_TO_NOTION_TYPE = {
  text: "rich_text", number: "number", select: "select",
  multi_select: "multi_select", date: "date", checkbox: "checkbox",
  url: "url", email: "email", phone: "phone_number", status: "status",
  people: "people", relation: "relation",
};

// ─── Column Types ───
export const COLUMN_TYPES = [
  { value: "text", label: "Text", text: "AA", Icon: null },
  { value: "number", label: "Number", text: "#", Icon: null },
  { value: "select", label: "Select", text: null, Icon: IconChevronDown },
  { value: "multi_select", label: "Multi Select", text: null, Icon: IconArrowDown },
  { value: "date", label: "Date", text: null, Icon: IconCalendar },
  { value: "checkbox", label: "Checkbox", text: null, Icon: IconCheckSquare },
  { value: "url", label: "URL", text: null, Icon: IconLink },
  { value: "email", label: "Email", text: null, Icon: IconMail },
  { value: "phone", label: "Phone", text: null, Icon: IconPhone },
  { value: "status", label: "Status", text: null, Icon: IconStatusDot },
  { value: "people", label: "Person", text: null, Icon: IconUser },
  { value: "relation", label: "Relation", text: null, Icon: IconLink },
];

// ─── Type Icon Lookup (returns { text, Icon } or null) ───
export const TYPE_ICON_MAP = {};
COLUMN_TYPES.forEach((t) => { TYPE_ICON_MAP[t.value] = { text: t.text, Icon: t.Icon }; });
TYPE_ICON_MAP["rich_text"] = { text: "AA", Icon: null };
TYPE_ICON_MAP["title"] = { text: "AA", Icon: null };
TYPE_ICON_MAP["phone_number"] = { text: null, Icon: IconPhone };
TYPE_ICON_MAP["last_edited_time"] = { text: null, Icon: IconCalendar };
TYPE_ICON_MAP["created_time"] = { text: null, Icon: IconCalendar };

export function mapD1TypeForUI(d1Type) { return D1_TO_NOTION_TYPE[d1Type] || d1Type; }
export function getTypeIcon(schema, fieldName) { return TYPE_ICON_MAP[getFieldType(schema, fieldName)] || null; }

// ─── Constants ───
export const ROW_HEIGHT = 36;
export const VIRT_BUFFER = 20;

export const EDITABLE_TYPES = new Set([
  "title", "rich_text", "number", "select", "status",
  "date", "checkbox", "url", "email", "phone_number",
  "multi_select",
]);

export const TEXT_SEARCH_TYPES = new Set([
  "title", "rich_text", "select", "status", "url", "email",
  "phone_number", "unique_id",
]);

// ─── Enhanced resolveColumns ───
// Table's version: reconciles saved config columns against live schema.
// Diverges from _viewHelpers.resolveColumns by accepting fieldMappings
// and doing stale-column reconciliation.

/** Resolve column list from schema when not provided in config.
 *  When config.columns exists, still appends any NEW schema fields
 *  so that columns added in Notion are discovered automatically. */
export function resolveColumns(schema, configColumns, fieldMappings) {
  let cols;

  // Build the full schema-derived list (used as source of truth)
  const schemaColumns = [];
  if (schema) {
    if (schema.title) schemaColumns.push(schema.title.name);
    if (schema.uniqueId && !schemaColumns.includes(schema.uniqueId.name)) {
      schemaColumns.unshift(schema.uniqueId.name);
    }

    const orderedFields = [
      ...schema.statuses,
      ...schema.selects,
      ...schema.numbers,
      ...schema.dates,
      ...schema.richTexts,
      ...schema.checkboxes,
      ...schema.urls,
      ...schema.emails,
      ...schema.phones,
      ...schema.multiSelects,
      ...schema.people,
      ...schema.relations,
      ...schema.files,
      ...schema.formulas,
      ...schema.rollups,
    ];
    for (const f of orderedFields) {
      if (!schemaColumns.includes(f.name)) schemaColumns.push(f.name);
    }
    if (schema.createdTime && !schemaColumns.includes(schema.createdTime.name)) {
      schemaColumns.push(schema.createdTime.name);
    }
    if (schema.lastEditedTime && !schemaColumns.includes(schema.lastEditedTime.name)) {
      schemaColumns.push(schema.lastEditedTime.name);
    }
  }

  if (configColumns && configColumns.length > 0 && schemaColumns.length > 0) {
    // Reconcile saved columns against live schema:
    // 1. Keep saved columns that still exist in schema (preserves user ordering)
    // 2. Drop stale columns that no longer exist in schema (renamed/deleted in Notion)
    // 3. Append new schema columns not in the saved list
    const schemaSet = new Set(schemaColumns);
    cols = configColumns.filter((c) => schemaSet.has(c));
    const colSet = new Set(cols);
    for (const sc of schemaColumns) {
      if (!colSet.has(sc)) cols.push(sc);
    }
  } else if (configColumns && configColumns.length > 0) {
    // No schema yet — use config as-is
    cols = [...configColumns];
  } else if (!schema) {
    return [];
  } else {
    cols = schemaColumns;
  }

  return cols;
}
