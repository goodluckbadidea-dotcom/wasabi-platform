// ─── Confirm Dialog ───
// Reusable confirmation modal for destructive actions.
// Dark theme, centered, with Cancel + Confirm buttons.
// Supports exit animation before unmounting.

import React, { useEffect, useState, useCallback, useRef } from "react";
import { C, FONT, RADIUS, SHADOW, Z } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";

const EXIT_DURATION = 180; // ms — matches fadeOut CSS duration

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}) {
  const [exiting, setExiting] = useState(false);
  const dialogRef = useRef(null);

  // Auto-focus dialog on mount for keyboard accessibility
  useEffect(() => { dialogRef.current?.focus(); }, []);

  const handleClose = useCallback((callback) => {
    if (exiting) return;
    setExiting(true);
    setTimeout(() => callback(), EXIT_DURATION);
  }, [exiting]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") handleClose(onCancel);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, handleClose]);

  return (
    <div
      onClick={() => handleClose(onCancel)}
      style={{
        position: "fixed",
        inset: 0,
        background: C.overlayBg,
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        zIndex: Z.modal,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: exiting ? ANIM.backdropFadeOut : ANIM.backdropFade,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.darkSurf,
          border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.xl,
          padding: "24px 28px",
          maxWidth: 400,
          width: "90vw",
          boxShadow: SHADOW.dropdown,
          animation: exiting ? ANIM.fadeOut() : ANIM.modalPop(),
          fontFamily: FONT,
        }}
      >
        <div
          id="confirm-dialog-title"
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
            onClick={() => handleClose(onCancel)}
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
              e.currentTarget.style.background = C.darkBorder;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = C.darkSurf2;
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => handleClose(onConfirm)}
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
