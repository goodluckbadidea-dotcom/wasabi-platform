// ─── Setup Wizard ───
// First screen: API key entry + Notion connection validation.

import React, { useState, useCallback } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { testConnection } from "../notion/client.js";
import { runFirstTimeSetup, isSetupComplete } from "../config/setup.js";

export default function SetupWizard() {
  const { setUserKeys, setPlatformIds, setIsLoading } = usePlatform();

  const [workerUrl, setWorkerUrl] = useState("");
  const [notionKey, setNotionKey] = useState("");
  const [claudeKey, setClaudeKey] = useState("");
  const [step, setStep] = useState("keys"); // "keys" | "connecting" | "setting-up" | "error"
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const handleConnect = useCallback(async () => {
    const url = workerUrl.trim().replace(/\/$/, "");
    const notion = notionKey.trim();
    const claude = claudeKey.trim();

    if (!url || !notion || !claude) {
      setError("All three fields are required.");
      return;
    }

    setStep("connecting");
    setError("");
    setStatus("Testing Notion connection...");

    try {
      // Test Notion connection
      const result = await testConnection(url, notion);
      if (!result.ok) {
        setError(`Notion connection failed: ${result.error}`);
        setStep("keys");
        return;
      }

      setStatus("Connection verified. Setting up platform...");
      setStep("setting-up");

      // Save keys first
      const keys = { workerUrl: url, notionKey: notion, claudeKey: claude };
      setUserKeys(keys);

      // Run first-time setup (creates Notion databases)
      const ids = await runFirstTimeSetup(url, notion);
      setPlatformIds(ids);

      setStatus("Done!");
      // PlatformContext will now show the app
    } catch (err) {
      setError(`Setup failed: ${err.message}`);
      setStep("keys");
    }
  }, [workerUrl, notionKey, claudeKey, setUserKeys, setPlatformIds]);

  const inputStyle = {
    ...S.input,
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    color: C.darkText,
    padding: "12px 16px",
    fontSize: 14,
    borderRadius: RADIUS.lg,
  };

  const isConnecting = step === "connecting" || step === "setting-up";

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
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🌿</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: C.darkText, letterSpacing: "-0.02em" }}>
            Wasabi
          </h1>
          <p style={{ fontSize: 13, color: C.darkMuted, marginTop: 6 }}>
            Connect your APIs to get started
          </p>
        </div>

        {/* Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ ...S.label, color: C.darkMuted, display: "block", marginBottom: 6 }}>
              Worker URL
            </label>
            <input
              type="url"
              value={workerUrl}
              onChange={(e) => setWorkerUrl(e.target.value)}
              placeholder="https://your-worker.workers.dev"
              style={inputStyle}
              disabled={isConnecting}
            />
          </div>

          <div>
            <label style={{ ...S.label, color: C.darkMuted, display: "block", marginBottom: 6 }}>
              Notion API Key
            </label>
            <input
              type="password"
              value={notionKey}
              onChange={(e) => setNotionKey(e.target.value)}
              placeholder="ntn_..."
              style={inputStyle}
              disabled={isConnecting}
            />
          </div>

          <div>
            <label style={{ ...S.label, color: C.darkMuted, display: "block", marginBottom: 6 }}>
              Claude API Key
            </label>
            <input
              type="password"
              value={claudeKey}
              onChange={(e) => setClaudeKey(e.target.value)}
              placeholder="sk-ant-..."
              style={inputStyle}
              disabled={isConnecting}
            />
          </div>

          {error && (
            <div style={{
              background: "#FF480018",
              border: `1px solid #FF480044`,
              borderRadius: RADIUS.md,
              padding: "10px 14px",
              fontSize: 13,
              color: "#FF6B3D",
            }}>
              {error}
            </div>
          )}

          {isConnecting && (
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
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
              {status}
            </div>
          )}

          <button
            onClick={handleConnect}
            disabled={isConnecting}
            style={{
              ...S.btnPrimary,
              width: "100%",
              padding: "12px 20px",
              fontSize: 15,
              marginTop: 8,
              opacity: isConnecting ? 0.6 : 1,
              cursor: isConnecting ? "default" : "pointer",
            }}
          >
            {isConnecting ? "Setting up..." : "Connect & Launch"}
          </button>
        </div>

        <p style={{
          fontSize: 11,
          color: C.darkMuted,
          textAlign: "center",
          marginTop: 20,
          lineHeight: 1.5,
        }}>
          Your API keys are stored locally and never sent to third parties.
          <br />
          You need a Cloudflare Worker deployed as a proxy.
        </p>
      </div>
    </div>
  );
}
