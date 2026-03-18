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
  // Direct click → go straight to the full visual builder (no dropdown)
  return (
    <div style={{ position: "relative", padding: collapsed ? "6px 0" : "6px 8px" }}>
      <button
        onClick={() => onCreateItem?.("page")}
        style={{
          width: "100%",
          border: collapsed ? "none" : `1px dashed ${C.darkBorder}`,
          borderTop: collapsed ? `1px dashed ${C.darkBorder}` : undefined,
          borderBottom: collapsed ? `1px dashed ${C.darkBorder}` : undefined,
          background: "transparent",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: collapsed ? 0 : 8,
          justifyContent: collapsed ? "center" : "flex-start",
          padding: collapsed ? "8px 0" : "7px 14px",
          borderRadius: collapsed ? 0 : 999,
          fontFamily: FONT,
          fontSize: 12,
          color: C.darkMuted,
          outline: "none",
          transition: "all 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; e.currentTarget.style.color = C.darkMuted; }}
      >
        <IconPlus size={12} color="currentColor" />
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
