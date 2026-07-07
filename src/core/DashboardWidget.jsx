// ─── Dashboard Widget ───
// Wrapper for a single widget on the dashboard dot grid.
// Handles: title bar (drag), resize handles, jiggle animation, delete button.
// Content rendered by parent via children prop.

import React, { useState, useCallback, useRef, useEffect } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { IconClose, IconExpand } from "../design/icons.jsx";

const GRID = 20; // snap unit in px

// Snap value to nearest grid
function snap(val) {
  return Math.round(val / GRID) * GRID;
}

// ── Widget type constraints (height-only in grid mode) ──
const MAX_VH = 0.85;
function maxH() { return Math.round((window.innerHeight || 900) * MAX_VH); }

const SIZE_CONSTRAINTS = {
  view:     { minH: 200, maxH: maxH },
  shortcut: { minH: 60,  maxH: 160  },
  text:     { minH: 80,  maxH: 400  },
  plugin:   { minH: 120, maxH: maxH },
};

function getConstraints(type) {
  const c = SIZE_CONSTRAINTS[type] || SIZE_CONSTRAINTS.view;
  return { minH: c.minH, maxH: typeof c.maxH === "function" ? c.maxH() : c.maxH };
}

export default function DashboardWidget({
  widget,         // { id, type, pageId, viewIndex, x, y, w, h, content, label, colSpan }
  editMode,
  zoom = 1,       // canvas zoom level — drag/resize deltas divided by this
  gridMode = false, // true = responsive grid layout (no absolute positioning)
  gridGap = 16,   // grid gap in px (for colSpan snapping)
  onReposition,   // (id, newX, newY) => void
  onResize,       // (id, newColSpan, newH) => void
  onDelete,       // (id) => void
  onToggleSpan,   // (id) => void — toggle colSpan 1↔2
  onToggleCollapse, // (id) => void — toggle widget.collapsed on title-bar click
  onClick,        // (widget) => void — navigate to full view
  children,       // rendered widget content
}) {
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const widgetRef = useRef(null);
  const dragStart = useRef(null);
  const resizeStart = useRef(null);

  const constraints = getConstraints(widget.type);

  // ── Drag to reposition (title bar) ──
  const handleDragStart = useCallback((e) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    dragStart.current = { startX: e.clientX, startY: e.clientY, origX: widget.x, origY: widget.y };
    setDragging(true);
  }, [editMode, widget.x, widget.y]);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e) => {
      const ds = dragStart.current;
      if (!ds) return;
      const dx = (e.clientX - ds.startX) / zoom;
      const dy = (e.clientY - ds.startY) / zoom;
      const newX = snap(ds.origX + dx);
      const newY = snap(ds.origY + dy);
      onReposition?.(widget.id, newX, newY);
    };
    const handleUp = () => {
      setDragging(false);
      dragStart.current = null;
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, widget.id, onReposition, zoom]);

  // ── Resize (bottom-right corner — height + colSpan) ──
  const handleResizeStart = useCallback((e) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    // Measure current widget width and derive single-column width
    const el = widgetRef.current;
    const origW = el ? el.offsetWidth : 400;
    const origColSpan = widget.colSpan || 1;
    const singleColW = origColSpan > 1
      ? (origW - (origColSpan - 1) * gridGap) / origColSpan
      : origW;
    // Detect max columns from parent grid
    const gridEl = el?.parentElement?.parentElement;
    const gridCols = gridEl
      ? getComputedStyle(gridEl).gridTemplateColumns.split(" ").length
      : 4;
    resizeStart.current = {
      startX: e.clientX, startY: e.clientY,
      origH: widget.h, origW, origColSpan,
      singleColW, maxCols: gridCols,
    };
    setResizing(true);
  }, [editMode, widget.h, widget.colSpan, gridGap]);

  useEffect(() => {
    if (!resizing) return;
    const handleMove = (e) => {
      const rs = resizeStart.current;
      if (!rs) return;
      // Height
      const dy = (e.clientY - rs.startY) / zoom;
      const newH = snap(Math.max(constraints.minH, Math.min(constraints.maxH, rs.origH + dy)));
      // ColSpan from horizontal drag
      let newColSpan = rs.origColSpan;
      if (gridMode) {
        const dx = (e.clientX - rs.startX) / zoom;
        const targetW = rs.origW + dx;
        // n columns = n * singleColW + (n-1) * gap
        const raw = (targetW + rs.singleColW * 0.3) / (rs.singleColW + gridGap);
        newColSpan = Math.max(1, Math.min(rs.maxCols, Math.round(raw)));
      }
      onResize?.(widget.id, newColSpan, newH);
    };
    const handleUp = () => {
      setResizing(false);
      resizeStart.current = null;
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [resizing, widget.id, constraints, onResize, zoom, gridMode, gridGap]);

  return (
    <div
      ref={widgetRef}
      style={{
        ...(gridMode
          ? { position: "relative", width: "100%", height: widget.collapsed ? 28 : (widget.h || 360) }
          : { position: "absolute", left: widget.x, top: widget.y, width: widget.w, height: widget.collapsed ? 28 : widget.h }
        ),
        background: C.darkSurf,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg,
        boxShadow: SHADOW.card,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        cursor: editMode ? (dragging ? "grabbing" : "default") : "default",
        animation: editMode ? "widgetEditPop 0.3s cubic-bezier(0.34,1.56,0.64,1) both" : "none",
        transition: dragging || resizing ? "none" : "height 160ms ease, box-shadow 0.15s, border-color 0.15s",
        borderColor: editMode ? C.accent + "55" : C.darkBorder,
        userSelect: editMode ? "none" : "auto",
        zIndex: dragging || resizing ? 100 : 1,
      }}
    >
      {/* ── Title bar ── */}
      {/* onClick collapses in normal mode; onMouseDown initiates drag in
          edit mode. Buttons inside stopPropagation so they don't trigger
          collapse. */}
      <div
        onMouseDown={handleDragStart}
        onClick={(e) => {
          if (editMode) return;
          if (!onToggleCollapse) return;
          onToggleCollapse(widget.id);
        }}
        style={{
          flexShrink: 0,
          height: 28,
          display: "flex",
          alignItems: "center",
          padding: "0 8px",
          gap: 6,
          background: C.darkSurf2,
          borderBottom: widget.collapsed ? "none" : `1px solid ${C.darkBorder}`,
          cursor: editMode ? "grab" : (onToggleCollapse ? "pointer" : "default"),
        }}
      >
        {/* Collapse chevron — rotates 90° when collapsed */}
        {onToggleCollapse && (
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 10, height: 10, flexShrink: 0,
            transform: widget.collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 140ms ease",
            opacity: 0.5,
          }}>
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
              <path d="M2 3.5L5 6.5L8 3.5" stroke={C.darkMuted} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}

        <span style={{
          flex: 1,
          fontSize: 10,
          fontFamily: FONT,
          fontWeight: 600,
          color: C.darkMuted,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {widget.label || widget.type}
        </span>

        {/* Open in workspace button (normal mode, view widgets only) */}
        {!editMode && widget.type === "view" && onClick && (
          <button
            onClick={(e) => { e.stopPropagation(); onClick(widget); }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "2px 4px", opacity: 0.4, transition: "opacity 0.12s",
              display: "flex", alignItems: "center", flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; }}
            title="Open in workspace"
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke={C.darkMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 1h4v4" />
              <path d="M11 1L5 7" />
              <path d="M9 7v4H1V3h4" />
            </svg>
          </button>
        )}

        {/* Expand/collapse toggle (edit mode only, grid mode) */}
        {editMode && gridMode && onToggleSpan && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSpan(widget.id); }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: 2, display: "flex", alignItems: "center",
              opacity: (widget.colSpan || 1) >= 2 ? 0.9 : 0.4,
              transition: "opacity 0.12s", outline: "none", flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = (widget.colSpan || 1) >= 2 ? "0.9" : "0.4"; }}
            title={(widget.colSpan || 1) >= 2 ? "Half width" : "Full width"}
          >
            <IconExpand size={10} color={(widget.colSpan || 1) >= 2 ? C.accent : C.darkMuted} />
          </button>
        )}

        {/* Delete button (edit mode only) */}
        {editMode && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(widget.id);
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 2,
              display: "flex",
              alignItems: "center",
              opacity: 0.5,
              transition: "opacity 0.12s",
              outline: "none",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
            title="Remove widget"
          >
            <IconClose size={10} color={C.darkMuted} />
          </button>
        )}
      </div>

      {/* ── Content area ── (hidden when collapsed to just the title bar) */}
      {!widget.collapsed && (
        <div style={{
          flex: 1,
          overflow: "auto",
          position: "relative",
          pointerEvents: editMode ? "none" : "auto",
        }}>
          {children}
        </div>
      )}

      {/* ── Resize handle (bottom-right corner, edit mode, not collapsed) ── */}
      {editMode && !widget.collapsed && (
        <div
          onMouseDown={handleResizeStart}
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: 18,
            height: 18,
            cursor: "nwse-resize",
            zIndex: 10,
          }}
        >
          {/* Diagonal grip dots */}
          <svg width="12" height="12" viewBox="0 0 12 12" style={{ position: "absolute", right: 2, bottom: 2 }}>
            <circle cx="4" cy="10" r="1.2" fill={C.darkBorder} />
            <circle cx="8" cy="10" r="1.2" fill={C.darkBorder} />
            <circle cx="8" cy="6" r="1.2" fill={C.darkBorder} />
          </svg>
        </div>
      )}
    </div>
  );
}
