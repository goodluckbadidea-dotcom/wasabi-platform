// ─── Sidebar Navigation ───
// Per-page sub-navigation sidebar. Shows sub-views for the active top-level page.
// Flame character at bottom opens the Wasabi Panel.
// Collapsible: 48px (icons) or 220px (full). Matches original app.
// No emojis — all SVG icons.

import React, { useState } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { IconDiamond } from "../design/icons.jsx";
import WasabiFlame from "./WasabiFlame.jsx";

// ── View type → human-readable label ──
const VIEW_LABELS = {
  table: "Table",
  gantt: "Timeline",
  cardGrid: "Cards",
  kanban: "Board",
  charts: "Charts",
  form: "Form",
  summaryTiles: "Summary",
  activityFeed: "Activity",
  document: "Document",
  notificationFeed: "Notifications",
  chat: "Chat",
};

function getViewLabel(view) {
  return view.name || VIEW_LABELS[view.type] || view.type;
}

export default function Navigation({
  collapsed,
  onToggleCollapse,
  wasabiPanelOpen,
  onToggleWasabiPanel,
  activeView,
  onSetActiveView,
  isThinking,
}) {
  const { pages, activePage } = usePlatform();
  const [hoveredItem, setHoveredItem] = useState(null);

  const SIDEBAR_W = collapsed ? 48 : 220;

  // Get current page's views for sub-nav
  const currentPage = pages.find((p) => p.id === activePage);
  const subItems = (currentPage?.views || []).map((view, idx) => ({
    id: idx,
    label: getViewLabel(view),
    type: view.type,
  }));

  // Section label: current page name or section indicator
  const sectionLabel = currentPage
    ? currentPage.name
    : activePage === "system"
    ? "System Manager"
    : activePage === "wasabi"
    ? "New Page"
    : "Home";

  return (
    <div
      style={{
        width: SIDEBAR_W,
        flexShrink: 0,
        background: C.dark,
        borderRight: `1px solid ${C.edgeLine}`,
        display: "flex",
        flexDirection: "column",
        transition: "width 0.25s cubic-bezier(0.4,0,0.2,1)",
        position: "relative",
        boxShadow: "2px 0 8px rgba(0,0,0,0.2)",
        overflow: "hidden",
      }}
    >
      {/* Section label header */}
      {!collapsed && (
        <div
          style={{
            padding: "18px 20px 12px",
            borderBottom: `1px solid ${C.darkBorder}`,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: "'Outfit',sans-serif",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: C.darkMuted,
            }}
          >
            {sectionLabel}
          </span>
        </div>
      )}
      {collapsed && (
        <div
          style={{
            height: 49,
            borderBottom: `1px solid ${C.darkBorder}`,
            flexShrink: 0,
          }}
        />
      )}

      {/* Sub-nav items */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          paddingTop: 8,
          paddingBottom: 48,
        }}
      >
        {subItems.length === 0 && !collapsed && (
          <div
            style={{
              padding: "16px 20px",
              fontFamily: "'Outfit',sans-serif",
              fontSize: 11,
              color: C.darkBorder,
              letterSpacing: "0.04em",
            }}
          >
            No sub-views
          </div>
        )}

        {subItems.map((item) => {
          const isActive = activeView === item.id;
          const isHovered = hoveredItem === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSetActiveView(item.id)}
              onMouseEnter={() => setHoveredItem(item.id)}
              onMouseLeave={() => setHoveredItem(null)}
              title={collapsed ? item.label : undefined}
              style={{
                width: collapsed ? "100%" : "calc(100% - 16px)",
                margin: collapsed ? "0" : "6px 8px",
                border: isActive ? "none" : `1px solid ${C.darkBorder}`,
                cursor: "pointer",
                outline: "none",
                display: "flex",
                alignItems: "center",
                gap: collapsed ? 0 : 10,
                justifyContent: collapsed ? "center" : "flex-start",
                padding: collapsed ? "13px 0" : "10px 14px",
                borderRadius: collapsed ? 0 : 999,
                background: isActive
                  ? C.accent
                  : isHovered
                  ? C.darkSurf2
                  : "transparent",
                transition: "all 0.12s",
                fontFamily: "'Outfit',sans-serif",
              }}
            >
              <IconDiamond
                size={8}
                color={isActive ? "#fff" : C.darkBorder}
              />
              {!collapsed && (
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? "#fff" : C.darkMuted,
                    letterSpacing: "0.01em",
                    whiteSpace: "nowrap",
                    transition: "color 0.12s",
                  }}
                >
                  {item.label}
                </span>
              )}
              {isActive && !collapsed && (
                <div
                  style={{
                    marginLeft: "auto",
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "#fff",
                    flexShrink: 0,
                    boxShadow: "0 0 4px rgba(255,255,255,0.4)",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Flame character at bottom */}
      <div
        style={{
          flexShrink: 0,
          borderTop: `1px solid ${C.darkBorder}`,
          padding: collapsed ? "12px 0" : "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "flex-start",
          overflow: "hidden",
          transition: "padding 0.25s",
          minHeight: 52,
        }}
      >
        {!wasabiPanelOpen && (
          <button
            onClick={onToggleWasabiPanel}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: collapsed ? 0 : 10,
              padding: collapsed ? "4px" : "4px 8px",
              borderRadius: RADIUS.lg,
              transition: "background 0.15s",
              outline: "none",
              width: collapsed ? "auto" : "100%",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = C.darkSurf2;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            title="Open Wasabi"
          >
            <WasabiFlame size={collapsed ? 24 : 28} isThinking={isThinking} />
            {!collapsed && (
              <span
                style={{
                  fontFamily: "'Outfit',sans-serif",
                  fontSize: 12,
                  fontWeight: 500,
                  color: C.darkMuted,
                  letterSpacing: "0.02em",
                }}
              >
                Wasabi
              </span>
            )}
          </button>
        )}
      </div>

      {/* Collapse toggle tab — right edge */}
      <button
        onClick={onToggleCollapse}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        style={{
          position: "absolute",
          top: "50%",
          right: -12,
          transform: "translateY(-50%)",
          width: 22,
          height: 44,
          background: C.darkSurf2,
          border: `1px solid ${C.darkBorder}`,
          borderRadius: "0 8px 8px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          outline: "none",
          zIndex: 10,
          transition: "background 0.12s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#363636";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = C.darkSurf2;
        }}
      >
        <svg width="8" height="12" viewBox="0 0 8 12" fill="none">
          <path
            d={collapsed ? "M2 2L6 6L2 10" : "M6 2L2 6L6 10"}
            stroke={C.darkMuted}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
