// ─── Kanban Board View ───
// Drag-and-drop column board. Columns from any select/status field.

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { C, FONT, RADIUS, getStatusColor } from "../design/tokens.js";
import { readField, getFieldType, getFieldOptions, getOptionNames, displayValue, resolveField } from "./_viewHelpers.js";
import { buildProp } from "../notion/properties.js";
import { cellStyles, CellDisplay } from "./_CellComponents.jsx";
import FilterChips, { applyChipFilters } from "./FilterChips.jsx";
import RecordDetail from "./RecordDetail.jsx";

export default function Kanban({ data = [], schema, config = {}, onUpdate, onRefresh, onViewConfigChange, pageConfig }) {
  const [dragState, setDragState] = useState(null); // { pageId, fromCol, startX, startY, isDragging }
  const [dropTarget, setDropTarget] = useState(null); // column option name
  const [detailPage, setDetailPage] = useState(null);
  const ghostRef = useRef(null);
  const columnRefs = useRef({});

  // ── Chip Filters (persisted) ──
  const [chipFilters, setChipFilters] = useState(config.activeFilters || {});
  const handleChipFilterChange = useCallback((newFilters) => {
    setChipFilters(newFilters);
    if (onViewConfigChange) onViewConfigChange({ activeFilters: newFilters });
  }, [onViewConfigChange]);

  // Apply chip filters before grouping
  const filteredData = useMemo(
    () => applyChipFilters(data, chipFilters, schema),
    [data, chipFilters, schema]
  );

  // Resolve fields
  const columnField = resolveField(schema, config.columnField, ["statuses", "selects"]);
  const titleField = resolveField(schema, config.titleField, ["title"]);
  const previewFields = (config.visibleFields && config.visibleFields.length > 0)
    ? config.visibleFields
    : config.previewFields || (() => {
      if (!schema) return [];
      const fields = [];
      for (const f of schema.richTexts || []) { if (fields.length < 1) fields.push(f.name); }
      for (const f of schema.dates || []) { if (fields.length < 2) fields.push(f.name); }
      return fields;
    })();

  // Get column options
  const columnOptions = useMemo(() => {
    if (!columnField || !schema) return [];
    return getFieldOptions(schema, columnField);
  }, [columnField, schema]);

  const columnType = columnField ? getFieldType(schema, columnField) : null;
  const optionNames = columnOptions.map((o) => o.name);

  // Group data into columns
  const columns = useMemo(() => {
    const grouped = {};
    // Initialize all option columns
    for (const opt of columnOptions) {
      grouped[opt.name] = [];
    }
    grouped["__uncategorized__"] = [];

    for (const page of filteredData) {
      const val = columnField ? readField(page, columnField) : null;
      if (val && grouped[val]) {
        grouped[val].push(page);
      } else {
        grouped["__uncategorized__"].push(page);
      }
    }

    // Build column array
    const cols = columnOptions.map((opt) => ({
      name: opt.name,
      color: getStatusColor(opt.name, optionNames),
      pages: grouped[opt.name] || [],
    }));

    // Add uncategorized if any
    if (grouped["__uncategorized__"].length > 0) {
      cols.push({
        name: "__uncategorized__",
        color: C.darkMuted,
        pages: grouped["__uncategorized__"],
      });
    }

    // Sort cards within each column by config.sortField
    if (config.sortField) {
      const dir = config.sortDir === "desc" ? -1 : 1;
      for (const col of cols) {
        col.pages.sort((a, b) => {
          const va = readField(a, config.sortField);
          const vb = readField(b, config.sortField);
          if (va == null && vb == null) return 0;
          if (va == null) return 1;
          if (vb == null) return -1;
          if (va < vb) return -1 * dir;
          if (va > vb) return 1 * dir;
          return 0;
        });
      }
    }

    return cols;
  }, [filteredData, columnField, columnOptions, optionNames, config.sortField, config.sortDir]);

  // ─── Drag handlers ───

  const handleDragStart = useCallback((e, pageId, fromCol, page) => {
    e.preventDefault();
    setDragState({ pageId, fromCol, startX: e.clientX, startY: e.clientY, isDragging: false, page, cardEl: e.currentTarget });
  }, []);

  useEffect(() => {
    if (!dragState) return;

    const DRAG_THRESHOLD = 5;

    const handleMouseMove = (e) => {
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // If we haven't started dragging yet, check threshold
      if (!dragState.isDragging) {
        if (dist < DRAG_THRESHOLD) return;
        // Exceeded threshold — promote to real drag and create ghost
        dragState.isDragging = true;
        const card = dragState.cardEl;
        if (card) {
          const rect = card.getBoundingClientRect();
          const ghost = card.cloneNode(true);
          ghost.style.position = "fixed";
          ghost.style.left = rect.left + "px";
          ghost.style.top = rect.top + "px";
          ghost.style.width = rect.width + "px";
          ghost.style.opacity = "0.85";
          ghost.style.pointerEvents = "none";
          ghost.style.zIndex = "9999";
          ghost.style.transform = "rotate(2deg) scale(1.02)";
          ghost.style.boxShadow = "0 8px 24px rgba(0,0,0,0.3)";
          ghost.style.transition = "none";
          document.body.appendChild(ghost);
          ghostRef.current = { el: ghost, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
        }
      }

      // Move ghost
      if (ghostRef.current?.el) {
        ghostRef.current.el.style.left = (e.clientX - ghostRef.current.offsetX) + "px";
        ghostRef.current.el.style.top = (e.clientY - ghostRef.current.offsetY) + "px";
      }

      // Detect column under cursor
      let found = null;
      for (const [colName, el] of Object.entries(columnRefs.current)) {
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          found = colName;
          break;
        }
      }
      setDropTarget(found);
    };

    const handleMouseUp = (e) => {
      // Clean up ghost
      if (ghostRef.current?.el) {
        document.body.removeChild(ghostRef.current.el);
        ghostRef.current = null;
      }

      if (!dragState.isDragging) {
        // Mouse didn't move beyond threshold — treat as click
        if (dragState.page) setDetailPage(dragState.page);
      } else {
        // Execute drop
        if (dropTarget && dropTarget !== dragState.fromCol && dropTarget !== "__uncategorized__" && onUpdate && columnField && columnType) {
          const propPayload = buildProp(columnType, dropTarget);
          if (propPayload) {
            onUpdate(dragState.pageId, columnField, propPayload);
          }
        }
      }

      setDragState(null);
      setDropTarget(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, dropTarget, onUpdate, columnField, columnType]);

  if (!schema) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        Loading schema...
      </div>
    );
  }

  if (!columnField) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        No select or status field found for Kanban columns.
      </div>
    );
  }

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      fontFamily: FONT,
    }}>
      {/* Filter chips */}
      <FilterChips
        schema={schema}
        data={data}
        activeFilters={chipFilters}
        onFilterChange={handleChipFilterChange}
      />

      {/* Toolbar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 20px",
        borderBottom: `1px solid ${C.edgeLine}`,
        gap: 12,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: C.darkMuted }}>
          Grouped by {columnField}
        </span>
        <span style={{ fontSize: 12, color: C.darkMuted, marginLeft: "auto" }}>
          {filteredData.length} records
        </span>
      </div>

      {/* Columns */}
      <div style={{
        flex: 1,
        display: "flex",
        overflowX: "auto",
        overflowY: "hidden",
        padding: "16px 12px",
        gap: 12,
      }}>
        {columns.map((col) => {
          const isDropping = dragState && dropTarget === col.name && dropTarget !== dragState.fromCol;
          const displayName = col.name === "__uncategorized__" ? "Uncategorized" : col.name;

          return (
            <div
              key={col.name}
              ref={(el) => { columnRefs.current[col.name] = el; }}
              style={{
                minWidth: 280,
                maxWidth: 320,
                flex: "0 0 280px",
                display: "flex",
                flexDirection: "column",
                background: isDropping ? C.accent + "0D" : C.darkSurf,
                borderRadius: RADIUS.xl,
                border: `1px solid ${isDropping ? C.accent + "44" : C.darkBorder}`,
                overflow: "hidden",
                transition: "border-color 0.15s, background 0.15s",
              }}
            >
              {/* Column header */}
              <div style={{
                padding: "12px 14px",
                borderBottom: `3px solid ${col.color}`,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}>
                <span style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: C.darkText,
                }}>
                  {displayName}
                </span>
                <span style={{
                  fontSize: 11,
                  color: C.darkMuted,
                  background: C.darkSurf2,
                  borderRadius: RADIUS.pill,
                  padding: "2px 8px",
                  fontWeight: 600,
                }}>
                  {col.pages.length}
                </span>
              </div>

              {/* Cards */}
              <div style={{
                flex: 1,
                overflowY: "auto",
                padding: 8,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}>
                {col.pages.length === 0 && (
                  <div style={{
                    padding: 24,
                    textAlign: "center",
                    color: C.darkMuted,
                    fontSize: 12,
                    fontStyle: "italic",
                  }}>
                    No items
                  </div>
                )}

                {col.pages.map((page) => {
                  const title = titleField ? readField(page, titleField) : "Untitled";
                  const isDragging = dragState?.pageId === page.id;

                  return (
                    <div
                      key={page.id}
                      onMouseDown={(e) => handleDragStart(e, page.id, col.name, page)}
                      style={{
                        background: C.darkSurf2,
                        border: `1px solid ${C.darkBorder}`,
                        borderRadius: RADIUS.lg,
                        padding: "10px 12px",
                        cursor: "grab",
                        opacity: isDragging ? 0.4 : 1,
                        transition: "opacity 0.15s, border-color 0.15s",
                        userSelect: "none",
                      }}
                      onMouseEnter={(e) => { if (!dragState) e.currentTarget.style.borderColor = C.accent + "44"; }}
                      onMouseLeave={(e) => { if (!dragState) e.currentTarget.style.borderColor = C.darkBorder; }}
                    >
                      {/* Card title */}
                      <div style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: C.darkText,
                        marginBottom: previewFields.length > 0 ? 6 : 0,
                        lineHeight: 1.35,
                      }}>
                        {title || "Untitled"}
                      </div>

                      {/* Preview fields */}
                      {previewFields.map((fieldName) => {
                        const val = readField(page, fieldName);
                        const type = getFieldType(schema, fieldName);
                        if (val === null || val === undefined) return null;
                        return (
                          <div key={fieldName} style={{ fontSize: 12, color: C.darkMuted, marginTop: 2 }}>
                            <CellDisplay value={val} type={type} fieldName={fieldName} schema={schema} />
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {detailPage && (
        <RecordDetail
          page={detailPage}
          schema={schema}
          onClose={() => setDetailPage(null)}
          onUpdate={onUpdate}
          pageConfigId={pageConfig?.id}
        />
      )}
    </div>
  );
}
