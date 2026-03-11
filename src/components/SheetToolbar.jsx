// ─── Sheet Toolbar ───
// Formatting toolbar for Sheet view: bold, italic, strikethrough,
// alignment, number format, colors, borders, merge, wrap.

import React, { useState, useCallback } from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";

const NUM_FORMATS = [
  { value: "", label: "Auto" },
  { value: "currency", label: "$ Currency" },
  { value: "percent", label: "% Percent" },
  { value: "decimal", label: "0.00" },
  { value: "thousands", label: "#,###" },
];

function tbtn(active) {
  return {
    background: active ? `${C.accent}18` : "none",
    border: `1px solid ${active ? C.accent : C.darkBorder}`,
    borderRadius: RADIUS.sm,
    padding: "3px 7px",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: FONT,
    color: active ? C.accent : C.darkMuted,
    cursor: "pointer",
    lineHeight: 1,
    height: 26,
    minWidth: 26,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function sep() {
  return { width: 1, height: 18, background: C.darkBorder, flexShrink: 0 };
}

export default function SheetToolbar({ selection, cellStyles, onStyleChange, onMerge }) {
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [showFgPicker, setShowFgPicker] = useState(false);

  const anchorKey = selection
    ? `${colLabel(selection.anchor.col)}${selection.anchor.row + 1}`
    : null;
  const cur = (anchorKey && cellStyles?.[anchorKey]) || {};

  if (!selection) return null;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 4,
      padding: "3px 8px",
      borderBottom: `1px solid ${C.edgeLine}`,
      background: C.darkSurf,
      flexShrink: 0,
      minHeight: 32,
      flexWrap: "wrap",
    }}>
      {/* Bold */}
      <button
        style={tbtn(cur.bold)}
        title="Bold (Ctrl+B)"
        onClick={() => onStyleChange("bold", !cur.bold)}
        onMouseEnter={(e) => { if (!cur.bold) e.currentTarget.style.borderColor = C.accent; }}
        onMouseLeave={(e) => { if (!cur.bold) e.currentTarget.style.borderColor = C.darkBorder; }}
      >
        <b>B</b>
      </button>

      {/* Italic */}
      <button
        style={tbtn(cur.italic)}
        title="Italic (Ctrl+I)"
        onClick={() => onStyleChange("italic", !cur.italic)}
        onMouseEnter={(e) => { if (!cur.italic) e.currentTarget.style.borderColor = C.accent; }}
        onMouseLeave={(e) => { if (!cur.italic) e.currentTarget.style.borderColor = C.darkBorder; }}
      >
        <i>I</i>
      </button>

      {/* Strikethrough */}
      <button
        style={tbtn(cur.strike)}
        title="Strikethrough"
        onClick={() => onStyleChange("strike", !cur.strike)}
        onMouseEnter={(e) => { if (!cur.strike) e.currentTarget.style.borderColor = C.accent; }}
        onMouseLeave={(e) => { if (!cur.strike) e.currentTarget.style.borderColor = C.darkBorder; }}
      >
        <s>S</s>
      </button>

      <div style={sep()} />

      {/* Alignment */}
      <button
        style={tbtn(cur.align === "left" || !cur.align)}
        title="Align left"
        onClick={() => onStyleChange("align", "left")}
      >≡</button>
      <button
        style={tbtn(cur.align === "center")}
        title="Align center"
        onClick={() => onStyleChange("align", "center")}
      >☰</button>
      <button
        style={tbtn(cur.align === "right")}
        title="Align right"
        onClick={() => onStyleChange("align", "right")}
      >≡</button>

      <div style={sep()} />

      {/* Number format */}
      <select
        value={cur.fmt || ""}
        onChange={(e) => onStyleChange("fmt", e.target.value || undefined)}
        style={{
          background: C.darkSurf2,
          border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.sm,
          color: C.darkText,
          fontSize: 11,
          fontFamily: FONT,
          padding: "2px 4px",
          height: 26,
          cursor: "pointer",
          outline: "none",
        }}
        title="Number format"
      >
        {NUM_FORMATS.map((nf) => (
          <option key={nf.value} value={nf.value}>{nf.label}</option>
        ))}
      </select>

      <div style={sep()} />

      {/* Fill color */}
      <div style={{ position: "relative" }}>
        <button
          style={{ ...tbtn(false), position: "relative", overflow: "visible" }}
          title="Fill color"
          onClick={() => { setShowBgPicker(!showBgPicker); setShowFgPicker(false); }}
        >
          <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            <span style={{ fontSize: 11 }}>A</span>
            <span style={{ width: 14, height: 3, background: cur.bg || C.accent, borderRadius: 1 }} />
          </span>
        </button>
        {showBgPicker && (
          <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 100, marginTop: 2 }}>
            <input
              type="color"
              value={cur.bg || "#000000"}
              onChange={(e) => { onStyleChange("bg", e.target.value); }}
              onBlur={() => setShowBgPicker(false)}
              autoFocus
              style={{ width: 32, height: 32, border: "none", cursor: "pointer", padding: 0 }}
            />
          </div>
        )}
      </div>

      {/* Text color */}
      <div style={{ position: "relative" }}>
        <button
          style={{ ...tbtn(false), position: "relative", overflow: "visible" }}
          title="Text color"
          onClick={() => { setShowFgPicker(!showFgPicker); setShowBgPicker(false); }}
        >
          <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            <span style={{ fontSize: 11, color: cur.fg || C.darkText }}>A</span>
            <span style={{ width: 14, height: 3, background: cur.fg || C.darkText, borderRadius: 1 }} />
          </span>
        </button>
        {showFgPicker && (
          <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 100, marginTop: 2 }}>
            <input
              type="color"
              value={cur.fg || "#ffffff"}
              onChange={(e) => { onStyleChange("fg", e.target.value); }}
              onBlur={() => setShowFgPicker(false)}
              autoFocus
              style={{ width: 32, height: 32, border: "none", cursor: "pointer", padding: 0 }}
            />
          </div>
        )}
      </div>

      <div style={sep()} />

      {/* Borders */}
      <button
        style={tbtn(!!cur.borders)}
        title="Toggle borders"
        onClick={() => {
          const hasBorders = cur.borders;
          if (hasBorders) {
            onStyleChange("borders", null);
          } else {
            onStyleChange("borders", { top: true, bottom: true, left: true, right: true });
          }
        }}
      >
        <span style={{ fontSize: 13, fontFamily: MONO }}>⊞</span>
      </button>

      {/* Merge */}
      <button
        style={tbtn(false)}
        title="Merge cells"
        onClick={onMerge}
      >
        <span style={{ fontSize: 10, fontFamily: MONO }}>⬚⬚</span>
      </button>

      {/* Wrap text */}
      <button
        style={tbtn(cur.wrap)}
        title="Wrap text"
        onClick={() => onStyleChange("wrap", !cur.wrap)}
      >
        <span style={{ fontSize: 10 }}>↩</span>
      </button>
    </div>
  );
}

// Helper: convert column index to label (same as Sheet.jsx)
function colLabel(idx) {
  let label = "";
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}
