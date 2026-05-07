// ─── Table View Styles ───
// All style objects for the Table view, extracted from Table.jsx.
// Uses design tokens exclusively — no hardcoded colors.
// Returned from functions so theme switches pick up fresh C values.

import { C, FONT, RADIUS, SHADOW } from "../../design/tokens.js";

export function getStyles() { return {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    fontFamily: FONT,
  },

  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    borderBottom: `1px solid ${C.edgeLine}`,
    background: C.darkSurf,
    flexShrink: 0,
    flexWrap: "wrap",
  },

  searchWrap: {
    display: "flex",
    alignItems: "center",
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.pill,
    padding: "0 10px",
    flex: "1 1 200px",
    maxWidth: 320,
    minWidth: 140,
    height: 34,
    transition: "border-color 0.15s, box-shadow 0.15s",
  },

  searchInput: {
    flex: 1,
    border: "none",
    outline: "none",
    background: "transparent",
    fontFamily: FONT,
    fontSize: 13,
    color: C.darkText,
    padding: "0 6px",
    height: "100%",
  },

  searchIcon: {
    fontSize: 13,
    color: C.darkMuted,
    flexShrink: 0,
  },

  filterSelect: {
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.pill,
    padding: "6px 10px",
    fontSize: 12,
    fontFamily: FONT,
    color: C.darkMuted,
    cursor: "pointer",
    appearance: "none",
    outline: "none",
    minWidth: 110,
    height: 34,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888888'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 10px center",
    paddingRight: 28,
  },

  refreshBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
    borderRadius: RADIUS.pill,
    border: `1px solid ${C.darkBorder}`,
    background: C.darkSurf2,
    cursor: "pointer",
    color: C.darkMuted,
    fontSize: 14,
    transition: "background 0.15s, color 0.15s",
    flexShrink: 0,
    fontFamily: FONT,
  },

  countLabel: {
    fontSize: 12,
    color: C.darkMuted,
    marginLeft: "auto",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },

  scrollArea: {
    flex: 1,
    overflowY: "auto",
    overflowX: "auto",
    background: C.dark,
    WebkitOverflowScrolling: "touch",
  },

  gridHeader: {
    display: "grid",
    position: "sticky",
    top: 0,
    zIndex: 10,
    background: C.dark,
    borderBottom: `1px solid ${C.border}`,
  },

  gridHeaderCell: {
    textAlign: "left",
    padding: "10px 12px",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: C.darkMuted,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
    transition: "color 0.15s",
    position: "relative",
    overflow: "hidden",
    borderRight: `1px solid ${C.border}33`,
  },

  gridHeaderCellActive: {
    color: C.darkText,
  },

  // Row card — every parent row gets card treatment (border, shadow, radius).
  // Sub-items inside an expanded group strip these via the `subRowOverride` style.
  gridRow: {
    display: "grid",
    borderRadius: RADIUS.lg,
    cursor: "pointer",
    transition: "background 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    boxShadow: SHADOW.cardMaterial,
    marginBottom: 8,
    position: "relative",
    // overflow removed (was "hidden") so multi-line pill wraps in cells expand
    // the row vertically. borderRadius still works visually since each cell
    // sits within the row's bounding box.
  },

  // Sub-item row inside a group card — strips the card chrome.
  // Lives inside the parent's gridRow border, so renders as a transparent
  // strip with hairline padding only.
  gridSubRow: {
    display: "grid",
    cursor: "pointer",
    transition: "background 0.15s ease",
    background: "transparent",
    border: "none",
    boxShadow: "none",
    borderRadius: 0,
    marginBottom: 0,
    position: "relative",
  },

  gridCell: {
    padding: "8px 12px",
    color: C.darkText,
    fontSize: 13,
    lineHeight: 1.45,
    boxSizing: "border-box",
    borderRight: `1px solid ${C.border}33`,
    // overflow:hidden clips HORIZONTAL bleed (e.g. a long pill like
    // "WAREHOUSED (DROPS FACILITY)" with whiteSpace:nowrap leaking into the
    // next column). It does NOT prevent the cell box from growing
    // vertically: wrapped multi-select pills inside multiPillWrap (display:
    // flex; flex-wrap: wrap) extend the cell's content height, so the cell
    // box grows and the row grows with it. Removing this caused pill
    // overflow into adjacent columns; the row-level overflow stays off so
    // grown cells still display fully.
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    minWidth: 0,
  },

  gridFooter: {
    display: "grid",
    position: "sticky",
    bottom: 0,
    zIndex: 5,
    background: C.dark,
    borderTop: `1px solid ${C.border}`,
  },

  // Legacy styles used by CellEditor (in RecordDetail drawer) and CSV import modal
  table: { borderCollapse: "separate", borderSpacing: "0 4px", fontSize: 13, tableLayout: "fixed" },
  th: { textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.darkMuted, borderBottom: `1px solid ${C.darkBorder}`, whiteSpace: "nowrap", background: C.darkSurf },
  td: { padding: "8px 12px", border: "none", color: C.darkText, fontSize: 13, lineHeight: 1.45, boxSizing: "border-box", overflow: "hidden", background: C.darkSurf },
  cellInput: { width: "100%", border: `1px solid ${C.accent}`, borderRadius: RADIUS.sm, padding: "4px 8px", fontSize: 13, fontFamily: FONT, color: C.darkText, background: C.darkSurf, outline: "none", boxShadow: `0 0 0 2px ${C.accent}33`, boxSizing: "border-box" },
  cellSelect: { width: "100%", border: `1px solid ${C.accent}`, borderRadius: RADIUS.sm, padding: "4px 8px", fontSize: 13, fontFamily: FONT, color: C.darkText, background: C.darkSurf, outline: "none", cursor: "pointer", appearance: "none", boxShadow: `0 0 0 2px ${C.accent}33`, boxSizing: "border-box" },

  // Checkbox toggle
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

  // Pills
  pill: (fillColor, textColor = "#fff") => ({
    display: "inline-block",
    color: textColor,
    background: fillColor,
    border: "none",
    borderRadius: RADIUS.pill,
    padding: "3px 10px",
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

  // Empty state
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 64,
    gap: 12,
    color: C.darkMuted,
    fontSize: 14,
    textAlign: "center",
    fontFamily: FONT,
  },

  emptyIcon: {
    fontSize: 32,
    opacity: 0.4,
    marginBottom: 4,
  },

  emptyTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: C.darkMuted,
  },

  emptySub: {
    fontSize: 13,
    color: C.darkMuted,
    maxWidth: 300,
    lineHeight: 1.5,
  },

  // Sort arrow
  sortArrow: {
    display: "inline-block",
    marginLeft: 4,
    fontSize: 10,
    opacity: 0.7,
  },
}; }

