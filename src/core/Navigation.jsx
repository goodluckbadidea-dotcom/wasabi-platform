// ─── Sidebar Navigation ───
// Dark sidebar with page tabs, Wasabi icon, system manager, and batch queue.

import React, { useState, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { usePlatform } from "../context/PlatformContext.jsx";

export default function Navigation({ onOpenQueue }) {
  const { pages, activePage, setActivePage, batchQueue } = usePlatform();
  const [hoveredItem, setHoveredItem] = useState(null);
  const [expanded, setExpanded] = useState(false);

  // Build tree: top-level pages + nested children
  const topLevel = pages.filter((p) => !p.parentId);
  const children = (parentId) => pages.filter((p) => p.parentId === parentId);

  const queueCount = batchQueue.filter((q) => q.status === "pending").length;

  const NavButton = ({ id, icon, label, indent = 0, isActive }) => {
    const hovered = hoveredItem === id;
    return (
      <button
        onClick={() => setActivePage(id)}
        onMouseEnter={() => setHoveredItem(id)}
        onMouseLeave={() => setHoveredItem(null)}
        title={expanded ? undefined : label}
        style={{
          ...S.navItem,
          ...(isActive ? S.navItemActive : {}),
          ...(hovered && !isActive ? S.navItemHover : {}),
          ...(expanded ? {
            width: "100%",
            justifyContent: "flex-start",
            padding: "0 12px",
            gap: 10,
            paddingLeft: 12 + indent * 16,
          } : {}),
        }}
      >
        <span style={{ fontSize: expanded ? 16 : 18, flexShrink: 0, width: 20, textAlign: "center" }}>{icon}</span>
        {expanded && (
          <span style={{
            fontSize: 13,
            fontWeight: isActive ? 600 : 400,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: isActive ? C.accent : (hovered ? C.darkText : C.darkMuted),
          }}>
            {label}
          </span>
        )}
      </button>
    );
  };

  return (
    <nav style={{
      ...S.sidebar,
      ...(expanded ? S.sidebarExpanded : {}),
    }}>
      {/* Expand toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          ...S.navItem,
          marginBottom: 8,
          ...(expanded ? { width: "100%", justifyContent: "flex-start", padding: "0 12px", gap: 10 } : {}),
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        title={expanded ? "Collapse" : "Expand"}
      >
        <span style={{ fontSize: 16, color: C.darkMuted }}>
          {expanded ? "◀" : "▶"}
        </span>
        {expanded && <span style={{ fontSize: 12, color: C.darkMuted }}>Collapse</span>}
      </button>

      {/* Wasabi (home / page builder) */}
      <NavButton
        id="wasabi"
        icon="🌿"
        label="Wasabi"
        isActive={activePage === "wasabi" || activePage === null}
      />

      {/* Divider */}
      <div style={{ height: 1, background: C.edgeLine, margin: "4px 8px", width: expanded ? "calc(100% - 16px)" : 24 }} />

      {/* User pages */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>
        {topLevel.map((page) => (
          <React.Fragment key={page.id}>
            <NavButton
              id={page.id}
              icon={page.icon || "📄"}
              label={page.name}
              isActive={activePage === page.id}
            />
            {children(page.id).map((child) => (
              <NavButton
                key={child.id}
                id={child.id}
                icon={child.icon || "📄"}
                label={child.name}
                indent={1}
                isActive={activePage === child.id}
              />
            ))}
          </React.Fragment>
        ))}

        {/* Add page button */}
        <button
          onClick={() => setActivePage("wasabi")}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          style={{
            ...S.navItem,
            color: C.darkMuted,
            fontSize: 16,
            ...(expanded ? {
              width: "100%",
              justifyContent: "flex-start",
              padding: "0 12px",
              gap: 10,
            } : {}),
          }}
          title="New page"
        >
          <span style={{ fontSize: 18, width: 20, textAlign: "center" }}>+</span>
          {expanded && <span style={{ fontSize: 13, color: C.darkMuted }}>New Page</span>}
        </button>
      </div>

      {/* Bottom section */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>
        {/* Batch Queue */}
        <button
          onClick={onOpenQueue}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          style={{
            ...S.navItem,
            position: "relative",
            ...(expanded ? { width: "100%", justifyContent: "flex-start", padding: "0 12px", gap: 10 } : {}),
          }}
          title="Batch Queue"
        >
          <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>📋</span>
          {expanded && <span style={{ fontSize: 13, color: C.darkMuted }}>Queue</span>}
          {queueCount > 0 && (
            <span style={{
              ...S.badge,
              position: expanded ? "static" : "absolute",
              top: expanded ? undefined : 2,
              right: expanded ? undefined : 2,
              fontSize: 9,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              marginLeft: expanded ? "auto" : 0,
            }}>
              {queueCount}
            </span>
          )}
        </button>

        {/* System Manager */}
        <NavButton
          id="system"
          icon="⚙️"
          label="System"
          isActive={activePage === "system"}
        />
      </div>
    </nav>
  );
}
