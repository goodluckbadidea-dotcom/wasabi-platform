// ─── Confirm Dialog ───
// Reusable confirmation modal for destructive actions.
// Dark theme, centered, with Cancel + Confirm buttons.

import React, { useEffect } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: ANIM.fadeIn(),
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.darkSurf,
          border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.xl,
          padding: "24px 28px",
          maxWidth: 400,
          width: "90vw",
          boxShadow: SHADOW.dropdown,
          animation: ANIM.scaleIn(),
          fontFamily: FONT,
        }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: C.darkText,
            marginBottom: 8,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 13,
            color: C.darkMuted,
            lineHeight: 1.5,
            marginBottom: 24,
          }}
        >
          {message}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              background: C.darkSurf2,
              color: C.darkText,
              border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.pill,
              padding: "7px 18px",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: FONT,
              cursor: "pointer",
              outline: "none",
              transition: "background 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#363636";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = C.darkSurf2;
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: "#E05252",
              color: "#fff",
              border: "none",
              borderRadius: RADIUS.pill,
              padding: "8px 20px",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: FONT,
              cursor: "pointer",
              outline: "none",
              transition: "background 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#C94040";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#E05252";
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
