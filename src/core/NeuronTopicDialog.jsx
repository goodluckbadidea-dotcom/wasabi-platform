// ─── Neuron Topic Dialog ───
// Opened from a Topics row in SearchModal. Lists the neuron's connected
// members and lets the user pick one to navigate to. Sits on top of the
// SearchModal (z = Z.modal + 10). ESC / backdrop closes only this dialog;
// navigation closes both via the parent's onNavigate callback.

import React, { useEffect } from "react";
import { C, FONT, RADIUS, SHADOW, Z } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";

export default function NeuronTopicDialog({ neuron, open, onClose, onNavigate }) {
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  if (!open || !neuron) return null;

  const inactiveColor = C.darkText + "BB";
  const members = neuron.members || [];

  return (
    <div
      onClick={(e) => {
        // Don't let the click bubble to the SearchModal backdrop and
        // close the search too — backdrop closes the dialog only.
        e.stopPropagation();
        onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: C.overlayBg,
        zIndex: Z.modal + 10,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "14vh 20px 0",
        animation: ANIM.fadeIn?.() || undefined,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Topic: ${neuron.name}`}
        style={{
          width: "100%",
          maxWidth: 560,
          background: C.darkSurf,
          border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.xl,
          boxShadow: SHADOW.dropdown,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "70vh",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "16px 20px 12px",
          borderBottom: `1px solid ${C.darkBorder}`,
          flexShrink: 0,
        }}>
          <div style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: inactiveColor,
            fontFamily: FONT,
            marginBottom: 4,
          }}>
            Topic · {members.length} {members.length === 1 ? "connection" : "connections"}
          </div>
          <div style={{
            fontSize: 17,
            fontWeight: 600,
            color: C.darkText,
            fontFamily: FONT,
          }}>
            {neuron.name}
          </div>
        </div>

        {/* Members */}
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {members.length === 0 ? (
            <div style={{
              fontSize: 12,
              color: inactiveColor,
              fontFamily: FONT,
              textAlign: "center",
              padding: "24px 0",
            }}>
              No navigable members in this topic.
            </div>
          ) : (
            members.map((m) => (
              <button
                key={m.id}
                onClick={() => onNavigate?.(m)}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 2,
                  padding: "9px 10px",
                  borderRadius: RADIUS.md,
                  width: "100%",
                  textAlign: "left",
                  transition: "background 0.12s",
                  outline: "none",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{
                  fontSize: 13,
                  color: C.darkText,
                  fontFamily: FONT,
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "100%",
                }}>
                  {m.label || "(untitled)"}
                </span>
                <span style={{
                  fontSize: 10,
                  color: inactiveColor,
                  fontFamily: FONT,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}>
                  {m.targetPageName || "—"}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: "10px 20px 12px",
          borderTop: `1px solid ${C.darkBorder}`,
          fontSize: 11,
          color: inactiveColor,
          fontFamily: FONT,
          display: "flex",
          justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <span>Pick a connection to navigate</span>
          <kbd style={{
            background: C.darkSurf2,
            color: inactiveColor,
            padding: "3px 6px",
            borderRadius: RADIUS.sm,
            fontSize: 10,
            fontFamily: FONT,
            border: `1px solid ${C.darkBorder}`,
          }}>
            ESC
          </kbd>
        </div>
      </div>
    </div>
  );
}
