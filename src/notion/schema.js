// ─── Notion Schema Detection ───
// Fetches a database, classifies its properties, and suggests view mappings.
// This is the key module that makes everything schema-agnostic.

import { getDatabase } from "./client.js";

/**
 * Detect and classify a Notion database schema.
 * Returns a structured representation of all properties.
 */
export async function detectSchema(workerUrl, notionKey, databaseId) {
  const db = await getDatabase(workerUrl, notionKey, databaseId);
  return classifyProperties(db);
}

/**
 * Classify database properties into typed buckets.
 * Works with a database object already fetched.
 */
export function classifyProperties(database) {
  const props = database.properties || {};
  const schema = {
    databaseId: database.id,
    databaseTitle: database.title?.map((t) => t.plain_text).join("") || "Untitled",
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
  };

  for (const [name, prop] of Object.entries(props)) {
    const field = { name, id: prop.id, type: prop.type };

    switch (prop.type) {
      case "title":
        schema.title = field;
        break;
      case "select":
        field.options = prop.select?.options?.map((o) => ({
          name: o.name,
          color: o.color,
        })) || [];
        schema.selects.push(field);
        break;
      case "status":
        field.options = prop.status?.options?.map((o) => ({
          name: o.name,
          color: o.color,
        })) || [];
        field.groups = prop.status?.groups?.map((g) => ({
          name: g.name,
          color: g.color,
          optionIds: g.option_ids,
        })) || [];
        schema.statuses.push(field);
        break;
      case "multi_select":
        field.options = prop.multi_select?.options?.map((o) => ({
          name: o.name,
          color: o.color,
        })) || [];
        schema.multiSelects.push(field);
        break;
      case "date":
        schema.dates.push(field);
        break;
      case "number":
        field.format = prop.number?.format || "number";
        schema.numbers.push(field);
        break;
      case "rich_text":
        schema.richTexts.push(field);
        break;
      case "checkbox":
        schema.checkboxes.push(field);
        break;
      case "relation":
        field.relatedDbId = prop.relation?.database_id;
        field.synced = prop.relation?.type === "dual_property";
        schema.relations.push(field);
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
        field.expression = prop.formula?.expression;
        schema.formulas.push(field);
        break;
      case "rollup":
        field.rollupConfig = {
          relation: prop.rollup?.relation_property_name,
          targetProp: prop.rollup?.rollup_property_name,
          function: prop.rollup?.function,
        };
        schema.rollups.push(field);
        break;
      case "created_time":
        schema.createdTime = field;
        break;
      case "last_edited_time":
        schema.lastEditedTime = field;
        break;
      case "created_by":
        schema.createdBy = field;
        break;
      case "last_edited_by":
        schema.lastEditedBy = field;
        break;
      case "unique_id":
        field.prefix = prop.unique_id?.prefix || "";
        schema.uniqueId = field;
        break;
    }

    schema.allFields.push(field);
  }

  return schema;
}

/**
 * Suggest which views make sense for a given schema.
 */
export function autoDetectViews(schema) {
  const views = [];

  // Table is always useful
  views.push({ type: "table", reason: "All databases can be viewed as a table" });

  // Kanban if there's a select or status field
  if (schema.statuses.length > 0 || schema.selects.length > 0) {
    const field = schema.statuses[0] || schema.selects[0];
    views.push({
      type: "kanban",
      reason: `"${field.name}" field can organize cards into columns`,
      suggestedField: field.name,
    });
  }

  // Gantt/Timeline if there are date fields
  if (schema.dates.length >= 1) {
    views.push({
      type: "gantt",
      reason: `Date fields (${schema.dates.map((d) => d.name).join(", ")}) enable timeline visualization`,
      suggestedFields: schema.dates.map((d) => d.name),
    });
  }

  // Cards if there's meaningful content
  if (schema.richTexts.length > 0 || schema.allFields.length >= 4) {
    views.push({
      type: "cardGrid",
      reason: "Rich content makes cards a natural display format",
    });
  }

  // Charts if there are number fields
  if (schema.numbers.length > 0) {
    views.push({
      type: "charts",
      reason: `Number fields (${schema.numbers.map((n) => n.name).join(", ")}) can be visualized as charts`,
      suggestedFields: schema.numbers.map((n) => n.name),
    });
  }

  // Summary tiles if there are numbers or selects (for counting)
  if (schema.numbers.length > 0 || schema.selects.length > 0 || schema.statuses.length > 0) {
    views.push({
      type: "summaryTiles",
      reason: "Summary metrics provide at-a-glance overview",
    });
  }

  // Form is always useful for data entry
  views.push({ type: "form", reason: "Data entry form for adding new records" });

  return views;
}

