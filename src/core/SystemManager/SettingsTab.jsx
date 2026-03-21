import React, { useState, useCallback, useEffect } from "react";
import { C, FONT, MONO, RADIUS, THEME_LIST, THEMES, VIEW_PALETTE } from "../../design/tokens.js";
import { ANIM } from "../../design/animations.js";
import { S } from "../../design/styles.js";
import { useTheme } from "../../context/ThemeContext.jsx";
import { usePlatform } from "../../context/PlatformContext.jsx";
import { useColorMapping } from "../../context/ColorMappingContext.jsx";
import ConfirmDialog from "../ConfirmDialog.jsx";
import * as api from "../../lib/api.js";
import { clearConnection, factoryReset as apiFactoryReset } from "../../lib/api.js";
import { isAdmin } from "../../lib/roles.js";

// ── PIN Setup Section (admin-only, used inside SettingsTab) ──

function PinSetupSection() {
  const { identity } = usePlatform();
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState(null); // null | 'saving' | 'saved' | 'error'

  // Only show to admins
  if (identity && identity.role !== "admin") return null;

  const handleSetPin = async () => {
    if (pin.length < 4) { setStatus("error"); return; }
    setStatus("saving");
    try {
      await api.setPin(pin);
      setStatus("saved");
      setPin("");
      setTimeout(() => setStatus(null), 2000);
    } catch { setStatus("error"); }
  };

  return (
    <>
      <div style={{
        fontSize: 10, color: C.darkMuted, fontFamily: FONT,
        textTransform: "uppercase", letterSpacing: "0.08em",
        marginTop: 40, marginBottom: 14,
      }}>
        PIN Lock
      </div>
      <div style={{
        background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg, padding: "16px 18px",
        display: "flex", alignItems: "center", gap: 16, marginBottom: 28,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText, fontFamily: FONT, marginBottom: 4 }}>
            Set Workspace PIN
          </div>
          <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, lineHeight: 1.4, marginBottom: 10 }}>
            Editors must enter this PIN to unlock protected pages. Enable protection per-page in View Settings.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="password"
              value={pin}
              onChange={(e) => { setPin(e.target.value); setStatus(null); }}
              placeholder="4+ digit PIN"
              maxLength={8}
              style={{
                background: C.dark, border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.pill, padding: "7px 12px",
                color: C.darkText, fontFamily: FONT, fontSize: 14,
                letterSpacing: "0.2em", width: 120, textAlign: "center",
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSetPin()}
            />
            <button
              onClick={handleSetPin}
              disabled={status === "saving"}
              style={{
                ...S.btnPrimary, padding: "7px 16px", fontSize: 12,
                opacity: status === "saving" ? 0.6 : 1,
              }}
            >
              {status === "saving" ? "Saving..." : status === "saved" ? "Saved" : "Set PIN"}
            </button>
            {status === "error" && (
              <span style={{ fontSize: 11, color: C.error }}>Min 4 characters</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Settings Tab ──

export default function SettingsTab() {
  const { themeName, setThemeName } = useTheme();
  const { globalColorMapping, globalConfig, updateGlobalDefaults } = useColorMapping();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [draftMapping, setDraftMapping] = useState(globalColorMapping || {});
  const [mappingDirty, setMappingDirty] = useState(false);

  // Sync draft when global config changes externally
  useEffect(() => {
    if (!mappingDirty) setDraftMapping(globalColorMapping || {});
  }, [globalColorMapping, mappingDirty]);

  const handleLogout = useCallback(() => {
    clearConnection();
    window.location.reload();
  }, []);

  const handleFactoryReset = useCallback(async () => {
    setResetting(true);
    try {
      // Server-side: delete all user data from D1 + R2
      await apiFactoryReset();
    } catch (err) {
      console.warn("[SystemManager] Factory reset API call:", err.message || err);
      // If server call fails, still clear local state
    }

    // Clear all wasabi localStorage keys
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("wasabi") || k.startsWith("wasabi-"))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));

    // Hard reload to reset all state
    window.location.reload();
  }, []);

  return (
    <div style={{ padding: "24px 32px" }}>
      {/* Section: Appearance */}
      <div
        style={{
          fontSize: 10,
          color: C.darkMuted,
          fontFamily: FONT,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 14,
        }}
      >
        Appearance
      </div>

      {/* Label: Color Theme */}
      <div
        style={{
          fontSize: 11,
          color: C.darkMuted,
          fontFamily: FONT,
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        Color Theme
      </div>

      {/* Theme cards grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
          gap: 10,
          marginBottom: 28,
        }}
      >
        {THEME_LIST.map((t) => {
          const isActive = themeName === t.key;
          const theme = THEMES[t.key];
          // Show palette accent colors (indices 5-8) as preview dots
          const previewColors = theme.palette.slice(5, 9);
          return (
            <button
              key={t.key}
              onClick={() => setThemeName(t.key)}
              style={{
                position: "relative",
                background: C.darkSurf,
                border: `2px solid ${isActive ? t.accent : C.darkBorder}`,
                borderRadius: RADIUS.lg,
                padding: 0,
                cursor: "pointer",
                outline: "none",
                overflow: "hidden",
                transition: "border-color 0.15s, box-shadow 0.15s",
                boxShadow: isActive ? `0 0 0 2px ${t.accent}33` : "none",
                fontFamily: FONT,
              }}
            >
              {/* Accent bar */}
              <div style={{ height: 6, background: t.accent }} />

              {/* Preview palette dots */}
              <div
                style={{
                  display: "flex",
                  gap: 5,
                  padding: "10px 10px 6px",
                  justifyContent: "center",
                }}
              >
                {previewColors.map((pc, i) => (
                  <div
                    key={i}
                    style={{
                      width: 18, height: 18, borderRadius: "50%",
                      background: pc.hex,
                      border: `1px solid ${C.darkBorder}`,
                    }}
                  />
                ))}
              </div>

              {/* Label + description + check */}
              <div
                style={{
                  padding: "4px 10px 10px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 2,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? t.accent : C.darkText,
                    }}
                  >
                    {t.label}
                  </span>
                  {isActive && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <circle cx="6" cy="6" r="6" fill={t.accent} />
                      <path d="M3.5 6L5.5 8L8.5 4.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                {t.description && (
                  <span style={{ fontSize: 9, color: C.darkMuted, lineHeight: 1.2 }}>
                    {t.description}
                  </span>
                )}
                {t.mode && (
                  <span style={{
                    fontSize: 8, color: C.darkMuted, fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                    background: C.darkSurf2, borderRadius: RADIUS.sm,
                    padding: "2px 6px", marginTop: 2,
                  }}>
                    {t.mode}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Mode indicator (inherent to theme) */}
      <div style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT, marginBottom: 0 }}>
        Mode is set by theme selection
      </div>

      {/* ── Default Color Mapping ── */}
      <div
        style={{
          fontSize: 10,
          color: C.darkMuted,
          fontFamily: FONT,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginTop: 40,
          marginBottom: 14,
        }}
      >
        Default Color Mapping
      </div>

      <p style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, margin: "0 0 12px", lineHeight: 1.4 }}>
        Set global color defaults for status and priority values. Views inherit these unless overridden.
      </p>

      <div style={{
        background: C.darkSurf,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg,
        padding: "14px 16px",
        marginBottom: 12,
        maxHeight: 400,
        overflowY: "auto",
      }}>
        {Object.entries(draftMapping).map(([name, paletteIdx]) => (
          <div key={name} style={{ marginBottom: 10 }}>
            <div style={{
              fontSize: 11,
              fontWeight: 500,
              color: C.darkText,
              fontFamily: FONT,
              marginBottom: 4,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: VIEW_PALETTE[paletteIdx]?.hex || C.darkMuted,
                flexShrink: 0,
              }} />
              {name}
            </div>
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {VIEW_PALETTE.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setDraftMapping((prev) => ({ ...prev, [name]: idx }));
                    setMappingDirty(true);
                  }}
                  title={p.key}
                  style={{
                    width: 18, height: 18, borderRadius: RADIUS.sm,
                    background: p.hex,
                    border: paletteIdx === idx ? "2px solid #fff" : "2px solid transparent",
                    outline: paletteIdx === idx ? `2px solid ${C.accent}` : "none",
                    cursor: "pointer",
                    transition: "all 0.1s",
                    flexShrink: 0,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Save / Reset buttons */}
      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        <button
          onClick={() => {
            setDraftMapping(globalColorMapping || {});
            setMappingDirty(false);
          }}
          style={{
            flex: 1, padding: "8px 12px", fontSize: 12, fontWeight: 500,
            fontFamily: FONT, border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.md, background: "transparent",
            color: C.darkMuted, cursor: "pointer",
          }}
        >
          Reset
        </button>
        <button
          onClick={() => {
            updateGlobalDefaults({ colorMapping: draftMapping });
            setMappingDirty(false);
          }}
          disabled={!mappingDirty}
          style={{
            flex: 1, padding: "8px 12px", fontSize: 12, fontWeight: 600,
            fontFamily: FONT, border: "none", borderRadius: RADIUS.pill,
            background: mappingDirty ? C.accent : C.darkSurf2,
            color: mappingDirty ? "#fff" : C.darkMuted,
            cursor: mappingDirty ? "pointer" : "default",
            transition: "all 0.15s",
          }}
        >
          Save Defaults
        </button>
      </div>

      {/* ── Account ── */}
      <div
        style={{
          fontSize: 10,
          color: C.darkMuted,
          fontFamily: FONT,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginTop: 40,
          marginBottom: 14,
        }}
      >
        Account
      </div>

      <div
        style={{
          background: C.darkSurf,
          border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.lg,
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 28,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText, fontFamily: FONT, marginBottom: 4 }}>
            Log Out
          </div>
          <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, lineHeight: 1.4 }}>
            Disconnect from the current worker. Your data is preserved on the server.
          </div>
        </div>
        <button
          onClick={handleLogout}
          style={{
            background: "transparent",
            border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.pill,
            color: C.darkText,
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 600,
            padding: "7px 18px",
            cursor: "pointer",
            outline: "none",
            transition: "background 0.14s",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.darkBorder + "44"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          Log Out
        </button>
      </div>

      {/* ── PIN Lock ── */}
      <PinSetupSection />

      {/* ── Factory Reset ── */}
      <div
        style={{
          fontSize: 10,
          color: C.darkMuted,
          fontFamily: FONT,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 14,
        }}
      >
        Danger Zone
      </div>

      <div
        style={{
          background: C.darkSurf,
          border: `1px solid ${C.error}33`,
          borderRadius: RADIUS.lg,
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText, fontFamily: FONT, marginBottom: 4 }}>
            Factory Reset
          </div>
          <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, lineHeight: 1.4 }}>
            Erase all user data, connections, and pages. Resets the app to its original state.
          </div>
        </div>
        <button
          onClick={() => setShowResetConfirm(true)}
          disabled={resetting}
          style={{
            background: "transparent",
            border: `1px solid ${C.error}`,
            borderRadius: RADIUS.pill,
            color: C.error,
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 600,
            padding: "7px 18px",
            cursor: resetting ? "default" : "pointer",
            outline: "none",
            transition: "background 0.14s",
            opacity: resetting ? 0.5 : 1,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { if (!resetting) { e.currentTarget.style.background = C.error + "18"; } }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          {resetting ? "Resetting..." : "Reset"}
        </button>
      </div>

      {showResetConfirm && (
        <ConfirmDialog
          title="Factory Reset"
          message="This will erase ALL your data including pages, folders, connections, and settings. The app will reload to its original state. This cannot be undone."
          confirmLabel="Reset Everything"
          onConfirm={handleFactoryReset}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}
    </div>
  );
}
