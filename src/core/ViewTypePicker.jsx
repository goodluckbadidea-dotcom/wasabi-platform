// ─── View Type Picker ───
// Compact popover for selecting a new view type to add to a page.
// Grid of view type cards: icon + label.
// On select: returns { type, label } to parent.

import React, { useRef, useEffect, useState } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import {
  IconTable, IconKanban, IconCalendar, IconTimeline,
  IconCards, IconChart, IconForm, IconSheet,
  IconDiamond, IconChat, IconBell, IconStar,
} from "../design/icons.jsx";

const VIEW_TYPES = [
  { type: "table", label: "Table", icon: IconTable, description: "Rows and columns" },
  { type: "kanban", label: "Kanban", icon: IconKanban, description: "Drag cards between columns" },
  { type: "calendar", label: "Calendar", icon: IconCalendar, description: "Date-based grid" },
  { type: "gantt", label: "Gantt", icon: IconTimeline, description: "Timeline chart" },
  { type: "cardGrid", label: "Cards", icon: IconCards, description: "Visual card grid" },
  { type: "charts", label: "Charts", icon: IconChart, description: "Data visualizations" },
  { type: "form", label: "Form", icon: IconForm, description: "Input form view" },
  { type: "document", label: "Document", icon: IconDiamond, description: "Rich text editor" },
  { type: "sheet", label: "Sheet", icon: IconSheet, description: "Spreadsheet grid" },
  { type: "summaryTiles", label: "Summary", icon: IconStar, description: "KPI tiles" },
  { type: "activityFeed", label: "Activity", icon: IconBell, description: "Activity log" },
  { type: "chat", label: "Chat", icon: IconChat, description: "AI chat view" },
];

export default function ViewTypePicker({ onSelect, onClose }) {
  const ref = useRef(null);
  const [hovered, setHovered] = useState(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose?.();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Close on escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0, bottom: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: C.overlayBg,
        zIndex: 200,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        style={{
          background: C.darkSurf,
          border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.xl || 12,
          boxShadow: SHADOW.dropdown,
          width: 400,
          maxWidth: "90vw",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "14px 18px 10px",
          borderBottom: `1px solid ${C.darkBorder}`,
        }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: C.darkText,
            fontFamily: FONT, marginBottom: 2,
          }}>
            Add View
          </div>
          <div style={{
            fontSize: 11, color: C.darkMuted, fontFamily: FONT,
          }}>
            Choose a view type to add to this page
          </div>
        </div>

        {/* Accent edge */}
        <div style={{
          height: 2,
          background: `linear-gradient(90deg, ${C.dark}, ${C.accent}, ${C.dark})`,
        }} />

        {/* Grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 6,
          padding: "12px 14px 14px",
        }}>
          {VIEW_TYPES.map((vt) => {
            const Icon = vt.icon;
            const isHovered = hovered === vt.type;
            return (
              <button
                key={vt.type}
                onClick={() => {
                  onSelect?.({ type: vt.type, label: vt.label });
                  onClose?.();
                }}
                onMouseEnter={() => setHovered(vt.type)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  padding: "12px 8px 10px",
                  borderRadius: RADIUS.lg,
                  border: `1px solid ${isHovered ? C.accent + "55" : C.darkBorder}`,
                  background: isHovered ? C.accent + "12" : C.dark,
                  cursor: "pointer",
                  fontFamily: FONT,
                  outline: "none",
                  transition: "all 0.12s",
                }}
              >
                <Icon size={18} color={isHovered ? C.accent : C.darkMuted} />
                <span style={{
                  fontSize: 11, fontWeight: 500,
                  color: isHovered ? C.darkText : C.darkMuted,
                }}>
                  {vt.label}
                </span>
                <span style={{
                  fontSize: 9, color: C.darkMuted, opacity: 0.7,
                  lineHeight: 1.2, textAlign: "center",
                }}>
                  {vt.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
