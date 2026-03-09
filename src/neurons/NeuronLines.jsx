// ─── NeuronLines (Floating Pills Bar) ───
// When a neuron badge is clicked, shows a floating pill bar at the top of the screen
// listing all connected nodes. Click-away dismisses. During overlay mode,
// pills show (x) to remove nodes from the neuron.
// Portal to document.body for correct stacking.

import React, { useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { useNeurons } from "./NeuronsContext.jsx";

export default function NeuronLines() {
  const {
    activeNeuronView,
    hideNeuronLines,
    overlayActive,
    removeNode,
    refreshNeurons,
  } = useNeurons();
  const barRef = useRef(null);

  // Click-away to dismiss
  useEffect(() => {
    if (!activeNeuronView) return;
    const handler = (e) => {
      if (barRef.current && !barRef.current.contains(e.target)) {
        hideNeuronLines();
      }
    };
    // Delay listener so the badge click that opened this doesn't immediately close it
    const timer = setTimeout(() => {
      window.addEventListener("mousedown", handler);
    }, 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handler);
    };
  }, [activeNeuronView, hideNeuronLines]);

  // Escape to dismiss
  useEffect(() => {
    if (!activeNeuronView) return;
    const handler = (e) => {
      if (e.key === "Escape") hideNeuronLines();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeNeuronView, hideNeuronLines]);

  const handleRemoveNode = useCallback(
    async (e, nodeId) => {
      e.stopPropagation();
      if (!activeNeuronView) return;
      try {
        // Find the neuron_nodes row ID for this node
        const node = activeNeuronView.nodes.find((n) => n.node_id === nodeId);
        if (node) {
          await removeNode(activeNeuronView.neuronId, node.id);
          await refreshNeurons();
          // Update local view
          const remaining = activeNeuronView.nodes.filter((n) => n.node_id !== nodeId);
          if (remaining.length < 1) {
            hideNeuronLines();
          }
        }
      } catch (err) {
        console.error("[Neurons] Remove node failed:", err);
      }
    },
    [activeNeuronView, removeNode, refreshNeurons, hideNeuronLines]
  );

  if (!activeNeuronView || !activeNeuronView.nodes?.length) return null;

  const { nodes } = activeNeuronView;
  const neuronName = activeNeuronView.name || "";

  return ReactDOM.createPortal(
    <div
      ref={barRef}
      style={{
        position: "fixed",
        top: 56,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 400,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        animation: ANIM.snapInRight(0.02),
      }}
    >
      {/* Neuron header pill */}
      <div
        style={{
          background: C.dark,
          border: `1.5px solid ${C.accent}`,
          borderRadius: 999,
          padding: "6px 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          boxShadow: `0 0 20px ${C.accent}22, 0 4px 12px rgba(0,0,0,0.3)`,
        }}
      >
        {/* Neuron icon */}
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <circle cx="4" cy="4" r="2" fill={C.accent} />
          <circle cx="12" cy="4" r="2" fill={C.accent} />
          <circle cx="8" cy="12" r="2" fill={C.accent} />
          <line x1="4" y1="4" x2="12" y2="4" stroke={C.accent} strokeWidth="1" />
          <line x1="4" y1="4" x2="8" y2="12" stroke={C.accent} strokeWidth="1" />
          <line x1="12" y1="4" x2="8" y2="12" stroke={C.accent} strokeWidth="1" />
        </svg>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: C.accent,
            fontFamily: FONT,
            letterSpacing: "0.06em",
          }}
        >
          {neuronName || `${nodes.length} CONNECTED`}
        </span>
        <button
          onClick={hideNeuronLines}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: C.darkMuted,
            fontSize: 14,
            padding: "0 2px",
            lineHeight: 1,
            transition: "color 0.12s",
            outline: "none",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = C.darkText; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Connected node pills */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          justifyContent: "center",
          maxWidth: 600,
        }}
      >
        {nodes.map((node, i) => (
          <div
            key={node.node_id || i}
            style={{
              background: C.dark,
              border: `1px solid ${C.accent}44`,
              borderRadius: RADIUS.md,
              padding: "4px 10px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 500,
              color: C.darkText,
              fontFamily: FONT,
              letterSpacing: "0.02em",
              maxWidth: 200,
              boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
              animation: ANIM.snapInRight(0.02 + i * 0.015),
            }}
          >
            {/* Node type indicator */}
            <span
              style={{
                fontSize: 9,
                color: C.accent,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                flexShrink: 0,
              }}
            >
              {node.node_type || ""}
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {node.node_label || node.node_id}
            </span>

            {/* Remove button — only in overlay mode */}
            {overlayActive && (
              <button
                onClick={(e) => handleRemoveNode(e, node.node_id)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: C.darkMuted,
                  fontSize: 13,
                  padding: "0 1px",
                  lineHeight: 1,
                  transition: "color 0.12s",
                  outline: "none",
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#E05252"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
                title="Remove from neuron"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Hint when in overlay mode */}
      {overlayActive && (
        <div
          style={{
            fontSize: 10,
            color: C.darkMuted,
            fontFamily: FONT,
            fontWeight: 500,
            letterSpacing: "0.04em",
            marginTop: 2,
          }}
        >
          <span style={{ color: C.accent }}>Cmd + Click</span> items to add to this neuron
        </div>
      )}
    </div>,
    document.body
  );
}
