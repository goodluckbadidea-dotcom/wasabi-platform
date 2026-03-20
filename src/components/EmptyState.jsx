// ─── Empty State ───
// Shared empty state with subdued WasabiFlame, title, description, optional action.

import React from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import WasabiFlame from "../core/WasabiFlame.jsx";

export default function EmptyState({ title, description, action, onAction }) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: 48,
      gap: 16,
      textAlign: "center",
      animation: ANIM.fadeUp(0.1),
    }}>
      <div style={{ opacity: 0.35 }}>
        <WasabiFlame size={40} energy={0.05} />
      </div>
      {title && (
        <div style={{
          fontSize: 15,
          fontWeight: 600,
          color: C.darkText,
          letterSpacing: "-0.01em",
          fontFamily: FONT,
        }}>
          {title}
        </div>
      )}
      {description && (
        <div style={{
          fontSize: 13,
          color: C.darkMuted,
          lineHeight: 1.5,
          maxWidth: 320,
          fontFamily: FONT,
        }}>
          {description}
        </div>
      )}
      {action && onAction && (
        <button onClick={onAction} style={{
          background: C.accent + "14",
          color: C.accent,
          border: `1px solid ${C.accent}44`,
          borderRadius: RADIUS.pill,
          padding: "8px 18px",
          fontSize: 13,
          fontWeight: 600,
          fontFamily: FONT,
          cursor: "pointer",
          marginTop: 4,
          transition: "background 0.15s",
        }}>
          {action}
        </button>
      )}
    </div>
  );
}
