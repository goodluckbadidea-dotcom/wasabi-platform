// ─── Context Menu ───
// Generic right-click context menu overlay.
// Positioned at (x, y) screen coords, auto-adjusts to fit viewport.

import React, { useRef, useEffect } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";

export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);

  // Close on outside click or escape
  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Auto-adjust position to stay in viewport
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 36 - 20);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: adjustedY,
        left: adjustedX,
        minWidth: 160,
        background: "#2D2D2D",
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg,
        boxShadow: SHADOW.dropdown,
        padding: "4px 0",
        zIndex: 500,
        animation: "snapDown 0.22s cubic-bezier(0.22, 1.2, 0.36, 1)",
      }}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return (
            <div
              key={`sep_${i}`}
              style={{
                height: 1,
                background: C.darkBorder,
                margin: "4px 8px",
              }}
            />
          );
        }

        return (
          <button
            key={item.label}
            onClick={() => {
              item.onClick?.();
              onClose();
            }}
            style={{
              width: "100%",
              border: "none",
              cursor: "pointer",
              outline: "none",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 14px",
              textAlign: "left",
              background: "transparent",
              transition: "background 0.1s",
              fontFamily: FONT,
              fontSize: 12,
              color: item.danger ? "#E55" : C.darkText,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = item.danger ? "#E5555520" : C.darkSurf2;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            {item.icon && (
              <span style={{ width: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {item.icon}
              </span>
            )}
            <span>{item.label}</span>
            {item.sub && (
              <span style={{ marginLeft: "auto", fontSize: 10, color: C.darkMuted }}>▸</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Inline sub-menu for "Move to..." folder selection.
 */
export function MoveToMenu({ x, y, folders, currentFolderId, onMove, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const adjustedX = Math.min(x + 160, window.innerWidth - 180);
  const adjustedY = Math.min(y, window.innerHeight - folders.length * 36 - 20);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: adjustedY,
        left: adjustedX,
        minWidth: 160,
        background: "#2D2D2D",
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg,
        boxShadow: SHADOW.dropdown,
        padding: "4px 0",
        zIndex: 501,
        maxHeight: 300,
        overflowY: "auto",
      }}
    >
      <div style={{
        padding: "6px 14px",
        fontSize: 10,
        fontWeight: 600,
        color: C.darkMuted,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontFamily: FONT,
      }}>
        Move to
      </div>
      {folders.map((folder) => {
        const isCurrent = folder.id === currentFolderId;
        return (
          <button
            key={folder.id}
            onClick={() => {
              if (!isCurrent) onMove(folder.id);
              onClose();
            }}
            disabled={isCurrent}
            style={{
              width: "100%",
              border: "none",
              cursor: isCurrent ? "default" : "pointer",
              outline: "none",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 14px",
              textAlign: "left",
              background: "transparent",
              transition: "background 0.1s",
              fontFamily: FONT,
              fontSize: 12,
              color: isCurrent ? C.darkBorder : C.darkText,
              opacity: isCurrent ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isCurrent) e.currentTarget.style.background = C.darkSurf2;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: folder.color || C.darkBorder, flexShrink: 0,
            }} />
            <span>{folder.name || "Untitled"}</span>
            {isCurrent && (
              <span style={{ marginLeft: "auto", fontSize: 10, color: C.darkMuted }}>Current</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
