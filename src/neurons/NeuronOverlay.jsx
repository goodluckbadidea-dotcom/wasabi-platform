// ─── Neuron Overlay ───
// Full-screen glass-pane overlay for neuron selection mode.
// Sits above content but below CommandPalette.
// pointerEvents: "none" lets clicks pass through to the app below.
// Only the selection badge and Create button capture clicks.

import React, { useState, useEffect, useCallback } from "react";
import ReactDOM from "react-dom";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { useNeurons } from "./NeuronsContext.jsx";

export default function NeuronOverlay() {
  const { overlayActive, selection, createNeuron, clearSelection, toggleOverlay } = useNeurons();
  const [nameInput, setNameInput] = useState("");
  const [showNameInput, setShowNameInput] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset name input when overlay closes
  useEffect(() => {
    if (!overlayActive) {
      setNameInput("");
      setShowNameInput(false);
    }
  }, [overlayActive]);

  // Escape key exits overlay
  useEffect(() => {
    if (!overlayActive) return;
    const handler = (e) => {
      if (e.key === "Escape") {
        toggleOverlay();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [overlayActive, toggleOverlay]);

  const handleCreate = useCallback(async () => {
    if (selection.length < 2 || saving) return;
    setSaving(true);
    try {
      await createNeuron(nameInput);
      setNameInput("");
      setShowNameInput(false);
    } catch (err) {
      console.error("[Neurons] Create failed:", err);
    } finally {
      setSaving(false);
    }
  }, [selection, nameInput, createNeuron, saving]);

  if (!overlayActive) return null;

  return ReactDOM.createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 350,
        pointerEvents: "none",
      }}
    >
      {/* Darken layer (multiply) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.18)",
          mixBlendMode: "multiply",
          pointerEvents: "none",
          animation: "neuronFadeIn 0.2s ease",
        }}
      />
      {/* Accent tint layer */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `${C.accent}08`,
          pointerEvents: "none",
          animation: "neuronFadeIn 0.2s ease",
        }}
      />

      {/* ── Selection count badge (top center) ── */}
      {selection.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: 64,
            left: "50%",
            transform: "translateX(-50%)",
            background: C.dark,
            border: `1.5px solid ${C.accent}`,
            borderRadius: 999,
            padding: "8px 20px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            pointerEvents: "auto",
            zIndex: 1,
            boxShadow: `0 0 24px ${C.accent}33, 0 4px 12px rgba(0,0,0,0.3)`,
            animation: ANIM.snapInRight(0.02),
          }}
        >
          {/* Neuron icon */}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="4" cy="4" r="2" fill={C.accent} />
            <circle cx="12" cy="4" r="2" fill={C.accent} />
            <circle cx="8" cy="12" r="2" fill={C.accent} />
            <line x1="4" y1="4" x2="12" y2="4" stroke={C.accent} strokeWidth="1" />
            <line x1="4" y1="4" x2="8" y2="12" stroke={C.accent} strokeWidth="1" />
            <line x1="12" y1="4" x2="8" y2="12" stroke={C.accent} strokeWidth="1" />
          </svg>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: C.accent,
              letterSpacing: "0.1em",
              fontFamily: FONT,
            }}
          >
            {selection.length} NODE{selection.length !== 1 ? "S" : ""} SELECTED
          </span>
          <button
            onClick={clearSelection}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: C.darkMuted,
              fontSize: 16,
              padding: "0 2px",
              lineHeight: 1,
              transition: "color 0.12s",
              outline: "none",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = C.darkText; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
            title="Clear selection"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Selected node labels (below badge) ── */}
      {selection.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: 108,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            justifyContent: "center",
            maxWidth: 500,
            pointerEvents: "auto",
          }}
        >
          {selection.map((node) => (
            <span
              key={node.node_id}
              style={{
                background: C.darkSurf,
                border: `1px solid ${C.accent}44`,
                borderRadius: RADIUS.md,
                padding: "3px 10px",
                fontSize: 10,
                fontWeight: 500,
                color: C.darkText,
                fontFamily: FONT,
                letterSpacing: "0.02em",
                maxWidth: 160,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {node.node_label || node.node_id}
            </span>
          ))}
        </div>
      )}

      {/* ── Create Neuron button (bottom center) ── */}
      {selection.length >= 2 && (
        <div
          style={{
            position: "absolute",
            bottom: 32,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            pointerEvents: "auto",
          }}
        >
          {/* Optional name input */}
          {showNameInput && (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                background: C.dark,
                border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.lg,
                padding: "8px 14px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
              }}
            >
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Name (optional)"
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: C.darkText,
                  fontFamily: FONT,
                  fontSize: 13,
                  width: 200,
                }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setShowNameInput(false);
                }}
              />
            </div>
          )}

          <button
            onClick={() => {
              if (!showNameInput) {
                setShowNameInput(true);
                return;
              }
              handleCreate();
            }}
            disabled={saving}
            style={{
              background: C.accent,
              border: "none",
              borderRadius: 999,
              padding: "14px 32px",
              cursor: saving ? "wait" : "pointer",
              color: "#fff",
              fontFamily: FONT,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              boxShadow: `0 4px 24px ${C.accent}55`,
              transition: "transform 0.12s, box-shadow 0.12s, opacity 0.12s",
              opacity: saving ? 0.6 : 1,
              outline: "none",
            }}
            onMouseEnter={(e) => {
              if (!saving) e.currentTarget.style.transform = "scale(1.04)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            {saving
              ? "CREATING..."
              : showNameInput
              ? "CONFIRM NEURON"
              : `CREATE NEURON (${selection.length} nodes)`}
          </button>

          {/* Skip name button */}
          {showNameInput && (
            <button
              onClick={handleCreate}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: C.darkMuted,
                fontSize: 11,
                fontFamily: FONT,
                padding: 4,
                outline: "none",
                transition: "color 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = C.darkText; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
            >
              Skip naming
            </button>
          )}
        </div>
      )}

      {/* ── Hint text (when no selection yet) ── */}
      {selection.length === 0 && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontSize: 14,
              color: C.darkMuted,
              fontFamily: FONT,
              fontWeight: 500,
              letterSpacing: "0.04em",
              lineHeight: 1.8,
            }}
          >
            <span style={{ color: C.accent, fontWeight: 600 }}>Cmd + Click</span> on items to select them
            <br />
            <span style={{ fontSize: 12, opacity: 0.7 }}>
              Navigate freely between pages — your selection persists
            </span>
          </div>
        </div>
      )}

      {/* CSS animation for fade-in */}
      <style>{`
        @keyframes neuronFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>,
    document.body
  );
}
