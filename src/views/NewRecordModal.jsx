// ─── New Record Modal ───
// Centered modal for creating a new record with all schema fields.
// Used by all views (Table, Gantt, Calendar, CardGrid, Kanban).

import React, { useState, useCallback, useMemo } from "react";
import { C, FONT, RADIUS, SHADOW, getSolidPillColor } from "../design/tokens.js";
import { buildProp } from "../notion/properties.js";
import { IconClose } from "../design/icons.jsx";

const EDITABLE_TYPES = new Set([
  "title", "rich_text", "text", "number", "select", "status",
  "multi_select", "date", "checkbox", "url", "email", "phone_number",
]);

const TYPE_LABELS = {
  title: "Title", text: "Text", rich_text: "Text", number: "Number",
  select: "Select", status: "Status", multi_select: "Multi-Select",
  date: "Date", checkbox: "Checkbox", url: "URL", email: "Email",
  phone_number: "Phone",
};

// Inject animation
if (typeof document !== "undefined") {
  const id = "new-record-modal-anim";
  if (!document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `@keyframes fadeScaleIn{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}`;
    document.head.appendChild(s);
  }
}

/**
 * NewRecordModal
 * Props:
 *   schema        — { fields, selects, statuses, multiSelects } or array of field defs
 *   onClose       — () => void
 *   onCreate      — (databaseId, properties) => Promise
 *   databaseId    — target database/table ID
 *   prefill       — optional { fieldName: value } for pre-populated fields
 */
