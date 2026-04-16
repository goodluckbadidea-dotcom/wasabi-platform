// ─── Owner Avatars ───
// Shared icon-only avatar circles for owner display across all views.
// Renders a row of circular initials with tooltip on hover.

import React from "react";
import { C } from "../design/tokens.js";

export default function OwnerAvatars({ ownerIds, users, size = 20, onClick }) {
  if (!ownerIds || ownerIds.length === 0) return null;

  const userMap = {};
  (users || []).forEach((u) => { userMap[u.id] = u; });

  const fontSize = Math.round(size * 0.45);

  return (
    <div
      onClick={onClick}
      style={{
        display: "inline-flex",
        gap: 3,
        alignItems: "center",
        cursor: onClick ? "pointer" : "default",
        flexShrink: 0,
      }}
    >
      {ownerIds.map((uid) => {
        const u = userMap[uid];
        const name = u?.display_name || uid.slice(0, 8);
        const initial = name.charAt(0).toUpperCase();
        return (
          <span
            key={uid}
            title={name}
            style={{
              width: size,
              height: size,
              borderRadius: "50%",
              background: `linear-gradient(135deg, ${C.accent}, ${C.accent}88)`,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize,
              fontWeight: 700,
              color: "#fff",
              flexShrink: 0,
            }}
          >
            {initial}
          </span>
        );
      })}
    </div>
  );
}
