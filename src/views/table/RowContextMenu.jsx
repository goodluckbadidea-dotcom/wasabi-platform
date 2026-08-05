// ─── Row Context Menu ───
// Right-click on a row card (parent strip or sub-item row) opens this.
// Today it carries one entry — "Move to top level" — used to un-nest a
// row without dragging. Mirrors the un-nest gesture supported by
// drag-to-empty-space in useRowDrag.
//
// Rendered via createPortal so it escapes the table card's overflow.

import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, FONT, RADIUS, SHADOW } from "../../design/tokens.js";
import { hoverBg } from "../../design/interactions.js";
import { IconArchive } from "../../design/icons.jsx";
import { getCtxItem } from "./tableStyles.js";

function useClampedMenuPosition(menu) {
  const ref = useRef(null);
  const [pos, setPos] = useState(menu ? { left: menu.x, top: menu.y } : null);
  useLayoutEffect(() => {
    if (!menu) { setPos(null); return; }
    setPos({ left: menu.x, top: menu.y });
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(menu.x, vw - rect.width - 8));
    const top = Math.max(8, Math.min(menu.y, vh - rect.height - 8));
    if (left !== menu.x || top !== menu.y) setPos({ left, top });
  }, [menu]);
  return { ref, pos };
}

export default function RowContextMenu({ menu, onMoveToTop, onArchive, canArchive, onClose }) {
  const ctxItem = getCtxItem();
  const { ref, pos } = useClampedMenuPosition(menu);
  if (!menu || !pos) return null;
  const isSubItem = !!menu.row?._parentRowId;
  return createPortal(
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 299 }} onMouseDown={onClose} />
      <div
        ref={ref}
        style={{
          position: "fixed", left: pos.left, top: pos.top, zIndex: 300,
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.lg, padding: 4, minWidth: 180,
          maxHeight: "calc(100vh - 24px)", overflowY: "auto",
          boxShadow: SHADOW.dropdown, fontFamily: FONT,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {isSubItem ? (
          <div
            style={ctxItem}
            onClick={() => { onMoveToTop?.(menu.row); onClose(); }}
            {...hoverBg()}
          >
            {"⤴"} Move to top level
          </div>
        ) : null}
        {canArchive && (
          <div
            style={{ ...ctxItem, display: "flex", alignItems: "center", gap: 8 }}
            onClick={() => { onArchive?.(menu.row); onClose(); }}
            {...hoverBg()}
          >
            <IconArchive size={14} color={C.darkText} />
            Archive
          </div>
        )}
        {!isSubItem && !canArchive && (
          <div style={{ ...ctxItem, color: C.darkMuted, cursor: "default" }}>
            Top-level row
          </div>
        )}
      </div>
    </>,
    document.body
  );
}
