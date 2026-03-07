// ─── Node Renderer ───
// Renders a single node as an SVG group with header, body, ports, and execution glow.
// Each node type has a distinct color and layout.

import React from "react";
import { C, FONT } from "../design/tokens.js";

// ── Constants ──

export const NODE_WIDTH = 220;
const NODE_HEADER_H = 30;
const NODE_BODY_MIN_H = 42;
const PORT_RADIUS = 6;
const PORT_SPACING = 24;
const PORT_START_Y = NODE_HEADER_H + 20;
const BODY_PADDING = 10;

export const NODE_TYPE_COLORS = {
  trigger:   "#1C5C8A",
  condition: "#FF6B35",
  action:    "#7DC143",
  transform: "#8B6FBE",
  wasabi:    "#F5B724",
};

const SUBTYPE_LABELS = {
  database_change: "DB Change",
  status_change: "Status Change",
  field_change: "Field Change",
  page_created: "Page Created",
  schedule: "Schedule",
  manual: "Manual Run",
  field_check: "If / Then",
  update_page: "Update Page",
  create_page: "Create Page",
  post_notification: "Notify",
  template: "Template",
  prompt: "Wasabi AI",
};

// ── Helpers ──

/**
 * Get a human-readable config summary (1 line) for display inside the node body.
 */
function getConfigSummary(node) {
  const c = node.config || {};
  switch (node.subtype) {
    case "database_change":
    case "status_change":
      return c.field ? `${c.field} → ${c.to || "any"}` : "Configure trigger...";
    case "field_change":
      return c.field ? `${c.field} = ${c.value || "any"}` : "Configure trigger...";
    case "page_created":
      return c.filter_field ? `${c.filter_field}: ${c.filter_value}` : "Any new page";
    case "schedule":
      return c.interval_minutes ? `Every ${c.interval_minutes}m` : "Set interval...";
    case "manual":
      return "Click ▶ to run";
    case "field_check":
      return c.field ? `${c.field} ${c.operator || "="} ${c.value || "?"}` : "Set condition...";
    case "update_page":
      return c.description || "Update properties...";
    case "create_page":
      return c.databaseId ? `DB: ${c.databaseId.slice(0, 8)}...` : "Set target DB...";
    case "post_notification":
      return c.message ? c.message.slice(0, 28) + (c.message.length > 28 ? "..." : "") : "Set message...";
    case "template":
      return c.template ? c.template.slice(0, 28) + (c.template.length > 28 ? "..." : "") : "Set template...";
    case "prompt":
      return c.prompt ? c.prompt.slice(0, 28) + (c.prompt.length > 28 ? "..." : "") : "Write prompt...";
    default:
      return "";
  }
}

/**
 * Calculate the node body height based on the number of ports.
 */
function getNodeBodyHeight(node) {
  const inCount = node.ports?.in?.length || 0;
  const outCount = node.ports?.out?.length || 0;
  const maxPorts = Math.max(inCount, outCount, 1);
  return Math.max(NODE_BODY_MIN_H, maxPorts * PORT_SPACING + BODY_PADDING * 2);
}

/**
 * Get total node height.
 */
export function getNodeHeight(node) {
  return NODE_HEADER_H + getNodeBodyHeight(node);
}

/**
 * Get the absolute canvas position of a specific port on a node.
 */
export function getPortPosition(node, portId) {
  // Check input ports
  const inIdx = (node.ports?.in || []).findIndex((p) => p.id === portId);
  if (inIdx >= 0) {
    return {
      x: node.x,
      y: node.y + PORT_START_Y + inIdx * PORT_SPACING,
    };
  }
  // Check output ports
  const outIdx = (node.ports?.out || []).findIndex((p) => p.id === portId);
  if (outIdx >= 0) {
    return {
      x: node.x + NODE_WIDTH,
      y: node.y + PORT_START_Y + outIdx * PORT_SPACING,
    };
  }
  // Fallback center
  return { x: node.x + NODE_WIDTH / 2, y: node.y + getNodeHeight(node) / 2 };
}

// ── Component ──

