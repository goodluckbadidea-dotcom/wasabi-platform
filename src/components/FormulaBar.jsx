// ─── Formula Bar ───
// Toolbar for sheet cells — shows cell reference, value/formula,
// and buttons to apply common formulas (SUM, AVG, COUNT, MIN, MAX).

import React, { useState, useCallback } from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";

const FORMULA_FUNCTIONS = [
  { fn: "SUM", label: "Σ", title: "Sum of range" },
  { fn: "AVG", label: "x̄", title: "Average of range" },
  { fn: "COUNT", label: "#", title: "Count non-empty cells" },
  { fn: "MIN", label: "↓", title: "Minimum value" },
  { fn: "MAX", label: "↑", title: "Maximum value" },
];

function buildFormulaStyles() {
  const formulaBtn = {
    background: "none",
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.sm,
    padding: "3px 8px",
    fontSize: 12,
    fontWeight: 700,
    fontFamily: MONO,
    color: C.darkMuted,
    cursor: "pointer",
    transition: "all 0.1s",
    lineHeight: 1,
    height: 24,
    minWidth: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  return {
    bar: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "4px 8px",
      borderBottom: `1px solid ${C.edgeLine}`,
      background: C.darkSurf,
      flexShrink: 0,
      minHeight: 32,
    },
    cellRef: {
      width: 56,
      textAlign: "center",
      fontSize: 11,
      fontWeight: 600,
      fontFamily: MONO,
      color: C.darkMuted,
      background: C.darkSurf2,
      border: `1px solid ${C.darkBorder}`,
      borderRadius: RADIUS.sm,
      padding: "3px 6px",
      flexShrink: 0,
    },
    valueInput: {
      flex: 1,
      background: C.dark,
      border: `1px solid ${C.darkBorder}`,
      borderRadius: RADIUS.sm,
      padding: "3px 8px",
      fontSize: 12,
      fontFamily: FONT,
      color: C.darkText,
      outline: "none",
      minHeight: 22,
    },
    formulaBtn,
    activeBtn: {
      ...formulaBtn,
      background: `${C.accent}18`,
      borderColor: C.accent,
      color: C.accent,
    },
  };
}

export default function FormulaBar({
  selectedCell,
  value,
  isFormula,
  onApplyFormula,
  onChange,
  onCommit,
}) {
  const fs = buildFormulaStyles();
  const [showFormulaPanel, setShowFormulaPanel] = useState(false);
  const [formulaRange, setFormulaRange] = useState("");
  const [activeFn, setActiveFn] = useState(null);

  const handleFormulaClick = useCallback((fn) => {
    if (activeFn === fn) {
      setActiveFn(null);
      setShowFormulaPanel(false);
      return;
    }
    setActiveFn(fn);
    setShowFormulaPanel(true);
    setFormulaRange("");
  }, [activeFn]);

  const applyFormula = useCallback(() => {
    if (!activeFn || !formulaRange || !selectedCell) return;
    onApplyFormula(activeFn, formulaRange, selectedCell);
    setShowFormulaPanel(false);
    setActiveFn(null);
    setFormulaRange("");
  }, [activeFn, formulaRange, selectedCell, onApplyFormula]);

  return (
    <div style={{ flexShrink: 0 }}>
      <div style={fs.bar}>
        {/* Cell reference */}
        <div style={fs.cellRef}>
          {selectedCell || "—"}
        </div>

        {/* Formula indicator */}
        {isFormula && (
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            color: C.accent,
            padding: "2px 6px",
            background: `${C.accent}18`,
            borderRadius: RADIUS.sm,
            fontFamily: MONO,
          }}>
            ƒ
          </span>
        )}

        {/* Value / formula display */}
        <input
          style={fs.valueInput}
          value={value || ""}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit?.();
            }
          }}
          placeholder={selectedCell ? "Enter value..." : "Select a cell"}
          readOnly={!selectedCell}
        />

        {/* Separator */}
        <div style={{ width: 1, height: 18, background: C.darkBorder, flexShrink: 0 }} />

        {/* Formula buttons */}
        {FORMULA_FUNCTIONS.map((ff) => (
          <button
            key={ff.fn}
            style={activeFn === ff.fn ? fs.activeBtn : fs.formulaBtn}
            onClick={() => handleFormulaClick(ff.fn)}
            title={ff.title}
            onMouseEnter={(e) => {
              if (activeFn !== ff.fn) {
                e.currentTarget.style.borderColor = C.accent;
                e.currentTarget.style.color = C.accent;
              }
            }}
            onMouseLeave={(e) => {
              if (activeFn !== ff.fn) {
                e.currentTarget.style.borderColor = C.darkBorder;
                e.currentTarget.style.color = C.darkMuted;
              }
            }}
          >
            {ff.label}
          </button>
        ))}
      </div>

      {/* Formula range input panel */}
      {showFormulaPanel && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 8px",
          borderBottom: `1px solid ${C.edgeLine}`,
          background: `${C.accent}08`,
          fontSize: 12,
          fontFamily: FONT,
        }}>
          <span style={{ color: C.accent, fontWeight: 600, fontSize: 11 }}>
            {activeFn}
          </span>
          <span style={{ color: C.darkMuted, fontSize: 11 }}>Range:</span>
          <input
            value={formulaRange}
            onChange={(e) => setFormulaRange(e.target.value.toUpperCase())}
            placeholder="e.g. A2:A10"
            style={{
              ...fs.valueInput,
              maxWidth: 120,
              fontFamily: MONO,
              fontSize: 12,
            }}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyFormula();
              }
              if (e.key === "Escape") {
                setShowFormulaPanel(false);
                setActiveFn(null);
              }
            }}
          />
          <span style={{ color: C.darkMuted, fontSize: 11 }}>→</span>
          <span style={{
            fontFamily: MONO,
            fontSize: 12,
            fontWeight: 600,
            color: C.darkText,
          }}>
            {selectedCell || "?"}
          </span>
          <button
            onClick={applyFormula}
            disabled={!formulaRange}
            style={{
              background: C.accent,
              border: "none",
              borderRadius: RADIUS.sm,
              padding: "4px 12px",
              fontSize: 11,
              fontWeight: 600,
              color: "#fff",
              fontFamily: FONT,
              cursor: formulaRange ? "pointer" : "not-allowed",
              opacity: formulaRange ? 1 : 0.4,
            }}
          >
            Apply
          </button>
          <button
            onClick={() => { setShowFormulaPanel(false); setActiveFn(null); }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: C.darkMuted,
              fontSize: 11,
              fontFamily: FONT,
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
