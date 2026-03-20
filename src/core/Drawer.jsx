// ─── Reusable Side Drawer ───
// Slide-in panel from left or right. Used for detail views, settings, log.
// Supports exit animation: plays slide-out before unmounting.

import React, { useEffect, useState, useRef } from "react";
import { C, RADIUS } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { ANIM, injectAnimations } from "../design/animations.js";

const EXIT_DURATION = 200; // ms — matches slideOut CSS duration

export default function Drawer({
  open,
  onClose,
  title,
  children,
  side = "right", // "right" or "left"
  width = 480,
}) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => { injectAnimations(); }, []);

  useEffect(() => {
    if (open) {
      setVisible(true);
      setClosing(false);
      clearTimeout(timerRef.current);
    } else if (visible) {
      // Start exit animation
      setClosing(true);
      timerRef.current = setTimeout(() => {
        setVisible(false);
        setClosing(false);
      }, EXIT_DURATION);
    }
    return () => clearTimeout(timerRef.current);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!visible || closing) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, closing, onClose]);

  if (!visible) return null;

  const overlayAnim = closing ? ANIM.backdropFadeOut : ANIM.drawerFade;
  const panelAnim = closing
    ? (side === "right" ? ANIM.slideOutRight : ANIM.slideOutLeft)
    : (side === "right" ? ANIM.drawerSlide : ANIM.drawerSlideLeft);

  return (
    <div
      style={{
        ...S.overlay,
        justifyContent: side === "right" ? "flex-end" : "flex-start",
        animation: overlayAnim,
      }}
      onClick={(e) => {
        if (!closing && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          ...S.drawer,
          width,
          borderLeft: side === "right" ? `1px solid ${C.edgeLine}` : "none",
          borderRight: side === "left" ? `1px solid ${C.edgeLine}` : "none",
          animation: panelAnim,
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: `1px solid ${C.edgeLine}`,
          flexShrink: 0,
        }}>
          <h2 style={S.h2}>{title}</h2>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: C.darkMuted,
              fontSize: 20,
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: RADIUS.md,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => { e.target.style.background = C.darkSurf2; }}
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
