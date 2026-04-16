// ─── Options Manager Modal ───
// Modal for managing select/multi_select/status column options.
// CRUD, reorder, and color assignment using VIEW_PALETTE.

import React, { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { C, FONT, RADIUS, SHADOW, VIEW_PALETTE, Z } from "../../design/tokens.js";
import { assignOptionColor, STATUS_CATEGORIES } from "../../lib/dataSource.js";

// ─── Status category definitions ───
// Returned from function so theme switches pick up fresh C.darkMuted.
function getCategoryMeta() { return {
  not_started: { label: "Not Started", icon: "○", color: C.darkMuted },
  in_progress: { label: "In Progress", icon: "◐", color: "#3b82f6" },
  complete:    { label: "Complete",     icon: "✓", color: "#22c55e" },
  on_hold:     { label: "On Hold",      icon: "❚❚", color: "#eab308" },
  cancelled:   { label: "Cancelled",    icon: "✕", color: "#ef4444" },
}; }

const PALETTE_KEYS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red", "orchid"];
const PALETTE_LABELS = ["Default", "Gray", "Brown", "Orange", "Yellow", "Green", "Blue", "Purple", "Pink", "Red", "Orchid"];

/** Normalize option to {name, color, category?} object */
function normalizeOption(opt) {
  if (typeof opt === "string") return { name: opt, color: null };
  const o = { name: opt.name || opt.label || "", color: opt.color || null };
  if (opt.category) o.category = opt.category;
  return o;
}

export default function OptionsManagerModal({ column, onSave, onClose }) {
  const CATEGORY_META = getCategoryMeta();
  const [options, setOptions] = useState(() =>
    (column.options || []).map(normalizeOption)
  );
  const [newName, setNewName] = useState("");
  const [editingIdx, setEditingIdx] = useState(-1);
  const [editingName, setEditingName] = useState("");
  const [colorPickerIdx, setColorPickerIdx] = useState(-1);
  const [dragIdx, setDragIdx] = useState(-1);
  const newInputRef = useRef(null);
  const colorPickerRef = useRef(null);

  // Close color picker on outside click
  useEffect(() => {
    if (colorPickerIdx < 0) return;
    const handler = (e) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target)) {
        setColorPickerIdx(-1);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colorPickerIdx]);

  const isStatusCol = column.type === "status";

  const handleAdd = useCallback(() => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (options.some((o) => o.name.toLowerCase() === trimmed.toLowerCase())) return;
    setOptions((prev) => {
      const newOpt = { name: trimmed, color: assignOptionColor(prev.length) };
      if (isStatusCol) newOpt.category = "not_started";
      return [...prev, newOpt];
    });
    setNewName("");
    requestAnimationFrame(() => newInputRef.current?.focus());
  }, [newName, options, isStatusCol]);

  const handleDelete = useCallback((idx) => {
    setOptions((prev) => prev.filter((_, i) => i !== idx));
    if (colorPickerIdx === idx) setColorPickerIdx(-1);
    if (editingIdx === idx) setEditingIdx(-1);
  }, [colorPickerIdx, editingIdx]);

  const handleRename = useCallback((idx) => {
    const trimmed = editingName.trim();
    if (!trimmed) { setEditingIdx(-1); return; }
    // Prevent duplicate names
    if (options.some((o, i) => i !== idx && o.name.toLowerCase() === trimmed.toLowerCase())) {
      setEditingIdx(-1);
      return;
    }
    setOptions((prev) => prev.map((o, i) => i === idx ? { ...o, name: trimmed } : o));
    setEditingIdx(-1);
  }, [editingName, options]);

  const handleSetColor = useCallback((idx, colorKey) => {
    setOptions((prev) => prev.map((o, i) => i === idx ? { ...o, color: colorKey } : o));
    setColorPickerIdx(-1);
  }, []);

  // Drag reorder
  const handleDragStart = useCallback((idx) => {
    setDragIdx(idx);
  }, []);

  const handleDragOver = useCallback((e, idx) => {
    e.preventDefault();
    if (dragIdx < 0 || dragIdx === idx) return;
    setOptions((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIdx(idx);
  }, [dragIdx]);

  const handleDragEnd = useCallback(() => {
    setDragIdx(-1);
  }, []);

  const handleSetCategory = useCallback((idx, category) => {
    setOptions((prev) => prev.map((o, i) => i === idx ? { ...o, category } : o));
  }, []);

  const handleSave = useCallback(() => {
    // Convert back to schema format
    const schemaOptions = options.map((o) => ({
      name: o.name,
      ...(o.color ? { color: o.color } : {}),
      ...(o.category ? { category: o.category } : {}),
    }));
    onSave(schemaOptions);
  }, [options, onSave]);

  const getColorHex = (colorKey) => {
    const idx = PALETTE_KEYS.indexOf(colorKey);
    if (idx >= 0 && idx < VIEW_PALETTE.length) return VIEW_PALETTE[idx].hex;
    return VIEW_PALETTE[0].hex;
  };

  const getOptionColor = (opt, idx) => {
    if (opt.color) return getColorHex(opt.color);
    // Fallback: position-based from SELECT_PALETTE order
    const selectOrder = [3, 5, 6, 7, 8, 9, 10, 4, 2, 0];
    const pIdx = selectOrder[idx % selectOrder.length];
    return VIEW_PALETTE[pIdx]?.hex || VIEW_PALETTE[0].hex;
  };

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: Z.modal - 1 }}
        onClick={onClose}
      />
      {/* Modal */}
      <div
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.lg, boxShadow: SHADOW.dropdown,
          padding: "24px", minWidth: 340, maxWidth: 420, width: "90vw",
          zIndex: Z.modal, fontFamily: FONT, maxHeight: "80vh",
          display: "flex", flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="options-modal-title"
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div id="options-modal-title" style={{ fontSize: 15, fontWeight: 600, color: C.darkText }}>
            Manage Options — {column.name}
          </div>
          <div
            style={{ fontSize: 18, color: C.darkMuted, cursor: "pointer", padding: "2px 6px", lineHeight: 1 }}
            onClick={onClose}
          >
            ×
          </div>
        </div>

        {/* Options list */}
        <div style={{ flex: 1, overflowY: "auto", marginBottom: 12, minHeight: 0 }}>
          {options.length === 0 && (
            <div style={{ padding: "16px 0", textAlign: "center", fontSize: 13, color: C.darkMuted }}>
              No options yet. Add one below.
            </div>
          )}
          {options.map((opt, idx) => (
            <div
              key={idx}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 4px", borderRadius: RADIUS.sm,
                background: dragIdx === idx ? `${C.accent}10` : "transparent",
                transition: "background 0.1s",
              }}
            >
              {/* Drag handle */}
              <span
                style={{
                  cursor: "grab", color: C.darkMuted, fontSize: 14,
                  padding: "0 2px", userSelect: "none", flexShrink: 0,
                }}
                title="Drag to reorder"
              >
                ⠿
              </span>

              {/* Color swatch */}
              <div style={{ position: "relative", flexShrink: 0 }}>
                <span
                  onClick={() => setColorPickerIdx(colorPickerIdx === idx ? -1 : idx)}
                  style={{
                    display: "inline-block", width: 18, height: 18,
                    borderRadius: "50%", background: getOptionColor(opt, idx),
                    cursor: "pointer", border: `2px solid ${C.darkBorder}`,
                    transition: "border-color 0.1s",
                  }}
                  title="Change color"
                />
                {/* Color picker popover */}
                {colorPickerIdx === idx && (
                  <div
                    ref={colorPickerRef}
                    style={{
                      position: "absolute", top: 26, left: -4, zIndex: Z.dropdown,
                      background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
                      borderRadius: RADIUS.md, boxShadow: SHADOW.dropdown,
                      padding: 8, display: "flex", flexWrap: "wrap", gap: 4,
                      width: 160,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {VIEW_PALETTE.map((entry, pIdx) => (
                      <span
                        key={pIdx}
                        onClick={() => handleSetColor(idx, PALETTE_KEYS[pIdx])}
                        title={PALETTE_LABELS[pIdx]}
                        style={{
                          display: "inline-block", width: 22, height: 22,
                          borderRadius: "50%", background: entry.hex,
                          cursor: "pointer",
                          border: opt.color === PALETTE_KEYS[pIdx]
                            ? `2px solid ${C.darkText}`
                            : `2px solid transparent`,
                          transition: "border-color 0.1s",
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Option name (editable) */}
              {editingIdx === idx ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(idx);
                    if (e.key === "Escape") setEditingIdx(-1);
                  }}
                  onBlur={() => handleRename(idx)}
                  style={{
                    flex: 1, padding: "4px 8px", fontSize: 13,
                    background: C.darkSurf2, border: `1px solid ${C.accent}`,
                    borderRadius: RADIUS.sm, color: C.darkText,
                    outline: "none", fontFamily: FONT, boxSizing: "border-box",
                  }}
                />
              ) : (
                <span
                  style={{
                    flex: 1, fontSize: 13, color: C.darkText, cursor: "text",
                    padding: "4px 8px", borderRadius: RADIUS.sm,
                    border: "1px solid transparent",
                  }}
                  onDoubleClick={() => { setEditingIdx(idx); setEditingName(opt.name); }}
                  title="Double-click to rename"
                >
                  {opt.name}
                </span>
              )}

              {/* Category selector (status columns only) */}
              {isStatusCol && (
                <select
                  value={opt.category || "not_started"}
                  onChange={(e) => handleSetCategory(idx, e.target.value)}
                  style={{
                    background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
                    borderRadius: RADIUS.sm, color: CATEGORY_META[opt.category || "not_started"]?.color || C.darkMuted,
                    fontSize: 11, fontFamily: FONT, padding: "2px 4px",
                    cursor: "pointer", outline: "none", flexShrink: 0,
                    maxWidth: 110,
                  }}
                  title="Status category for roll-up"
                >
                  {STATUS_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {CATEGORY_META[cat]?.icon} {CATEGORY_META[cat]?.label}
                    </option>
                  ))}
                </select>
              )}

              {/* Delete button */}
              <span
                onClick={() => handleDelete(idx)}
                style={{
                  cursor: "pointer", color: C.darkMuted, fontSize: 14,
                  padding: "2px 4px", flexShrink: 0, lineHeight: 1,
                  borderRadius: RADIUS.sm, transition: "color 0.1s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = C.error; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
                title="Delete option"
              >
                ×
              </span>
            </div>
          ))}
        </div>

        {/* Add new option */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            ref={newInputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") onClose(); }}
            placeholder="New option name..."
            style={{
              flex: 1, padding: "8px 10px", fontSize: 13,
              background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.sm, color: C.darkText, outline: "none",
              fontFamily: FONT, boxSizing: "border-box",
            }}
          />
          <button
            onClick={handleAdd}
            disabled={!newName.trim()}
            style={{
              background: newName.trim() ? C.accent : C.darkBorder,
              border: "none", borderRadius: RADIUS.sm,
              padding: "8px 14px", fontSize: 12, fontFamily: FONT,
              color: "#fff", cursor: newName.trim() ? "pointer" : "default",
              fontWeight: 600, opacity: newName.trim() ? 1 : 0.5, flexShrink: 0,
            }}
          >
            Add
          </button>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.sm, padding: "8px 16px", fontSize: 12,
              fontFamily: FONT, color: C.darkMuted, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              background: C.accent, border: "none", borderRadius: RADIUS.sm,
              padding: "8px 16px", fontSize: 12, fontFamily: FONT,
              color: "#fff", cursor: "pointer", fontWeight: 600,
            }}
          >
            Save Options
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
