// ─── Plugin Widget Renderer ───
// Renders a custom function's output inside a sandboxed iframe.
// Fetches the function's code from D1, builds an HTML document, and injects
// theme colors via postMessage so plugins can match the active theme.

import React, { useState, useEffect, useRef, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { IconBolt, IconRefresh, IconWarning } from "../design/icons.jsx";
import * as api from "../lib/api.js";
import { IFRAME_SANDBOX_HELPERS, IFRAME_AUTO_EXECUTE } from "../lib/iframeHelpers.js";

/**
 * Build the srcdoc HTML that the iframe will render.
 * The plugin code receives a `wasabi` global with theme colors and a `refresh()` helper.
 * Sandbox helpers (formatDate, round, sum, etc.) are available so plugin functions work.
 */
function buildSrcdoc(code, themeColors) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Outfit','DM Sans',sans-serif;
    font-size: 13px;
    color: ${themeColors.text};
    background: transparent;
    overflow: auto;
    padding: 8px;
  }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${themeColors.border}; border-radius: 4px; }
</style>
</head>
<body>
<div id="root"></div>
<script>
// Theme colors available to plugin code
window.wasabi = {
  colors: ${JSON.stringify(themeColors)},
  root: document.getElementById('root'),
  refresh: function() { window.parent.postMessage({ type: 'plugin-refresh' }, '*'); },
};

// Listen for theme updates from parent
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'theme-update') {
    window.wasabi.colors = e.data.colors;
    if (typeof window.wasabi.onThemeChange === 'function') {
      window.wasabi.onThemeChange(e.data.colors);
    }
  }
});

// Sandbox helpers (same as toolExecutor.js)
${IFRAME_SANDBOX_HELPERS}

try {
  var __userCode = ${JSON.stringify(code)};
  (new Function('wasabi', __userCode)).call(null, window.wasabi);

  ${IFRAME_AUTO_EXECUTE}
} catch(err) {
  document.getElementById('root').innerHTML =
    '<div style="color:#E05252;padding:8px;font-size:12px;">' +
    '<strong>Plugin Error:</strong> ' + _escapeHtml(err.message) + '</div>';
}
</script>
</body>
</html>`;
}

/** Extract current theme colors for plugin injection */
function getThemeColors() {
  return {
    bg: C.dark,
    surface: C.darkSurf,
    surfaceRaised: C.darkSurf2,
    border: C.darkBorder,
    text: C.darkText,
    muted: C.darkMuted,
    accent: C.accent,
    accentDim: C.accentDim,
  };
}

export default function PluginWidget({ functionId, width, height, refreshInterval }) {
  const [code, setCode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [funcName, setFuncName] = useState("");
  const iframeRef = useRef(null);
  const intervalRef = useRef(null);

  // Fetch the function's code from D1
  const loadFunction = useCallback(async () => {
    if (!functionId) {
      setError("No function selected");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const fn = await api.getCustomFunction(functionId);
      if (!fn?.code) {
        setError("Function has no code");
        setLoading(false);
        return;
      }
      setCode(fn.code);
      setFuncName(fn.name || functionId);
    } catch (err) {
      console.error("Failed to load plugin function:", err);
      setError(err.message || "Failed to load plugin");
    } finally {
      setLoading(false);
    }
  }, [functionId]);

  useEffect(() => {
    loadFunction();
  }, [loadFunction]);

  // Auto-refresh interval
  useEffect(() => {
    if (!refreshInterval || refreshInterval < 5) return;
    intervalRef.current = setInterval(() => {
      // Reload the iframe by re-fetching the function
      loadFunction();
    }, refreshInterval * 1000);
    return () => clearInterval(intervalRef.current);
  }, [refreshInterval, loadFunction]);

  // Listen for plugin-refresh messages from iframe
  useEffect(() => {
    const handleMessage = (e) => {
      if (e.data?.type === "plugin-refresh") {
        loadFunction();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [loadFunction]);

  // Push theme updates to iframe when C changes
  useEffect(() => {
    if (iframeRef.current?.contentWindow && code) {
      iframeRef.current.contentWindow.postMessage(
        { type: "theme-update", colors: getThemeColors() },
        "*"
      );
    }
  }, [code, C.accent, C.dark]);

  // Loading state
  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100%", gap: 8, color: C.darkMuted, fontFamily: FONT, fontSize: 11,
      }}>
        <div style={{
          width: 14, height: 14, border: `2px solid ${C.darkBorder}`,
          borderTopColor: C.accent, borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }} />
        Loading plugin...
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", height: "100%", gap: 8,
        padding: 12, textAlign: "center",
      }}>
        <IconWarning size={18} color="#E05252" />
        <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, lineHeight: 1.4 }}>
          {error}
        </span>
        <button
          onClick={loadFunction}
          style={{
            background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.md, padding: "3px 10px",
            fontSize: 10, fontFamily: FONT, color: C.darkMuted,
            cursor: "pointer", marginTop: 4,
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // No code
  if (!code) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100%", color: C.darkMuted, fontFamily: FONT, fontSize: 11,
      }}>
        <IconBolt size={14} color={C.darkBorder} style={{ marginRight: 6 }} />
        No plugin code
      </div>
    );
  }

  // Build sandboxed iframe
  const srcdoc = buildSrcdoc(code, getThemeColors());

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      sandbox="allow-scripts"
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        background: "transparent",
        display: "block",
      }}
      title={funcName || "Plugin Widget"}
    />
  );
}
