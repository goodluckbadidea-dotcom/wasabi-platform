// ─── Calendar Filter Dropdown ───
// Compact dropdown for toggling visibility of individual Google calendars.
// Each row shows a colored dot + calendar name + checkbox toggle.

import React, { useEffect, useRef } from "react";
import { C, FONT, RADIUS } from "../../design/tokens.js";

export default function CalendarFilterDropdown({ calendars, hiddenCalendars, onToggle, onClose }) {
  const ref = useRef(null);

  // Click-outside to dismiss
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const allHidden = calendars.every((c) => hiddenCalendars.has(c.id));
  const noneHidden = calendars.every((c) => !hiddenCalendars.has(c.id));

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: 4,
        width: 220,
        background: C.darkSurf,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        zIndex: 50,
        overflow: "hidden",
      }}
    >
      {/* Quick actions */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        padding: "6px 10px",
        borderBottom: `1px solid ${C.darkBorder}`,
      }}>
        <button
          onClick={() => {
            calendars.forEach((c) => {
              if (hiddenCalendars.has(c.id)) onToggle(c.id);
            });
          }}
          disabled={noneHidden}
          style={quickBtnStyle(noneHidden)}
        >
          Show all
        </button>
        <button
          onClick={() => {
            calendars.forEach((c) => {
              if (!hiddenCalendars.has(c.id)) onToggle(c.id);
            });
          }}
          disabled={allHidden}
          style={quickBtnStyle(allHidden)}
        >
          Hide all
        </button>
      </div>

      {/* Calendar rows */}
      <div style={{ maxHeight: 240, overflowY: "auto", padding: "4px 0" }}>
        {calendars.map((cal) => {
          const hidden = hiddenCalendars.has(cal.id);
          return (
            <button
              key={cal.id}
              onClick={() => onToggle(cal.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "8px 12px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                outline: "none",
                transition: "background 0.1s",
                minHeight: 34,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {/* Color dot */}
              <div style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: hidden ? "transparent" : cal.backgroundColor,
                border: hidden ? `2px solid ${C.darkMuted}` : `2px solid ${cal.backgroundColor}`,
                flexShrink: 0,
                opacity: hidden ? 0.4 : 1,
              }} />

              {/* Calendar name */}
              <span style={{
                flex: 1,
                fontSize: 12,
                fontFamily: FONT,
                color: hidden ? C.darkMuted : C.darkText,
                textAlign: "left",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                opacity: hidden ? 0.5 : 1,
              }}>
                {cal.summary}
                {cal.primary && (
                  <span style={{ fontSize: 9, color: C.darkMuted, marginLeft: 4 }}>
                    (primary)
                  </span>
                )}
              </span>

              {/* Checkbox */}
              <div style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                border: `1.5px solid ${hidden ? C.darkMuted : cal.backgroundColor}`,
                background: hidden ? "transparent" : cal.backgroundColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}>
                {!hidden && (
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M1.5 4L3.5 6L6.5 2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function quickBtnStyle(disabled) {
  return {
    background: "none",
    border: "none",
    cursor: disabled ? "default" : "pointer",
    fontSize: 11,
    fontFamily: FONT,
    color: disabled ? C.darkMuted + "66" : C.accent,
    fontWeight: 500,
    padding: "6px 8px",
    opacity: disabled ? 0.4 : 0.8,
    outline: "none",
    minHeight: 28,
  };
}
