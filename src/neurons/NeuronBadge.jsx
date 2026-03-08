// ─── NeuronBadge ───
// Small accent-colored badge showing neuron connection count.
// Renders next to items that are part of one or more neurons.
// Click → show SVG connection lines for that neuron.

import React, { useCallback } from "react";
import { C, RADIUS } from "../design/tokens.js";
import { useNeurons } from "./NeuronsContext.jsx";

export default function NeuronBadge({ nodeId, style }) {
  const { getNeuronsForNode, showNeuronLines, activeNeuronView } = useNeurons();
  const connections = getNeuronsForNode(nodeId);

  const handleClick = useCallback(
    (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (connections.length === 1) {
        showNeuronLines(connections[0].neuronId);
      } else if (connections.length > 1) {
        // For multiple neurons, show the first one (future: picker popup)
        showNeuronLines(connections[0].neuronId);
      }
    },
    [connections, showNeuronLines]
  );

  if (!connections || connections.length === 0) return null;

  const isActive = activeNeuronView && connections.some((c) => c.neuronId === activeNeuronView.neuronId);

  return (
    <span
      onClick={handleClick}
      title={
        connections.length === 1
          ? connections[0].name || "Neuron connection"
          : `${connections.length} neuron connections`
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "1px 6px",
        borderRadius: RADIUS.full,
        border: `1px solid ${isActive ? C.accent : C.accent + "55"}`,
        background: isActive ? C.accent + "22" : C.accent + "0a",
        cursor: "pointer",
        fontSize: 10,
        fontWeight: 600,
        color: C.accent,
        lineHeight: 1.4,
        transition: "all 0.15s",
        flexShrink: 0,
        ...style,
      }}
    >
      {/* Small neuron icon */}
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
        <circle cx="4" cy="4" r="2" fill={C.accent} />
        <circle cx="12" cy="4" r="2" fill={C.accent} />
        <circle cx="8" cy="12" r="2" fill={C.accent} />
        <line x1="4" y1="4" x2="12" y2="4" stroke={C.accent} strokeWidth="1" opacity="0.5" />
        <line x1="4" y1="4" x2="8" y2="12" stroke={C.accent} strokeWidth="1" opacity="0.5" />
        <line x1="12" y1="4" x2="8" y2="12" stroke={C.accent} strokeWidth="1" opacity="0.5" />
      </svg>
      {connections.length}
    </span>
  );
}
