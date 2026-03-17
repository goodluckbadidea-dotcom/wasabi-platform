// ─── Top Header Bar ───
// Slim header: WASABI wordmark + breadcrumb left, theme toggle + neurons right.
// Page-level controls (record count, refresh, sync) live in ViewToolbar/SubPageNav now.

import React from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { useTheme } from "../context/ThemeContext.jsx";
import { useNeurons } from "../neurons/NeuronsContext.jsx";
import { usePages } from "../context/PagesContext.jsx";
import Breadcrumb from "../components/Breadcrumb.jsx";

export default function TopHeader() {
  const { themeName, toggleMode } = useTheme();
  const { overlayActive, toggleOverlay, selection } = useNeurons();
  const { saveStatus } = usePages();

  return (
    <header
      style={{
        flexShrink: 0,
        minHeight: 54,
        paddingTop: "env(safe-area-inset-top, 0px)",
        background: C.dark,
        borderBottom: `1px solid ${C.edgeLine}`,
        borderImage: `linear-gradient(90deg, ${C.edgeLine}, ${C.accent}22, ${C.accent}33, ${C.accent}22, ${C.edgeLine}) 1`,
        display: "flex",
        alignItems: "center",
        padding: "env(safe-area-inset-top, 0px) 24px 0",
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

      {/* Save status indicator */}
      {saveStatus !== "idle" && (
        <div style={{
          fontSize: 10, fontFamily: FONT, fontWeight: 500,
          color: saveStatus === "error" ? "#E05252" : saveStatus === "saving" ? C.darkMuted : C.accent,
          padding: "4px 10px", borderRadius: RADIUS.pill, flexShrink: 0,
          background: saveStatus === "error" ? "#E0525215" : "transparent",
          transition: "all 0.2s",
          letterSpacing: "0.03em",
        }}>
          {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save failed"}
        </div>
      )}

      {/* Right: Refresh + Neurons toggle + Theme cycle */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {/* Hard refresh */}
        <button
          onClick={() => {
            // Clear all data caches
            try {
              for (const key of Object.keys(localStorage)) {
                if (key.startsWith("wasabi_zen_") || key.startsWith("wasabi_cal_")) {
                  localStorage.removeItem(key);
                }
              }
            } catch {}
            window.location.reload();
          }}
          title="Hard refresh — clear caches & reload"
          style={{
            background: "transparent",
            border: "none",
            borderRadius: RADIUS.pill,
            padding: 8,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "opacity 0.15s",
            opacity: 0.4,
            outline: "none",
            minWidth: 32, minHeight: 32,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M14 2v5h-5" stroke={C.darkMuted} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12.5 10A5.5 5.5 0 1 1 13 6" stroke={C.darkMuted} strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        {/* Neurons toggle */}
        <button
          onClick={toggleOverlay}
          title={overlayActive ? "Exit Neurons mode (Esc)" : "Enter Neurons mode"}
          style={{
            background: overlayActive ? C.accent + "22" : "transparent",
            border: `1px solid ${overlayActive ? C.accent : C.darkBorder}`,
            borderRadius: RADIUS.pill,
            padding: "7px 12px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            transition: "background 0.15s, border-color 0.15s",
            color: overlayActive ? C.accent : C.darkMuted,
            fontSize: 12,
            minHeight: 32,
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
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
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
            padding: "7px 12px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            transition: "background 0.15s, border-color 0.15s",
            color: C.darkMuted,
            fontSize: 12,
            fontFamily: FONT,
            fontWeight: 500,
            minHeight: 32,
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
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: C.accent, flexShrink: 0 }} />
          {themeName.charAt(0).toUpperCase() + themeName.slice(1)}
        </button>
      </div>
    </header>
  );
}
