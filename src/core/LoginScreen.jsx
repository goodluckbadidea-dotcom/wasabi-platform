// ─── Login Screen ───
// Shown after worker connection when multi-user is enabled but no JWT identity.
// Two modes: Register (invite code + display name) or Login (user ID).
// Matches SetupWizard visual design: centered card, WasabiFlame, dark bg.

import React, { useState, useCallback } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { ANIM } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import WasabiFlame from "./WasabiFlame.jsx";

export default function LoginScreen() {
  const { register, login, adminInvite } = usePlatform();

  const [mode, setMode] = useState(adminInvite ? "register" : "register"); // "register" | "login"
  const [inviteCode, setInviteCode] = useState(adminInvite || "");
  const [displayName, setDisplayName] = useState("");
  const [userId, setUserId] = useState("");
  const [step, setStep] = useState("idle"); // "idle" | "loading" | "error"
  const [error, setError] = useState("");

  const handleRegister = useCallback(async () => {
    const code = inviteCode.trim();
    const name = displayName.trim();
    if (!code) { setError("Invite code is required."); return; }
    if (!name) { setError("Display name is required."); return; }

    setStep("loading");
    setError("");
    try {
      await register(code, name);
      // Success — AuthContext sets identity, App unmounts this screen
    } catch (err) {
      setError(err.message || "Registration failed");
      setStep("idle");
    }
  }, [inviteCode, displayName, register]);

  const handleLogin = useCallback(async () => {
    const id = userId.trim();
    if (!id) { setError("User ID is required."); return; }

    setStep("loading");
    setError("");
    try {
      await login(id);
    } catch (err) {
      setError(err.message || "Login failed");
      setStep("idle");
    }
  }, [userId, login]);

  const isLoading = step === "loading";

  const inputStyle = {
    ...S.input,
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    color: C.darkText,
    padding: "12px 16px",
    fontSize: 14,
    borderRadius: RADIUS.lg,
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      width: "100vw",
      background: C.dark,
      fontFamily: FONT,
    }}>
      <div style={{
        background: C.darkSurf,
        borderRadius: RADIUS.xl,
        border: `1px solid ${C.darkBorder}`,
        padding: 40,
        width: 440,
        maxWidth: "92vw",
        boxShadow: SHADOW.dropdown,
        animation: ANIM.modalPop(0.1),
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ marginBottom: 12 }}><WasabiFlame size={48} /></div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: C.darkText, letterSpacing: "-0.02em" }}>
            Wasabi
          </h1>
          <p style={{ fontSize: 13, color: C.darkMuted, marginTop: 6 }}>
            {mode === "register" ? "Create your account" : "Sign in to continue"}
          </p>
        </div>

        {/* First-boot banner */}
        {adminInvite && mode === "register" && (
          <div style={{
            background: C.accent + "18",
            border: `1px solid ${C.accent}44`,
            borderRadius: RADIUS.md,
            padding: "10px 14px",
            fontSize: 12,
            color: C.accent,
            marginBottom: 16,
            lineHeight: 1.5,
          }}>
            First-time setup — use the invite code below to create your admin account.
          </div>
        )}

        {/* Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {mode === "register" ? (
            <>
              <div>
                <label style={{ ...S.label, color: C.darkMuted, display: "block", marginBottom: 6 }}>
                  Invite Code
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Enter your invite code"
                  style={inputStyle}
                  disabled={isLoading}
                  onKeyDown={(e) => e.key === "Enter" && handleRegister()}
                />
              </div>
              <div>
                <label style={{ ...S.label, color: C.darkMuted, display: "block", marginBottom: 6 }}>
                  Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  style={inputStyle}
                  disabled={isLoading}
                  onKeyDown={(e) => e.key === "Enter" && handleRegister()}
                />
              </div>
            </>
          ) : (
            <div>
              <label style={{ ...S.label, color: C.darkMuted, display: "block", marginBottom: 6 }}>
                User ID
              </label>
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="Enter your user ID"
                style={inputStyle}
                disabled={isLoading}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              />
            </div>
          )}

          {error && (
            <div style={{
              background: "#FF480018",
              border: "1px solid #FF480044",
              borderRadius: RADIUS.md,
              padding: "10px 14px",
              fontSize: 13,
              color: "#FF6B3D",
            }}>
              {error}
            </div>
          )}

          {isLoading && (
            <div style={{
              background: C.accent + "18",
              border: `1px solid ${C.accent}44`,
              borderRadius: RADIUS.md,
              padding: "10px 14px",
              fontSize: 13,
              color: C.accent,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>&#x27F3;</span>
              {mode === "register" ? "Creating account..." : "Signing in..."}
            </div>
          )}

          <button
            onClick={mode === "register" ? handleRegister : handleLogin}
            disabled={isLoading}
            style={{
              ...S.btnPrimary,
              width: "100%",
              padding: "12px 20px",
              fontSize: 15,
              marginTop: 8,
              opacity: isLoading ? 0.6 : 1,
              cursor: isLoading ? "default" : "pointer",
            }}
          >
            {isLoading ? "Please wait..." : mode === "register" ? "Register" : "Sign In"}
          </button>
        </div>

        {/* Mode toggle */}
        <p style={{
          fontSize: 12,
          color: C.darkMuted,
          textAlign: "center",
          marginTop: 20,
          lineHeight: 1.5,
        }}>
          {mode === "register" ? (
            <>
              Already registered?{" "}
              <span
                onClick={() => { setMode("login"); setError(""); }}
                style={{ color: C.accent, cursor: "pointer" }}
              >
                Sign in
              </span>
            </>
          ) : (
            <>
              Have an invite code?{" "}
              <span
                onClick={() => { setMode("register"); setError(""); }}
                style={{ color: C.accent, cursor: "pointer" }}
              >
                Register
              </span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
