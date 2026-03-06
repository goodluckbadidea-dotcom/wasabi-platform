// ─── Wasabi Table View ───
// Schema-agnostic, filterable, sortable, inline-editable data table.
// The primary view for any Notion database.

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { C, FONT, RADIUS, SHADOW, getStatusColor } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { ANIM, injectAnimations } from "../design/animations.js";
import { readProp, buildProp, extractProperties, getPageTitle } from "../notion/properties.js";
import { debounce, formatDate, truncate } from "../utils/helpers.js";

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
    borderBottom: `1px solid ${C.border}`,
    background: C.white,
    flexShrink: 0,
    flexWrap: "wrap",
  },

  searchWrap: {
    display: "flex",
    alignItems: "center",
    background: C.surface,
    border: `1px solid ${C.border}`,
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
    color: C.text,
    padding: "0 6px",
    height: "100%",
  },

  searchIcon: {
    fontSize: 13,
    color: C.muted,
    flexShrink: 0,
  },

  filterSelect: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
    padding: "6px 10px",
    fontSize: 12,
    fontFamily: FONT,
    color: C.textMid,
    cursor: "pointer",
    appearance: "none",
    outline: "none",
    minWidth: 110,
    height: 34,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%239A8E82'/%3E%3C/svg%3E")`,
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
    border: `1px solid ${C.border}`,
    background: C.surface,
    cursor: "pointer",
    color: C.muted,
    fontSize: 14,
    transition: "background 0.15s, color 0.15s",
    flexShrink: 0,
    fontFamily: FONT,
  },

  countLabel: {
    fontSize: 12,
    color: C.muted,
    marginLeft: "auto",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },

  scrollArea: {
    flex: 1,
    overflowY: "auto",
    overflowX: "auto",
    background: C.white,
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
    color: C.muted,
    borderBottom: `2px solid ${C.border}`,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
    position: "sticky",
    top: 0,
    background: C.white,
    zIndex: 2,
    transition: "color 0.15s",
  },

  thActive: {
    color: C.text,
  },

  td: {
    padding: "8px 12px",
    borderBottom: `1px solid ${C.border}`,
    color: C.text,
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
    background: `${C.surface}88`,
  },

  // Inline editing
  cellInput: {
    width: "100%",
    border: `1px solid ${C.accent}`,
    borderRadius: RADIUS.sm,
    padding: "4px 8px",
    fontSize: 13,
    fontFamily: FONT,
    color: C.text,
    background: C.white,
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
    color: C.text,
    background: C.white,
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
    border: `2px solid ${checked ? C.accent : C.border2}`,
    background: checked ? C.accent : "transparent",
    cursor: "pointer",
    transition: "all 0.15s",
    flexShrink: 0,
    fontSize: 11,
    color: "#fff",
    fontWeight: 700,
  }),

  // Pills
  pill: (color) => ({
    display: "inline-block",
    color: color,
    background: color + "18",
    border: `1px solid ${color}40`,
    borderRadius: RADIUS.pill,
    padding: "2px 10px",
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
    color: C.muted,
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
    color: C.textMid,
  },

  emptySub: {
    fontSize: 13,
    color: C.muted,
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
        style={{ color: C.muted, fontSize: 12, fontStyle: "italic", cursor: onClick ? "pointer" : "default" }}
        onClick={onClick}
      >
        --
      </span>
    );
  }

  // Select / Status pill
  if (type === "select" || type === "status") {
    const optionNames = getOptionNames(schema, fieldName);
    const color = getStatusColor(value, optionNames);
    return (
      <span style={styles.pill(color)} onClick={onClick}>
        {value}
      </span>
    );
  }

  // Multi-select pills
  if (type === "multi_select" && Array.isArray(value)) {
    const optionNames = getOptionNames(schema, fieldName);
    return (
      <span style={styles.multiPillWrap}>
        {value.map((v, i) => {
          const color = getStatusColor(v, optionNames);
          return <span key={i} style={styles.pill(color)}>{v}</span>;
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
      <span style={{ fontSize: 13, color: C.textMid }}>
        {value.map((f) => f.name).join(", ") || "--"}
      </span>
    );
  }

  // Relation
  if (type === "relation" && Array.isArray(value)) {
    return (
      <span style={{ fontSize: 12, color: C.muted }}>
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


// ─── Main Table Component ───

export default function Table({ data = [], schema, config = {}, onUpdate, onRefresh }) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState(config.sort?.field || null);
  const [sortDir, setSortDir] = useState(config.sort?.direction || null); // "asc" | "desc" | null
  const [filters, setFilters] = useState(config.filters || {}); // { fieldName: value }
  const [editCell, setEditCell] = useState(null); // { pageId, field }
  const [hoveredRow, setHoveredRow] = useState(null);
  const [searchFocused, setSearchFocused] = useState(false);

  // Inject animations on mount
  useEffect(() => {
    injectAnimations();
  }, []);

  // Resolve visible columns
  const columns = useMemo(
    () => resolveColumns(schema, config.columns, config.fieldMappings),
    [schema, config.columns, config.fieldMappings]
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

  // Filter + search + sort pipeline
  const processedData = useMemo(() => {
    let rows = [...data];

    // Apply filters
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
  }, [data, filters, debouncedSearch, sortField, sortDir, columns, schema]);

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

  // Inline edit commit
  const handleEditCommit = useCallback((pageId, field, value) => {
    const type = getFieldType(schema, field);
    if (!type || !onUpdate) return;
    const propPayload = buildProp(type, value);
    if (propPayload !== undefined) {
      onUpdate(pageId, field, propPayload);
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
              onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; e.currentTarget.style.color = C.text; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = C.surface; e.currentTarget.style.color = C.muted; }}
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
          {onRefresh && (
            <button
              style={{ ...S.btnSecondary, marginTop: 8 }}
              onClick={onRefresh}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.surface; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              Refresh
            </button>
          )}
        </div>
      </div>
    );
  }

  // No results after filtering
  const showNoResults = processedData.length === 0 && data.length > 0;

  return (
    <div style={styles.wrapper}>
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
              style={{ fontSize: 14, color: C.muted, cursor: "pointer", padding: "0 2px" }}
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

        {onRefresh && (
          <button
            style={styles.refreshBtn}
            onClick={onRefresh}
            title="Refresh data"
            onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; e.currentTarget.style.color = C.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.surface; e.currentTarget.style.color = C.muted; }}
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

                return (
                  <tr
                    key={pageId}
                    style={{
                      ...styles.row,
                      ...(isHovered ? styles.rowHover : {}),
                      animation: ANIM.rowReveal(rowIdx),
                    }}
                    onMouseEnter={() => setHoveredRow(pageId)}
                    onMouseLeave={() => setHoveredRow(null)}
                  >
                    {columns.map((col) => {
                      const type = getFieldType(schema, col);
                      const value = readField(page, col);
                      const isEditing = editCell?.pageId === pageId && editCell?.field === col;
                      const canEdit = EDITABLE_TYPES.has(type) && !!onUpdate;

                      return (
                        <td key={col} style={styles.td}>
                          {isEditing ? (
                            <CellEditor
                              value={value}
                              type={type}
                              options={getOptionNames(schema, col)}
                              onCommit={(newVal) => handleEditCommit(pageId, col, newVal)}
                              onCancel={() => setEditCell(null)}
                            />
                          ) : (
                            <CellDisplay
                              value={value}
                              type={type}
                              fieldName={col}
                              schema={schema}
                              onClick={
                                type === "checkbox" && canEdit
                                  ? () => handleCheckboxToggle(pageId, col, value)
                                  : canEdit
                                    ? () => setEditCell({ pageId, field: col })
                                    : undefined
                              }
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
