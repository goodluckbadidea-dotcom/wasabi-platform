// ─── Column Context Menus ───
// Right-click context menus for parent columns and sub-item columns.
// Rendered via createPortal to escape overflow:hidden ancestors.

import React from "react";
import { createPortal } from "react-dom";
import { C, FONT, RADIUS, SHADOW } from "../../design/tokens.js";
import { hoverBg } from "../../design/interactions.js";
import { getFieldType } from "../_viewHelpers.js";
import { ctxItem } from "./tableStyles.js";
import { COLUMN_TYPES, mapD1TypeForUI } from "./tableHelpers.js";

/**
 * Parent column context menu — sort, hide, rename, type change (D1), delete.
 */
const SELECT_TYPES = new Set(["select", "multi_select", "status"]);

export function ParentColumnContextMenu({
  menu, schema, isD1Table, canEditSchema,
  onSort, onHide, onRename, onChangeType, onManageOptions, onDelete, onClose,
}) {
  if (!menu) return null;
  return createPortal(
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 299 }} onMouseDown={onClose} />
      <div
        style={{
          position: "fixed", left: menu.x, top: menu.y, zIndex: 300,
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.lg, padding: 4, minWidth: 160,
          boxShadow: SHADOW.dropdown, fontFamily: FONT,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={ctxItem} onClick={() => { onSort(menu.col, "asc"); onClose(); }} {...hoverBg()}>{"\u25B2"} Sort Ascending</div>
        <div style={ctxItem} onClick={() => { onSort(menu.col, "desc"); onClose(); }} {...hoverBg()}>{"\u25BC"} Sort Descending</div>
        <div style={{ borderTop: `1px solid ${C.edgeLine}`, margin: "2px 0" }} />
        <div style={ctxItem} onClick={() => onHide(menu.col)} {...hoverBg()}>{"\uD83D\uDC41\uFE0F"} Hide Column</div>
        {canEditSchema && (
          <div style={ctxItem} onClick={() => { onRename(menu.col); onClose(); }} {...hoverBg()}>{"\u270F\uFE0F"} Rename</div>
        )}
        {/* Manage Options (select/multi_select/status, D1 only) */}
        {isD1Table && canEditSchema && SELECT_TYPES.has(getFieldType(schema, menu.col)) && (
          <div style={ctxItem} onClick={() => { onManageOptions?.(menu.col); onClose(); }} {...hoverBg()}>{"\u2699\uFE0F"} Manage Options</div>
        )}
        {/* Type Change (D1 only) */}
        {isD1Table && (
          <>
            <div style={{ borderTop: `1px solid ${C.edgeLine}`, margin: "2px 0" }} />
            <div style={{ padding: "4px 10px", fontSize: 10, color: C.darkMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Change Type
            </div>
            {COLUMN_TYPES.map((t) => {
              const currentType = getFieldType(schema, menu.col);
              const isCurrentType = currentType === t.value || currentType === mapD1TypeForUI(t.value);
              return (
                <div
                  key={t.value}
                  style={{
                    ...ctxItem,
                    display: "flex", alignItems: "center", gap: 8,
                    color: isCurrentType ? C.accent : C.darkText,
                    background: isCurrentType ? `${C.accent}10` : "transparent",
                    fontWeight: isCurrentType ? 600 : 400,
                  }}
                  onClick={() => onChangeType(menu.col, t.value)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = isCurrentType ? `${C.accent}18` : C.darkSurf2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = isCurrentType ? `${C.accent}10` : "transparent"; }}
                >
                  <span style={{ width: 20, textAlign: "center", fontSize: 13, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {t.Icon ? <t.Icon size={14} color={isCurrentType ? C.accent : C.darkMuted} /> : <span style={{ fontWeight: 600, color: isCurrentType ? C.accent : C.darkMuted }}>{t.text}</span>}
                  </span>
                  <span style={{ flex: 1 }}>{t.label}</span>
                  {isCurrentType && <span style={{ fontSize: 11, opacity: 0.7 }}>{"\u2713"}</span>}
                </div>
              );
            })}
          </>
        )}
        {/* Delete */}
        {canEditSchema && (
          <>
            <div style={{ borderTop: `1px solid ${C.edgeLine}`, margin: "2px 0" }} />
            <div style={{ ...ctxItem, color: C.warning }} onClick={() => { if (confirm(`Delete column "${menu.col}"?`)) onDelete(menu.col); }} {...hoverBg(C.warningDim)}>{"\uD83D\uDDD1"} Delete Column</div>
          </>
        )}
      </div>
    </>,
    document.body
  );
}

/**
 * Sub-item column context menu — rename, delete.
 */
export function SubColumnContextMenu({ menu, onRename, onDelete, onClose }) {
  if (!menu) return null;
  return createPortal(
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 299 }} onClick={onClose} />
      <div
        style={{
          position: "fixed", left: menu.x, top: menu.y, zIndex: 300,
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.lg, padding: 4, minWidth: 160,
          boxShadow: SHADOW.dropdown, fontFamily: FONT,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={ctxItem} onClick={() => { onRename(menu.col); onClose(); }} {...hoverBg()}>✏️ Rename</div>
        <div style={{ borderTop: `1px solid ${C.edgeLine}`, margin: "2px 0" }} />
        <div style={{ ...ctxItem, color: C.warning }} onClick={() => { if (confirm(`Delete sub-item column "${menu.col}"?`)) onDelete(menu.col); }} {...hoverBg(C.warningDim)}>🗑 Delete Column</div>
      </div>
    </>,
    document.body
  );
}
