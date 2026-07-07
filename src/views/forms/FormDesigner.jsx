// ─── Forms feature — Form Designer ───
// Inline editor for one form definition. User toggles into this mode
// via the "Edit form" button on a form in the hub.
//
// Visual model: vertical stack of field blocks, with a pill "+" button
// at the bottom that opens the BlockTypePicker. Click a block to expand
// its inline FieldSettings panel.

import React, { useState, useRef, useEffect } from "react";
import { C, FONT, RADIUS, SHADOW } from "../../design/tokens.js";
import { S } from "../../design/styles.js";
import { hoverBg } from "../../design/interactions.js";
import { IconPlus, IconChevronDown } from "../../design/icons.jsx";
import BlockTypePicker from "./BlockTypePicker.jsx";
import FieldSettings from "./FieldSettings.jsx";
import { findBlockDef } from "./formTypes.js";

export default function FormDesigner({ form, tableColumns, onSave, onCancel, onChange }) {
  const [draft, setDraft] = useState(form);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState(null);
  const [activeFieldId, setActiveFieldId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const plusBtnRef = useRef(null);

  useEffect(() => { setDraft(form); }, [form?.id]);

  const patch = (delta) => {
    const next = { ...draft, ...delta };
    setDraft(next);
    onChange?.(next);
  };

  const patchFields = (fields) => patch({ fields });

  const addField = (newField) => {
    const next = [...(draft.fields || []), newField];
    patchFields(next);
    setActiveFieldId(newField.id);
  };

  const updateField = (id, partial) => {
    patchFields((draft.fields || []).map((f) => f.id === id ? partial : f));
  };

  const deleteField = (id) => {
    patchFields((draft.fields || []).filter((f) => f.id !== id));
    setActiveFieldId(null);
  };

  // Drag-to-reorder: HTML5 drag with index swap on drop
  const onDragStart = (id, e) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const onDragOver = (id, e) => {
    e.preventDefault();
    setDragOverId(id);
  };
  const onDrop = (targetId, e) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const fields = [...(draft.fields || [])];
    const fromIdx = fields.findIndex((f) => f.id === dragId);
    const toIdx = fields.findIndex((f) => f.id === targetId);
    if (fromIdx < 0 || toIdx < 0) {
      setDragId(null); setDragOverId(null); return;
    }
    const [moved] = fields.splice(fromIdx, 1);
    fields.splice(toIdx, 0, moved);
    patchFields(fields);
    setDragId(null);
    setDragOverId(null);
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 16px 60px" }}>
      {/* ── Form-level controls ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
        <input
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Form name"
          style={{
            border: "none", background: "transparent",
            fontFamily: FONT, fontSize: 24, fontWeight: 700,
            color: C.darkText, outline: "none", padding: "4px 0",
          }}
        />
        <textarea
          value={draft.description || ""}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder="Optional description shown above the form when filling…"
          style={{
            border: "none", background: "transparent",
            fontFamily: FONT, fontSize: 13,
            color: C.darkMuted, outline: "none", padding: "0",
            resize: "vertical", minHeight: 40,
          }}
          rows={2}
        />
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.darkMuted }}>
            Form type
          </span>
          <FormTypeToggle
            value={draft.form_type}
            onChange={(t) => patch({ form_type: t })}
            disabled={!!form._hasSubmissions}
          />
          {form._hasSubmissions && (
            <span style={{ fontSize: 10, color: C.darkMuted, fontStyle: "italic" }}>
              Locked — submissions exist
            </span>
          )}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${C.edgeLine}`, marginBottom: 18 }} />

      {/* ── Field stack ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(draft.fields || []).length === 0 && (
          <div style={{
            padding: 24, border: `1px dashed ${C.darkBorder}`,
            borderRadius: RADIUS.lg, textAlign: "center",
            color: C.darkMuted, fontSize: 13, fontFamily: FONT,
          }}>
            No fields yet. Click "Add" below to start building.
          </div>
        )}
        {(draft.fields || []).map((field) => (
          <FieldBlock
            key={field.id}
            field={field}
            active={activeFieldId === field.id}
            dragOver={dragOverId === field.id && dragId !== field.id}
            onClick={() => setActiveFieldId(activeFieldId === field.id ? null : field.id)}
            onChange={(partial) => updateField(field.id, partial)}
            onDelete={() => deleteField(field.id)}
            onCloseSettings={() => setActiveFieldId(null)}
            tableColumns={tableColumns}
            onDragStart={(e) => onDragStart(field.id, e)}
            onDragOver={(e) => onDragOver(field.id, e)}
            onDrop={(e) => onDrop(field.id, e)}
            onDragEnd={() => { setDragId(null); setDragOverId(null); }}
          />
        ))}
      </div>

      {/* ── "+ Add" pill button ── */}
      <div style={{ marginTop: 18, display: "flex", justifyContent: "center" }}>
        <button
          ref={plusBtnRef}
          onClick={() => {
            const rect = plusBtnRef.current?.getBoundingClientRect();
            setPickerAnchor(rect);
            setPickerOpen(true);
          }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 18px", borderRadius: RADIUS.pill,
            background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
            color: C.darkText, fontFamily: FONT, fontSize: 12, fontWeight: 600,
            cursor: "pointer", transition: "background 0.12s",
          }}
          {...hoverBg()}
        >
          <IconPlus size={12} /> Add
        </button>
      </div>

      <BlockTypePicker
        open={pickerOpen}
        anchorRect={pickerAnchor}
        onClose={() => setPickerOpen(false)}
        onPick={addField}
        tableColumns={tableColumns}
      />

      {/* ── Save / Cancel bar (sticky bottom) ── */}
      <div style={{
        position: "sticky", bottom: 0, marginTop: 24, padding: "12px 0",
        background: `linear-gradient(to top, ${C.dark}, ${C.dark}ee, transparent)`,
        display: "flex", gap: 8, justifyContent: "flex-end",
      }}>
        <button onClick={onCancel} style={S.btnGhost}>Cancel</button>
        <button onClick={() => onSave(draft)} style={S.btnPrimary}>Save form</button>
      </div>
    </div>
  );
}

