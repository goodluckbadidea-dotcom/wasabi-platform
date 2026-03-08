// ─── Top Header Bar ───
// Slim header: WASABI wordmark left, page-level controls right.
// Page controls (edit, refresh rate, refresh) are passed in from App via PageShell.

import React from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { ANIM } from "../design/animations.js";
import { IconEdit, IconRefresh } from "../design/icons.jsx";

const REFRESH_OPTIONS = [
  { label: "15s", value: 15000 },
  { label: "30s", value: 30000 },
  { label: "1m", value: 60000 },
  { label: "2m", value: 120000 },
  { label: "5m", value: 300000 },
  { label: "Manual", value: 0 },
];

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

export default function TopHeader({
  // Page controls (lifted from PageShell)
  pageControls, // { recordCount, refreshMs, onRefreshChange, onRefresh, onOpenViewSettings, isStandaloneTable, showSync, onToggleSync }
}) {
  const controls = pageControls || {};
  const showControls = !!pageControls;

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

      {/* Right: Page controls (only when viewing a page) */}
      {showControls && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            animation: ANIM.snapInRight(0.05),
          }}
        >
          {/* Record count */}
          {controls.recordCount != null && (
            <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>
              {controls.recordCount} record{controls.recordCount !== 1 ? "s" : ""}
            </span>
          )}

          {/* Customize view */}
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

          {/* Refresh rate */}
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

          {/* Sync button (standalone D1 tables only) */}
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

          {/* Refresh */}
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
    </header>
  );
}
