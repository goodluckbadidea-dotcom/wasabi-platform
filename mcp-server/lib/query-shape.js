// ─── Query/update shape normalization for the MCP tools ───
//
// The MCP tool descriptions document filters as {"col": {"op": value}} with
// ops eq/ne/gt/..., and sorts as [{field, direction}]. The worker's
// /tables/:id/query endpoint implements a different shape: filters as an
// ARRAY of {column, op, value} with ops equals/not_equals/..., sorts as
// [{column, direction}], and it matches on column IDS inside cells. Anything
// off-shape was silently ignored — a filtered query would return every row.
//
// This module translates the documented shapes into the worker's shapes,
// resolves column names to ids against the table schema, and throws LOUDLY
// on anything it cannot resolve. A filter that cannot be applied must never
// degrade into "return all rows".

const OP_MAP = {
  eq: "equals", equals: "equals",
  ne: "not_equals", not_equals: "not_equals",
  contains: "contains", not_contains: "not_contains",
  starts_with: "starts_with", ends_with: "ends_with",
  gt: "gt", gte: "gte", lt: "lt", lte: "lte",
  is_empty: "is_empty", is_not_empty: "is_not_empty",
};

// System fields live on the row, not in cells. The worker's query endpoint
// only sorts/filters cells, so these are handled MCP-side (post-sort).
const SYSTEM_FIELDS = {
  _created_time: "created_at",
  created_at: "created_at",
  _last_edited_time: "updated_at",
  updated_at: "updated_at",
};

export function buildColumnIndex(schema) {
  const cols = Array.isArray(schema?.columns) ? schema.columns : [];
  const byToken = new Map();
  for (const c of cols) if (c?.id != null) byToken.set(String(c.id), String(c.id));
  // Names resolve second so an id always wins over a same-text name.
  for (const c of cols) {
    const name = c?.name == null ? "" : String(c.name);
    if (name && !byToken.has(name)) byToken.set(name, String(c.id));
  }
  const known = cols.map((c) =>
    c.name && c.name !== c.id ? `${c.id} ("${c.name}")` : String(c.id));
  return { byToken, known };
}

export function resolveColumn(token, index, context) {
  const id = index.byToken.get(String(token));
  if (id === undefined) {
    throw new Error(
      `${context}: unknown column "${token}". Known columns: ${index.known.join(", ")}`);
  }
  return id;
}

function normalizeOneFilter(column, op, value, index) {
  const col = resolveColumn(column, index, "filters");
  if (op === "in") {
    throw new Error(
      'filters: op "in" is not supported by the worker query endpoint. ' +
      "Run one query per value, or fetch and filter client-side.");
  }
  const workerOp = OP_MAP[op];
  if (!workerOp) {
    throw new Error(
      `filters: unknown op "${op}". Supported: ${Object.keys(OP_MAP).join(", ")}, in (client-side only)`);
  }
  // eq/ne against null mean empty/not-empty — the worker has explicit ops.
  if (value === null && workerOp === "equals") return { column: col, op: "is_empty" };
  if (value === null && workerOp === "not_equals") return { column: col, op: "is_not_empty" };
  return { column: col, op: workerOp, value };
}

// Accepts the documented object shape {"col": {"op": value, ...}, ...} or an
// already-array shape [{column|field, op, value}]. Returns the worker array.
export function normalizeFilters(filters, index) {
  if (filters == null) return [];
  const out = [];
  if (Array.isArray(filters)) {
    for (const f of filters) {
      if (!f || typeof f !== "object" || !f.op || (f.column == null && f.field == null)) {
        throw new Error(
          "filters: array entries must be {column (or field), op, value}; got " + JSON.stringify(f));
      }
      out.push(normalizeOneFilter(f.column ?? f.field, f.op, f.value, index));
    }
    return out;
  }
  if (typeof filters !== "object") {
    throw new Error("filters: expected an object or array, got " + typeof filters);
  }
  for (const [column, spec] of Object.entries(filters)) {
    if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
      // Shorthand {"col": value} means equals.
      out.push(normalizeOneFilter(column, "eq", spec, index));
      continue;
    }
    for (const [op, value] of Object.entries(spec)) {
      out.push(normalizeOneFilter(column, op, value, index));
    }
  }
  return out;
}

// Returns { workerSorts, postSorts }. Cell-column sorts go to the worker;
// system-field sorts (created_at/updated_at and their _-aliases) are applied
// MCP-side after fetch via applyPostSorts.
export function normalizeSorts(sorts, index) {
  if (sorts == null) return { workerSorts: [], postSorts: [] };
  if (!Array.isArray(sorts)) {
    throw new Error('sorts: expected an array of {field, direction}');
  }
  const workerSorts = [];
  const postSorts = [];
  for (const s of sorts) {
    const token = s?.column ?? s?.field;
    if (token == null) {
      throw new Error("sorts: entries must be {field (or column), direction}; got " + JSON.stringify(s));
    }
    const direction = s.direction === "desc" ? "desc" : "asc";
    const sysField = SYSTEM_FIELDS[String(token)];
    if (sysField) {
      postSorts.push({ rowField: sysField, direction });
    } else {
      workerSorts.push({ column: resolveColumn(token, index, "sorts"), direction });
    }
  }
  return { workerSorts, postSorts };
}

export function applyPostSorts(rows, postSorts) {
  if (!postSorts.length) return rows;
  return [...rows].sort((a, b) => {
    for (const s of postSorts) {
      const va = a?.[s.rowField] ?? "";
      const vb = b?.[s.rowField] ?? "";
      const dir = s.direction === "desc" ? -1 : 1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
    }
    return 0;
  });
}

// Resolves a comma-separated fields list. Returns [{token, id}] so callers
// can project under the exact token the caller asked for. Throws on unknowns
// instead of silently returning cells: {}.
export function normalizeFields(fieldsCsv, index) {
  if (!fieldsCsv) return null;
  return String(fieldsCsv)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((token) => ({ token, id: resolveColumn(token, index, "fields") }));
}

// Row PATCH bodies. The worker REPLACES the whole cells object unless
// merge_cells is set — every caller assumed merge, so merge is the default
// here. A payload with none of the worker's known top-level keys is treated
// as a bare cells map and wrapped.
const ROW_BODY_KEYS = new Set([
  "cells", "merge_cells", "sort_order", "parent_row_id", "archived",
  "metadata", "owner_user_id", "_fromSync", "base_versions",
]);

export function normalizeRowUpdateBody(data) {
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("update: `data` must be a JSON object");
  }
  const keys = Object.keys(data);
  if (keys.length === 0) throw new Error("update: `data` is empty — nothing to write");
  const looksBare = keys.every((k) => !ROW_BODY_KEYS.has(k));
  const body = looksBare ? { cells: data } : { ...data };
  if (body.cells && body.merge_cells === undefined) body.merge_cells = true;
  return body;
}
