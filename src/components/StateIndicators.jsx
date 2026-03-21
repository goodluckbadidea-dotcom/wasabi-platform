// ─── State Indicators ───
// Reusable loading, empty, and error states for views.
// Uses design tokens for consistent styling.

import React from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";

// ── Skeleton Loader ──
// Animated placeholder rows while data loads.
export function SkeletonLoader({ rows = 5, style }) {
  return (
    <div style={{ padding: "16px 20px", ...style }}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{
            height: 14,
            borderRadius: RADIUS.sm,
            background: `linear-gradient(90deg, ${C.darkSurf2}, ${C.darkBorder}44, ${C.darkSurf2})`,
            backgroundSize: "200% 100%",
            animation: "wasabi-skeleton 1.4s ease-in-out infinite",
            marginBottom: 12,
            width: `${70 + Math.random() * 25}%`,
          }}
        />
      ))}
      <style>{`
        @keyframes wasabi-skeleton {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

// ── Empty State ──
// Centered message when there's no data to show.
export function EmptyState({ icon, message = "Nothing here yet", action, onAction, style }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        color: C.darkMuted,
        fontFamily: FONT,
        fontSize: 13,
        textAlign: "center",
        gap: 12,
        ...style,
      }}
    >
      {icon && <div style={{ opacity: 0.4, fontSize: 28 }}>{icon}</div>}
      <div style={{ maxWidth: 260, lineHeight: 1.5 }}>{message}</div>
      {action && onAction && (
        <button
          onClick={onAction}
          style={{
            background: C.accent,
            color: "#fff",
            border: "none",
            borderRadius: RADIUS.pill,
            padding: "8px 18px",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: FONT,
            cursor: "pointer",
            marginTop: 4,
          }}
        >
          {action}
        </button>
      )}
    </div>
  );
}

// ── Error State ──
// Error message with optional retry button.
export function ErrorState({ message = "Something went wrong", onRetry, style }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        fontFamily: FONT,
        fontSize: 13,
        textAlign: "center",
        gap: 12,
        ...style,
      }}
    >
      <div style={{ color: C.error, fontWeight: 500 }}>{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            background: C.darkSurf2,
            color: C.darkText,
            border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.pill,
            padding: "7px 16px",
            fontSize: 12,
            fontWeight: 500,
            fontFamily: FONT,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
