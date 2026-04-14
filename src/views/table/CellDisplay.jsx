// ─── Table Cell Display ───
// Cell type renderers for Table view. Diverges from _CellComponents.jsx:
// uses getSolidPillColor for richer color mapping, resolved relation titles.

import React from "react";
import { C, RADIUS, getSolidPillColor } from "../../design/tokens.js";
import { getFieldOptions, getOptionNames } from "../_viewHelpers.js";
import { formatDate, truncate } from "../../utils/helpers.js";
import { styles } from "./tableStyles.js";

// Cell type renderers — keyed by Notion property type.
// Each receives { value, fieldName, schema, onClick, relationTitles }.
// Option colors are resolved from the schema itself (col.options[i].color) —
// there is no per-view colorMapping override. See Phase 1 unification notes.
export const CELL_RENDERERS = {
  select: ({ value, fieldName, schema, onClick }) => {
    const { fill, text } = getSolidPillColor(value, getOptionNames(schema, fieldName), getFieldOptions(schema, fieldName));
    return <span style={styles.pill(fill, text)} onClick={onClick}>{value}</span>;
  },
  status: (...args) => CELL_RENDERERS.select(...args),
  multi_select: ({ value, fieldName, schema }) => {
    if (!Array.isArray(value)) return null;
    const optNames = getOptionNames(schema, fieldName);
    const schemaOpts = getFieldOptions(schema, fieldName);
    return (
      <span style={styles.multiPillWrap}>
        {value.map((v, i) => { const { fill, text } = getSolidPillColor(v, optNames, schemaOpts); return <span key={i} style={styles.pill(fill, text)}>{v}</span>; })}
      </span>
    );
  },
  checkbox: ({ value, onClick }) => <span style={styles.toggle(!!value)} onClick={onClick}>{value ? "\u2713" : ""}</span>,
  date: ({ value, onClick }) => {
    const dateStr = typeof value === "object" ? value.start : value;
    const endStr = typeof value === "object" ? value.end : null;
    const label = endStr
      ? `${formatDate(dateStr, { short: true })} – ${formatDate(endStr, { short: true })}`
      : formatDate(dateStr, { short: true });
    return <span style={{ cursor: onClick ? "pointer" : "default" }} onClick={onClick}>{label}</span>;
  },
  url: ({ value }) => (
    <a href={value} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, textDecoration: "none", fontSize: 13 }} onClick={(e) => e.stopPropagation()}>
      {truncate(String(value), 40)}
    </a>
  ),
  people: ({ value }) => Array.isArray(value) ? <span style={{ fontSize: 13 }}>{value.map((p) => p.name || p.email || "?").join(", ")}</span> : null,
  files: ({ value }) => Array.isArray(value) ? <span style={{ fontSize: 13, color: C.darkMuted }}>{value.map((f) => f.name).join(", ") || "--"}</span> : null,
  relation: ({ value, relationTitles }) => {
    if (!Array.isArray(value) || value.length === 0) return <span style={{ fontSize: 12, color: C.darkMuted }}>--</span>;
    const resolved = value.map(id => (relationTitles || {})[id] || null).filter(Boolean);
    if (resolved.length === 0) return <span style={{ fontSize: 12, color: C.darkMuted }}>{value.length} linked</span>;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {resolved.map((name, i) => <span key={i} style={{ display: "inline-block", padding: "2px 8px", borderRadius: RADIUS.pill, background: C.accent + "15", color: C.accent, fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>)}
      </div>
    );
  },
  number: ({ value, onClick }) => <span style={{ cursor: onClick ? "pointer" : "default", fontVariantNumeric: "tabular-nums" }} onClick={onClick}>{value}</span>,
  last_edited_time: ({ value }) => <span style={{ fontSize: 12, color: C.darkMuted, fontVariantNumeric: "tabular-nums" }}>{formatDate(String(value), { short: true })}</span>,
  created_time: ({ value }) => <span style={{ fontSize: 12, color: C.darkMuted, fontVariantNumeric: "tabular-nums" }}>{formatDate(String(value), { short: true })}</span>,
};

export default function CellDisplay({ value, type, fieldName, schema, onClick, relationTitles }) {
  if (value === null || value === undefined || value === "") {
    return <span style={{ color: C.darkMuted, fontSize: 12, fontStyle: "italic", cursor: onClick ? "pointer" : "default" }} onClick={onClick}>--</span>;
  }
  const renderer = CELL_RENDERERS[type];
  if (renderer) return renderer({ value, fieldName, schema, onClick, relationTitles });
  return <span style={{ cursor: onClick ? "pointer" : "default" }} onClick={onClick}>{truncate(String(value), 120)}</span>;
}
