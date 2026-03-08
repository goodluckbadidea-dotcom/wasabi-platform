// ─── Setup Wizard ───
// Simplified setup: Worker URL + shared secret → health check → D1 init.
// Notion and Claude are optional connections added later in System Manager.

import React, { useState, useCallback } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { ANIM } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { saveConnection, checkHealth, initDatabase } from "../lib/api.js";
import WasabiFlame from "./WasabiFlame.jsx";

export default function SetupWizard() {
  const { completeSetup } = usePlatform();

  const [workerUrl, setWorkerUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [step, setStep] = useState("connect"); // "connect" | "checking" | "initializing" | "error"
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const handleConnect = useCallback(async () => {
    const url = workerUrl.trim().replace(/\/$/, "");
    const key = secret.trim();

    if (!url) {
      setError("Worker URL is required.");
      return;
    }

    setStep("checking");
    setError("");
    setStatus("Checking worker health...");

    try {
      // Save connection locally so api.js can use it
      saveConnection(url, key);

      // Health check
      const health = await checkHealth();
      if (!health.ok) {
        setError("Worker responded but reported unhealthy status.");
        setStep("connect");
        return;
      }

      if (!health.d1) {
        setError("D1 database not bound to worker. Check your wrangler-worker.toml configuration.");
        setStep("connect");
        return;
      }

      // Initialize D1 tables
      setStatus("Initializing database...");
      setStep("initializing");

      const initResult = await initDatabase();
      if (!initResult.ok) {
        setError(`Database initialization failed: ${initResult._error || "Unknown error"}`);
        setStep("connect");
        return;
      }

      setStatus("Ready!");

      // Complete setup — PlatformContext will switch to the app
      completeSetup(url, key);
    } catch (err) {
      const msg = err.message || "";
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("fetch")) {
        setError("Cannot reach worker. Check the URL and make sure the worker is deployed.");
      } else if (msg.includes("Unauthorized") || msg.includes("401")) {
        setError("Invalid secret. Check your WASABI_SECRET and try again.");
      } else {
        setError(msg || "Connection failed");
      }
      setStep("connect");
    }
  }, [workerUrl, secret, completeSetup]);

  const inputStyle = {
    ...S.input,
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    color: C.darkText,
    padding: "12px 16px",
    fontSize: 14,
    borderRadius: RADIUS.lg,
  };

  const isConnecting = step === "checking" || step === "initializing";

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
            Connect to your Wasabi worker to get started
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
              placeholder="https://wasabi-worker.your-account.workers.dev"
              style={inputStyle}
              disabled={isConnecting}
            />
          </div>

          <div>
            <label style={{ ...S.label, color: C.darkMuted, display: "block", marginBottom: 6 }}>
              Shared Secret
            </label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Your WASABI_SECRET (optional for first setup)"
              style={inputStyle}
              disabled={isConnecting}
            />
            <p style={{ fontSize: 11, color: C.darkMuted, marginTop: 4, lineHeight: 1.4 }}>
              The shared secret configured on your worker. Leave blank if not yet set.
            </p>
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
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>&#x27F3;</span>
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
            {isConnecting ? "Connecting..." : "Connect"}
          </button>
        </div>

        <p style={{
          fontSize: 11,
          color: C.darkMuted,
          textAlign: "center",
          marginTop: 20,
          lineHeight: 1.5,
        }}>
          Your worker handles all API calls and data storage.
          <br />
          Add Notion, Claude, and other integrations in System Manager after connecting.
        </p>
      </div>
    </div>
  );
}
