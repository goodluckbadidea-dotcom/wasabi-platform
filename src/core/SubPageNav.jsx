// ─── Sub-page Navigation + View Tabs ───
// Horizontal pill bar for parent page + sub-pages, with view tabs below.
// Renders at the top of the main content area (inside PageShell).
// View tab management (rename, delete, add) absorbed from old Navigation.jsx.

import React, { useState, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { IconPlus, IconClose, IconEdit } from "../design/icons.jsx";
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
const ns = {
  wrapper: {
    flexShrink: 0,
    borderBottom: `1px solid ${C.edgeLine}`,
    background: C.dark,
  },
  pillRow: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "8px 16px 0",
    overflowX: "auto",
  },
  pill: (isActive) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 14px",
    borderRadius: RADIUS.pill,
    border: isActive ? "none" : `1px solid ${C.darkBorder}`,
    background: isActive ? C.accent : "transparent",
    cursor: "pointer",
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: isActive ? 600 : 400,
    color: isActive ? "#fff" : C.darkMuted,
    whiteSpace: "nowrap",
    transition: "all 0.15s",
    outline: "none",
    flexShrink: 0,
  }),
  addPillBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    borderRadius: "50%",
    border: `1px dashed ${C.darkBorder}`,
    background: "transparent",
    cursor: "pointer",
    transition: "all 0.15s",
    outline: "none",
    flexShrink: 0,
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
};

export default function SubPageNav({
  parentPage,
  subPages = [],
  activeSubPage,       // null = parent, or sub-page ID
  onSetActiveSubPage,
  activeViewIndex = 0,
  onSetActiveView,
  onAddSubPage,
  onDeleteView,
  onRenameView,
  onAddView,
}) {
  const [hoveredPill, setHoveredPill] = useState(null);
  const [hoveredTab, setHoveredTab] = useState(null);

  // Determine which config is active for view tabs
  const activeConfig = activeSubPage
    ? subPages.find((sp) => sp.id === activeSubPage) || parentPage
    : parentPage;

  const views = activeConfig?.views || [];

  // Show pill row only when sub-pages exist
  const showPills = subPages.length > 0;

  return (
    <div style={ns.wrapper}>
      {/* ── Sub-page pills ── */}
      {showPills && (
        <div style={ns.pillRow}>
          {/* Parent page pill */}
          <button
            style={ns.pill(!activeSubPage)}
            onClick={() => onSetActiveSubPage?.(null)}
            onMouseEnter={() => setHoveredPill("parent")}
            onMouseLeave={() => setHoveredPill(null)}
          >
            {parentPage?.name || "Page"}
          </button>

          {/* Sub-page pills */}
          {subPages.map((sp) => {
            const isActive = activeSubPage === sp.id;
            return (
              <button
                key={sp.id}
                style={ns.pill(isActive)}
                onClick={() => onSetActiveSubPage?.(sp.id)}
                onMouseEnter={() => setHoveredPill(sp.id)}
                onMouseLeave={() => setHoveredPill(null)}
              >
                {sp.name || "Untitled"}
              </button>
            );
          })}

          {/* Add sub-page */}
          <button
            style={ns.addPillBtn}
            onClick={() => onAddSubPage?.()}
            title="New sub-page"
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = C.accent;
              e.currentTarget.style.color = C.accent;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = C.darkBorder;
              e.currentTarget.style.color = "";
            }}
          >
            <IconPlus size={10} color={C.darkMuted} />
          </button>
        </div>
      )}

      {/* ── View tabs ── */}
      {views.length > 0 && (
        <div style={ns.viewRow}>
          {views.map((v, idx) => {
            const isActive = idx === activeViewIndex;
            const isHovered = hoveredTab === idx;
            const label = v.label || VIEW_TYPE_LABELS[v.type] || v.type;
            return (
              <div
                key={idx}
                style={{ display: "inline-flex", alignItems: "center", position: "relative" }}
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
      )}
    </div>
  );
}
