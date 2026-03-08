// ─── Top Header Bar ───
// Slim header: WASABI wordmark left, theme toggle + page-level controls right.

import React from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { ANIM } from "../design/animations.js";
import { IconEdit, IconRefresh, IconSun, IconMoon } from "../design/icons.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { useNeurons } from "../neurons/NeuronsContext.jsx";

const REFRESH_OPTIONS = [
  { label: "15s", value: 15000 },
  { label: "30s", value: 30000 },
  { label: "1m", value: 60000 },
  { label: "2m", value: 120000 },
  { label: "5m", value: 300000 },
  { label: "Manual", value: 0 },
];

export default function TopHeader({
  pageControls,
}) {
  const { themeMode, toggleMode } = useTheme();
  const { overlayActive, toggleOverlay, selection } = useNeurons();
  const controls = pageControls || {};
  const showControls = !!pageControls;

  // Computed at render time so it picks up current theme tokens
  const refreshSelectStyle = {
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "3px 8px",
    fontSize: 11,
    fontFamily: FONT,
    color: C.darkMuted,
    cursor: "pointer",
    outline: "none",
    height: 26,
  };

  return (
    <header
      style={{
        flexShrink: 0,
        height: 54,
        background: C.dark,
        borderBottom: `1px solid ${C.edgeLine}`,
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        position: "relative",
        zIndex: 200,
      }}
    >
      {/* Left: Wordmark */}
      <div style={{ display: "flex", alignItems: "center", flex: "0 0 auto", gap: 8 }}>
        <span
          style={{
            fontFamily: "'Outfit',sans-serif",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: C.darkText,
          }}
        >
          Wasabi
        </span>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Right: Theme toggle + Page controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Page controls (only when viewing a page) */}
        {showControls && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              animation: ANIM.snapInRight(0.05),
            }}
          >
            {controls.recordCount != null && (
              <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>
                {controls.recordCount} record{controls.recordCount !== 1 ? "s" : ""}
              </span>
            )}

            {controls.onOpenViewSettings && (
              <button
                onClick={controls.onOpenViewSettings}
                style={{
                  ...S.btnGhost,
                  fontSize: 11,
                  padding: "3px 8px",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
                title="Customize view"
              >
                <IconEdit size={12} color={C.darkMuted} />
              </button>
            )}

            {controls.refreshMs != null && (
              <select
                style={refreshSelectStyle}
                value={controls.refreshMs}
                onChange={(e) => controls.onRefreshChange?.(Number(e.target.value))}
              >
                {REFRESH_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}

            {controls.isStandaloneTable && controls.onToggleSync && (
              <button
                onClick={controls.onToggleSync}
                style={{
                  ...S.btnGhost,
                  fontSize: 10,
                  padding: "3px 8px",
                  background: controls.showSync ? C.accent + "22" : "transparent",
                  border: controls.showSync ? `1px solid ${C.accent}44` : "1px solid transparent",
                  color: controls.showSync ? C.accent : C.darkMuted,
                }}
                title="Notion sync settings"
              >
                Sync
              </button>
            )}

            {controls.onRefresh && (
              <button
                onClick={controls.onRefresh}
                style={{
                  ...S.btnGhost,
                  fontSize: 12,
                  padding: "4px 8px",
                }}
                title="Refresh"
              >
                <IconRefresh size={14} color={C.darkMuted} />
              </button>
            )}
          </div>
        )}

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
            <circle cx="4" cy="4" r="2" fill={overlayActive ? C.accent : C.darkMuted} />
            <circle cx="12" cy="4" r="2" fill={overlayActive ? C.accent : C.darkMuted} />
            <circle cx="8" cy="12" r="2" fill={overlayActive ? C.accent : C.darkMuted} />
            <line x1="4" y1="4" x2="12" y2="4" stroke={overlayActive ? C.accent : C.darkMuted} strokeWidth="1" />
            <line x1="4" y1="4" x2="8" y2="12" stroke={overlayActive ? C.accent : C.darkMuted} strokeWidth="1" />
            <line x1="12" y1="4" x2="8" y2="12" stroke={overlayActive ? C.accent : C.darkMuted} strokeWidth="1" />
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

        {/* Theme toggle */}
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
          title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {themeMode === "dark"
            ? <IconSun size={13} color={C.darkMuted} />
            : <IconMoon size={13} color={C.darkMuted} />
          }
          {themeMode === "dark" ? "Light" : "Dark"}
        </button>
      </div>
    </header>
  );
}
