// ─── Sheet View ───
// Spreadsheet grid component for untyped sheet data.
// Cells stored as { "A1": { v: value, f?: formula }, ... }
// Reads/writes via /sheets/:id API routes.

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";
import { getSheet, updateSheet, sheetFormula, resizeSheet } from "../lib/api.js";
import FormulaBar from "../components/FormulaBar.jsx";

// ─── Helpers ───

function colLabel(idx) {
  // 0 → A, 1 → B, ..., 25 → Z, 26 → AA
  let label = "";
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function cellKey(col, row) {
  return `${colLabel(col)}${row + 1}`;
}

function getCellDisplay(cell) {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "object") return cell.v ?? "";
  return cell;
}

function getCellFormula(cell) {
  if (typeof cell === "object" && cell?.f) return cell.f;
  return null;
}

// ─── Styles (built at render time for theme support) ───

function buildSheetStyles() {
  const cellBase = {
    padding: "0 8px",
    fontSize: 13,
    fontFamily: FONT,
    color: C.darkText,
    borderRight: `1px solid ${C.edgeLine}`,
    borderBottom: `1px solid ${C.edgeLine}`,
    height: 28,
    lineHeight: "28px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "cell",
    boxSizing: "border-box",
    minWidth: 80,
  };
  return {
    gridContainer: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      overflow: "hidden",
      background: C.dark,
      fontFamily: FONT,
    },
    gridScroll: {
      flex: 1,
      overflow: "auto",
      position: "relative",
    },
    cell: cellBase,
    headerCell: {
      ...cellBase,
      background: C.darkSurf,
      color: C.darkMuted,
      fontWeight: 600,
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      textAlign: "center",
      cursor: "default",
      position: "sticky",
      top: 0,
      zIndex: 2,
    },
    rowHeader: {
      ...cellBase,
      background: C.darkSurf,
      color: C.darkMuted,
      fontSize: 11,
      fontWeight: 500,
      textAlign: "center",
      width: 50,
      minWidth: 50,
      maxWidth: 50,
      cursor: "default",
      position: "sticky",
      left: 0,
      zIndex: 1,
    },
    corner: {
      ...cellBase,
      background: C.darkSurf,
      color: C.darkMuted,
      fontWeight: 600,
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      textAlign: "center",
      cursor: "default",
      position: "sticky",
      top: 0,
      left: 0,
      zIndex: 3,
      width: 50,
      minWidth: 50,
      maxWidth: 50,
    },
    input: {
      width: "100%",
      height: "100%",
      border: "none",
      outline: "none",
      background: "transparent",
      fontFamily: FONT,
      fontSize: 13,
      color: C.darkText,
      padding: "0 8px",
      boxSizing: "border-box",
    },
    statusBar: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "4px 12px",
      borderTop: `1px solid ${C.edgeLine}`,
      background: C.darkSurf,
      fontSize: 11,
      color: C.darkMuted,
      flexShrink: 0,
    },
  };
}

// ─── Sheet Component ───

