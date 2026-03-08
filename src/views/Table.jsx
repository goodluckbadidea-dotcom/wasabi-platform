// ─── Wasabi Table View ───
// Schema-agnostic, filterable, sortable, inline-editable data table.
// The primary view for any Notion database.

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { C, FONT, RADIUS, SHADOW, getStatusColor, getSolidPillColor } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { ANIM, injectAnimations } from "../design/animations.js";
import { readProp, buildProp, extractProperties, getPageTitle } from "../notion/properties.js";
import { debounce, formatDate, truncate } from "../utils/helpers.js";
import { IconTrash, IconExport, IconEyeOff, IconExpand, IconPlus, IconConnect } from "../design/icons.jsx";
import FilterChips, { applyChipFilters } from "./FilterChips.jsx";
import RecordDetail from "./RecordDetail.jsx";
import { useLinks } from "../context/LinksContext.jsx";
import LinkPicker from "../core/LinkPicker.jsx";

// ─── Constants ───

const EDITABLE_TYPES = new Set([
  "title", "rich_text", "number", "select", "status",
  "date", "checkbox", "url", "email", "phone_number",
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
    borderRadius: RADIUS.md,
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
    borderRadius: RADIUS.md,
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
    borderRadius: RADIUS.md,
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
    background: C.darkSurf,
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
    tableLayout: "auto",
  },

  th: {
    textAlign: "left",
    padding: "10px 12px",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: C.darkMuted,
    borderBottom: `2px solid ${C.darkBorder}`,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
    position: "sticky",
    top: 0,
    background: C.darkSurf,
    zIndex: 2,
    transition: "color 0.15s",
  },

  thActive: {
    color: C.darkText,
  },

  td: {
    padding: "8px 12px",
    borderBottom: `1px solid ${C.edgeLine}`,
    color: C.darkText,
    verticalAlign: "middle",
    fontSize: 13,
    lineHeight: 1.45,
    maxWidth: 280,
  },

  row: {
    transition: "background 0.12s",
    cursor: "default",
  },

  rowHover: {
    background: `${C.darkSurf2}88`,
  },

  // Inline editing
  cellInput: {
    width: "100%",
    border: `1px solid ${C.accent}`,
    borderRadius: RADIUS.sm,
    padding: "4px 8px",
    fontSize: 13,
    fontFamily: FONT,
    color: C.darkText,
    background: C.darkSurf,
    outline: "none",
    boxShadow: `0 0 0 2px ${C.accent}33`,
    boxSizing: "border-box",
  },

  cellSelect: {
    width: "100%",
    border: `1px solid ${C.accent}`,
    borderRadius: RADIUS.sm,
    padding: "4px 8px",
    fontSize: 13,
    fontFamily: FONT,
    color: C.darkText,
    background: C.darkSurf,
    outline: "none",
    cursor: "pointer",
    appearance: "none",
    boxShadow: `0 0 0 2px ${C.accent}33`,
    boxSizing: "border-box",
  },

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

// ─── Helpers ───

/** Resolve column list from schema when not provided in config */
function resolveColumns(schema, configColumns, fieldMappings) {
  if (configColumns && configColumns.length > 0) return configColumns;
  if (!schema) return [];

  // Build column list from schema, title first
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

  // Add system fields last
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

function CellEditor({ value, type, options, onCommit, onCancel }) {
  const inputRef = useRef(null);
  const [draft, setDraft] = useState(() => {
    if (type === "date" && value && typeof value === "object") return value.start || "";
    if (type === "date" && typeof value === "string") return value;
    if (type === "checkbox") return !!value;
    if (value === null || value === undefined) return "";
    return String(value);
  });

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current.select) inputRef.current.select();
    }
  }, []);

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
  }, [draft, commit, onCancel]);

  // Checkbox is always a direct toggle, no editor needed (handled in-cell)
  if (type === "checkbox") return null;

  if (type === "select" || type === "status") {
    return (
      <select
        ref={inputRef}
        style={styles.cellSelect}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onCommit(e.target.value || null);
        }}
        onBlur={() => onCancel()}
        onKeyDown={handleKeyDown}
      >
        <option value="">-- none --</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }

  if (type === "date") {
    return (
      <input
        ref={inputRef}
        type="date"
        style={styles.cellInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={handleKeyDown}
      />
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

function CellDisplay({ value, type, fieldName, schema, onClick }) {
  if (value === null || value === undefined || value === "") {
    return (
      <span
        style={{ color: C.darkMuted, fontSize: 12, fontStyle: "italic", cursor: onClick ? "pointer" : "default" }}
        onClick={onClick}
      >
        --
      </span>
    );
  }

  // Select / Status pill — solid fill with Wasabi colors
  if (type === "select" || type === "status") {
    const optionNames = getOptionNames(schema, fieldName);
    const schemaOptions = getFieldOptions(schema, fieldName);
    const { fill, text } = getSolidPillColor(value, optionNames, schemaOptions);
    return (
      <span style={styles.pill(fill, text)} onClick={onClick}>
        {value}
      </span>
    );
  }

  // Multi-select pills — solid fill
  if (type === "multi_select" && Array.isArray(value)) {
    const optionNames = getOptionNames(schema, fieldName);
    const schemaOptions = getFieldOptions(schema, fieldName);
    return (
      <span style={styles.multiPillWrap}>
        {value.map((v, i) => {
          const { fill, text } = getSolidPillColor(v, optionNames, schemaOptions);
          return <span key={i} style={styles.pill(fill, text)}>{v}</span>;
        })}
      </span>
    );
  }

  // Checkbox toggle
  if (type === "checkbox") {
    return (
      <span style={styles.toggle(!!value)} onClick={onClick}>
        {value ? "\u2713" : ""}
      </span>
    );
  }

  // Date
  if (type === "date") {
    const dateStr = typeof value === "object" ? value.start : value;
    return (
      <span style={{ cursor: onClick ? "pointer" : "default" }} onClick={onClick}>
        {formatDate(dateStr, { short: true })}
      </span>
    );
  }

  // URL (clickable link)
  if (type === "url" && value) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: C.accent, textDecoration: "none", fontSize: 13 }}
        onClick={(e) => e.stopPropagation()}
      >
        {truncate(String(value), 40)}
      </a>
    );
  }

  // People
  if (type === "people" && Array.isArray(value)) {
    return (
      <span style={{ fontSize: 13 }}>
        {value.map((p) => p.name || p.email || "?").join(", ")}
      </span>
    );
  }

  // Files
  if (type === "files" && Array.isArray(value)) {
    return (
      <span style={{ fontSize: 13, color: C.darkMuted }}>
        {value.map((f) => f.name).join(", ") || "--"}
      </span>
    );
  }

  // Relation
  if (type === "relation" && Array.isArray(value)) {
    return (
      <span style={{ fontSize: 12, color: C.darkMuted }}>
        {value.length} linked
      </span>
    );
  }

  // Number
  if (type === "number") {
    return (
      <span style={{ cursor: onClick ? "pointer" : "default", fontVariantNumeric: "tabular-nums" }} onClick={onClick}>
        {value}
      </span>
    );
  }

  // Default text
  return (
    <span style={{ cursor: onClick ? "pointer" : "default" }} onClick={onClick}>
      {truncate(String(value), 120)}
    </span>
  );
}