export default function NewRecordModal({ schema, onClose, onCreate, databaseId, prefill = {} }) {
  const [values, setValues] = useState(() => {
    const init = {};
    // Pre-fill any provided values
    for (const [k, v] of Object.entries(prefill)) init[k] = v;
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Extract fields from schema
  const fields = useMemo(() => {
    if (!schema) return [];
    // Schema can be { fields: [...] } or just an array
    const raw = schema.fields || schema;
    if (!Array.isArray(raw)) return [];
    return raw.filter((f) => EDITABLE_TYPES.has(f.type));
  }, [schema]);

  // Get title field name
  const titleField = useMemo(() => {
    const f = fields.find((f) => f.type === "title" || f.type === "text");
    return f?.name || fields[0]?.name || "Name";
  }, [fields]);

  // Get options for select/status/multi_select fields
  const getOptions = useCallback((fieldName, type) => {
    if (!schema) return [];
    const buckets = { select: "selects", status: "statuses", multi_select: "multiSelects" };
    const bucket = buckets[type];
    if (!bucket || !schema[bucket]) return [];
    const found = schema[bucket].find((f) => f.name === fieldName);
    return found?.options || [];
  }, [schema]);

  const setValue = useCallback((field, val) => {
    setValues((prev) => ({ ...prev, [field]: val }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!values[titleField]?.toString().trim()) {
      setError(`${titleField} is required`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const props = {};
      for (const field of fields) {
        const val = values[field.name];
        if (val !== undefined && val !== null && val !== "") {
          const built = buildProp(field.type === "text" ? "title" : field.type, val);
          if (built) props[field.name] = built;
        }
      }
      await onCreate(databaseId, props);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to create record");
    } finally {
      setSaving(false);
    }
  }, [values, fields, titleField, onCreate, databaseId, onClose]);

  return (
    <div style={ms.overlay} onClick={onClose}>
      <div style={ms.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={ms.header}>
          <div style={{ flex: 1, fontSize: 15, fontWeight: 700, color: C.darkText }}>
            New Record
          </div>
          <button
            style={ms.closeBtn}
            onClick={onClose}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.darkBorder; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
          >
            <IconClose size={12} color={C.darkMuted} />
          </button>
        </div>

        {/* Fields */}
        <div style={ms.body}>
          {fields.map((field) => (
            <FieldRow
              key={field.name}
              field={field}
              value={values[field.name] ?? ""}
              options={getOptions(field.name, field.type)}
              onChange={(val) => setValue(field.name, val)}
              isTitle={field.name === titleField}
            />
          ))}
          {fields.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: C.darkMuted, fontSize: 13 }}>
              No schema available. Enter a title to create the record.
              <div style={{ marginTop: 12 }}>
                <input
                  autoFocus
                  type="text"
                  placeholder="Title"
                  value={values[titleField] || ""}
                  onChange={(e) => setValue(titleField, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                  style={ms.input}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={ms.footer}>
          {error && <div style={{ flex: 1, fontSize: 11, color: "#FF6B3D", paddingTop: 4 }}>{error}</div>}
          <button style={ms.btn(false)} onClick={onClose}>Cancel</button>
          <button
            style={{ ...ms.btn(true), opacity: saving ? 0.6 : 1 }}
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldRow({ field, value, options, onChange, isTitle }) {
  const type = field.type;

  return (
    <div style={ms.fieldRow}>
      <div style={ms.fieldLabel}>
        <span>{field.name}</span>
        <span style={ms.fieldType}>{TYPE_LABELS[type] || type}</span>
      </div>
      <div style={{ flex: 1 }}>
        {(type === "title" || type === "rich_text" || type === "text") && (
          <input
            autoFocus={isTitle}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={isTitle ? "Required" : ""}
            style={ms.input}
          />
        )}

        {type === "number" && (
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")}
            style={ms.input}
          />
        )}

        {(type === "select" || type === "status") && (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ ...ms.input, cursor: "pointer" }}
          >
            <option value="">— Select —</option>
            {options.map((opt) => {
              const name = typeof opt === "string" ? opt : opt.name;
              return <option key={name} value={name}>{name}</option>;
            })}
          </select>
        )}

        {type === "multi_select" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {options.map((opt) => {
              const name = typeof opt === "string" ? opt : opt.name;
              const selected = Array.isArray(value) ? value.includes(name) : false;
              return (
                <button
                  key={name}
                  onClick={() => {
                    const arr = Array.isArray(value) ? [...value] : [];
                    if (selected) onChange(arr.filter((v) => v !== name));
                    else onChange([...arr, name]);
                  }}
                  style={{
                    padding: "3px 10px", fontSize: 11, borderRadius: RADIUS.pill,
                    border: `1px solid ${selected ? C.accent : C.darkBorder}`,
                    background: selected ? C.accent + "22" : C.darkSurf2,
                    color: selected ? C.accent : C.darkText,
                    cursor: "pointer", fontFamily: FONT, fontWeight: 500,
                  }}
                >
                  {name}
                </button>
              );
            })}
          </div>
        )}

        {type === "date" && (
          <input
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ ...ms.input, cursor: "pointer" }}
          />
        )}

        {type === "checkbox" && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => onChange(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: C.accent, cursor: "pointer" }}
            />
            <span style={{ fontSize: 12, color: C.darkMuted }}>{value ? "Yes" : "No"}</span>
          </label>
        )}

        {(type === "url" || type === "email" || type === "phone_number") && (
          <input
            type={type === "url" ? "url" : type === "email" ? "email" : "tel"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={type === "url" ? "https://..." : type === "email" ? "name@example.com" : "+1..."}
            style={ms.input}
          />
        )}
      </div>
    </div>
  );
}

// ── Styles ──
const ms = {
  overlay: {
    position: "fixed", inset: 0,
    background: "rgba(0,0,0,0.55)", zIndex: 100,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  modal: {
    width: 480, maxWidth: "92vw", maxHeight: "85vh",
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.xl || 16,
    display: "flex", flexDirection: "column",
    boxShadow: SHADOW.dropdown, fontFamily: FONT,
    animation: "fadeScaleIn 0.15s ease-out",
  },
  header: {
    display: "flex", alignItems: "center", padding: "16px 20px",
    borderBottom: `1px solid ${C.edgeLine}`, gap: 12, flexShrink: 0,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: RADIUS.md,
    border: `1px solid ${C.darkBorder}`, background: C.darkSurf2,
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  body: {
    flex: 1, overflowY: "auto", padding: "8px 0",
  },
  fieldRow: {
    display: "flex", alignItems: "flex-start", padding: "10px 20px",
    gap: 12, borderBottom: `1px solid ${C.edgeLine}`, minHeight: 44,
  },
  fieldLabel: {
    width: 120, flexShrink: 0, fontSize: 11, fontWeight: 600,
    textTransform: "uppercase", letterSpacing: "0.06em", color: C.darkMuted,
    paddingTop: 8, display: "flex", flexDirection: "column", gap: 2,
  },
  fieldType: {
    fontSize: 9, fontWeight: 400, textTransform: "none",
    letterSpacing: "0.02em", color: C.darkMuted + "88",
  },
  input: {
    width: "100%", background: C.dark,
    border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.md,
    padding: "7px 10px", fontSize: 13, fontFamily: FONT,
    color: C.darkText, outline: "none",
  },
  footer: {
    padding: "12px 20px", borderTop: `1px solid ${C.edgeLine}`,
    display: "flex", gap: 8, justifyContent: "flex-end", flexShrink: 0,
  },
  btn: (primary) => ({
    padding: "7px 18px", borderRadius: RADIUS.pill, fontSize: 12,
    fontWeight: 600, fontFamily: FONT, cursor: "pointer",
    border: primary ? "none" : `1px solid ${C.darkBorder}`,
    background: primary ? C.accent : C.darkSurf2,
    color: primary ? "#fff" : C.darkText,
  }),
};
