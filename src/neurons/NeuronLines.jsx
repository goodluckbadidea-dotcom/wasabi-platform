// ─── NeuronLines (Floating Pills Bar) ───
// When a neuron badge is clicked, shows a floating pill bar at the top of the screen.
// Multi-neuron support: tabs at top to switch between neurons.
// Full management: rename, remove nodes, delete neuron, add items.
// Portal to document.body for correct stacking.

import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { useNeurons } from "./NeuronsContext.jsx";
import { IconTrash, IconEdit } from "../design/icons.jsx";

export default function NeuronLines() {
  const {
    activeNeuronView,
    setActiveNeuronView,
    hideNeuronLines,
    overlayActive,
    removeNode,
    refreshNeurons,
    deleteNeuron,
    updateNeuronName,
  } = useNeurons();
  const barRef = useRef(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const nameInputRef = useRef(null);

  // Reset states when neuron view changes
  useEffect(() => {
    setConfirmDelete(false);
    setEditing(false);
  }, [activeNeuronView?.neuronId]);

  // Focus name input when editing
  useEffect(() => {
    if (editing && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editing]);

  // Click-away to dismiss
  useEffect(() => {
    if (!activeNeuronView) return;
    const handler = (e) => {
      if (barRef.current && !barRef.current.contains(e.target)) {
        hideNeuronLines();
      }
    };
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
      if (e.key === "Escape") {
        if (editing) { setEditing(false); return; }
        hideNeuronLines();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeNeuronView, hideNeuronLines, editing]);

  // Remove a node from the current neuron
  const handleRemoveNode = useCallback(
    async (e, nodeId) => {
      e.stopPropagation();
      if (!activeNeuronView) return;
      try {
        const node = activeNeuronView.nodes.find((n) => n.node_id === nodeId);
        if (node) {
          await removeNode(activeNeuronView.neuronId, node.id);
          await refreshNeurons();
          const remaining = activeNeuronView.nodes.filter((n) => n.node_id !== nodeId);
          if (remaining.length < 1) {
            hideNeuronLines();
          } else {
            // Update current view
            const updated = { ...activeNeuronView, nodes: remaining };
            // Also update in allNeurons if multi
            if (activeNeuronView.allNeurons) {
              const updatedAll = activeNeuronView.allNeurons.map((n) =>
                n.neuronId === activeNeuronView.neuronId ? { ...n, nodes: remaining } : n
              );
              setActiveNeuronView({ ...updated, allNeurons: updatedAll });
            } else {
              setActiveNeuronView(updated);
            }
          }
        }
      } catch (err) {
        console.error("[Neurons] Remove node failed:", err);
      }
    },
    [activeNeuronView, removeNode, refreshNeurons, hideNeuronLines, setActiveNeuronView]
  );

  // Rename the current neuron
  const handleRename = useCallback(async () => {
    if (!activeNeuronView || !editName.trim()) { setEditing(false); return; }
    try {
      await updateNeuronName(activeNeuronView.neuronId, editName.trim());
      const updated = { ...activeNeuronView, name: editName.trim() };
      if (activeNeuronView.allNeurons) {
        const updatedAll = activeNeuronView.allNeurons.map((n) =>
          n.neuronId === activeNeuronView.neuronId ? { ...n, name: editName.trim() } : n
        );
        setActiveNeuronView({ ...updated, allNeurons: updatedAll });
      } else {
        setActiveNeuronView(updated);
      }
    } catch (err) {
      console.error("[Neurons] Rename failed:", err);
    }
    setEditing(false);
  }, [activeNeuronView, editName, updateNeuronName, setActiveNeuronView]);

  // Delete the current neuron
  const handleDelete = useCallback(async () => {
    if (!activeNeuronView) return;
    const deletedId = activeNeuronView.neuronId;
    await deleteNeuron(deletedId);

    // If multi-neuron, switch to next tab
    if (activeNeuronView.allNeurons && activeNeuronView.allNeurons.length > 1) {
      const remaining = activeNeuronView.allNeurons.filter((n) => n.neuronId !== deletedId);
      if (remaining.length > 0) {
        setActiveNeuronView({ ...remaining[0], allNeurons: remaining });
        setConfirmDelete(false);
        return;
      }
    }
    hideNeuronLines();
  }, [activeNeuronView, deleteNeuron, hideNeuronLines, setActiveNeuronView]);

  // Switch tab
  const handleSwitchTab = useCallback((neuron) => {
    if (!activeNeuronView?.allNeurons) return;
    setActiveNeuronView({ ...neuron, allNeurons: activeNeuronView.allNeurons });
    setConfirmDelete(false);
    setEditing(false);
  }, [activeNeuronView, setActiveNeuronView]);

  if (!activeNeuronView || !activeNeuronView.nodes?.length) return null;

  const { nodes, allNeurons } = activeNeuronView;
  const neuronName = activeNeuronView.name || "";
  const hasTabs = allNeurons && allNeurons.length > 1;

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
        gap: 6,
        animation: ANIM.snapInRight(0.02),
      }}
    >
      {/* Tabs row (multi-neuron) */}
      {hasTabs && (
        <div style={{
          display: "flex", gap: 3, padding: 3,
          background: C.dark, borderRadius: 999,
          border: `1px solid ${C.darkBorder}`,
          boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
        }}>
          {allNeurons.map((n) => {
            const isActive = n.neuronId === activeNeuronView.neuronId;
            return (
              <button
                key={n.neuronId}
                onClick={() => handleSwitchTab(n)}
                style={{
                  padding: "5px 12px", borderRadius: 999, border: "none",
                  cursor: "pointer", fontSize: 10, fontWeight: isActive ? 600 : 400,
                  fontFamily: FONT, outline: "none",
                  background: isActive ? C.accent : "transparent",
                  color: isActive ? "#fff" : C.darkMuted,
                  transition: "all 0.15s",
                  maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
              >
                {n.name || `${(n.nodes || []).length} items`}
              </button>
            );
          })}
        </div>
      )}

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

        {/* Name (editable) */}
        {editing ? (
          <input
            ref={nameInputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditing(false); }}
            onBlur={handleRename}
            style={{
              background: "transparent", border: "none", outline: "none",
              color: C.accent, fontFamily: FONT, fontSize: 11, fontWeight: 600,
              letterSpacing: "0.06em", width: 120,
              borderBottom: `1px solid ${C.accent}`,
            }}
          />
        ) : (
          <span
            style={{
              fontSize: 11, fontWeight: 600, color: C.accent,
              fontFamily: FONT, letterSpacing: "0.06em",
            }}
          >
            {neuronName || `${nodes.length} CONNECTED`}
          </span>
        )}

        {/* Rename button */}
        {!editing && (
          <button
            onClick={(e) => { e.stopPropagation(); setEditName(neuronName); setEditing(true); }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: C.darkMuted, padding: "0 2px", lineHeight: 1,
              transition: "color 0.12s", outline: "none",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = C.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
            title="Rename neuron"
          >
            <IconEdit size={11} />
          </button>
        )}

        {/* Delete neuron button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirmDelete) handleDelete();
            else setConfirmDelete(true);
          }}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: confirmDelete ? C.error : C.darkMuted,
            fontSize: confirmDelete ? 10 : 12,
            padding: "0 2px", lineHeight: 1,
            transition: "all 0.12s", outline: "none",
            fontFamily: FONT, fontWeight: confirmDelete ? 600 : 400,
          }}
          onMouseEnter={(e) => { if (!confirmDelete) e.currentTarget.style.color = C.error; }}
          onMouseLeave={(e) => { if (!confirmDelete) e.currentTarget.style.color = C.darkMuted; }}
          title={confirmDelete ? "Click again to confirm delete" : "Delete neuron"}
        >
          {confirmDelete ? "Delete?" : <IconTrash size={12} />}
        </button>

        {/* Close */}
        <button
          onClick={hideNeuronLines}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: C.darkMuted, fontSize: 14, padding: "0 2px",
            lineHeight: 1, transition: "color 0.12s", outline: "none",
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
              borderRadius: RADIUS.pill,
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
                fontSize: 9, color: C.accent, fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0,
              }}
            >
              {node.node_type || ""}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {node.node_label || node.node_id}
            </span>

            {/* Remove button — always visible for full management */}
            <button
              onClick={(e) => handleRemoveNode(e, node.node_id)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: C.darkMuted, fontSize: 13, padding: "0 1px",
                lineHeight: 1, transition: "color 0.12s", outline: "none", flexShrink: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = C.error; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
              title="Remove from neuron"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Hint */}
      {overlayActive && (
        <div
          style={{
            fontSize: 10, color: C.darkMuted, fontFamily: FONT,
            fontWeight: 500, letterSpacing: "0.04em", marginTop: 2,
          }}
        >
          <span style={{ color: C.accent }}>Cmd + Click</span> items to add to this neuron
        </div>
      )}
    </div>,
    document.body
  );
}
