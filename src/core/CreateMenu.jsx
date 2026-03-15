// --- Create Menu ---
// Dropdown with 4 create options: Workspace, Folder, Dashboard, Page.
// Used in sidebar (+ button) and context menus.

import React, { useState, useRef, useEffect } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { IconPlus, IconGlobe, IconFolder, IconGrid, IconDiamond } from "../design/icons.jsx";

const CREATE_OPTIONS = [
  { id: "workspace", label: "Workspace", icon: IconGlobe, description: "Top-level container" },
  { id: "folder", label: "Folder", icon: IconFolder, description: "Organize pages" },
  { id: "dashboard", label: "Dashboard", icon: IconGrid, description: "Widget layout" },
  { id: "page", label: "Page", icon: IconDiamond, description: "Tabbed views" },
];

export default function CreateMenu({ onCreateItem, collapsed }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleCreate = (type) => {
    setOpen(false);
    onCreateItem?.(type);
  };

  return (
    <div ref={menuRef} style={{ position: "relative", padding: collapsed ? "6px 0" : "6px 8px" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          border: `1px dashed ${C.darkBorder}`,
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

      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: collapsed ? 0 : 8,
            right: collapsed ? "auto" : 8,
            minWidth: collapsed ? 200 : undefined,
            background: C.darkSurf,
            border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.xl || 12,
            boxShadow: SHADOW.dropdown,
            overflow: "hidden",
            zIndex: 300,
            marginBottom: 4,
          }}
        >
          <div style={{
            height: 2,
            background: `linear-gradient(90deg, ${C.dark}, ${C.accent}, ${C.dark})`,
          }} />
          <div style={{ padding: "4px 0" }}>
            {CREATE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  onClick={() => handleCreate(opt.id)}
                  style={{
                    width: "100%",
                    border: "none",
                    cursor: "pointer",
                    outline: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    minHeight: 34,
                    background: "transparent",
                    fontFamily: FONT,
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <Icon size={12} color={C.darkMuted} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, textAlign: "left" }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: C.darkText }}>{opt.label}</span>
                    <span style={{ fontSize: 11, color: C.darkMuted }}>{opt.description}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
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
