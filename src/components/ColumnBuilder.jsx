// ─── Column Builder ───
// UI for defining typed columns when creating a standalone D1 table.
// Used by VisualPageBuilder when the user selects "Create Database > Table".

import React, { useState, useCallback } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { IconPlus, IconClose } from "../design/icons.jsx";

const COLUMN_TYPES = [
  { value: "text", label: "Text", icon: "Aa" },
  { value: "number", label: "Number", icon: "#" },
  { value: "select", label: "Select", icon: "▾" },
  { value: "multi_select", label: "Multi Select", icon: "☰" },
  { value: "date", label: "Date", icon: "📅" },
  { value: "checkbox", label: "Checkbox", icon: "☑" },
  { value: "url", label: "URL", icon: "🔗" },
  { value: "email", label: "Email", icon: "✉" },
  { value: "phone", label: "Phone", icon: "📞" },
  { value: "status", label: "Status", icon: "◉" },
];

const DEFAULT_STATUS_OPTIONS = ["Not Started", "In Progress", "Done"];

function buildColumnStyles() {
  const input = {
    ...S.input,
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    color: C.darkText,
    padding: "8px 12px",
    fontSize: 13,
    borderRadius: RADIUS.md,
    fontFamily: FONT,
  };
  return {
    input,
    select: {
      ...input,
      cursor: "pointer",
      appearance: "none",
      paddingRight: 28,
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%23888' fill='none' stroke-width='1.5'/%3E%3C/svg%3E")`,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "right 10px center",
    },
  };
}

/**
 * ColumnBuilder — lets users define table columns.
 * Props:
 *   columns: [{id, name, type, options?}]
 *   onChange: (columns) => void
 */
export default function ColumnBuilder({ columns, onChange }) {
  const { input: inputStyle, select: selectStyle } = buildColumnStyles();
  const [expandedCol, setExpandedCol] = useState(null);

  const addColumn = useCallback(() => {
    const id = `col_${Date.now()}`;
    const newCol = { id, name: "", type: "text" };
    onChange([...columns, newCol]);
    setExpandedCol(id);
  }, [columns, onChange]);

  const updateColumn = useCallback((colId, updates) => {
    onChange(columns.map((c) => (c.id === colId ? { ...c, ...updates } : c)));
  }, [columns, onChange]);

  const removeColumn = useCallback((colId) => {
    onChange(columns.filter((c) => c.id !== colId));
    if (expandedCol === colId) setExpandedCol(null);
  }, [columns, onChange, expandedCol]);

  const moveColumn = useCallback((fromIdx, direction) => {
    const toIdx = fromIdx + direction;
    if (toIdx < 0 || toIdx >= columns.length) return;
    const updated = [...columns];
    const [item] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, item);
    onChange(updated);
  }, [columns, onChange]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 4,
      }}>
        <span style={{ fontSize: 13, color: C.darkMuted, fontWeight: 500 }}>
          Columns ({columns.length})
        </span>
        <button onClick={addColumn} style={{
          ...S.btnGhost,
          fontSize: 12,
          padding: "4px 10px",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}>
          <IconPlus size={10} color={C.accent} />
          <span style={{ color: C.accent }}>Add Column</span>
        </button>
      </div>

      {/* Column list */}
      {columns.map((col, idx) => (
        <ColumnRow
          key={col.id}
          col={col}
          index={idx}
          total={columns.length}
          expanded={expandedCol === col.id}
          onToggle={() => setExpandedCol(expandedCol === col.id ? null : col.id)}
          onUpdate={(updates) => updateColumn(col.id, updates)}
          onRemove={() => removeColumn(col.id)}
          onMoveUp={() => moveColumn(idx, -1)}
          onMoveDown={() => moveColumn(idx, 1)}
          isFirst={idx === 0}
        />
      ))}

      {columns.length === 0 && (
        <div style={{
          padding: "24px 16px",
          textAlign: "center",
          color: C.darkMuted,
          fontSize: 13,
          border: `1px dashed ${C.darkBorder}`,
          borderRadius: RADIUS.lg,
        }}>
          No columns yet. Click "Add Column" to get started.
        </div>
      )}
    </div>
  );
}

