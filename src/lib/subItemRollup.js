// ─── Sub-Item Roll-Up Utility ───
// Pure computation: given a parent page and its children, computes:
// - Timeline range (earliest child start → latest child end)
// - Progress (how many children are "resolved" by status category)
// - Conflict detection (children exceed parent's manually-set dates)
//
// Consumed by: dataSource.js (attached to parent pages as page._rollup),
// RecordDetail (Sub-Items tab), Gantt (conflict indicators).

import { readField, getFieldOptions } from "../views/_viewHelpers.js";

/**
 * Parse a date value (from readField) into a Date object.
 * Handles both string dates and {start, end} objects.
 */
function toDate(v) {
  if (!v) return null;
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "object" && v.start) {
    const d = new Date(v.start);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Get the end date from a date value ({start, end} object or single date). */
function toEndDate(v) {
  if (!v) return null;
  if (typeof v === "object" && v.end) {
    const d = new Date(v.end);
    return isNaN(d.getTime()) ? null : d;
  }
  // Single date: end = start (one-day span)
  return toDate(v);
}

/**
 * Look up the category for a status value name using schema options.
 * Returns "not_started" if no match found.
 */
function resolveCategory(statusValue, statusOptions) {
  if (!statusValue || !statusOptions?.length) return "not_started";
  const opt = statusOptions.find((o) => o.name === statusValue);
  return opt?.category || "not_started";
}

/**
 * Compute sub-item roll-up for a parent page.
 *
 * @param {Object} parentPage - The parent page object (with properties)
 * @param {Object[]} childPages - Array of child page objects
 * @param {Object} parentSchema - Classified schema for parent columns
 * @param {Object} subSchema - Classified schema for sub-item columns
 * @returns {Object} rollup
 * @returns {Date|null} rollup.computedStart - Earliest child start date
 * @returns {Date|null} rollup.computedEnd - Latest child end date
 * @returns {Object} rollup.progress - { total, complete, percent }
 * @returns {boolean} rollup.hasConflict - Children exceed parent date range
 * @returns {Object|null} rollup.conflictDetails - { parentStart, parentEnd, childrenStart, childrenEnd }
 */
export function computeSubItemRollup(parentPage, childPages, parentSchema, subSchema) {
  const result = {
    computedStart: null,
    computedEnd: null,
    progress: { total: 0, complete: 0, percent: 0 },
    hasConflict: false,
    conflictDetails: null,
  };

  if (!childPages || childPages.length === 0) return result;

  // ── 1. Compute timeline range from children ──
  // Scan all date fields on sub-schema to find global min start / max end.
  const subDateFields = (subSchema?.dates || []).map((f) => f.name);

  let minStart = null;
  let maxEnd = null;

  for (const child of childPages) {
    for (const fieldName of subDateFields) {
      const raw = readField(child, fieldName);
      if (!raw) continue;

      const start = toDate(raw);
      const end = toEndDate(raw);

      if (start && (!minStart || start < minStart)) minStart = start;
      if (end && (!maxEnd || end > maxEnd)) maxEnd = end;
      // Also check start as potential max end (single-date fields)
      if (start && (!maxEnd || start > maxEnd)) maxEnd = start;
    }
  }

  result.computedStart = minStart;
  result.computedEnd = maxEnd;

  // ── 2. Compute progress from status categories ──
  // Find the first status field on sub-schema (if any).
  const subStatusField = (subSchema?.statuses || [])[0];
  const statusOptions = subStatusField?.options || [];

  const total = childPages.length;
  let resolved = 0; // "complete" or "cancelled" = resolved

  for (const child of childPages) {
    if (subStatusField) {
      const statusVal = readField(child, subStatusField.name);
      const category = resolveCategory(statusVal, statusOptions);
      if (category === "complete" || category === "cancelled") {
        resolved++;
      }
    }
  }

  result.progress = {
    total,
    complete: resolved,
    percent: total > 0 ? Math.round((resolved / total) * 100) : 0,
  };

  // ── 3. Detect timeline conflicts ──
  // A conflict exists when:
  // - The parent has manually set dates
  // - The children's computed range exceeds the parent's range
  if (minStart || maxEnd) {
    const parentDateFields = (parentSchema?.dates || []).map((f) => f.name);

    let parentStart = null;
    let parentEnd = null;

    for (const fieldName of parentDateFields) {
      const raw = readField(parentPage, fieldName);
      if (!raw) continue;

      const s = toDate(raw);
      const e = toEndDate(raw);

      if (s && (!parentStart || s < parentStart)) parentStart = s;
      if (e && (!parentEnd || e > parentEnd)) parentEnd = e;
      if (s && (!parentEnd || s > parentEnd)) parentEnd = s;
    }

    // Only flag conflict if parent has dates set
    if (parentStart || parentEnd) {
      const exceedsStart = minStart && parentStart && minStart < parentStart;
      const exceedsEnd = maxEnd && parentEnd && maxEnd > parentEnd;

      if (exceedsStart || exceedsEnd) {
        result.hasConflict = true;
        result.conflictDetails = {
          parentStart,
          parentEnd,
          childrenStart: minStart,
          childrenEnd: maxEnd,
        };
      }
    }
  }

  return result;
}
