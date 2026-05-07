// ─── Top Header Bar ───
// Slim header: WASABI wordmark + breadcrumb left, theme toggle + neurons + user pill right.
// Page-level controls (record count, refresh, sync) live in ViewToolbar/SubPageNav now.

import React, { useState, useEffect, useRef } from "react";
import { C, FONT, RADIUS, SHADOW, Z } from "../design/tokens.js";
import { useTheme } from "../context/ThemeContext.jsx";
import { useNeurons } from "../neurons/NeuronsContext.jsx";
import { usePages } from "../context/PagesContext.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
import { isAdmin } from "../lib/roles.js";
import Breadcrumb from "../components/Breadcrumb.jsx";
import { useViewport } from "../context/ViewportContext.jsx";
import { focusRing } from "../design/interactions.js";
import { IconGear } from "../design/icons.jsx";

export default function TopHeader() {
  const dropdownItemStyle = getDropdownItemStyle();
  const { themeName, toggleMode } = useTheme();
  const { overlayActive, toggleOverlay, selection } = useNeurons();
  const { saveStatus } = usePages();
  const { identity, logout, setActivePage } = usePlatform();
  const { isNarrow, isTablet } = useViewport();
  const compact = isNarrow || isTablet;

  // User dropdown
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close on click outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  // Close on Escape
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e) => { if (e.key === "Escape") setDropdownOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [dropdownOpen]);

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
        padding: `env(safe-area-inset-top, 0px) ${compact ? 12 : 24}px 0`,
        position: "relative",
        zIndex: Z.header,
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
          color: saveStatus === "error" ? C.error : saveStatus === "saving" ? C.darkMuted : C.accent,
          padding: "4px 10px", borderRadius: RADIUS.pill, flexShrink: 0,
          background: saveStatus === "error" ? C.errorDim : "transparent",
          transition: "all 0.2s",
          letterSpacing: "0.03em",
        }}>
          {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save failed"}
        </div>
      )}

      {/* Right: Refresh + Neurons toggle + Theme cycle + User pill */}
      <div style={{ display: "flex", alignItems: "center", gap: compact ? 6 : 10, flexShrink: 0 }}>
        {/* Hard refresh */}
        <button
          onClick={() => {
            // Clear all data caches
            try {
              for (const key of Object.keys(localStorage)) {
                if (key.startsWith("wasabi_zen_") || key.startsWith("wasabi_ai_") || key.startsWith("wasabi_insight") || key.startsWith("wasabi_cal_") || key.startsWith("wasabi_tasks_") || key.startsWith("wasabi-dashboard-") || key.startsWith("wasabi-hidden-")) {
                  localStorage.removeItem(key);
                }
              }
            } catch {}
            window.location.reload();
          }}
          title="Hard refresh — clear caches & reload"
          {...focusRing()}
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
          {...focusRing()}
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
          {!compact && "Neurons"}
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
          {!compact && (themeName.charAt(0).toUpperCase() + themeName.slice(1))}
        </button>

        {/* Settings gear (moved out of left nav in Phase 2). Admin only when
            multi-user is active — same gating as the old left-nav button. */}
        {identity?.role === "admin" && (
          <button
            onClick={() => setActivePage("system")}
            title="Settings"
            aria-label="Open settings"
            {...focusRing()}
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
              opacity: 0.5,
              outline: "none",
              minWidth: 32, minHeight: 32,
              color: C.darkMuted,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
          >
            <IconGear size={16} color="currentColor" />
          </button>
        )}

        {/* User identity pill */}
        {identity && (
          <div ref={dropdownRef} style={{ position: "relative" }}>
            <button
              onClick={() => setDropdownOpen((p) => !p)}
              {...focusRing()}
              style={{
                background: dropdownOpen ? C.accent + "22" : "transparent",
                border: `1px solid ${dropdownOpen ? C.accent : C.darkBorder}`,
                borderRadius: RADIUS.pill,
                padding: "5px 12px 5px 6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
                transition: "background 0.15s, border-color 0.15s",
                color: C.darkMuted,
                fontSize: 12,
                fontFamily: FONT,
                fontWeight: 500,
                minHeight: 32,
                outline: "none",
              }}
              onMouseEnter={(e) => {
                if (!dropdownOpen) {
                  e.currentTarget.style.borderColor = C.darkMuted;
                  e.currentTarget.style.background = C.darkSurf2;
                }
              }}
              onMouseLeave={(e) => {
                if (!dropdownOpen) {
                  e.currentTarget.style.borderColor = C.darkBorder;
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              {/* Avatar circle */}
              <span style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                flexShrink: 0,
              }}>
                {(identity.display_name || "U").charAt(0).toUpperCase()}
              </span>
              {!isNarrow && (
                <span style={{ color: C.darkText, fontWeight: 500 }}>
                  {identity.display_name}
                </span>
              )}
              {!compact && (
                <span style={{
                  fontSize: 9,
                  color: C.darkMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  fontWeight: 600,
                }}>
                  {identity.role}
                </span>
              )}
            </button>

            {/* Dropdown */}
            {dropdownOpen && (
              <div style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                background: C.darkSurf,
                border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.lg,
                boxShadow: SHADOW.dropdown,
                minWidth: 170,
                zIndex: Z.dropdown,
                padding: "4px 0",
                fontFamily: FONT,
              }}>
                {/* Settings */}
                <button
                  onClick={() => { setActivePage("system"); setDropdownOpen(false); }}
                  style={dropdownItemStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  Settings
                </button>

                {/* User Management (admin only) */}
                {isAdmin(identity) && (
                  <button
                    onClick={() => { setActivePage("system"); setDropdownOpen(false); }}
                    style={dropdownItemStyle}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    User Management
                  </button>
                )}

                {/* Divider */}
                <div style={{ height: 1, background: C.edgeLine, margin: "4px 0" }} />

                {/* Log Out */}
                <button
                  onClick={() => { logout(); setDropdownOpen(false); }}
                  style={{ ...dropdownItemStyle, color: C.error }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = `${C.error}15`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  Log Out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

// Returned from function so theme switches pick up fresh C values.
function getDropdownItemStyle() { return {
  display: "block",
  width: "100%",
  padding: "8px 14px",
  background: "transparent",
  border: "none",
  color: C.darkText,
  fontSize: 13,
  fontFamily: FONT,
  fontWeight: 400,
  textAlign: "left",
  cursor: "pointer",
  transition: "background 0.1s",
  outline: "none",
}; }
