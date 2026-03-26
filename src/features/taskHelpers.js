// ─── Task Helpers ───
// Shared utilities for the To-Do engine: normalization, dates, caching.
// Smart filtering: nearest-date scanning, activity-aware staleness, terminal status detection.

// ── Smart To-Do Helpers ──

/**
 * Scan ALL date fields on a Notion page and find the nearest date.
 * For date ranges (start/end), both dates are considered.
 * Returns the closest upcoming date, or if none upcoming, the most recently past date.
 */
export function findNearestDate(page, schema) {
  const props = page.properties || {};
  const allDates = [];

  for (const field of (schema?.dates || [])) {
    const val = readNotionProp(props[field.name]);
    if (!val) continue;
    if (typeof val === "object") {
      // Date range: { start, end }
      if (val.start) allDates.push({ date: val.start, fieldName: field.name });
      if (val.end) allDates.push({ date: val.end, fieldName: field.name });
    } else if (typeof val === "string") {
      allDates.push({ date: val, fieldName: field.name });
    }
  }

  if (!allDates.length) return { date: null, fieldName: null, allDates: [] };

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const nowMs = now.getTime();

  let closestUpcoming = null; // smallest positive delta
  let closestPast = null;     // smallest negative delta (most recent past)

  for (const entry of allDates) {
    const d = parseDate(entry.date);
    if (isNaN(d)) continue;
    const dMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const delta = dMs - nowMs;

    if (delta >= 0) {
      if (!closestUpcoming || delta < closestUpcoming.delta) {
        closestUpcoming = { ...entry, delta };
      }
    } else {
      if (!closestPast || delta > closestPast.delta) {
        closestPast = { ...entry, delta };
      }
    }
  }

  const nearest = closestUpcoming || closestPast;
  return {
    date: nearest?.date || null,
    fieldName: nearest?.fieldName || null,
    allDates,
  };
}

/**
 * Smart overdue detection: a past date is overdue ONLY if
 * the record hasn't been updated since that date passed.
 */
