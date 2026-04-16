// ─── Shared View Toolbar ───
// Renders a consistent toolbar across Table, CardGrid, LinkedSheet, Calendar, Kanban.
// Each view passes only the capabilities it needs. Unused props render nothing.

import React, { useState, useRef, useEffect } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";

// ── Shared Styles ──
const TOOLBAR_HEIGHT = 34;

// Returned from function so theme switches pick up fresh C values.
function getTb() { return {
  wrapper: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    borderBottom: `1px solid ${C.edgeLine}`,
    background: C.darkSurf,
    flexShrink: 0,
    flexWrap: "wrap",
    fontFamily: FONT,
  },
  searchWrap: {
    display: "flex",
    alignItems: "center",
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.pill,
    padding: "0 10px",
    height: TOOLBAR_HEIGHT,
    minWidth: 140,
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
    height: TOOLBAR_HEIGHT,
  },
  iconBtn: {
    width: TOOLBAR_HEIGHT,
    height: TOOLBAR_HEIGHT,
    borderRadius: RADIUS.pill,
    border: `1px solid ${C.darkBorder}`,
    background: C.darkSurf2,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    color: C.darkMuted,
    transition: "background 0.15s, color 0.15s",
    flexShrink: 0,
    fontFamily: FONT,
    outline: "none",
    padding: 0,
  },
  createBtn: {
    padding: "4px 12px",
    borderRadius: RADIUS.pill,
    border: `1px dashed ${C.darkBorder}`,
    background: "transparent",
    color: C.darkMuted,
    fontSize: 11,
    cursor: "pointer",
    fontFamily: FONT,
    outline: "none",
    transition: "border-color 0.15s, color 0.15s",
    height: TOOLBAR_HEIGHT,
    display: "flex",
    alignItems: "center",
  },
  countLabel: {
    fontSize: 11,
    color: C.darkMuted,
    marginLeft: "auto",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  badge: {
    fontSize: 10,
    fontWeight: 600,
    color: C.accent,
    background: C.accent + "14",
    borderRadius: RADIUS.pill,
    padding: "3px 10px",
    letterSpacing: "0.02em",
  },
}; }

/**
 * Shared toolbar for all data views.
 *
 * @param {object} props
 * @param {object}   [props.search]       - { value, onChange, placeholder }
 * @param {Array}    [props.filters]      - [{ name, options: [{name}], value, onChange }]
 * @param {Function} [props.onRefresh]    - Refresh button handler
 * @param {Function} [props.onCreate]     - "+ New" button handler
 * @param {number}   [props.recordCount]  - Total records
 * @param {number}   [props.filteredCount] - Filtered records (if different from total)
 * @param {string}   [props.sourceBadge]  - Source label (e.g. "Google Sheets")
 * @param {React.ReactNode} [props.leading]  - Content before search (e.g. calendar nav)
 * @param {React.ReactNode} [props.trailing] - Content after count (e.g. column toggle, export)
 * @param {React.ReactNode} [props.children] - Additional content between filters and count
 */
export default function ViewToolbar({
  search,
  filters,
  onRefresh,
  onCreate,
  recordCount,
  filteredCount,
  sourceBadge,
  leading,
  trailing,
  children,
}) {
  const tb = getTb();
  const [searchFocused, setSearchFocused] = useState(false);

  return (
    <div style={tb.wrapper}>
      {/* Leading content (e.g. calendar nav buttons, FilterChips label) */}
      {leading}

      {/* Search */}
      {search && (
        <div style={{
          ...tb.searchWrap,
          flex: "0 1 240px",
          ...(searchFocused ? { borderColor: C.accent, boxShadow: `0 0 0 2px ${C.accent}33` } : {}),
        }}>
          <span style={{ fontSize: 13, color: C.darkMuted, flexShrink: 0 }}>&#x1F50D;</span>
          <input
            style={tb.searchInput}
            placeholder={search.placeholder || "Search..."}
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
          {search.value && (
            <span
              style={{ fontSize: 14, color: C.darkMuted, cursor: "pointer", padding: "0 2px" }}
              onClick={() => search.onChange("")}
            >&times;</span>
          )}
        </div>
      )}

      {/* Filter dropdowns */}
      {filters && filters.map((f) => (
        <select
          key={f.name}
          value={f.value || ""}
          onChange={(e) => f.onChange(e.target.value || undefined)}
          style={tb.filterSelect}
        >
          <option value="">{f.name}</option>
          {f.options.map((opt) => (
            <option key={opt.name} value={opt.name}>{opt.name}</option>
          ))}
        </select>
      ))}

      {/* View-specific extra content */}
      {children}

      {/* Source badge */}
      {sourceBadge && (
        <span style={tb.badge}>{sourceBadge}</span>
      )}

      {/* Record count (pushed to right with marginLeft: auto) */}
      {recordCount != null && (
        <span style={tb.countLabel}>
          {filteredCount != null && filteredCount !== recordCount
            ? `${filteredCount} of ${recordCount}`
            : `${recordCount} record${recordCount !== 1 ? "s" : ""}`}
        </span>
      )}

      {/* Refresh */}
      {onRefresh && (
        <button
          style={tb.iconBtn}
          onClick={onRefresh}
          title="Refresh data"
          onMouseEnter={(e) => { e.currentTarget.style.color = C.darkText; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
        >
          &#x21bb;
        </button>
      )}

      {/* Create */}
      {onCreate && (
        <button
          style={tb.createBtn}
          onClick={onCreate}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent + "66"; e.currentTarget.style.color = C.darkText; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; e.currentTarget.style.color = C.darkMuted; }}
        >+ New</button>
      )}

      {/* Trailing content (e.g. column toggle, export buttons) */}
      {trailing}
    </div>
  );
}

// Export shared styles for views that need to render custom toolbar buttons
export { getTb as getToolbarStyles, TOOLBAR_HEIGHT };
