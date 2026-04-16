// ─── Ghost Row Cell Component ───
// Shared cell renderer for ghost rows (inline new-record creation).
// Used by both parent ghost rows and sub-item ghost rows.

import React from "react";
import { C } from "../../design/tokens.js";
import { getFieldOptions } from "../_viewHelpers.js";
import { getGhostInputStyle } from "./tableStyles.js";

/**
 * Renders a single ghost row input cell based on field type.
 *
 * @param {object} props
 * @param {string} props.col - Column/field name
 * @param {string} props.type - Field type (checkbox, select, status, number, date, text, etc.)
 * @param {*} props.value - Current value for this cell
 * @param {object} props.schema - Schema object (for option lookup)
 * @param {function} props.onSetValue - (col, value) => void
 * @param {function} props.onKeyDown - Keyboard handler (Enter to commit, Escape to cancel)
 * @param {string} [props.placeholder] - Input placeholder text
 * @param {boolean} [props.autoFocus] - Whether to auto-focus this cell
 */
export function GhostCell({ col, type, value, schema, onSetValue, onKeyDown, placeholder, autoFocus }) {
  const ghostInputStyle = getGhostInputStyle();
  if (type === "checkbox") {
    return (
      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", height: "100%" }}>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onSetValue(col, e.target.checked)}
          style={{ width: 14, height: 14, accentColor: C.accent, cursor: "pointer" }}
        />
      </label>
    );
  }

  if (type === "select" || type === "status") {
    return (
      <select
        value={value || ""}
        onChange={(e) => onSetValue(col, e.target.value || null)}
        onKeyDown={onKeyDown}
        style={{ ...ghostInputStyle, cursor: "pointer", appearance: "none" }}
      >
        <option value="">--</option>
        {getFieldOptions(schema, col).map((opt) => (
          <option key={opt.name} value={opt.name}>{opt.name}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={type === "number" ? "number" : type === "date" ? "date" : "text"}
      style={ghostInputStyle}
      value={value ?? ""}
      placeholder={placeholder || ""}
      autoFocus={autoFocus}
      onChange={(e) => {
        onSetValue(col, type === "number" ? (e.target.value ? Number(e.target.value) : "") : e.target.value);
      }}
      onKeyDown={onKeyDown}
      onFocus={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
      onBlur={(e) => { e.currentTarget.style.background = "transparent"; }}
    />
  );
}
