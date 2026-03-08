// ─── View Tabs ───
// Horizontal view tab bar rendered at the top of main content (inside PageShell).
// View tab management: rename, delete, add, drag-reorder.

import React, { useState } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { IconPlus, IconClose } from "../design/icons.jsx";
import InlineEdit from "./InlineEdit.jsx";

// ── View type display labels ──
const VIEW_TYPE_LABELS = {
  table: "Table",
  gantt: "Gantt",
  calendar: "Calendar",
  cardGrid: "Cards",
  kanban: "Kanban",
  charts: "Charts",
  form: "Form",
  summaryTiles: "Summary",
  activityFeed: "Activity",
  document: "Document",
  notificationFeed: "Notifications",
  chat: "Chat",
  linked_sheet: "Sheet",
};

// ── Styles ──
function buildNavStyles() { return {
  wrapper: {
    flexShrink: 0,
    borderBottom: `1px solid ${C.edgeLine}`,
    background: C.dark,
  },
  viewRow: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    padding: "6px 16px 8px",
    overflowX: "auto",
  },
  viewTab: (isActive) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 10px",
    borderRadius: RADIUS.md,
    background: isActive ? C.darkSurf2 : "transparent",
    border: "none",
    cursor: "pointer",
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: isActive ? 600 : 400,
    color: isActive ? C.darkText : C.darkMuted,
    whiteSpace: "nowrap",
    transition: "all 0.12s",
    outline: "none",
    position: "relative",
    flexShrink: 0,
  }),
  addViewBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "4px 8px",
    borderRadius: RADIUS.md,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    transition: "all 0.12s",
    outline: "none",
    flexShrink: 0,
  },
}; }

export default function SubPageNav({
  views = [],
  activeViewIndex = 0,
  onSetActiveView,
  onDeleteView,
  onRenameView,
  onAddView,
  onReorderViews,
}) {
  const ns = buildNavStyles();
  const [hoveredTab, setHoveredTab] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  if (views.length === 0) return null;

  return (
    <div style={ns.wrapper}>
      {/* ── View tabs ── */}
      <div style={ns.viewRow}>
        {views.map((v, idx) => {
          const isActive = idx === activeViewIndex;
          const isHovered = hoveredTab === idx;
          const label = v.label || VIEW_TYPE_LABELS[v.type] || v.type;
          const isDragging = dragIdx === idx;
          const isDropTarget = overIdx === idx && dragIdx !== null && dragIdx !== idx;
          return (
            <div
              key={idx}
              draggable
              onDragStart={(e) => {
                setDragIdx(idx);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(idx));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOverIdx(idx);
              }}
              onDragEnd={() => {
                if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
                  const reordered = [...views];
                  const [moved] = reordered.splice(dragIdx, 1);
                  reordered.splice(overIdx, 0, moved);
                  onReorderViews?.(reordered);
                  // Keep active view tracking the same view
                  if (activeViewIndex === dragIdx) onSetActiveView?.(overIdx);
                  else if (dragIdx < activeViewIndex && overIdx >= activeViewIndex) onSetActiveView?.(activeViewIndex - 1);
                  else if (dragIdx > activeViewIndex && overIdx <= activeViewIndex) onSetActiveView?.(activeViewIndex + 1);
                }
                setDragIdx(null);
                setOverIdx(null);
              }}
              onDragLeave={() => setOverIdx(null)}
              style={{
                display: "inline-flex", alignItems: "center", position: "relative",
                opacity: isDragging ? 0.4 : 1,
                borderLeft: isDropTarget && dragIdx > idx ? `2px solid ${C.accent}` : "2px solid transparent",
                borderRight: isDropTarget && dragIdx < idx ? `2px solid ${C.accent}` : "2px solid transparent",
                transition: "opacity 0.12s",
              }}
              onMouseEnter={() => setHoveredTab(idx)}
              onMouseLeave={() => setHoveredTab(null)}
            >
              <button
                style={ns.viewTab(isActive)}
                onClick={() => onSetActiveView?.(idx)}
              >
                {/* Active indicator dot */}
                {isActive && (
                  <div style={{
                    width: 4, height: 4, borderRadius: "50%",
                    background: C.accent, flexShrink: 0,
                  }} />
                )}
                <InlineEdit
                  value={label}
                  onCommit={(newLabel) => onRenameView?.(idx, newLabel)}
                  placeholder="View"
                  fontSize={11}
                  fontWeight={isActive ? 600 : 400}
                  color={isActive ? C.darkText : C.darkMuted}
                />
              </button>
              {/* Delete view on hover (only if more than 1 view) */}
              {isHovered && views.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteView?.(idx);
                  }}
                  title="Remove view"
                  style={{
                    background: "none", border: "none",
                    cursor: "pointer", padding: 2,
                    display: "flex", alignItems: "center",
                    opacity: 0.4, transition: "opacity 0.12s",
                    outline: "none", marginLeft: -4,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; }}
                >
                  <IconClose size={8} color={C.darkMuted} />
                </button>
              )}
            </div>
          );
        })}

        {/* Add view */}
        <button
          style={ns.addViewBtn}
          onClick={() => onAddView?.()}
          title="Add view"
          onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <IconPlus size={10} color={C.darkMuted} />
        </button>
      </div>
    </div>
  );
}
