// ─── Table Cell Display ───
// Cell type renderers for Table view. Diverges from _CellComponents.jsx:
// uses getSolidPillColor for richer color mapping, resolved relation titles.

import React from "react";
import { C, RADIUS, getSolidPillColor } from "../../design/tokens.js";
import { getFieldOptions, getOptionNames } from "../_viewHelpers.js";
import { formatDate, truncate } from "../../utils/helpers.js";
import { pillStyle, toggleStyle, multiPillWrap } from "./tableStyles.js";
import { IconConnect } from "../../design/icons.jsx";

// Cell type renderers — keyed by Notion property type.
// Each receives { value, fieldName, schema, onClick, relationTitles }.
// Option colors are resolved from the schema itself (col.options[i].color) —
// there is no per-view colorMapping override. See Phase 1 unification notes.
export const CELL_RENDERERS = {
  select: ({ value, fieldName, schema, onClick }) => {
    const { fill, text } = getSolidPillColor(value, getOptionNames(schema, fieldName), getFieldOptions(schema, fieldName));
    return <span style={pillStyle(fill, text)} onClick={onClick}>{value}</span>;
  },
  status: (...args) => CELL_RENDERERS.select(...args),
  multi_select: ({ value, fieldName, schema }) => {
    if (!Array.isArray(value)) return null;
    const optNames = getOptionNames(schema, fieldName);
    const schemaOpts = getFieldOptions(schema, fieldName);
    return (
      <span style={multiPillWrap}>
        {value.map((v, i) => { const { fill, text } = getSolidPillColor(v, optNames, schemaOpts); return <span key={i} style={pillStyle(fill, text)}>{v}</span>; })}
      </span>
    );
  },
  checkbox: ({ value, onClick }) => <span style={toggleStyle(!!value)} onClick={onClick}>{value ? "\u2713" : ""}</span>,
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

// Coerce a resolved linked value into a renderer-friendly shape per cell type.
// Sources are different shapes than what each renderer expects, so we parse here.
function coerceLinkedValue(linkedValue, type) {
  if (linkedValue == null || linkedValue === "") return linkedValue;

  // Date renderers expect either a string or { start, end }. resolveRef returns
  // strings like "2026-05-01" or "2026-05-01 – 2026-05-31" for ranges.
  if (type === "date" || type === "last_edited_time" || type === "created_time") {
    if (typeof linkedValue === "string" && linkedValue.includes("–")) {
      const [start, end] = linkedValue.split("–").map((s) => s.trim());
      return { start, end };
    }
    return linkedValue;
  }
  // Multi-select / people renderers expect arrays. resolveRef joins them with ", ".
  if (type === "multi_select" || type === "people") {
    if (typeof linkedValue === "string" && linkedValue.includes(",")) {
      return linkedValue.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (typeof linkedValue === "string") return [linkedValue];
    return linkedValue;
  }
  // checkbox/number — coerce to typed primitives
  if (type === "checkbox") return linkedValue === "true" || linkedValue === true || linkedValue === 1;
  if (type === "number") {
    const n = Number(linkedValue);
    return Number.isNaN(n) ? linkedValue : n;
  }
  return linkedValue;
}

// Wrapper that adds a small link icon + linked styling to indicate the value
// is sourced from elsewhere. Click on the icon (passed via onLinkClick) unlinks.
function LinkedWrapper({ children, sourceName, stale, onLinkClick }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      borderLeft: `2px solid ${stale ? C.error || "#c4514e" : C.accent}`,
      paddingLeft: 6, marginLeft: -2,
      opacity: stale ? 0.6 : 1,
    }}>
      <span
        title={sourceName ? `Linked from ${sourceName}${stale ? " (stale)" : ""}` : (stale ? "Linked (stale)" : "Linked")}
        onClick={(e) => { if (onLinkClick) { e.stopPropagation(); onLinkClick(); } }}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 14, height: 14, flexShrink: 0,
          cursor: onLinkClick ? "pointer" : "default",
        }}
      >
        <IconConnect size={11} color={stale ? (C.error || "#c4514e") : C.accent} />
      </span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </span>
  );
}

export default function CellDisplay({ value, type, fieldName, schema, onClick, relationTitles, linkedValue, linkInfo, onLinkClick }) {
  // When a cell is linked, the displayed value comes from the source — not the
  // local cell value. Non-linked cells fall through to the existing path.
  const isLinked = !!linkInfo;
  const displayValue = isLinked ? coerceLinkedValue(linkedValue, type) : value;

  // Empty-state rendering
  if (displayValue === null || displayValue === undefined || displayValue === "") {
    const placeholder = isLinked && linkInfo?.stale ? "(source missing)" : "--";
    const empty = (
      <span style={{ color: C.darkMuted, fontSize: 12, fontStyle: "italic", cursor: onClick ? "pointer" : "default" }} onClick={onClick}>
        {placeholder}
      </span>
    );
    return isLinked
      ? <LinkedWrapper sourceName={linkInfo?.sourceName} stale={linkInfo?.stale} onLinkClick={onLinkClick}>{empty}</LinkedWrapper>
      : empty;
  }

  const renderer = CELL_RENDERERS[type];
  // Linked cells should not respond to onClick (no inline edit) — passing
  // undefined onClick disables the cursor: pointer hint.
  const effectiveOnClick = isLinked ? undefined : onClick;
  const rendered = renderer
    ? renderer({ value: displayValue, fieldName, schema, onClick: effectiveOnClick, relationTitles })
    : <span style={{ cursor: effectiveOnClick ? "pointer" : "default" }} onClick={effectiveOnClick}>{truncate(String(displayValue), 120)}</span>;

  return isLinked
    ? <LinkedWrapper sourceName={linkInfo?.sourceName} stale={linkInfo?.stale} onLinkClick={onLinkClick}>{rendered}</LinkedWrapper>
    : rendered;
}
