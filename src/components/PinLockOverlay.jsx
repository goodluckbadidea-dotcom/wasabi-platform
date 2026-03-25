// ─── PIN Lock Overlay ───
// Covers protected table content until editor enters correct PIN.
// Admin: never locked. Viewer: always locked (no PIN input). Editor: unlock with PIN.
// Lock re-engages on page navigation or when server-side token expires (15 min).
// PIN token stored in sessionStorage for server-side verification.

import React, { useState, useEffect, useCallback } from "react";
import { C, FONT, RADIUS, SHADOW, Z } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { ANIM } from "../design/animations.js";
import { verifyPin } from "../lib/api.js";

const PIN_TOKEN_KEY = "wasabi_pin_token";
const PIN_EXPIRY_KEY = "wasabi_pin_expiry";

export function getPinToken(pageId) {
  try {
    const key = `${PIN_TOKEN_KEY}_${pageId}`;
    const token = sessionStorage.getItem(key);
    const expiry = sessionStorage.getItem(`${PIN_EXPIRY_KEY}_${pageId}`);
    if (token && expiry && Date.now() < Number(expiry)) return token;
    // Expired — clean up
    sessionStorage.removeItem(key);
    sessionStorage.removeItem(`${PIN_EXPIRY_KEY}_${pageId}`);
    return null;
  } catch { return null; }
}

function savePinToken(pageId, token, expiresIn) {
  try {
    sessionStorage.setItem(`${PIN_TOKEN_KEY}_${pageId}`, token);
    sessionStorage.setItem(`${PIN_EXPIRY_KEY}_${pageId}`, String(Date.now() + expiresIn * 1000));
  } catch {}
}

export default function PinLockOverlay({ pageConfigId, userRole, children }) {
  const [locked, setLocked] = useState(() => !getPinToken(pageConfigId));
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Re-lock on page navigation (check if existing token is still valid)
  useEffect(() => {
    const existing = getPinToken(pageConfigId);
    setLocked(!existing);
    setPin("");
    setError("");
  }, [pageConfigId]);

  // Check token expiry periodically
  useEffect(() => {
    if (locked) return;
    const interval = setInterval(() => {
      if (!getPinToken(pageConfigId)) setLocked(true);
    }, 30000); // check every 30s
    return () => clearInterval(interval);
  }, [locked, pageConfigId]);

  const handleUnlock = useCallback(async () => {
    if (!pin.trim()) { setError("Enter a PIN"); return; }
    setLoading(true);
    setError("");
    try {
      const result = await verifyPin(pin, pageConfigId);
      if (result.verified && result.pin_token) {
        savePinToken(pageConfigId, result.pin_token, result.expires_in || 900);
        setLocked(false);
        setPin("");
      }
    } catch (err) {
      setError(err.message || "Incorrect PIN");
    } finally {
      setLoading(false);
    }
  }, [pin, pageConfigId]);

  // Admin: never show overlay
  if (userRole === "admin") return children;

  // Unlocked: render normally
  if (!locked) return children;

  const isViewerRole = userRole === "viewer";

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      {/* Blurred content behind */}
      <div style={{
        filter: "blur(4px)",
        opacity: 0.4,
        pointerEvents: "none",
        width: "100%",
        height: "100%",
      }}>
        {children}
      </div>

      {/* Overlay */}
      <div style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: Z.lock,
        background: C.overlayBg,
      }}>
        <div style={{
          background: C.darkSurf,
          borderRadius: RADIUS.xl,
          padding: 32,
          border: `1px solid ${C.darkBorder}`,
          boxShadow: SHADOW.dropdown,
          animation: ANIM.modalPop(),
          textAlign: "center",
          maxWidth: 320,
          fontFamily: FONT,
        }}>
          {/* Lock icon */}
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{ marginBottom: 12 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" stroke={C.darkMuted} strokeWidth="1.5" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke={C.darkMuted} strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="12" cy="16" r="1.5" fill={C.darkMuted} />
          </svg>

          {isViewerRole ? (
            <>
              <div style={{ fontSize: 16, fontWeight: 600, color: C.darkText, marginBottom: 8 }}>
                View Only
              </div>
              <div style={{ fontSize: 13, color: C.darkMuted, lineHeight: 1.5 }}>
                Editing requires Editor access.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 16, fontWeight: 600, color: C.darkText, marginBottom: 8 }}>
                Enter PIN to edit
              </div>
              <div style={{ fontSize: 12, color: C.darkMuted, marginBottom: 16 }}>
                This table is protected. Enter the PIN to unlock editing.
              </div>

              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="PIN"
                maxLength={8}
                style={{
                  ...S.input,
                  background: C.darkSurf,
                  border: `1px solid ${C.darkBorder}`,
                  color: C.darkText,
                  textAlign: "center",
                  letterSpacing: "0.3em",
                  fontSize: 20,
                  padding: "10px 16px",
                  borderRadius: RADIUS.lg,
                  width: "100%",
                  boxSizing: "border-box",
                  marginBottom: 12,
                }}
                disabled={loading}
                onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
                autoFocus
              />

              {error && (
                <div style={{
                  background: "#FF480018",
                  border: "1px solid #FF480044",
                  borderRadius: RADIUS.md,
                  padding: "8px 12px",
                  fontSize: 12,
                  color: C.warning,
                  marginBottom: 12,
                }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleUnlock}
                disabled={loading}
                style={{
                  ...S.btnPrimary,
                  width: "100%",
                  padding: "10px 20px",
                  fontSize: 14,
                  opacity: loading ? 0.6 : 1,
                  cursor: loading ? "default" : "pointer",
                }}
              >
                {loading ? "Verifying..." : "Unlock"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
