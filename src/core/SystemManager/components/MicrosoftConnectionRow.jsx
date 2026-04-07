import React from "react";
import { C, FONT, RADIUS } from "../../../design/tokens.js";

function MicrosoftConnectionRow({ connected, email, onConnect, onDisconnect, loading, error }) {
  return (
    <div style={{
      background: C.darkSurf,
      border: `1px solid ${connected ? C.accent + "33" : error ? C.error + "33" : C.darkBorder}`,
      borderRadius: RADIUS.lg,
      padding: "14px 16px",
      marginBottom: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: connected ? C.accent : C.darkMuted + "44",
        }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: C.darkText, fontFamily: FONT }}>
          Microsoft
        </span>
        <span style={{ flex: 1, fontSize: 10, color: C.darkMuted, fontFamily: FONT }}>
          Outlook + Calendar
        </span>
        <span style={{ fontSize: 10, color: connected ? C.accent : C.darkMuted, fontFamily: FONT }}>
          {connected ? `Connected as ${email}` : "Not connected"}
        </span>
        {connected ? (
          <button
            onClick={onDisconnect}
            disabled={loading}
            style={{
              background: "transparent", border: `1px solid #FF480044`, borderRadius: RADIUS.sm,
              color: C.warning, fontFamily: FONT, fontSize: 11, padding: "3px 10px",
              cursor: loading ? "default" : "pointer", opacity: loading ? 0.5 : 1,
            }}
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={onConnect}
            disabled={loading}
            style={{
              background: C.accent, border: "none", borderRadius: RADIUS.sm,
              color: "#fff", fontFamily: FONT, fontSize: 11, fontWeight: 600,
              padding: "4px 14px", cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? "..." : "Connect with Microsoft"}
          </button>
        )}
      </div>
      <p style={{ fontSize: 11, color: C.darkMuted, marginTop: 6, marginLeft: 18, lineHeight: 1.4 }}>
        {connected
          ? "Outlook inbox, calendar events, and Microsoft account access for Wasabi."
          : "Connect your Microsoft account to access Outlook, Calendar, and more through Wasabi."}
      </p>
      {error && (
        <div style={{
          fontSize: 11, color: C.error, marginTop: 8, marginLeft: 18,
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

export default MicrosoftConnectionRow;
