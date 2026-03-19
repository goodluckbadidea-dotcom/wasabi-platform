// ─── Kanban Board View ───
// Drag-and-drop column board. Columns from any select/status field.

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { C, FONT, RADIUS, getStatusColor } from "../design/tokens.js";
import { readField, getFieldType, getFieldOptions, getOptionNames, displayValue, resolveField } from "./_viewHelpers.js";
import { buildProp } from "../notion/properties.js";
import { cellStyles, CellDisplay } from "./_CellComponents.jsx";
import FilterChips, { applyChipFilters } from "./FilterChips.jsx";
import { useRecordDetail } from "../hooks/useRecordDetail.js";
import RecordDetailPortals from "../components/RecordDetailPortals.jsx";
import ViewToolbar from "../components/ViewToolbar.jsx";
import SavedViewsDropdown from "../components/SavedViewsDropdown.jsx";
import { isNeuronsMode, dispatchNeuronSelect } from "../neurons/NeuronsContext.jsx";
import NeuronBadge from "../neurons/NeuronBadge.jsx";
import { useCollaboration } from "../context/CollaborationContext.jsx";

export default function Kanban({ data = [], schema, config = {}, onUpdate, onRefresh, onCreate, onDelete, onViewConfigChange, pageConfig }) {
  const collab = useCollaboration();
  const [dragState, setDragState] = useState(null); // { pageId, fromCol, startX, startY, isDragging }
  const [dropTarget, setDropTarget] = useState(null); // column option name
  const [colDrag, setColDrag] = useState(null); // { colName, startX } — column reorder drag
  const [colDropTarget, setColDropTarget] = useState(null); // target column name for reorder
  const record = useRecordDetail();
  const ghostRef = useRef(null);
  const columnRefs = useRef({});

  // Target DB for creating records
  const targetDatabaseId = config.databaseId || pageConfig?.databaseIds?.[0] || pageConfig?.id;

  // ── Chip Filters (persisted) ──
  const [chipFilters, setChipFilters] = useState(config.activeFilters || {});
  const handleChipFilterChange = useCallback((newFilters) => {
    setChipFilters(newFilters);
    if (onViewConfigChange) onViewConfigChange({ activeFilters: newFilters, activeSavedViewId: null });
  }, [onViewConfigChange]);

  // ── Saved Views ──
  const [activeSavedViewId, setActiveSavedViewId] = useState(config.activeSavedViewId || null);

  const handleSelectView = useCallback((viewId) => {
    if (!viewId) {
      // Reset to default
      setChipFilters({});
      setActiveSavedViewId(null);
      onViewConfigChange?.({ activeFilters: {}, columnOrder: [], activeSavedViewId: null });
      return;
    }
    const sv = (config.savedViews || []).find((v) => v.id === viewId);
    if (!sv) return;
    setChipFilters(sv.activeFilters || {});
    setActiveSavedViewId(viewId);
    onViewConfigChange?.({ activeFilters: sv.activeFilters || {}, columnOrder: sv.columnOrder || [], activeSavedViewId: viewId });
  }, [config.savedViews, onViewConfigChange]);

  const handleSaveNewView = useCallback((name) => {
    const newView = {
      id: crypto.randomUUID(),
      name,
      activeFilters: { ...chipFilters },
      columnOrder: config.columnOrder || [],
    };
    const updated = [...(config.savedViews || []), newView];
    setActiveSavedViewId(newView.id);
    onViewConfigChange?.({ savedViews: updated, activeSavedViewId: newView.id });
  }, [chipFilters, config.columnOrder, config.savedViews, onViewConfigChange]);

  const handleUpdateView = useCallback((viewId) => {
    const updated = (config.savedViews || []).map((v) =>
      v.id === viewId ? { ...v, activeFilters: { ...chipFilters }, columnOrder: config.columnOrder || [] } : v
    );
    onViewConfigChange?.({ savedViews: updated, activeSavedViewId: viewId });
  }, [chipFilters, config.columnOrder, config.savedViews, onViewConfigChange]);

  const handleRenameView = useCallback((viewId, newName) => {
    const updated = (config.savedViews || []).map((v) => v.id === viewId ? { ...v, name: newName } : v);
    onViewConfigChange?.({ savedViews: updated });
  }, [config.savedViews, onViewConfigChange]);

  const handleDeleteView = useCallback((viewId) => {
    const updated = (config.savedViews || []).filter((v) => v.id !== viewId);
    const newActiveId = activeSavedViewId === viewId ? null : activeSavedViewId;
    if (activeSavedViewId === viewId) setActiveSavedViewId(null);
    onViewConfigChange?.({ savedViews: updated, activeSavedViewId: newActiveId });
  }, [config.savedViews, activeSavedViewId, onViewConfigChange]);

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

    // Build column array — filter out statuses hidden by chip filters on the columnField
    const hiddenStatuses = chipFilters[columnField];
    const cols = columnOptions
      .filter((opt) => {
        // If chip filters are active on the group-by field, hide filtered-out columns entirely
        if (hiddenStatuses && hiddenStatuses.length > 0) {
          return hiddenStatuses.includes(opt.name);
        }
        return true;
      })
      .map((opt) => ({
        name: opt.name,
        color: getStatusColor(opt.name, optionNames, config.colorMapping),
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

    // Apply custom column order if set
    if (config.columnOrder && config.columnOrder.length > 0) {
      const orderMap = {};
      config.columnOrder.forEach((name, i) => { orderMap[name] = i; });
      cols.sort((a, b) => {
        const oa = orderMap[a.name] ?? 999;
        const ob = orderMap[b.name] ?? 999;
        return oa - ob;
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
        // Mouse didn't move beyond threshold — treat as slow-double-click
        if (dragState.page) {
          record.handleCardClick(dragState.page, dragState.pageId);
        }
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

  // ── Column reorder drag ──
  const handleColDragStart = useCallback((e, colName) => {
    e.preventDefault();
    e.stopPropagation();
    setColDrag({ colName, startX: e.clientX });
  }, []);

  useEffect(() => {
    if (!colDrag) return;
    const handleMove = (e) => {
      // Find which column the cursor is over
      for (const [name, el] of Object.entries(columnRefs.current)) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right) {
          setColDropTarget(name !== colDrag.colName ? name : null);
          return;
        }
      }
      setColDropTarget(null);
    };
    const handleUp = () => {
      if (colDropTarget && colDropTarget !== colDrag.colName) {
        // Reorder: move colDrag.colName to position of colDropTarget
        const currentOrder = columns.map((c) => c.name);
        const fromIdx = currentOrder.indexOf(colDrag.colName);
        const toIdx = currentOrder.indexOf(colDropTarget);
        if (fromIdx >= 0 && toIdx >= 0) {
          const newOrder = [...currentOrder];
          newOrder.splice(fromIdx, 1);
          newOrder.splice(toIdx, 0, colDrag.colName);
          onViewConfigChange?.({ columnOrder: newOrder });
        }
      }
      setColDrag(null);
      setColDropTarget(null);
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [colDrag, colDropTarget, columns, onViewConfigChange]);

  // ── Open new-record modal, optionally pre-filling column value ──
  const openNewModal = useCallback((colName) => {
    const prefill = {};
    if (columnField && colName && colName !== "__uncategorized__") {
      prefill[columnField] = colName;
    }
    record.openNew(prefill);
  }, [columnField, record]);

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

      <ViewToolbar
        leading={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SavedViewsDropdown
              savedViews={config.savedViews || []}
              activeSavedViewId={activeSavedViewId}
              onSelectView={handleSelectView}
              onSaveView={handleSaveNewView}
              onUpdateView={handleUpdateView}
              onRenameView={handleRenameView}
              onDeleteView={handleDeleteView}
            />
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: C.darkMuted }}>
              Grouped by {columnField}
            </span>
          </div>
        }
        recordCount={filteredData.length}
      />

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
                background: colDrag?.colName === col.name ? C.accent + "11" : colDropTarget === col.name ? C.accent + "0A" : "transparent",
                transition: "background 0.15s",
              }}>
                {/* Drag handle for column reorder */}
                {col.name !== "__uncategorized__" && (
                  <span
                    onMouseDown={(e) => handleColDragStart(e, col.name)}
                    style={{
                      cursor: "grab",
                      color: C.darkMuted,
                      fontSize: 10,
                      lineHeight: 1,
                      opacity: 0.5,
                      userSelect: "none",
                      flexShrink: 0,
                    }}
                    title="Drag to reorder column"
                  >
                    ⠿
                  </span>
                )}
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
                  const othersOnCard = collab?.getUsersOnRecord?.(page.id) || [];
                  const cardPresenceColor = othersOnCard.length > 0 ? othersOnCard[0].color : null;

                  return (
                    <div
                      key={page.id}
                      data-neuron-node={`row:${page.id}`}
                      onMouseDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && isNeuronsMode()) return; // let onClick handle it
                        handleDragStart(e, page.id, col.name, page);
                      }}
                      onClick={(e) => {
                        if ((e.metaKey || e.ctrlKey) && isNeuronsMode()) {
                          e.preventDefault();
                          e.stopPropagation();
                          dispatchNeuronSelect({ node_type: "row", node_id: page.id, node_label: title || "Untitled" });
                        }
                      }}
                      style={{
                        background: C.darkSurf2,
                        border: `1px solid ${cardPresenceColor || C.darkBorder}`,
                        borderRadius: RADIUS.lg,
                        padding: "10px 12px",
                        cursor: "grab",
                        opacity: isDragging ? 0.4 : 1,
                        transition: "opacity 0.15s, border-color 0.15s",
                        userSelect: "none",
                        ...(cardPresenceColor ? { boxShadow: `0 0 0 1px ${cardPresenceColor}33` } : {}),
                      }}
                      onMouseEnter={(e) => { if (!dragState) e.currentTarget.style.borderColor = cardPresenceColor || C.accent + "44"; }}
                      onMouseLeave={(e) => { if (!dragState) e.currentTarget.style.borderColor = cardPresenceColor || C.darkBorder; }}
                    >
                      {/* Card title */}
                      <div style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: C.darkText,
                        marginBottom: previewFields.length > 0 ? 6 : 0,
                        lineHeight: 1.35,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}>
                        <span style={{ flex: 1 }}>{title || "Untitled"}</span>
                        <NeuronBadge nodeId={page.id} />
                      </div>

                      {/* Preview fields */}
                      {previewFields.map((fieldName) => {
                        const val = readField(page, fieldName);
                        const type = getFieldType(schema, fieldName);
                        if (val === null || val === undefined) return null;
                        return (
                          <div key={fieldName} style={{ fontSize: 12, color: C.darkMuted, marginTop: 2 }}>
                            <CellDisplay value={val} type={type} fieldName={fieldName} schema={schema} colorMapping={config.colorMapping} />
                          </div>
                        );
                      })}

                      {/* Presence badge */}
                      {othersOnCard.length > 0 && (
                        <div style={{ display: "flex", gap: 4, marginTop: 6, alignItems: "center" }}>
                          {othersOnCard.map((u) => (
                            <span key={u.userId} style={{
                              fontSize: 10, color: u.color, fontWeight: 600,
                              background: u.color + "18", borderRadius: 4, padding: "1px 5px",
                            }}>
                              {u.userName || "User"}{u.isTyping ? " typing…" : ""}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

              </div>

              {/* + New button at bottom of column — opens modal with column prefill */}
              {onCreate && targetDatabaseId && (
                <button
                  onClick={() => openNewModal(col.name)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                    padding: "8px 0",
                    margin: "0 8px 8px",
                    background: "transparent",
                    border: `1px dashed ${C.darkBorder}`,
                    borderRadius: RADIUS.lg,
                    color: C.darkMuted,
                    fontSize: 11,
                    cursor: "pointer",
                    fontFamily: FONT,
                    transition: "border-color 0.15s, color 0.15s",
                    outline: "none",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent + "66"; e.currentTarget.style.color = C.darkText; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; e.currentTarget.style.color = C.darkMuted; }}
                >
                  + New
                </button>
              )}
            </div>
          );
        })}
      </div>

      <RecordDetailPortals
        hook={record}
        schema={schema}
        pageConfigId={pageConfig?.id}
        databaseId={targetDatabaseId}
        onUpdate={onUpdate}
        onCreate={onCreate}
        onDelete={onDelete}
      />
    </div>
  );
}
