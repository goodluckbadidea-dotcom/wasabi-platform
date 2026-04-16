// ─── Table Header ───
// Sticky grid header with column headers, sort, rename, resize, drag reorder, add-column.

import React from "react";
import { C, FONT, RADIUS } from "../../design/tokens.js";
import { IconPlus } from "../../design/icons.jsx";
import { getStyles } from "./tableStyles.js";
import { OWNER_COL_NAME, getTypeIcon } from "./tableHelpers.js";
import { getFieldType } from "../_viewHelpers.js";

export default function TableHeader({
  gtc, columns, schema, showOwnerColumn,
  // Sort
  sortField, sortDir,
  // Selection
  selectedRows, displayListLength, toggleAllRows,
  // Column management
  colDrag, colClickTimer, setColCtxMenu,
  renamingCol, setRenamingCol, renameValue, setRenameValue, handleRenameCol,
  handleColRightClick, handleColDragStart, handleResizeStart,
  canEditSchema,
  // Add column
  addColOpen, setAddColOpen,
}) {
  const styles = getStyles();
  return (
    <div style={{ ...styles.gridHeader, gridTemplateColumns: gtc }}>
      {/* Select-all checkbox */}
      <div
        style={{ ...styles.gridHeaderCell, padding: "10px 8px", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}
        onClick={toggleAllRows}
      >
        <span style={styles.toggle(selectedRows.size === displayListLength && displayListLength > 0)}>
          {selectedRows.size === displayListLength && displayListLength > 0 ? "\u2713" : ""}
        </span>
      </div>
      {columns.map((col) => {
        if (col === OWNER_COL_NAME && showOwnerColumn) {
          return (
            <div key={col} style={{ ...styles.gridHeaderCell, position: "relative" }}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ marginRight: 5, opacity: 0.55, verticalAlign: "middle" }}>
                <circle cx="8" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                <path d="M2 14.5c0-3 2.7-5 6-5s6 2 6 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
              </svg>
              Owner
            </div>
          );
        }
        const isActive = sortField === col;
        const isDragOver = colDrag?.overCol === col;
        return (
          <div
            key={col}
            data-col-header={col}
            style={{
              ...styles.gridHeaderCell,
              ...(isActive ? styles.gridHeaderCellActive : {}),
              ...(isDragOver ? { borderLeft: `2px solid ${C.accent}` } : {}),
              cursor: colDrag ? "grabbing" : "pointer",
            }}
            onClick={(e) => {
              e.preventDefault();
              if (colClickTimer.current) { clearTimeout(colClickTimer.current); colClickTimer.current = null; return; }
              const rect = e.currentTarget.getBoundingClientRect();
              const menuW = 180;
              const x = Math.min(rect.left, window.innerWidth - menuW);
              colClickTimer.current = setTimeout(() => { colClickTimer.current = null; setColCtxMenu({ col, x, y: rect.bottom + 2 }); }, 250);
            }}
            onDoubleClick={(e) => {
              e.preventDefault(); e.stopPropagation();
              if (colClickTimer.current) { clearTimeout(colClickTimer.current); colClickTimer.current = null; }
              if (canEditSchema) { setRenamingCol(col); setRenameValue(col); setColCtxMenu(null); }
            }}
            onContextMenu={(e) => handleColRightClick(col, e)}
            onMouseDown={(e) => { if (e.button === 0 && !e.target.closest("[data-resize]")) handleColDragStart(col, e); }}
          >
            {renamingCol === col ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameCol(col, renameValue);
                  if (e.key === "Escape") setRenamingCol(null);
                  e.stopPropagation();
                }}
                onBlur={() => handleRenameCol(col, renameValue)}
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "100%", border: `1px solid ${C.accent}`, borderRadius: RADIUS.sm,
                  background: C.darkSurf2, color: C.darkText, fontFamily: FONT, fontSize: 11,
                  padding: "2px 6px", outline: "none", fontWeight: 600, textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              />
            ) : (
              <>
                {(() => {
                  const ti = getTypeIcon(schema, col);
                  if (!ti) return null;
                  return ti.Icon ? (
                    <span style={{ marginRight: 5, opacity: 0.55, verticalAlign: "middle", display: "inline-flex" }} title={getFieldType(schema, col)}><ti.Icon size={11} color="currentColor" /></span>
                  ) : ti.text ? (
                    <span style={{ marginRight: 5, fontSize: 10, opacity: 0.55, verticalAlign: "middle", fontWeight: 600 }} title={getFieldType(schema, col)}>{ti.text}</span>
                  ) : null;
                })()}
                {col}
                {isActive && sortDir && (
                  <span style={styles.sortArrow}>
                    {sortDir === "asc" ? "\u25B2" : "\u25BC"}
                  </span>
                )}
              </>
            )}
            {/* Resize handle */}
            <span
              data-resize="true"
              style={{
                position: "absolute", right: 0, top: 0, bottom: 0, width: 5,
                cursor: "col-resize", background: "transparent", zIndex: 3,
              }}
              onMouseDown={(e) => handleResizeStart(col, e)}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.accent + "44"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            />
          </div>
        );
      })}
      {/* Badge column header */}
      <div style={{ ...styles.gridHeaderCell, padding: "10px 2px" }} />
      {/* Neuron column header */}
      <div style={{ ...styles.gridHeaderCell, padding: "10px 4px" }} />
      {/* Add column button */}
      {canEditSchema && (
        <div style={{ ...styles.gridHeaderCell, textAlign: "center", padding: "10px 8px", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, borderRadius: RADIUS.pill,
              border: `1px dashed ${addColOpen ? C.accent : C.darkBorder}`,
              cursor: "pointer", transition: "all 0.15s",
              color: addColOpen ? C.accent : C.darkMuted,
              opacity: addColOpen ? 1 : 0.65,
              background: addColOpen ? `${C.accent}10` : "transparent",
            }}
            onClick={(e) => { e.stopPropagation(); setAddColOpen(!addColOpen); }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "1";
              e.currentTarget.style.borderColor = C.accent;
              e.currentTarget.style.color = C.accent;
              e.currentTarget.style.background = `${C.accent}10`;
            }}
            onMouseLeave={(e) => {
              if (!addColOpen) {
                e.currentTarget.style.opacity = "0.65";
                e.currentTarget.style.borderColor = C.darkBorder;
                e.currentTarget.style.color = C.darkMuted;
                e.currentTarget.style.background = "transparent";
              }
            }}
            title="Add column"
          >
            <IconPlus size={13} />
          </div>
        </div>
      )}
    </div>
  );
}
