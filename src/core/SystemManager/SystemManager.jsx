// ─── SystemManager ───
// Tab-based system management interface: Overview, Connections, Settings, Users, Audit Log.
// Each tab is a self-contained component in its own file.

import React, { useState } from "react";
import { C, FONT, RADIUS } from "../../design/tokens.js";
import { ANIM } from "../../design/animations.js";
import { usePlatform } from "../../context/PlatformContext.jsx";
import { IconGear } from "../../design/icons.jsx";
import { isAdmin } from "../../lib/roles.js";

import OverviewTab from "./OverviewTab.jsx";
import ConnectionsTab from "./ConnectionsTab.jsx";
import SettingsTab from "./SettingsTab.jsx";
import UsersTab from "./UsersTab.jsx";
import AuditLogTab from "./AuditLogTab.jsx";

// ── Tab button style (matches WasabiPanel) ──
const tabBtn = (active) => ({
  padding: "6px 18px",
  border: "none",
  cursor: "pointer",
  fontFamily: FONT,
  fontSize: 12,
  fontWeight: active ? 600 : 400,
  background: active ? `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)` : "transparent",
  color: active ? "#fff" : C.darkMuted,
  borderRadius: RADIUS.lg,
  transition: "background 0.14s, color 0.14s",
  outline: "none",
  whiteSpace: "nowrap",
});

export default function SystemManager() {
  const { identity } = usePlatform();

  // ── Tab state ──
  const [tab, setTab] = useState("overview");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: C.dark,
        fontFamily: FONT,
        overflow: "hidden",
      }}
    >
      {/* ── Tab bar ── */}
      <div
        style={{
          flexShrink: 0,
          padding: "16px 32px 0",
          borderBottom: `1px solid ${C.darkBorder}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
            animation: ANIM.snapUp(0.03),
          }}
        >
          <IconGear size={22} color={C.accent} />
          <span
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: C.darkText,
              fontFamily: FONT,
            }}
          >
            System
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: 3,
            marginBottom: 12,
            background: C.darkSurf,
            borderRadius: RADIUS.lg,
            padding: 3,
            width: "fit-content",
          }}
        >
          <button style={tabBtn(tab === "overview")} onClick={() => setTab("overview")}>
            Overview
          </button>
          <button style={tabBtn(tab === "connections")} onClick={() => setTab("connections")}>
            Connections
          </button>
          <button style={tabBtn(tab === "settings")} onClick={() => setTab("settings")}>
            Settings
          </button>
          {isAdmin(identity) && (
            <button style={tabBtn(tab === "users")} onClick={() => setTab("users")}>
              Users
            </button>
          )}
          {isAdmin(identity) && (
            <button style={tabBtn(tab === "audit")} onClick={() => setTab("audit")}>
              Audit Log
            </button>
          )}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          minHeight: 0,
        }}
      >
        {tab === "overview" && <OverviewTab />}
        {tab === "connections" && <ConnectionsTab />}
        {tab === "settings" && <SettingsTab />}
        {tab === "users" && isAdmin(identity) && <UsersTab identity={identity} />}
        {tab === "audit" && isAdmin(identity) && <AuditLogTab />}
      </div>
    </div>
  );
}