/**
 * Suggest field→role mappings for a specific view type.
 */
export function suggestViewMappings(schema, viewType) {
  const mappings = {};

  switch (viewType) {
    case "table":
      // All fields as columns, title first
      mappings.columns = [
        schema.title?.name,
        ...schema.selects.map((s) => s.name),
        ...schema.statuses.map((s) => s.name),
        ...schema.numbers.map((n) => n.name),
        ...schema.dates.map((d) => d.name),
        ...schema.richTexts.map((r) => r.name),
        ...schema.checkboxes.map((c) => c.name),
        ...schema.urls.map((u) => u.name),
        ...schema.emails.map((e) => e.name),
      ].filter(Boolean);
      break;

    case "gantt":
      mappings.labelField = schema.title?.name;
      mappings.dateFields = schema.dates.map((d) => d.name);
      mappings.colorField = (schema.statuses[0] || schema.selects[0])?.name;
      break;

    case "cardGrid":
      mappings.titleField = schema.title?.name;
      mappings.bodyFields = schema.richTexts.slice(0, 2).map((r) => r.name);
      mappings.badgeField = (schema.statuses[0] || schema.selects[0])?.name;
      mappings.metricFields = schema.numbers.slice(0, 3).map((n) => n.name);
      break;

    case "kanban":
      const kanbanField = schema.statuses[0] || schema.selects[0];
      mappings.columnField = kanbanField?.name;
      mappings.columns = kanbanField?.options?.map((o) => o.name) || [];
      mappings.titleField = schema.title?.name;
      mappings.previewFields = [
        ...schema.richTexts.slice(0, 1).map((r) => r.name),
        ...schema.dates.slice(0, 1).map((d) => d.name),
      ];
      break;

    case "charts":
      mappings.categoryField = (schema.selects[0] || schema.statuses[0])?.name;
      mappings.valueFields = schema.numbers.map((n) => n.name);
      mappings.dateField = schema.dates[0]?.name;
      break;

    case "summaryTiles":
      mappings.tiles = [
        // Total count
        { label: "Total Records", aggregation: "count" },
        // Number field sums/averages
        ...schema.numbers.slice(0, 3).map((n) => ({
          label: n.name,
          field: n.name,
          aggregation: "sum",
        })),
      ];
      break;

    case "form":
      // All writable fields
      mappings.fields = schema.allFields
        .filter((f) => !["created_time", "last_edited_time", "created_by", "last_edited_by", "formula", "rollup", "unique_id"].includes(f.type))
        .map((f) => f.name);
      break;
  }

  return mappings;
}

/**
 * Generate a human-readable schema summary for agent context.
 */
export function schemaToText(schema) {
  const lines = [`Database: "${schema.databaseTitle}" (${schema.databaseId})`];

  if (schema.title) lines.push(`  Title field: "${schema.title.name}"`);

  for (const field of schema.allFields) {
    if (field.type === "title") continue;
    let desc = `  "${field.name}" (${field.type})`;
    if (field.options?.length) {
      desc += ` — options: ${field.options.map((o) => o.name).join(", ")}`;
    }
    if (field.format && field.format !== "number") {
      desc += ` — format: ${field.format}`;
    }
    lines.push(desc);
  }

  return lines.join("\n");
}
