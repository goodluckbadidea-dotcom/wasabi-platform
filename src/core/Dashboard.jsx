// ─── Dashboard ───
// Dot-grid canvas with draggable, resizable widgets.
// Edit mode: jiggle animation, add/remove/reposition/resize widgets.
// Normal mode: read-only, click widget to navigate to full view.

import React, { useState, useCallback, useMemo } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { IconPlus, IconEdit, IconChart, IconBolt, IconForm } from "../design/icons.jsx";
import { ANIM } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import DashboardWidget from "./DashboardWidget.jsx";
import MiniView from "./MiniView.jsx";

const GRID = 20;

// Default widget sizes by type
const DEFAULT_SIZES = {
  view:     { w: 400, h: 300 },
  shortcut: { w: 180, h: 80 },
  text:     { w: 240, h: 160 },
};

export default function Dashboard({
  dashboardConfig,
  isGlobal,
}) {
  const { updatePageConfig, setActivePage } = usePlatform();

  const [editMode, setEditMode] = useState(false);
  const [widgetPickerOpen, setWidgetPickerOpen] = useState(false);

  const widgets = dashboardConfig?.widgets || [];

  // ── Widget CRUD ──
  const updateWidgets = useCallback((newWidgets) => {
    if (!dashboardConfig?.id) return;
    updatePageConfig(dashboardConfig.id, { widgets: newWidgets });
  }, [dashboardConfig, updatePageConfig]);

  const handleAddWidget = useCallback((widgetConfig) => {
    const id = `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const defaults = DEFAULT_SIZES[widgetConfig.type] || DEFAULT_SIZES.view;
    const newWidget = {
      id,
      x: GRID * 2,
      y: GRID * 2 + widgets.length * GRID * 2,
      w: defaults.w,
      h: defaults.h,
      ...widgetConfig,
    };
    updateWidgets([...widgets, newWidget]);
    setWidgetPickerOpen(false);
  }, [widgets, updateWidgets]);

  const handleDeleteWidget = useCallback((widgetId) => {
    updateWidgets(widgets.filter((w) => w.id !== widgetId));
  }, [widgets, updateWidgets]);

  const handleReposition = useCallback((widgetId, newX, newY) => {
    updateWidgets(widgets.map((w) => w.id === widgetId ? { ...w, x: newX, y: newY } : w));
  }, [widgets, updateWidgets]);

  const handleResize = useCallback((widgetId, newW, newH) => {
    updateWidgets(widgets.map((w) => w.id === widgetId ? { ...w, w: newW, h: newH } : w));
  }, [widgets, updateWidgets]);

  // ── Navigate to full page/view on widget click ──
  const handleWidgetClick = useCallback((widget) => {
    if (widget.pageId) {
      setActivePage(widget.pageId);
    }
  }, [setActivePage]);

  // ── Render widget content ──
  const renderWidgetContent = (widget) => {
    if (widget.type === "view") {
      return (
        <MiniView
          pageId={widget.pageId}
          viewIndex={widget.viewIndex ?? 0}
          width={widget.w}
          height={widget.h - 28} // subtract title bar
        />
      );
    }
    if (widget.type === "shortcut") {
      return (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          padding: "8px 12px",
          gap: 8,
        }}>
          <div style={{
            width: 28, height: 28,
            borderRadius: RADIUS.md,
            background: C.accent + "22",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
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
            updateWidgets(widgets.map((w) =>
              w.id === widget.id ? { ...w, content: newContent } : w
            ));
          }}
          style={{
            padding: "8px 12px",
            fontSize: 12,
            fontFamily: FONT,
            color: C.darkText,
            lineHeight: 1.5,
            height: "100%",
            overflowY: "auto",
            outline: "none",
            cursor: editMode ? "text" : "default",
          }}
        >
          {widget.content || "Click to edit..."}
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{
      flex: 1,
      position: "relative",
      overflow: "auto",
      // Dot grid background
      backgroundImage: `radial-gradient(circle, ${C.darkBorder} 1px, transparent 1px)`,
      backgroundSize: `${GRID}px ${GRID}px`,
      backgroundColor: C.dark,
    }}>
      {/* ── Jiggle animation (injected once) ── */}
      <style>{`
        @keyframes widgetJiggle {
          0% { transform: rotate(-0.4deg); }
          100% { transform: rotate(0.4deg); }
        }
      `}</style>

      {/* ── Widgets ── */}
      {widgets.map((widget, idx) => (
        <div key={widget.id} style={{ animation: ANIM.popIn(idx * 0.05) }}>
          <DashboardWidget
            widget={widget}
            editMode={editMode}
            onReposition={handleReposition}
            onResize={handleResize}
            onDelete={handleDeleteWidget}
            onClick={handleWidgetClick}
          >
            {renderWidgetContent(widget)}
          </DashboardWidget>
        </div>
      ))}

      {/* ── Empty state ── */}
      {widgets.length === 0 && !editMode && (
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          textAlign: "center",
          color: C.darkMuted,
          fontFamily: FONT,
          animation: ANIM.snapUp(0.1),
        }}>
          <div style={{ marginBottom: 12, opacity: 0.3 }}><IconChart size={32} color={C.darkMuted} /></div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
            No widgets yet
          </div>
          <div style={{ fontSize: 12, marginBottom: 16, opacity: 0.7 }}>
            Add widgets to pin views from your pages
          </div>
          <button
            onClick={() => { setEditMode(true); setWidgetPickerOpen(true); }}
            style={{
              background: C.accent,
              color: "#fff",
              border: "none",
              borderRadius: RADIUS.pill,
              padding: "8px 20px",
              fontSize: 12,
              fontFamily: FONT,
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <IconPlus size={10} color="#fff" />
            Add Widget
          </button>
        </div>
      )}

      {/* ── Floating controls (top-right) ── */}
      <div style={{
        position: "sticky",
        top: 12,
        float: "right",
        marginRight: 16,
        display: "flex",
        gap: 8,
        zIndex: 200,
      }}>
        {/* Edit / Done toggle */}
        <button
          onClick={() => {
            setEditMode((m) => !m);
            if (editMode) setWidgetPickerOpen(false);
          }}
          style={{
            background: editMode ? C.accent : C.darkSurf2,
            color: editMode ? "#fff" : C.darkMuted,
            border: `1px solid ${editMode ? C.accent : C.darkBorder}`,
            borderRadius: RADIUS.pill,
            padding: "6px 14px",
            fontSize: 11,
            fontFamily: FONT,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
            boxShadow: SHADOW.card,
          }}
        >
          <IconEdit size={11} color={editMode ? "#fff" : C.darkMuted} />
          {editMode ? "Done" : "Edit"}
        </button>

        {/* Add widget (edit mode) */}
        {editMode && (
          <button
            onClick={() => setWidgetPickerOpen(true)}
            style={{
              background: C.darkSurf2,
              color: C.darkMuted,
              border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.pill,
              padding: "6px 14px",
              fontSize: 11,
              fontFamily: FONT,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              boxShadow: SHADOW.card,
            }}
          >
            <IconPlus size={10} color={C.darkMuted} />
            Add Widget
          </button>
        )}
      </div>

      {/* ── Widget Picker (placeholder — replaced in Phase 2F) ── */}
      {widgetPickerOpen && (
        <WidgetPickerInline
          onClose={() => setWidgetPickerOpen(false)}
          onAddWidget={handleAddWidget}
        />
      )}
    </div>
  );
}

// ── Inline Widget Picker (temporary — replaced by full WidgetPicker in Phase 2F) ──
function WidgetPickerInline({ onClose, onAddWidget }) {
  const { pages, pageTree } = usePlatform();

  // Get all viewable pages (pages with views)
  const viewablePages = useMemo(() => {
    return pages.filter(
      (p) => p.type === "page" && p.views?.length > 0 &&
        p.page_type !== "dashboard" && p.pageType !== "dashboard"
    );
  }, [pages]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 299,
          animation: ANIM.backdropFade,
        }}
      />
      <div style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 380,
        background: C.darkSurf2,
        borderLeft: `1px solid ${C.darkBorder}`,
        boxShadow: SHADOW.dropdown,
        zIndex: 300,
        display: "flex",
        flexDirection: "column",
        animation: ANIM.snapInRight(),
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: `1px solid ${C.darkBorder}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.darkText, fontFamily: FONT }}>
            Add Widget
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
          >
            <span style={{ color: C.darkMuted, fontSize: 14 }}>✕</span>
          </button>
        </div>

        {/* Quick options */}
        <div style={{ padding: "12px 20px", borderBottom: `1px solid ${C.darkBorder}` }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.darkMuted, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8, fontFamily: FONT }}>
            Quick Add
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => onAddWidget({ type: "shortcut", label: "Shortcut" })}
              style={getQuickBtnStyle()}
            >
              <IconBolt size={12} color={C.darkMuted} /> Shortcut
            </button>
            <button
              onClick={() => onAddWidget({ type: "text", label: "Note", content: "" })}
              style={getQuickBtnStyle()}
            >
              <IconForm size={12} color={C.darkMuted} /> Text Block
            </button>
          </div>
        </div>

        {/* Page / View browser */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.darkMuted, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8, fontFamily: FONT }}>
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
                    label: `${page.name} — ${view.label || view.type}`,
                  })}
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: `1px solid ${C.darkBorder}`,
                    borderRadius: RADIUS.md,
                    padding: "6px 10px",
                    marginBottom: 4,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: FONT,
                    fontSize: 11,
                    color: C.darkMuted,
                    transition: "all 0.12s",
                    outline: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
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

function getQuickBtnStyle() {
  return {
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
}
