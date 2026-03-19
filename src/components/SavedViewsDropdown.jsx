// ─── Saved Views Dropdown ───
// Shared dropdown for saving/loading/renaming/deleting view presets.
// Used by Table, Kanban, and other view types.

import React, { useState, useEffect, useRef } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";

export default function SavedViewsDropdown({ savedViews = [], activeSavedViewId, onSelectView, onSaveView, onUpdateView, onRenameView, onDeleteView }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [menuOpenForId, setMenuOpenForId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const ref = useRef(null);
  const inputRef = useRef(null);
  const renameRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) { setIsOpen(false); setMenuOpenForId(null); setIsCreating(false); setRenamingId(null); } };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // Auto-focus inputs
  useEffect(() => { if (isCreating && inputRef.current) inputRef.current.focus(); }, [isCreating]);
  useEffect(() => { if (renamingId && renameRef.current) renameRef.current.focus(); }, [renamingId]);

  const activeView = savedViews.find((v) => v.id === activeSavedViewId);
  const triggerLabel = activeView ? activeView.name : "Default";

  const dropdownPanel = {
    position: "absolute", top: "100%", left: 0, marginTop: 4,
    background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.lg, boxShadow: SHADOW.dropdown,
    padding: "6px 0", zIndex: 20, minWidth: 230, maxHeight: 340, overflowY: "auto",
  };

  const itemStyle = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 8, padding: "7px 12px", cursor: "pointer", fontSize: 12,
    fontFamily: FONT, color: C.darkText, transition: "background 0.12s",
  };

  const divider = { height: 1, background: C.darkBorder, margin: "4px 0" };

  const dotBtn = {
    background: "none", border: "none", cursor: "pointer", color: C.darkMuted,
    fontSize: 14, padding: "2px 4px", borderRadius: RADIUS.sm, lineHeight: 1,
  };

  const subMenu = {
    position: "absolute", right: 0, top: "100%", marginTop: 2,
    background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md, boxShadow: SHADOW.dropdown,
    padding: "4px 0", zIndex: 30, minWidth: 120,
  };

  const subItem = {
    padding: "6px 12px", fontSize: 12, fontFamily: FONT,
    color: C.darkText, cursor: "pointer", transition: "background 0.12s",
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Trigger */}
      <div
        onClick={() => setIsOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: C.darkSurf2, border: `1px solid ${activeView ? C.accent : C.darkBorder}`,
          borderRadius: RADIUS.md, padding: "6px 10px", fontSize: 12,
          fontFamily: FONT, color: activeView ? C.accent : C.darkMuted,
          cursor: "pointer", height: 34, minWidth: 100, maxWidth: 200,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          transition: "border-color 0.15s",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{triggerLabel}</span>
        <span style={{ fontSize: 8, flexShrink: 0, marginLeft: 2 }}>&#x25BC;</span>
      </div>

      {/* Panel */}
      {isOpen && (
        <div style={dropdownPanel}>
          {/* Default */}
          <div
            style={{ ...itemStyle, color: !activeSavedViewId ? C.accent : C.darkText }}
            onClick={() => { onSelectView(null); setIsOpen(false); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {!activeSavedViewId && <span style={{ color: C.accent, fontSize: 10 }}>&#x2713;</span>}
              Default
            </span>
          </div>

          {savedViews.length > 0 && <div style={divider} />}

          {/* Saved views */}
          {savedViews.map((sv) => (
            <div key={sv.id} style={{ position: "relative" }}>
              {renamingId === sv.id ? (
                <div style={{ ...itemStyle, gap: 4 }}>
                  <input
                    ref={renameRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && renameValue.trim()) { onRenameView(sv.id, renameValue.trim()); setRenamingId(null); }
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    style={{
                      flex: 1, background: C.darkSurf2, border: `1px solid ${C.accent}`,
                      borderRadius: RADIUS.sm, padding: "3px 6px", fontSize: 12,
                      fontFamily: FONT, color: C.darkText, outline: "none",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span
                    style={{ ...dotBtn, color: C.accent, fontSize: 12 }}
                    onClick={(e) => { e.stopPropagation(); if (renameValue.trim()) { onRenameView(sv.id, renameValue.trim()); setRenamingId(null); } }}
                  >&#x2713;</span>
                </div>
              ) : (
                <div
                  style={{ ...itemStyle, color: activeSavedViewId === sv.id ? C.accent : C.darkText }}
                  onClick={() => { onSelectView(sv.id); setIsOpen(false); setMenuOpenForId(null); }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {activeSavedViewId === sv.id && <span style={{ color: C.accent, fontSize: 10, flexShrink: 0 }}>&#x2713;</span>}
                    {sv.name}
                  </span>
                  <span
                    style={dotBtn}
                    onClick={(e) => { e.stopPropagation(); setMenuOpenForId(menuOpenForId === sv.id ? null : sv.id); }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >&#x22EF;</span>
                </div>
              )}

              {/* Sub-menu for this view */}
              {menuOpenForId === sv.id && renamingId !== sv.id && (
                <div style={subMenu}>
                  <div
                    style={subItem}
                    onClick={(e) => { e.stopPropagation(); setRenamingId(sv.id); setRenameValue(sv.name); setMenuOpenForId(null); }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >Rename</div>
                  <div
                    style={subItem}
                    onClick={(e) => { e.stopPropagation(); onUpdateView(sv.id); setMenuOpenForId(null); }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >Update with current</div>
                  <div
                    style={{ ...subItem, color: "#e06060" }}
                    onClick={(e) => { e.stopPropagation(); onDeleteView(sv.id); setMenuOpenForId(null); }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >Delete</div>
                </div>
              )}
            </div>
          ))}

          <div style={divider} />

          {/* Save new view */}
          {isCreating ? (
            <div style={{ ...itemStyle, gap: 4 }}>
              <input
                ref={inputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="View name..."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) { onSaveView(newName.trim()); setNewName(""); setIsCreating(false); setIsOpen(false); }
                  if (e.key === "Escape") { setIsCreating(false); setNewName(""); }
                }}
                style={{
                  flex: 1, background: C.darkSurf2, border: `1px solid ${C.accent}`,
                  borderRadius: RADIUS.sm, padding: "3px 6px", fontSize: 12,
                  fontFamily: FONT, color: C.darkText, outline: "none",
                }}
              />
              <span
                style={{ ...dotBtn, color: C.accent, fontSize: 12 }}
                onClick={() => { if (newName.trim()) { onSaveView(newName.trim()); setNewName(""); setIsCreating(false); setIsOpen(false); } }}
              >&#x2713;</span>
              <span
                style={{ ...dotBtn, fontSize: 12 }}
                onClick={() => { setIsCreating(false); setNewName(""); }}
              >&#x2715;</span>
            </div>
          ) : (
            <div
              style={{ ...itemStyle, color: C.accent }}
              onClick={() => setIsCreating(true)}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 14 }}>+</span> Save current view
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