// ─── Single field block in the editor stack ───
function FieldBlock({ field, active, dragOver, onClick, onChange, onDelete, onCloseSettings, tableColumns, onDragStart, onDragOver, onDrop, onDragEnd }) {
  const def = findBlockDef(field.type);
  const isLayout = field.kind === "layout";
  const linkedColumn = field.linked_column_id
    ? tableColumns.find((c) => c.id === field.linked_column_id)
    : null;

  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{
        border: `1px solid ${active ? C.accent : dragOver ? C.accent : C.darkBorder}`,
        borderRadius: RADIUS.lg,
        background: active ? `${C.accent}08` : C.darkSurf,
        padding: 10,
        transition: "border-color 0.12s, background 0.12s",
        position: "relative",
      }}
    >
      <div
        onClick={onClick}
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
      >
        <span
          draggable
          onDragStart={onDragStart}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 14, color: C.darkMuted, cursor: "grab",
            fontSize: 14, fontWeight: 700, letterSpacing: -2,
            userSelect: "none",
          }}
          title="Drag to reorder"
        >⋮⋮</span>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 22, height: 22, color: C.darkMuted, fontSize: 12,
        }}>
          {typeof def?.icon === "function"
            ? React.createElement(def.icon, { size: 14, color: C.darkMuted })
            : (def?.icon || "·")}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              fontSize: 12, fontWeight: 600,
              color: isLayout ? C.darkMuted : C.darkText,
              fontStyle: isLayout && field.type === "divider" ? "italic" : "normal",
            }}>
              {field.type === "divider" ? "— Divider —" : (field.label || def?.label || "Untitled")}
            </span>
            {field.required && (
              <span style={{ color: C.error, fontSize: 12 }}>*</span>
            )}
            {linkedColumn && (
              <span style={{
                fontSize: 10, color: C.accent, background: `${C.accent}14`,
                borderRadius: RADIUS.pill, padding: "1px 6px",
              }}>↳ {linkedColumn.name}</span>
            )}
          </div>
          {!isLayout && (
            <div style={{ fontSize: 10, color: C.darkMuted, marginTop: 2 }}>
              {def?.label}
            </div>
          )}
        </div>
        <span style={{
          color: C.darkMuted, fontSize: 10,
          transform: active ? "rotate(180deg)" : "rotate(0)",
          transition: "transform 0.12s",
        }}>
          <IconChevronDown size={11} />
        </span>
      </div>

      {active && (
        <div style={{ marginTop: 10 }}>
          <FieldSettings
            field={field}
            tableColumns={tableColumns}
            onChange={onChange}
            onClose={onCloseSettings}
            onDelete={onDelete}
          />
        </div>
      )}
    </div>
  );
}

function FormTypeToggle({ value, onChange, disabled }) {
  return (
    <div style={{
      display: "inline-flex", padding: 2, gap: 2,
      background: C.darkSurf2, borderRadius: RADIUS.pill,
      border: `1px solid ${C.darkBorder}`,
      opacity: disabled ? 0.6 : 1,
    }}>
      {[
        { v: "single_instance", label: "Fill once" },
        { v: "repeating", label: "Fill many times" },
      ].map((o) => (
        <button
          key={o.v}
          onClick={() => !disabled && onChange(o.v)}
          disabled={disabled}
          style={{
            border: "none", background: value === o.v ? C.dark : "transparent",
            color: value === o.v ? C.darkText : C.darkMuted,
            fontSize: 11, fontWeight: 600, padding: "5px 12px",
            borderRadius: RADIUS.pill, cursor: disabled ? "default" : "pointer",
            fontFamily: FONT,
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}
