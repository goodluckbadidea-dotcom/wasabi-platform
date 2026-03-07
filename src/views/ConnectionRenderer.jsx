// ─── Connection Renderer ───
// Renders SVG bezier curves between node ports.
// Also renders a draft connection while the user is drawing a new wire.

import React from "react";
import { C } from "../design/tokens.js";

/**
 * Compute a cubic bezier path string between two points.
 * Uses horizontal control points for a natural left-to-right flow.
 */
export function getBezierPath(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1);
  const cp = Math.max(dx * 0.5, 50);
  return `M ${x1} ${y1} C ${x1 + cp} ${y1}, ${x2 - cp} ${y2}, ${x2} ${y2}`;
}

/**
 * Render a connection wire between two ports.
 */
export function ConnectionLine({ fromPos, toPos, isActive, executionState, onDelete }) {
  if (!fromPos || !toPos) return null;

  const path = getBezierPath(fromPos.x, fromPos.y, toPos.x, toPos.y);

  const color = executionState === "success" ? "#7DC143"
    : executionState === "error" ? "#E05252"
    : executionState === "running" ? C.accent
    : isActive ? C.accent
    : C.darkBorder;

  const isRunning = executionState === "running";

  return (
    <g style={{ cursor: "pointer" }}>
      {/* Wide invisible hit area for click/hover */}
      <path
        d={path}
        stroke="transparent"
        strokeWidth={14}
        fill="none"
        onClick={onDelete}
      />
      {/* Visible wire */}
      <path
        d={path}
        stroke={color}
        strokeWidth={2}
        fill="none"
        strokeDasharray={isRunning ? "6 4" : "none"}
        style={isRunning ? { animation: "dashFlow 0.6s linear infinite" } : {}}
      />
      {/* Arrow indicator at midpoint */}
      {!isRunning && (
        <circle
          cx={(fromPos.x + toPos.x) / 2}
          cy={(fromPos.y + toPos.y) / 2}
          r={3}
          fill={color}
        />
      )}
    </g>
  );
}

/**
 * Render a temporary draft connection following the mouse cursor.
 */
export function DraftConnection({ fromPos, mousePos }) {
  if (!fromPos || !mousePos) return null;

  const path = getBezierPath(fromPos.x, fromPos.y, mousePos.x, mousePos.y);

  return (
    <path
      d={path}
      stroke={C.accent}
      strokeWidth={2}
      fill="none"
      strokeDasharray="6 4"
      opacity={0.6}
      pointerEvents="none"
    />
  );
}
