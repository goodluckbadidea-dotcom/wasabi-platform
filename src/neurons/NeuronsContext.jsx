// ─── Neurons Context ───
// Global state for the Neurons connection graph.
// Provides: overlay toggle, node selection, CRUD, and O(1) badge lookups.

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  loadNeurons,
  loadCachedNeurons,
  loadNeuron,
  loadNeuronGraph,
  createNeuron as apiCreateNeuron,
  deleteNeuron as apiDeleteNeuron,
  updateNeuronName as apiUpdateName,
  addNode as apiAddNode,
  removeNode as apiRemoveNode,
} from "./neuronStorage.js";

const NeuronsContext = createContext(null);

// ─── Helpers dispatched from views ───

/** Call from any view's Cmd+click handler to select a node. */
export function dispatchNeuronSelect(node) {
  window.dispatchEvent(new CustomEvent("neuron-select", { detail: node }));
}

/** Check if neurons overlay is currently active (for views to gate Cmd+click). */
export function isNeuronsMode() {
  return document.body.dataset.neuronsActive === "true";
}

// ─── Provider ───

export function NeuronsProvider({ children }) {
  // Core state
  const [neurons, setNeurons] = useState(() => loadCachedNeurons());
  const [overlayActive, setOverlayActive] = useState(false);
  const [selection, setSelection] = useState([]); // nodes being selected for a new neuron
  const [activeNeuronView, setActiveNeuronView] = useState(null); // { neuronId, nodes } for SVG lines

  // Full graph for O(1) lookups: { nodeId → [{ neuronId, name }] }
  const graphRef = useRef({});
  const [graphVersion, setGraphVersion] = useState(0); // bump to trigger re-derive

  // ── Load on mount ──
  useEffect(() => {
    loadNeurons()
      .then((list) => setNeurons(list))
      .catch(() => {});
    rebuildNodeMap();
  }, []);

  // ── Rebuild nodeId → neuronIds map ──
  const rebuildNodeMap = useCallback(async () => {
    try {
      const fullGraph = await loadNeuronGraph();
      const map = {};
      for (const n of fullGraph) {
        for (const node of n.nodes || []) {
          if (!map[node.node_id]) map[node.node_id] = [];
          map[node.node_id].push({ neuronId: n.id, name: n.name });
        }
      }
      graphRef.current = map;
      setGraphVersion((v) => v + 1);
    } catch {
      /* network error — keep stale map */
    }
  }, []);

  // ── Derived: nodeMap (triggers re-render when graphVersion changes) ──
  const nodeMap = useMemo(() => graphRef.current, [graphVersion]);

  // ── Overlay toggle ──
  const toggleOverlay = useCallback(() => {
    setOverlayActive((prev) => {
      if (prev) {
        // Turning off — clear selection
        setSelection([]);
        setActiveNeuronView(null);
      }
      return !prev;
    });
  }, []);

  // ── Keep body data-attribute in sync (for view components) ──
  useEffect(() => {
    document.body.dataset.neuronsActive = overlayActive ? "true" : "false";
    return () => {
      document.body.dataset.neuronsActive = "false";
    };
  }, [overlayActive]);

  // ── Publish selected IDs to window for view rendering (O(1) lookups) ──
  useEffect(() => {
    window.__neuronSelectedIds = new Set(selection.map((n) => n.node_id));
  }, [selection]);

  // ── Node selection toggle ──
  const toggleNodeSelection = useCallback((node) => {
    setSelection((prev) => {
      const exists = prev.find((n) => n.node_id === node.node_id);
      if (exists) return prev.filter((n) => n.node_id !== node.node_id);
      return [...prev, node];
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection([]);
  }, []);

  // ── Listen for neuron-select custom events from views ──
  useEffect(() => {
    const handler = (e) => toggleNodeSelection(e.detail);
    window.addEventListener("neuron-select", handler);
    return () => window.removeEventListener("neuron-select", handler);
  }, [toggleNodeSelection]);

  // ── CRUD actions ──

  const handleCreateNeuron = useCallback(
    async (name) => {
      if (selection.length < 2) return null;
      const result = await apiCreateNeuron(name || "", selection);
      // Refresh list + node map
      const list = await loadNeurons(true);
      setNeurons(list);
      setSelection([]);
      await rebuildNodeMap();
      return result;
    },
    [selection, rebuildNodeMap]
  );

  const handleDeleteNeuron = useCallback(
    async (neuronId) => {
      await apiDeleteNeuron(neuronId);
      const list = await loadNeurons(true);
      setNeurons(list);
      setActiveNeuronView(null);
      await rebuildNodeMap();
    },
    [rebuildNodeMap]
  );

  const handleUpdateName = useCallback(
    async (neuronId, name) => {
      await apiUpdateName(neuronId, name);
      const list = await loadNeurons(true);
      setNeurons(list);
      await rebuildNodeMap();
    },
    [rebuildNodeMap]
  );

  const handleAddNode = useCallback(
    async (neuronId, node) => {
      await apiAddNode(neuronId, node);
      const list = await loadNeurons(true);
      setNeurons(list);
      await rebuildNodeMap();
    },
    [rebuildNodeMap]
  );

  const handleRemoveNode = useCallback(
    async (neuronId, nodeId) => {
      await apiRemoveNode(neuronId, nodeId);
      const list = await loadNeurons(true);
      setNeurons(list);
      await rebuildNodeMap();
    },
    [rebuildNodeMap]
  );

  // ── Get neurons for a specific node (for badges) ──
  const getNeuronsForNode = useCallback(
    (nodeId) => nodeMap[nodeId] || [],
    [nodeMap]
  );

  // ── Show SVG lines for a neuron ──
  const showNeuronLines = useCallback(async (neuronId) => {
    try {
      const full = await loadNeuron(neuronId);
      setActiveNeuronView({ neuronId: full.id, nodes: full.nodes || [] });
    } catch {
      setActiveNeuronView(null);
    }
  }, []);

  const hideNeuronLines = useCallback(() => {
    setActiveNeuronView(null);
  }, []);

  // ── Context value ──
  const value = useMemo(
    () => ({
      // State
      neurons,
      overlayActive,
      selection,
      activeNeuronView,
      nodeMap,

      // Overlay
      toggleOverlay,
      setOverlayActive,

      // Selection
      toggleNodeSelection,
      clearSelection,

      // CRUD
      createNeuron: handleCreateNeuron,
      deleteNeuron: handleDeleteNeuron,
      updateNeuronName: handleUpdateName,
      addNode: handleAddNode,
      removeNode: handleRemoveNode,

      // Lookups
      getNeuronsForNode,
      showNeuronLines,
      hideNeuronLines,

      // Refresh
      refreshNeurons: rebuildNodeMap,
    }),
    [
      neurons, overlayActive, selection, activeNeuronView, nodeMap,
      toggleOverlay, toggleNodeSelection, clearSelection,
      handleCreateNeuron, handleDeleteNeuron, handleUpdateName,
      handleAddNode, handleRemoveNode,
      getNeuronsForNode, showNeuronLines, hideNeuronLines, rebuildNodeMap,
    ]
  );

  return (
    <NeuronsContext.Provider value={value}>
      {children}
    </NeuronsContext.Provider>
  );
}

export function useNeurons() {
  const ctx = useContext(NeuronsContext);
  if (!ctx) throw new Error("useNeurons must be used within NeuronsProvider");
  return ctx;
}

export default NeuronsContext;
