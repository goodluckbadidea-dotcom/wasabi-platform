// ─── Widget Grid ───
// Responsive grid layout for dashboard widgets.
// Edit mode: add/remove/reorder widgets.
// Normal mode: fully interactive widgets with scrollable content.

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { IconPlus, IconEdit, IconChart, IconBolt, IconForm, IconFunction } from "../design/icons.jsx";
import { ANIM } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import useViewPrefs from "../hooks/useViewPrefs.js";
import DashboardWidget from "../core/DashboardWidget.jsx";
import MiniView from "../core/MiniView.jsx";
import PluginWidget from "../core/PluginWidget.jsx";
import * as api from "../lib/api.js";

// Viewport-relative height ratios (fraction of window.innerHeight)
const VH_RATIOS = { view: 0.4, shortcut: 0.09, text: 0.18, plugin: 0.31 };
const MIN_HEIGHTS = { view: 240, shortcut: 60, text: 100, plugin: 180 };

function defaultHeight(type) {
  const vh = window.innerHeight || 900;
  const ratio = VH_RATIOS[type] || VH_RATIOS.view;
  const floor = MIN_HEIGHTS[type] || MIN_HEIGHTS.view;
  return Math.max(floor, Math.round(vh * ratio));
}

export default function WidgetGrid({
  widgets = [],
  onUpdateWidgets,
  // Optional controlled props — when provided, the parent owns edit/picker
  // state and renders the toggle buttons itself.
  editModeProp,
  onEditModeChange,
  widgetPickerOpenProp,
  onWidgetPickerOpenChange,
  hideTopControls = false,
}) {
  const { setActiveRightPane } = usePlatform();
  const viewPrefs = useViewPrefs();

  // Hybrid state: controlled when parent passes the prop, else internal.
  const [editModeInternal, setEditModeInternal] = useState(false);
  const [widgetPickerOpenInternal, setWidgetPickerOpenInternal] = useState(false);
  const editMode = editModeProp !== undefined ? editModeProp : editModeInternal;
  const setEditMode = useCallback((next) => {
    const value = typeof next === "function" ? next(editMode) : next;
    if (onEditModeChange) onEditModeChange(value);
    if (editModeProp === undefined) setEditModeInternal(value);
  }, [editMode, editModeProp, onEditModeChange]);
  const widgetPickerOpen = widgetPickerOpenProp !== undefined ? widgetPickerOpenProp : widgetPickerOpenInternal;
  const setWidgetPickerOpen = useCallback((next) => {
    const value = typeof next === "function" ? next(widgetPickerOpen) : next;
    if (onWidgetPickerOpenChange) onWidgetPickerOpenChange(value);
    if (widgetPickerOpenProp === undefined) setWidgetPickerOpenInternal(value);
  }, [widgetPickerOpen, widgetPickerOpenProp, onWidgetPickerOpenChange]);

  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  // ── Widget CRUD ──
  const handleAddWidget = useCallback((widgetConfig) => {
    const id = `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const type = widgetConfig.type || "view";
    const newWidget = {
      id,
      h: defaultHeight(type),
      colSpan: (type === "view" || type === "plugin") ? 2 : 1,
      ...widgetConfig,
    };
    onUpdateWidgets([...widgets, newWidget]);
    setWidgetPickerOpen(false);
  }, [widgets, onUpdateWidgets]);

  const handleDeleteWidget = useCallback((widgetId) => {
    onUpdateWidgets(widgets.filter((w) => w.id !== widgetId));
  }, [widgets, onUpdateWidgets]);

  const handleResize = useCallback((widgetId, newColSpan, newH) => {
    onUpdateWidgets(widgets.map((w) => {
      if (w.id !== widgetId) return w;
      const updates = { h: newH };
      if (newColSpan != null) updates.colSpan = newColSpan;
      return { ...w, ...updates };
    }));
  }, [widgets, onUpdateWidgets]);

  const handleToggleSpan = useCallback((widgetId) => {
    onUpdateWidgets(widgets.map((w) =>
      w.id === widgetId ? { ...w, colSpan: (w.colSpan || 1) === 1 ? 2 : 1 } : w
    ));
  }, [widgets, onUpdateWidgets]);

  // ── Drag-to-reorder ──
  const handleDragStart = useCallback((e, idx) => {
    if (!editMode) return;
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
  }, [editMode]);

  const handleDragOver = useCallback((e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIdx(idx);
  }, []);

  const handleDrop = useCallback((e, dropIdx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === dropIdx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    const reordered = [...widgets];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(dropIdx, 0, moved);
    onUpdateWidgets(reordered);
    setDragIdx(null);
    setDragOverIdx(null);
  }, [dragIdx, widgets, onUpdateWidgets]);

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

  // ── Render widget content ──
  const renderWidgetContent = (widget) => {
    if (widget.type === "view") {
      return (
        <MiniView
          pageId={widget.pageId}
          viewIndex={widget.viewIndex ?? 0}
          width="100%"
          widgetViewConfig={widget.widgetConfig}
          onWidgetViewConfigChange={(configUpdates) => {
            onUpdateWidgets(widgets.map((w) =>
              w.id === widget.id
                ? { ...w, widgetConfig: { ...(w.widgetConfig || {}), ...configUpdates } }
                : w
            ));
          }}
        />
      );
    }
    if (widget.type === "shortcut") {
      return (
        <div
          onClick={() => widget.pageId && setActiveRightPane(widget.pageId)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100%", cursor: widget.pageId ? "pointer" : "default",
            fontFamily: FONT, fontSize: 13, fontWeight: 600,
            color: C.accent, letterSpacing: "0.02em",
          }}
        >
          {widget.label || "Shortcut"}
        </div>
      );
    }
    if (widget.type === "text") {
      return (
        <div
          contentEditable={editMode}
          suppressContentEditableWarning
          onBlur={(e) => {
            onUpdateWidgets(widgets.map((w) =>
              w.id === widget.id ? { ...w, content: e.currentTarget.textContent } : w
            ));
          }}
          style={{
            padding: 12, fontFamily: FONT, fontSize: 13, lineHeight: 1.6,
            color: C.darkText, whiteSpace: "pre-wrap", minHeight: 40,
            outline: "none",
            cursor: editMode ? "text" : "default",
          }}
        >
          {widget.content || "Click to edit..."}
        </div>
      );
    }
    if (widget.type === "plugin") {
      return (
        <PluginWidget
          functionId={widget.functionId}
          width="100%"
          height={widget.h - 36}
          refreshInterval={widget.refreshInterval}
        />
      );
    }
    return null;
  };

  return (
    <div style={{
      flex: 1,
      overflowY: "auto",
      // Transparent so the app's bgGradient shows through the dashboard canvas.
      backgroundColor: "transparent",
      padding: "16px 20px",
      position: "relative",
    }}>
      {/* ── Top controls ── (hidden when parent renders them in its header) */}
      {!hideTopControls && (
        <div style={{
          display: "flex", justifyContent: "flex-end", gap: 8,
          marginBottom: 16, position: "sticky", top: 0, zIndex: 50,
        }}>
          <button
            onClick={() => {
              setEditMode((m) => !m);
              if (editMode) setWidgetPickerOpen(false);
            }}
            style={{
              background: editMode ? C.accent : C.darkSurf2,
              color: editMode ? "#fff" : C.darkMuted,
              border: `1px solid ${editMode ? C.accent : C.darkBorder}`,
              borderRadius: RADIUS.md, padding: "6px 14px",
              fontSize: 11, fontFamily: FONT, fontWeight: 600,
              cursor: "pointer", display: "flex", alignItems: "center",
              gap: 5, boxShadow: SHADOW.card,
            }}
          >
            <IconEdit size={11} color={editMode ? "#fff" : C.darkMuted} />
            {editMode ? "Done" : "Edit"}
          </button>

          {editMode && (
            <button
              onClick={() => setWidgetPickerOpen(true)}
              style={{
                background: C.darkSurf2, color: C.darkMuted,
                border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.md, padding: "6px 14px",
                fontSize: 11, fontFamily: FONT, fontWeight: 600,
                cursor: "pointer", display: "flex", alignItems: "center",
                gap: 5, boxShadow: SHADOW.card,
              }}
            >
              <IconPlus size={10} color={C.darkMuted} />
              Add Widget
            </button>
          )}
        </div>
      )}

      {/* ── Grid ── */}
      {widgets.length > 0 ? (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
          alignItems: "start",
        }}>
          {widgets.map((widget, idx) => {
            const colSpan = widget.colSpan || 1;
            const isDragging = dragIdx === idx;
            const isDragOver = dragOverIdx === idx;
            return (
              <div
                key={widget.id}
                draggable={editMode}
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
                style={{
                  gridColumn: `span ${colSpan}`,
                  opacity: isDragging ? 0.4 : 1,
                  borderTop: isDragOver ? `2px solid ${C.accent}` : "2px solid transparent",
                  transition: "opacity 0.15s, border-color 0.15s",
                  animation: ANIM.popIn(idx * 0.04),
                }}
              >
                <DashboardWidget
                  widget={widget}
                  editMode={editMode}
                  zoom={1}
                  gridMode
                  gridGap={16}
                  onReposition={() => {}}
                  onResize={handleResize}
                  onDelete={handleDeleteWidget}
                  onToggleSpan={handleToggleSpan}
                  onClick={() => {}}
                >
                  {renderWidgetContent(widget)}
                </DashboardWidget>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Empty state ── */
        !editMode && (
          <div style={{
            textAlign: "center", color: C.darkMuted, fontFamily: FONT,
            animation: ANIM.snapUp(0.1), padding: "80px 0",
          }}>
            <div style={{ marginBottom: 12, opacity: 0.3 }}>
              <IconChart size={32} color={C.darkMuted} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
              No widgets yet
            </div>
            <div style={{ fontSize: 12, marginBottom: 16, opacity: 0.7 }}>
              Add widgets to pin views from your pages
            </div>
            <button
              onClick={() => { setEditMode(true); setWidgetPickerOpen(true); }}
              style={{
                background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
                color: "#fff", border: "none", borderRadius: RADIUS.pill,
                padding: "8px 20px", fontSize: 12, fontFamily: FONT,
                fontWeight: 600, cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              <IconPlus size={10} color="#fff" />
              Add Widget
            </button>
          </div>
        )
      )}

      {/* ── Widget Picker ── */}
      {widgetPickerOpen && (
        <WidgetPickerInline
          onClose={() => setWidgetPickerOpen(false)}
          onAddWidget={handleAddWidget}
        />
      )}
    </div>
  );
}

// ── Inline Widget Picker ──
function WidgetPickerInline({ onClose, onAddWidget }) {
  const { pages } = usePlatform();
  const viewPrefs = useViewPrefs();
  const [pluginFunctions, setPluginFunctions] = useState([]);
  const [loadingPlugins, setLoadingPlugins] = useState(true);

  // Fetch custom functions that can serve as plugins
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.listCustomFunctions({ type: "plugin" });
        const fns = result?.entries || result?.functions || result?.data || result?.rows || [];
        if (!cancelled) setPluginFunctions(fns);

        if (fns.length === 0) {
          const allResult = await api.listCustomFunctions();
          const allFns = allResult?.entries || allResult?.functions || allResult?.data || allResult?.rows || [];
          const plugins = allFns.filter(
            (f) => f.type === "plugin" || f.meta?.widget === true
          );
          if (!cancelled) setPluginFunctions(plugins);
        }
      } catch {
        // No plugins available
      } finally {
        if (!cancelled) setLoadingPlugins(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const viewablePages = useMemo(() => {
    return pages.filter(
      (p) => p.type === "page" && p.views?.length > 0 &&
        p.page_type !== "dashboard" && p.pageType !== "dashboard"
    );
  }, [pages]);

  const quickBtnStyle = {
    background: "transparent",
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "8px 14px",
    cursor: "pointer",
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: 500,
    color: C.darkMuted,
    transition: "all 0.12s",
    outline: "none",
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: C.overlayBg, zIndex: 299,
          animation: ANIM.backdropFade,
        }}
      />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: 380, background: C.darkSurf2,
        borderLeft: `1px solid ${C.darkBorder}`,
        boxShadow: SHADOW.dropdown, zIndex: 300,
        display: "flex", flexDirection: "column",
        animation: ANIM.snapInRight(),
      }}>
        <div style={{
          padding: "16px 20px", borderBottom: `1px solid ${C.darkBorder}`,
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.darkText, fontFamily: FONT }}>
            Add Widget
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <span style={{ color: C.darkMuted, fontSize: 14 }}>x</span>
          </button>
        </div>

        <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.darkBorder}` }}>
          <div style={{
            fontSize: 10, fontWeight: 600, color: C.darkMuted,
            letterSpacing: "0.06em", textTransform: "uppercase",
            marginBottom: 8, fontFamily: FONT,
          }}>
            Quick Add
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => onAddWidget({ type: "shortcut", label: "Shortcut" })} style={quickBtnStyle}>
              <IconBolt size={12} color={C.darkMuted} /> Shortcut
            </button>
            <button onClick={() => onAddWidget({ type: "text", label: "Note", content: "" })} style={quickBtnStyle}>
              <IconForm size={12} color={C.darkMuted} /> Text Block
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
          {/* ── Plugins section ── */}
          <div style={{
            fontSize: 10, fontWeight: 600, color: C.darkMuted,
            letterSpacing: "0.06em", textTransform: "uppercase",
            marginBottom: 8, fontFamily: FONT,
          }}>
            Plugins
          </div>
          {loadingPlugins ? (
            <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, padding: "8px 0" }}>
              Loading plugins...
            </div>
          ) : pluginFunctions.length === 0 ? (
            <div style={{
              fontSize: 11, color: C.darkMuted, fontFamily: FONT,
              padding: "10px 12px", marginBottom: 16,
              border: `1px dashed ${C.darkBorder}`, borderRadius: RADIUS.md,
              lineHeight: 1.5,
            }}>
              No plugin functions yet. Create a function with type "plugin" in the Build page to use it here.
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              {pluginFunctions.map((fn) => (
                <button
                  key={fn.id}
                  onClick={() => onAddWidget({
                    type: "plugin",
                    functionId: fn.id,
                    label: fn.name || fn.id,
                    refreshInterval: fn.meta?.refreshInterval || 0,
                  })}
                  style={{
                    width: "100%", background: "transparent",
                    border: `1px solid ${C.darkBorder}`,
                    borderRadius: RADIUS.md, padding: "8px 10px",
                    marginBottom: 4, cursor: "pointer", textAlign: "left",
                    fontFamily: FONT, fontSize: 11, color: C.darkMuted,
                    transition: "all 0.12s", outline: "none",
                    display: "flex", alignItems: "center", gap: 8,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = C.accent;
                    e.currentTarget.style.color = C.accent;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = C.darkBorder;
                    e.currentTarget.style.color = C.darkMuted;
                  }}
                >
                  <div style={{
                    width: 22, height: 22, borderRadius: RADIUS.sm,
                    background: C.accent + "18",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <IconFunction size={11} color={C.accent} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 1 }}>
                      {fn.name || fn.id}
                    </div>
                    {fn.description && (
                      <div style={{
                        fontSize: 10, opacity: 0.7,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {fn.description}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* ── Pin a View section ── */}
          <div style={{
            fontSize: 10, fontWeight: 600, color: C.darkMuted,
            letterSpacing: "0.06em", textTransform: "uppercase",
            marginBottom: 8, fontFamily: FONT,
          }}>
            Pin a View
          </div>
          {viewablePages.length === 0 && (
            <div style={{ fontSize: 12, color: C.darkMuted, fontFamily: FONT, padding: "8px 0" }}>
              No pages with views available
            </div>
          )}
          {viewablePages.map((page) => (
            <div key={page.id} style={{ marginBottom: 12 }}>
              <div style={{
                fontSize: 12, fontWeight: 600, color: C.darkText, fontFamily: FONT,
                marginBottom: 4, padding: "4px 0",
              }}>
                {page.name || "Untitled"}
              </div>
              {(page.views || []).map((view, vIdx) => (
                <button
                  key={vIdx}
                  onClick={() => onAddWidget({
                    type: "view",
                    pageId: page.id,
                    viewIndex: vIdx,
                    label: `${page.name} -- ${view.label || view.type}`,
                    widgetConfig: { ...viewPrefs.getEffectiveConfig(page.id, vIdx, view.config || {}) },
                  })}
                  style={{
                    width: "100%", background: "transparent",
                    border: `1px solid ${C.darkBorder}`,
                    borderRadius: RADIUS.md, padding: "6px 10px",
                    marginBottom: 4, cursor: "pointer", textAlign: "left",
                    fontFamily: FONT, fontSize: 11, color: C.darkMuted,
                    transition: "all 0.12s", outline: "none",
                    display: "flex", alignItems: "center", gap: 6,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = C.accent;
                    e.currentTarget.style.color = C.accent;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = C.darkBorder;
                    e.currentTarget.style.color = C.darkMuted;
                  }}
                >
                  <div style={{ width: 4, height: 4, borderRadius: "50%", background: C.accent, flexShrink: 0 }} />
                  {view.label || view.type}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