function ColumnRow({ col, index, total, expanded, onToggle, onUpdate, onRemove, onMoveUp, onMoveDown, isFirst }) {
  const { input: inputStyle, select: selectStyle } = buildColumnStyles();
  const typeInfo = COLUMN_TYPES.find((t) => t.value === col.type) || COLUMN_TYPES[0];
  const hasOptions = ["select", "multi_select", "status"].includes(col.type);

  return (
    <div style={{
      background: C.darkSurf,
      border: `1px solid ${expanded ? C.accent + "44" : C.darkBorder}`,
      borderRadius: RADIUS.lg,
      overflow: "hidden",
    }}>
      {/* Header row */}
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 12px",
          gap: 8,
          cursor: "pointer",
        }}
      >
        {/* Type icon */}
        <span style={{
          width: 24,
          height: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          color: C.darkMuted,
          background: C.darkSurf2,
          borderRadius: RADIUS.sm,
          flexShrink: 0,
        }}>
          {typeInfo.icon}
        </span>

        {/* Name */}
        <span style={{
          flex: 1,
          fontSize: 13,
          color: col.name ? C.darkText : C.darkMuted,
          fontFamily: FONT,
        }}>
          {col.name || `Column ${index + 1}`}
          {isFirst && (
            <span style={{
              fontSize: 10,
              color: C.accent,
              marginLeft: 6,
              fontWeight: 600,
              letterSpacing: "0.04em",
            }}>
              TITLE
            </span>
          )}
        </span>

        {/* Type badge */}
        <span style={{
          fontSize: 11,
          color: C.darkMuted,
          background: C.darkSurf2,
          padding: "2px 8px",
          borderRadius: RADIUS.sm,
        }}>
          {typeInfo.label}
        </span>

        {/* Reorder */}
        <span style={{ display: "flex", gap: 2 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            disabled={index === 0}
            style={{ ...miniBtn, opacity: index === 0 ? 0.3 : 1 }}
          >↑</button>
          <button
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            disabled={index === total - 1}
            style={{ ...miniBtn, opacity: index === total - 1 ? 0.3 : 1 }}
          >↓</button>
        </span>

        {/* Delete */}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{ ...miniBtn, color: "#FF6B3D" }}
          title="Remove column"
        >
          <IconClose size={10} />
        </button>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div style={{
          padding: "12px",
          borderTop: `1px solid ${C.darkBorder}`,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}>
          {/* Name input */}
          <div>
            <label style={{ fontSize: 11, color: C.darkMuted, display: "block", marginBottom: 4 }}>
              Column Name
            </label>
            <input
              type="text"
              value={col.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              placeholder={isFirst ? "e.g. Name, Title" : "e.g. Email, Status"}
              style={inputStyle}
              autoFocus
            />
          </div>

          {/* Type select */}
          <div>
            <label style={{ fontSize: 11, color: C.darkMuted, display: "block", marginBottom: 4 }}>
              Type {isFirst && <span style={{ color: C.accent }}>(first column is always the title)</span>}
            </label>
            <select
              value={col.type}
              onChange={(e) => {
                const newType = e.target.value;
                const updates = { type: newType };
                // Auto-add default options for select/multi_select/status
                if (["select", "multi_select"].includes(newType) && !col.options?.length) {
                  updates.options = ["Option 1", "Option 2", "Option 3"];
                }
                if (newType === "status" && !col.options?.length) {
                  updates.options = [...DEFAULT_STATUS_OPTIONS];
                }
                onUpdate(updates);
              }}
              style={selectStyle}
              disabled={isFirst}
            >
              {COLUMN_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
              ))}
            </select>
          </div>

          {/* Options editor for select/multi_select/status */}
          {hasOptions && (
            <OptionsEditor
              options={col.options || []}
              onChange={(opts) => onUpdate({ options: opts })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function OptionsEditor({ options, onChange }) {
  const { input: inputStyle } = buildColumnStyles();
  const [newOption, setNewOption] = useState("");

  const addOption = () => {
    const val = newOption.trim();
    if (!val || options.includes(val)) return;
    onChange([...options, val]);
    setNewOption("");
  };

  const removeOption = (idx) => {
    onChange(options.filter((_, i) => i !== idx));
  };

  return (
    <div>
      <label style={{ fontSize: 11, color: C.darkMuted, display: "block", marginBottom: 4 }}>
        Options
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
        {options.map((opt, idx) => (
          <span key={idx} style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: C.darkSurf2,
            border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.pill,
            padding: "3px 8px 3px 10px",
            fontSize: 12,
            color: C.darkText,
          }}>
            {opt}
            <button
              onClick={() => removeOption(idx)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                color: C.darkMuted,
                fontSize: 10,
                lineHeight: 1,
              }}
            >×</button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="text"
          value={newOption}
          onChange={(e) => setNewOption(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOption(); } }}
          placeholder="Add option..."
          style={{ ...inputStyle, flex: 1, padding: "6px 10px", fontSize: 12 }}
        />
        <button
          onClick={addOption}
          disabled={!newOption.trim()}
          style={{
            ...S.btnGhost,
            fontSize: 11,
            padding: "4px 10px",
            color: C.accent,
            opacity: newOption.trim() ? 1 : 0.4,
          }}
        >Add</button>
      </div>
    </div>
  );
}

const miniBtn = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "2px 4px",
  fontSize: 11,
  color: C.darkMuted,
  lineHeight: 1,
  borderRadius: RADIUS.sm,
};
