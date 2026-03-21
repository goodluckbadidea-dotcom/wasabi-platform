// ─── Wasabi Table View ───
// Schema-agnostic, filterable, sortable, inline-editable data table.
// The primary view for any Notion database.

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { C, FONT, RADIUS, SHADOW, getStatusColor, getSolidPillColor } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { ANIM, injectAnimations } from "../design/animations.js";
import { readProp, buildProp, extractProperties, getPageTitle } from "../notion/properties.js";
import { debounce, formatDate, truncate } from "../utils/helpers.js";
import {
  IconTrash, IconExport, IconEyeOff, IconExpand, IconPlus, IconConnect,
  IconCalendar, IconCheck, IconCheckSquare, IconLink, IconMail, IconPhone,
  IconStatusDot, IconArrowDown, IconChevronDown, IconUser,
} from "../design/icons.jsx";
import FilterChips, { applyChipFilters } from "./FilterChips.jsx";
import RecordDetail from "./RecordDetail.jsx";
import { useLinks } from "../context/LinksContext.jsx";
import LinkPicker from "../core/LinkPicker.jsx";
import { isNeuronsMode, dispatchNeuronSelect } from "../neurons/NeuronsContext.jsx";
import NeuronBadge from "../neurons/NeuronBadge.jsx";
import { updateTableSchema, getTableSchema, listUserDirectory, updateRowOwner, notionProxy, getRecordBadgeCounts } from "../lib/api.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { updateDatabase, searchDatabases } from "../notion/client.js";
import SelectPicker from "../components/SelectPicker.jsx";
import MultiSelectPicker from "../components/MultiSelectPicker.jsx";
import SavedViewsDropdown from "../components/SavedViewsDropdown.jsx";
import { useCollaboration } from "../context/CollaborationContext.jsx";
import PresenceAvatars from "../components/PresenceAvatars.jsx";

// ─── Owner Column Constants ───
const OWNER_COL_NAME = "Owner";
const OWNER_COL_WIDTH = 180;

// D1 type → Notion property type mapping
const D1_TO_NOTION_TYPE = {
  text: "rich_text", number: "number", select: "select",
  multi_select: "multi_select", date: "date", checkbox: "checkbox",
  url: "url", email: "email", phone: "phone_number", status: "status",
  people: "people", relation: "relation",
};

// ─── Column Types ───
// text/label: short text label for inline display, Icon: SVG component (optional)
const COLUMN_TYPES = [
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
const TYPE_ICON_MAP = {};
COLUMN_TYPES.forEach((t) => { TYPE_ICON_MAP[t.value] = { text: t.text, Icon: t.Icon }; });
TYPE_ICON_MAP["rich_text"] = { text: "AA", Icon: null };
TYPE_ICON_MAP["title"] = { text: "AA", Icon: null };
TYPE_ICON_MAP["phone_number"] = { text: null, Icon: IconPhone };
TYPE_ICON_MAP["last_edited_time"] = { text: null, Icon: IconCalendar };
TYPE_ICON_MAP["created_time"] = { text: null, Icon: IconCalendar };

function mapD1TypeForUI(d1Type) { return D1_TO_NOTION_TYPE[d1Type] || d1Type; }
function getTypeIcon(schema, fieldName) { return TYPE_ICON_MAP[getFieldType(schema, fieldName)] || null; }

// ─── Constants ───

const ROW_HEIGHT = 36;
const VIRT_BUFFER = 20;

const EDITABLE_TYPES = new Set([
  "title", "rich_text", "number", "select", "status",
  "date", "checkbox", "url", "email", "phone_number",
  "multi_select",
]);

const TEXT_SEARCH_TYPES = new Set([
  "title", "rich_text", "select", "status", "url", "email",
  "phone_number", "unique_id",
]);

// ─── Styles ───

const styles = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    fontFamily: FONT,
  },

  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    borderBottom: `1px solid ${C.edgeLine}`,
    background: C.darkSurf,
    flexShrink: 0,
    flexWrap: "wrap",
  },

  searchWrap: {
    display: "flex",
    alignItems: "center",
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.pill,
    padding: "0 10px",
    flex: "1 1 200px",
    maxWidth: 320,
    minWidth: 140,
    height: 34,
    transition: "border-color 0.15s, box-shadow 0.15s",
  },

  searchInput: {
    flex: 1,
    border: "none",
    outline: "none",
    background: "transparent",
    fontFamily: FONT,
    fontSize: 13,
    color: C.darkText,
    padding: "0 6px",
    height: "100%",
  },

  searchIcon: {
    fontSize: 13,
    color: C.darkMuted,
    flexShrink: 0,
  },

  filterSelect: {
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.pill,
    padding: "6px 10px",
    fontSize: 12,
    fontFamily: FONT,
    color: C.darkMuted,
    cursor: "pointer",
    appearance: "none",
    outline: "none",
    minWidth: 110,
    height: 34,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888888'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 10px center",
    paddingRight: 28,
  },

  refreshBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
    borderRadius: RADIUS.pill,
    border: `1px solid ${C.darkBorder}`,
    background: C.darkSurf2,
    cursor: "pointer",
    color: C.darkMuted,
    fontSize: 14,
    transition: "background 0.15s, color 0.15s",
    flexShrink: 0,
    fontFamily: FONT,
  },

  countLabel: {
    fontSize: 12,
    color: C.darkMuted,
    marginLeft: "auto",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },

  scrollArea: {
    flex: 1,
    overflowY: "auto",
    overflowX: "auto",
    background: C.dark,
    WebkitOverflowScrolling: "touch",
  },

  gridHeader: {
    display: "grid",
    position: "sticky",
    top: 0,
    zIndex: 10,
    background: C.dark,
    borderBottom: `2px solid ${C.accent}33`,
    boxShadow: `0 2px 8px rgba(0,0,0,0.08)`,
  },

  gridHeaderCell: {
    textAlign: "left",
    padding: "10px 12px",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: C.darkMuted,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
    transition: "color 0.15s",
    position: "relative",
    overflow: "hidden",
  },

  gridHeaderCellActive: {
    color: C.darkText,
  },

  gridRow: {
    display: "grid",
    borderRadius: RADIUS.lg,
    cursor: "pointer",
    transition: "background 0.15s ease, box-shadow 0.15s ease",
    background: C.darkSurf,
    marginBottom: 4,
    position: "relative",
    overflow: "hidden",
  },

  gridCell: {
    padding: "8px 12px",
    color: C.darkText,
    fontSize: 13,
    lineHeight: 1.45,
    boxSizing: "border-box",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    minWidth: 0,
  },

  gridFooter: {
    display: "grid",
    position: "sticky",
    bottom: 0,
    zIndex: 5,
    background: C.dark,
    borderTop: `2px solid ${C.darkBorder}`,
  },

  // Legacy styles used by CellEditor (in RecordDetail drawer) and CSV import modal
  table: { borderCollapse: "separate", borderSpacing: "0 4px", fontSize: 13, tableLayout: "fixed" },
  th: { textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.darkMuted, borderBottom: `1px solid ${C.darkBorder}`, whiteSpace: "nowrap", background: C.darkSurf },
  td: { padding: "8px 12px", border: "none", color: C.darkText, fontSize: 13, lineHeight: 1.45, boxSizing: "border-box", overflow: "hidden", background: C.darkSurf },
  cellInput: { width: "100%", border: `1px solid ${C.accent}`, borderRadius: RADIUS.sm, padding: "4px 8px", fontSize: 13, fontFamily: FONT, color: C.darkText, background: C.darkSurf, outline: "none", boxShadow: `0 0 0 2px ${C.accent}33`, boxSizing: "border-box" },
  cellSelect: { width: "100%", border: `1px solid ${C.accent}`, borderRadius: RADIUS.sm, padding: "4px 8px", fontSize: 13, fontFamily: FONT, color: C.darkText, background: C.darkSurf, outline: "none", cursor: "pointer", appearance: "none", boxShadow: `0 0 0 2px ${C.accent}33`, boxSizing: "border-box" },

  // Checkbox toggle
  toggle: (checked) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    borderRadius: RADIUS.sm,
    border: `2px solid ${checked ? C.accent : C.darkBorder}`,
    background: checked ? C.accent : "transparent",
    cursor: "pointer",
    transition: "all 0.15s",
    flexShrink: 0,
    fontSize: 11,
    color: "#fff",
    fontWeight: 700,
  }),

  // Pills
  pill: (fillColor, textColor = "#fff") => ({
    display: "inline-block",
    color: textColor,
    background: fillColor,
    border: "none",
    borderRadius: RADIUS.pill,
    padding: "3px 10px",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    lineHeight: 1.6,
    whiteSpace: "nowrap",
  }),

  multiPillWrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
  },

  // Empty state
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 64,
    gap: 12,
    color: C.darkMuted,
    fontSize: 14,
    textAlign: "center",
    fontFamily: FONT,
  },

  emptyIcon: {
    fontSize: 32,
    opacity: 0.4,
    marginBottom: 4,
  },

  emptyTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: C.darkMuted,
  },

  emptySub: {
    fontSize: 13,
    color: C.darkMuted,
    maxWidth: 300,
    lineHeight: 1.5,
  },

  // Sort arrow
  sortArrow: {
    display: "inline-block",
    marginLeft: 4,
    fontSize: 10,
    opacity: 0.7,
  },
};

// Context menu item style
const ctxItem = {
  padding: "6px 10px",
  fontSize: 12,
  color: C.darkText,
  cursor: "pointer",
  borderRadius: RADIUS.sm,
  transition: "background 0.1s",
  fontFamily: FONT,
};

// ── Reusable hover handlers ──
const hoverBg = (bg = C.darkSurf2, reset = "transparent") => ({
  onMouseEnter: (e) => { e.currentTarget.style.background = bg; },
  onMouseLeave: (e) => { e.currentTarget.style.background = reset; },
});

