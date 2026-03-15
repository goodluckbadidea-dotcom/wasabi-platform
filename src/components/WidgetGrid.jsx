// ─── Widget Grid ───
// Extracted from Dashboard.jsx. Dot-grid canvas with draggable, resizable widgets.
// Edit mode: jiggle animation, add/remove/reposition/resize widgets.
// Normal mode: read-only, click widget to navigate to full view.

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { IconPlus, IconEdit, IconChart, IconBolt, IconForm, IconFunction } from "../design/icons.jsx";
import { ANIM } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import DashboardWidget from "../core/DashboardWidget.jsx";
import MiniView from "../core/MiniView.jsx";
import PluginWidget from "../core/PluginWidget.jsx";
import * as api from "../lib/api.js";

const GRID = 20;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.08;
const CANVAS_SIZE = 10000;
const DRAG_THRESHOLD = 3;

function snap(val) { return Math.round(val / GRID) * GRID; }

const DEFAULT_SIZES = {
  view:     { w: 400, h: 300 },
  shortcut: { w: 180, h: 80 },
  text:     { w: 240, h: 160 },
  plugin:   { w: 320, h: 240 },
};

export default function WidgetGrid({ widgets = [], onUpdateWidgets }) {
  const { setActivePage } = usePlatform();

  const [editMode, setEditMode] = useState(false);
  const [widgetPickerOpen, setWidgetPickerOpen] = useState(false);

  // ── Canvas state (infinite pan/zoom) ──
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef(null);
  const transformRef = useRef(null);

  // ── Pan handlers ──
  const handleCanvasMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    // Only pan when clicking directly on the canvas background (not on a widget)
    if (e.target !== containerRef.current && e.target !== transformRef.current) return;
    e.preventDefault();
    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX, y: e.clientY,
      panX: pan.x, panY: pan.y,
    };
  }, [pan]);

  useEffect(() => {
    if (!isPanning) return;
    let hasDragged = false;

    const handleMouseMove = (e) => {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      if (!hasDragged && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      hasDragged = true;
      setPan({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      });
    };
    const handleMouseUp = () => setIsPanning(false);

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isPanning]);

  // ── Zoom toward cursor (pinch only) ──
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    // Only zoom on pinch gesture (ctrlKey is set by trackpad pinch).
    // Two-finger swipe (regular scroll) is blocked — use click+drag to pan.
    if (!e.ctrlKey) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Pinch deltaY is typically smaller, so use a larger step
    const delta = e.deltaY > 0 ? -ZOOM_STEP * 2 : ZOOM_STEP * 2;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + delta));
    const scale = newZoom / zoom;

    const newPanX = mouseX - scale * (mouseX - pan.x);
    const newPanY = mouseY - scale * (mouseY - pan.y);

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, [zoom, pan]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // ── Widget CRUD ──
  const handleAddWidget = useCallback((widgetConfig) => {
    const id = `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const defaults = DEFAULT_SIZES[widgetConfig.type] || DEFAULT_SIZES.view;
    // Place new widget at viewport center
    const rect = containerRef.current?.getBoundingClientRect();
    const viewCenterX = rect ? (rect.width / 2 - pan.x) / zoom : GRID * 2;
    const viewCenterY = rect ? (rect.height / 2 - pan.y) / zoom : GRID * 2;
    const newWidget = {
      id,
      x: snap(viewCenterX - defaults.w / 2),
      y: snap(viewCenterY - defaults.h / 2),
      w: defaults.w,
      h: defaults.h,
      ...widgetConfig,
    };
    onUpdateWidgets([...widgets, newWidget]);
    setWidgetPickerOpen(false);
  }, [widgets, onUpdateWidgets, pan, zoom]);

  const handleDeleteWidget = useCallback((widgetId) => {
    onUpdateWidgets(widgets.filter((w) => w.id !== widgetId));
  }, [widgets, onUpdateWidgets]);

  const handleReposition = useCallback((widgetId, newX, newY) => {
    onUpdateWidgets(widgets.map((w) => w.id === widgetId ? { ...w, x: newX, y: newY } : w));
  }, [widgets, onUpdateWidgets]);

  const handleResize = useCallback((widgetId, newW, newH) => {
    onUpdateWidgets(widgets.map((w) => w.id === widgetId ? { ...w, w: newW, h: newH } : w));
  }, [widgets, onUpdateWidgets]);

  const handleWidgetClick = useCallback((widget) => {
    if (widget.pageId) setActivePage(widget.pageId);
  }, [setActivePage]);

  // ── Render widget content ──
  const renderWidgetContent = (widget) => {
    if (widget.type === "view") {
      return (
        <MiniView
          pageId={widget.pageId}
          viewIndex={widget.viewIndex ?? 0}
          width={widget.w}
          height={widget.h - 28}
        />
      );
    }
    if (widget.type === "shortcut") {
      return (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100%", padding: "8px 12px", gap: 8,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: RADIUS.md,
            background: C.accent + "22",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <IconBolt size={14} color={C.accent} />
          </div>
          <span style={{
            fontSize: 12, fontFamily: FONT, fontWeight: 600,
            color: C.darkText, whiteSpace: "nowrap",
            overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {widget.label || "Shortcut"}
          </span>
        </div>
      );
    }
    if (widget.type === "text") {
      return (
        <div
          contentEditable={editMode}
          suppressContentEditableWarning
          onBlur={(e) => {
            const newContent = e.currentTarget.innerText;
            onUpdateWidgets(widgets.map((w) =>
              w.id === widget.id ? { ...w, content: newContent } : w
            ));
          }}
          style={{
            padding: "8px 12px", fontSize: 12, fontFamily: FONT,
            color: C.darkText, lineHeight: 1.5, height: "100%",
            overflowY: "auto", outline: "none",
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
          width={widget.w}
          height={widget.h - 28}
          refreshInterval={widget.refreshInterval}
        />
      );
    }
    return null;
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleCanvasMouseDown}
      style={{
        flex: 1, position: "relative", overflow: "hidden",
        backgroundColor: C.dark,
        minHeight: 300,
        cursor: isPanning ? "grabbing" : (editMode ? "default" : "grab"),
      }}
    >
      <style>{`
        @keyframes widgetEditPop {
          0% { transform: scale(1); }
          40% { transform: scale(1.015) rotate(0.3deg); }
          70% { transform: scale(0.995) rotate(-0.15deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
      `}</style>

      {/* ── Canvas transform layer (absolute so 10k size doesn't inflate parent) ── */}
      <div
        ref={transformRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          transformOrigin: "0 0",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          width: CANVAS_SIZE,
          height: CANVAS_SIZE,
          backgroundImage: `radial-gradient(circle, ${C.darkBorder} 1px, transparent 1px)`,
          backgroundSize: `${GRID}px ${GRID}px`,
        }}
      >
        {/* ── Widgets ── */}
        {widgets.map((widget, idx) => (
          <div key={widget.id} style={{ animation: ANIM.popIn(idx * 0.05) }}>
            <DashboardWidget
              widget={widget}
              editMode={editMode}
              zoom={zoom}
              onReposition={handleReposition}
              onResize={handleResize}
              onDelete={handleDeleteWidget}
              onClick={handleWidgetClick}
            >
              {renderWidgetContent(widget)}
            </DashboardWidget>
          </div>
        ))}
      </div>

      {/* ── Empty state (viewport overlay) ── */}
      {widgets.length === 0 && !editMode && (
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)", textAlign: "center",
          color: C.darkMuted, fontFamily: FONT,
          animation: ANIM.snapUp(0.1),
          zIndex: 100, pointerEvents: "auto",
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
      )}

      {/* ── Floating controls (top-right, viewport overlay) ── */}
      <div style={{
        position: "absolute", top: 12, right: 16,
        display: "flex", gap: 8, zIndex: 200,
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
            borderRadius: RADIUS.pill, padding: "6px 14px",
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
              borderRadius: RADIUS.pill, padding: "6px 14px",
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

      {/* ── Zoom controls (bottom-right, viewport overlay) ── */}
      <div style={{
        position: "absolute", bottom: 16, right: 16,
        display: "flex", gap: 4,
        background: C.darkSurf2, borderRadius: 8,
        border: `1px solid ${C.darkBorder}`, padding: 4,
        zIndex: 200,
      }}>
        <button
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP * 2))}
          style={getZoomBtnStyle()}
          title="Zoom out"
        >−</button>
        <span style={{
          padding: "4px 8px", fontSize: 11, color: C.darkMuted,
          fontFamily: FONT, minWidth: 40, textAlign: "center",
        }}>
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP * 2))}
          style={getZoomBtnStyle()}
          title="Zoom in"
        >+</button>
        <button
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
          style={{ ...getZoomBtnStyle(), fontSize: 10, padding: "4px 8px" }}
          title="Reset view"
        >⟳</button>
      </div>

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
  const [pluginFunctions, setPluginFunctions] = useState([]);
  const [loadingPlugins, setLoadingPlugins] = useState(true);

  // Fetch custom functions that can serve as plugins
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // First try fetching only plugin-type functions
        const result = await api.listCustomFunctions({ type: "plugin" });
        const fns = result?.entries || result?.functions || result?.data || result?.rows || [];
        if (!cancelled) setPluginFunctions(fns);

        // If that returned nothing, try all functions and filter client-side
        if (fns.length === 0) {
          const allResult = await api.listCustomFunctions();
          const allFns = allResult?.entries || allResult?.functions || allResult?.data || allResult?.rows || [];
          const plugins = allFns.filter(
            (f) => f.type === "plugin" || f.meta?.widget === true
          );
          if (!cancelled) setPluginFunctions(plugins);
        }
      } catch {
        // No plugins available — that's fine
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
          background: "rgba(0,0,0,0.4)", zIndex: 299,
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

// ── Zoom button styling (matches NodeCanvas) ──
function getZoomBtnStyle() {
  return {
    background: "transparent",
    border: "none",
    color: C.darkText,
    fontSize: 14,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: 4,
    fontFamily: FONT,
    outline: "none",
  };
}
