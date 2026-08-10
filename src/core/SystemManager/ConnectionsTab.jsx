import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { C, FONT, MONO, RADIUS } from "../../design/tokens.js";
import { ANIM } from "../../design/animations.js";
import { usePlatform } from "../../context/PlatformContext.jsx";
import { getConnections, setConnection as apiSetConnection, deleteConnection as apiDeleteConnection, checkHealth, getGoogleAuthUrl, getGoogleStatus, disconnectGoogle, getFigmaStatus } from "../../lib/api.js";
import ConnectionRow, { CONNECTION_DEFS } from "./components/ConnectionRow.jsx";
import GoogleConnectionRow from "./components/GoogleConnectionRow.jsx";

export default function ConnectionsTab() {
  const { user, workerConnection, updateConnectionKey } = usePlatform();

  // ── Connections state ──
  const [connections, setConnections] = useState([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const connectionsFetched = useRef(false);

  // ── Google OAuth state ──
  // googleStatus = { connected, email, grants: ["gmail", "calendar", ...] }
  // googleLoading = null | "all" | grant id (e.g. "sheets") for per-row spinners
  const [googleStatus, setGoogleStatus] = useState({ connected: false, email: "", grants: [] });
  const [googleLoading, setGoogleLoading] = useState(null);
  const [googleError, setGoogleError] = useState("");

  // ── Worker health ──
  const [health, setHealth] = useState(null);

  // ── Figma live token check ──
  // The connections list only proves a row exists in D1, not that the stored
  // token still works. /figma/status actually calls Figma's /v1/me, so an
  // expired or revoked PAT surfaces here instead of silently hiding the Figma
  // features elsewhere in the app.
  // figmaStatus = { state: "checking" | "ok" | "error", handle?, error? }
  const [figmaStatus, setFigmaStatus] = useState({ state: "checking" });

  const refreshFigmaStatus = useCallback(() => {
    setFigmaStatus({ state: "checking" });
    return getFigmaStatus()
      .then((r) => setFigmaStatus(
        r?.connected
          ? { state: "ok", handle: r?.user?.handle || "" }
          : { state: "error", error: r?.error || "" }
      ))
      .catch((err) => {
        console.warn("[ConnectionsTab] getFigmaStatus:", err.message || err);
        setFigmaStatus({ state: "error", error: err.message || "" });
      });
  }, []);

  // Load connections on mount
  useEffect(() => {
    if (connectionsFetched.current) return;
    connectionsFetched.current = true;
    setConnectionsLoading(true);
    Promise.all([
      getConnections().then((data) => setConnections(data.connections || [])),
      getGoogleStatus().then(setGoogleStatus).catch(err => console.warn("[ConnectionsTab] getGoogleStatus:", err.message || err)),
      refreshFigmaStatus(),
    ])
      .catch((err) => console.warn("Failed to load connections:", err))
      .finally(() => setConnectionsLoading(false));
  }, [refreshFigmaStatus]);

  // Load health
  useEffect(() => {
    checkHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  // Google OAuth: open popup and listen for result.
  // grants: array of grant ids to request (e.g. ["sheets"]). The popup row id
  // is used as the loading indicator key so only that row spins.
  const handleGoogleConnect = useCallback(async (grants) => {
    const requested = Array.isArray(grants) && grants.length ? grants : ["gmail", "calendar"];
    const loadingKey = requested.length === 1 ? requested[0] : "all";
    setGoogleLoading(loadingKey);
    setGoogleError("");
    try {
      const result = await getGoogleAuthUrl(requested);
      if (!result?.url) {
        throw new Error(result?._error || "No auth URL returned — check Google OAuth configuration");
      }
      const popup = window.open(result.url, "google-auth", "width=500,height=700,left=200,top=100");

      if (!popup) {
        setGoogleError("Popup blocked — allow popups for this site and try again");
        setGoogleLoading(null);
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
          setGoogleLoading(null);
        }
      };
      window.addEventListener("message", onMessage);

      // Fallback: poll if popup closes without message
      const pollId = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollId);
          window.removeEventListener("message", onMessage);
          getGoogleStatus().then(setGoogleStatus).catch(err => console.warn("[ConnectionsTab] getGoogleStatus:", err.message || err));
          setGoogleLoading(null);
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
      setGoogleLoading(null);
    }
  }, []);

  // grant: optional single grant id to revoke. Omit to disconnect everything.
  const handleGoogleDisconnect = useCallback(async (grant) => {
    setGoogleLoading(grant || "all");
    try {
      const res = await disconnectGoogle(grant);
      // Worker returns updated grants array; refresh status to keep UI in sync.
      const updatedGrants = Array.isArray(res?.grants) ? res.grants : [];
      if (updatedGrants.length === 0) {
        setGoogleStatus({ connected: false, email: "", grants: [] });
      } else {
        // Some grants remain — re-fetch full status (preserves email).
        getGoogleStatus().then(setGoogleStatus).catch(() => {});
      }
    } catch (err) {
      console.error("Google disconnect failed:", err);
    } finally {
      setGoogleLoading(null);
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
    // Re-validate immediately so a freshly pasted token confirms itself.
    if (key === "figma") refreshFigmaStatus();
  }, [updateConnectionKey, refreshFigmaStatus]);

  // Presentation shape for the Figma row's live badge.
  const figmaLive = useMemo(() => {
    if (figmaStatus.state === "checking") {
      return { state: "checking", label: "Checking..." };
    }
    if (figmaStatus.state === "ok") {
      return {
        state: "ok",
        label: figmaStatus.handle ? `Connected as ${figmaStatus.handle}` : "Connected",
      };
    }
    return {
      state: "error",
      label: "Token rejected",
      detail: `Figma rejected this token${figmaStatus.error ? ` (${figmaStatus.error})` : ""}. Generate a new personal access token with the current_user:read, projects:read, file_content:read, file_comments:read and file_comments:write scopes, then click Update. Figma features stay hidden across the app until this is fixed.`,
    };
  }, [figmaStatus]);

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
          {CONNECTION_DEFS.map((def) => {
            const rowExists = connections.some((c) => c.key === def.key);
            return (
              <ConnectionRow
                key={def.key}
                def={def}
                connected={rowExists}
                // Only the Figma PAT has a live check today. Every other row
                // keeps its existing row-exists behaviour.
                liveStatus={def.key === "figma" && rowExists ? figmaLive : null}
                onSave={handleSaveConnection}
                onDelete={handleDeleteConnection}
              />
            );
          })}
          <GoogleConnectionRow
            connected={googleStatus.connected}
            email={googleStatus.email}
            grants={googleStatus.grants || []}
            onConnect={handleGoogleConnect}
            onDisconnect={handleGoogleDisconnect}
            loading={googleLoading}
            error={googleError}
          />
        </>
      )}
    </div>
  );
}