// ─── Quick-Add Cell Input (inline per-column) ───
function QuickAddCellInput({ type, fieldName, schema, value, onChange, onSubmit, autoFocus }) {
  const baseStyle = {
    width: "100%",
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.sm,
    background: C.darkSurf2,
    color: C.darkText,
    fontFamily: FONT,
    fontSize: 12,
    padding: "5px 8px",
    outline: "none",
    transition: "border-color 0.15s",
    boxSizing: "border-box",
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
    if (e.key === "Escape") {
      e.target.blur();
    }
  };

  switch (type) {
    case "title":
    case "rich_text":
    case "url":
    case "email":
    case "phone_number":
      return (
        <input
          type="text"
          style={baseStyle}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
          placeholder={type === "title" ? "Enter title..." : fieldName}
          onFocus={(e) => { e.currentTarget.style.borderColor = C.accent; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
        />
      );

    case "number":
      return (
        <input
          type="number"
          style={{ ...baseStyle, fontVariantNumeric: "tabular-nums" }}
          value={value}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")}
          onKeyDown={handleKeyDown}
          placeholder="0"
          onFocus={(e) => { e.currentTarget.style.borderColor = C.accent; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
        />
      );

    case "select":
    case "status":
      return (
        <select
          style={{ ...baseStyle, cursor: "pointer" }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {getOptionNames(schema, fieldName).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );

    case "multi_select":
      return (
        <input
          type="text"
          style={baseStyle}
          value={Array.isArray(value) ? value.join(", ") : value}
          onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
          onKeyDown={handleKeyDown}
          placeholder="Comma-separated..."
          onFocus={(e) => { e.currentTarget.style.borderColor = C.accent; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
        />
      );

    case "date":
      return (
        <input
          type="date"
          style={{ ...baseStyle, cursor: "pointer" }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      );

    case "checkbox":
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            borderRadius: RADIUS.sm,
            border: `2px solid ${value ? C.accent : C.darkBorder}`,
            background: value ? C.accent : "transparent",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            color: "#fff",
          }}
          onClick={() => onChange(!value)}
        >
          {value ? "\u2713" : ""}
        </span>
      );

    default:
      return <span style={{ color: C.darkMuted, fontSize: 11 }}>—</span>;
  }
}

// ─── Quick-Add Form (for empty state) ───
function QuickAddForm({ schema, columns, quickAddValues, setQuickAddValues, quickAddSaving, quickAddError, onSubmit, onCancel }) {
  return (
    <div style={{
      marginTop: 16,
      padding: 16,
      background: C.darkSurf,
      border: `1px solid ${C.darkBorder}`,
      borderRadius: RADIUS.xl,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      maxWidth: 400,
      width: "100%",
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText, marginBottom: 4 }}>New Record</div>
      {columns.slice(0, 6).map((col) => {
        const type = getFieldType(schema, col);
        return (
          <div key={col} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 500, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {col}
            </label>
            <QuickAddCellInput
              type={type}
              fieldName={col}
              schema={schema}
              value={quickAddValues[col] ?? ""}
              onChange={(val) => setQuickAddValues((prev) => ({ ...prev, [col]: val }))}
              onSubmit={onSubmit}
              autoFocus={type === "title"}
            />
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button style={{ ...S.btnPrimary, padding: "6px 16px", fontSize: 12 }} onClick={onSubmit} disabled={quickAddSaving}>
          {quickAddSaving ? "Saving..." : "Add Record"}
        </button>
        <button style={{ ...S.btnGhost, padding: "6px 12px", fontSize: 12 }} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {quickAddError && <span style={{ color: "#E05252", fontSize: 11 }}>{quickAddError}</span>}
    </div>
  );
}

// ─── Main Table Component ───

export default function Table({ data = [], schema, config = {}, onUpdate, onRefresh, onCreate, onDelete, pageConfig, onSaveFilters }) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState(config.sort?.field || config.sortField || null);
  const [sortDir, setSortDir] = useState(config.sort?.direction || config.sortDir || (config.sortField ? "asc" : null)); // "asc" | "desc" | null
  const [filters, setFilters] = useState(config.filters || {}); // { fieldName: value }

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

  // ── Column Visibility ──
  const [hiddenColumns, setHiddenColumns] = useState(new Set());
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef(null);

  // ── Record Detail Panel ──
  const [detailPage, setDetailPage] = useState(null);

  // ── Quick-Add Row ──
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddValues, setQuickAddValues] = useState({});
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const [quickAddError, setQuickAddError] = useState(null);

  // ── Cell Linking ──
  const { resolveLinksForView, createLink, removeLink, getLinksForTarget } = useLinks();
  const [resolvedLinks, setResolvedLinks] = useState(new Map());
  const [linkPickerCell, setLinkPickerCell] = useState(null); // { pageId, field }
  const [hoveredCell, setHoveredCell] = useState(null); // { pageId, field }

  // Resolve linked values for this view
  const viewIdx = pageConfig?.views?.findIndex((v) => v === config) ?? 0;
  useEffect(() => {
    if (!pageConfig?.id) return;
    resolveLinksForView(pageConfig.id, viewIdx)
      .then(setResolvedLinks)
      .catch(() => {});
  }, [pageConfig?.id, viewIdx, resolveLinksForView]);
  const targetDatabaseId = config.databaseId || pageConfig?.databaseIds?.[0];

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

  // Resolve all columns from schema
  const allColumns = useMemo(
    () => resolveColumns(schema, config.columns, config.fieldMappings),
    [schema, config.columns, config.fieldMappings]
  );

  // Seed hidden columns from config.visibleFields (once, when allColumns first resolves)
  const visibleFieldsApplied = useRef(false);
  useEffect(() => {
    if (visibleFieldsApplied.current) return;
    const vf = config.visibleFields;
    if (!Array.isArray(vf) || vf.length === 0 || allColumns.length === 0) return;
    const visibleSet = new Set(vf);
    const hidden = new Set(allColumns.filter((c) => !visibleSet.has(c)));
    setHiddenColumns(hidden);
    visibleFieldsApplied.current = true;
  }, [allColumns, config.visibleFields]);

  // Visible columns (filtered by hiddenColumns)
  const columns = useMemo(
    () => allColumns.filter((c) => !hiddenColumns.has(c)),
    [allColumns, hiddenColumns]
  );

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

  // Chip filter change handler (persists)
  const handleChipFilterChange = useCallback((newFilters) => {
    setChipFilters(newFilters);
    if (onSaveFilters) onSaveFilters(newFilters);
  }, [onSaveFilters]);

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

  // Column sort handler — cycles asc -> desc -> none
  const handleSort = useCallback((field) => {
    if (sortField !== field) {
      setSortField(field);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortField(null);
      setSortDir(null);
    }
  }, [sortField, sortDir]);

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
  }, [schema, onUpdate]);

  // Checkbox direct toggle
  const handleCheckboxToggle = useCallback((pageId, field, currentValue) => {
    const newVal = !currentValue;
    const propPayload = buildProp("checkbox", newVal);
    if (propPayload !== undefined && onUpdate) {
      onUpdate(pageId, field, propPayload);
    }
  }, [onUpdate]);

  // Filter change handler
  const handleFilterChange = useCallback((field, value) => {
    setFilters((prev) => ({
      ...prev,
      [field]: value || undefined,
    }));
  }, []);

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
      return next;
    });
  }, []);

  // ── Quick-Add Handler ──
  const handleQuickAdd = useCallback(async () => {
    if (!onCreate || !targetDatabaseId) return;
    // Must have at least a title value
    const titleField = schema?.title?.name;
    if (titleField && !quickAddValues[titleField]?.toString().trim()) {
      setQuickAddError("Title is required");
      return;
    }
    setQuickAddSaving(true);
    setQuickAddError(null);
    try {
      const properties = {};
      for (const [fieldName, val] of Object.entries(quickAddValues)) {
        if (val === "" || val === null || val === undefined) continue;
        const type = getFieldType(schema, fieldName);
        if (!type) continue;
        const prop = buildProp(type, val);
        if (prop !== undefined) {
          properties[fieldName] = prop;
        }
      }
      await onCreate(targetDatabaseId, properties);
      setQuickAddValues({});
      setQuickAddError(null);
    } catch (err) {
      setQuickAddError(err.message || "Failed to create record");
    } finally {
      setQuickAddSaving(false);
    }
  }, [onCreate, targetDatabaseId, quickAddValues, schema]);

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
            This table is empty. Add records to your Notion database or adjust your filters to see data here.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {onCreate && targetDatabaseId && (
              <button
                style={{ ...S.btnPrimary, display: "flex", alignItems: "center", gap: 6 }}
                onClick={() => setQuickAddOpen(true)}
              >
                <IconPlus size={12} color="#fff" /> Create First Record
              </button>
            )}
            {onRefresh && (
              <button
                style={S.btnSecondary}
                onClick={onRefresh}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                Refresh
              </button>
            )}
          </div>
          {/* Quick-add row in empty state */}
          {quickAddOpen && onCreate && targetDatabaseId && schema && (
            <QuickAddForm
              schema={schema}
              columns={schema.allFields.filter((f) => EDITABLE_TYPES.has(f.type)).map((f) => f.name)}
              quickAddValues={quickAddValues}
              setQuickAddValues={setQuickAddValues}
              quickAddSaving={quickAddSaving}
              quickAddError={quickAddError}
              onSubmit={handleQuickAdd}
              onCancel={() => { setQuickAddOpen(false); setQuickAddValues({}); setQuickAddError(null); }}
            />
          )}
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

      {/* Toolbar: search, filters, refresh, count */}
      <div style={styles.toolbar}>
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
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
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

        {/* Add Row */}
        {onCreate && targetDatabaseId && (
          <button
            style={{
              ...styles.refreshBtn,
              ...(quickAddOpen ? { borderColor: C.accent, background: `${C.accent}18` } : {}),
            }}
            onClick={() => {
              setQuickAddOpen((o) => !o);
              if (quickAddOpen) { setQuickAddValues({}); setQuickAddError(null); }
            }}
            title={quickAddOpen ? "Close add row" : "Add new row"}
          >
            <IconPlus size={14} color={quickAddOpen ? C.accent : C.darkMuted} />
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

        <span style={styles.countLabel}>
          {processedData.length === data.length
            ? `${data.length} record${data.length !== 1 ? "s" : ""}`
            : `${processedData.length} of ${data.length}`}
        </span>
      </div>

      {/* Table area */}
      <div style={styles.scrollArea}>
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
          <table style={styles.table}>
            <thead>
              <tr>
                {/* Select-all checkbox */}
                <th
                  style={{
                    ...styles.th,
                    width: 36,
                    minWidth: 36,
                    padding: "10px 8px",
                    textAlign: "center",
                  }}
                  onClick={toggleAllRows}
                >
                  <span style={styles.toggle(selectedRows.size === processedData.length && processedData.length > 0)}>
                    {selectedRows.size === processedData.length && processedData.length > 0 ? "\u2713" : ""}
                  </span>
                </th>
                {columns.map((col) => {
                  const isActive = sortField === col;
                  return (
                    <th
                      key={col}
                      style={{
                        ...styles.th,
                        ...(isActive ? styles.thActive : {}),
                      }}
                      onClick={() => handleSort(col)}
                    >
                      {col}
                      {isActive && sortDir && (
                        <span style={styles.sortArrow}>
                          {sortDir === "asc" ? "\u25B2" : "\u25BC"}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {processedData.map((page, rowIdx) => {
                const pageId = page.id;
                const isHovered = hoveredRow === pageId;
                const isSelected = selectedRows.has(pageId);

                return (
                  <tr
                    key={pageId}
                    style={{
                      ...styles.row,
                      ...(isHovered ? styles.rowHover : {}),
                      ...(isSelected ? { background: C.accent + "10" } : {}),
                      animation: ANIM.rowReveal(rowIdx),
                    }}
                    onMouseEnter={() => setHoveredRow(pageId)}
                    onMouseLeave={() => setHoveredRow(null)}
                    onDoubleClick={() => setDetailPage(page)}
                  >
                    {/* Row checkbox + expand */}
                    <td style={{ ...styles.td, width: 52, minWidth: 52, padding: "8px 4px", textAlign: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
                        <span
                          style={styles.toggle(isSelected)}
                          onClick={() => toggleRow(pageId)}
                        >
                          {isSelected ? "\u2713" : ""}
                        </span>
                        {isHovered && (
                          <span
                            style={{ cursor: "pointer", opacity: 0.5, display: "flex", alignItems: "center", transition: "opacity 0.1s" }}
                            onClick={(e) => { e.stopPropagation(); setDetailPage(page); }}
                            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
                            title="Open record detail"
                          >
                            <IconExpand size={11} color={C.darkMuted} />
                          </span>
                        )}
                      </div>
                    </td>
                    {columns.map((col) => {
                      const type = getFieldType(schema, col);
                      const value = readField(page, col);
                      const isEditing = editCell?.pageId === pageId && editCell?.field === col;
                      const canEdit = EDITABLE_TYPES.has(type) && !!onUpdate;
                      const cellKey = `${pageId}:${col}`;
                      const isSaving = !!savingCells[cellKey];
                      const failMsg = failedCells[cellKey];
                      const linkData = resolvedLinks.get(cellKey);
                      const isHoveredCell = hoveredCell?.pageId === pageId && hoveredCell?.field === col;

                      return (
                        <td
                          key={col}
                          style={{
                            ...styles.td,
                            ...(isSaving ? { opacity: 0.55 } : {}),
                            ...(failMsg ? { background: "#E0525210" } : {}),
                          }}
                          onMouseEnter={() => setHoveredCell({ pageId, field: col })}
                          onMouseLeave={() => setHoveredCell(null)}
                        >
                          {isEditing ? (
                            <CellEditor
                              value={value}
                              type={type}
                              options={getOptionNames(schema, col)}
                              onCommit={(newVal) => handleEditCommit(pageId, col, newVal)}
                              onCancel={() => setEditCell(null)}
                            />
                          ) : (
                            <div style={{ position: "relative" }}>
                              <CellDisplay
                                value={value}
                                type={type}
                                fieldName={col}
                                schema={schema}
                                linkInfo={linkData ? { sourceName: linkData.link?.name, stale: linkData.stale } : undefined}
                                linkedValue={linkData?.value}
                                onLinkClick={linkData ? () => removeLink(linkData.link.id) : undefined}
                                onClick={
                                  type === "checkbox" && canEdit
                                    ? () => handleCheckboxToggle(pageId, col, value)
                                    : canEdit
                                      ? () => setEditCell({ pageId, field: col })
                                      : undefined
                                }
                              />
                              {/* Link icon on hover */}
                              {isHoveredCell && !isEditing && !linkData && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setLinkPickerCell({ pageId, field: col }); }}
                                  title="Link cell value"
                                  style={{
                                    position: "absolute", top: -2, right: -2,
                                    background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
                                    borderRadius: 4, padding: 2, cursor: "pointer",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    opacity: 0.6, transition: "opacity 0.12s", zIndex: 2,
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.6"; }}
                                >
                                  <IconConnect size={10} color={C.accent} />
                                </button>
                              )}
                              {failMsg && (
                                <div style={{
                                  fontSize: 10,
                                  color: "#E05252",
                                  marginTop: 2,
                                  animation: "fadeUp 0.2s ease",
                                }}>
                                  {failMsg}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {/* Quick-add row */}
              {quickAddOpen && onCreate && targetDatabaseId && (
                <>
                  <tr style={{ background: `${C.accent}08` }}>
                    <td style={{ ...styles.td, textAlign: "center", padding: "6px 8px" }}>
                      <IconPlus size={10} color={C.accent} />
                    </td>
                    {columns.map((col) => {
                      const type = getFieldType(schema, col);
                      const isEditable = EDITABLE_TYPES.has(type);
                      const titleField = schema?.title?.name;
                      return (
                        <td key={col} style={{ ...styles.td, padding: "4px 6px" }}>
                          {isEditable ? (
                            <QuickAddCellInput
                              type={type}
                              fieldName={col}
                              schema={schema}
                              value={quickAddValues[col] ?? ""}
                              onChange={(val) => setQuickAddValues((prev) => ({ ...prev, [col]: val }))}
                              onSubmit={handleQuickAdd}
                              autoFocus={col === titleField}
                            />
                          ) : (
                            <span style={{ color: C.darkMuted, fontSize: 11, fontStyle: "italic" }}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr style={{ background: `${C.accent}05` }}>
                    <td colSpan={columns.length + 1} style={{ padding: "6px 12px", borderBottom: `1px solid ${C.edgeLine}` }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button
                          style={{ ...S.btnPrimary, padding: "5px 14px", fontSize: 12 }}
                          onClick={handleQuickAdd}
                          disabled={quickAddSaving}
                        >
                          {quickAddSaving ? "Saving..." : "Add Row"}
                        </button>
                        <button
                          style={{ ...S.btnGhost, padding: "5px 10px", fontSize: 12 }}
                          onClick={() => { setQuickAddOpen(false); setQuickAddValues({}); setQuickAddError(null); }}
                        >
                          Cancel
                        </button>
                        {quickAddError && (
                          <span style={{ color: "#E05252", fontSize: 11 }}>{quickAddError}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                </>
              )}
            </tbody>
            {/* Totals row */}
            <tfoot>
              <tr>
                <td style={{
                  ...styles.td,
                  position: "sticky",
                  bottom: 0,
                  background: C.darkSurf,
                  borderTop: `2px solid ${C.darkBorder}`,
                  padding: "8px 8px",
                }}></td>
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
                    <td
                      key={col}
                      style={{
                        ...styles.td,
                        position: "sticky",
                        bottom: 0,
                        background: C.darkSurf,
                        borderTop: `2px solid ${C.darkBorder}`,
                        fontWeight: 600,
                        fontSize: 12,
                        fontVariantNumeric: "tabular-nums",
                        color: total !== null ? C.darkText : "transparent",
                      }}
                    >
                      {total !== null ? total.toLocaleString() : ""}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
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
            // Call onUpdate for each property
            for (const [fieldName, payload] of Object.entries(properties)) {
              await onUpdate(pageId, fieldName, payload);
            }
          }}
        />
      )}

      {/* Cell Link Picker */}
      {linkPickerCell && (
        <LinkPicker
          onCancel={() => setLinkPickerCell(null)}
          onSelect={async (selection) => {
            const { sourceRef, sourcePageId, sourceViewIdx, sourceName, sourceIsReadOnly, previewValue } = selection;
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
