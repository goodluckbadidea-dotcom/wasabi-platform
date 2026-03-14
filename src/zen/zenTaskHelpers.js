// ─── Zen Task Helpers ───
// Shared utilities for the Zen To-Do engine: normalization, dates, caching.

/**
 * Normalize a D1 row into a uniform task object.
 * D1 rows come as { id, cells: { col_id: value, ... }, created_at, updated_at }
 */
export function normalizeD1Task(row, columns) {
  const cells = row.cells || {};
  // Map column IDs to names for lookup
  const colMap = {};
  (columns || []).forEach((col) => {
    colMap[col.id || col.name?.toLowerCase()] = col;
  });

  // Find fields by column name pattern
  const findCell = (patterns) => {
    for (const [key, val] of Object.entries(cells)) {
      const col = colMap[key];
      const name = (col?.name || key).toLowerCase();
      if (patterns.some((p) => name.includes(p))) return val;
    }
    return null;
  };

  return {
    id: row.id,
    title: findCell(["task", "title", "name"]) || "Untitled",
    done: !!findCell(["done", "complete", "check"]),
    priority: findCell(["priority"]) || null,
    due: findCell(["due", "date"]) || null,
    notes: findCell(["notes", "note", "description"]) || "",
    source: "manual",
    sourceName: "Zen Tasks",
    createdAt: row.created_at || null,
    _raw: row,
  };
}

/**
 * Normalize a Notion page into a uniform task object.
 */
export function normalizeNotionTask(page, schema, dbName) {
  const props = page.properties || {};

  // Find title
  let title = "";
  if (schema?.title) {
    const titleProp = props[schema.title];
    title = readNotionProp(titleProp) || "";
  }
  if (!title) {
    // Fallback: find first title-type property
    for (const [, val] of Object.entries(props)) {
      if (val?.type === "title") {
        title = readNotionProp(val) || "";
        if (title) break;
      }
    }
  }

  // Find status/done
  let done = false;
  let status = null;
  for (const field of (schema?.statuses || [])) {
    const val = readNotionProp(props[field.name]);
    if (val) {
      status = val;
      const lower = String(val).toLowerCase();
      done = lower === "done" || lower === "complete" || lower === "completed";
    }
  }
  for (const field of (schema?.checkboxes || [])) {
    const val = props[field.name];
    if (val?.type === "checkbox") {
      done = !!val.checkbox;
    }
  }

  // Find priority
  let priority = null;
  for (const field of (schema?.selects || [])) {
    const name = field.name.toLowerCase();
    if (name.includes("priority") || name.includes("urgency")) {
      priority = readNotionProp(props[field.name]);
    }
  }

  // Find due date
  let due = null;
  for (const field of (schema?.dates || [])) {
    const name = field.name.toLowerCase();
    if (name.includes("due") || name.includes("deadline") || name.includes("date")) {
      const val = readNotionProp(props[field.name]);
      if (val) {
        due = typeof val === "object" ? val.start : val;
      }
    }
  }

  return {
    id: page.id,
    title: title || "Untitled",
    done,
    status,
    priority,
    due,
    notes: "",
    source: `notion:${page._databaseId || "unknown"}`,
    sourceName: dbName || "Database",
    _raw: page,
  };
}

/** Read a Notion property value to a plain JS value */
function readNotionProp(prop) {
  if (!prop) return null;
  const t = prop.type;
  if (t === "title") return (prop.title || []).map((r) => r.plain_text).join("");
  if (t === "rich_text") return (prop.rich_text || []).map((r) => r.plain_text).join("");
  if (t === "number") return prop.number;
  if (t === "select") return prop.select?.name || null;
  if (t === "multi_select") return (prop.multi_select || []).map((s) => s.name).join(", ");
  if (t === "status") return prop.status?.name || null;
  if (t === "checkbox") return prop.checkbox;
  if (t === "date") return prop.date;
  if (t === "formula") return prop.formula?.string || prop.formula?.number || null;
  if (t === "rollup") return prop.rollup?.number || null;
  return null;
}

// ── Date helpers ──

export function isToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

export function isOverdue(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return d < now;
}

export function formatDueDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  const now = new Date();
  const diff = Math.floor((d - now) / (1000 * 60 * 60 * 24));
  if (isToday(dateStr)) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < -1) return `${Math.abs(diff)}d overdue`;
  if (diff <= 7) return `In ${diff}d`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

// ── Cache helpers ──

export function getCached(key, ttlMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > ttlMs) return null;
    return data;
  } catch {
    return null;
  }
}

export function setCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}
