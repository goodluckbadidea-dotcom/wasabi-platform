// ─── Setup Wizard ───
// First screen: API key entry + Notion connection validation.

import React, { useState, useCallback } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { testConnection, getPage } from "../notion/client.js";
import WasabiFlame from "./WasabiFlame.jsx";
import { runFirstTimeSetup, isSetupComplete } from "../config/setup.js";

/**
 * Extract a Notion page ID from a URL or raw ID string.
 * Supports: full URLs, UUIDs with/without dashes, or short hex IDs at the end of a URL.
 */
function extractPageId(input) {
  const s = (input || "").trim();
  // Already a UUID with dashes
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return s;
  // UUID without dashes
  if (/^[0-9a-f]{32}$/i.test(s)) {
    return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
  }
  // URL — grab the last 32-hex-char block (with or without dashes)
  const match = s.match(/([0-9a-f]{32})/i) || s.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (match) {
    const raw = match[1].replace(/-/g, "");
    return `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
  }
  return null;
}

export default function SetupWizard() {
  const { setUserKeys, setPlatformIds, setIsLoading } = usePlatform();

  const [workerUrl, setWorkerUrl] = useState("");
  const [notionKey, setNotionKey] = useState("");
  const [claudeKey, setClaudeKey] = useState("");
  const [parentPage, setParentPage] = useState("");
  const [step, setStep] = useState("keys"); // "keys" | "connecting" | "setting-up" | "error"
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const handleConnect = useCallback(async () => {
    const url = workerUrl.trim().replace(/\/$/, "");
    const notion = notionKey.trim();
    const claude = claudeKey.trim();
    const parentId = extractPageId(parentPage);

    if (!url || !notion || !claude) {
      setError("Worker URL, Notion key, and Claude key are required.");
      return;
    }

    if (!parentId) {
      setError("Please paste a valid Notion page URL or ID. This page will contain Wasabi's workspace.");
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

      // Verify we can access the parent page before setup
      setStatus("Verifying page access...");
      try {
        await getPage(url, notion, parentId);
      } catch (pageErr) {
        const msg = pageErr.message || "";
        if (msg.includes("404") || msg.includes("not find")) {
          setError(
            "Cannot access that Notion page. Make sure you've shared it with your integration " +
            "(open the page in Notion → ··· menu → Connections → Add your integration)."
          );
        } else if (msg.includes("401")) {
          setError("Invalid Notion API key — double-check it and try again.");
        } else if (msg.includes("403")) {
          setError("Insufficient permissions on this page. Your integration needs full access.");
        } else {
          setError(`Cannot access page: ${msg}`);
        }
        setStep("keys");
        return;
      }

      setStatus("Page verified. Setting up platform...");
      setStep("setting-up");

      // Save keys first
      const keys = { workerUrl: url, notionKey: notion, claudeKey: claude };
      setUserKeys(keys);

      // Run first-time setup under the user's chosen parent page
      const ids = await runFirstTimeSetup(url, notion, parentId);
      setPlatformIds(ids);

      setStatus("Done!");
      // PlatformContext will now show the app
    } catch (err) {
      const msg = err.message || "";
      let userError;
      if (msg.includes("404")) {
        userError = "Page not found — check the page ID and make sure it's shared with your integration.";
      } else if (msg.includes("401")) {
        userError = "Invalid Notion API key.";
      } else if (msg.includes("403")) {
        userError = "Insufficient permissions on this page.";
      } else {
        userError = `Setup failed: ${msg}`;
      }
      setError(userError);
      setStep("keys");
    }
  }, [workerUrl, notionKey, claudeKey, parentPage, setUserKeys, setPlatformIds]);

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
          <div style={{ marginBottom: 12 }}><WasabiFlame size={48} /></div>
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

          <div>
            <label style={{ ...S.label, color: C.darkMuted, display: "block", marginBottom: 6 }}>
              Notion Parent Page
            </label>
            <input
              type="text"
              value={parentPage}
              onChange={(e) => setParentPage(e.target.value)}
              placeholder="Paste any Notion page URL"
              style={inputStyle}
              disabled={isConnecting}
            />
            <p style={{ fontSize: 11, color: C.darkMuted, marginTop: 4, lineHeight: 1.4 }}>
              Wasabi creates its workspace under this page.
              Share it with your Notion integration first.
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
