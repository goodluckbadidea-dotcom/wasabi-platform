// ─── Split Pane ───
// Resizable two-pane layout with a draggable divider, plus per-side
// maximize support via `panelMode`.
//
// Used by App.jsx as the dual-pane content shell:
//   left = Tasks / Wasabi Chat / Notes (personal context surface)
//   right = Tables, Dashboard, Calendar, Inbox, etc. (workspace content)
//
// `panelMode`:
//   "split"     — both panes visible with draggable divider (default)
//   "left-max"  — left pane fills, right hidden
//   "right-max" — right pane fills, left hidden
//
// Legacy `leftCollapsed` prop is still accepted for backwards
// compatibility — it maps to `panelMode === "right-max"`.

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
  // New API (preferred)
  panelMode,
  onPanelModeChange,
  // Legacy props — still honored for back-compat
  leftCollapsed,
  onLeftCollapsedChange,
  isNarrow = false,
}) {
  // Resolve mode: prefer explicit panelMode, fall back to legacy leftCollapsed.
  const mode =
    panelMode === "split" || panelMode === "left-max" || panelMode === "right-max"
      ? panelMode
      : leftCollapsed
      ? "right-max"
      : "split";

  const setMode = useCallback((nextMode) => {
    if (typeof onPanelModeChange === "function") {
      onPanelModeChange(nextMode);
    } else if (typeof onLeftCollapsedChange === "function") {
      // Map back to the legacy boolean shape.
      onLeftCollapsedChange(nextMode === "right-max");
    }
  }, [onPanelModeChange, onLeftCollapsedChange]);

  const containerRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, containerLeft: 0, containerWidth: 0 });
  const [dragging, setDragging] = useState(false);

  // ── Divider drag handler ──
  const handleDragStart = useCallback((e) => {
    if (isNarrow || mode !== "split") return;
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
  }, [isNarrow, mode]);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e) => {
      const { containerLeft, containerWidth } = dragRef.current;
      if (containerWidth <= 0) return;
      const localX = (e.clientX ?? e.touches?.[0]?.clientX ?? 0) - containerLeft;
      let newRatio = localX / containerWidth;
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
    // On narrow, "left-max" would hide the right pane entirely; clamp to
    // drawer behavior (right pane fills, left pane is drawer-overlayed).
    const drawerOpen = mode === "left-max" || mode === "split";
    return (
      <div ref={containerRef} style={{ flex: 1, display: "flex", position: "relative", minWidth: 0, overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          {rightContent}
        </div>

        {/* Toggle pill — opens the left-pane drawer */}
        {!drawerOpen && (
          <button
            onClick={() => setMode("split")}
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

        {drawerOpen && (
          <>
            <div
              onClick={() => setMode("right-max")}
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

  // ── Tablet/desktop mode ──
  const showLeft = mode !== "right-max";
  const showRight = mode !== "left-max";
  const showDivider = mode === "split";

  // Width math for the split state. Maximized states use flex:1 on the
  // visible pane so the hidden side gets no space at all.
  const leftPercent = showLeft ? Math.max(0, Math.min(1, ratio)) * 100 : 0;
  const rightPercent = 100 - leftPercent;

  return (
    <div ref={containerRef} style={{ flex: 1, display: "flex", minWidth: 0, overflow: "hidden", position: "relative" }}>
      {/* Left pane */}
      {showLeft && (
        <div
          style={{
            width: mode === "left-max" ? "100%" : `calc(${leftPercent}% - ${DIVIDER_WIDTH / 2}px)`,
            flex: mode === "left-max" ? "1 1 auto" : "0 0 auto",
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
            background: C.darkSurf,
            borderRight: showDivider ? `1px solid ${C.darkBorder}` : "none",
          }}
        >
          {leftContent}
        </div>
      )}

      {/* Divider — only in split mode */}
      {showDivider && (
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
      {showRight && (
        <div
          style={{
            flex: mode === "split" ? `0 0 calc(${rightPercent}% - ${DIVIDER_WIDTH / 2}px)` : "1 1 auto",
            width: mode === "right-max" ? "100%" : undefined,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {rightContent}
        </div>
      )}

      {/* Reopen pill — when a pane is hidden, a small pill at that pane's
          edge brings the layout back to "split". Keeps the implicit
          "drag-to-collapse" UX from the previous version working. */}
      {mode === "right-max" && (
        <button
          onClick={() => setMode("split")}
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
      {mode === "left-max" && (
        <button
          onClick={() => setMode("split")}
          title="Show right pane"
          aria-label="Show right pane"
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            width: 28, height: 36,
            borderTopLeftRadius: RADIUS.lg,
            borderBottomLeftRadius: RADIUS.lg,
            borderTopRightRadius: RADIUS.sm,
            borderBottomRightRadius: RADIUS.sm,
            background: C.darkSurf,
            border: `1px solid ${C.darkBorder}`,
            borderRight: "none",
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
            <path d="M10.5 3L5.5 8L10.5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
