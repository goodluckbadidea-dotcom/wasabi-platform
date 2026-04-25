// ─── Dependency Delete Dialog ───
// Confirmation dialog when deleting a record that other records depend on
// (depends_on edges where this record is the target). Surfaced when the
// worker returns 409 with hasDependents=true. Lists a sample of dependent
// task names so the user understands the impact before proceeding.

import React from "react";
import { createPortal } from "react-dom";
import { C, FONT, RADIUS, SHADOW } from "../../design/tokens.js";

export default function DependencyDeleteDialog({ dialog, onCancel, onConfirm }) {
  if (!dialog) return null;
  const { dependentCount = 0, dependentSample = [] } = dialog;
  const overflow = Math.max(0, dependentCount - dependentSample.length);

  return createPortal(
    <>
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9998 }}
        onClick={onCancel}
      />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg, boxShadow: SHADOW.dropdown,
        padding: "24px", minWidth: 360, maxWidth: 460, zIndex: 9999,
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.darkText, marginBottom: 8, fontFamily: FONT }}>
          Other records depend on this
        </div>
        <div style={{ fontSize: 13, color: C.darkMuted, marginBottom: 12, fontFamily: FONT, lineHeight: 1.5 }}>
          {dependentCount} {dependentCount === 1 ? "record depends" : "records depend"} on this one.
          Deleting it will leave {dependentCount === 1 ? "that dependency" : "those dependencies"} unresolved.
        </div>

        {dependentSample.length > 0 && (
          <div style={{
            background: C.darkSurf2, borderRadius: RADIUS.sm,
            padding: "8px 12px", marginBottom: 16,
            border: `1px solid ${C.darkBorder}`,
          }}>
            {dependentSample.map((d, i) => (
              <div
                key={d.id || i}
                style={{
                  fontSize: 12, color: C.darkText, fontFamily: FONT,
                  padding: "3px 0",
                  borderBottom: i < dependentSample.length - 1 ? `1px dashed ${C.darkBorder}` : "none",
                }}
              >
                {d.title || d.id?.slice(0, 8) || "Untitled"}
              </div>
            ))}
            {overflow > 0 && (
              <div style={{
                fontSize: 11, color: C.darkMuted, fontFamily: FONT,
                fontStyle: "italic", paddingTop: 4,
              }}>
                +{overflow} more…
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              background: "transparent", border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.sm, padding: "8px 16px",
              fontSize: 12, fontFamily: FONT, color: C.darkText, cursor: "pointer",
            }}
          >Cancel</button>
          <button
            onClick={onConfirm}
            style={{
              background: C.error, border: "none", borderRadius: RADIUS.sm,
              padding: "8px 16px", fontSize: 12, fontFamily: FONT,
              color: "#fff", cursor: "pointer", fontWeight: 600,
            }}
          >Delete anyway</button>
        </div>
      </div>
    </>,
    document.body
  );
}
