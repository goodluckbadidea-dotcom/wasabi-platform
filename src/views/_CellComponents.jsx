// ─── Shared Cell Components ───
// Reusable CellDisplay and CellEditor components for all views.
// Extracted from Table.jsx.

import React, { useState, useRef, useEffect, useCallback } from "react";
import { C, FONT, RADIUS, getStatusColor } from "../design/tokens.js";
import { formatDate, truncate } from "../utils/helpers.js";
import { getOptionNames } from "./_viewHelpers.js";

// ─── Shared Styles ───

export const cellStyles = {
  cellInput: {
    width: "100%",
    border: `1px solid ${C.accent}`,
    borderRadius: RADIUS.sm,
    padding: "4px 8px",
    fontSize: 13,
    fontFamily: FONT,
    color: C.darkText,
    background: C.darkSurf,
    outline: "none",
    boxShadow: `0 0 0 2px ${C.accent}33`,
    boxSizing: "border-box",
  },

  cellSelect: {
    width: "100%",
    border: `1px solid ${C.accent}`,
    borderRadius: RADIUS.sm,
    padding: "4px 8px",
    fontSize: 13,
    fontFamily: FONT,
    color: C.darkText,
    background: C.darkSurf,
    outline: "none",
    cursor: "pointer",
    appearance: "none",
    boxShadow: `0 0 0 2px ${C.accent}33`,
    boxSizing: "border-box",
  },

  toggle: (checked) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    borderRadius: RADIUS.sm,
    border: `2px solid ${checked ? C.accent : C.darkBorder}`,
    background: checked ? C.accent : "transparent",
    cursor: "pointer",
    transition: "all 0.15s",
    flexShrink: 0,
    fontSize: 11,
    color: "#fff",
    fontWeight: 700,
  }),

  pill: (color) => ({
    display: "inline-block",
    color: color,
    background: color + "18",
    border: `1px solid ${color}40`,
    borderRadius: RADIUS.pill,
    padding: "2px 10px",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    lineHeight: 1.6,
    whiteSpace: "nowrap",
  }),

  multiPillWrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
  },
};


// ─── Cell Editor Component ───

export function CellEditor({ value, type, options, onCommit, onCancel }) {
  const inputRef = useRef(null);
  const [draft, setDraft] = useState(() => {
    if (type === "date" && value && typeof value === "object") return value.start || "";
    if (type === "date" && typeof value === "string") return value;
    if (type === "checkbox") return !!value;
    if (value === null || value === undefined) return "";
    return String(value);
  });

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current.select) inputRef.current.select();
    }
  }, []);

  const commit = useCallback((val) => {
    let out = val;
    if (type === "number") {
      out = val === "" ? null : parseFloat(val);
      if (out !== null && isNaN(out)) out = null;
    }
    if (type === "date") {
      out = val || null;
    }
    onCommit(out);
  }, [type, onCommit]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(draft);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }, [draft, commit, onCancel]);

  // Checkbox is always a direct toggle, no editor needed
  if (type === "checkbox") return null;

  if (type === "select" || type === "status") {
    return (
      <select
        ref={inputRef}
        style={cellStyles.cellSelect}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onCommit(e.target.value || null);
        }}
        onBlur={() => onCancel()}
        onKeyDown={handleKeyDown}
      >
        <option value="">-- none --</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }

  if (type === "date") {
    return (
      <input
        ref={inputRef}
        type="date"
        style={cellStyles.cellInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={handleKeyDown}
      />
    );
  }

  if (type === "number") {
    return (
      <input
        ref={inputRef}
        type="number"
        style={cellStyles.cellInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={handleKeyDown}
        step="any"
      />
    );
  }

  // title, rich_text, url, email, phone_number
  return (
    <input
      ref={inputRef}
      type="text"
      style={cellStyles.cellInput}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={handleKeyDown}
    />
  );
}


// ─── Cell Display Component ───

export function CellDisplay({ value, type, fieldName, schema, onClick }) {
  if (value === null || value === undefined || value === "") {
    return (
      <span
        style={{ color: C.darkMuted, fontSize: 12, fontStyle: "italic", cursor: onClick ? "pointer" : "default" }}
        onClick={onClick}
      >
        --
      </span>
    );
  }

  // Select / Status pill
  if (type === "select" || type === "status") {
    const optionNames = getOptionNames(schema, fieldName);
    const color = getStatusColor(value, optionNames);
    return (
      <span style={cellStyles.pill(color)} onClick={onClick}>
        {value}
      </span>
    );
  }

  // Multi-select pills
  if (type === "multi_select" && Array.isArray(value)) {
    const optionNames = getOptionNames(schema, fieldName);
    return (
      <span style={cellStyles.multiPillWrap}>
        {value.map((v, i) => {
          const color = getStatusColor(v, optionNames);
          return <span key={i} style={cellStyles.pill(color)}>{v}</span>;
        })}
      </span>
    );
  }

  // Checkbox toggle
  if (type === "checkbox") {
    return (
      <span style={cellStyles.toggle(!!value)} onClick={onClick}>
        {value ? "\u2713" : ""}
      </span>
    );
  }

  // Date
  if (type === "date") {
    const dateStr = typeof value === "object" ? value.start : value;
    return (
      <span style={{ cursor: onClick ? "pointer" : "default" }} onClick={onClick}>
        {formatDate(dateStr, { short: true })}
      </span>
    );
  }

  // URL (clickable link)
  if (type === "url" && value) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: C.accent, textDecoration: "none", fontSize: 13 }}
        onClick={(e) => e.stopPropagation()}
      >
        {truncate(String(value), 40)}
      </a>
    );
  }

  // People
  if (type === "people" && Array.isArray(value)) {
    return (
      <span style={{ fontSize: 13 }}>
        {value.map((p) => p.name || p.email || "?").join(", ")}
      </span>
    );
  }

  // Files
  if (type === "files" && Array.isArray(value)) {
    return (
      <span style={{ fontSize: 13, color: C.darkMuted }}>
        {value.map((f) => f.name).join(", ") || "--"}
      </span>
    );
  }

  // Relation
  if (type === "relation" && Array.isArray(value)) {
    return (
      <span style={{ fontSize: 12, color: C.darkMuted }}>
        {value.length} linked
      </span>
    );
  }

  // Number
  if (type === "number") {
    return (
      <span style={{ cursor: onClick ? "pointer" : "default", fontVariantNumeric: "tabular-nums" }} onClick={onClick}>
        {value}
      </span>
    );
  }

  // Default text
  return (
    <span style={{ cursor: onClick ? "pointer" : "default" }} onClick={onClick}>
      {truncate(String(value), 120)}
    </span>
  );
}
