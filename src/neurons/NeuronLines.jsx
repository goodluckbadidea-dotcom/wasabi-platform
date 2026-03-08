// ─── NeuronLines ───
// SVG overlay drawing connection lines between nodes of the active neuron.
// Finds DOM positions via data-neuron-node attributes, draws dashed accent lines.
// Portal to document.body for correct stacking.

import React, { useEffect, useState, useCallback } from "react";
import ReactDOM from "react-dom";
import { C } from "../design/tokens.js";
import { useNeurons } from "./NeuronsContext.jsx";

/** Find the center point of a DOM element with the given neuron node attribute. */
function getNodePosition(nodeId) {
  const el = document.querySelector(`[data-neuron-node="row:${nodeId}"], [data-neuron-node="page:${nodeId}"], [data-neuron-node="folder:${nodeId}"], [data-neuron-node="cell:${nodeId}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
  };
}

export default function NeuronLines() {
  const { activeNeuronView, hideNeuronLines } = useNeurons();
  const [positions, setPositions] = useState([]);

  // Calculate positions when activeNeuronView changes
  const recalc = useCallback(() => {
    if (!activeNeuronView?.nodes) {
      setPositions([]);
      return;
    }

    const pts = [];
    for (const node of activeNeuronView.nodes) {
      const pos = getNodePosition(node.node_id);
      if (pos) {
        pts.push({ ...pos, nodeId: node.node_id, label: node.node_label });
      }
    }
    setPositions(pts);
  }, [activeNeuronView]);

  useEffect(() => {
    recalc();
    // Recalc on scroll/resize
    const handler = () => recalc();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [recalc]);

  // Dismiss on Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") hideNeuronLines();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hideNeuronLines]);

  if (!activeNeuronView || positions.length < 2) return null;

  // Compute hub center
  const hub = {
    x: positions.reduce((s, p) => s + p.x, 0) / positions.length,
    y: positions.reduce((s, p) => s + p.y, 0) / positions.length,
  };

  return ReactDOM.createPortal(
    <svg
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 349,
        pointerEvents: "none",
      }}
    >
      <defs>
        <filter id="neuron-glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feFlood floodColor={C.accent} floodOpacity="0.4" result="color" />
          <feComposite in="color" in2="blur" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Lines from hub to each node */}
      {positions.map((pos, i) => (
        <line
          key={`line-${i}`}
          x1={hub.x}
          y1={hub.y}
          x2={pos.x}
          y2={pos.y}
          stroke={C.accent}
          strokeWidth="1.5"
          strokeDasharray="6 4"
          opacity="0.6"
          filter="url(#neuron-glow)"
        />
      ))}

      {/* Hub dot */}
      <circle
        cx={hub.x}
        cy={hub.y}
        r={5}
        fill={C.accent}
        opacity="0.8"
        filter="url(#neuron-glow)"
      />

      {/* Node dots */}
      {positions.map((pos, i) => (
        <circle
          key={`dot-${i}`}
          cx={pos.x}
          cy={pos.y}
          r={4}
          fill={C.accent}
          stroke={C.dark || "#111"}
          strokeWidth="1.5"
          opacity="0.9"
        />
      ))}

      {/* Node labels */}
      {positions.map((pos, i) => (
        <text
          key={`label-${i}`}
          x={pos.x}
          y={pos.y - 12}
          textAnchor="middle"
          fill={C.accent}
          fontSize="10"
          fontWeight="600"
          opacity="0.8"
          style={{ pointerEvents: "none", fontFamily: "inherit" }}
        >
          {pos.label || ""}
        </text>
      ))}
    </svg>,
    document.body
  );
}
