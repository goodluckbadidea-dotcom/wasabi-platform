// ─── Panel Header ───
// Shared 48-px header strip used by every panel feature so that the
// left and right panels look visually cohesive. Replaces each feature's
// own internal title row.
//
// Layout:
//   [accent icon] [title or breadcrumb] [feature actions] [maximize]
//
// Reference design = the original TasksView header. All features should
// route their title/icon/actions through this component.

import React, { useState } from "react";
import { C, FONT_DISPLAY, FONT, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { IconExpand, IconCollapse } from "../design/icons.jsx";

export const PANEL_HEADER_HEIGHT = 48;

export default function PanelHeader({
  icon,           // React node — usually an accent-colored SVG (kept on every header)
  title,          // string — used when no customTitle is provided
  customTitle,    // React node — replaces `title` (e.g. <Breadcrumb />)
  side = "right", // "left" | "right" — drives which panel the maximize toggle controls
  children,       // feature-specific action buttons (rendered before the maximize button)
}) {
  const { panelMode, setPanelMode } = usePlatform();
  const isMaxed = side === "left"
    ? panelMode === "left-max"
    : panelMode === "right-max";

  const onToggleMax = () => {
    if (side === "left") {
      setPanelMode(panelMode === "left-max" ? "split" : "left-max");
    } else {
      setPanelMode(panelMode === "right-max" ? "split" : "right-max");
    }
  };

  return (
    <div style={{
      flexShrink: 0,
      height: PANEL_HEADER_HEIGHT,
      padding: "0 16px 0 20px",
      borderBottom: `1px solid ${C.darkBorder}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      background: C.darkSurf,
      gap: 10,
    }}>
      {/* Left side: icon + title */}
      <div style={{
        fontSize: 18,
        fontWeight: 600,
        fontFamily: FONT_DISPLAY,
        color: C.darkText,
        display: "flex",
        alignItems: "center",
        gap: 10,
        minWidth: 0,
        flex: 1,
        overflow: "hidden",
      }}>
        {icon}
        {customTitle ? (
          <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>{customTitle}</div>
        ) : (
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </span>
        )}
      </div>

      {/* Right side: feature actions + maximize toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
        {children}
        <PanelMaxButton isMaxed={isMaxed} onToggle={onToggleMax} side={side} />
      </div>
    </div>
  );
}

// Standardized icon-button used by feature headers (matches Tasks's
// existing edit/refresh button style). Exported so other features can
// drop in their own buttons without re-implementing the styling.
export function HeaderIconButton({ onClick, title, "aria-label": ariaLabel, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel || title}
      style={{
        background: "none", border: "none", cursor: "pointer",
        padding: 8, display: "flex", opacity: 0.5,
        outline: "none", borderRadius: RADIUS.md,
        transition: "opacity 0.15s, background 0.15s",
        minWidth: 32, minHeight: 32,
        alignItems: "center", justifyContent: "center",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = C.darkSurf2; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; e.currentTarget.style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}

function PanelMaxButton({ side, isMaxed, onToggle }) {
  return (
    <button
      onClick={onToggle}
      title={isMaxed ? "Restore split view" : `Maximize ${side === "left" ? "left" : "right"} panel`}
      aria-label={isMaxed ? "Restore split view" : `Maximize ${side} panel`}
      style={{
        background: "none", border: "none", cursor: "pointer",
        padding: 8, display: "flex", opacity: 0.5,
        outline: "none", borderRadius: RADIUS.md,
        transition: "opacity 0.15s, background 0.15s",
        minWidth: 32, minHeight: 32,
        alignItems: "center", justifyContent: "center",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = C.darkSurf2; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; e.currentTarget.style.background = "transparent"; }}
    >
      {isMaxed
        ? <IconCollapse size={14} color={C.darkMuted} />
        : <IconExpand size={14} color={C.darkMuted} />
      }
    </button>
  );
}
