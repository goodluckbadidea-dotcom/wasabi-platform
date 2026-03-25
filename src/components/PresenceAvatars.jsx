// ─── Presence Avatars ───
// Overlapping circular avatars showing active collaborators.
// Renders user initials with deterministic color, typing pulse, and overflow pill.

import React from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";

const PULSE_KEYFRAMES = `
@keyframes presence-pulse {
  0%, 100% { box-shadow: 0 0 0 0 currentColor; }
  50% { box-shadow: 0 0 0 3px currentColor; }
}`;

let styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement("style");
  style.textContent = PULSE_KEYFRAMES;
  document.head.appendChild(style);
}

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts.length ? parts[0][0].toUpperCase() : "?";
}

export default function PresenceAvatars({ users = [], size = 28, maxVisible = 4 }) {
  if (users.length === 0) return null;
  injectStyles();

  const visible = users.slice(0, maxVisible);
  const overflow = users.length - maxVisible;

  return (
    <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
      {visible.map((user, i) => (
        <div
          key={user.userId || `anon-${i}`}
          title={`${user.userName || "User"}${user.isTyping ? ` — typing ${user.typingField || ""}` : ""}`}
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            background: user.color || C.accent,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: size * 0.42,
            fontWeight: 600,
            fontFamily: FONT,
            marginLeft: i > 0 ? -size * 0.28 : 0,
            border: `2px solid ${C.dark}`,
            position: "relative",
            zIndex: maxVisible - i,
            flexShrink: 0,
            ...(user.isTyping ? {
              animation: "presence-pulse 1.5s ease-in-out infinite",
              color: user.color || C.accent,
            } : {}),
          }}
        >
          {getInitials(user.userName)}
          {user.isTyping && (
            <div style={{
              position: "absolute",
              bottom: -2,
              right: -2,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: C.success,
              border: `1.5px solid ${C.dark}`,
            }} />
          )}
        </div>
      ))}
      {overflow > 0 && (
        <div
          style={{
            height: size,
            paddingInline: 6,
            borderRadius: size / 2,
            background: C.darkSurf2 || C.darkBorder,
            color: C.darkMuted,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: size * 0.38,
            fontWeight: 600,
            fontFamily: FONT,
            marginLeft: -size * 0.2,
            border: `2px solid ${C.dark}`,
            zIndex: 0,
          }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