// ── Shared input field style ──
const inputFieldStyle = {
  border: `1px solid ${C.darkBorder}`,
  borderRadius: RADIUS.sm,
  background: C.darkSurf2,
  color: C.darkText,
  fontFamily: FONT,
  fontSize: 12,
  padding: "6px 10px",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

// ─── Helpers ───

/** Resolve column list from schema when not provided in config.
 *  When config.columns exists, still appends any NEW schema fields
 *  so that columns added in Notion are discovered automatically. */
function resolveColumns(schema, configColumns, fieldMappings) {
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

/** Get the property type for a field name from schema */
function getFieldType(schema, fieldName) {
  if (!schema) return null;
  const field = schema.allFields.find((f) => f.name === fieldName);
  return field?.type || null;
}

/** Get select/status options for a field */
function getFieldOptions(schema, fieldName) {
  if (!schema) return [];
  const field = schema.allFields.find((f) => f.name === fieldName);
  return field?.options || [];
}

/** Get option names for select/status fields */
function getOptionNames(schema, fieldName) {
  return getFieldOptions(schema, fieldName).map((o) => o.name);
}

/** Read a property value from a page by field name */
function readField(page, fieldName) {
  if (!page?.properties?.[fieldName]) return null;
  return readProp(page.properties[fieldName]);
}

/** Get a displayable string from a field value */
function displayValue(value, type) {
  if (value === null || value === undefined) return "";
  if (type === "date") {
    if (typeof value === "object" && value.start) {
      return formatDate(value.start, { short: true });
    }
    return formatDate(String(value), { short: true });
  }
  if (type === "last_edited_time" || type === "created_time") {
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
function searchableText(value, type) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? v.name || "" : String(v))).join(" ");
  if (typeof value === "object") {
    if (value.start) return value.start;
    return JSON.stringify(value);
  }
  return String(value).toLowerCase();
}


// ─── Cell Editor Component ───

function CellEditor({ value, type, options, schemaOptions, onCommit, onCancel, initialChar, isD1Table, onCreateOption, cellRef, canEditSchema }) {
  const inputRef = useRef(null);
  const [draft, setDraft] = useState(() => {
    if (initialChar && (type === "title" || type === "rich_text" || type === "url" || type === "email" || type === "phone_number")) {
      return initialChar;
    }
    if (type === "date" && value && typeof value === "object") return value.start || "";
    if (type === "date" && typeof value === "string") return value;
    if (type === "checkbox") return !!value;
    if (value === null || value === undefined) return "";
    return String(value);
  });

  // Date range state
  const [dateEnd, setDateEnd] = useState(() => {
    if (type === "date" && value && typeof value === "object") return value.end || "";
    return "";
  });
  const [includeTime, setIncludeTime] = useState(() => {
    if (type === "date" && typeof draft === "string" && draft.includes("T")) return true;
    return false;
  });

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current.select && !initialChar) inputRef.current.select();
      // Move cursor to end if initialChar was set
      if (initialChar && inputRef.current.setSelectionRange) {
        const len = inputRef.current.value.length;
        inputRef.current.setSelectionRange(len, len);
      }
    }
  }, [initialChar]);

  const commit = useCallback((val) => {
    let out = val;
    if (type === "number") {
      out = val === "" ? null : parseFloat(val);
      if (out !== null && isNaN(out)) out = null;
    }
    if (type === "date") {
      out = val || null;
    }
    onCommit(out);
  }, [type, onCommit]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(draft);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      commit(draft);
    }
  }, [draft, commit, onCancel]);

  // Checkbox is always a direct toggle, no editor needed (handled in-cell)
  if (type === "checkbox") return null;

  // Select / Status — custom SelectPicker
  if (type === "select" || type === "status") {
    const anchor = cellRef?.current?.getBoundingClientRect?.();
    return (
      <SelectPicker
        value={value}
        options={schemaOptions || options.map((o) => ({ name: o }))}
        onSelect={(selected) => onCommit(selected)}
        onClose={onCancel}
        allowCreate={!!canEditSchema}
        onCreateOption={onCreateOption}
        anchor={anchor ? { top: anchor.bottom, left: anchor.left, width: anchor.width } : undefined}
        initialChar={initialChar}
      />
    );
  }

  // Multi-select — custom MultiSelectPicker
  if (type === "multi_select") {
    const currentValues = Array.isArray(value) ? value : (value ? String(value).split(",").map((s) => s.trim()).filter(Boolean) : []);
    const anchor = cellRef?.current?.getBoundingClientRect?.();
    return (
      <MultiSelectPicker
        value={currentValues}
        options={schemaOptions || options.map((o) => ({ name: o }))}
        onChange={(newVals) => onCommit(newVals)}
        onClose={onCancel}
        allowCreate={!!canEditSchema}
        onCreateOption={onCreateOption}
        anchor={anchor ? { top: anchor.bottom, left: anchor.left, width: anchor.width } : undefined}
        initialChar={initialChar}
      />
    );
  }

  // Date — enhanced with end date, time toggle, quick buttons
  if (type === "date") {
    return (
      <div
        style={{
          background: C.darkSurf,
          border: `1px solid ${C.accent}`,
          borderRadius: RADIUS.pill,
          padding: 8,
          boxShadow: `0 0 0 2px ${C.accent}33`,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          minWidth: 200,
        }}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            ref={inputRef}
            type={includeTime ? "datetime-local" : "date"}
            style={{ ...styles.cellInput, flex: 1, boxShadow: "none" }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={() => { commit(null); }}
            style={{ ...S.btnGhost, fontSize: 10, padding: "2px 6px", color: C.darkMuted }}
            title="Clear"
          >{"\u2715"}</button>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type={includeTime ? "datetime-local" : "date"}
            style={{ ...styles.cellInput, flex: 1, boxShadow: "none", opacity: dateEnd ? 1 : 0.5 }}
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            placeholder="End date"
            onKeyDown={handleKeyDown}
          />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: C.darkMuted }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={includeTime} onChange={(e) => setIncludeTime(e.target.checked)} />
            Time
          </label>
          <span style={{ flex: 1 }} />
          {/* Quick buttons */}
          <button
            onClick={() => { setDraft(new Date().toISOString().slice(0, 10)); }}
            style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 10, fontFamily: FONT, padding: 0 }}
          >Today</button>
          <button
            onClick={() => {
              const d = new Date(); d.setDate(d.getDate() + 1);
              setDraft(d.toISOString().slice(0, 10));
            }}
            style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 10, fontFamily: FONT, padding: 0 }}
          >Tomorrow</button>
          <button
            onClick={() => {
              const d = new Date(); d.setDate(d.getDate() + 7);
              setDraft(d.toISOString().slice(0, 10));
            }}
            style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 10, fontFamily: FONT, padding: 0 }}
          >+1w</button>
        </div>
        <button
          onClick={() => commit(draft)}
          style={{ ...S.btnPrimary, fontSize: 11, padding: "4px 10px", alignSelf: "flex-end" }}
        >Done</button>
      </div>
    );
  }

  if (type === "number") {
    return (
      <input
        ref={inputRef}
        type="number"
        style={styles.cellInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={handleKeyDown}
        step="any"
      />
    );
  }

  // title, rich_text, url, email, phone_number
  return (
    <input
      ref={inputRef}
      type="text"
      style={styles.cellInput}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={handleKeyDown}
    />
  );
}


// ─── Cell Display Component ───

// Cell type renderers — keyed by Notion property type.
// Each receives { value, fieldName, schema, onClick, colorMapping, relationTitles }.
// Extracted as a lookup so sub-item views can reuse individual renderers.
const CELL_RENDERERS = {
  select: ({ value, fieldName, schema, onClick, colorMapping }) => {
    const { fill, text } = getSolidPillColor(value, getOptionNames(schema, fieldName), getFieldOptions(schema, fieldName), colorMapping);
    return <span style={styles.pill(fill, text)} onClick={onClick}>{value}</span>;
  },
  status: (...args) => CELL_RENDERERS.select(...args),
  multi_select: ({ value, fieldName, schema, colorMapping }) => {
    if (!Array.isArray(value)) return null;
    const optNames = getOptionNames(schema, fieldName);
    const schemaOpts = getFieldOptions(schema, fieldName);
    return (
      <span style={styles.multiPillWrap}>
        {value.map((v, i) => { const { fill, text } = getSolidPillColor(v, optNames, schemaOpts, colorMapping); return <span key={i} style={styles.pill(fill, text)}>{v}</span>; })}
      </span>
    );
  },
  checkbox: ({ value, onClick }) => <span style={styles.toggle(!!value)} onClick={onClick}>{value ? "\u2713" : ""}</span>,
  date: ({ value, onClick }) => {
    const dateStr = typeof value === "object" ? value.start : value;
    return <span style={{ cursor: onClick ? "pointer" : "default" }} onClick={onClick}>{formatDate(dateStr, { short: true })}</span>;
  },
  url: ({ value }) => (
    <a href={value} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, textDecoration: "none", fontSize: 13 }} onClick={(e) => e.stopPropagation()}>
      {truncate(String(value), 40)}
    </a>
  ),
  people: ({ value }) => Array.isArray(value) ? <span style={{ fontSize: 13 }}>{value.map((p) => p.name || p.email || "?").join(", ")}</span> : null,
  files: ({ value }) => Array.isArray(value) ? <span style={{ fontSize: 13, color: C.darkMuted }}>{value.map((f) => f.name).join(", ") || "--"}</span> : null,
  relation: ({ value, relationTitles }) => {
    if (!Array.isArray(value) || value.length === 0) return <span style={{ fontSize: 12, color: C.darkMuted }}>--</span>;
    const resolved = value.map(id => (relationTitles || {})[id] || null).filter(Boolean);
    if (resolved.length === 0) return <span style={{ fontSize: 12, color: C.darkMuted }}>{value.length} linked</span>;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {resolved.map((name, i) => <span key={i} style={{ display: "inline-block", padding: "2px 8px", borderRadius: RADIUS.pill, background: C.accent + "15", color: C.accent, fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>)}
      </div>
    );
  },
  number: ({ value, onClick }) => <span style={{ cursor: onClick ? "pointer" : "default", fontVariantNumeric: "tabular-nums" }} onClick={onClick}>{value}</span>,
  last_edited_time: ({ value }) => <span style={{ fontSize: 12, color: C.darkMuted, fontVariantNumeric: "tabular-nums" }}>{formatDate(String(value), { short: true })}</span>,
  created_time: ({ value }) => <span style={{ fontSize: 12, color: C.darkMuted, fontVariantNumeric: "tabular-nums" }}>{formatDate(String(value), { short: true })}</span>,
};

function CellDisplay({ value, type, fieldName, schema, onClick, colorMapping, relationTitles }) {
  if (value === null || value === undefined || value === "") {
    return <span style={{ color: C.darkMuted, fontSize: 12, fontStyle: "italic", cursor: onClick ? "pointer" : "default" }} onClick={onClick}>--</span>;
  }
  const renderer = CELL_RENDERERS[type];
  if (renderer) return renderer({ value, fieldName, schema, onClick, colorMapping, relationTitles });
  return <span style={{ cursor: onClick ? "pointer" : "default" }} onClick={onClick}>{truncate(String(value), 120)}</span>;
}


// ─── Owner Column Components ───

