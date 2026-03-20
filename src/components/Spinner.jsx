// ─── SVG Spinner ───
// Clean arc spinner using the existing `spin` keyframe.
// Props: size (px), color (hex), strokeWidth.

import React from "react";
import { C } from "../design/tokens.js";

export default function Spinner({ size = 16, color, strokeWidth = 2 }) {
  const c = color || C.accent;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: "spin 1s linear infinite", display: "inline-block", flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="10" stroke={c} strokeWidth={strokeWidth} opacity="0.2" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke={c}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  );
}
