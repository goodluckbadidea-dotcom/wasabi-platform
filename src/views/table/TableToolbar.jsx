// ─── Table Toolbar ───
// Search, filters, column visibility, saved views, export, and action buttons.

import React, { useRef, useState, useEffect } from "react";
import { C, FONT, RADIUS, SHADOW } from "../../design/tokens.js";
import { S } from "../../design/styles.js";
import { hoverBg } from "../../design/interactions.js";
import { IconEyeOff, IconPlus, IconExport, IconChevronDown } from "../../design/icons.jsx";
import SavedViewsDropdown from "../../components/SavedViewsDropdown.jsx";
import PresenceAvatars from "../../components/PresenceAvatars.jsx";
import { getStyles } from "./tableStyles.js";

export default function TableToolbar({
  // Search
  search, setSearch, searchFocused, setSearchFocused,
  // Filters
  filterableFields, filters, onFilterChange,
  // Column visibility
  allColumns, hiddenColumns, toggleColumn, colMenuOpen, setColMenuOpen, colMenuRef,
  // Sub-item expand/collapse
  subItemsEnabled, childMap, expandedRows, expandAll, collapseAll,
  // Saved views
  savedViews, activeSavedViewId,
  onSelectView, onSaveView, onUpdateView, onRenameView, onDeleteView,
  // Actions
  onCreate, targetDatabaseId, onSetShowNewModal,
  onExport, onRefresh,
  // Data
  processedDataLength, dataLength,
  // Collaboration
  collab,
}) {
  const styles = getStyles();
  return (
    <div style={styles.toolbar}>
      <SavedViewsDropdown
        savedViews={savedViews}
        activeSavedViewId={activeSavedViewId}
        onSelectView={onSelectView}
        onSaveView={onSaveView}
        onUpdateView={onUpdateView}
        onRenameView={onRenameView}
        onDeleteView={onDeleteView}
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

      {subItemsEnabled && Object.keys(childMap).length > 0 && (() => {
        const anyExpanded = expandedRows && expandedRows.size > 0;
        return (
          <button
            onClick={anyExpanded ? collapseAll : expandAll}
            title={anyExpanded ? "Collapse sub-items" : "Expand sub-items"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              height: 34,
              padding: "0 12px",
              borderRadius: RADIUS.pill,
              border: `1px solid ${C.darkBorder}`,
              background: C.darkSurf2,
              cursor: "pointer",
              fontSize: 11,
              fontFamily: FONT,
              color: C.darkMuted,
              whiteSpace: "nowrap",
              flexShrink: 0,
              transition: "background 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.dark; e.currentTarget.style.color = C.darkText; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf2; e.currentTarget.style.color = C.darkMuted; }}
          >
            <IconChevronDown size={10} color="currentColor" style={{ transform: anyExpanded ? undefined : "rotate(-90deg)", transition: "transform 0.15s" }} />
            {anyExpanded ? "Collapse Sub-Items" : "Expand Sub-Items"}
          </button>
        );
      })()}

      {filterableFields.map((field) => (
        <select
          key={field.name}
          style={styles.filterSelect}
          value={filters[field.name] || ""}
          onChange={(e) => onFilterChange(field.name, e.target.value)}
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

      {/* Add Row — opens NewRecordModal */}
      {onCreate && targetDatabaseId && (
        <button
          style={styles.refreshBtn}
          onClick={() => onSetShowNewModal(true)}
          title="Add new row"
        >
          <IconPlus size={14} color={C.darkMuted} />
        </button>
      )}

      {/* CSV Export */}
      <button
        style={styles.refreshBtn}
        onClick={onExport}
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
        {processedDataLength === dataLength
          ? `${dataLength} record${dataLength !== 1 ? "s" : ""}`
          : `${processedDataLength} of ${dataLength}`}
      </span>
    </div>
  );
}
