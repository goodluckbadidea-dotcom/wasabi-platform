// ─── Split Pane ───
// Resizable two-pane layout with a draggable divider, collapsible left pane,
// and an iPad-portrait drawer mode where the left pane overlays the right.
//
// Used by App.jsx as the dual-pane content shell:
//   left = Tasks / Wasabi Chat / Notes (personal context surface)
//   right = Tables, Dashboard, Calendar, Inbox, etc. (workspace content)

import React, { useCallback, useEffect, useRef, useState } from "react";
import { C, RADIUS, Z, SHADOW, BP } from "../design/tokens.js";

const MIN_PANE_PX = 280;
const DIVIDER_WIDTH = 5;
const DRAWER_WIDTH = 360;

export default function SplitPane({
  leftContent,
  rightContent,
  ratio,
  onRatioChange,
  leftCollapsed,
  onLeftCollapsedChange,
  isNarrow = false,
}) {
  const containerRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, containerLeft: 0, containerWidth: 0 });
  const [dragging, setDragging] = useState(false);

  // ── Divider drag handler ──
  // mousemove computes the new ratio from cursor X relative to the container.
  // Snaps to MIN_PANE_PX on either side; below that, the user can drag through
  // to collapse the left pane entirely.
  const handleDragStart = useCallback((e) => {
    if (isNarrow) return;
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      containerLeft: rect.left,
      containerWidth: rect.width,
    };
    setDragging(true);
  }, [isNarrow]);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e) => {
      const { containerLeft, containerWidth } = dragRef.current;
      if (containerWidth <= 0) return;
      const localX = (e.clientX ?? e.touches?.[0]?.clientX ?? 0) - containerLeft;
      let newRatio = localX / containerWidth;
      // Clamp to MIN_PANE_PX on each side
      const minLeftRatio = MIN_PANE_PX / containerWidth;
      const minRightRatio = MIN_PANE_PX / containerWidth;
      if (newRatio < minLeftRatio) newRatio = minLeftRatio;
      if (newRatio > 1 - minRightRatio) newRatio = 1 - minRightRatio;
      onRatioChange?.(newRatio);
    };
    const handleEnd = () => {
      dragRef.current.active = false;
      setDragging(false);
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleEnd);
    document.addEventListener("touchmove", handleMove);
    document.addEventListener("touchend", handleEnd);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleEnd);
      document.removeEventListener("touchmove", handleMove);
      document.removeEventListener("touchend", handleEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, onRatioChange]);

  // ── Portrait (narrow) mode: drawer overlay + toggle pill ──
  if (isNarrow) {
    return (
      <div ref={containerRef} style={{ flex: 1, display: "flex", position: "relative", minWidth: 0, overflow: "hidden" }}>
        {/* Right pane fills the canvas */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          {rightContent}
        </div>

        {/* Toggle pill: floating button at the left edge that opens the drawer */}
        {leftCollapsed && (
          <button
            onClick={() => onLeftCollapsedChange?.(false)}
            title="Show left pane"
            aria-label="Show left pane"
            style={{
              position: "absolute",
              left: 8,
              top: "50%",
              transform: "translateY(-50%)",
              width: 36, height: 36,
              borderRadius: "50%",
              background: C.darkSurf,
              border: `1px solid ${C.darkBorder}`,
              boxShadow: SHADOW.cardMaterial,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: Z.sticky,
              color: C.darkMuted,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M5.5 3L10.5 8L5.5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        {/* Drawer overlay (when expanded on narrow viewports) */}
        {!leftCollapsed && (
          <>
            <div
              onClick={() => onLeftCollapsedChange?.(true)}
              style={{
                position: "absolute",
                inset: 0,
                background: C.overlayBg,
                zIndex: Z.panel,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 0, left: 0, bottom: 0,
                width: `min(${DRAWER_WIDTH}px, 85vw)`,
                background: C.darkSurf,
                borderRight: `1px solid ${C.darkBorder}`,
                boxShadow: SHADOW.dropdown,
                zIndex: Z.panel + 1,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              {leftContent}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Tablet/desktop mode: inline split with draggable divider ──
  const leftPercent = leftCollapsed ? 0 : Math.max(0, Math.min(1, ratio)) * 100;
  const rightPercent = 100 - leftPercent;

  return (
    <div ref={containerRef} style={{ flex: 1, display: "flex", minWidth: 0, overflow: "hidden", position: "relative" }}>
      {/* Left pane */}
      {!leftCollapsed && (
        <div
          style={{
            width: `calc(${leftPercent}% - ${DIVIDER_WIDTH / 2}px)`,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
            background: C.darkSurf,
            borderRight: `1px solid ${C.darkBorder}`,
          }}
        >
          {leftContent}
        </div>
      )}

      {/* Divider */}
      {!leftCollapsed && (
        <div
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
          style={{
            width: DIVIDER_WIDTH,
            cursor: "col-resize",
            background: dragging ? C.accent + "44" : "transparent",
            transition: "background 0.15s",
            flexShrink: 0,
            zIndex: 1,
          }}
          onMouseEnter={(e) => { if (!dragging) e.currentTarget.style.background = C.accent + "22"; }}
          onMouseLeave={(e) => { if (!dragging) e.currentTarget.style.background = "transparent"; }}
        />
      )}

      {/* Right pane */}
      <div
        style={{
          flex: leftCollapsed ? 1 : `0 0 calc(${rightPercent}% - ${DIVIDER_WIDTH / 2}px)`,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {rightContent}
      </div>

      {/* Collapsed-pane reopen pill (left edge) */}
      {leftCollapsed && (
        <button
          onClick={() => onLeftCollapsedChange?.(false)}
          title="Show left pane"
          aria-label="Show left pane"
          style={{
            position: "absolute",
            left: 8,
            top: "50%",
            transform: "translateY(-50%)",
            width: 28, height: 36,
            borderTopRightRadius: RADIUS.lg,
            borderBottomRightRadius: RADIUS.lg,
            borderTopLeftRadius: RADIUS.sm,
            borderBottomLeftRadius: RADIUS.sm,
            background: C.darkSurf,
            border: `1px solid ${C.darkBorder}`,
            borderLeft: "none",
            boxShadow: SHADOW.cardMaterial,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: Z.sticky,
            color: C.darkMuted,
            opacity: 0.85,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.85"; }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M5.5 3L10.5 8L5.5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
