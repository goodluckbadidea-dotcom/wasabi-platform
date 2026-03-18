// --- Create Menu ---
// Dropdown with 4 create options: Workspace, Folder, Dashboard, Page.
// Used in sidebar (+ button) and context menus.

import React from "react";
import { C, FONT } from "../design/tokens.js";
import { IconPlus, IconGlobe, IconFolder, IconGrid, IconDiamond } from "../design/icons.jsx";

const CREATE_OPTIONS = [
  { id: "workspace", label: "Workspace", icon: IconGlobe, description: "Top-level container" },
  { id: "folder", label: "Folder", icon: IconFolder, description: "Organize pages" },
  { id: "dashboard", label: "Dashboard", icon: IconGrid, description: "Widget layout" },
  { id: "page", label: "Page", icon: IconDiamond, description: "Tabbed views" },
];

export default function CreateMenu({ onCreateItem, collapsed }) {
  const inactiveColor = C.darkText + "BB";
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => onCreateItem?.("page")}
        style={{
          width: "100%",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: collapsed ? 0 : 10,
          justifyContent: collapsed ? "center" : "flex-start",
          padding: collapsed ? "8px 6px" : "8px 12px",
          minHeight: 36,
          borderRadius: 8,
          fontFamily: FONT,
          fontSize: 12,
          fontWeight: 500,
          color: inactiveColor,
          outline: "none",
          transition: "background 0.15s, color 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; e.currentTarget.style.color = C.accent; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = inactiveColor; }}
      >
        <IconPlus size={collapsed ? 18 : 16} color="currentColor" />
        {!collapsed && <span>Create New</span>}
      </button>
    </div>
  );
}

// --- Context menu create sub-items (for right-click menus) ---
export function getCreateMenuItems(onCreateItem) {
  return CREATE_OPTIONS.map((opt) => ({
    label: `New ${opt.label}`,
    onClick: () => onCreateItem?.(opt.id),
  }));
}
