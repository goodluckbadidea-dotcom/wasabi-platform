// ─── Sheet View ───
// Full-featured spreadsheet grid with Google Sheets-level functionality.
// Cells stored as { "A1": { v: value, f?: formula }, ... }
// Reads/writes via /sheets/:id API routes.

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { C, FONT, MONO, RADIUS, SHADOW } from "../design/tokens.js";
import { getSheet, updateSheet, sheetFormula, resizeSheet } from "../lib/api.js";
import { sheetStructure } from "../lib/api.js";
import FormulaBar from "../components/FormulaBar.jsx";
import SheetToolbar from "../components/SheetToolbar.jsx";
import ContextMenu from "../core/ContextMenu.jsx";
import { isNeuronsMode, dispatchNeuronSelect } from "../neurons/NeuronsContext.jsx";

// ─── Constants ───
const ROW_HEIGHT = 28;
const COL_WIDTH = 100;
const ROW_HEADER_W = 50;
const VIRT_BUFFER = 10;
const MAX_UNDO = 100;

// ─── Helpers ───

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

function colIndex(label) {
  let idx = 0;
  for (let i = 0; i < label.length; i++) {
    idx = idx * 26 + (label.charCodeAt(i) - 64);
  }
  return idx - 1;
}

function cellKey(col, row) {
  return `${colLabel(col)}${row + 1}`;
}

