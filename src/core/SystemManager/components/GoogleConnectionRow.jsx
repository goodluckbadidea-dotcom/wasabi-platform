import React from "react";
import { C, FONT, RADIUS } from "../../../design/tokens.js";

// Per-feature grants the user can opt in to. Each maps to a scope group
// in worker/handlers/google.js. Order = display order in the UI.
const GRANTS = [
  { id: "gmail",    label: "Gmail",          desc: "Read, send, and manage your inbox." },
  { id: "calendar", label: "Calendar",       desc: "Read and create events on your calendars." },
  { id: "sheets",   label: "Sheets (read)",  desc: "Read shared Google Sheets — required for the Linked Sheet feature." },
];

function GoogleConnectionRow({
  connected,
  email,
  grants = [],
  onConnect,
  onDisconnect,
  loading,           // null | "all" | grant id (e.g. "sheets") — indicates which row is busy
  error,
}) {
  const grantSet = new Set(grants);
  const anyConnected = connected && grantSet.size > 0;

  return (
    <div style={{
      background: C.darkSurf,
      border: `1px solid ${anyConnected ? C.accent + "33" : error ? C.error + "33" : C.darkBorder}`,
      borderRadius: RADIUS.lg,
      padding: "14px 16px",
      marginBottom: 10,
    }}>
      {/* Header: Google + email + disconnect-all */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: anyConnected ? 12 : 6 }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: anyConnected ? C.accent : C.darkMuted + "44",
        }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: C.darkText, fontFamily: FONT }}>
          Google
        </span>
        <span style={{ flex: 1, fontSize: 10, color: C.darkMuted, fontFamily: FONT }}>
          {anyConnected ? `Connected as ${email}` : "Pick which Google features to connect."}
        </span>
        {anyConnected && (
          <button
            onClick={() => onDisconnect()}
            disabled={loading === "all"}
            style={{
              background: "transparent", border: `1px solid #FF480044`, borderRadius: RADIUS.sm,
              color: C.warning, fontFamily: FONT, fontSize: 11, padding: "3px 10px",
              cursor: loading === "all" ? "default" : "pointer",
              opacity: loading === "all" ? 0.5 : 1,
            }}
          >
            {loading === "all" ? "..." : "Disconnect all"}
          </button>
        )}
      </div>

      {/* Per-grant rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginLeft: 18 }}>
        {GRANTS.map((g) => {
          const granted = grantSet.has(g.id);
          const busy = loading === g.id;
          return (
            <div key={g.id} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 10px",
              background: granted ? C.accent + "0E" : "transparent",
              border: `1px solid ${granted ? C.accent + "22" : C.darkBorder}`,
              borderRadius: RADIUS.sm,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                background: granted ? C.accent : C.darkMuted + "44",
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: C.darkText, fontFamily: FONT }}>
                  {g.label}
                </div>
                <div style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT, marginTop: 1 }}>
                  {g.desc}
                </div>
              </div>
              <span style={{ fontSize: 10, color: granted ? C.accent : C.darkMuted, fontFamily: FONT }}>
                {granted ? "Granted" : "Not granted"}
              </span>
              {granted ? (
                <button
                  onClick={() => onDisconnect(g.id)}
                  disabled={busy}
                  style={{
                    background: "transparent", border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.sm,
                    color: C.darkText, fontFamily: FONT, fontSize: 10, padding: "3px 10px",
                    cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1,
                  }}
                >
                  {busy ? "..." : "Revoke"}
                </button>
              ) : (
                <button
                  onClick={() => onConnect([g.id])}
                  disabled={busy}
                  style={{
                    background: C.accent, border: "none", borderRadius: RADIUS.sm,
                    color: "#fff", fontFamily: FONT, fontSize: 10, fontWeight: 600,
                    padding: "4px 12px", cursor: busy ? "default" : "pointer",
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  {busy ? "..." : "Connect"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div style={{
          fontSize: 11, color: C.error, marginTop: 10, marginLeft: 18,
          lineHeight: 1.4, padding: "6px 10px",
          background: C.error + "10", borderRadius: RADIUS.sm,
          border: `1px solid ${C.error}22`,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default GoogleConnectionRow;
