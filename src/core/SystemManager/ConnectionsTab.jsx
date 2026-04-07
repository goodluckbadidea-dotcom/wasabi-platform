import React, { useState, useCallback, useRef, useEffect } from "react";
import { C, FONT, MONO, RADIUS } from "../../design/tokens.js";
import { ANIM } from "../../design/animations.js";
import { usePlatform } from "../../context/PlatformContext.jsx";
import { getConnections, setConnection as apiSetConnection, deleteConnection as apiDeleteConnection, checkHealth, getGoogleAuthUrl, getGoogleStatus, disconnectGoogle, getMicrosoftAuthUrl, getMicrosoftStatus, disconnectMicrosoft } from "../../lib/api.js";
import ConnectionRow, { CONNECTION_DEFS } from "./components/ConnectionRow.jsx";
import GoogleConnectionRow from "./components/GoogleConnectionRow.jsx";
import MicrosoftConnectionRow from "./components/MicrosoftConnectionRow.jsx";

export default function ConnectionsTab() {
  const { user, workerConnection, updateConnectionKey } = usePlatform();

  // ── Connections state ──
  const [connections, setConnections] = useState([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const connectionsFetched = useRef(false);

  // ── Google OAuth state ──
  const [googleStatus, setGoogleStatus] = useState({ connected: false, email: "" });
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState("");

  // ── Microsoft OAuth state ──
  const [microsoftStatus, setMicrosoftStatus] = useState({ connected: false, email: "" });
  const [microsoftLoading, setMicrosoftLoading] = useState(false);
  const [microsoftError, setMicrosoftError] = useState("");

  // ── Worker health ──
  const [health, setHealth] = useState(null);

  // Load connections on mount
  useEffect(() => {
    if (connectionsFetched.current) return;
    connectionsFetched.current = true;
    setConnectionsLoading(true);
    Promise.all([
      getConnections().then((data) => setConnections(data.connections || [])),
      getGoogleStatus().then(setGoogleStatus).catch(err => console.warn("[ConnectionsTab] getGoogleStatus:", err.message || err)),
      getMicrosoftStatus().then(setMicrosoftStatus).catch(err => console.warn("[ConnectionsTab] getMicrosoftStatus:", err.message || err)),
    ])
      .catch((err) => console.warn("Failed to load connections:", err))
      .finally(() => setConnectionsLoading(false));
  }, []);

  // Load health
  useEffect(() => {
    checkHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  // Google OAuth: open popup and listen for result
  const handleGoogleConnect = useCallback(async () => {
    setGoogleLoading(true);
    setGoogleError("");
    try {
      const result = await getGoogleAuthUrl();
      if (!result?.url) {
        throw new Error(result?._error || "No auth URL returned — check Google OAuth configuration");
      }
      const popup = window.open(result.url, "google-auth", "width=500,height=700,left=200,top=100");

      if (!popup) {
        setGoogleError("Popup blocked — allow popups for this site and try again");
        setGoogleLoading(false);
        return;
      }

      // Listen for postMessage from callback page
      const onMessage = (e) => {
        if (e.data?.type?.startsWith("google-oauth-")) {
          window.removeEventListener("message", onMessage);
          if (e.data.type === "google-oauth-error") {
            setGoogleError(e.data.detail || "OAuth failed");
          }
          // Refresh status
          getGoogleStatus().then(setGoogleStatus).catch(err => console.warn("[ConnectionsTab] getGoogleStatus:", err.message || err));
          setGoogleLoading(false);
        }
      };
      window.addEventListener("message", onMessage);

      // Fallback: poll if popup closes without message
      const pollId = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollId);
          window.removeEventListener("message", onMessage);
          getGoogleStatus().then(setGoogleStatus).catch(err => console.warn("[ConnectionsTab] getGoogleStatus:", err.message || err));
          setGoogleLoading(false);
        }
      }, 1000);
    } catch (err) {
      console.error("Google OAuth failed:", err);
      const msg = err.message || "Connection failed";
      if (msg.includes("CLIENT_ID") || msg.includes("not configured")) {
        setGoogleError("Google OAuth not configured on the worker. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET secrets.");
      } else {
        setGoogleError(msg);
      }
      setGoogleLoading(false);
    }
  }, []);

  const handleGoogleDisconnect = useCallback(async () => {
    setGoogleLoading(true);
    try {
      await disconnectGoogle();
      setGoogleStatus({ connected: false, email: "" });
    } catch (err) {
      console.error("Google disconnect failed:", err);
    } finally {
      setGoogleLoading(false);
    }
  }, []);

  const handleMicrosoftConnect = useCallback(async () => {
    setMicrosoftLoading(true);
    setMicrosoftError("");
    try {
      const result = await getMicrosoftAuthUrl("link");
      if (!result?.url) {
        throw new Error(result?._error || "No auth URL returned — check Microsoft OAuth configuration");
      }
      const popup = window.open(result.url, "microsoft-auth", "width=500,height=700,left=200,top=100");
      if (!popup) {
        setMicrosoftError("Popup blocked — allow popups for this site and try again");
        setMicrosoftLoading(false);
        return;
      }
      const onMessage = (e) => {
        if (e.data?.type?.startsWith("microsoft-oauth-")) {
          window.removeEventListener("message", onMessage);
          if (e.data.type === "microsoft-oauth-error") {
            setMicrosoftError(e.data.detail || "OAuth failed");
          }
          getMicrosoftStatus().then(setMicrosoftStatus).catch(() => {});
          setMicrosoftLoading(false);
        }
      };
      window.addEventListener("message", onMessage);
      const pollId = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollId);
          window.removeEventListener("message", onMessage);
          getMicrosoftStatus().then(setMicrosoftStatus).catch(() => {});
          setMicrosoftLoading(false);
        }
      }, 1000);
    } catch (err) {
      setMicrosoftError(err.message || "Connection failed");
      setMicrosoftLoading(false);
    }
  }, []);

  const handleMicrosoftDisconnect = useCallback(async () => {
    setMicrosoftLoading(true);
    try {
      await disconnectMicrosoft();
      setMicrosoftStatus({ connected: false, email: "" });
    } catch (err) {
      console.error("Microsoft disconnect failed:", err);
    } finally {
      setMicrosoftLoading(false);
    }
  }, []);

  const handleSaveConnection = useCallback(async (key, value, metadata) => {
    await apiSetConnection(key, value, metadata);
    // Update local state
    setConnections((prev) => {
      const existing = prev.findIndex((c) => c.key === key);
      const entry = { key, metadata, connected: true, updated_at: new Date().toISOString() };
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = entry;
        return updated;
      }
      return [...prev, entry];
    });
    // Update legacy user keys in PlatformContext
    updateConnectionKey(key, value);
  }, [updateConnectionKey]);

  const handleDeleteConnection = useCallback(async (key) => {
    await apiDeleteConnection(key);
    setConnections((prev) => prev.filter((c) => c.key !== key));
    updateConnectionKey(key, "");
  }, [updateConnectionKey]);

  return (
    <div style={{ padding: "24px 32px" }}>
      {/* Worker status */}
      <div style={{
        background: C.darkSurf,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg,
        padding: "14px 16px",
        marginBottom: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
            background: health?.ok ? C.accent : C.warning,
          }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: C.darkText, fontFamily: FONT }}>
            Worker
          </span>
          <span style={{ fontSize: 10, color: health?.ok ? C.accent : C.warning, fontFamily: FONT }}>
            {health?.ok ? "Healthy" : "Unreachable"}
          </span>
        </div>
        {workerConnection?.workerUrl && (
          <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: MONO, marginLeft: 18, wordBreak: "break-all" }}>
            {workerConnection.workerUrl}
          </div>
        )}
        {health && (
          <div style={{ display: "flex", gap: 8, marginTop: 8, marginLeft: 18, flexWrap: "wrap" }}>
            {[
              { label: "D1", ok: health.d1 },
              { label: "R2", ok: health.r2 },
            ].map((svc) => (
              <span key={svc.label} style={{
                fontSize: 9, fontFamily: MONO, padding: "2px 8px",
                borderRadius: RADIUS.sm, border: `1px solid ${C.darkBorder}`,
                background: svc.ok ? C.accent + "18" : C.darkSurf2,
                color: svc.ok ? C.accent : C.darkMuted,
              }}>
                {svc.label}: {svc.ok ? "OK" : "off"}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Section label */}
      <div style={{
        fontSize: 10, color: C.darkMuted, fontFamily: FONT,
        textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12,
      }}>
        Integrations
      </div>

      {connectionsLoading ? (
        <div style={{ color: C.darkMuted, fontSize: 12, textAlign: "center", padding: 20 }}>
          Loading connections...
        </div>
      ) : (
        <>
          {CONNECTION_DEFS.map((def) => (
            <ConnectionRow
              key={def.key}
              def={def}
              connected={connections.some((c) => c.key === def.key)}
              onSave={handleSaveConnection}
              onDelete={handleDeleteConnection}
            />
          ))}
          <GoogleConnectionRow
            connected={googleStatus.connected}
            email={googleStatus.email}
            onConnect={handleGoogleConnect}
            onDisconnect={handleGoogleDisconnect}
            loading={googleLoading}
            error={googleError}
          />
          <MicrosoftConnectionRow
            connected={microsoftStatus.connected}
            email={microsoftStatus.email}
            onConnect={handleMicrosoftConnect}
            onDisconnect={handleMicrosoftDisconnect}
            loading={microsoftLoading}
            error={microsoftError}
          />
        </>
      )}
    </div>
  );
}
