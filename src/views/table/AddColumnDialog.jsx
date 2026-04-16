// ─── Add Column Dialogs ───
// Modal dialogs for adding parent columns and sub-item columns.
// Rendered via createPortal.

import React from "react";
import { createPortal } from "react-dom";
import { C, FONT, RADIUS, SHADOW } from "../../design/tokens.js";
import { getInputFieldStyle } from "./tableStyles.js";
import { COLUMN_TYPES } from "./tableHelpers.js";

/**
 * Add parent column dialog — name input, type grid, relation DB search.
 */
export function AddColumnDialog({
  open, name, type, onNameChange, onTypeChange, onSubmit, onClose,
  isNotionTable,
  // Relation state
  relationDb, synced, syncedName, dbSearchQuery, dbSearchResults, dbSearching,
  onRelationDbSelect, onSyncedChange, onSyncedNameChange, onDbSearchQueryChange, onSearchDbs,
}) {
  const inputFieldStyle = getInputFieldStyle();
  if (!open) return null;

  const canAdd = name.trim() && !(type === "relation" && (!relationDb || (synced && !syncedName.trim())));

  return createPortal(
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 9998 }} onClick={onClose} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg, boxShadow: SHADOW.dropdown,
        padding: "24px", minWidth: 300, maxWidth: 380, zIndex: 9999, fontFamily: FONT,
      }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: C.darkText, marginBottom: 16 }}>
          New Column
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 4 }}>Column Name</label>
          <input
            autoFocus
            placeholder="Column name..."
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); if (e.key === "Escape") onClose(); }}
            style={{
              width: "100%", padding: "8px 10px", fontSize: 13,
              background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.sm, color: C.darkText, outline: "none",
              fontFamily: FONT, boxSizing: "border-box",
            }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 4 }}>Column Type</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            {COLUMN_TYPES.map((t) => {
              const isSelected = type === t.value;
              return (
                <div
                  key={t.value}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "5px 8px", borderRadius: RADIUS.sm,
                    cursor: "pointer", fontSize: 12, fontFamily: FONT,
                    transition: "background 0.1s",
                    color: isSelected ? C.accent : C.darkText,
                    background: isSelected ? `${C.accent}15` : "transparent",
                    fontWeight: isSelected ? 600 : 400,
                  }}
                  onClick={() => onTypeChange(t.value)}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = C.darkSurf2; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = isSelected ? `${C.accent}15` : "transparent"; }}
                >
                  <span style={{ width: 16, textAlign: "center", fontSize: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {t.Icon ? <t.Icon size={13} color={isSelected ? C.accent : C.darkMuted} /> : <span style={{ fontWeight: 600, color: isSelected ? C.accent : C.darkMuted }}>{t.text}</span>}
                  </span>
                  <span>{t.label}</span>
                </div>
              );
            })}
          </div>
        </div>
        {type === "relation" && isNotionTable && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Target Database
            </label>
            <input
              placeholder="Search databases..."
              value={dbSearchQuery}
              onChange={(e) => {
                onDbSearchQueryChange(e.target.value);
                onSearchDbs(e.target.value);
              }}
              onFocus={() => { if (!dbSearchResults.length) onSearchDbs(""); }}
              style={inputFieldStyle}
            />
            <div style={{ maxHeight: 120, overflowY: "auto" }}>
              {dbSearchResults.map((db) => (
                <div
                  key={db.id}
                  onClick={() => onRelationDbSelect(db)}
                  style={{
                    padding: "5px 8px", fontSize: 12, cursor: "pointer",
                    borderRadius: RADIUS.sm, fontFamily: FONT,
                    color: relationDb?.id === db.id ? C.accent : C.darkText,
                    background: relationDb?.id === db.id ? `${C.accent}15` : "transparent",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => { if (relationDb?.id !== db.id) e.currentTarget.style.background = C.darkSurf2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = relationDb?.id === db.id ? `${C.accent}15` : "transparent"; }}
                >
                  {db.title}
                </div>
              ))}
              {dbSearching && <div style={{ padding: 6, fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>Searching...</div>}
              {!dbSearching && dbSearchResults.length === 0 && dbSearchQuery && (
                <div style={{ padding: 6, fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>No databases found</div>
              )}
            </div>
            {relationDb && (
              <>
                <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>
                  Selected: <span style={{ color: C.accent }}>{relationDb.title}</span>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontFamily: FONT, color: C.darkText, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={synced}
                    onChange={(e) => onSyncedChange(e.target.checked)}
                    style={{ accentColor: C.accent }}
                  />
                  Two-way relation
                </label>
                {synced && (
                  <input
                    placeholder="Backlink column name..."
                    value={syncedName}
                    onChange={(e) => onSyncedNameChange(e.target.value)}
                    style={inputFieldStyle}
                  />
                )}
              </>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.sm,
              padding: "8px 16px", fontSize: 12, fontFamily: FONT, color: C.darkMuted, cursor: "pointer",
            }}
          >Cancel</button>
          <button
            onClick={onSubmit}
            disabled={!canAdd}
            style={{
              background: canAdd ? C.accent : C.darkBorder, border: "none", borderRadius: RADIUS.sm,
              padding: "8px 16px", fontSize: 12, fontFamily: FONT, color: "#fff",
              cursor: canAdd ? "pointer" : "default",
              fontWeight: 600, opacity: canAdd ? 1 : 0.5,
            }}
          >Add Column</button>
        </div>
      </div>
    </>,
    document.body
  );
}

/**
 * Add sub-item column dialog — simpler version without relation support.
 */
export function AddSubColumnDialog({ open, name, type, onNameChange, onTypeChange, onSubmit, onClose }) {
  if (!open) return null;
  return createPortal(
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 9998 }} onClick={onClose} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg, boxShadow: SHADOW.dropdown,
        padding: "24px", minWidth: 300, maxWidth: 380, zIndex: 9999, fontFamily: FONT,
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.darkText, marginBottom: 16 }}>
          Add Sub-Item Column
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 4 }}>Column Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); if (e.key === "Escape") onClose(); }}
            placeholder="e.g. Status, Due Date..."
            style={{
              width: "100%", padding: "8px 10px", fontSize: 13,
              background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.sm, color: C.darkText, outline: "none",
              fontFamily: FONT, boxSizing: "border-box",
            }}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.5px", display: "block", marginBottom: 4 }}>Type</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {COLUMN_TYPES.filter(t => t.value !== "relation").map((t) => (
              <button
                key={t.value}
                onClick={() => onTypeChange(t.value)}
                style={{
                  padding: "4px 10px", fontSize: 11, border: `1px solid ${type === t.value ? C.accent : C.darkBorder}`,
                  borderRadius: RADIUS.pill, cursor: "pointer", fontFamily: FONT,
                  background: type === t.value ? C.accent + "18" : "transparent",
                  color: type === t.value ? C.accent : C.darkMuted,
                  fontWeight: type === t.value ? 600 : 400,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.sm,
              padding: "8px 16px", fontSize: 12, fontFamily: FONT, color: C.darkMuted, cursor: "pointer",
            }}
          >Cancel</button>
          <button
            onClick={onSubmit}
            disabled={!name.trim()}
            style={{
              background: name.trim() ? C.accent : C.darkBorder, border: "none", borderRadius: RADIUS.sm,
              padding: "8px 16px", fontSize: 12, fontFamily: FONT, color: "#fff", cursor: name.trim() ? "pointer" : "default",
              fontWeight: 600, opacity: name.trim() ? 1 : 0.5,
            }}
          >Add Column</button>
        </div>
      </div>
    </>,
    document.body
  );
}
