// ─── Reusable Side Drawer ───
// Slide-in panel from left or right. Used for detail views, settings, batch queue.

import React, { useEffect } from "react";
import { C, RADIUS } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { ANIM, injectAnimations } from "../design/animations.js";

export default function Drawer({
  open,
  onClose,
  title,
  children,
  side = "right", // "right" or "left"
  width = 480,
}) {
  useEffect(() => { injectAnimations(); }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        ...S.overlay,
        justifyContent: side === "right" ? "flex-end" : "flex-start",
        animation: ANIM.drawerFade,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          ...S.drawer,
          width,
          borderLeft: side === "right" ? `1px solid ${C.border}` : "none",
          borderRight: side === "left" ? `1px solid ${C.border}` : "none",
          animation: side === "right" ? ANIM.drawerSlide : ANIM.drawerSlideLeft,
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}>
          <h2 style={S.h2}>{title}</h2>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: C.muted,
              fontSize: 20,
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: RADIUS.md,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => { e.target.style.background = C.surface; }}
            onMouseLeave={(e) => { e.target.style.background = "transparent"; }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
