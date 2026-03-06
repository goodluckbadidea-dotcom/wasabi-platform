// ─── Command Palette ───
// Cmd+K searchable overlay: pages, system sections, shortcuts.

import React, { useState, useRef, useEffect, useCallback } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { IconSearch, IconGear, IconBolt, IconPlus, IconPage } from "../design/icons.jsx";
import { SHORTCUT_MAP, formatShortcut } from "../utils/useKeyboardShortcuts.js";

// Static system entries
const SYSTEM_ITEMS = [
  { id: "system", label: "System Manager", icon: IconGear, type: "system" },
  { id: "automations", label: "Automations", icon: IconBolt, type: "system" },
  { id: "new-page", label: "New Page", icon: IconPlus, type: "system" },
];

export default function CommandPalette({ open, onClose, pages = [], setActivePage, onAddPage }) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Auto-focus input on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Build filtered results
  const results = useCallback(() => {
    const q = query.toLowerCase().trim();
    const items = [];

    // Pages
    for (const page of pages) {
      const label = page.name || page.id;
      if (q && !label.toLowerCase().includes(q)) continue;
      items.push({ id: page.id, label, icon: IconPage, type: "page", pageIcon: page.icon });
    }

    // System
    for (const sys of SYSTEM_ITEMS) {
      if (q && !sys.label.toLowerCase().includes(q)) continue;
      items.push(sys);
    }

    // Shortcuts (display only, no action)
    for (const [key, val] of Object.entries(SHORTCUT_MAP)) {
      if (q && !val.description.toLowerCase().includes(q) && !key.toLowerCase().includes(q)) continue;
      items.push({
        id: `shortcut-${key}`,
        label: val.description,
        shortcutKey: formatShortcut(val.shortcut),
        type: "shortcut",
      });
    }

    return items;
  }, [query, pages])();

  // Clamp index when results change
  useEffect(() => {
    if (selectedIndex >= results.length) setSelectedIndex(Math.max(0, results.length - 1));
  }, [results.length, selectedIndex]);

  // Execute selected item
  const executeItem = useCallback((item) => {
    if (!item) return;
    if (item.type === "page") {
      setActivePage(item.id);
    } else if (item.id === "system") {
      setActivePage("system");
    } else if (item.id === "automations") {
      setActivePage("automations");
    } else if (item.id === "new-page") {
      onAddPage();
    }
    onClose();
  }, [setActivePage, onAddPage, onClose]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      executeItem(results[selectedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }, [results, selectedIndex, executeItem, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children?.[selectedIndex];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 500,
        display: "flex",
        justifyContent: "center",
        paddingTop: "15vh",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "90vw",
          maxWidth: 520,
          background: C.darkSurf,
          border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.xl,
          boxShadow: SHADOW.dropdown,
          overflow: "hidden",
          animation: ANIM.scaleIn(0),
          maxHeight: "60vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Search input */}
        <div style={{
          display: "flex",
          alignItems: "center",
          padding: "14px 16px",
          borderBottom: `1px solid ${C.darkBorder}`,
          gap: 10,
        }}>
          <IconSearch size={18} color={C.darkMuted} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, commands..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: C.darkText,
              fontSize: 15,
              fontFamily: FONT,
            }}
          />
          <span style={{
            fontSize: 11,
            color: C.darkMuted,
            background: C.darkSurf2,
            padding: "2px 6px",
            borderRadius: RADIUS.sm,
            fontFamily: FONT,
          }}>
            ESC
          </span>
        </div>

        {/* Results list */}
        <div ref={listRef} style={{ overflowY: "auto", maxHeight: 320 }}>
          {results.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: C.darkMuted, fontSize: 13 }}>
              No results found
            </div>
          )}
          {results.map((item, i) => {
            const isActive = i === selectedIndex;
            const ItemIcon = item.icon;
            return (
              <div
                key={item.id}
                onClick={() => executeItem(item)}
                onMouseEnter={() => setSelectedIndex(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "10px 16px",
                  gap: 10,
                  cursor: "pointer",
                  background: isActive ? C.darkSurf2 : "transparent",
                  transition: "background 0.08s",
                }}
              >
                {/* Icon */}
                {item.pageIcon ? (
                  <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>{item.pageIcon}</span>
                ) : ItemIcon ? (
                  <ItemIcon size={16} color={isActive ? C.accent : C.darkMuted} />
                ) : (
                  <span style={{ width: 16 }} />
                )}

                {/* Label */}
                <span style={{
                  flex: 1,
                  fontSize: 14,
                  color: isActive ? C.darkText : C.darkMuted,
                  fontFamily: FONT,
                }}>
                  {item.label}
                </span>

                {/* Type badge or shortcut key */}
                {item.shortcutKey ? (
                  <span style={{
                    fontSize: 11,
                    color: C.darkMuted,
                    background: C.dark,
                    padding: "2px 8px",
                    borderRadius: RADIUS.sm,
                    fontFamily: FONT,
                    letterSpacing: "0.02em",
                  }}>
                    {item.shortcutKey}
                  </span>
                ) : (
                  <span style={{ fontSize: 10, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {item.type}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