export function isSmartOverdue(dateStr, lastActivityAt) {
  if (!dateStr) return false;
  const d = parseDate(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (d >= now) return false; // not past

  if (!lastActivityAt) return true; // no activity → overdue
  const activity = new Date(lastActivityAt);
  return activity < d; // overdue only if last activity was before the date
}

/**
 * Staleness check: returns true if the task is "stale" (not recently worked on
 * relative to its deadline). Used as a SIGNAL for AI scoring, NOT as a filter.
 */
export function shouldIncludeTask(nearestDate, lastActivityAt, lastInteractionType) {
  if (!nearestDate) return true; // no dates → include, let AI score it

  const d = parseDate(nearestDate);
  if (isNaN(d)) return true;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((dDay - now) / (1000 * 60 * 60 * 24));

  // Overdue or within 7 days → definitely stale/urgent
  if (diffDays <= 7) return true;

  // No activity → stale
  if (!lastActivityAt) return true;

  const activity = new Date(lastActivityAt);
  const remainingMs = dDay.getTime() - now.getTime();
  const timeSinceActivityMs = now.getTime() - activity.getTime();

  let stalenessRatio = 1 / 3;
  if (lastInteractionType === "comment") {
    stalenessRatio = 1 / 5; // comment-only = acknowledged but not progressed
  } else if (lastInteractionType === "status_change") {
    stalenessRatio = 1 / 2; // status change = real progress
  } else if (lastInteractionType === "view") {
    stalenessRatio = 1 / 4;
  }

  return timeSinceActivityMs > remainingMs * stalenessRatio;
}

/**
 * Score status options to identify "terminal" (done) statuses per database.
 * Returns a Set of lowercase status names that represent completion.
 */
export function scoreTerminalStatuses(statusOptions) {
  const FINALITY_SCORES = {
    complete: 3, completed: 3, done: 3,
    shipped: 2, delivered: 2, closed: 2, archived: 2,
    cancelled: 2, canceled: 2, resolved: 2, finished: 2,
    invoiced: 1, paid: 1, released: 1, launched: 1,
  };

  const terminal = new Set();
  for (const opt of (statusOptions || [])) {
    const name = (typeof opt === "string" ? opt : opt.name || "").toLowerCase().trim();
    if (!name) continue;
    let score = 0;
    for (const [word, pts] of Object.entries(FINALITY_SCORES)) {
      if (name.includes(word)) score += pts;
    }
    if (score >= 2) terminal.add(name);
  }
  return terminal;
}

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

  // Find fields by column name pattern — returns value
  const findCell = (patterns) => {
    for (const [key, val] of Object.entries(cells)) {
      const col = colMap[key];
      const name = (col?.name || key).toLowerCase();
      if (patterns.some((p) => name.includes(p))) return val;
    }
    return null;
  };

  // Find the column key that matches a pattern — returns the key (column ID)
  const findCellKey = (patterns) => {
    for (const [key] of Object.entries(cells)) {
      const col = colMap[key];
      const name = (col?.name || key).toLowerCase();
      if (patterns.some((p) => name.includes(p))) return key;
    }
    return null;
  };

  // Scan all date-type columns for nearest date
  const allDates = [];
  for (const [key, val] of Object.entries(cells)) {
    const col = colMap[key];
    const colType = (col?.type || "").toLowerCase();
    const colName = (col?.name || key).toLowerCase();
    if (colType === "date" || colName.includes("date") || colName.includes("deadline") || colName.includes("timeline")) {
      if (val && typeof val === "string") allDates.push({ date: val, fieldName: col?.name || key });
    }
  }

  // Find nearest date from all date fields
  let nearestDate = null;
  let nearestDateField = null;
  if (allDates.length) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const nowMs = now.getTime();
    let closestUp = null, closestPast = null;
    for (const entry of allDates) {
      const d = parseDate(entry.date);
      if (isNaN(d)) continue;
      const delta = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - nowMs;
      if (delta >= 0) { if (!closestUp || delta < closestUp.delta) closestUp = { ...entry, delta }; }
      else { if (!closestPast || delta > closestPast.delta) closestPast = { ...entry, delta }; }
    }
    const nearest = closestUp || closestPast;
    nearestDate = nearest?.date || null;
    nearestDateField = nearest?.fieldName || null;
  }

  // Parse owner_user_id from row (stored as JSON array string in D1)
  let ownerUserIds = [];
  if (row.owner_user_id && row.owner_user_id !== "default" && row.owner_user_id !== "unassigned") {
    try { ownerUserIds = JSON.parse(row.owner_user_id); } catch { ownerUserIds = [row.owner_user_id]; }
    if (!Array.isArray(ownerUserIds)) ownerUserIds = [ownerUserIds];
  }

  // Build field map for save — maps semantic names to actual column keys
  const _fieldMap = {};
  const titleKey = findCellKey(["task", "title", "name"]);
  if (titleKey) _fieldMap.title = titleKey;
  const statusKey = findCellKey(["status"]);
  if (statusKey) _fieldMap.status = statusKey;
  const priorityKey = findCellKey(["priority"]);
  if (priorityKey) _fieldMap.priority = priorityKey;
  const doneKey = findCellKey(["done", "complete", "check"]);
  if (doneKey) _fieldMap.done = doneKey;
  const notesKey = findCellKey(["notes", "note", "description"]);
  if (notesKey) _fieldMap.notes = notesKey;
  const dueKey = findCellKey(["due", "deadline"]);
  if (dueKey) _fieldMap.due = dueKey;

  // Extract status options from column schema (for dropdown in RecordDrawer)
  const _statusOptions = [];
  if (statusKey) {
    const statusCol = colMap[statusKey];
    if (statusCol?.options) {
      for (const opt of statusCol.options) {
        _statusOptions.push({ name: opt.label || opt.name || opt, color: opt.color || "default" });
      }
    }
  }

  // Terminal status detection — check both checkbox and status value
  let done = !!findCell(["done", "complete", "check"]);
  const statusVal = findCell(["status"]) || "";
  if (!done && statusVal) {
    const statusLower = statusVal.toLowerCase().trim();
    const TERMINAL_WORDS = [
      "complete", "completed", "done", "shipped", "delivered",
      "closed", "archived", "cancelled", "canceled", "resolved", "finished",
    ];
    done = TERMINAL_WORDS.some((w) => statusLower.includes(w));
  }

  return {
    id: row.id,
    title: findCell(["task", "title", "name"]) || "Untitled",
    done,
    priority: findCell(["priority"]) || null,
    due: nearestDate || findCell(["due", "date"]) || null,
    nearestDate,
    nearestDateField,
    allDates,
    notes: findCell(["notes", "note", "description"]) || "",
    assignee: findCell(["assignee", "assigned", "owner", "responsible"]) || "",
    status: statusVal,
    source: "manual",
    sourceName: "User Tasks",
    createdAt: row.created_at || null,
    lastEditedTime: row.updated_at || null,
    _ownerUserIds: ownerUserIds,
    _fieldMap,
    _statusOptions,
    _statusFieldType: statusKey ? "select" : null,
    _raw: row,
  };
}

/**
 * Normalize a Notion page into a uniform task object.
 */
