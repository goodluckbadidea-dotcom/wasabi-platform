// ─── Link Picker ───
// Three-panel drill-down picker for selecting a source cell to link.
// Pages → Views → Data Grid. Search bar filters pages by name.

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { C, FONT, RADIUS, SHADOW, Z } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { queryAll } from "../notion/pagination.js";
import { detectSchema } from "../notion/schema.js";
import { fetchSheetData } from "../sheets/sheetClient.js";
import { readProp } from "../notion/properties.js";
import {
  IconClose, IconSearch, IconTable, IconTimeline, IconCalendar,
  IconKanban, IconChart, IconFolder, IconDatabase, IconBolt, IconSheet, IconConnect,
} from "../design/icons.jsx";
import { areTypesCompatible, getCompatGroup, getGroupLabel } from "../config/linkTypeCompat.js";

// ── View type → icon ──
const VIEW_ICONS = {
  table: IconTable, gantt: IconTimeline, calendar: IconCalendar,
  cardGrid: IconFolder, kanban: IconKanban, charts: IconChart,
  form: IconDatabase, summaryTiles: IconChart, activityFeed: IconBolt,
  document: IconFolder, linked_sheet: IconSheet,
};

const VIEW_LABELS = {
  table: "Table", gantt: "Timeline", calendar: "Calendar",
  cardGrid: "Cards", kanban: "Kanban", charts: "Charts",
  form: "Form", summaryTiles: "Summary", activityFeed: "Activity",
  document: "Document", linked_sheet: "Linked Sheet",
};

// Only these view types contain cell data we can link to
const LINKABLE_TYPES = new Set(["table", "kanban", "cardGrid", "linked_sheet"]);
// For target mode: only writable view types can receive linked values
const WRITABLE_TYPES = new Set(["table", "kanban", "cardGrid"]);