export default function Sheet({ pageConfig }) {
  const ss = buildSheetStyles();
  const sheetId = pageConfig.id;

  const [cells, setCells] = useState({});
  const [colCount, setColCount] = useState(26);
  const [rowCount, setRowCount] = useState(100);
  const [colWidths, setColWidths] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Selection
  const [selectedCell, setSelectedCell] = useState(null); // "A1"
  const [editingCell, setEditingCell] = useState(null); // "A1" if editing
  const [editValue, setEditValue] = useState("");
  const [selectionRange, setSelectionRange] = useState(null); // { start: "A1", end: "C5" }

  const inputRef = useRef(null);
  const saveTimer = useRef(null);
  const pendingChanges = useRef({});

  // Visible range for virtual scrolling (simplified: render all for now)
  const visibleCols = Math.min(colCount, 52); // Max 52 columns visible
  const visibleRows = Math.min(rowCount, 200); // Max 200 rows visible

  // ─── Load Sheet Data ───
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSheet(sheetId)
      .then((data) => {
        if (cancelled) return;
        setCells(data.cells || {});
        setColCount(data.col_count || 26);
        setRowCount(data.row_count || 100);
        setColWidths(data.col_widths || {});
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [sheetId]);

  // ─── Debounced Save ───
  const flushChanges = useCallback(() => {
    const changes = { ...pendingChanges.current };
    if (Object.keys(changes).length === 0) return;
    pendingChanges.current = {};
    updateSheet(sheetId, { cells: changes }).catch((err) => {
      console.error("Sheet save failed:", err);
    });
  }, [sheetId]);

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushChanges, 800);
  }, [flushChanges]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current);
      flushChanges();
    };
  }, [flushChanges]);

  // ─── Cell Operations ───

  const updateCell = useCallback((key, value) => {
    const cellValue = value === "" ? null : { v: value };
    setCells((prev) => {
      const next = { ...prev };
      if (cellValue === null) {
        delete next[key];
      } else {
        next[key] = cellValue;
      }
      return next;
    });
    pendingChanges.current[key] = value === "" ? null : { v: value };
    scheduleSave();
  }, [scheduleSave]);

  const startEditing = useCallback((key) => {
    const cell = cells[key];
    const formula = getCellFormula(cell);
    setEditingCell(key);
    setEditValue(formula || String(getCellDisplay(cell)));
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [cells]);

  const commitEdit = useCallback(() => {
    if (!editingCell) return;
    updateCell(editingCell, editValue);
    setEditingCell(null);
    setEditValue("");
  }, [editingCell, editValue, updateCell]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue("");
  }, []);

  // ─── Keyboard Navigation ───
  const handleKeyDown = useCallback((e) => {
    if (!selectedCell) return;

    // Parse current cell
    const match = selectedCell.match(/^([A-Z]+)(\d+)$/);
    if (!match) return;
    const col = match[1];
    const row = parseInt(match[2]);
    const colIdx = col.split("").reduce((acc, c) => acc * 26 + c.charCodeAt(0) - 64, 0) - 1;

    if (editingCell) {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit();
        // Move down
        if (row < rowCount) {
          const next = cellKey(colIdx, row); // row is 1-based, cellKey takes 0-based row
          setSelectedCell(next);
        }
      } else if (e.key === "Escape") {
        cancelEdit();
      } else if (e.key === "Tab") {
        e.preventDefault();
        commitEdit();
        // Move right
        if (colIdx < colCount - 1) {
          const next = cellKey(colIdx + 1, row - 1);
          setSelectedCell(next);
        }
      }
      return;
    }

    // Not editing
    switch (e.key) {
      case "Enter":
      case "F2":
        e.preventDefault();
        startEditing(selectedCell);
        break;
      case "ArrowDown":
        e.preventDefault();
        if (row < rowCount) setSelectedCell(cellKey(colIdx, row));
        break;
      case "ArrowUp":
        e.preventDefault();
        if (row > 1) setSelectedCell(cellKey(colIdx, row - 2));
        break;
      case "ArrowRight":
      case "Tab":
        e.preventDefault();
        if (colIdx < colCount - 1) setSelectedCell(cellKey(colIdx + 1, row - 1));
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (colIdx > 0) setSelectedCell(cellKey(colIdx - 1, row - 1));
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        updateCell(selectedCell, "");
        break;
      default:
        // Start typing to edit
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          setEditingCell(selectedCell);
          setEditValue(e.key);
          setTimeout(() => inputRef.current?.focus(), 0);
        }
    }
  }, [selectedCell, editingCell, commitEdit, cancelEdit, startEditing, updateCell, colCount, rowCount]);

  // ─── Formula Handler ───
  const handleFormula = useCallback(async (fn, range, target) => {
    try {
      const result = await sheetFormula(sheetId, fn, range, target);
      setCells((prev) => ({
        ...prev,
        [target]: { v: result.value, f: result.formula },
      }));
    } catch (err) {
      console.error("Formula failed:", err);
    }
  }, [sheetId]);

  // ─── Render ───

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.darkMuted, fontSize: 13 }}>
        Loading sheet...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#E05252", fontSize: 13 }}>
        Error: {error}
      </div>
    );
  }

  const selectedFormula = selectedCell ? getCellFormula(cells[selectedCell]) : null;
  const selectedValue = selectedCell ? getCellDisplay(cells[selectedCell]) : "";

  return (
    <div
      style={ss.gridContainer}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Formula Bar */}
      <FormulaBar
        selectedCell={selectedCell}
        value={editingCell ? editValue : (selectedFormula || String(selectedValue))}
        isFormula={!!selectedFormula}
        onApplyFormula={handleFormula}
        onChange={(val) => {
          if (editingCell) {
            setEditValue(val);
          } else if (selectedCell) {
            startEditing(selectedCell);
            setEditValue(val);
          }
        }}
        onCommit={() => {
          if (editingCell) commitEdit();
        }}
      />

      {/* Grid */}
      <div style={ss.gridScroll}>
        <table
          style={{
            borderCollapse: "collapse",
            tableLayout: "fixed",
            minWidth: "100%",
          }}
        >
          <thead>
            <tr>
              {/* Corner cell */}
              <th style={ss.corner}></th>
              {/* Column headers */}
              {Array.from({ length: visibleCols }, (_, ci) => (
                <th
                  key={ci}
                  style={{
                    ...ss.headerCell,
                    width: colWidths[colLabel(ci)] || 100,
                  }}
                >
                  {colLabel(ci)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: visibleRows }, (_, ri) => (
              <tr key={ri}>
                {/* Row header */}
                <td style={ss.rowHeader}>{ri + 1}</td>
                {/* Data cells */}
                {Array.from({ length: visibleCols }, (_, ci) => {
                  const key = cellKey(ci, ri);
                  const cell = cells[key];
                  const display = getCellDisplay(cell);
                  const isSelected = selectedCell === key;
                  const isEditing = editingCell === key;
                  const hasFormula = !!getCellFormula(cell);

                  return (
                    <td
                      key={ci}
                      style={{
                        ...ss.cell,
                        width: colWidths[colLabel(ci)] || 100,
                        background: isSelected ? `${C.accent}18` : "transparent",
                        outline: isSelected ? `2px solid ${C.accent}` : "none",
                        outlineOffset: -1,
                        position: "relative",
                        color: hasFormula ? C.accent : C.darkText,
                        fontFamily: typeof display === "number" ? MONO : FONT,
                        textAlign: typeof display === "number" ? "right" : "left",
                      }}
                      onClick={() => {
                        if (editingCell && editingCell !== key) commitEdit();
                        setSelectedCell(key);
                      }}
                      onDoubleClick={() => startEditing(key)}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitEdit();
                            }
                            if (e.key === "Escape") cancelEdit();
                            if (e.key === "Tab") {
                              e.preventDefault();
                              commitEdit();
                              // Move right
                              if (ci < colCount - 1) setSelectedCell(cellKey(ci + 1, ri));
                            }
                          }}
                          style={ss.input}
                          autoFocus
                        />
                      ) : (
                        String(display)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Status bar */}
      <div style={ss.statusBar}>
        <span>{selectedCell || "—"}</span>
        {selectedFormula && (
          <span style={{ color: C.accent }}>
            ƒ {selectedFormula}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span>{colCount} × {rowCount}</span>
      </div>
    </div>
  );
}