export function normalizeNotionTask(page, schema, dbName, terminalStatuses, dbId) {
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

  // Find status/done + track field mapping for writes
  let done = false;
  let status = null;
  const _fieldMap = {};   // { status: "Status", priority: "Priority", due: "Due Date", title: "Name" }
  const _statusOptions = [];  // [{ name: "To Do", color: "..." }, ...]
  const _statusFieldType = null; // "status" | "select" | "checkbox"

  // Track title field name (store just the property name string)
  if (schema?.title) _fieldMap.title = schema.title.name || schema.title;

  // Build terminal statuses set if not provided
  const _terminal = terminalStatuses || scoreTerminalStatuses([
    ...(schema?.statuses || []).flatMap((f) => f.options || []),
    ...(schema?.selects || []).flatMap((f) => f.options || []),
  ]);

  let statusFieldType = null;
  // Check Notion `status`-type properties first
  for (const field of (schema?.statuses || [])) {
    const val = readNotionProp(props[field.name]);
    if (val) {
      status = val;
      done = _terminal.has(String(val).toLowerCase());
    }
    if (!_fieldMap.status) {
      _fieldMap.status = field.name;
      statusFieldType = "status";
      if (field.options) _statusOptions.push(...field.options);
    }
  }
  // Also check `select`-type properties named "status"/"state"/"stage"
  if (!_fieldMap.status) {
    for (const field of (schema?.selects || [])) {
      const fname = field.name.toLowerCase();
      if (fname.includes("status") || fname.includes("state") || fname.includes("stage") || fname.includes("progress")) {
        const val = readNotionProp(props[field.name]);
        if (val) {
          status = val;
          done = _terminal.has(String(val).toLowerCase());
        }
        _fieldMap.status = field.name;
        statusFieldType = "select";
        if (field.options) _statusOptions.push(...field.options);
        break;
      }
    }
  }
  for (const field of (schema?.checkboxes || [])) {
    const val = props[field.name];
    if (val?.type === "checkbox") {
      done = !!val.checkbox;
      if (!_fieldMap.done) {
        _fieldMap.done = field.name;
      }
    }
  }

  // Find priority + track field mapping
  let priority = null;
  for (const field of (schema?.selects || [])) {
    const name = field.name.toLowerCase();
    // Skip if this select is already used as the status field
    if (_fieldMap.status === field.name) continue;
    if (name.includes("priority") || name.includes("urgency")) {
      priority = readNotionProp(props[field.name]);
      if (!_fieldMap.priority) _fieldMap.priority = field.name;
    }
  }

  // Find nearest date across ALL date fields
  const nearest = findNearestDate(page, schema);

  // Also track the first "due"/"deadline" field for writes
  for (const field of (schema?.dates || [])) {
    const name = field.name.toLowerCase();
    if (name.includes("due") || name.includes("deadline") || name.includes("date")) {
      if (!_fieldMap.due) _fieldMap.due = field.name;
      break;
    }
  }

  // Find notes/description field for reads and writes
  let notesValue = "";
  for (const field of (schema?.richTexts || [])) {
    const name = field.name.toLowerCase();
    if (name.includes("note") || name.includes("description") || name.includes("detail") || name.includes("comment")) {
      if (!_fieldMap.notes) {
        _fieldMap.notes = field.name;
        notesValue = readNotionProp(props[field.name]) || "";
      }
      break;
    }
  }

  return {
    id: page.id,
    title: title || "Untitled",
    done,
    status,
    priority,
    due: nearest.date, // nearest date across all fields (backward compat)
    nearestDate: nearest.date,
    nearestDateField: nearest.fieldName,
    allDates: nearest.allDates,
    notes: notesValue,
    source: `notion:${dbId || page._databaseId || "unknown"}`,
    sourceName: dbName || "Database",
    lastEditedTime: page.last_edited_time || null,
    _raw: page,
    _fieldMap,
    _statusOptions,
    _statusFieldType: statusFieldType,
  };
}

