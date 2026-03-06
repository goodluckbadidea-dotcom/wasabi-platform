// ─── Shared View Helpers ───
// Common utilities used across all view components.
// Extracted from Table.jsx to avoid duplication.

import { readProp } from "../notion/properties.js";
import { formatDate, truncate } from "../utils/helpers.js";

/** Get the property type for a field name from schema */
export function getFieldType(schema, fieldName) {
  if (!schema) return null;
  const field = schema.allFields.find((f) => f.name === fieldName);
  return field?.type || null;
}

/** Get select/status options for a field */
export function getFieldOptions(schema, fieldName) {
  if (!schema) return [];
  const field = schema.allFields.find((f) => f.name === fieldName);
  return field?.options || [];
}

/** Get option names for select/status fields */
export function getOptionNames(schema, fieldName) {
  return getFieldOptions(schema, fieldName).map((o) => o.name);
}

/** Read a property value from a page by field name */
export function readField(page, fieldName) {
  if (!page?.properties?.[fieldName]) return null;
  return readProp(page.properties[fieldName]);
}

/** Get a displayable string from a field value */
export function displayValue(value, type) {
  if (value === null || value === undefined) return "";
  if (type === "date") {
    if (typeof value === "object" && value.start) {
      return formatDate(value.start, { short: true });
    }
    return formatDate(String(value), { short: true });
  }
  if (type === "checkbox") return value ? "Yes" : "No";
  if (type === "people") {
    if (Array.isArray(value)) return value.map((p) => p.name || p.email || p.id).join(", ");
    return "";
  }
  if (type === "files") {
    if (Array.isArray(value)) return value.map((f) => f.name).join(", ");
    return "";
  }
  if (type === "multi_select") {
    if (Array.isArray(value)) return value.join(", ");
    return "";
  }
  if (type === "relation") {
    if (Array.isArray(value)) return `${value.length} linked`;
    return "";
  }
  if (Array.isArray(value)) return value.join(", ");
  return truncate(String(value), 120);
}

/** Convert a raw value into a string for search matching */
export function searchableText(value, type) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? v.name || "" : String(v))).join(" ");
  if (typeof value === "object") {
    if (value.start) return value.start;
    return JSON.stringify(value);
  }
  return String(value).toLowerCase();
}

/** Resolve column list from schema when not provided in config */
export function resolveColumns(schema, configColumns) {
  if (configColumns && configColumns.length > 0) return configColumns;
  if (!schema) return [];

  const cols = [];
  if (schema.title) cols.push(schema.title.name);

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
    ...schema.formulas,
    ...schema.rollups,
  ];

  for (const f of orderedFields) {
    if (!cols.includes(f.name)) cols.push(f.name);
  }

  if (schema.uniqueId && !cols.includes(schema.uniqueId.name)) {
    cols.unshift(schema.uniqueId.name);
  }
  if (schema.createdTime && !cols.includes(schema.createdTime.name)) {
    cols.push(schema.createdTime.name);
  }
  if (schema.lastEditedTime && !cols.includes(schema.lastEditedTime.name)) {
    cols.push(schema.lastEditedTime.name);
  }

  return cols;
}

/**
 * Resolve a field name from config or fallback to schema auto-detection.
 * @param {object} schema - Classified schema
 * @param {string|null} configName - User-specified field name (may be null)
 * @param {string[]} fallbackTypes - Schema property buckets to search in order
 * @returns {string|null} Field name or null
 */
export function resolveField(schema, configName, fallbackTypes) {
  if (configName) return configName;
  if (!schema) return null;

  for (const type of fallbackTypes) {
    if (type === "title" && schema.title) return schema.title.name;
    const bucket = schema[type];
    if (Array.isArray(bucket) && bucket.length > 0) return bucket[0].name;
  }
  return null;
}

/**
 * Compute an aggregation over data.
 * @param {Array} data - Array of Notion page objects
 * @param {object} schema - Classified schema
 * @param {string} field - Field name to aggregate
 * @param {string} aggregation - "count" | "sum" | "avg" | "min" | "max" | "countWhere"
 * @param {string} [filterValue] - For countWhere: the value to match
 * @returns {number}
 */
export function computeAggregation(data, schema, field, aggregation, filterValue) {
  if (!data || data.length === 0) return 0;

  if (aggregation === "count") return data.length;

  if (aggregation === "countWhere" && field) {
    return data.filter((page) => {
      const val = readField(page, field);
      return val === filterValue;
    }).length;
  }

  if (!field) return 0;

  const values = data
    .map((page) => readField(page, field))
    .filter((v) => v !== null && v !== undefined && typeof v === "number");

  if (values.length === 0) return 0;

  switch (aggregation) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    default:
      return values.length;
  }
}