/** Display owner user pills for a row */
function OwnerCellDisplay({ ownerIds, users, onClick }) {
  if (!ownerIds || ownerIds.length === 0) {
    return (
      <span
        onClick={onClick}
        style={{ color: C.darkMuted, fontSize: 12, cursor: onClick ? "pointer" : "default", opacity: 0.6 }}
      >
        Unassigned
      </span>
    );
  }

  const userMap = {};
  (users || []).forEach((u) => { userMap[u.id] = u; });

  return (
    <div onClick={onClick} style={{ display: "flex", gap: 4, flexWrap: "wrap", cursor: onClick ? "pointer" : "default", alignItems: "center" }}>
      {ownerIds.map((uid) => {
        const u = userMap[uid];
        const name = u?.display_name || uid.slice(0, 8);
        const initial = name.charAt(0).toUpperCase();
        return (
          <span
            key={uid}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: C.accent + "18",
              border: `1px solid ${C.accent}33`,
              borderRadius: RADIUS.pill,
              padding: "1px 8px 1px 3px",
              fontSize: 11,
              fontWeight: 500,
              color: C.darkText,
              lineHeight: "20px",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{
              width: 16, height: 16, borderRadius: "50%",
              background: `linear-gradient(135deg, ${C.accent}, ${C.accent}88)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, fontWeight: 700, color: "#fff", flexShrink: 0,
            }}>
              {initial}
            </span>
            {name}
          </span>
        );
      })}
    </div>
  );
}

/** Multi-select dropdown to pick owners */
function OwnerPicker({ ownerIds, users, onCommit, onClose }) {
  const [selected, setSelected] = useState(new Set(ownerIds || []));
  const [filter, setFilter] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const filtered = (users || []).filter((u) =>
    u.display_name?.toLowerCase().includes(filter.toLowerCase())
  );

  const toggle = (uid) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  const handleDone = () => {
    onCommit(Array.from(selected));
    onClose();
  };

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        zIndex: 200,
        background: C.darkSurf,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg,
        boxShadow: SHADOW.dropdown,
        width: 220,
        maxHeight: 280,
        display: "flex",
        flexDirection: "column",
        fontFamily: FONT,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter users..."
        style={{
          border: "none",
          borderBottom: `1px solid ${C.darkBorder}`,
          background: "transparent",
          color: C.darkText,
          padding: "8px 10px",
          fontSize: 12,
          outline: "none",
          fontFamily: FONT,
        }}
      />
      <div style={{ overflowY: "auto", flex: 1, padding: "4px 0" }}>
        {filtered.length === 0 && (
          <div style={{ padding: "8px 10px", fontSize: 11, color: C.darkMuted }}>No users found</div>
        )}
        {filtered.map((u) => {
          const isActive = selected.has(u.id);
          const initial = (u.display_name || "?").charAt(0).toUpperCase();
          return (
            <div
              key={u.id}
              onClick={() => toggle(u.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                cursor: "pointer",
                fontSize: 12,
                color: C.darkText,
                background: isActive ? C.accent + "14" : "transparent",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{
                width: 20, height: 20, borderRadius: "50%",
                background: `linear-gradient(135deg, ${C.accent}, ${C.accent}88)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0,
              }}>
                {initial}
              </span>
              <span style={{ flex: 1 }}>{u.display_name}</span>
              {isActive && <span style={{ color: C.accent, fontSize: 14, fontWeight: 700 }}>✓</span>}
            </div>
          );
        })}
      </div>
      <div style={{
        borderTop: `1px solid ${C.darkBorder}`,
        padding: "6px 10px",
        display: "flex",
        justifyContent: "flex-end",
      }}>
        <button
          onClick={handleDone}
          style={{
            background: C.accent,
            color: "#fff",
            border: "none",
            borderRadius: RADIUS.sm,
            padding: "4px 12px",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}


// ─── Saved Views Dropdown ───

// ─── Main Table Component ───

export default function Table({ data = [], schema, config = {}, onUpdate, onRefresh, onCreate, onDelete, pageConfig, onSaveFilters, onViewConfigChange }) {
  const { user } = usePlatform();
  const collab = useCollaboration();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState(config.sort?.field || config.sortField || null);
  const [sortDir, setSortDir] = useState(config.sort?.direction || config.sortDir || (config.sortField ? "asc" : null)); // "asc" | "desc" | null
  const [filters, setFilters] = useState(config.filters || {}); // { fieldName: value }

  // Sync sort state from external config changes (e.g. ViewSettingsPanel)
  useEffect(() => {
    const extSort = config.sortField ?? null;
    const extDir = config.sortDir ?? "asc";
    if (extSort !== undefined) setSortField(extSort);
    if (config.sortDir !== undefined) setSortDir(extDir);
  }, [config.sortField, config.sortDir]);

  // ── Chip Filters (multi-select, persisted) ──
  const [chipFilters, setChipFilters] = useState(
    () => config.activeFilters || pageConfig?.activeFilters || {}
  ); // { fieldName: ["val1", "val2"] }
  const [editCell, setEditCell] = useState(null); // { pageId, field }
  const [savingCells, setSavingCells] = useState({}); // { "pageId:field": true }
  const [failedCells, setFailedCells] = useState({}); // { "pageId:field": "error message" }
  const [hoveredRow, setHoveredRow] = useState(null);
  const [searchFocused, setSearchFocused] = useState(false);

  // ── Row Selection ──
  const [selectedRows, setSelectedRows] = useState(new Set());

  // ── Saved Views ──
  const [activeSavedViewId, setActiveSavedViewId] = useState(config.activeSavedViewId || null);

  // ── Column Visibility ──
  const [hiddenColumns, setHiddenColumns] = useState(new Set());
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef(null);

  // ── Record Detail Panel ──
  const [detailPage, setDetailPage] = useState(null);
  const lastRowClickRef = useRef({ id: null, time: 0 });

  // ── Column Resize (persisted) ──
  const [colWidths, setColWidths] = useState(() => config.colWidths || {}); // { fieldName: px }
  const resizeDrag = useRef(null); // { col, startX, startW }

  // ── Column Management ──
  const [colCtxMenu, setColCtxMenu] = useState(null); // { col, x, y }
  const [renamingCol, setRenamingCol] = useState(null); // column name being renamed
  const [renameValue, setRenameValue] = useState("");
  const [addColOpen, setAddColOpen] = useState(false);
  const [addColName, setAddColName] = useState("");
  const [addColType, setAddColType] = useState("text");
  // Relation column state
  const [addColRelationDb, setAddColRelationDb] = useState(null);
  const [addColSynced, setAddColSynced] = useState(true);
  const [addColSyncedName, setAddColSyncedName] = useState("");
  const [dbSearchResults, setDbSearchResults] = useState([]);
  const [dbSearchQuery, setDbSearchQuery] = useState("");
  const [dbSearching, setDbSearching] = useState(false);
  const [colDrag, setColDrag] = useState(null); // { col, startX, overCol }
  // ── Source type detection (D1 / Notion / external) ──
  const sourceType = useMemo(() => {
    const pt = pageConfig?.page_type || pageConfig?.pageType;
    if (pt === "database") return "d1";
    if (pt === "linked_notion") return "notion";
    if (pt === "linked_sheet" || pt === "linked_monday") return "external_readonly";
    // Fallback: if we have a schema and page ID but no linked_ prefix, treat as D1
    if (schema?.allFields?.length > 0 && pageConfig?.id && !String(pt || "").startsWith("linked_")) return "d1";
    return "unknown";
  }, [pageConfig?.page_type, pageConfig?.pageType, pageConfig?.id, schema?.allFields?.length]);
  const canEditSchema = sourceType === "d1" || sourceType === "notion";
  const isD1Table = sourceType === "d1";
  const isNotionTable = sourceType === "notion";

  // ── Owner Column ──
  const showOwnerColumn = !!(config.showOwnerColumn || pageConfig?.config?.showOwnerColumn);
  const [teamUsers, setTeamUsers] = useState([]);
  const [ownerPickerRow, setOwnerPickerRow] = useState(null); // pageId of row being edited
  useEffect(() => {
    if (!showOwnerColumn) return;
    listUserDirectory().then((res) => {
      setTeamUsers(res.users || []);
    }).catch(() => {});
  }, [showOwnerColumn]);

  // ── Ghost Row (inline new record creation) ──
  const [ghostValues, setGhostValues] = useState({});
  const [ghostSaving, setGhostSaving] = useState(false);
  const [ghostError, setGhostError] = useState(null);
  const ghostActive = useRef(false); // true when user has started typing in ghost row

  // Shared ghost row input style
  const ghostInputStyle = {
    width: "100%", border: "none", borderRadius: RADIUS.sm,
    background: "transparent", color: C.darkText, fontFamily: FONT,
    fontSize: 12, padding: "4px 6px", outline: "none", boxSizing: "border-box",
  };

  // ── Keyboard Navigation ──
  const [focusedCell, setFocusedCell] = useState(null); // { row: number, col: number } | null
  const [initialChar, setInitialChar] = useState(""); // printable char that triggered cell edit
  const scrollAreaRef = useRef(null);

  // ── Virtualization ──
  const scrollTopRef = useRef(0);
  const scrollRAF = useRef(null);
  const [containerHeight, setContainerHeight] = useState(600);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 40 });

  // Stable containerHeight via ResizeObserver
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    setContainerHeight(el.clientHeight);
    const ro = new ResizeObserver(([entry]) => {
      setContainerHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);


  // ── Cell Linking ──
  const { resolveLinksForView, createLink, removeLink, getLinksForTarget } = useLinks();
  const [resolvedLinks, setResolvedLinks] = useState(new Map());
  const [linkPickerCell, setLinkPickerCell] = useState(null); // { pageId, field, fieldType }

  // Resolve linked values for this view
  const viewIdx = pageConfig?.views?.findIndex((v) => v === config) ?? 0;
  useEffect(() => {
    if (!pageConfig?.id) return;
    resolveLinksForView(pageConfig.id, viewIdx)
      .then(setResolvedLinks)
      .catch(() => {});
  }, [pageConfig?.id, viewIdx, resolveLinksForView]);
  const targetDatabaseId = config.databaseId || pageConfig?.databaseIds?.[0] || pageConfig?.id;

  // ── Relation title resolution ──
  // Query each related database to get page titles for relation fields
  const [relationTitles, setRelationTitles] = useState({});
  const resolvedDbsRef = useRef(new Set());
  useEffect(() => {
    if (!data || data.length === 0 || !schema) return;
    const relationFields = (schema.allFields || []).filter(f => f.type === "relation" && f.relatedDbId);
    if (relationFields.length === 0) return;
    // Only query databases we haven't resolved yet
    const dbsToQuery = relationFields.filter(f => !resolvedDbsRef.current.has(f.relatedDbId));
    if (dbsToQuery.length === 0) return;
    // Query each related database for its page titles
    Promise.allSettled(
      dbsToQuery.map(async (field) => {
        resolvedDbsRef.current.add(field.relatedDbId);
        const resp = await notionProxy("/query", "POST", {
          database_id: field.relatedDbId,
          page_size: 100,
        });
        const titles = {};
        for (const page of resp?.results || []) {
          let title = null;
          for (const [, prop] of Object.entries(page.properties || {})) {
            if (prop.type === "title" && prop.title?.length > 0) {
              title = prop.title.map(t => t.plain_text || "").join("");
              break;
            }
          }
          if (title) titles[page.id] = title;
        }
        return titles;
      })
    ).then((results) => {
      const merged = {};
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) Object.assign(merged, r.value);
      }
      if (Object.keys(merged).length > 0) {
        setRelationTitles(prev => ({ ...prev, ...merged }));
      }
    });
  }, [data, schema]);

  // Inject animations on mount
  useEffect(() => {
    injectAnimations();
  }, []);

  // Outside-click to close column visibility menu
  useEffect(() => {
    if (!colMenuOpen) return;
    const handler = (e) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target)) {
        setColMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colMenuOpen]);

  // ── Column resize drag handlers ──
  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;

  const handleResizeStart = useCallback((col, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidthsRef.current[col] || 150;
    resizeDrag.current = { col, startX, startW };

    const onMove = (me) => {
      if (!resizeDrag.current) return;
      const dx = me.clientX - resizeDrag.current.startX;
      const newW = Math.max(60, resizeDrag.current.startW + dx);
      setColWidths((prev) => ({ ...prev, [resizeDrag.current.col]: newW }));
    };
    const onUp = () => {
      // Persist column widths
      if (resizeDrag.current && onViewConfigChange) {
        const finalWidths = { ...colWidthsRef.current };
        onViewConfigChange({ colWidths: finalWidths });
      }
      resizeDrag.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // ── Column context menu handlers ──
  const handleColRightClick = useCallback((col, e) => {
    e.preventDefault();
    setColCtxMenu({ col, x: e.clientX, y: e.clientY });
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    if (!colCtxMenu) return;
    const handler = () => setColCtxMenu(null);
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colCtxMenu]);

  // Hide column from context menu
  const handleHideCol = useCallback((col) => {
    setHiddenColumns((prev) => new Set([...prev, col]));
    setColCtxMenu(null);
    if (onViewConfigChange) {
      const visibleFields = allColumnsRef.current.filter((c) => c !== col && !hiddenColumns.has(c));
      onViewConfigChange({ visibleFields });
    }
  }, [hiddenColumns, onViewConfigChange]);

  // ── Notion DB helper ──
  const notionDbId = isNotionTable ? (pageConfig?.databaseIds?.[0] || null) : null;
  const workerUrl = user?.workerUrl;
  const notionKey = user?.notionKey;

  // Rename column (D1 + Notion)
  const handleRenameCol = useCallback(async (oldName, newName) => {
    if (!newName.trim() || newName === oldName) { setRenamingCol(null); return; }
    if (!canEditSchema || !pageConfig?.id) { setRenamingCol(null); return; }
    try {
      if (isNotionTable && notionDbId && workerUrl && notionKey) {
        await updateDatabase(workerUrl, notionKey, notionDbId, { properties: { [oldName]: { name: newName.trim() } } });
      } else {
        const schemaRes = await getTableSchema(pageConfig.id);
        const cols = (schemaRes?.columns || []).map((c) =>
          c.name === oldName ? { ...c, name: newName.trim() } : c
        );
        await updateTableSchema(pageConfig.id, cols);
      }
      if (onRefresh) onRefresh();
    } catch (err) { console.error("Rename column failed:", err); }
    setRenamingCol(null);
  }, [canEditSchema, isNotionTable, notionDbId, workerUrl, notionKey, pageConfig?.id, onRefresh]);

  // Delete column (D1 + Notion)
  const handleDeleteCol = useCallback(async (col) => {
    if (!canEditSchema || !pageConfig?.id) return;
    try {
      if (isNotionTable && notionDbId && workerUrl && notionKey) {
        await updateDatabase(workerUrl, notionKey, notionDbId, { properties: { [col]: null } });
      } else {
        const schemaRes = await getTableSchema(pageConfig.id);
        const cols = (schemaRes?.columns || []).filter((c) => c.name !== col);
        await updateTableSchema(pageConfig.id, cols);
      }
      if (onRefresh) onRefresh();
    } catch (err) { console.error("Delete column failed:", err); }
    setColCtxMenu(null);
  }, [canEditSchema, isNotionTable, notionDbId, workerUrl, notionKey, pageConfig?.id, onRefresh]);

  // Change column type (D1 tables only — Notion has restrictions)
  const handleChangeColType = useCallback(async (col, newType) => {
    if (!isD1Table || !pageConfig?.id) return;
    try {
      const schemaRes = await getTableSchema(pageConfig.id);
      const cols = (schemaRes?.columns || []).map((c) =>
        c.name === col ? { ...c, type: newType } : c
      );
      await updateTableSchema(pageConfig.id, cols);
      if (onRefresh) onRefresh();
    } catch (err) { console.error("Change type failed:", err); }
    setColCtxMenu(null);
  }, [isD1Table, pageConfig?.id, onRefresh]);

  // Search Notion databases for relation column picker
  const searchRelationDbs = useCallback(async (q) => {
    if (!workerUrl || !notionKey) return;
    setDbSearching(true);
    try {
      const results = await searchDatabases(workerUrl, notionKey, q || "");
      setDbSearchResults(
        results
          .filter((r) => r.id !== notionDbId) // exclude self
          .slice(0, 15)
          .map((r) => ({
            id: r.id,
            title: r.title?.map((t) => t.plain_text).join("") || "Untitled",
          }))
      );
    } catch (err) {
      console.error("DB search failed:", err);
    } finally {
      setDbSearching(false);
    }
  }, [workerUrl, notionKey, notionDbId]);

  // Add new column (D1 + Notion)
  const handleAddCol = useCallback(async () => {
    if (!addColName.trim() || !canEditSchema || !pageConfig?.id) return;
    // Guard: relation needs a target database selected
    if (addColType === "relation" && !addColRelationDb) return;
    if (addColType === "relation" && addColSynced && !addColSyncedName.trim()) return;
    try {
      if (isNotionTable && notionDbId && workerUrl && notionKey) {
        if (addColType === "relation" && addColRelationDb) {
          // Build relation payload directly
          const relPayload = {};
          if (addColSynced && addColSyncedName.trim()) {
            relPayload.relation = {
              database_id: addColRelationDb.id,
              type: "dual_property",
              dual_property: { synced_property_name: addColSyncedName.trim() },
            };
          } else {
            relPayload.relation = {
              database_id: addColRelationDb.id,
              type: "single_property",
              single_property: {},
            };
          }
          await updateDatabase(workerUrl, notionKey, notionDbId, {
            properties: { [addColName.trim()]: relPayload },
          });
        } else {
          const notionType = D1_TO_NOTION_TYPE[addColType] || "rich_text";
          const propDef = { [notionType]: {} };
          // Add default options for select/multi_select/status
          if (["select", "multi_select"].includes(addColType)) {
            propDef[notionType] = { options: [] };
          }
          await updateDatabase(workerUrl, notionKey, notionDbId, { properties: { [addColName.trim()]: propDef } });
        }
      } else {
        const schemaRes = await getTableSchema(pageConfig.id);
        const cols = [...(schemaRes?.columns || []), { id: `col_${Date.now()}`, name: addColName.trim(), type: addColType }];
        await updateTableSchema(pageConfig.id, cols);
      }
      setAddColOpen(false);
      setAddColName("");
      setAddColType("text");
      setAddColRelationDb(null);
      setAddColSynced(true);
      setAddColSyncedName("");
      setDbSearchResults([]);
      setDbSearchQuery("");
      if (onRefresh) onRefresh();
    } catch (err) { console.error("Add column failed:", err); }
  }, [addColName, addColType, addColRelationDb, addColSynced, addColSyncedName, canEditSchema, isNotionTable, isD1Table, notionDbId, workerUrl, notionKey, pageConfig?.id, onRefresh]);

  // Column reorder via drag
  const handleColDragStart = useCallback((col, e) => {
    setColDrag({ col, startX: e.clientX, overCol: null });
  }, []);

  useEffect(() => {
    if (!colDrag) return;
    // Prevent text selection during drag
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";

    const onMove = (e) => {
      const els = document.querySelectorAll("[data-col-header]");
      let over = null;
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          over = el.dataset.colHeader;
          break;
        }
      }
      if (over && over !== colDrag.col) {
        setColDrag((prev) => prev ? { ...prev, overCol: over } : null);
      }
    };
    const onUp = () => {
      if (colDrag.overCol && colDrag.overCol !== colDrag.col && onViewConfigChange) {
        const currentOrder = columns || allColumnsRef.current;
        const fromIdx = currentOrder.indexOf(colDrag.col);
        const toIdx = currentOrder.indexOf(colDrag.overCol);
        if (fromIdx >= 0 && toIdx >= 0) {
          const reordered = [...currentOrder];
          reordered.splice(fromIdx, 1);
          reordered.splice(toIdx, 0, colDrag.col);
          onViewConfigChange({ columns: reordered });
        }
      }
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
      setColDrag(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [colDrag, onViewConfigChange]);

  // Ref for allColumns (needed by handlers that can't close over latest allColumns)
  const allColumnsRef = useRef([]);

  // Resolve all columns from schema
  const allColumns = useMemo(
    () => resolveColumns(schema, config.columns, config.fieldMappings),
    [schema, config.columns, config.fieldMappings]
  );

  // Sync hidden columns from config.visibleFields (updates when ViewSettingsPanel changes).
  // New columns discovered from schema that aren't in the saved visibleFields list
  // default to VISIBLE so that columns added in Notion appear automatically.
  const prevVisibleFields = useRef(config.visibleFields);
  useEffect(() => {
    const vf = config.visibleFields;
    if (!Array.isArray(vf) || vf.length === 0 || allColumns.length === 0) return;

    if (prevVisibleFields.current !== vf || !prevVisibleFields.current) {
      const visibleSet = new Set(vf);
      // Only hide columns that were KNOWN at save time and explicitly excluded.
      // New columns (not in visibleFields at all) stay visible by default.
      // To detect "known at save time", we check if the column was in the config.columns
      // snapshot. If config.columns doesn't exist, treat visibleFields as the full list.
      const knownColumns = new Set(config.columns || vf);
      const hidden = new Set(
        allColumns.filter((c) => knownColumns.has(c) && !visibleSet.has(c))
      );
      setHiddenColumns(hidden);
      prevVisibleFields.current = vf;
    }
  }, [allColumns, config.visibleFields, config.columns]);

  // Visible columns (filtered by hiddenColumns)
  allColumnsRef.current = allColumns;

  const columns = useMemo(() => {
    const visible = allColumns.filter((c) => !hiddenColumns.has(c));
    if (showOwnerColumn && !visible.includes(OWNER_COL_NAME)) {
      // Insert after first column (title)
      const idx = Math.min(1, visible.length);
      visible.splice(idx, 0, OWNER_COL_NAME);
    }
    return visible;
  }, [allColumns, hiddenColumns, showOwnerColumn]);

  // Identify filterable fields (select / status)
  const filterableFields = useMemo(() => {
    if (!schema) return [];
    return [...schema.statuses, ...schema.selects].filter(
      (f) => columns.includes(f.name) && f.options?.length > 0
    );
  }, [schema, columns]);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debouncedSetSearch = useMemo(
    () => debounce((val) => setDebouncedSearch(val), 200),
    []
  );
  useEffect(() => {
    debouncedSetSearch(search);
  }, [search, debouncedSetSearch]);

  // Chip filter change handler (persists via onViewConfigChange)
  const handleChipFilterChange = useCallback((newFilters) => {
    setChipFilters(newFilters);
    setActiveSavedViewId(null);
    if (onSaveFilters) onSaveFilters(newFilters);
    if (onViewConfigChange) onViewConfigChange({ activeFilters: newFilters, activeSavedViewId: null });
  }, [onSaveFilters, onViewConfigChange]);

  // Filter + search + sort pipeline
  const processedData = useMemo(() => {
    let rows = [...data];

    // Apply chip filters (multi-select OR within field, AND across fields)
    rows = applyChipFilters(rows, chipFilters, schema);

    // Apply dropdown filters (legacy, still used for column-header selects)
    for (const [field, filterVal] of Object.entries(filters)) {
      if (!filterVal) continue;
      rows = rows.filter((page) => {
        const val = readField(page, field);
        if (val === null) return false;
        return String(val) === filterVal;
      });
    }

    // Apply search
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      rows = rows.filter((page) => {
        for (const col of columns) {
          const val = readField(page, col);
          const text = searchableText(val, getFieldType(schema, col));
          if (text.toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }

    // Apply sort
    if (sortField && sortDir) {
      const type = getFieldType(schema, sortField);
      rows.sort((a, b) => {
        let va = readField(a, sortField);
        let vb = readField(b, sortField);

        // Normalize for comparison
        if (type === "date") {
          va = typeof va === "object" ? va?.start : va;
          vb = typeof vb === "object" ? vb?.start : vb;
        }

        // Nulls last
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;

        // Number compare
        if (type === "number") {
          return sortDir === "asc" ? va - vb : vb - va;
        }

        // String compare
        const sa = String(va).toLowerCase();
        const sb = String(vb).toLowerCase();
        if (sa < sb) return sortDir === "asc" ? -1 : 1;
        if (sa > sb) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
    }

    return rows;
  }, [data, filters, chipFilters, debouncedSearch, sortField, sortDir, columns, schema]);

  // ── Record badge counts (comments, notes, files) ──
  const [badgeCounts, setBadgeCounts] = useState({});
  const badgeFetchRef = useRef(null);
  useEffect(() => {
    if (!processedData || processedData.length === 0 || !pageConfig?.id) return;
    if (badgeFetchRef.current) clearTimeout(badgeFetchRef.current);
    badgeFetchRef.current = setTimeout(async () => {
      try {
        const ids = processedData.map((p) => p.id).filter(Boolean);
        if (ids.length === 0) return;
        const res = await getRecordBadgeCounts(ids, pageConfig.id);
        setBadgeCounts(res?.counts || {});
      } catch {}
    }, 500);
    return () => { if (badgeFetchRef.current) clearTimeout(badgeFetchRef.current); };
  }, [processedData, pageConfig?.id]);

  // Re-sync visible range when data or container size changes
  useEffect(() => {
    const st = scrollTopRef.current;
    const totalRows = processedData.length;
    const newStart = Math.min(totalRows, Math.max(0, Math.floor(st / ROW_HEIGHT) - VIRT_BUFFER));
    const newEnd = Math.min(totalRows, Math.ceil((st + containerHeight) / ROW_HEIGHT) + VIRT_BUFFER);
    setVisibleRange({ start: newStart, end: newEnd });
  }, [processedData.length, containerHeight]);

  // Column sort handler — cycles asc -> desc -> none
  const handleSort = useCallback((field) => {
    let newField, newDir;
    if (sortField !== field) {
      newField = field; newDir = "asc";
    } else if (sortDir === "asc") {
      newField = field; newDir = "desc";
    } else {
      newField = null; newDir = null;
    }
    setSortField(newField);
    setSortDir(newDir);
    setActiveSavedViewId(null);
    if (onViewConfigChange) onViewConfigChange({ sort: { field: newField, direction: newDir }, activeSavedViewId: null });
  }, [sortField, sortDir, onViewConfigChange]);

  // Inline edit commit — with saving indicator + error handling
  const handleEditCommit = useCallback(async (pageId, field, value) => {
    const type = getFieldType(schema, field);
    if (!type || !onUpdate) return;

    // Validate before committing
    if (type === "email" && value) {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(value)) {
        setFailedCells((prev) => ({ ...prev, [`${pageId}:${field}`]: "Invalid email" }));
        setEditCell(null);
        setTimeout(() => setFailedCells((prev) => { const n = { ...prev }; delete n[`${pageId}:${field}`]; return n; }), 3000);
        return;
      }
    }
    if (type === "url" && value) {
      try { new URL(value.startsWith("http") ? value : `https://${value}`); } catch {
        setFailedCells((prev) => ({ ...prev, [`${pageId}:${field}`]: "Invalid URL" }));
        setEditCell(null);
        setTimeout(() => setFailedCells((prev) => { const n = { ...prev }; delete n[`${pageId}:${field}`]; return n; }), 3000);
        return;
      }
    }

    const propPayload = buildProp(type, value);
    if (propPayload !== undefined) {
      const cellKey = `${pageId}:${field}`;
      setSavingCells((prev) => ({ ...prev, [cellKey]: true }));
      setFailedCells((prev) => { const n = { ...prev }; delete n[cellKey]; return n; });
      try {
        await onUpdate(pageId, field, propPayload);
      } catch (err) {
        console.error("Inline edit failed:", err);
        setFailedCells((prev) => ({ ...prev, [cellKey]: err.message || "Save failed" }));
        setTimeout(() => setFailedCells((prev) => { const n = { ...prev }; delete n[cellKey]; return n; }), 4000);
      } finally {
        setSavingCells((prev) => { const n = { ...prev }; delete n[cellKey]; return n; });
      }
    }
    setEditCell(null);
    setInitialChar("");
    // Advance focus down after commit (Notion behavior)
    if (focusedCell) {
      setFocusedCell((prev) =>
        prev && prev.row < processedData.length - 1
          ? { row: prev.row + 1, col: prev.col }
          : prev
      );
    }
  }, [schema, onUpdate, focusedCell, processedData.length]);

  // Owner column update handler
  const handleOwnerCommit = useCallback(async (pageId, ownerIds) => {
    const tableId = pageConfig?.id;
    if (!tableId) return;
    try {
      await updateRowOwner(tableId, pageId, ownerIds);
      // Optimistically update local data
      if (onRefresh) setTimeout(onRefresh, 300);
    } catch (err) {
      console.error("Owner update failed:", err);
    }
    setOwnerPickerRow(null);
  }, [pageConfig?.id, onRefresh]);

  // Create option handler for SelectPicker/MultiSelectPicker (adds to D1 schema)
  const handleCreateOption = useCallback(async (fieldName, newOptionName) => {
    if (!canEditSchema || !pageConfig?.id) return;
    try {
      if (isNotionTable && notionDbId && workerUrl && notionKey) {
        // For Notion: we can't easily add a single option without knowing the existing ones,
        // but the Notion API supports adding options through the update endpoint
        // The simplest approach: let Notion handle it via page update (option auto-created)
      } else {
        const schemaRes = await getTableSchema(pageConfig.id);
        const cols = (schemaRes?.columns || []).map((c) => {
          if (c.name === fieldName) {
            const existing = c.options || [];
            if (!existing.some((o) => (typeof o === "string" ? o : o.name) === newOptionName)) {
              return { ...c, options: [...existing, { name: newOptionName }] };
            }
          }
          return c;
        });
        await updateTableSchema(pageConfig.id, cols);
      }
    } catch (err) { console.error("Create option failed:", err); }
  }, [canEditSchema, isNotionTable, notionDbId, workerUrl, notionKey, pageConfig?.id]);

  // Checkbox direct toggle
  const handleCheckboxToggle = useCallback((pageId, field, currentValue) => {
    const newVal = !currentValue;
    const propPayload = buildProp("checkbox", newVal);
    if (propPayload !== undefined && onUpdate) {
      onUpdate(pageId, field, propPayload);
    }
  }, [onUpdate]);

  // ── Keyboard Navigation Handler ──
  useEffect(() => {
    const handler = (e) => {
      // Don't intercept if user is in a text input, search, or modal
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!focusedCell && !e.key.startsWith("Arrow")) return;

      const rowCount = processedData.length;
      const colCount = columns.length;
      if (rowCount === 0 || colCount === 0) return;

      const { row, col } = focusedCell || { row: 0, col: 0 };

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedCell({ row: Math.min(row + 1, rowCount - 1), col });
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedCell({ row: Math.max(row - 1, 0), col });
          break;
        case "ArrowRight":
          e.preventDefault();
          if (col < colCount - 1) setFocusedCell({ row, col: col + 1 });
          else if (row < rowCount - 1) setFocusedCell({ row: row + 1, col: 0 });
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (col > 0) setFocusedCell({ row, col: col - 1 });
          else if (row > 0) setFocusedCell({ row: row - 1, col: colCount - 1 });
          break;
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) {
            if (col > 0) setFocusedCell({ row, col: col - 1 });
            else if (row > 0) setFocusedCell({ row: row - 1, col: colCount - 1 });
          } else {
            if (col < colCount - 1) setFocusedCell({ row, col: col + 1 });
            else if (row < rowCount - 1) setFocusedCell({ row: row + 1, col: 0 });
          }
          break;
        case "Enter":
          if (focusedCell && !editCell) {
            e.preventDefault();
            const page = processedData[row];
            const field = columns[col];
            const type = getFieldType(schema, field);
            if (page && field && EDITABLE_TYPES.has(type) && onUpdate) {
              if (type === "checkbox") {
                handleCheckboxToggle(page.id, field, readField(page, field));
              } else {
                setEditCell({ pageId: page.id, field });
                setInitialChar("");
              }
            }
          }
          break;
        case "Escape":
          if (editCell) {
            setEditCell(null);
          } else {
            setFocusedCell(null);
          }
          break;
        case "Delete":
        case "Backspace":
          if (focusedCell && !editCell) {
            e.preventDefault();
            const page = processedData[row];
            const field = columns[col];
            const type = getFieldType(schema, field);
            if (page && field && EDITABLE_TYPES.has(type) && onUpdate && type !== "checkbox") {
              handleEditCommit(page.id, field, null);
            }
          }
          break;
        default:
          // Printable character → open editor with that char
          if (focusedCell && !editCell && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const page = processedData[row];
            const field = columns[col];
            const type = getFieldType(schema, field);
            if (page && field && EDITABLE_TYPES.has(type) && onUpdate && type !== "checkbox") {
              setEditCell({ pageId: page.id, field });
              setInitialChar(e.key);
            }
          }
          break;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [focusedCell, editCell, processedData, columns, schema, onUpdate, handleCheckboxToggle, handleEditCommit]);

  // Scroll focused cell into view (for virtualization compatibility)
  useEffect(() => {
    if (focusedCell && scrollAreaRef.current) {
      const targetTop = focusedCell.row * ROW_HEIGHT;
      const container = scrollAreaRef.current;
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + container.clientHeight - 80; // account for header
      if (targetTop < viewTop) {
        container.scrollTop = targetTop;
      } else if (targetTop + ROW_HEIGHT > viewBottom) {
        container.scrollTop = targetTop + ROW_HEIGHT - container.clientHeight + 80;
      }
    }
  }, [focusedCell]);

  // Filter change handler
  const handleFilterChange = useCallback((field, value) => {
    setFilters((prev) => {
      const next = { ...prev, [field]: value || undefined };
      if (onViewConfigChange) onViewConfigChange({ filters: next, activeSavedViewId: null });
      return next;
    });
    setActiveSavedViewId(null);
  }, [onViewConfigChange]);

  // ── Row Selection ──
  const toggleRow = useCallback((pageId) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }, []);

  const toggleAllRows = useCallback(() => {
    setSelectedRows((prev) => {
      if (prev.size === processedData.length && prev.size > 0) return new Set();
      return new Set(processedData.map((p) => p.id));
    });
  }, [processedData]);

  // ── Bulk Delete ──
  const handleBulkDelete = useCallback(() => {
    if (!onDelete || selectedRows.size === 0) return;
    const confirmed = window.confirm(`Archive ${selectedRows.size} selected record${selectedRows.size !== 1 ? "s" : ""}?`);
    if (!confirmed) return;
    onDelete([...selectedRows]);
    setSelectedRows(new Set());
  }, [onDelete, selectedRows]);

  // ── CSV Export ──
  const handleExport = useCallback(() => {
    if (!processedData.length || !columns.length) return;

    const escape = (val) => {
      const s = val === null || val === undefined ? "" : String(val);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const header = columns.map(escape).join(",");
    const rows = processedData.map((page) =>
      columns.map((col) => {
        const type = getFieldType(schema, col);
        const value = readField(page, col);
        return escape(displayValue(value, type));
      }).join(",")
    );

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `${config.exportName || "table-export"}-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [processedData, columns, schema, config.exportName]);

  // ── Column Visibility Toggle ──
  const toggleColumn = useCallback((col) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      // Persist visible fields
      if (onViewConfigChange && allColumns.length > 0) {
        const visibleFields = allColumns.filter((c) => !next.has(c));
        onViewConfigChange({ visibleFields, activeSavedViewId: null });
      }
      return next;
    });
    setActiveSavedViewId(null);
  }, [allColumns, onViewConfigChange]);

  // ── Saved View Handlers ──
  const handleSelectSavedView = useCallback((viewId) => {
    if (!viewId) {
      // "Default" — clear all filters, show all columns, clear sort
      setChipFilters({});
      setFilters({});
      setHiddenColumns(new Set());
      setSortField(null);
      setSortDir(null);
      setActiveSavedViewId(null);
      if (onViewConfigChange) {
        onViewConfigChange({ activeFilters: {}, filters: {}, visibleFields: allColumns, sort: { field: null, direction: null }, activeSavedViewId: null });
      }
      return;
    }
    const sv = (config.savedViews || []).find((v) => v.id === viewId);
    if (!sv) return;
    setChipFilters(sv.activeFilters || {});
    setFilters(sv.filters || {});
    setSortField(sv.sort?.field || null);
    setSortDir(sv.sort?.direction || null);
    if (sv.visibleFields) {
      const hidden = new Set(allColumns.filter((c) => !sv.visibleFields.includes(c)));
      setHiddenColumns(hidden);
    } else {
      setHiddenColumns(new Set());
    }
    setActiveSavedViewId(viewId);
    if (onViewConfigChange) {
      onViewConfigChange({
        activeFilters: sv.activeFilters || {},
        filters: sv.filters || {},
        visibleFields: sv.visibleFields || allColumns,
        sort: sv.sort || { field: null, direction: null },
        activeSavedViewId: viewId,
      });
    }
  }, [config.savedViews, allColumns, onViewConfigChange]);

  const handleSaveNewView = useCallback((name) => {
    const newView = {
      id: crypto.randomUUID(),
      name,
      activeFilters: { ...chipFilters },
      visibleFields: allColumns.filter((c) => !hiddenColumns.has(c)),
      sort: { field: sortField, direction: sortDir },
      filters: { ...filters },
    };
    const updated = [...(config.savedViews || []), newView];
    setActiveSavedViewId(newView.id);
    if (onViewConfigChange) onViewConfigChange({ savedViews: updated, activeSavedViewId: newView.id });
  }, [chipFilters, hiddenColumns, sortField, sortDir, filters, allColumns, config.savedViews, onViewConfigChange]);

  const handleUpdateView = useCallback((viewId) => {
    const updated = (config.savedViews || []).map((v) =>
      v.id === viewId ? { ...v, activeFilters: { ...chipFilters }, visibleFields: allColumns.filter((c) => !hiddenColumns.has(c)), sort: { field: sortField, direction: sortDir }, filters: { ...filters } } : v
    );
    setActiveSavedViewId(viewId);
    if (onViewConfigChange) onViewConfigChange({ savedViews: updated, activeSavedViewId: viewId });
  }, [chipFilters, hiddenColumns, sortField, sortDir, filters, allColumns, config.savedViews, onViewConfigChange]);

  const handleRenameView = useCallback((viewId, newName) => {
    const updated = (config.savedViews || []).map((v) => v.id === viewId ? { ...v, name: newName } : v);
    if (onViewConfigChange) onViewConfigChange({ savedViews: updated });
  }, [config.savedViews, onViewConfigChange]);

  const handleDeleteView = useCallback((viewId) => {
    const updated = (config.savedViews || []).filter((v) => v.id !== viewId);
    const newActiveId = activeSavedViewId === viewId ? null : activeSavedViewId;
    if (activeSavedViewId === viewId) setActiveSavedViewId(null);
    if (onViewConfigChange) onViewConfigChange({ savedViews: updated, activeSavedViewId: newActiveId });
  }, [config.savedViews, activeSavedViewId, onViewConfigChange]);

  // ── Ghost Row Handler (create record from inline ghost row) ──
  const handleGhostCommit = useCallback(async () => {
    if (!onCreate || !targetDatabaseId) return;
    const titleField = schema?.title?.name;
    // Only create if there's a title value
    if (titleField && !ghostValues[titleField]?.toString().trim()) {
      setGhostValues({});
      ghostActive.current = false;
      return;
    }
    // Don't create if no values at all
    const hasAnyValue = Object.values(ghostValues).some((v) => v !== "" && v !== null && v !== undefined);
    if (!hasAnyValue) {
      ghostActive.current = false;
      return;
    }
    setGhostSaving(true);
    setGhostError(null);
    try {
      const properties = {};
      for (const [fieldName, val] of Object.entries(ghostValues)) {
        if (val === "" || val === null || val === undefined) continue;
        const type = getFieldType(schema, fieldName);
        if (!type) continue;
        const prop = buildProp(type, val);
        if (prop !== undefined) {
          properties[fieldName] = prop;
        }
      }
      await onCreate(targetDatabaseId, properties);
      setGhostValues({});
      setGhostError(null);
      ghostActive.current = false;
    } catch (err) {
      setGhostError(err.message || "Failed to create record");
    } finally {
      setGhostSaving(false);
    }
  }, [onCreate, targetDatabaseId, ghostValues, schema]);

  // Shared ghost row cell renderer (used by both empty state and normal ghost row)
  const ghostKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGhostCommit(); }
    if (e.key === "Escape") { setGhostValues({}); ghostActive.current = false; e.target.blur(); }
  };
  const ghostSetVal = (col, val) => { ghostActive.current = true; setGhostValues((p) => ({ ...p, [col]: val })); };

  function renderGhostCell(col, type, opts = {}) {
    const titleField = schema?.title?.name;
    if (type === "checkbox") {
      return (
        <label style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", height: "100%" }}>
          <input type="checkbox" checked={!!ghostValues[col]} onChange={(e) => ghostSetVal(col, e.target.checked)} style={{ width: 14, height: 14, accentColor: C.accent, cursor: "pointer" }} />
        </label>
      );
    }
    if (type === "select" || type === "status") {
      return (
        <select value={ghostValues[col] || ""} onChange={(e) => ghostSetVal(col, e.target.value || null)} onKeyDown={ghostKeyDown} style={{ ...ghostInputStyle, cursor: "pointer", appearance: "none" }}>
          <option value="">--</option>
          {getFieldOptions(schema, col).map((opt) => <option key={opt.name} value={opt.name}>{opt.name}</option>)}
        </select>
      );
    }
    return (
      <input
        type={type === "number" ? "number" : type === "date" ? "date" : "text"}
        style={ghostInputStyle}
        value={ghostValues[col] ?? ""}
        placeholder={col === titleField ? "New row..." : (opts.placeholder || "")}
        autoFocus={opts.autoFocus}
        onChange={(e) => { ghostSetVal(col, type === "number" ? (e.target.value ? Number(e.target.value) : "") : e.target.value); }}
        onKeyDown={ghostKeyDown}
        onFocus={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
        onBlur={(e) => { e.currentTarget.style.background = "transparent"; }}
      />
    );
  }

  // ─── Render ───

  // Empty state
  if (!data || data.length === 0) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.toolbar}>
          {onRefresh && (
            <button
              style={styles.refreshBtn}
              onClick={onRefresh}
              title="Refresh data"
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; e.currentTarget.style.color = C.darkText; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf2; e.currentTarget.style.color = C.darkMuted; }}
            >
              &#x21bb;
            </button>
          )}
        </div>
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>&#x1f4cb;</div>
          <div style={styles.emptyTitle}>No data to display</div>
          <div style={styles.emptySub}>
            This table is empty. Start typing in the row below to create your first record.
          </div>
          {/* Inline ghost row for empty state */}
          {onCreate && targetDatabaseId && schema && (() => {
            const cols = (schema.allFields || [])
              .filter((f) => EDITABLE_TYPES.has(f.type))
              .map((f) => f.name);
            const titleField = schema?.title?.name;
            return (
              <div style={{ marginTop: 16, width: "100%", overflowX: "auto" }}>
                <table style={{ ...styles.table, width: "100%", minWidth: 400 }}>
                  <thead>
                    <tr>{cols.map((c) => <th key={c} style={styles.th}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    <tr style={{ height: ROW_HEIGHT, opacity: 0.8 }}>
                      {cols.map((col) => (
                        <td key={col} style={{ ...styles.td, padding: "4px 6px" }}>
                          {renderGhostCell(col, getFieldType(schema, col), { placeholder: col, autoFocus: col === titleField })}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
                {ghostError && (
                  <div style={{ fontSize: 11, color: "#E05252", padding: "4px 12px" }}>{ghostError}</div>
                )}
              </div>
            );
          })()}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {onRefresh && (
              <button style={S.btnSecondary} onClick={onRefresh} {...hoverBg()}>Refresh</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // No results after filtering
  const showNoResults = processedData.length === 0 && data.length > 0;

  return (
    <div style={styles.wrapper}>
      {/* Dynamic filter chips */}
      <FilterChips
        schema={schema}
        data={data}
        activeFilters={chipFilters}
        onFilterChange={handleChipFilterChange}
      />

      {/* Bulk actions bar */}
      {selectedRows.size > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 16px",
            background: C.accent + "18",
            borderBottom: `1px solid ${C.accent}44`,
            flexShrink: 0,
            animation: "fadeUp 0.2s ease",
          }}
        >
          <span style={{ fontSize: 12, color: C.accent, fontFamily: FONT, fontWeight: 600 }}>
            {selectedRows.size} selected
          </span>
          <button
            onClick={() => setSelectedRows(new Set())}
            style={{
              ...S.btnGhost,
              fontSize: 11,
              padding: "3px 10px",
              color: C.darkMuted,
            }}
          >
            Clear
          </button>
          {onDelete && (
            <button
              onClick={handleBulkDelete}
              style={{
                ...S.btnGhost,
                fontSize: 11,
                padding: "3px 10px",
                color: "#E05252",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <IconTrash size={12} color="#E05252" />
              Delete
            </button>
          )}
        </div>
      )}

      {/* Toolbar: views, search, filters, refresh, count */}
      <div style={styles.toolbar}>
        <SavedViewsDropdown
          savedViews={config.savedViews || []}
          activeSavedViewId={activeSavedViewId}
          onSelectView={handleSelectSavedView}
          onSaveView={handleSaveNewView}
          onUpdateView={handleUpdateView}
          onRenameView={handleRenameView}
          onDeleteView={handleDeleteView}
        />
        <div
          style={{
            ...styles.searchWrap,
            ...(searchFocused ? { borderColor: C.accent, boxShadow: `0 0 0 2px ${C.accent}33` } : {}),
          }}
        >
          <span style={styles.searchIcon}>&#x1f50d;</span>
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            style={styles.searchInput}
          />
          {search && (
            <span
              style={{ fontSize: 14, color: C.darkMuted, cursor: "pointer", padding: "0 2px" }}
              onClick={() => setSearch("")}
            >
              &#x2715;
            </span>
          )}
        </div>

        {filterableFields.map((field) => (
          <select
            key={field.name}
            style={styles.filterSelect}
            value={filters[field.name] || ""}
            onChange={(e) => handleFilterChange(field.name, e.target.value)}
          >
            <option value="">{field.name}: All</option>
            {field.options.map((opt) => (
              <option key={opt.name} value={opt.name}>{opt.name}</option>
            ))}
          </select>
        ))}

        {/* Column visibility toggle */}
        <div ref={colMenuRef} style={{ position: "relative" }}>
          <button
            style={{
              ...styles.refreshBtn,
              ...(hiddenColumns.size > 0 ? { borderColor: C.accent, color: C.accent } : {}),
            }}
            onClick={() => setColMenuOpen((o) => !o)}
            title="Toggle columns"
          >
            <IconEyeOff size={14} color={hiddenColumns.size > 0 ? C.accent : C.darkMuted} />
          </button>
          {colMenuOpen && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 4,
                background: C.darkSurf,
                border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.lg,
                boxShadow: SHADOW.dropdown,
                padding: "6px 0",
                zIndex: 20,
                minWidth: 180,
                maxHeight: 280,
                overflowY: "auto",
              }}
            >
              {allColumns.map((col) => {
                const visible = !hiddenColumns.has(col);
                return (
                  <div
                    key={col}
                    onClick={() => toggleColumn(col)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 12px",
                      cursor: "pointer",
                      fontSize: 12,
                      fontFamily: FONT,
                      color: visible ? C.darkText : C.darkMuted,
                      transition: "background 0.12s",
                    }}
                    {...hoverBg()}
                  >
                    <span style={{
                      width: 14,
                      height: 14,
                      borderRadius: RADIUS.sm,
                      border: `2px solid ${visible ? C.accent : C.darkBorder}`,
                      background: visible ? C.accent : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      color: "#fff",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}>
                      {visible ? "\u2713" : ""}
                    </span>
                    {col}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Add Row — scrolls to ghost row */}
        {onCreate && targetDatabaseId && (
          <button
            style={styles.refreshBtn}
            onClick={() => {
              if (scrollAreaRef.current) {
                scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
              }
              const titleField = schema?.title?.name;
              if (titleField) {
                const colIdx = columns.indexOf(titleField);
                setFocusedCell({ row: processedData.length, col: colIdx >= 0 ? colIdx : 0 });
              }
            }}
            title="Add new row"
          >
            <IconPlus size={14} color={C.darkMuted} />
          </button>
        )}

        {/* CSV Export */}
        <button
          style={styles.refreshBtn}
          onClick={handleExport}
          title="Export CSV"
        >
          <IconExport size={14} color={C.darkMuted} />
        </button>

        {onRefresh && (
          <button
            style={styles.refreshBtn}
            onClick={onRefresh}
            title="Refresh data"
            onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; e.currentTarget.style.color = C.darkText; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf2; e.currentTarget.style.color = C.darkMuted; }}
          >
            &#x21bb;
          </button>
        )}

        <div style={{ flex: 1 }} />
        {collab?.activeUsers?.size > 0 && (
          <PresenceAvatars users={[...collab.activeUsers.values()]} size={24} />
        )}
        <span style={styles.countLabel}>
          {processedData.length === data.length
            ? `${data.length} record${data.length !== 1 ? "s" : ""}`
            : `${processedData.length} of ${data.length}`}
        </span>
      </div>

      {/* Table area */}
      <div
        ref={scrollAreaRef}
        style={styles.scrollArea}
        onScroll={(e) => {
          if (scrollRAF.current) cancelAnimationFrame(scrollRAF.current);
          const target = e.target;
          scrollRAF.current = requestAnimationFrame(() => {
            const st = target.scrollTop;
            scrollTopRef.current = st;
            const totalRows = processedData.length;
            const newStart = Math.min(totalRows, Math.max(0, Math.floor(st / ROW_HEIGHT) - VIRT_BUFFER));
            const newEnd = Math.min(totalRows, Math.ceil((st + containerHeight) / ROW_HEIGHT) + VIRT_BUFFER);
            setVisibleRange(prev =>
              prev.start === newStart && prev.end === newEnd ? prev : { start: newStart, end: newEnd }
            );
          });
        }}
      >
        {showNoResults ? (
          <div style={styles.empty}>
            <div style={styles.emptyTitle}>No matching records</div>
            <div style={styles.emptySub}>
              Try adjusting your search or filters to find what you are looking for.
            </div>
            <button
              style={{ ...S.btnGhost, marginTop: 8 }}
              onClick={() => { setSearch(""); setFilters({}); }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          (() => {
            const gtc = `52px ${columns.map(col => `${colWidths[col] || (col === OWNER_COL_NAME ? OWNER_COL_WIDTH : 120)}px`).join(" ")} 56px 40px${canEditSchema ? " 44px" : ""}`;
            const totalTableWidth = 52 + columns.reduce((sum, col) => sum + (colWidths[col] || (col === OWNER_COL_NAME ? OWNER_COL_WIDTH : 120)), 0) + 40 + (canEditSchema ? 44 : 0);

            return (
              <div style={{ minWidth: totalTableWidth }}>
                {/* ── Sticky Header ── */}
                <div style={{ ...styles.gridHeader, gridTemplateColumns: gtc }}>
                  {/* Select-all checkbox */}
                  <div
                    style={{ ...styles.gridHeaderCell, padding: "10px 8px", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}
                    onClick={toggleAllRows}
                  >
                    <span style={styles.toggle(selectedRows.size === processedData.length && processedData.length > 0)}>
                      {selectedRows.size === processedData.length && processedData.length > 0 ? "\u2713" : ""}
                    </span>
                  </div>
                  {columns.map((col) => {
                    if (col === OWNER_COL_NAME && showOwnerColumn) {
                      return (
                        <div key={col} style={{ ...styles.gridHeaderCell, position: "relative" }}>
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ marginRight: 5, opacity: 0.55, verticalAlign: "middle" }}>
                            <circle cx="8" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                            <path d="M2 14.5c0-3 2.7-5 6-5s6 2 6 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                          </svg>
                          Owner
                        </div>
                      );
                    }
                    const isActive = sortField === col;
                    const isDragOver = colDrag?.overCol === col;
                    return (
                      <div
                        key={col}
                        data-col-header={col}
                        style={{
                          ...styles.gridHeaderCell,
                          ...(isActive ? styles.gridHeaderCellActive : {}),
                          ...(isDragOver ? { borderLeft: `2px solid ${C.accent}` } : {}),
                          cursor: colDrag ? "grabbing" : "pointer",
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          const rect = e.currentTarget.getBoundingClientRect();
                          const menuW = 180;
                          const x = Math.min(rect.left, window.innerWidth - menuW);
                          setColCtxMenu({ col, x, y: rect.bottom + 2 });
                        }}
                        onContextMenu={(e) => handleColRightClick(col, e)}
                        onMouseDown={(e) => { if (e.button === 0 && !e.target.closest("[data-resize]")) handleColDragStart(col, e); }}
                      >
                        {renamingCol === col ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRenameCol(col, renameValue);
                              if (e.key === "Escape") setRenamingCol(null);
                              e.stopPropagation();
                            }}
                            onBlur={() => handleRenameCol(col, renameValue)}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              width: "100%", border: `1px solid ${C.accent}`, borderRadius: RADIUS.sm,
                              background: C.darkSurf2, color: C.darkText, fontFamily: FONT, fontSize: 11,
                              padding: "2px 6px", outline: "none", fontWeight: 600, textTransform: "uppercase",
                              letterSpacing: "0.06em",
                            }}
                          />
                        ) : (
                          <>
                            {(() => {
                              const ti = getTypeIcon(schema, col);
                              if (!ti) return null;
                              return ti.Icon ? (
                                <span style={{ marginRight: 5, opacity: 0.55, verticalAlign: "middle", display: "inline-flex" }} title={getFieldType(schema, col)}><ti.Icon size={11} color="currentColor" /></span>
                              ) : ti.text ? (
                                <span style={{ marginRight: 5, fontSize: 10, opacity: 0.55, verticalAlign: "middle", fontWeight: 600 }} title={getFieldType(schema, col)}>{ti.text}</span>
                              ) : null;
                            })()}
                            {col}
                            {isActive && sortDir && (
                              <span style={styles.sortArrow}>
                                {sortDir === "asc" ? "\u25B2" : "\u25BC"}
                              </span>
                            )}
                          </>
                        )}
                        {/* Resize handle */}
                        <span
                          data-resize="true"
                          style={{
                            position: "absolute", right: 0, top: 0, bottom: 0, width: 5,
                            cursor: "col-resize", background: "transparent", zIndex: 3,
                          }}
                          onMouseDown={(e) => handleResizeStart(col, e)}
                          onMouseEnter={(e) => { e.currentTarget.style.background = C.accent + "44"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        />
                      </div>
                    );
                  })}
                  {/* Badge column header */}
                  <div style={{ ...styles.gridHeaderCell, padding: "10px 2px" }} />
                  {/* Neuron column header */}
                  <div style={{ ...styles.gridHeaderCell, padding: "10px 4px" }} />
                  {/* Add column button */}
                  {canEditSchema && (
                    <div style={{ ...styles.gridHeaderCell, textAlign: "center", padding: "10px 8px", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                      {addColOpen ? (
                        <div
                          style={{
                            position: "absolute", top: "100%", right: 0, zIndex: 100,
                            background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
                            borderRadius: RADIUS.lg, padding: 14, width: 240,
                            boxShadow: SHADOW.dropdown, display: "flex", flexDirection: "column", gap: 10,
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <div style={{ fontSize: 11, fontWeight: 600, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            New Column
                          </div>
                          <input
                            autoFocus
                            placeholder="Column name..."
                            value={addColName}
                            onChange={(e) => setAddColName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleAddCol(); if (e.key === "Escape") setAddColOpen(false); }}
                            style={{
                              border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.sm,
                              background: C.darkSurf2, color: C.darkText, fontFamily: FONT, fontSize: 13,
                              padding: "7px 10px", outline: "none", width: "100%", boxSizing: "border-box",
                            }}
                          />
                          <div style={{ fontSize: 10, fontWeight: 600, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            Column Type
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                            {COLUMN_TYPES.map((t) => {
                              const isSelected = addColType === t.value;
                              return (
                                <div
                                  key={t.value}
                                  style={{
                                    display: "flex", alignItems: "center", gap: 6,
                                    padding: "5px 8px", borderRadius: RADIUS.sm,
                                    cursor: "pointer", fontSize: 12, fontFamily: FONT,
                                    transition: "background 0.1s",
                                    color: isSelected ? C.accent : C.darkText,
                                    background: isSelected ? `${C.accent}15` : "transparent",
                                    fontWeight: isSelected ? 600 : 400,
                                  }}
                                  onClick={() => setAddColType(t.value)}
                                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = C.darkSurf2; }}
                                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = isSelected ? `${C.accent}15` : "transparent"; }}
                                >
                                  <span style={{ width: 16, textAlign: "center", fontSize: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    {t.Icon ? <t.Icon size={13} color={isSelected ? C.accent : C.darkMuted} /> : <span style={{ fontWeight: 600, color: isSelected ? C.accent : C.darkMuted }}>{t.text}</span>}
                                  </span>
                                  <span>{t.label}</span>
                                </div>
                              );
                            })}
                          </div>
                          {addColType === "relation" && isNotionTable && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 2 }}>
                              <div style={{ fontSize: 10, fontWeight: 600, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                Target Database
                              </div>
                              <input
                                placeholder="Search databases..."
                                value={dbSearchQuery}
                                onChange={(e) => {
                                  setDbSearchQuery(e.target.value);
                                  searchRelationDbs(e.target.value);
                                }}
                                onFocus={() => { if (!dbSearchResults.length) searchRelationDbs(""); }}
                                style={inputFieldStyle}
                              />
                              <div style={{ maxHeight: 120, overflowY: "auto" }}>
                                {dbSearchResults.map((db) => (
                                  <div
                                    key={db.id}
                                    onClick={() => setAddColRelationDb(db)}
                                    style={{
                                      padding: "5px 8px", fontSize: 12, cursor: "pointer",
                                      borderRadius: RADIUS.sm, fontFamily: FONT,
                                      color: addColRelationDb?.id === db.id ? C.accent : C.darkText,
                                      background: addColRelationDb?.id === db.id ? `${C.accent}15` : "transparent",
                                      transition: "background 0.1s",
                                    }}
                                    onMouseEnter={(e) => { if (addColRelationDb?.id !== db.id) e.currentTarget.style.background = C.darkSurf2; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = addColRelationDb?.id === db.id ? `${C.accent}15` : "transparent"; }}
                                  >
                                    {db.title}
                                  </div>
                                ))}
                                {dbSearching && <div style={{ padding: 6, fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>Searching...</div>}
                                {!dbSearching && dbSearchResults.length === 0 && dbSearchQuery && (
                                  <div style={{ padding: 6, fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>No databases found</div>
                                )}
                              </div>
                              {addColRelationDb && (
                                <>
                                  <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>
                                    Selected: <span style={{ color: C.accent }}>{addColRelationDb.title}</span>
                                  </div>
                                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontFamily: FONT, color: C.darkText, cursor: "pointer" }}>
                                    <input
                                      type="checkbox"
                                      checked={addColSynced}
                                      onChange={(e) => setAddColSynced(e.target.checked)}
                                      style={{ accentColor: C.accent }}
                                    />
                                    Two-way relation
                                  </label>
                                  {addColSynced && (
                                    <input
                                      placeholder="Backlink column name..."
                                      value={addColSyncedName}
                                      onChange={(e) => setAddColSyncedName(e.target.value)}
                                      style={inputFieldStyle}
                                    />
                                  )}
                                </>
                              )}
                            </div>
                          )}
                          {(() => {
                            const canAdd = addColName.trim() && !(addColType === "relation" && (!addColRelationDb || (addColSynced && !addColSyncedName.trim())));
                            return (
                              <button
                                onClick={handleAddCol}
                                disabled={!canAdd}
                                style={{
                                  background: C.accent, color: "#fff", border: "none", borderRadius: RADIUS.sm,
                                  padding: "7px 14px", fontSize: 12, fontFamily: FONT, fontWeight: 600,
                                  cursor: canAdd ? "pointer" : "default",
                                  opacity: canAdd ? 1 : 0.4, transition: "opacity 0.15s", marginTop: 2,
                                }}
                              >Add Column</button>
                            );
                          })()}
                        </div>
                      ) : (
                        <div
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "center",
                            width: 26, height: 26, borderRadius: RADIUS.pill,
                            border: `1px dashed ${C.darkBorder}`,
                            cursor: "pointer", transition: "all 0.15s",
                            color: C.darkMuted, opacity: 0.65,
                          }}
                          onClick={(e) => { e.stopPropagation(); setAddColOpen(true); }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = "1";
                            e.currentTarget.style.borderColor = C.accent;
                            e.currentTarget.style.color = C.accent;
                            e.currentTarget.style.background = `${C.accent}10`;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = "0.65";
                            e.currentTarget.style.borderColor = C.darkBorder;
                            e.currentTarget.style.color = C.darkMuted;
                            e.currentTarget.style.background = "transparent";
                          }}
                          title="Add column"
                        >
                          <IconPlus size={13} />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Virtualized Card Rows ── */}
                <div style={{ padding: "4px 8px" }}>
                  {(() => {
                    const totalRows = processedData.length;
                    const visibleStart = visibleRange.start;
                    const visibleEnd = Math.min(totalRows, visibleRange.end);
                    const visibleRows = processedData.slice(visibleStart, visibleEnd);
                    const cardHeight = ROW_HEIGHT + 4; // row + marginBottom

                    return (
                      <>
                        {/* Top spacer */}
                        <div style={{ height: visibleStart * cardHeight }} />
                        {visibleRows.map((page, localIdx) => {
                          const pageId = page.id;
                          const isHovered = hoveredRow === pageId;
                          const isSelected = selectedRows.has(pageId);

                          const cardBg = isSelected ? C.accent + "10" : isHovered ? C.darkSurf2 : C.darkSurf;
                          const othersOnRow = collab?.getUsersOnRecord?.(pageId) || [];
                          const presenceColor = othersOnRow.length > 0 ? othersOnRow[0].color : null;
                          const presenceBorder = othersOnRow.length > 1
                            ? { borderLeft: "3px solid", borderImage: `linear-gradient(to bottom, ${othersOnRow.map((u) => u.color).join(", ")}) 1` }
                            : presenceColor ? { borderLeft: `3px solid ${presenceColor}` } : {};

                          return (
                            <div
                              key={pageId}
                              data-neuron-node={`row:${pageId}`}
                              style={{
                                ...styles.gridRow,
                                gridTemplateColumns: gtc,
                                height: ROW_HEIGHT,
                                background: cardBg,
                                ...(isHovered ? { boxShadow: `0 1px 4px rgba(0,0,0,0.08)` } : {}),
                                ...presenceBorder,
                                animation: ANIM.scrollReveal(localIdx),
                              }}
                              onMouseEnter={() => setHoveredRow(pageId)}
                              onMouseLeave={() => setHoveredRow(null)}
                              onClick={(e) => {
                                if ((e.metaKey || e.ctrlKey) && isNeuronsMode()) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  dispatchNeuronSelect({ node_type: "row", node_id: pageId, node_label: getPageTitle(page) || "Untitled" });
                                  return;
                                }
                                setDetailPage(page);
                              }}
                            >
                              {/* Checkbox cell */}
                              <div style={{ ...styles.gridCell, justifyContent: "center", padding: 0 }}>
                                <span
                                  style={styles.toggle(isSelected)}
                                  onClick={(e) => { e.stopPropagation(); toggleRow(pageId); }}
                                >
                                  {isSelected ? "\u2713" : ""}
                                </span>
                              </div>
                              {/* Data cells */}
                              {columns.map((col) => {
                                if (col === OWNER_COL_NAME && showOwnerColumn) {
                                  const ownerIds = page._ownerUserIds || [];
                                  return (
                                    <div
                                      key={col}
                                      style={{ ...styles.gridCell, padding: "4px 8px" }}
                                    >
                                      <OwnerCellDisplay
                                        ownerIds={ownerIds}
                                        users={teamUsers}
                                      />
                                    </div>
                                  );
                                }
                                const type = getFieldType(schema, col);
                                const value = readField(page, col);
                                const cellKey = `${pageId}:${col}`;
                                const linkData = resolvedLinks.get(cellKey);

                                const cellTyping = othersOnRow.find((u) => u.isTyping && u.typingField === col);
                                return (
                                  <div key={col} style={{
                                    ...styles.gridCell, padding: "4px 8px",
                                    ...(cellTyping ? { boxShadow: `inset 0 -2px 0 ${cellTyping.color}` } : {}),
                                  }}>
                                    <CellDisplay
                                      value={value}
                                      type={type}
                                      fieldName={col}
                                      schema={schema}
                                      colorMapping={config.colorMapping}
                                      relationTitles={relationTitles}
                                      linkInfo={linkData ? { sourceName: linkData.link?.name, stale: linkData.stale } : undefined}
                                      linkedValue={linkData?.value}
                                      onLinkClick={linkData ? () => removeLink(linkData.link.id) : undefined}
                                    />
                                  </div>
                                );
                              })}
                              {/* Record badge cell (comments, files, notes) */}
                              <div style={{ ...styles.gridCell, justifyContent: "center", padding: "4px 2px", gap: 3, display: "flex", alignItems: "center" }}>
                                {badgeCounts[pageId]?.comments > 0 && (
                                  <span title={`${badgeCounts[pageId].comments} comment${badgeCounts[pageId].comments !== 1 ? "s" : ""}`} style={{ fontSize: 10, color: C.darkMuted, display: "flex", alignItems: "center", gap: 2 }}>
                                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v8H5l-3 3V3z" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
                                    {badgeCounts[pageId].comments}
                                  </span>
                                )}
                                {badgeCounts[pageId]?.files > 0 && (
                                  <span title={`${badgeCounts[pageId].files} file${badgeCounts[pageId].files !== 1 ? "s" : ""}`} style={{ fontSize: 10, color: C.darkMuted, display: "flex", alignItems: "center", gap: 2 }}>
                                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8.5 1.5l4 4v8a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1h4z" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
                                    {badgeCounts[pageId].files}
                                  </span>
                                )}
                                {badgeCounts[pageId]?.notes && (
                                  <span title="Has notes" style={{ width: 5, height: 5, borderRadius: "50%", background: C.accent, flexShrink: 0 }} />
                                )}
                              </div>
                              {/* Neuron badge cell — inline */}
                              <div style={{ ...styles.gridCell, justifyContent: "center", padding: "4px 2px" }}>
                                <NeuronBadge nodeId={pageId} />
                              </div>
                            </div>
                          );
                        })}
                        {/* Bottom spacer */}
                        <div style={{ height: Math.max(0, (totalRows - visibleEnd) * cardHeight) }} />
                      </>
                    );
                  })()}

                  {/* Ghost row — new record creation */}
                  {onCreate && targetDatabaseId && (
                    <div
                      style={{
                        ...styles.gridRow,
                        gridTemplateColumns: gtc,
                        height: ROW_HEIGHT,
                        opacity: ghostSaving ? 0.5 : 0.6,
                        transition: "opacity 0.15s",
                        cursor: "default",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                      onMouseLeave={(e) => { if (!ghostActive.current) e.currentTarget.style.opacity = "0.6"; }}
                    >
                      <div style={{ ...styles.gridCell, justifyContent: "center", padding: "4px 4px" }}>
                        <IconPlus size={10} color={C.darkMuted} />
                      </div>
                      {columns.map((col) => {
                        const type = getFieldType(schema, col);
                        const isEditable = EDITABLE_TYPES.has(type);
                        return (
                          <div key={col} style={{ ...styles.gridCell, padding: "2px 6px" }}>
                            {!isEditable ? (
                              <span style={{ color: C.darkMuted, fontSize: 11, fontStyle: "italic" }}>--</span>
                            ) : renderGhostCell(col, type)}
                          </div>
                        );
                      })}
                      <div style={{ ...styles.gridCell, padding: "4px 2px" }} /> {/* badge column spacer */}
                      <div style={{ ...styles.gridCell, padding: "4px 2px" }} /> {/* neuron column spacer */}
                    </div>
                  )}
                  {ghostError && (
                    <div style={{ padding: "4px 12px", fontSize: 11, color: "#E05252" }}>
                      {ghostError}
                    </div>
                  )}
                </div>

                {/* ── Sticky Footer (Totals) ── */}
                <div style={{ ...styles.gridFooter, gridTemplateColumns: gtc }}>
                  <div style={{ padding: "4px 8px" }} />
                  {columns.map((col) => {
                    const type = getFieldType(schema, col);
                    let total = null;
                    if (type === "number") {
                      total = 0;
                      for (const page of processedData) {
                        const v = readField(page, col);
                        if (typeof v === "number") total += v;
                      }
                    }
                    return (
                      <div
                        key={col}
                        style={{
                          padding: "4px 12px",
                          fontWeight: 600,
                          fontSize: 12,
                          fontVariantNumeric: "tabular-nums",
                          color: total !== null ? C.darkText : "transparent",
                        }}
                      >
                        {total !== null ? total.toLocaleString() : ""}
                      </div>
                    );
                  })}
                  <div style={{ padding: "4px 2px" }} />
                </div>
              </div>
            );
          })()
        )}
      </div>

      {/* Record Detail Panel */}
      {detailPage && (
        <RecordDetail
          page={detailPage}
          schema={schema}
          onClose={() => setDetailPage(null)}
          onUpdate={async (pageId, properties) => {
            if (!onUpdate) throw new Error("Updates not available");
            for (const [fieldName, payload] of Object.entries(properties)) {
              await onUpdate(pageId, fieldName, payload);
            }
          }}
          onDelete={onDelete ? (ids) => { onDelete(ids); setDetailPage(null); } : undefined}
          pageConfigId={pageConfig?.id}
          resolvedLinks={resolvedLinks}
          onLinkField={(fieldName, fieldType) => setLinkPickerCell({ pageId: detailPage.id, field: fieldName, fieldType })}
          onUnlinkField={(linkId) => {
            removeLink(linkId);
            resolveLinksForView(pageConfig?.id, viewIdx).then(setResolvedLinks).catch(() => {});
          }}
          onRefresh={onRefresh}
        />
      )}

      {/* Cell Link Picker */}
      {/* Column Context Menu (portal to escape overflow:hidden + transform ancestors) */}
      {colCtxMenu && createPortal(
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 299 }} onMouseDown={() => setColCtxMenu(null)} />
          <div
            style={{
              position: "fixed", left: colCtxMenu.x, top: colCtxMenu.y, zIndex: 300,
              background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.lg, padding: 4, minWidth: 160,
              boxShadow: SHADOW.dropdown, fontFamily: FONT,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={ctxItem} onClick={() => { setSortField(colCtxMenu.col); setSortDir("asc"); setColCtxMenu(null); }} {...hoverBg()}>{"\u25B2"} Sort Ascending</div>
            <div style={ctxItem} onClick={() => { setSortField(colCtxMenu.col); setSortDir("desc"); setColCtxMenu(null); }} {...hoverBg()}>{"\u25BC"} Sort Descending</div>
            <div style={{ borderTop: `1px solid ${C.edgeLine}`, margin: "2px 0" }} />
            <div style={ctxItem} onClick={() => handleHideCol(colCtxMenu.col)} {...hoverBg()}>{"\uD83D\uDC41\uFE0F"} Hide Column</div>
            {canEditSchema && (
              <div style={ctxItem} onClick={() => { setRenamingCol(colCtxMenu.col); setRenameValue(colCtxMenu.col); setColCtxMenu(null); }} {...hoverBg()}>{"\u270F\uFE0F"} Rename</div>
            )}
            {/* Type Change (D1 only — Notion type changes are restricted) */}
            {isD1Table && (
              <>
                <div style={{ borderTop: `1px solid ${C.edgeLine}`, margin: "2px 0" }} />
                <div style={{ padding: "4px 10px", fontSize: 10, color: C.darkMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Change Type
                </div>
                {COLUMN_TYPES.map((t) => {
                  const currentType = getFieldType(schema, colCtxMenu.col);
                  const isCurrentType = currentType === t.value || currentType === mapD1TypeForUI(t.value);
                  return (
                    <div
                      key={t.value}
                      style={{
                        ...ctxItem,
                        display: "flex", alignItems: "center", gap: 8,
                        color: isCurrentType ? C.accent : C.darkText,
                        background: isCurrentType ? `${C.accent}10` : "transparent",
                        fontWeight: isCurrentType ? 600 : 400,
                      }}
                      onClick={() => handleChangeColType(colCtxMenu.col, t.value)}
                      onMouseEnter={(e) => { e.currentTarget.style.background = isCurrentType ? `${C.accent}18` : C.darkSurf2; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = isCurrentType ? `${C.accent}10` : "transparent"; }}
                    >
                      <span style={{ width: 20, textAlign: "center", fontSize: 13, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {t.Icon ? <t.Icon size={14} color={isCurrentType ? C.accent : C.darkMuted} /> : <span style={{ fontWeight: 600, color: isCurrentType ? C.accent : C.darkMuted }}>{t.text}</span>}
                      </span>
                      <span style={{ flex: 1 }}>{t.label}</span>
                      {isCurrentType && <span style={{ fontSize: 11, opacity: 0.7 }}>{"\u2713"}</span>}
                    </div>
                  );
                })}
              </>
            )}
            {/* Delete (D1 + Notion) */}
            {canEditSchema && (
              <>
                <div style={{ borderTop: `1px solid ${C.edgeLine}`, margin: "2px 0" }} />
                <div style={{ ...ctxItem, color: "#FF6B3D" }} onClick={() => { if (confirm(`Delete column "${colCtxMenu.col}"?`)) handleDeleteCol(colCtxMenu.col); }} {...hoverBg("#FF6B3D10")}>{"\uD83D\uDDD1"} Delete Column</div>
              </>
            )}
          </div>
        </>,
        document.body
      )}

      {linkPickerCell && (
        <LinkPicker
          targetFieldType={linkPickerCell.fieldType}
          onCancel={() => setLinkPickerCell(null)}
          onSelect={async (selection) => {
            const { sourceRef, sourcePageId, sourceViewIdx, sourceName, sourceIsReadOnly, previewValue, sourceFieldType } = selection;
            const targetRef = { type: "notion", pageId: linkPickerCell.pageId, field: linkPickerCell.field };
            await createLink({
              name: sourceName,
              sourcePage: sourcePageId,
              sourceView: sourceViewIdx,
              sourceRef,
              targetPage: pageConfig?.id || "",
              targetView: viewIdx,
              targetRef,
              direction: "one_way",
              sourceFieldType: sourceFieldType || "",
              targetFieldType: linkPickerCell.fieldType || "",
            });
            // Refresh resolved links
            resolveLinksForView(pageConfig?.id, viewIdx)
              .then(setResolvedLinks)
              .catch(() => {});
            setLinkPickerCell(null);
          }}
        />
      )}
    </div>
  );
}