export default function NodeRenderer({
  node,
  isSelected,
  executionState,
  onMouseDown,
  onPortMouseDown,
  onPortMouseUp,
}) {
  const typeColor = NODE_TYPE_COLORS[node.type] || C.darkMuted;
  const bodyH = getNodeBodyHeight(node);
  const totalH = NODE_HEADER_H + bodyH;
  const summary = getConfigSummary(node);

  // Execution glow
  const glowColor = executionState === "running" ? C.accent
    : executionState === "success" ? "#7DC143"
    : executionState === "error" ? "#E05252"
    : null;

  return (
    <g transform={`translate(${node.x}, ${node.y})`}>
      {/* Execution glow outline */}
      {glowColor && (
        <rect
          x={-4}
          y={-4}
          width={NODE_WIDTH + 8}
          height={totalH + 8}
          rx={12}
          fill="none"
          stroke={glowColor}
          strokeWidth={3}
          opacity={executionState === "running" ? undefined : 0.8}
          style={executionState === "running" ? { animation: "nodeGlow 1.5s ease-in-out infinite" } : {}}
        />
      )}

      {/* Shadow */}
      <rect
        x={2}
        y={2}
        width={NODE_WIDTH}
        height={totalH}
        rx={8}
        fill="rgba(0,0,0,0.25)"
      />

      {/* Body background */}
      <rect
        x={0}
        y={0}
        width={NODE_WIDTH}
        height={totalH}
        rx={8}
        fill={C.darkSurf2}
        stroke={isSelected ? C.accent : C.darkBorder}
        strokeWidth={isSelected ? 2 : 1}
        cursor="grab"
        onMouseDown={onMouseDown}
      />

      {/* Header bar (colored) */}
      <rect
        x={0}
        y={0}
        width={NODE_WIDTH}
        height={NODE_HEADER_H}
        rx={8}
        fill={typeColor}
        cursor="grab"
        onMouseDown={onMouseDown}
      />
      {/* Square off bottom corners of header */}
      <rect
        x={0}
        y={NODE_HEADER_H - 8}
        width={NODE_WIDTH}
        height={8}
        fill={typeColor}
        cursor="grab"
        onMouseDown={onMouseDown}
      />

      {/* Type label in header */}
      <text
        x={12}
        y={NODE_HEADER_H / 2}
        dominantBaseline="central"
        fill="#fff"
        fontSize={11}
        fontWeight={600}
        fontFamily="Outfit, sans-serif"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {SUBTYPE_LABELS[node.subtype] || node.type}
      </text>

      {/* Node label (user-editable name) */}
      <text
        x={12}
        y={NODE_HEADER_H + 16}
        dominantBaseline="central"
        fill={C.darkText}
        fontSize={12}
        fontWeight={500}
        fontFamily="Outfit, sans-serif"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {node.label.length > 24 ? node.label.slice(0, 24) + "..." : node.label}
      </text>

      {/* Config summary */}
      <text
        x={12}
        y={NODE_HEADER_H + 34}
        dominantBaseline="central"
        fill={C.darkMuted}
        fontSize={10}
        fontFamily="Outfit, sans-serif"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {summary.length > 30 ? summary.slice(0, 30) + "..." : summary}
      </text>

      {/* Input ports (left edge) */}
      {(node.ports?.in || []).map((port, i) => (
        <g key={port.id}>
          <circle
            cx={0}
            cy={PORT_START_Y + i * PORT_SPACING}
            r={PORT_RADIUS}
            fill={C.darkSurf}
            stroke={C.accent}
            strokeWidth={2}
            cursor="crosshair"
            onMouseUp={(e) => {
              e.stopPropagation();
              onPortMouseUp?.(node.id, port.id, "in");
            }}
          />
          {/* Port label */}
          <text
            x={PORT_RADIUS + 6}
            y={PORT_START_Y + i * PORT_SPACING}
            dominantBaseline="central"
            fill={C.darkBorder}
            fontSize={9}
            fontFamily="Outfit, sans-serif"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {port.label || "in"}
          </text>
        </g>
      ))}

      {/* Output ports (right edge) */}
      {(node.ports?.out || []).map((port, i) => {
        const portColor = port.label === "true" ? "#7DC143"
          : port.label === "false" ? "#E05252"
          : C.accent;

        return (
          <g key={port.id}>
            <circle
              cx={NODE_WIDTH}
              cy={PORT_START_Y + i * PORT_SPACING}
              r={PORT_RADIUS}
              fill={C.darkSurf}
              stroke={portColor}
              strokeWidth={2}
              cursor="crosshair"
              onMouseDown={(e) => {
                e.stopPropagation();
                onPortMouseDown?.(node.id, port.id, "out");
              }}
            />
            {/* Port label */}
            <text
              x={NODE_WIDTH - PORT_RADIUS - 6}
              y={PORT_START_Y + i * PORT_SPACING}
              dominantBaseline="central"
              textAnchor="end"
              fill={C.darkBorder}
              fontSize={9}
              fontFamily="Outfit, sans-serif"
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {port.label || "out"}
            </text>
          </g>
        );
      })}
    </g>
  );
}
