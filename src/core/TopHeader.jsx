// ─── Top Header Bar ───
// Slim header: WASABI wordmark + breadcrumb left, theme toggle + neurons right.
// Page-level controls (record count, refresh, sync) live in ViewToolbar/SubPageNav now.

import React from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { useTheme } from "../context/ThemeContext.jsx";
import { useNeurons } from "../neurons/NeuronsContext.jsx";
import Breadcrumb from "../components/Breadcrumb.jsx";

export default function TopHeader() {
  const { themeName, toggleMode } = useTheme();
  const { overlayActive, toggleOverlay, selection } = useNeurons();

  return (
    <header
      style={{
        flexShrink: 0,
        height: 54,
        background: C.dark,
        borderBottom: `1px solid ${C.edgeLine}`,
        borderImage: `linear-gradient(90deg, ${C.edgeLine}, ${C.accent}22, ${C.accent}33, ${C.accent}22, ${C.edgeLine}) 1`,
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        position: "relative",
        zIndex: 200,
      }}
    >
      {/* Left: Wordmark + Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: 1 }}>
        <span
          style={{
            fontFamily: "'Outfit',sans-serif",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            backgroundImage: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            flexShrink: 0,
          }}
        >
          Wasabi
        </span>

        {/* Separator */}
        <div style={{ width: 1, height: 16, background: C.edgeLine, flexShrink: 0 }} />

        {/* Breadcrumb */}
        <Breadcrumb />
      </div>

      {/* Right: Neurons toggle + Theme cycle */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {/* Neurons toggle */}
        <button
          onClick={toggleOverlay}
          title={overlayActive ? "Exit Neurons mode (Esc)" : "Enter Neurons mode"}
          style={{
            background: overlayActive ? C.accent + "22" : "transparent",
            border: `1px solid ${overlayActive ? C.accent : C.darkBorder}`,
            borderRadius: RADIUS.pill,
            padding: "5px 10px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            transition: "background 0.15s, border-color 0.15s",
            color: overlayActive ? C.accent : C.darkMuted,
            fontSize: 11,
            fontFamily: FONT,
            fontWeight: 500,
            outline: "none",
          }}
          onMouseEnter={(e) => {
            if (!overlayActive) {
              e.currentTarget.style.borderColor = C.darkMuted;
              e.currentTarget.style.background = C.darkSurf2;
            }
          }}
          onMouseLeave={(e) => {
            if (!overlayActive) {
              e.currentTarget.style.borderColor = C.darkBorder;
              e.currentTarget.style.background = "transparent";
            }
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <defs>
              <linearGradient id="neuron-grad" x1="0" y1="0" x2="16" y2="16">
                <stop offset="0%" stopColor={C.accent} />
                <stop offset="100%" stopColor={C.accent} />
              </linearGradient>
            </defs>
            <circle cx="4" cy="4" r="2" fill={overlayActive ? "url(#neuron-grad)" : C.darkMuted} />
            <circle cx="12" cy="4" r="2" fill={overlayActive ? "url(#neuron-grad)" : C.darkMuted} />
            <circle cx="8" cy="12" r="2" fill={overlayActive ? "url(#neuron-grad)" : C.darkMuted} />
            <line x1="4" y1="4" x2="12" y2="4" stroke={overlayActive ? "url(#neuron-grad)" : C.darkMuted} strokeWidth="1" />
            <line x1="4" y1="4" x2="8" y2="12" stroke={overlayActive ? "url(#neuron-grad)" : C.darkMuted} strokeWidth="1" />
            <line x1="12" y1="4" x2="8" y2="12" stroke={overlayActive ? "url(#neuron-grad)" : C.darkMuted} strokeWidth="1" />
          </svg>
          Neurons
          {overlayActive && selection.length > 0 && (
            <span
              style={{
                background: C.accent,
                color: "#fff",
                borderRadius: 999,
                fontSize: 9,
                fontWeight: 700,
                padding: "1px 5px",
                minWidth: 14,
                textAlign: "center",
                lineHeight: "14px",
              }}
            >
              {selection.length}
            </span>
          )}
        </button>

        {/* Theme cycle */}
        <button
          onClick={toggleMode}
          style={{
            background: "transparent",
            border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.pill,
            padding: "5px 10px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
            transition: "background 0.15s, border-color 0.15s",
            color: C.darkMuted,
            fontSize: 11,
            fontFamily: FONT,
            fontWeight: 500,
          }}
          title="Cycle theme"
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = C.darkMuted;
            e.currentTarget.style.background = C.darkSurf2;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = C.darkBorder;
            e.currentTarget.style.background = "transparent";
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: C.accent, flexShrink: 0 }} />
          {themeName.charAt(0).toUpperCase() + themeName.slice(1)}
        </button>
      </div>
    </header>
  );
}