/** Read a Notion property value to a plain JS value */
export function readNotionProp(prop) {
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

/**
 * Parse a date string safely, handling the critical timezone bug:
 * "2026-03-17" (date-only, no "T") is parsed by `new Date()` as UTC midnight,
 * which shifts back a day in US/negative-offset timezones.
 * This function parses date-only strings as LOCAL midnight instead.
 */
export function parseDate(dateStr) {
  if (!dateStr) return new Date(NaN);
  // Date-only: "2026-03-17" (10 chars, no "T") → parse as local midnight
  if (typeof dateStr === "string" && dateStr.length === 10 && !dateStr.includes("T")) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  // Has time component or is already a Date object — use standard parsing
  return new Date(dateStr);
}

export function isToday(dateStr) {
  if (!dateStr) return false;
  const d = parseDate(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

export function isOverdue(dateStr) {
  if (!dateStr) return false;
  const d = parseDate(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return d < now;
}

export function formatDueDate(dateStr) {
  if (!dateStr) return "";
  const d = parseDate(dateStr);
  if (isNaN(d)) return "";
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((dDay - now) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < -1) return `${Math.abs(diff)}d overdue`;
  if (diff <= 7) return `In ${diff}d`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

// ── Calendar date helpers ──

/** Compare two dates ignoring time (timezone-safe) */
export function isSameDay(a, b) {
  if (!a || !b) return false;
  const da = parseDate(typeof a === "string" ? a : a instanceof Date ? a : String(a));
  const db = parseDate(typeof b === "string" ? b : b instanceof Date ? b : String(b));
  return da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate();
}

/** Get Mon–Sun week range for a given date */
export function getWeekRange(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  const start = new Date(d);
  start.setDate(d.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** Return array of 7 Date objects (Mon–Sun) for the week containing date */
export function getWeekColumns(date) {
  const { start } = getWeekRange(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/** Format a date string to time: "2:30 PM" */
export function formatTime(dateStr) {
  const d = parseDate(dateStr);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Format an hour number: 7 → "7 AM", 12 → "12 PM" */
export function formatHour(h) {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

/** Format week date range header: "Mar 10 – 16, 2026" */
export function formatWeekDateHeader(start, end) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const sMonth = months[start.getMonth()];
  const eMonth = months[end.getMonth()];
  if (start.getMonth() === end.getMonth()) {
    return `${sMonth} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${sMonth} ${start.getDate()} – ${eMonth} ${end.getDate()}, ${end.getFullYear()}`;
}

/** Get the visible month grid range (includes leading/trailing days to fill the 6×7 grid) */
export function getMonthRange(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const day = first.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  const start = new Date(first);
  start.setDate(first.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  // Always 6 weeks (42 days) for consistent grid height
  const end = new Date(start);
  end.setDate(start.getDate() + 41);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** Get 21-day range for the week list view (7 past + today + 13 future) */
export function getListViewRange(date) {
  const start = new Date(date);
  start.setDate(start.getDate() - 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setDate(end.getDate() + 13);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** Format month header: "March 2026" */
export function formatMonthHeader(date) {
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
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

/** Return cached data regardless of age, plus metadata. */
export function getStaleCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    return { data, ts, age: Date.now() - ts };
  } catch {
    return null;
  }
}

// ── Interaction tracking ──
// Persists user interactions per-task in localStorage. Score adjustments
// accumulate and decay over time (today=full, yesterday=50%, 2d+=25%).

const INTERACTION_CACHE_KEY = "wasabi_task_interactions";

const INTERACTION_WEIGHTS = {
  view: -2,
  field_edit: -5,
  status_change: -8,
  comment: +2,       // bumps UP — needs follow-through
  dismiss: -15,
};

/** Persist interaction to localStorage ledger. Accumulates per-task. */
export function persistInteraction(taskId, type, detail) {
  try {
    const raw = localStorage.getItem(INTERACTION_CACHE_KEY);
    const ledger = raw ? JSON.parse(raw) : {};
    if (!ledger[taskId]) ledger[taskId] = { interactions: [] };
    const entry = ledger[taskId];
    entry.interactions.push({ type, ts: Date.now(), detail: detail || null });
    // Cap interaction history at 20 per task to bound localStorage size
    if (entry.interactions.length > 20) entry.interactions = entry.interactions.slice(-20);
    entry.totalAdjustment = calculateDecayedAdjustment(entry.interactions);
    localStorage.setItem(INTERACTION_CACHE_KEY, JSON.stringify(ledger));
    return entry;
  } catch {
    return null;
  }
}

/** Score adjustment with time decay. Today=full, yesterday=50%, 2d+=25%. */
export function calculateDecayedAdjustment(interactions) {
  const now = Date.now();
  let total = 0;
  for (const i of interactions) {
    const ageHours = (now - i.ts) / 3600000;
    const weight = INTERACTION_WEIGHTS[i.type] || 0;
    const decay = ageHours > 48 ? 0.25 : ageHours > 24 ? 0.5 : 1;
    total += weight * decay;
  }
  return total;
}

/** Load interaction ledger from localStorage. */
export function loadInteractionLedger() {
  try {
    const raw = localStorage.getItem(INTERACTION_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Merge persisted interaction adjustments into tasks from a fresh scan. */
export function mergeInteractionAdjustments(tasks) {
  const ledger = loadInteractionLedger();
  if (!Object.keys(ledger).length) return tasks;
  return tasks.map(task => {
    const entry = ledger[task.id];
    if (!entry) return task;
    const adjustment = calculateDecayedAdjustment(entry.interactions);
    return {
      ...task,
      _aiBaseScore: task._aiBaseScore ?? task._aiScore ?? 3,
      _aiScore: (task._aiScore || 3) + adjustment,
      _interactionCount: entry.interactions.length,
      _interactionAdjustment: adjustment,
    };
  });
}
