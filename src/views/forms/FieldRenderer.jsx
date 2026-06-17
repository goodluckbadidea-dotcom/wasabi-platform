// ─── Forms feature — Field input renderer ───
// Renders an editable input for one form field, in fill mode.
// Read-only mode is handled by the caller (passes `readOnly`).

import React from "react";
import { C, FONT, RADIUS } from "../../design/tokens.js";
import { S } from "../../design/styles.js";

const inputStyle = (invalid) => ({
  width: "100%",
  border: `1px solid ${invalid ? C.error : C.darkBorder}`,
  borderRadius: RADIUS.md,
  background: C.darkSurf2,
  color: C.darkText,
  fontFamily: FONT,
  fontSize: 13,
  padding: "10px 14px",
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.12s",
});

const textareaStyle = (invalid) => ({
  ...inputStyle(invalid),
  resize: "vertical",
  minHeight: 80,
  fontFamily: FONT,
});

export default function FieldRenderer({ field, value, onChange, readOnly = false, invalid = false }) {
  if (readOnly) {
    return <ReadOnlyView field={field} value={value} />;
  }

  switch (field.type) {
    case "short_text":
    case "url":
    case "email":
    case "phone":
      return (
        <input
          type={field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
          value={value || ""}
          placeholder={field.placeholder || ""}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle(invalid)}
        />
      );

    case "long_text":
      return (
        <textarea
          value={value || ""}
          placeholder={field.placeholder || ""}
          onChange={(e) => onChange(e.target.value)}
          style={textareaStyle(invalid)}
          rows={4}
        />
      );

    case "number":
      return (
        <input
          type="number"
          value={value ?? ""}
          placeholder={field.placeholder || ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          style={inputStyle(invalid)}
        />
      );

    case "date":
      return (
        <input
          type="date"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle(invalid)}
        />
      );

    case "date_range":
      return (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="date"
            value={value?.start || ""}
            onChange={(e) => onChange({ ...(value || {}), start: e.target.value })}
            style={inputStyle(invalid)}
            placeholder="Start"
          />
          <input
            type="date"
            value={value?.end || ""}
            onChange={(e) => onChange({ ...(value || {}), end: e.target.value })}
            style={inputStyle(invalid)}
            placeholder="End"
          />
        </div>
      );

    case "single_select":
    case "status": {
      const options = field.options || [];
      return (
        <select
          value={value || ""}
          onChange={(e) => onChange(e.target.value || null)}
          style={inputStyle(invalid)}
        >
          <option value="">— Select —</option>
          {options.map((o) => (
            <option key={o.name || o} value={o.name || o}>{o.name || o}</option>
          ))}
        </select>
      );
    }

    case "multi_select": {
      const options = field.options || [];
      const selected = Array.isArray(value) ? value : [];
      const toggle = (n) => {
        if (selected.includes(n)) onChange(selected.filter((s) => s !== n));
        else onChange([...selected, n]);
      };
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {options.length === 0 && (
            <span style={{ color: C.darkMuted, fontSize: 12, fontStyle: "italic" }}>
              No options defined
            </span>
          )}
          {options.map((o) => {
            const name = o.name || o;
            const isOn = selected.includes(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggle(name)}
                style={{
                  padding: "6px 12px",
                  borderRadius: RADIUS.pill,
                  border: `1px solid ${isOn ? C.accent : C.darkBorder}`,
                  background: isOn ? `${C.accent}22` : C.darkSurf2,
                  color: isOn ? C.accent : C.darkText,
                  cursor: "pointer",
                  fontSize: 12,
                  fontFamily: FONT,
                }}
              >
                {name}
              </button>
            );
          })}
        </div>
      );
    }

    case "checkbox":
      return (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: C.darkText }}>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: C.accent }}
          />
          {field.placeholder || "Yes"}
        </label>
      );

    case "file_upload":
      return (
        <div style={{ padding: 14, border: `1px dashed ${invalid ? C.error : C.darkBorder}`, borderRadius: RADIUS.md, color: C.darkMuted, fontSize: 12 }}>
          File upload not yet wired
        </div>
      );

    case "person":
      // Simple text for v1 — will become a directory picker in a polish pass
      return (
        <input
          type="text"
          value={value || ""}
          placeholder={field.placeholder || "Type a name"}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle(invalid)}
        />
      );

    case "linked_record":
      return (
        <input
          type="text"
          value={value || ""}
          placeholder={field.placeholder || "Linked record ID"}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle(invalid)}
        />
      );

    case "figma_file":
      return (
        <input
          type="url"
          value={value || ""}
          placeholder={field.placeholder || "Paste a Figma URL"}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle(invalid)}
        />
      );

    default:
      return (
        <input
          type="text"
          value={value || ""}
          placeholder={field.placeholder || ""}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle(invalid)}
        />
      );
  }
}

function ReadOnlyView({ field, value }) {
  const empty = value === null || value === undefined || value === "" ||
    (Array.isArray(value) && value.length === 0);
  if (empty) {
    return <span style={{ color: C.darkMuted, fontSize: 13, fontStyle: "italic" }}>—</span>;
  }
  let display = "";
  if (field.type === "checkbox") display = value ? "✓ Yes" : "—";
  else if (field.type === "multi_select" && Array.isArray(value)) display = value.join(", ");
  else if (field.type === "date_range" && typeof value === "object") {
    display = `${value.start || "—"} → ${value.end || "—"}`;
  } else display = String(value);
  return <span style={{ color: C.darkText, fontSize: 13 }}>{display}</span>;
}