function parseKey(key) {
  const m = key.match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  return { col: colIndex(m[1]), row: parseInt(m[2]) - 1 };
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

function normalizeRange(sel) {
  if (!sel) return null;
  return {
    c1: Math.min(sel.anchor.col, sel.focus.col),
    r1: Math.min(sel.anchor.row, sel.focus.row),
    c2: Math.max(sel.anchor.col, sel.focus.col),
    r2: Math.max(sel.anchor.row, sel.focus.row),
  };
}

function isCellInRange(col, row, range) {
  if (!range) return false;
  return col >= range.c1 && col <= range.c2 && row >= range.r1 && row <= range.r2;
}

function formatCellValue(value, style) {
  if (value === null || value === undefined || value === "") return "";
  if (!style?.fmt) return String(value);
  const num = Number(value);
  if (isNaN(num)) return String(value);
  const dec = style.decimals ?? 2;
  switch (style.fmt) {
    case "currency": return "$" + num.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    case "percent": return (num * 100).toFixed(dec) + "%";
    case "decimal": return num.toFixed(dec);
    case "thousands": return num.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    default: return String(value);
  }
}

// ─── Styles ───

function buildSheetStyles() {
  const cellBase = {
    padding: "0 8px",
    fontSize: 13,
    fontFamily: FONT,
    color: C.darkText,
    borderRight: `1px solid ${C.edgeLine}`,
    borderBottom: `1px solid ${C.edgeLine}`,
    height: ROW_HEIGHT,
    lineHeight: `${ROW_HEIGHT}px`,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "cell",
    boxSizing: "border-box",
    minWidth: 40,
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
      width: ROW_HEADER_W,
      minWidth: ROW_HEADER_W,
      maxWidth: ROW_HEADER_W,
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
      textAlign: "center",
      cursor: "default",
      position: "sticky",
      top: 0,
      left: 0,
      zIndex: 3,
      width: ROW_HEADER_W,
      minWidth: ROW_HEADER_W,
      maxWidth: ROW_HEADER_W,
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

  // ── Core data state ──
  const [cells, setCells] = useState({});
  const [colCount, setColCount] = useState(26);
  const [rowCount, setRowCount] = useState(100);
  const [colWidths, setColWidths] = useState({});
  const [rowHeights, setRowHeights] = useState({});
  const [frozen, setFrozen] = useState({ cols: 0, rows: 0 });
  const [cellStyles, setCellStyles] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── Selection state ──
  const [selection, setSelection] = useState(null); // { anchor: {col,row}, focus: {col,row} }
  const [multiSelections, setMultiSelections] = useState([]);
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [dragSelecting, setDragSelecting] = useState(false);

  // ── Clipboard ──
  const [clipboard, setClipboard] = useState(null);

  // ── Undo/Redo ──
  const undoStack = useRef([]);
  const redoStack = useRef([]);

  // ── Context menu ──
  const [contextMenu, setContextMenu] = useState(null);

  // ── Find/Replace ──
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [findMatches, setFindMatches] = useState([]);
  const [findIndex, setFindIndex] = useState(0);

  // ── Filters ──
  const [filters, setFilters] = useState({});
  const [filterOpen, setFilterOpen] = useState(null);

  // ── Virtualization ──
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const scrollRAF = useRef(null);

  // ── Refs ──
  const inputRef = useRef(null);
  const saveTimer = useRef(null);
  const pendingChanges = useRef({});
  const pendingStyleChanges = useRef({});
  const resizeDrag = useRef(null);
  const rowResizeDrag = useRef(null);
  const fillDragRef = useRef(null);
  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;
  const rowHeightsRef = useRef(rowHeights);
  rowHeightsRef.current = rowHeights;
  const scrollRef = useRef(null);
  const tableRef = useRef(null);
  const cellsRef = useRef(cells);
  cellsRef.current = cells;

  // ── Derived: selectedCell string for FormulaBar compat ──
  const selectedCell = useMemo(() => {
    if (!selection) return null;
    return cellKey(selection.anchor.col, selection.anchor.row);
  }, [selection]);

  const selRange = useMemo(() => normalizeRange(selection), [selection]);

  // ── Hidden rows from filters ──
  const hiddenRows = useMemo(() => {
    const hidden = new Set();
    const filterCols = Object.keys(filters);
    if (filterCols.length === 0) return hidden;
    for (let r = 0; r < rowCount; r++) {
      for (const colIdx of filterCols) {
        const allowed = filters[colIdx];
        if (!allowed || allowed.size === 0) continue;
        const val = String(getCellDisplay(cells[cellKey(parseInt(colIdx), r)]) || "");
        if (!allowed.has(val)) {
          hidden.add(r);
          break;
        }
      }
    }
    return hidden;
  }, [filters, cells, rowCount]);

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
        setRowHeights(data.row_heights ? (typeof data.row_heights === "string" ? JSON.parse(data.row_heights) : data.row_heights) : {});
        setFrozen(data.frozen ? (typeof data.frozen === "string" ? JSON.parse(data.frozen) : data.frozen) : { cols: 0, rows: 0 });
        setCellStyles(data.cell_styles ? (typeof data.cell_styles === "string" ? JSON.parse(data.cell_styles) : data.cell_styles) : {});
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
    const cellChanges = { ...pendingChanges.current };
    const styleChanges = { ...pendingStyleChanges.current };
    pendingChanges.current = {};
    pendingStyleChanges.current = {};
    const payload = {};
    if (Object.keys(cellChanges).length > 0) payload.cells = cellChanges;
    if (Object.keys(styleChanges).length > 0) payload.cell_styles = styleChanges;
    if (Object.keys(payload).length === 0) return;
    updateSheet(sheetId, payload).catch((err) => {
      console.error("Sheet save failed:", err);
    });
  }, [sheetId]);

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushChanges, 800);
  }, [flushChanges]);

  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current);
      flushChanges();
    };
  }, [flushChanges]);

  // ─── Cell Operations ───

  const updateCell = useCallback((key, value) => {
    const cellValue = value === "" ? null : (typeof value === "object" ? value : { v: value });
    setCells((prev) => {
      const next = { ...prev };
      if (cellValue === null) delete next[key];
      else next[key] = cellValue;
      return next;
    });
    pendingChanges.current[key] = cellValue;
    scheduleSave();
  }, [scheduleSave]);

  // ── Undo-aware cell update ──
  const updateCellWithUndo = useCallback((key, value) => {
    const prevVal = cellsRef.current[key] ? structuredClone(cellsRef.current[key]) : null;
    const newVal = value === "" ? null : (typeof value === "object" ? value : { v: value });
    undoStack.current.push({ undo: { [key]: prevVal }, redo: { [key]: newVal } });
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
    updateCell(key, value);
  }, [updateCell]);

  const batchUpdateWithUndo = useCallback((patch) => {
    const undoPatch = {};
    const redoPatch = {};
    for (const [key, val] of Object.entries(patch)) {
      undoPatch[key] = cellsRef.current[key] ? structuredClone(cellsRef.current[key]) : null;
      redoPatch[key] = val;
    }
    undoStack.current.push({ undo: undoPatch, redo: redoPatch });
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
    setCells((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete next[k]; else next[k] = v;
      }
      return next;
    });
    Object.assign(pendingChanges.current, patch);
    scheduleSave();
  }, [scheduleSave]);

  const applyUndoRedo = useCallback((patch) => {
    setCells((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete next[k]; else next[k] = v;
      }
      return next;
    });
    Object.assign(pendingChanges.current, patch);
    scheduleSave();
  }, [scheduleSave]);

  // ── Cell styles update ──
  const applyStyleToSelection = useCallback((prop, value) => {
    if (!selRange) return;
    const stylePatch = {};
    for (let r = selRange.r1; r <= selRange.r2; r++) {
      for (let c = selRange.c1; c <= selRange.c2; c++) {
        const key = cellKey(c, r);
        stylePatch[key] = { ...(cellStyles[key] || {}), [prop]: value };
      }
    }
    setCellStyles((prev) => ({ ...prev, ...stylePatch }));
    Object.assign(pendingStyleChanges.current, stylePatch);
    scheduleSave();
  }, [selRange, cellStyles, scheduleSave]);

  const applyMerge = useCallback(() => {
    if (!selRange || (selRange.c1 === selRange.c2 && selRange.r1 === selRange.r2)) return;
    const key = cellKey(selRange.c1, selRange.r1);
    const merge = { cols: selRange.c2 - selRange.c1 + 1, rows: selRange.r2 - selRange.r1 + 1 };
    const stylePatch = { [key]: { ...(cellStyles[key] || {}), merge } };
    // Clear other cells in merged range
    for (let r = selRange.r1; r <= selRange.r2; r++) {
      for (let c = selRange.c1; c <= selRange.c2; c++) {
        if (r === selRange.r1 && c === selRange.c1) continue;
        const k = cellKey(c, r);
        stylePatch[k] = { ...(cellStyles[k] || {}), merge: null, _merged: `${key}` };
      }
    }
    setCellStyles((prev) => ({ ...prev, ...stylePatch }));
    Object.assign(pendingStyleChanges.current, stylePatch);
    scheduleSave();
  }, [selRange, cellStyles, scheduleSave]);

  // ── Editing ──
  const startEditing = useCallback((key) => {
    const cell = cellsRef.current[key];
    const formula = getCellFormula(cell);
    setEditingCell(key);
    setEditValue(formula || String(getCellDisplay(cell)));
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const commitEdit = useCallback(async () => {
    if (!editingCell) return;
    const val = editValue.trim();

    // Auto-expand grid if needed
    const pos = parseKey(editingCell);
    if (pos) {
      const newCC = Math.max(colCount, pos.col + 2);
      const newRC = Math.max(rowCount, pos.row + 2);
      if (newCC > colCount || newRC > rowCount) {
        setColCount(newCC);
        setRowCount(newRC);
        resizeSheet(sheetId, { col_count: newCC, row_count: newRC }).catch(err => console.warn("[Sheet] resizeSheet:", err.message || err));
      }
    }

    // Inline formula detection
    if (val.startsWith("=")) {
      const fMatch = val.match(/^=(\w+)\((.+)\)$/i);
      if (fMatch) {
        try {
          const result = await sheetFormula(sheetId, fMatch[1], fMatch[2], editingCell);
          const cellValue = { v: result.value, f: val };
          setCells((prev) => ({ ...prev, [editingCell]: cellValue }));
          const prevVal = cellsRef.current[editingCell] ? structuredClone(cellsRef.current[editingCell]) : null;
          undoStack.current.push({ undo: { [editingCell]: prevVal }, redo: { [editingCell]: cellValue } });
          if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
          redoStack.current = [];
          pendingChanges.current[editingCell] = cellValue;
          scheduleSave();
        } catch {
          updateCellWithUndo(editingCell, val);
        }
      } else {
        updateCellWithUndo(editingCell, val);
      }
    } else {
      updateCellWithUndo(editingCell, val);
    }
    setEditingCell(null);
    setEditValue("");
  }, [editingCell, editValue, sheetId, colCount, rowCount, updateCellWithUndo, scheduleSave]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue("");
  }, []);

  // ─── Column resize ───
  const handleColResize = useCallback((colIdx, e) => {
    e.preventDefault();
    e.stopPropagation();
    const col = colLabel(colIdx);
    const startX = e.clientX;
    const startW = colWidthsRef.current[col] || COL_WIDTH;
    resizeDrag.current = { col, startX, startW };
    const onMove = (me) => {
      if (!resizeDrag.current) return;
      const dx = me.clientX - resizeDrag.current.startX;
      const newW = Math.max(40, resizeDrag.current.startW + dx);
      setColWidths((prev) => ({ ...prev, [resizeDrag.current.col]: newW }));
    };
    const onUp = () => {
      if (resizeDrag.current) {
        const finalWidths = { ...colWidthsRef.current };
        updateSheet(sheetId, { col_widths: finalWidths }).catch(err => console.warn("[Sheet] updateSheet:", err.message || err));
      }
      resizeDrag.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sheetId]);

  // ─── Row resize ───
  const handleRowResize = useCallback((rowIdx, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = rowHeightsRef.current[rowIdx + 1] || ROW_HEIGHT;
    rowResizeDrag.current = { row: rowIdx + 1, startY, startH };
    const onMove = (me) => {
      if (!rowResizeDrag.current) return;
      const dy = me.clientY - rowResizeDrag.current.startY;
      const newH = Math.max(20, rowResizeDrag.current.startH + dy);
      setRowHeights((prev) => ({ ...prev, [rowResizeDrag.current.row]: newH }));
    };
    const onUp = () => {
      if (rowResizeDrag.current) {
        updateSheet(sheetId, { row_heights: rowHeightsRef.current }).catch(err => console.warn("[Sheet] updateSheet:", err.message || err));
      }
      rowResizeDrag.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sheetId]);

  // ─── Column auto-fit ───
  const handleColAutoFit = useCallback((colIdx) => {
    const col = colLabel(colIdx);
    let maxW = 40;
    for (let r = 0; r < rowCount; r++) {
      const val = String(getCellDisplay(cells[cellKey(colIdx, r)]) || "");
      maxW = Math.max(maxW, val.length * 8 + 24);
    }
    maxW = Math.min(maxW, 400);
    setColWidths((prev) => ({ ...prev, [col]: maxW }));
    updateSheet(sheetId, { col_widths: { ...colWidthsRef.current, [col]: maxW } }).catch(err => console.warn("[Sheet] updateSheet:", err.message || err));
  }, [cells, rowCount, sheetId]);

  // ─── Structure operations ───
  const handleStructure = useCallback(async (action, index) => {
    try {
      const result = await sheetStructure(sheetId, action, index);
      if (result.cells) setCells(result.cells);
      if (result.col_count) setColCount(result.col_count);
      if (result.row_count) setRowCount(result.row_count);
    } catch (err) {
      console.error("Structure operation failed:", err);
    }
    setContextMenu(null);
  }, [sheetId]);

  // ─── Freeze toggle ───
  const toggleFreezeCol = useCallback((colIdx) => {
    const newFrozen = { ...frozen, cols: frozen.cols >= colIdx ? 0 : colIdx };
    setFrozen(newFrozen);
    updateSheet(sheetId, { frozen: newFrozen }).catch(err => console.warn("[Sheet] updateSheet:", err.message || err));
    setContextMenu(null);
  }, [frozen, sheetId]);

  const toggleFreezeRow = useCallback((rowIdx) => {
    const newFrozen = { ...frozen, rows: frozen.rows >= rowIdx ? 0 : rowIdx };
    setFrozen(newFrozen);
    updateSheet(sheetId, { frozen: newFrozen }).catch(err => console.warn("[Sheet] updateSheet:", err.message || err));
    setContextMenu(null);
  }, [frozen, sheetId]);

  // ─── Sort ───
  const sortColumn = useCallback((colIdx, direction) => {
    const rowData = [];
    for (let r = 0; r < rowCount; r++) {
      const val = getCellDisplay(cells[cellKey(colIdx, r)]);
      rowData.push({ row: r, val });
    }
    rowData.sort((a, b) => {
      const va = a.val, vb = b.val;
      if (va === "" && vb === "") return 0;
      if (va === "") return 1;
      if (vb === "") return -1;
      const na = Number(va), nb = Number(vb);
      if (!isNaN(na) && !isNaN(nb)) return direction === "asc" ? na - nb : nb - na;
      return direction === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    const newCells = {};
    rowData.forEach((rd, newIdx) => {
      for (let c = 0; c < colCount; c++) {
        const oldKey = cellKey(c, rd.row);
        const newKey = cellKey(c, newIdx);
        if (cells[oldKey]) newCells[newKey] = cells[oldKey];
      }
    });
    batchUpdateWithUndo(newCells);
    setContextMenu(null);
  }, [cells, colCount, rowCount, batchUpdateWithUndo]);

  // ─── Find ───
  const performFind = useCallback((text) => {
    if (!text) { setFindMatches([]); return; }
    const matches = [];
    const lower = text.toLowerCase();
    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        const val = String(getCellDisplay(cells[cellKey(c, r)]) || "").toLowerCase();
        if (val.includes(lower)) matches.push({ col: c, row: r });
      }
    }
    setFindMatches(matches);
    setFindIndex(0);
    if (matches.length > 0) {
      setSelection({ anchor: matches[0], focus: matches[0] });
    }
  }, [cells, colCount, rowCount]);

  const findNext = useCallback(() => {
    if (findMatches.length === 0) return;
    const next = (findIndex + 1) % findMatches.length;
    setFindIndex(next);
    setSelection({ anchor: findMatches[next], focus: findMatches[next] });
  }, [findMatches, findIndex]);

  const findPrev = useCallback(() => {
    if (findMatches.length === 0) return;
    const prev = findIndex <= 0 ? findMatches.length - 1 : findIndex - 1;
    setFindIndex(prev);
    setSelection({ anchor: findMatches[prev], focus: findMatches[prev] });
  }, [findMatches, findIndex]);

  const replaceOne = useCallback(() => {
    if (findMatches.length === 0) return;
    const match = findMatches[findIndex];
    const key = cellKey(match.col, match.row);
    const current = String(getCellDisplay(cells[key]) || "");
    const replaced = current.replace(new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), replaceText);
    updateCellWithUndo(key, replaced);
    performFind(findText);
  }, [findMatches, findIndex, findText, replaceText, cells, updateCellWithUndo, performFind]);

  const replaceAll = useCallback(() => {
    if (findMatches.length === 0) return;
    const patch = {};
    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    for (const match of findMatches) {
      const key = cellKey(match.col, match.row);
      const current = String(getCellDisplay(cells[key]) || "");
      patch[key] = { v: current.replace(regex, replaceText) };
    }
    batchUpdateWithUndo(patch);
    performFind(findText);
  }, [findMatches, findText, replaceText, cells, batchUpdateWithUndo, performFind]);

  // ─── Auto-fill ───
  const startFillDrag = useCallback((e) => {
    if (!selRange) return;
    e.preventDefault();
    e.stopPropagation();
    fillDragRef.current = { ...selRange, endCol: selRange.c2, endRow: selRange.r2 };
    const onMove = (me) => {
      if (!fillDragRef.current || !scrollRef.current) return;
      const rect = scrollRef.current.getBoundingClientRect();
      const y = me.clientY - rect.top + scrollRef.current.scrollTop;
      const rowIdx = Math.max(0, Math.min(rowCount - 1, Math.floor((y - ROW_HEIGHT) / ROW_HEIGHT)));
      fillDragRef.current.endRow = Math.max(selRange.r2, rowIdx);
    };
    const onUp = () => {
      if (fillDragRef.current && fillDragRef.current.endRow > selRange.r2) {
        executeFill(fillDragRef.current);
      }
      fillDragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [selRange, rowCount]);

  const executeFill = useCallback((fillRange) => {
    if (!selRange) return;
    const srcRows = selRange.r2 - selRange.r1 + 1;
    const patch = {};
    for (let c = selRange.c1; c <= selRange.c2; c++) {
      // Collect source values for this column
      const srcVals = [];
      for (let r = selRange.r1; r <= selRange.r2; r++) {
        srcVals.push(getCellDisplay(cells[cellKey(c, r)]));
      }
      // Detect number series
      const nums = srcVals.map(Number);
      const allNums = nums.every((n) => !isNaN(n)) && srcVals.length >= 1;
      const diff = allNums && srcVals.length >= 2 ? nums[1] - nums[0] : (allNums ? 1 : 0);

      for (let r = selRange.r2 + 1; r <= fillRange.endRow; r++) {
        const fillIdx = r - selRange.r2 - 1;
        let val;
        if (allNums) {
          val = nums[nums.length - 1] + diff * (fillIdx + 1);
        } else {
          val = srcVals[fillIdx % srcRows];
        }
        patch[cellKey(c, r)] = { v: val };
      }
    }
    batchUpdateWithUndo(patch);
  }, [selRange, cells, batchUpdateWithUndo]);

  // ─── Filter dropdown ───
  const getUniqueColValues = useCallback((colIdx) => {
    const vals = new Set();
    for (let r = 0; r < rowCount; r++) {
      const val = String(getCellDisplay(cells[cellKey(colIdx, r)]) || "");
      vals.add(val);
    }
    return [...vals].sort();
  }, [cells, rowCount]);

  const toggleFilter = useCallback((colIdx, value) => {
    setFilters((prev) => {
      const current = prev[colIdx] ? new Set(prev[colIdx]) : new Set(getUniqueColValues(colIdx));
      if (current.has(value)) current.delete(value);
      else current.add(value);
      const next = { ...prev };
      if (current.size === getUniqueColValues(colIdx).length) {
        delete next[colIdx];
      } else {
        next[colIdx] = current;
      }
      return next;
    });
  }, [getUniqueColValues]);

  // ─── End drag selecting on mouseup ───
  useEffect(() => {
    const handleUp = () => setDragSelecting(false);
    document.addEventListener("mouseup", handleUp);
    return () => document.removeEventListener("mouseup", handleUp);
  }, []);

  // ─── Formula Handler ───
  const handleFormula = useCallback(async (fn, args, target) => {
    try {
      const result = await sheetFormula(sheetId, fn, args, target);
      const cellValue = { v: result.value, f: result.formula };
      setCells((prev) => ({ ...prev, [target]: cellValue }));
      pendingChanges.current[target] = cellValue;
      scheduleSave();
    } catch (err) {
      console.error("Formula failed:", err);
    }
  }, [sheetId, scheduleSave]);

  // ─── Keyboard handler ───
  const handleKeyDown = useCallback((e) => {
    // Find/replace shortcuts
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      setFindOpen(true);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "h") {
      e.preventDefault();
      setFindOpen(true);
      return;
    }

    // Undo/Redo
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      if (undoStack.current.length === 0) return;
      const entry = undoStack.current.pop();
      redoStack.current.push(entry);
      applyUndoRedo(entry.undo);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
      e.preventDefault();
      if (redoStack.current.length === 0) return;
      const entry = redoStack.current.pop();
      undoStack.current.push(entry);
      applyUndoRedo(entry.redo);
      return;
    }

    // Formatting shortcuts
    if ((e.ctrlKey || e.metaKey) && e.key === "b") {
      e.preventDefault();
      const curStyle = selectedCell ? (cellStyles[selectedCell] || {}) : {};
      applyStyleToSelection("bold", !curStyle.bold);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "i" && !e.shiftKey) {
      e.preventDefault();
      const curStyle = selectedCell ? (cellStyles[selectedCell] || {}) : {};
      applyStyleToSelection("italic", !curStyle.italic);
      return;
    }

    if (!selection) return;
    const { col, row } = selection.anchor;

    // Copy
    if ((e.ctrlKey || e.metaKey) && e.key === "c") {
      e.preventDefault();
      const nr = selRange;
      if (!nr) return;
      const copiedCells = {};
      for (let r = nr.r1; r <= nr.r2; r++) {
        for (let c = nr.c1; c <= nr.c2; c++) {
          const k = cellKey(c, r);
          if (cellsRef.current[k]) copiedCells[k] = structuredClone(cellsRef.current[k]);
        }
      }
      setClipboard({ cells: copiedCells, range: nr, isCut: false });
      let tsv = "";
      for (let r = nr.r1; r <= nr.r2; r++) {
        const rowArr = [];
        for (let c = nr.c1; c <= nr.c2; c++) {
          rowArr.push(String(getCellDisplay(cellsRef.current[cellKey(c, r)]) || ""));
        }
        tsv += rowArr.join("\t") + "\n";
      }
      navigator.clipboard.writeText(tsv).catch(err => console.warn("[Sheet] clipboard write:", err.message || err));
      return;
    }

    // Cut
    if ((e.ctrlKey || e.metaKey) && e.key === "x") {
      e.preventDefault();
      const nr = selRange;
      if (!nr) return;
      const copiedCells = {};
      for (let r = nr.r1; r <= nr.r2; r++) {
        for (let c = nr.c1; c <= nr.c2; c++) {
          const k = cellKey(c, r);
          if (cellsRef.current[k]) copiedCells[k] = structuredClone(cellsRef.current[k]);
        }
      }
      setClipboard({ cells: copiedCells, range: nr, isCut: true });
      let tsv = "";
      for (let r = nr.r1; r <= nr.r2; r++) {
        const rowArr = [];
        for (let c = nr.c1; c <= nr.c2; c++) {
          rowArr.push(String(getCellDisplay(cellsRef.current[cellKey(c, r)]) || ""));
        }
        tsv += rowArr.join("\t") + "\n";
      }
      navigator.clipboard.writeText(tsv).catch(err => console.warn("[Sheet] clipboard write:", err.message || err));
      return;
    }

    // Paste
    if ((e.ctrlKey || e.metaKey) && e.key === "v") {
      e.preventDefault();
      if (clipboard) {
        const src = clipboard.range;
        const patch = {};
        for (let r = src.r1; r <= src.r2; r++) {
          for (let c = src.c1; c <= src.c2; c++) {
            const srcKey = cellKey(c, r);
            const destKey = cellKey(col + (c - src.c1), row + (r - src.r1));
            patch[destKey] = clipboard.cells[srcKey] || null;
          }
        }
        batchUpdateWithUndo(patch);
        if (clipboard.isCut) {
          const clearPatch = {};
          for (const k of Object.keys(clipboard.cells)) {
            clearPatch[k] = null;
          }
          batchUpdateWithUndo(clearPatch);
          setClipboard(null);
        }
      } else {
        navigator.clipboard.readText().then((text) => {
          if (!text) return;
          const rows = text.split("\n").filter((r) => r.length > 0);
          const patch = {};
          rows.forEach((rowStr, ri) => {
            const cols = rowStr.split("\t");
            cols.forEach((val, ci) => {
              patch[cellKey(col + ci, row + ri)] = val ? { v: val } : null;
            });
          });
          batchUpdateWithUndo(patch);
        }).catch(err => console.warn("[Sheet] clipboard read:", err.message || err));
      }
      return;
    }

    // Select all
    if ((e.ctrlKey || e.metaKey) && e.key === "a") {
      e.preventDefault();
      setSelection({ anchor: { col: 0, row: 0 }, focus: { col: colCount - 1, row: rowCount - 1 } });
      return;
    }

    if (editingCell) {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit();
        if (row < rowCount - 1) {
          setSelection({ anchor: { col, row: row + 1 }, focus: { col, row: row + 1 } });
        }
      } else if (e.key === "Escape") {
        cancelEdit();
      } else if (e.key === "Tab") {
        e.preventDefault();
        commitEdit();
        if (e.shiftKey) {
          if (col > 0) {
            const nc = col - 1;
            setSelection({ anchor: { col: nc, row }, focus: { col: nc, row } });
            setTimeout(() => startEditing(cellKey(nc, row)), 0);
          }
        } else if (col < colCount - 1) {
          const nc = col + 1;
          setSelection({ anchor: { col: nc, row }, focus: { col: nc, row } });
          setTimeout(() => startEditing(cellKey(nc, row)), 0);
        }
      }
      return;
    }

    // Shift+Arrow extends selection
    if (e.shiftKey && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      setSelection((prev) => {
        if (!prev) return prev;
        const f = { ...prev.focus };
        if (e.key === "ArrowDown" && f.row < rowCount - 1) f.row++;
        if (e.key === "ArrowUp" && f.row > 0) f.row--;
        if (e.key === "ArrowRight" && f.col < colCount - 1) f.col++;
        if (e.key === "ArrowLeft" && f.col > 0) f.col--;
        return { anchor: prev.anchor, focus: f };
      });
      return;
    }

    switch (e.key) {
      case "Enter":
      case "F2":
        e.preventDefault();
        startEditing(selectedCell);
        break;
      case "ArrowDown":
        e.preventDefault();
        if (row < rowCount - 1) setSelection({ anchor: { col, row: row + 1 }, focus: { col, row: row + 1 } });
        break;
      case "ArrowUp":
        e.preventDefault();
        if (row > 0) setSelection({ anchor: { col, row: row - 1 }, focus: { col, row: row - 1 } });
        break;
      case "ArrowRight":
        e.preventDefault();
        if (col < colCount - 1) setSelection({ anchor: { col: col + 1, row }, focus: { col: col + 1, row } });
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (col > 0) setSelection({ anchor: { col: col - 1, row }, focus: { col: col - 1, row } });
        break;
      case "Tab":
        e.preventDefault();
        if (e.shiftKey) {
          if (col > 0) {
            const nc = col - 1;
            setSelection({ anchor: { col: nc, row }, focus: { col: nc, row } });
            setTimeout(() => startEditing(cellKey(nc, row)), 0);
          }
        } else if (col < colCount - 1) {
          const nc = col + 1;
          setSelection({ anchor: { col: nc, row }, focus: { col: nc, row } });
          setTimeout(() => startEditing(cellKey(nc, row)), 0);
        }
        break;
      case "Delete":
      case "Backspace": {
        e.preventDefault();
        const nr = selRange;
        if (!nr) break;
        const patch = {};
        for (let r = nr.r1; r <= nr.r2; r++) {
          for (let c = nr.c1; c <= nr.c2; c++) {
            patch[cellKey(c, r)] = null;
          }
        }
        batchUpdateWithUndo(patch);
        break;
      }
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          setEditingCell(selectedCell);
          setEditValue(e.key);
          setTimeout(() => inputRef.current?.focus(), 0);
        }
    }
  }, [selection, selRange, editingCell, editValue, selectedCell, commitEdit, cancelEdit, startEditing,
      colCount, rowCount, clipboard, batchUpdateWithUndo, applyUndoRedo, applyStyleToSelection, cellStyles, scheduleSave]);

  // ─── Scroll handler ───
  const handleScroll = useCallback((e) => {
    if (scrollRAF.current) cancelAnimationFrame(scrollRAF.current);
    scrollRAF.current = requestAnimationFrame(() => {
      setScrollTop(e.target.scrollTop);
      setScrollLeft(e.target.scrollLeft);
    });
  }, []);

  // ─── Virtualization ───
  const containerHeight = scrollRef.current?.clientHeight || 600;
  const containerWidth = scrollRef.current?.clientWidth || 800;

  const visibleRowRange = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VIRT_BUFFER);
    const end = Math.min(rowCount, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + VIRT_BUFFER);
    return { start, end };
  }, [scrollTop, containerHeight, rowCount]);

  const visibleColRange = useMemo(() => {
    let cumX = 0;
    let startCol = 0;
    let endCol = colCount;
    for (let i = 0; i < colCount; i++) {
      const w = colWidths[colLabel(i)] || COL_WIDTH;
      if (cumX + w < scrollLeft - 300) startCol = i;
      if (cumX > scrollLeft + containerWidth + 300) { endCol = i; break; }
      cumX += w;
    }
    return { start: startCol, end: Math.min(endCol, colCount) };
  }, [scrollLeft, containerWidth, colCount, colWidths]);

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.error, fontSize: 13 }}>
        Error: {error}
      </div>
    );
  }

  const selectedFormula = selectedCell ? getCellFormula(cells[selectedCell]) : null;
  const selectedValue = selectedCell ? getCellDisplay(cells[selectedCell]) : "";

  // Pre-compute frozen column widths
  let frozenColWidth = 0;
  for (let i = 0; i < frozen.cols; i++) {
    frozenColWidth += colWidths[colLabel(i)] || COL_WIDTH;
  }

  // Pre-compute left spacer for virtualized columns
  let leftSpacerWidth = 0;
  for (let i = 0; i < visibleColRange.start; i++) {
    leftSpacerWidth += colWidths[colLabel(i)] || COL_WIDTH;
  }
  let rightSpacerWidth = 0;
  for (let i = visibleColRange.end; i < colCount; i++) {
    rightSpacerWidth += colWidths[colLabel(i)] || COL_WIDTH;
  }

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

      {/* Toolbar */}
      <SheetToolbar
        selection={selection}
        cellStyles={cellStyles}
        onStyleChange={applyStyleToSelection}
        onMerge={applyMerge}
      />

      {/* Find/Replace bar */}
      {findOpen && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6, padding: "5px 8px",
          borderBottom: `1px solid ${C.edgeLine}`, background: C.darkSurf, fontSize: 12,
        }}>
          <input
            value={findText}
            onChange={(e) => { setFindText(e.target.value); performFind(e.target.value); }}
            placeholder="Find..."
            style={{ flex: 1, maxWidth: 180, background: C.dark, border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.sm,
              padding: "3px 8px", fontSize: 12, fontFamily: FONT, color: C.darkText, outline: "none" }}
            autoFocus
            autoComplete="off"
            onKeyDown={(e) => { if (e.key === "Enter") findNext(); if (e.key === "Escape") setFindOpen(false); }}
          />
          <input
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="Replace..."
            style={{ flex: 1, maxWidth: 180, background: C.dark, border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.sm,
              padding: "3px 8px", fontSize: 12, fontFamily: FONT, color: C.darkText, outline: "none" }}
            autoComplete="off"
            onKeyDown={(e) => { if (e.key === "Enter") replaceOne(); }}
          />
          <span style={{ fontSize: 10, color: C.darkMuted, minWidth: 50 }}>
            {findMatches.length > 0 ? `${findIndex + 1}/${findMatches.length}` : "0/0"}
          </span>
          <button onClick={findPrev} style={_btnStyle()} title="Previous">↑</button>
          <button onClick={findNext} style={_btnStyle()} title="Next">↓</button>
          <button onClick={replaceOne} style={_btnStyle()}>Replace</button>
          <button onClick={replaceAll} style={_btnStyle()}>All</button>
          <button onClick={() => setFindOpen(false)} style={_btnStyle()}>✕</button>
        </div>
      )}

      {/* Grid */}
      <div
        ref={scrollRef}
        style={ss.gridScroll}
        onScroll={handleScroll}
        onMouseMove={(e) => {
          if (!dragSelecting || !scrollRef.current) return;
          const rect = scrollRef.current.getBoundingClientRect();
          const x = e.clientX - rect.left + scrollRef.current.scrollLeft - ROW_HEADER_W;
          const y = e.clientY - rect.top + scrollRef.current.scrollTop - ROW_HEIGHT;
          // Compute col from x
          let cumX = 0, colIdx = 0;
          for (let i = 0; i < colCount; i++) {
            const w = colWidths[colLabel(i)] || COL_WIDTH;
            if (x < cumX + w) { colIdx = i; break; }
            cumX += w;
            colIdx = i;
          }
          const rowIdx = Math.max(0, Math.min(rowCount - 1, Math.floor(y / ROW_HEIGHT)));
          setSelection((prev) => prev ? { anchor: prev.anchor, focus: { col: Math.max(0, colIdx), row: rowIdx } } : prev);
        }}
      >
        <table
          ref={tableRef}
          style={{ borderCollapse: "collapse", tableLayout: "fixed", minWidth: "100%" }}
        >
          <thead>
            <tr>
              <th style={ss.corner}></th>
              {/* Left spacer */}
              {leftSpacerWidth > 0 && <th style={{ width: leftSpacerWidth, padding: 0, border: "none" }} />}
              {Array.from({ length: visibleColRange.end - visibleColRange.start }, (_, i) => {
                const ci = visibleColRange.start + i;
                const isFrozenCol = ci < frozen.cols;
                let frozenLeft = ROW_HEADER_W;
                if (isFrozenCol) {
                  for (let fc = 0; fc < ci; fc++) frozenLeft += colWidths[colLabel(fc)] || COL_WIDTH;
                }
                return (
                  <th
                    key={ci}
                    style={{
                      ...ss.headerCell,
                      width: colWidths[colLabel(ci)] || COL_WIDTH,
                      position: isFrozenCol ? "sticky" : "sticky",
                      left: isFrozenCol ? frozenLeft : undefined,
                      zIndex: isFrozenCol ? 4 : 2,
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, type: "colHeader", index: ci });
                    }}
                    onDoubleClick={() => handleColAutoFit(ci)}
                  >
                    {colLabel(ci)}
                    {/* Filter icon */}
                    <span
                      style={{ position: "absolute", right: 8, top: 0, bottom: 0, display: "flex", alignItems: "center",
                        fontSize: 9, color: filters[ci] ? C.accent : C.darkBorder, cursor: "pointer" }}
                      onClick={(e) => { e.stopPropagation(); setFilterOpen(filterOpen === ci ? null : ci); }}
                    >
                      ▼
                    </span>
                    {/* Resize handle */}
                    <span
                      style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 4,
                        cursor: "col-resize", background: "transparent", zIndex: 4 }}
                      onMouseDown={(e) => handleColResize(ci, e)}
                      onMouseEnter={(e) => { e.currentTarget.style.background = C.accent + "44"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    />
                    {/* Filter dropdown */}
                    {filterOpen === ci && (
                      <div
                        style={{ position: "absolute", top: "100%", left: 0, width: 180, background: C.darkSurf2,
                          border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.lg, boxShadow: SHADOW.dropdown,
                          zIndex: 100, padding: "4px 0", maxHeight: 200, overflowY: "auto", textAlign: "left",
                          textTransform: "none", letterSpacing: "normal" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {getUniqueColValues(ci).map((val) => {
                          const allowed = filters[ci];
                          const checked = !allowed || allowed.has(val);
                          return (
                            <label key={val || "_empty"} style={{ display: "flex", alignItems: "center", gap: 6,
                              padding: "4px 10px", fontSize: 12, cursor: "pointer", color: C.darkText }}>
                              <input type="checkbox" checked={checked} onChange={() => toggleFilter(ci, val)} />
                              {val || "(empty)"}
                            </label>
                          );
                        })}
                        <div style={{ borderTop: `1px solid ${C.edgeLine}`, padding: "4px 10px", marginTop: 2 }}>
                          <button
                            onClick={() => { setFilters((p) => { const n = { ...p }; delete n[ci]; return n; }); setFilterOpen(null); }}
                            style={{ background: "none", border: "none", color: C.accent, fontSize: 11, cursor: "pointer", fontFamily: FONT }}
                          >Clear filter</button>
                        </div>
                      </div>
                    )}
                  </th>
                );
              })}
              {/* Add column button */}
              <th
                style={{
                  ...ss.headerCell,
                  width: 36,
                  minWidth: 36,
                  maxWidth: 36,
                  padding: 0,
                  cursor: "pointer",
                  border: `1px dashed ${C.darkBorder}`,
                  background: C.darkSurf,
                  color: C.darkMuted,
                  transition: "color 0.15s, background 0.15s",
                }}
                title="Add column"
                onClick={() => handleStructure("insertCol", colCount + 1)}
                onMouseEnter={(e) => { e.currentTarget.style.color = C.accent; e.currentTarget.style.background = C.darkSurf2 || C.darkSurf; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; e.currentTarget.style.background = C.darkSurf; }}
              >
                +
              </th>
              {rightSpacerWidth > 0 && <th style={{ width: rightSpacerWidth, padding: 0, border: "none" }} />}
            </tr>
          </thead>
          <tbody>
            {/* Top spacer */}
            {visibleRowRange.start > 0 && (
              <tr><td colSpan={colCount + 2} style={{ height: visibleRowRange.start * ROW_HEIGHT, padding: 0, border: "none" }} /></tr>
            )}
            {Array.from({ length: visibleRowRange.end - visibleRowRange.start }, (_, i) => {
              const ri = visibleRowRange.start + i;
              if (hiddenRows.has(ri)) return null;
              const rh = rowHeights[ri + 1] || ROW_HEIGHT;
              const isFrozenRow = ri < frozen.rows;
              let frozenTop = ROW_HEIGHT; // account for header
              if (isFrozenRow) {
                for (let fr = 0; fr < ri; fr++) frozenTop += rowHeights[fr + 1] || ROW_HEIGHT;
              }

              return (
                <tr
                  key={ri}
                  style={{
                    height: rh,
                    ...(isFrozenRow ? { position: "sticky", top: frozenTop, zIndex: 2 } : {}),
                  }}
                >
                  {/* Row header */}
                  <td
                    style={{
                      ...ss.rowHeader,
                      height: rh,
                      lineHeight: `${rh}px`,
                      position: "sticky",
                      left: 0,
                      zIndex: isFrozenRow ? 3 : 1,
                      ...(isFrozenRow ? { top: frozenTop } : {}),
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, type: "rowHeader", index: ri });
                    }}
                  >
                    {ri + 1}
                    {/* Row resize handle */}
                    <span
                      style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3,
                        cursor: "row-resize", background: "transparent" }}
                      onMouseDown={(e) => handleRowResize(ri, e)}
                      onMouseEnter={(e) => { e.currentTarget.style.background = C.accent + "44"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    />
                  </td>
                  {/* Left spacer */}
                  {leftSpacerWidth > 0 && <td style={{ width: leftSpacerWidth, padding: 0, border: "none" }} />}
                  {/* Data cells */}
                  {Array.from({ length: visibleColRange.end - visibleColRange.start }, (_, j) => {
                    const ci = visibleColRange.start + j;
                    const key = cellKey(ci, ri);
                    const cell = cells[key];
                    const style = cellStyles[key] || {};
                    const display = getCellDisplay(cell);
                    const formatted = formatCellValue(display, style);
                    const hasFormula = !!getCellFormula(cell);
                    const isEditing = editingCell === key;
                    const isAnchor = selection?.anchor.col === ci && selection?.anchor.row === ri;
                    const isInSel = isCellInRange(ci, ri, selRange) || multiSelections.some((ms) => isCellInRange(ci, ri, ms));
                    const isMergedAway = style._merged;
                    const mergeInfo = style.merge;
                    const hasComment = !!style.comment;
                    const isFrozenCol = ci < frozen.cols;

                    // Skip cells that are merged into another
                    if (isMergedAway) return null;

                    // Frozen column positioning
                    let frozenLeft;
                    if (isFrozenCol) {
                      frozenLeft = ROW_HEADER_W;
                      for (let fc = 0; fc < ci; fc++) frozenLeft += colWidths[colLabel(fc)] || COL_WIDTH;
                    }

                    // Detect if this cell is a URL
                    const isUrl = typeof display === "string" && /^https?:\/\//i.test(display);

                    return (
                      <td
                        key={ci}
                        colSpan={mergeInfo?.cols || 1}
                        rowSpan={mergeInfo?.rows || 1}
                        style={{
                          ...ss.cell,
                          width: colWidths[colLabel(ci)] || COL_WIDTH,
                          height: rh,
                          lineHeight: style.wrap ? "1.3" : `${rh}px`,
                          background: style.bg || (isInSel ? `${C.accent}12` : "transparent"),
                          outline: isAnchor ? `2px solid ${C.accent}` : "none",
                          outlineOffset: -1,
                          position: isFrozenCol ? "sticky" : "relative",
                          left: isFrozenCol ? frozenLeft : undefined,
                          zIndex: isFrozenCol ? (isFrozenRow ? 4 : 2) : undefined,
                          color: style.fg || (hasFormula ? C.accent : C.darkText),
                          fontFamily: typeof display === "number" ? MONO : FONT,
                          fontWeight: style.bold ? 700 : 400,
                          fontStyle: style.italic ? "italic" : "normal",
                          textDecoration: style.strike ? "line-through" : "none",
                          textAlign: style.align || (typeof display === "number" ? "right" : "left"),
                          whiteSpace: style.wrap ? "normal" : "nowrap",
                          overflow: "hidden",
                          // Selection border edges
                          ...(selRange && isInSel ? {
                            borderTop: ri === selRange.r1 ? `2px solid ${C.accent}` : undefined,
                            borderBottom: ri === selRange.r2 ? `2px solid ${C.accent}` : undefined,
                            borderLeft: ci === selRange.c1 ? `2px solid ${C.accent}` : undefined,
                            borderRight: ci === selRange.c2 ? `2px solid ${C.accent}` : undefined,
                          } : {}),
                          // Custom borders
                          ...(style.borders ? {
                            borderTop: style.borders.top ? `1px solid ${C.darkText}` : undefined,
                            borderBottom: style.borders.bottom ? `1px solid ${C.darkText}` : undefined,
                            borderLeft: style.borders.left ? `1px solid ${C.darkText}` : undefined,
                            borderRight: style.borders.right ? `1px solid ${C.darkText}` : undefined,
                          } : {}),
                        }}
                        onClick={(e) => {
                          if ((e.metaKey || e.ctrlKey) && isNeuronsMode()) {
                            e.preventDefault();
                            e.stopPropagation();
                            dispatchNeuronSelect({ node_type: "cell", node_id: `${pageConfig?.id || "sheet"}:${key}`, node_label: `Cell ${key}` });
                            return;
                          }
                          if (editingCell && editingCell !== key) commitEdit();
                          if (e.shiftKey && selection) {
                            setSelection((prev) => ({ anchor: prev.anchor, focus: { col: ci, row: ri } }));
                          } else if ((e.ctrlKey || e.metaKey) && !isNeuronsMode()) {
                            const nr = normalizeRange(selection);
                            if (nr) setMultiSelections((prev) => [...prev, nr]);
                            setSelection({ anchor: { col: ci, row: ri }, focus: { col: ci, row: ri } });
                          } else {
                            setSelection({ anchor: { col: ci, row: ri }, focus: { col: ci, row: ri } });
                            setMultiSelections([]);
                          }
                        }}
                        onMouseDown={(e) => {
                          if (e.button !== 0 || e.detail === 2) return;
                          if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
                            setDragSelecting(true);
                            setSelection({ anchor: { col: ci, row: ri }, focus: { col: ci, row: ri } });
                            setMultiSelections([]);
                          }
                        }}
                        onDoubleClick={() => startEditing(key)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, type: "cell", col: ci, row: ri });
                        }}
                      >
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
                              if (e.key === "Escape") cancelEdit();
                              if (e.key === "Tab") {
                                e.preventDefault();
                                commitEdit();
                                if (ci < colCount - 1) {
                                  const nc = ci + 1;
                                  setSelection({ anchor: { col: nc, row: ri }, focus: { col: nc, row: ri } });
                                  setTimeout(() => startEditing(cellKey(nc, ri)), 0);
                                }
                              }
                            }}
                            style={ss.input}
                            autoFocus
                            autoComplete="off"
                          />
                        ) : isUrl ? (
                          <a href={display} target="_blank" rel="noopener noreferrer"
                            style={{ color: C.accent, textDecoration: "underline", fontSize: 13 }}
                            onClick={(e) => e.stopPropagation()}>
                            {formatted}
                          </a>
                        ) : (
                          formatted !== "" ? String(formatted) : ""
                        )}
                        {/* Comment indicator */}
                        {hasComment && (
                          <span title={style.comment} style={{
                            position: "absolute", top: 0, right: 0,
                            width: 0, height: 0,
                            borderLeft: "6px solid transparent",
                            borderTop: `6px solid ${C.accent}`,
                          }} />
                        )}
                        {/* Fill handle */}
                        {isAnchor && !editingCell && (
                          <div
                            style={{
                              position: "absolute", right: -3, bottom: -3,
                              width: 6, height: 6, background: C.accent,
                              cursor: "crosshair", zIndex: 5,
                            }}
                            onMouseDown={startFillDrag}
                          />
                        )}
                      </td>
                    );
                  })}
                  {rightSpacerWidth > 0 && <td style={{ width: rightSpacerWidth, padding: 0, border: "none" }} />}
                </tr>
              );
            })}
            {/* Bottom spacer */}
            {visibleRowRange.end < rowCount && (
              <tr><td colSpan={colCount + 2} style={{ height: (rowCount - visibleRowRange.end) * ROW_HEIGHT, padding: 0, border: "none" }} /></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={
            contextMenu.type === "rowHeader" ? [
              { label: "Insert row above", onClick: () => handleStructure("insertRow", contextMenu.index + 1) },
              { label: "Insert row below", onClick: () => handleStructure("insertRow", contextMenu.index + 2) },
              { separator: true },
              { label: frozen.rows > contextMenu.index ? "Unfreeze rows" : `Freeze up to row ${contextMenu.index + 1}`,
                onClick: () => toggleFreezeRow(contextMenu.index + 1) },
              { separator: true },
              { label: "Sort A → Z", onClick: () => sortColumn(0, "asc") },
              { label: "Sort Z → A", onClick: () => sortColumn(0, "desc") },
              { separator: true },
              { label: "Delete row", onClick: () => handleStructure("deleteRow", contextMenu.index + 1), danger: true },
            ] : contextMenu.type === "colHeader" ? [
              { label: "Insert column left", onClick: () => handleStructure("insertCol", contextMenu.index + 1) },
              { label: "Insert column right", onClick: () => handleStructure("insertCol", contextMenu.index + 2) },
              { separator: true },
              { label: frozen.cols > contextMenu.index ? "Unfreeze columns" : `Freeze up to ${colLabel(contextMenu.index)}`,
                onClick: () => toggleFreezeCol(contextMenu.index + 1) },
              { separator: true },
              { label: "Sort A → Z", onClick: () => sortColumn(contextMenu.index, "asc") },
              { label: "Sort Z → A", onClick: () => sortColumn(contextMenu.index, "desc") },
              { separator: true },
              { label: "Delete column", onClick: () => handleStructure("deleteCol", contextMenu.index + 1), danger: true },
            ] : [
              { label: "Cut", onClick: () => { /* trigger cut via state */ } },
              { label: "Copy", onClick: () => { /* trigger copy via state */ } },
              { label: "Paste", onClick: () => { /* trigger paste via state */ } },
              { separator: true },
              { label: "Insert row above", onClick: () => handleStructure("insertRow", contextMenu.row + 1) },
              { label: "Insert column left", onClick: () => handleStructure("insertCol", contextMenu.col + 1) },
            ]
          }
        />
      )}

      {/* Status bar */}
      <div style={ss.statusBar}>
        <span>{selectedCell || "—"}</span>
        {selRange && (selRange.c1 !== selRange.c2 || selRange.r1 !== selRange.r2) && (
          <span style={{ color: C.darkMuted }}>
            {cellKey(selRange.c1, selRange.r1)}:{cellKey(selRange.c2, selRange.r2)} ({selRange.r2 - selRange.r1 + 1}R × {selRange.c2 - selRange.c1 + 1}C)
          </span>
        )}
        {selectedFormula && (
          <span style={{ color: C.accent }}>ƒ {selectedFormula}</span>
        )}
        <div style={{ flex: 1 }} />
        <span>{colCount} × {rowCount}</span>
        {Object.keys(filters).length > 0 && (
          <span style={{ color: C.accent }}>Filtered</span>
        )}
      </div>
    </div>
  );
}

// ─── Shared tiny button style for find bar ───
function _btnStyle() {
  return {
    background: "none",
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.sm,
    padding: "2px 8px",
    fontSize: 11,
    fontFamily: FONT,
    color: C.darkMuted,
    cursor: "pointer",
  };
}
