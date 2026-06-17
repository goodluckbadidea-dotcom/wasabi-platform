// ─── Forms feature — per-field settings panel ───
// Opens inline when a field is clicked in the designer.

import React from "react";
import { C, FONT, RADIUS } from "../../design/tokens.js";
import { BLOCK_TYPE_TO_COLUMN_TYPE, findBlockDef } from "./formTypes.js";

const inputStyle = {
  width: "100%",
  border: `1px solid ${C.darkBorder}`,
  borderRadius: RADIUS.md,
  background: C.darkSurf2,
  color: C.darkText,
  fontFamily: FONT,
  fontSize: 12,
  padding: "6px 10px",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle = {
  fontSize: 10, fontWeight: 700, textTransform: "uppercase",
  letterSpacing: "0.06em", color: C.darkMuted, marginBottom: 4,
};

export default function FieldSettings({ field, tableColumns, onChange, onClose, onDelete }) {
  if (!field) return null;

  const def = findBlockDef(field.type);
  const isLayout = field.kind === "layout";
  const isSelectish = ["single_select", "multi_select", "status"].includes(field.type);
  const canLink = !isLayout && BLOCK_TYPE_TO_COLUMN_TYPE[field.type] !== null;

  // For "link to column" — show only columns whose type matches the block
  const linkableColumns = canLink
    ? tableColumns.filter((col) => {
        const target = BLOCK_TYPE_TO_COLUMN_TYPE[field.type];
        return col.type === target;
      })
    : [];

  const linkedColumn = field.linked_column_id
    ? tableColumns.find((c) => c.id === field.linked_column_id)
    : null;
  const linkedColumnMissing = field.linked_column_id && !linkedColumn;

  const patch = (delta) => onChange({ ...field, ...delta });

  return (
    <div style={{
      background: C.darkSurf2,
      border: `1px solid ${C.darkBorder}`,
      borderRadius: RADIUS.lg,
      padding: 12,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      fontFamily: FONT,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.darkText, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {def?.label || "Field"} settings
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={onDelete}
            style={ghostBtn(C.error)}
            title="Delete field"
          >🗑</button>
          <button
            onClick={onClose}
            style={ghostBtn(C.darkMuted)}
            title="Close"
          >✕</button>
        </div>
      </div>

      {linkedColumnMissing && (
        <div style={{
          padding: "6px 10px", fontSize: 11, color: C.warning,
          background: `${C.warning}10`, borderRadius: RADIUS.sm,
        }}>
          ⚠ Linked column was removed. Field is now form-only.
        </div>
      )}

      {!isLayout && (
        <div>
          <div style={labelStyle}>Label</div>
          <input
            value={field.label}
            onChange={(e) => patch({ label: e.target.value })}
            style={inputStyle}
          />
        </div>
      )}

      {isLayout && field.type === "section_header" && (
        <div>
          <div style={labelStyle}>Header text</div>
          <input
            value={field.label}
            onChange={(e) => patch({ label: e.target.value })}
            style={inputStyle}
          />
        </div>
      )}

      {isLayout && field.type === "description_text" && (
        <div>
          <div style={labelStyle}>Text</div>
          <textarea
            value={field.label}
            onChange={(e) => patch({ label: e.target.value })}
            style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
            rows={3}
          />
        </div>
      )}

      {canLink && (
        <div>
          <div style={labelStyle}>Link to column</div>
          <select
            value={field.linked_column_id || ""}
            onChange={(e) => patch({ linked_column_id: e.target.value || null })}
            style={inputStyle}
          >
            <option value="">None — form-only</option>
            {linkableColumns.map((col) => (
              <option key={col.id} value={col.id}>{col.name}</option>
            ))}
          </select>
          <div style={{ fontSize: 10, color: C.darkMuted, marginTop: 4 }}>
            Linked answers are saved to the column on the record.
          </div>
        </div>
      )}

      {!isLayout && (
        <>
          <div>
            <div style={labelStyle}>Required</div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: C.darkText, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!field.required}
                onChange={(e) => patch({ required: e.target.checked })}
                style={{ accentColor: C.accent }}
              />
              Must be filled before submitting
            </label>
          </div>
          <div>
            <div style={labelStyle}>Helper text</div>
            <input
              value={field.helper_text || ""}
              onChange={(e) => patch({ helper_text: e.target.value })}
              placeholder="Small explanation under the field"
              style={inputStyle}
            />
          </div>
          <div>
            <div style={labelStyle}>Placeholder</div>
            <input
              value={field.placeholder || ""}
              onChange={(e) => patch({ placeholder: e.target.value })}
              style={inputStyle}
            />
          </div>
        </>
      )}

      {isSelectish && (
        <div>
          <div style={labelStyle}>Options</div>
          <OptionsEditor
            options={field.options || []}
            onChange={(opts) => patch({ options: opts })}
            disabled={!!field.linked_column_id}
          />
          {field.linked_column_id && (
            <div style={{ fontSize: 10, color: C.darkMuted, marginTop: 4, fontStyle: "italic" }}>
              Options inherited from linked column.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OptionsEditor({ options, onChange, disabled }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {options.map((o, i) => (
        <div key={i} style={{ display: "flex", gap: 4 }}>
          <input
            value={o.name || o}
            onChange={(e) => {
              const next = options.map((x, j) => j === i ? { ...(typeof x === "object" ? x : {}), name: e.target.value } : x);
              onChange(next);
            }}
            disabled={disabled}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={() => onChange(options.filter((_, j) => j !== i))}
            disabled={disabled}
            style={ghostBtn(C.error)}
          >✕</button>
        </div>
      ))}
      <button
        onClick={() => onChange([...options, { name: "New option", color: "blue" }])}
        disabled={disabled}
        style={{
          fontSize: 11, color: C.accent, background: "transparent", border: "none",
          cursor: disabled ? "default" : "pointer", padding: "4px 0", textAlign: "left",
        }}
      >+ Add option</button>
    </div>
  );
}

function ghostBtn(color) {
  return {
    background: "transparent", border: "none", color,
    fontSize: 12, cursor: "pointer", padding: 4, lineHeight: 1,
  };
}
