// ─── Dashboard Widget ───
// Wrapper for a single widget on the dashboard dot grid.
// Handles: title bar (drag), resize handles, jiggle animation, delete button.
// Content rendered by parent via children prop.

import React, { useState, useCallback, useRef, useEffect } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { IconClose } from "../design/icons.jsx";

const GRID = 20; // snap unit in px

// Snap value to nearest grid
function snap(val) {
  return Math.round(val / GRID) * GRID;
}

// ── Widget type constraints ──
const SIZE_CONSTRAINTS = {
  view:     { minW: 200, minH: 200, maxW: 1200, maxH: 800 },
  shortcut: { minW: 120, minH: 80,  maxW: 300,  maxH: 120 },
  text:     { minW: 120, minH: 80,  maxW: 600,  maxH: 400 },
};

function getConstraints(type) {
  return SIZE_CONSTRAINTS[type] || SIZE_CONSTRAINTS.view;
}

export default function DashboardWidget({
  widget,         // { id, type, pageId, viewIndex, x, y, w, h, content, label }
  editMode,
  onReposition,   // (id, newX, newY) => void
  onResize,       // (id, newW, newH) => void
  onDelete,       // (id) => void
  onClick,        // (widget) => void — navigate to full view
  children,       // rendered widget content
}) {
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
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
      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;
      const newX = snap(Math.max(0, ds.origX + dx));
      const newY = snap(Math.max(0, ds.origY + dy));
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
  }, [dragging, widget.id, onReposition]);

  // ── Resize (bottom-right corner) ──
  const handleResizeStart = useCallback((e) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    resizeStart.current = { startX: e.clientX, startY: e.clientY, origW: widget.w, origH: widget.h };
    setResizing(true);
  }, [editMode, widget.w, widget.h]);

  useEffect(() => {
    if (!resizing) return;
    const handleMove = (e) => {
      const rs = resizeStart.current;
      if (!rs) return;
      const dx = e.clientX - rs.startX;
      const dy = e.clientY - rs.startY;
      const newW = snap(Math.max(constraints.minW, Math.min(constraints.maxW, rs.origW + dx)));
      const newH = snap(Math.max(constraints.minH, Math.min(constraints.maxH, rs.origH + dy)));
      onResize?.(widget.id, newW, newH);
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
  }, [resizing, widget.id, constraints, onResize]);

  // ── Click handler (navigate in normal mode) ──
  const handleClick = useCallback(() => {
    if (!editMode && widget.type === "view" && onClick) {
      onClick(widget);
    }
  }, [editMode, widget, onClick]);

  return (
    <div
      onClick={handleClick}
      style={{
        position: "absolute",
        left: widget.x,
        top: widget.y,
        width: widget.w,
        height: widget.h,
        background: C.darkSurf,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg,
        boxShadow: SHADOW.card,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        cursor: editMode ? (dragging ? "grabbing" : "default") : (widget.type === "view" ? "pointer" : "default"),
        animation: editMode ? "widgetJiggle 0.3s ease-in-out infinite alternate" : "none",
        transition: dragging || resizing ? "none" : "box-shadow 0.15s",
        userSelect: editMode ? "none" : "auto",
        zIndex: dragging || resizing ? 100 : 1,
      }}
    >
      {/* ── Title bar ── */}
      <div
        onMouseDown={handleDragStart}
        style={{
          flexShrink: 0,
          height: 28,
          display: "flex",
          alignItems: "center",
          padding: "0 8px",
          gap: 6,
          background: C.darkSurf2,
          borderBottom: `1px solid ${C.darkBorder}`,
          cursor: editMode ? "grab" : "default",
        }}
      >
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

      {/* ── Content area ── */}
      <div style={{
        flex: 1,
        overflow: "hidden",
        position: "relative",
        pointerEvents: editMode ? "none" : "auto",
      }}>
        {children}
      </div>

      {/* ── Resize handle (bottom-right, edit mode only) ── */}
      {editMode && (
        <div
          onMouseDown={handleResizeStart}
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: 16,
            height: 16,
            cursor: "nwse-resize",
            zIndex: 10,
          }}
        >
          {/* Grip dots */}
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