// ── Grid sub-component with type filtering ──
function LinkPickerGrid({ viewData, targetFieldType, selectedCell, setSelectedCell, s }) {
  // Build column type map
  const colTypeMap = useMemo(() => {
    const map = {};
    if (viewData.schema) {
      const allFields = [
        ...(viewData.schema.titles || []),
        ...(viewData.schema.texts || []),
        ...(viewData.schema.numbers || []),
        ...(viewData.schema.selects || []),
        ...(viewData.schema.multiSelects || []),
        ...(viewData.schema.statuses || []),
        ...(viewData.schema.dates || []),
        ...(viewData.schema.checkboxes || []),
        ...(viewData.schema.urls || []),
        ...(viewData.schema.emails || []),
        ...(viewData.schema.phones || []),
        ...(viewData.schema.formulas || []),
        ...(viewData.schema.rollups || []),
        ...(viewData.schema.relations || []),
        ...(viewData.schema.people || []),
      ];
      for (const f of allFields) map[f.name] = f.type;
    }
    return map;
  }, [viewData.schema]);

  return (
    <table style={s.gridTable}>
      <thead>
        <tr>
          {viewData.columns.slice(0, 12).map((col) => {
            const colType = colTypeMap[col] || (viewData.type === "sheet" ? "rich_text" : "");
            const compatible = !targetFieldType || areTypesCompatible(colType, targetFieldType);
            return (
              <th key={col} style={{ ...s.th, opacity: compatible ? 1 : 0.35 }}>
                {col}
                {colType && (
                  <div style={{ fontSize: 9, fontWeight: 400, color: C.darkMuted, marginTop: 1 }}>
                    {getGroupLabel(getCompatGroup(colType))}
                  </div>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {(viewData.type === "sheet" ? viewData.rows : viewData.rows.map((r) => r.cells))
          .slice(0, 50).map((row, ri) => (
          <tr key={ri}>
            {(Array.isArray(row) ? row : row).slice(0, 12).map((cell, ci) => {
              const isActive = selectedCell?.rowIdx === ri && selectedCell?.colIdx === ci;
              const displayVal = cell === null || cell === undefined ? "" : String(cell);
              const colType = colTypeMap[viewData.columns[ci]] || (viewData.type === "sheet" ? "rich_text" : "");
              const compatible = !targetFieldType || areTypesCompatible(colType, targetFieldType);
              return (
                <td
                  key={ci}
                  style={{ ...s.td(isActive), opacity: compatible ? 1 : 0.3, cursor: compatible ? "pointer" : "not-allowed" }}
                  onClick={() => compatible && setSelectedCell({
                    rowIdx: ri,
                    colIdx: ci,
                    column: viewData.columns[ci],
                    value: displayVal,
                  })}
                  title={compatible ? displayVal : `Incompatible type: ${getGroupLabel(getCompatGroup(colType))}`}
                >
                  {displayVal.slice(0, 60) || "\u2014"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function LinkPicker({ onSelect, onCancel, targetIsReadOnly, mode = "source", targetFieldType }) {
  const { user, pages } = usePlatform();
  const [search, setSearch] = useState("");
  const [selectedPage, setSelectedPage] = useState(null);
  const [selectedView, setSelectedView] = useState(null);
  const [viewData, setViewData] = useState(null);   // { columns, rows, schema?, type }
  const [viewLoading, setViewLoading] = useState(false);
  const [selectedCell, setSelectedCell] = useState(null); // { rowIdx, colIdx, column, value }
  const searchRef = useRef(null);

  useEffect(() => { searchRef.current?.focus(); }, []);

  // Filter pages by search
  const filteredPages = useMemo(() => {
    const q = search.toLowerCase().trim();
    return pages.filter((p) => !q || (p.name || "").toLowerCase().includes(q));
  }, [pages, search]);

  // Get linkable views for selected page
  const allowedTypes = mode === "target" ? WRITABLE_TYPES : LINKABLE_TYPES;
  const pageViews = useMemo(() => {
    if (!selectedPage) return [];
    return (selectedPage.views || [])
      .map((v, idx) => ({ ...v, idx }))
      .filter((v) => allowedTypes.has(v.type));
  }, [selectedPage, allowedTypes]);

  // Load view data when a view is selected
  useEffect(() => {
    if (!selectedView || !user?.workerUrl) return;
    let cancelled = false;
    setViewLoading(true);
    setViewData(null);
    setSelectedCell(null);

    (async () => {
      try {
        if (selectedView.type === "linked_sheet") {
          const sheetUrl = selectedView.config?.sheetUrl;
          if (!sheetUrl) return;
          const data = await fetchSheetData(user.workerUrl, sheetUrl);
          if (!cancelled) {
            setViewData({
              type: "sheet",
              columns: data.columns,
              rows: data.rows.slice(0, 100),
              sheetUrl,
            });
          }
        } else {
          // Notion-backed view — requires Notion key
          if (!user?.notionKey) return;
          const dbId = selectedView.config?.databaseId || selectedPage?.databaseIds?.[0];
          if (!dbId) return;
          const [schema, results] = await Promise.all([
            detectSchema(user.workerUrl, user.notionKey, dbId),
            queryAll(user.workerUrl, user.notionKey, dbId),
          ]);
          if (!cancelled) {
            // Build column list from schema — title field always first
            const titleField = schema.allFields.find((f) => f.type === "title");
            const otherFields = schema.allFields.filter((f) => f.type !== "title");
            const ordered = titleField ? [titleField, ...otherFields] : schema.allFields;
            const columns = ordered.map((f) => f.name);
            const rows = results.slice(0, 100).map((page) => ({
              pageId: page.id,
              cells: columns.map((col) => {
                const prop = page.properties?.[col];
                if (!prop) return "";
                return readProp(prop) ?? "";
              }),
            }));
            setViewData({ type: "notion", columns, rows, schema, dbId });
          }
        }
      } catch (err) {
        console.error("[LinkPicker] Failed to load view data:", err);
      } finally {
        if (!cancelled) setViewLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedView, selectedPage, user]);

  // Handle link confirm
  const handleConfirm = useCallback(() => {
    if (!selectedCell || !selectedView || !selectedPage) return;
    const { rowIdx, column, value } = selectedCell;

    let sourceRef;
    if (viewData.type === "sheet") {
      sourceRef = {
        type: "sheet",
        sheetUrl: viewData.sheetUrl,
        rowIndex: rowIdx,
        column,
      };
    } else {
      sourceRef = {
        type: "notion",
        pageId: viewData.rows[rowIdx].pageId,
        field: column,
      };
    }

    // Determine source field type
    let sourceFieldType = "";
    if (viewData.type === "sheet") {
      sourceFieldType = "rich_text"; // sheets are text
    } else if (viewData.schema) {
      // Look up property type from schema
      const allFields = [
        ...(viewData.schema.titles || []),
        ...(viewData.schema.texts || []),
        ...(viewData.schema.numbers || []),
        ...(viewData.schema.selects || []),
        ...(viewData.schema.multiSelects || []),
        ...(viewData.schema.statuses || []),
        ...(viewData.schema.dates || []),
        ...(viewData.schema.checkboxes || []),
        ...(viewData.schema.urls || []),
        ...(viewData.schema.emails || []),
        ...(viewData.schema.phones || []),
        ...(viewData.schema.formulas || []),
        ...(viewData.schema.rollups || []),
        ...(viewData.schema.relations || []),
        ...(viewData.schema.people || []),
      ];
      const match = allFields.find((f) => f.name === column);
      sourceFieldType = match?.type || "";
    }

    onSelect({
      sourceRef,
      sourcePageId: selectedPage.id,
      sourceViewIdx: selectedView.idx,
      sourceName: `${selectedPage.name || "Untitled"} → ${selectedView.name || VIEW_LABELS[selectedView.type] || selectedView.type}`,
      sourceIsReadOnly: viewData.type === "sheet",
      previewValue: value,
      sourceFieldType,
    });
  }, [selectedCell, selectedView, selectedPage, viewData, onSelect]);

  // ── Styles ──
  const s = {
    overlay: {
      position: "fixed", inset: 0, background: C.overlayBg, zIndex: Z.modal,
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: ANIM.backdropFade,
    },
    card: {
      background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
      borderRadius: RADIUS.xl, boxShadow: SHADOW.dropdown,
      width: "90vw", maxWidth: 860, maxHeight: "80vh",
      display: "flex", flexDirection: "column",
      animation: ANIM.modalPop(), fontFamily: FONT, overflow: "hidden",
    },
    header: {
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "16px 20px 12px", borderBottom: `1px solid ${C.darkBorder}`,
    },
    title: { fontSize: 15, fontWeight: 600, color: C.darkText, display: "flex", alignItems: "center", gap: 8 },
    searchWrap: { padding: "12px 20px", borderBottom: `1px solid ${C.darkBorder}` },
    searchInput: {
      width: "100%", background: C.dark, border: `1px solid ${C.darkBorder}`,
      borderRadius: RADIUS.pill, padding: "8px 12px 8px 32px", fontSize: 13,
      fontFamily: FONT, color: C.darkText, outline: "none",
    },
    panels: {
      display: "flex", flex: 1, overflow: "hidden", minHeight: 300,
    },
    panel: {
      flex: 1, borderRight: `1px solid ${C.darkBorder}`, overflow: "auto",
      display: "flex", flexDirection: "column",
    },
    panelLabel: {
      fontSize: 10, fontWeight: 600, color: C.darkMuted,
      textTransform: "uppercase", letterSpacing: "0.1em",
      padding: "10px 14px 6px",
    },
    item: (active) => ({
      padding: "8px 14px", cursor: "pointer", fontSize: 13,
      fontFamily: FONT, display: "flex", alignItems: "center", gap: 8,
      color: active ? "#fff" : C.darkText,
      background: active ? C.accent : "transparent",
      borderRadius: 4, margin: "1px 6px",
      transition: "all 0.1s",
    }),
    footer: {
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 20px", borderTop: `1px solid ${C.darkBorder}`,
    },
    btn: (primary) => ({
      padding: "8px 18px", borderRadius: RADIUS.pill, border: "none",
      fontSize: 13, fontWeight: 500, fontFamily: FONT, cursor: "pointer",
      background: primary ? C.accent : C.darkSurf2,
      color: primary ? "#fff" : C.darkText,
      opacity: primary && !selectedCell ? 0.5 : 1,
    }),
    // Data grid styles
    grid: {
      flex: 2, overflow: "auto", fontSize: 12, fontFamily: FONT,
    },
    gridTable: {
      width: "100%", borderCollapse: "collapse", tableLayout: "auto",
    },
    th: {
      position: "sticky", top: 0, background: C.dark, color: C.darkMuted,
      fontSize: 10, fontWeight: 600, textTransform: "uppercase",
      letterSpacing: "0.05em", padding: "8px 10px", textAlign: "left",
      borderBottom: `1px solid ${C.darkBorder}`, whiteSpace: "nowrap",
    },
    td: (active) => ({
      padding: "6px 10px", color: C.darkText, borderBottom: `1px solid ${C.darkBorder}22`,
      cursor: "pointer", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis",
      whiteSpace: "nowrap", transition: "background 0.1s",
      background: active ? `${C.accent}33` : "transparent",
      outline: active ? `2px solid ${C.accent}` : "none",
      borderRadius: active ? 3 : 0,
    }),
  };

  return (
    <div onClick={onCancel} style={s.overlay}>
      <div role="dialog" aria-modal="true" aria-label={mode === "target" ? "Send value to" : "Link cell value"} onClick={(e) => e.stopPropagation()} style={s.card}>
        {/* Header */}
        <div style={s.header}>
          <div style={s.title}>
            <IconConnect size={16} color={C.accent} />
            {mode === "target" ? "Send Value To" : "Link Cell Value"}
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
          >
            <IconClose size={14} color={C.darkMuted} />
          </button>
        </div>

        {/* Search */}
        <div style={s.searchWrap}>
          <div style={{ position: "relative" }}>
            <IconSearch size={14} color={C.darkMuted} style={{ position: "absolute", left: 10, top: 9 }} />
            <input
              ref={searchRef}
              type="text"
              aria-label="Search pages and views"
              placeholder="Search pages and views..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={s.searchInput}
              onFocus={(e) => { e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            />
          </div>
        </div>

        {/* Three panels */}
        <div style={s.panels}>
          {/* Panel 1: Pages */}
          <div style={s.panel}>
            <div style={s.panelLabel}>Pages</div>
            {filteredPages.map((page) => (
              <div
                key={page.id}
                onClick={() => { setSelectedPage(page); setSelectedView(null); setViewData(null); setSelectedCell(null); }}
                style={s.item(selectedPage?.id === page.id)}
              >
                {page.name || "Untitled"}
              </div>
            ))}
            {filteredPages.length === 0 && (
              <div style={{ padding: 14, color: C.darkMuted, fontSize: 12 }}>No pages found</div>
            )}
          </div>

          {/* Panel 2: Views */}
          <div style={s.panel}>
            <div style={s.panelLabel}>Views</div>
            {!selectedPage && (
              <div style={{ padding: 14, color: C.darkMuted, fontSize: 12 }}>Select a page</div>
            )}
            {pageViews.map((view) => {
              const VIcon = VIEW_ICONS[view.type] || IconFolder;
              const label = view.name || VIEW_LABELS[view.type] || view.type;
              return (
                <div
                  key={view.idx}
                  onClick={() => { setSelectedView(view); setSelectedCell(null); }}
                  style={s.item(selectedView?.idx === view.idx)}
                >
                  <VIcon size={12} color={selectedView?.idx === view.idx ? "#fff" : C.darkMuted} />
                  {label}
                </div>
              );
            })}
            {selectedPage && pageViews.length === 0 && (
              <div style={{ padding: 14, color: C.darkMuted, fontSize: 12 }}>No linkable views</div>
            )}
          </div>

          {/* Panel 3: Data Grid */}
          <div style={s.grid}>
            {!selectedView && (
              <div style={{ padding: 20, color: C.darkMuted, fontSize: 12, textAlign: "center" }}>
                Select a view to browse data
              </div>
            )}
            {viewLoading && (
              <div style={{ padding: 20, color: C.darkMuted, fontSize: 12, textAlign: "center" }}>
                Loading...
              </div>
            )}
            {viewData && !viewLoading && (
              <LinkPickerGrid
                viewData={viewData}
                targetFieldType={targetFieldType}
                selectedCell={selectedCell}
                setSelectedCell={setSelectedCell}
                s={s}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={s.footer}>
          <button onClick={onCancel} style={s.btn(false)}>Cancel</button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {selectedCell && (
              <span style={{ fontSize: 11, color: C.darkMuted }}>
                {selectedCell.column}: "{selectedCell.value?.slice(0, 30)}"
              </span>
            )}
            <button
              onClick={handleConfirm}
              disabled={!selectedCell}
              style={s.btn(true)}
            >
              {mode === "target" ? "Link (one-way)" : "Link (one-way)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
