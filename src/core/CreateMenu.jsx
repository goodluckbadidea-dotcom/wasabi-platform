// --- Create Menu ---
// Floating panel with icon tiles for 4 create options.
// Detached X button hovers above the panel.

import React, { useState, useEffect, useRef } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { IconPlus, IconGlobe, IconFolder, IconGrid, IconDiamond } from "../design/icons.jsx";
import { ANIM } from "../design/animations.js";

const CREATE_OPTIONS = [
  { id: "workspace", label: "Workspace", icon: IconGlobe, description: "Top-level container" },
  { id: "folder",    label: "Folder",    icon: IconFolder, description: "Organize pages" },
  { id: "dashboard", label: "Dashboard", icon: IconGrid,   description: "Widget layout" },
  { id: "page",      label: "Page",      icon: IconDiamond, description: "Tabbed views" },
];

export default function CreateMenu({ onCreateItem, collapsed }) {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef(null);
  const triggerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target) &&
          triggerRef.current && !triggerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const inactiveColor = C.darkText + "BB";

  return (
    <div style={{ position: "relative" }}>
      {/* Floating panel */}
      {isOpen && (
        <div ref={panelRef} style={{ position: "absolute", bottom: 44, left: 0, width: 240, zIndex: 200 }}>
          {/* Detached X button — floats above the panel */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                width: 28, height: 28,
                borderRadius: "50%",
                background: C.darkSurf2,
                border: `1px solid ${C.darkBorder}`,
                boxShadow: SHADOW.cardMaterial,
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: C.darkMuted,
                fontSize: 14,
                lineHeight: 1,
                outline: "none",
                transition: "background 0.15s, color 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; e.currentTarget.style.color = C.darkText; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
            >
              ✕
            </button>
          </div>

          {/* Panel body */}
          <div style={{
            background: C.darkSurf,
            border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.lg,
            boxShadow: SHADOW.cardMaterial,
            padding: "6px 0",
            animation: ANIM.popIn(0),
          }}>
            {CREATE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  onClick={() => { onCreateItem?.(opt.id); setIsOpen(false); }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: FONT,
                    outline: "none",
                    transition: "background 0.1s",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  {/* Icon tile */}
                  <div style={{
                    width: 32, height: 32,
                    borderRadius: RADIUS.md,
                    background: C.darkSurf2,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05)`,
                  }}>
                    <Icon size={15} color={C.darkMuted} />
                  </div>

                  {/* Label + description */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText, lineHeight: 1.3 }}>
                      {opt.label}
                    </div>
                    <div style={{ fontSize: 11, color: C.darkMuted, lineHeight: 1.3, marginTop: 1 }}>
                      {opt.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Trigger button */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen((o) => !o)}
        style={{
          width: "100%",
          border: "none",
          background: isOpen ? C.darkSurf2 : "transparent",
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
          color: isOpen ? C.accent : inactiveColor,
          outline: "none",
          transition: "background 0.15s, color 0.12s",
        }}
        onMouseEnter={(e) => { if (!isOpen) { e.currentTarget.style.background = C.darkSurf2; e.currentTarget.style.color = C.accent; } }}
        onMouseLeave={(e) => { if (!isOpen) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = inactiveColor; } }}
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
