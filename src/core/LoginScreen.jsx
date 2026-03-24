// ─── Login Screen ───
// Sole entry point when user is not authenticated.
// Two modes: Register (invite code + display name + password) or Login (name + password).
// If VITE_WORKER_URL is not set, shows a configuration error.

import React, { useState, useCallback } from "react";
import { C, FONT, FONT_DISPLAY, RADIUS, SHADOW } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { ANIM } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import WasabiFlame from "./WasabiFlame.jsx";
import Spinner from "../components/Spinner.jsx";

export default function LoginScreen({ configError }) {
  const { register, login, adminInvite } = usePlatform();

  const [mode, setMode] = useState(adminInvite ? "register" : "login"); // "register" | "login"
  const [inviteCode, setInviteCode] = useState(adminInvite || "");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState("idle"); // "idle" | "loading" | "error"
  const [error, setError] = useState("");

  const handleRegister = useCallback(async () => {
    const code = inviteCode.trim();
    const name = displayName.trim();
    if (!code) { setError("Invite code is required."); return; }
    if (!name) { setError("Display name is required."); return; }
    if (!password || password.length < 6) { setError("Password must be at least 6 characters."); return; }

    setStep("loading");
    setError("");
    try {
      await register(code, name, password);
      // Success — AuthContext sets identity, App unmounts this screen
    } catch (err) {
      setError(err.message || "Registration failed");
      setStep("idle");
    }
  }, [inviteCode, displayName, password, register]);

  const handleLogin = useCallback(async () => {
    const name = displayName.trim();
    if (!name) { setError("Display name is required."); return; }
    if (!password) { setError("Password is required."); return; }

    setStep("loading");
    setError("");
    try {
      await login(name, password);
    } catch (err) {
      setError(err.message || "Login failed");
      setStep("idle");
    }
  }, [displayName, password, login]);

  const isLoading = step === "loading";

  const inputStyle = {
    ...S.input,
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    color: C.darkText,
    padding: "12px 16px",
    fontSize: 14,
    borderRadius: RADIUS.md,
    width: "100%",
    boxSizing: "border-box",
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      mode === "register" ? handleRegister() : handleLogin();
    }
  };

  const renderForm = () => (
    <>
      {/* First-boot banner */}
      {adminInvite && mode === "register" && (
        <div style={{
          background: C.accent + "18",
          border: `1px solid ${C.accent}44`,
          borderRadius: RADIUS.pill,
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
        {mode === "register" && (
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
              onKeyDown={handleKeyDown}
            />
          </div>
        )}

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
            onKeyDown={handleKeyDown}
          />
        </div>

        <div>
          <label style={{ ...S.label, color: C.darkMuted, display: "block", marginBottom: 6 }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "register" ? "Min 6 characters" : "Enter your password"}
            style={inputStyle}
            disabled={isLoading}
            onKeyDown={handleKeyDown}
          />
        </div>

        {error && (
          <div style={{
            background: C.orange + "18",
            border: `1px solid ${C.orange}44`,
            borderRadius: RADIUS.pill,
            padding: "10px 14px",
            fontSize: 13,
            color: C.orange,
          }}>
            {error}
          </div>
        )}

        {isLoading && (
          <div style={{
            background: C.accent + "18",
            border: `1px solid ${C.accent}44`,
            borderRadius: RADIUS.pill,
            padding: "10px 14px",
            fontSize: 13,
            color: C.accent,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            <Spinner size={14} color={C.accent} />
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
              onClick={() => { setMode("login"); setError(""); setPassword(""); }}
              style={{ color: C.accent, cursor: "pointer" }}
            >
              Sign in
            </span>
          </>
        ) : (
          <>
            Have an invite code?{" "}
            <span
              onClick={() => { setMode("register"); setError(""); setPassword(""); }}
              style={{ color: C.accent, cursor: "pointer" }}
            >
              Register
            </span>
          </>
        )}
      </p>
    </>
  );

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      width: "100vw",
      background: `radial-gradient(ellipse 600px 400px at center, ${C.accent}08, ${C.dark} 70%)`,
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
          <div style={{ marginBottom: 12 }}><WasabiFlame size={72} /></div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 700, color: C.darkText, letterSpacing: "-0.02em" }}>
            Wasabi
          </h1>
          <p style={{ fontSize: 13, color: C.darkMuted, marginTop: 6 }}>
            {configError ? "Configuration required" : mode === "register" ? "Create your account" : "Sign in to continue"}
          </p>
        </div>

        {/* Config error — worker URL not set */}
        {configError && (
          <div style={{
            background: C.orange + "18",
            border: `1px solid ${C.orange}44`,
            borderRadius: RADIUS.pill,
            padding: "14px 16px",
            fontSize: 13,
            color: C.orange,
            lineHeight: 1.6,
            textAlign: "center",
          }}>
            {configError}
          </div>
        )}

        {!configError && renderForm()}
      </div>
    </div>
  );
}
