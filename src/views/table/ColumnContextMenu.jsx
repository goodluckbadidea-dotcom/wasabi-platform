// ─── Column Context Menus ───
// Right-click context menus for parent columns and sub-item columns.
// Rendered via createPortal to escape overflow:hidden ancestors.

import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, FONT, RADIUS, SHADOW } from "../../design/tokens.js";
import { hoverBg } from "../../design/interactions.js";
import { getFieldType } from "../_viewHelpers.js";
import { getCtxItem } from "./tableStyles.js";
import { COLUMN_TYPES, mapD1TypeForUI } from "./tableHelpers.js";

/**
 * Parent column context menu — sort, hide, rename, type change (D1), delete.
 */
const SELECT_TYPES = new Set(["select", "multi_select", "status"]);

/**
 * Clamp menu {x,y} so the rendered box stays inside the viewport.
 * Measures the menu element after first paint and adjusts left/top if
 * it would overflow the right or bottom edge. Floors at 8px so small
 * viewports can't push it negative.
 */
function useClampedMenuPosition(menu) {
  const ref = useRef(null);
  const [pos, setPos] = useState(menu ? { left: menu.x, top: menu.y } : null);

  useLayoutEffect(() => {
    if (!menu) { setPos(null); return; }
    // Start at requested coords, then measure and clamp.
    setPos({ left: menu.x, top: menu.y });
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(menu.x, vw - rect.width - 8));
    const top = Math.max(8, Math.min(menu.y, vh - rect.height - 8));
    if (left !== menu.x || top !== menu.y) {
      setPos({ left, top });
    }
  }, [menu]);

  return { ref, pos };
}

export function ParentColumnContextMenu({
  menu, schema, isD1Table, canEditSchema,
  onSort, onHide, onRename, onChangeType, onManageOptions, onDelete, onClose,
}) {
  const ctxItem = getCtxItem();
  const { ref, pos } = useClampedMenuPosition(menu);
  if (!menu || !pos) return null;
  return createPortal(
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 299 }} onMouseDown={onClose} />
      <div
        ref={ref}
        style={{
          position: "fixed", left: pos.left, top: pos.top, zIndex: 300,
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.lg, padding: 4, minWidth: 160,
          maxHeight: "calc(100vh - 24px)", overflowY: "auto",
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
export function SubColumnContextMenu({ menu, subSchema, onRename, onManageOptions, onChangeType, onDelete, onClose }) {
  const ctxItem = getCtxItem();
  const { ref, pos } = useClampedMenuPosition(menu);
  if (!menu || !pos) return null;
  const colType = subSchema ? getFieldType(subSchema, menu.col) : null;
  return createPortal(
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 299 }} onClick={onClose} />
      <div
        ref={ref}
        style={{
          position: "fixed", left: pos.left, top: pos.top, zIndex: 300,
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.lg, padding: 4, minWidth: 160,
          maxHeight: "calc(100vh - 24px)", overflowY: "auto",
          boxShadow: SHADOW.dropdown, fontFamily: FONT,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={ctxItem} onClick={() => { onRename(menu.col); onClose(); }} {...hoverBg()}>✏️ Rename</div>
        {/* Manage Options (select/multi_select/status) */}
        {SELECT_TYPES.has(colType) && (
          <div style={ctxItem} onClick={() => { onManageOptions?.(menu.col); onClose(); }} {...hoverBg()}>⚙️ Manage Options</div>
        )}
        {/* Change Type */}
        <div style={{ borderTop: `1px solid ${C.edgeLine}`, margin: "2px 0" }} />
        <div style={{ padding: "4px 10px", fontSize: 10, color: C.darkMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Change Type
        </div>
        {COLUMN_TYPES.map((t) => {
          const currentType = colType;
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
              {isCurrentType && <span style={{ fontSize: 11, opacity: 0.7 }}>✓</span>}
            </div>
          );
        })}
        {/* Delete */}
        <div style={{ borderTop: `1px solid ${C.edgeLine}`, margin: "2px 0" }} />
        <div style={{ ...ctxItem, color: C.warning }} onClick={() => { if (confirm(`Delete sub-item column "${menu.col}"?`)) onDelete(menu.col); }} {...hoverBg(C.warningDim)}>🗑 Delete Column</div>
      </div>
    </>,
    document.body
  );
}
