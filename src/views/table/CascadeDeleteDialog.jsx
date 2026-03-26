// ─── Cascade Delete Dialog ───
// Confirmation dialog when deleting a record that has sub-items.

import React from "react";
import { createPortal } from "react-dom";
import { C, FONT, RADIUS, SHADOW } from "../../design/tokens.js";

export default function CascadeDeleteDialog({ dialog, onCancel, onCascade }) {
  if (!dialog) return null;
  return createPortal(
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9998 }} onClick={onCancel} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg, boxShadow: SHADOW.dropdown,
        padding: "24px", minWidth: 340, maxWidth: 420, zIndex: 9999,
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.darkText, marginBottom: 8, fontFamily: FONT }}>
          This record has sub-items
        </div>
        <div style={{ fontSize: 13, color: C.darkMuted, marginBottom: 20, fontFamily: FONT, lineHeight: 1.5 }}>
          This record has {dialog.childCount} sub-item{dialog.childCount !== 1 ? "s" : ""}. What would you like to do?
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button
            onClick={onCancel}
            style={{
              background: "transparent", border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.sm,
              padding: "8px 16px", fontSize: 12, fontFamily: FONT, color: C.darkText, cursor: "pointer",
            }}
          >Cancel</button>
          <button
            onClick={() => onCascade("orphan")}
            style={{
              background: "transparent", border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.sm,
              padding: "8px 16px", fontSize: 12, fontFamily: FONT, color: C.darkText, cursor: "pointer",
            }}
          >Keep sub-items</button>
          <button
            onClick={() => onCascade("delete")}
            style={{
              background: C.error, border: "none", borderRadius: RADIUS.sm,
              padding: "8px 16px", fontSize: 12, fontFamily: FONT, color: "#fff", cursor: "pointer", fontWeight: 600,
            }}
          >Delete all</button>
        </div>
      </div>
    </>,
    document.body
  );
}