// Standalone style functions — safe at module level because they
// evaluate C at call time (via args or inside their body), not at import time.
export const pillStyle = (fillColor, textColor = "#fff") => ({
  display: "inline-block",
  color: textColor,
  background: fillColor,
  border: "none",
  borderRadius: RADIUS.pill,
  padding: "3px 10px",
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  lineHeight: 1.6,
  whiteSpace: "nowrap",
});

export const toggleStyle = (checked) => ({
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
});

export const multiPillWrap = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
};

// Context menu item style
export function getCtxItem() { return {
  padding: "6px 10px",
  fontSize: 12,
  color: C.darkText,
  cursor: "pointer",
  borderRadius: RADIUS.sm,
  transition: "background 0.1s",
  fontFamily: FONT,
}; }

// Shared input field style (used in add-column dialogs, rename inputs)
export function getInputFieldStyle() { return {
  border: `1px solid ${C.darkBorder}`,
  borderRadius: RADIUS.sm,
  background: C.darkSurf2,
  color: C.darkText,
  fontFamily: FONT,
  fontSize: 12,
  padding: "6px 10px",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
}; }

// Ghost row input style (transparent, minimal)
export function getGhostInputStyle() { return {
  width: "100%",
  border: "none",
  borderRadius: RADIUS.sm,
  background: "transparent",
  color: C.darkText,
  fontFamily: FONT,
  fontSize: 13,
  padding: "4px 6px",
  outline: "none",
  boxSizing: "border-box",
}; }
