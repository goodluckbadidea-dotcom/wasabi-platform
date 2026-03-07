// ─── Node Editor ───
// Main orchestrator: flow list sidebar + node palette + canvas + config panel.
// Visual automation builder with drag-and-drop nodes and wire connections.

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { uuid } from "../utils/helpers.js";
import NodeCanvas from "../views/NodeCanvas.jsx";
import NodeConfigPanel from "../views/NodeConfigPanel.jsx";
import { NODE_WIDTH, NODE_TYPE_COLORS, getNodeHeight } from "../views/NodeRenderer.jsx";
import {
  IconPlay, IconDatabase, IconCalendar, IconBolt, IconCondition,
  IconEdit, IconPlus, IconBell, IconTransform, IconTrash, IconClose,
} from "../design/icons.jsx";
import { loadCachedFlows, saveFlow, loadFlows, initFlowsDB, deleteFlow } from "../config/flowStorage.js";
import { savePlatformIds, loadPlatformIds } from "../config/setup.js";
import ConfirmDialog from "./ConfirmDialog.jsx";

// ── Node Palette Definition ──

const NODE_PALETTE = [
  { type: "trigger",   subtype: "status_change",    label: "DB Change",    Icon: IconDatabase,  category: "Triggers" },
  { type: "trigger",   subtype: "schedule",          label: "Schedule",     Icon: IconCalendar,  category: "Triggers" },
  { type: "trigger",   subtype: "manual",            label: "Manual",       Icon: IconBolt,      category: "Triggers" },
  { type: "condition", subtype: "field_check",        label: "Condition",    Icon: IconCondition, category: "Logic" },
  { type: "action",    subtype: "update_page",        label: "Update",       Icon: IconEdit,      category: "Actions" },
  { type: "action",    subtype: "create_page",        label: "Create",       Icon: IconPlus,      category: "Actions" },
  { type: "action",    subtype: "post_notification",  label: "Notify",       Icon: IconBell,      category: "Actions" },
  { type: "transform", subtype: "template",           label: "Template",     Icon: IconTransform, category: "Transform" },
];

// ── Default Node Factories ──

function getDefaultConfig(type, subtype) {
  switch (subtype) {
    case "status_change":
    case "database_change":
    case "field_change":
    case "page_created":
      return { databaseId: "", field: "", from: "", to: "" };
    case "schedule":
      return { interval_minutes: 60 };
    case "manual":
      return {};
    case "field_check":
      return { field: "", operator: "equals", value: "" };
    case "update_page":
      return { description: "", properties: "" };
    case "create_page":
      return { databaseId: "", properties: "" };
    case "post_notification":
      return { message: "", type: "notification" };
    case "template":
      return { template: "" };
    default:
      return {};
  }
}

function getDefaultPorts(type, subtype) {
  const hasInput = type !== "trigger";
  let outputs;
  if (type === "condition") {
    outputs = [{ id: uuid(), label: "true" }, { id: uuid(), label: "false" }];
  } else if (type === "action") {
    outputs = []; // terminal by default
  } else {
    outputs = [{ id: uuid(), label: "out" }];
  }
  return {
    in: hasInput ? [{ id: uuid(), label: "in" }] : [],
    out: outputs,
  };
}

function getDefaultLabel(type, subtype) {
  const item = NODE_PALETTE.find((p) => p.type === type && p.subtype === subtype);
  return item?.label || subtype || type;
}

// ── Flow List Sidebar ──

function FlowListPanel({ flows, activeFlowId, onSelect, onNew, onDelete, collapsed }) {
  const [hoveredId, setHoveredId] = useState(null);
  if (collapsed) return null;

  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        background: C.dark,
        borderRight: `1px solid ${C.darkBorder}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{
        padding: "14px 16px 10px",
        borderBottom: `1px solid ${C.darkBorder}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.15em",
          color: C.darkMuted,
          fontFamily: FONT,
        }}>
          Flows
        </span>
        <button
          onClick={onNew}
          style={{
            background: C.accent,
            border: "none",
            borderRadius: RADIUS.sm,
            padding: "3px 8px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            outline: "none",
          }}
        >
          <IconPlus size={10} color="#fff" />
          <span style={{ fontSize: 10, color: "#fff", fontFamily: FONT, fontWeight: 600 }}>New</span>
        </button>
      </div>

      {/* Flow list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
        {flows.length === 0 && (
          <div style={{
            padding: "24px 16px",
            textAlign: "center",
            fontSize: 12,
            color: C.darkBorder,
            fontFamily: FONT,
          }}>
            No flows yet.<br />Click + New to create one.
          </div>
        )}
        {flows.map((flow) => {
          const isActive = flow.id === activeFlowId;
          const isHovered = hoveredId === flow.id;
          return (
            <div
              key={flow.id}
              onMouseEnter={() => setHoveredId(flow.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: "flex",
                alignItems: "center",
                width: "calc(100% - 12px)",
                margin: "2px 6px",
                borderRadius: RADIUS.md,
                background: isActive ? C.accent : isHovered ? C.darkSurf2 : "transparent",
                transition: "background 0.1s",
              }}
            >
              <button
                onClick={() => onSelect(flow.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flex: 1,
                  padding: "8px 12px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  outline: "none",
                  fontFamily: FONT,
                  minWidth: 0,
                }}
              >
                <div style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: flow.enabled ? "#7DC143" : C.darkBorder,
                  flexShrink: 0,
                }} />
                <span style={{
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? "#fff" : C.darkText,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {flow.name || "Untitled Flow"}
                </span>
              </button>
              {isHovered && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(flow.id); }}
                  title="Delete flow"
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px 8px 4px 0",
                    opacity: 0.4,
                    transition: "opacity 0.12s",
                    outline: "none",
                    display: "flex",
                    alignItems: "center",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; }}
                >
                  <IconTrash size={12} color={isActive ? "#fff" : C.darkMuted} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Node Palette Toolbar ──

function NodePalette({ onAddNode, onRun, onSave, saveStatus, isRunning }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "6px 12px",
        background: C.darkSurf,
        borderBottom: `1px solid ${C.darkBorder}`,
        flexShrink: 0,
        overflowX: "auto",
      }}
    >
      {NODE_PALETTE.map((item, i) => {
        const Icon = item.Icon;
        const typeColor = NODE_TYPE_COLORS[item.type] || C.darkMuted;
        return (
          <button
            key={i}
            onClick={() => onAddNode(item)}
            title={`Add ${item.label} node`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              background: "transparent",
              border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.md,
              cursor: "pointer",
              outline: "none",
              fontFamily: FONT,
              fontSize: 11,
              color: C.darkText,
              transition: "all 0.1s",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = typeColor;
              e.currentTarget.style.background = typeColor + "18";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = C.darkBorder;
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Icon size={13} color={typeColor} />
            {item.label}
          </button>
        );
      })}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Save status */}
      <span style={{
        fontSize: 10,
        color: saveStatus === "saved" ? "#7DC143"
          : saveStatus === "saving" ? C.accent
          : saveStatus === "error" ? "#E05252"
          : C.darkBorder,
        fontFamily: FONT,
        whiteSpace: "nowrap",
      }}>
        {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : saveStatus === "error" ? "Save failed" : ""}
      </span>

      {/* Save button */}
      <button
        onClick={onSave}
        style={{
          padding: "5px 12px",
          background: "transparent",
          border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.md,
          cursor: "pointer",
          outline: "none",
          fontFamily: FONT,
          fontSize: 11,
          color: C.darkText,
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        Save
      </button>

      {/* Run button */}
      <button
        onClick={onRun}
        disabled={isRunning}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "5px 14px",
          background: isRunning ? C.darkSurf2 : C.accent,
          border: "none",
          borderRadius: RADIUS.md,
          cursor: isRunning ? "default" : "pointer",
          outline: "none",
          fontFamily: FONT,
          fontSize: 11,
          fontWeight: 600,
          color: "#fff",
          whiteSpace: "nowrap",
          opacity: isRunning ? 0.6 : 1,
        }}
      >
        <IconPlay size={11} color="#fff" />
        {isRunning ? "Running..." : "Run"}
      </button>
    </div>
  );
}

// ── Empty State ──

function EmptyState({ onNew }) {
  return (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      fontFamily: FONT,
      color: C.darkMuted,
    }}>
      <div style={{ opacity: 0.3 }}><IconBolt size={48} color={C.darkMuted} /></div>
      <div style={{ fontSize: 16, fontWeight: 600, color: C.darkText }}>Node Automation Editor</div>
      <div style={{ fontSize: 13, color: C.darkMuted, textAlign: "center", maxWidth: 300, lineHeight: 1.6 }}>
        Create visual automation flows by connecting nodes together.
        Select a flow from the sidebar or create a new one.
      </div>
      <button
        onClick={onNew}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "10px 20px",
          background: C.accent,
          border: "none",
          borderRadius: RADIUS.lg,
          cursor: "pointer",
          outline: "none",
          fontFamily: FONT,
          fontSize: 13,
          fontWeight: 600,
          color: "#fff",
        }}
      >
        <IconPlus size={14} color="#fff" />
        Create First Flow
      </button>
    </div>
  );
}

// ── Main Component ──

export default function NodeEditor({ automationEngine }) {
  const { user, platformIds } = usePlatform();

  // ── Flow state ──
  const [flows, setFlows] = useState(() => loadCachedFlows());
  const [activeFlowId, setActiveFlowId] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [connections, setConnections] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [draftConnection, setDraftConnection] = useState(null);
  const [executionStates, setExecutionStates] = useState({});
  const [isRunning, setIsRunning] = useState(false);

  // ── Canvas state ──
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [saveStatus, setSaveStatus] = useState(null); // null | "saving" | "saved" | "error"
  const [confirmDelete, setConfirmDelete] = useState(null); // flow id to confirm deletion

  const canvasRef = useRef(null);

  // ── Load flows from Notion on mount ──
  useEffect(() => {
    if (!user?.workerUrl || !user?.notionKey || !platformIds?.flowsDbId) return;
    loadFlows(user.workerUrl, user.notionKey, platformIds.flowsDbId)
      .then((loaded) => {
        if (loaded.length > 0) setFlows(loaded);
      })
      .catch((err) => console.error("[NodeEditor] Failed to load flows:", err));
  }, [user, platformIds?.flowsDbId]);

  // ── Active flow data ──
  const activeFlow = useMemo(() => flows.find((f) => f.id === activeFlowId), [flows, activeFlowId]);

  // Load nodes/connections when active flow changes
  useEffect(() => {
    if (activeFlow) {
      setNodes(activeFlow.nodes || []);
      setConnections(activeFlow.connections || []);
      setSelectedNodeId(null);
      setExecutionStates({});
    }
  }, [activeFlowId]); // intentionally only on ID change

  // Selected node object
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId]
  );

  // ── Ensure Flows DB exists ──
  const ensureFlowsDb = useCallback(async () => {
    if (platformIds?.flowsDbId) return platformIds.flowsDbId;
    if (!user?.workerUrl || !user?.notionKey || !platformIds?.rootPageId) return null;

    try {
      const dbId = await initFlowsDB(user.workerUrl, user.notionKey, platformIds.rootPageId);
      // Save to platform IDs
      const ids = loadPlatformIds() || {};
      ids.flowsDbId = dbId;
      savePlatformIds(ids);
      return dbId;
    } catch (err) {
      console.error("[NodeEditor] Failed to init flows DB:", err);
      return null;
    }
  }, [user, platformIds]);

  // ── Add node ──
  const handleAddNode = useCallback((paletteItem) => {
    if (!activeFlowId) return;
    const centerX = (-pan.x + 400) / zoom;
    const centerY = (-pan.y + 300) / zoom;

    const newNode = {
      id: `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: paletteItem.type,
      subtype: paletteItem.subtype,
      label: getDefaultLabel(paletteItem.type, paletteItem.subtype),
      x: centerX - NODE_WIDTH / 2 + Math.random() * 40 - 20,
      y: centerY - 40 + Math.random() * 40 - 20,
      config: getDefaultConfig(paletteItem.type, paletteItem.subtype),
      ports: getDefaultPorts(paletteItem.type, paletteItem.subtype),
    };

    setNodes((prev) => [...prev, newNode]);
    setSelectedNodeId(newNode.id);
  }, [activeFlowId, pan, zoom]);

  // ── Move node ──
  const handleMoveNode = useCallback((nodeId, x, y) => {
    setNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, x, y } : n));
  }, []);

  // ── Select / deselect ──
  const handleNodeSelect = useCallback((nodeId) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handleCanvasClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // ── Connection drawing ──
  const handlePortMouseDown = useCallback((nodeId, portId, direction) => {
    if (direction === "out") {
      setDraftConnection({ fromNode: nodeId, fromPort: portId, mousePos: null });
    }
  }, []);

  const handlePortMouseUp = useCallback((nodeId, portId, direction) => {
    if (direction === "in" && draftConnection) {
      // Validate: no self-connect, no duplicate, input not already connected
      const { fromNode, fromPort } = draftConnection;
      if (fromNode === nodeId) {
        setDraftConnection(null);
        return;
      }
      const exists = connections.some(
        (c) => c.fromNode === fromNode && c.fromPort === fromPort && c.toNode === nodeId && c.toPort === portId
      );
      if (exists) {
        setDraftConnection(null);
        return;
      }
      const inputTaken = connections.some((c) => c.toNode === nodeId && c.toPort === portId);
      if (inputTaken) {
        setDraftConnection(null);
        return;
      }

      const newConn = {
        id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        fromNode,
        fromPort,
        toNode: nodeId,
        toPort: portId,
      };
      setConnections((prev) => [...prev, newConn]);
      setDraftConnection(null);
    }
  }, [draftConnection, connections]);

  const handleMouseMoveCanvas = useCallback((pos) => {
    if (draftConnection) {
      setDraftConnection((prev) => prev ? { ...prev, mousePos: pos } : null);
    }
  }, [draftConnection]);

  const handleMouseUpCanvas = useCallback(() => {
    if (draftConnection) {
      setDraftConnection(null);
    }
  }, [draftConnection]);

  // ── Delete node ──
  const handleDeleteNode = useCallback((nodeId) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setConnections((prev) => prev.filter((c) => c.fromNode !== nodeId && c.toNode !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [selectedNodeId]);

  // ── Update node config ──
  const handleUpdateNode = useCallback((nodeId, updates) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, ...updates } : n))
    );
  }, []);

  // ── New flow ──
  const handleNewFlow = useCallback(() => {
    const newFlow = {
      id: `flow_${Date.now()}`,
      name: `Flow ${flows.length + 1}`,
      description: "",
      enabled: false,
      nodes: [],
      connections: [],
      lastRun: null,
      runCount: 0,
    };
    setFlows((prev) => [...prev, newFlow]);
    setActiveFlowId(newFlow.id);
    setNodes([]);
    setConnections([]);
    setSelectedNodeId(null);
  }, [flows.length]);

  // ── Save flow ──
  const handleSaveFlow = useCallback(async () => {
    if (!activeFlowId) return;
    setSaveStatus("saving");

    try {
      const flowsDbId = await ensureFlowsDb();
      if (!flowsDbId) {
        setSaveStatus("error");
        return;
      }

      const currentFlow = flows.find((f) => f.id === activeFlowId);
      const updatedFlow = {
        ...currentFlow,
        nodes,
        connections,
      };

      const savedId = await saveFlow(user.workerUrl, user.notionKey, flowsDbId, updatedFlow);

      // Update flow in local state with the Notion page ID
      setFlows((prev) =>
        prev.map((f) =>
          f.id === activeFlowId
            ? { ...updatedFlow, id: savedId || f.id }
            : f
        )
      );

      // If the ID changed (new flow got a Notion page ID), update activeFlowId
      if (savedId && savedId !== activeFlowId) {
        setActiveFlowId(savedId);
      }

      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(null), 2000);
    } catch (err) {
      console.error("[NodeEditor] Save failed:", err);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus(null), 3000);
    }
  }, [activeFlowId, flows, nodes, connections, user, ensureFlowsDb]);

  // ── Run flow (manual execution with visual trace) ──
  const handleRunFlow = useCallback(async () => {
    if (!activeFlowId || isRunning) return;
    setIsRunning(true);
    setExecutionStates({});

    try {
      // Dynamic import to avoid circular deps
      const { executeFlow } = await import("../agent/flowExecutor.js");

      await executeFlow(
        { nodes, connections },
        {
          workerUrl: user.workerUrl,
          notionKey: user.notionKey,
          claudeKey: user.claudeKey,
          notifDbId: platformIds.notifDbId,
          rulesDbId: platformIds.rulesDbId,
        },
        {}, // context data (empty for manual trigger)
        // onNodeStart
        (nodeId) => {
          setExecutionStates((prev) => ({ ...prev, [nodeId]: "running" }));
        },
        // onNodeComplete
        (nodeId, result, status) => {
          setExecutionStates((prev) => ({ ...prev, [nodeId]: status }));
          // Clear glow after 3 seconds
          setTimeout(() => {
            setExecutionStates((prev) => {
              const next = { ...prev };
              if (next[nodeId] === status) delete next[nodeId];
              return next;
            });
          }, 3000);
        }
      );
    } catch (err) {
      console.error("[NodeEditor] Flow execution error:", err);
    } finally {
      setIsRunning(false);
    }
  }, [activeFlowId, isRunning, nodes, connections, user, platformIds]);

  // ── Delete flow ──
  const handleDeleteFlow = useCallback(async (flowId) => {
    // Archive in Notion if it's a persisted flow (not a temp ID)
    const isNotion = flowId && !flowId.startsWith("flow_");
    if (isNotion && user?.workerUrl && user?.notionKey) {
      try {
        await deleteFlow(user.workerUrl, user.notionKey, flowId);
      } catch (err) {
        console.error("[NodeEditor] Failed to archive flow:", err);
      }
    }
    setFlows((prev) => prev.filter((f) => f.id !== flowId));
    if (activeFlowId === flowId) {
      setActiveFlowId(null);
      setNodes([]);
      setConnections([]);
      setSelectedNodeId(null);
    }
    setConfirmDelete(null);
  }, [activeFlowId, user]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        // Don't delete if editing an input
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
        if (selectedNodeId) {
          e.preventDefault();
          handleDeleteNode(selectedNodeId);
        }
      }
      if (e.key === "Escape") {
        setSelectedNodeId(null);
        setDraftConnection(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNodeId, handleDeleteNode]);

  // ── Render ──

  // No active flow selected — show empty state
  if (!activeFlowId) {
    return (
      <div style={{ display: "flex", flex: 1, height: "100%", fontFamily: FONT }}>
        <FlowListPanel
          flows={flows}
          activeFlowId={activeFlowId}
          onSelect={setActiveFlowId}
          onNew={handleNewFlow}
          onDelete={(id) => setConfirmDelete(id)}
        />
        <EmptyState onNew={handleNewFlow} />
        {confirmDelete && (
          <ConfirmDialog
            title="Delete Flow"
            message={`Are you sure you want to delete "${flows.find((f) => f.id === confirmDelete)?.name || "Untitled Flow"}"? This action cannot be undone.`}
            confirmLabel="Delete"
            onConfirm={() => handleDeleteFlow(confirmDelete)}
            onCancel={() => setConfirmDelete(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flex: 1, height: "100%", fontFamily: FONT }}>
      {/* Flow list sidebar */}
      <FlowListPanel
        flows={flows}
        activeFlowId={activeFlowId}
        onSelect={setActiveFlowId}
        onNew={handleNewFlow}
        onDelete={(id) => setConfirmDelete(id)}
      />

      {/* Main canvas area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Palette toolbar */}
        <NodePalette
          onAddNode={handleAddNode}
          onRun={handleRunFlow}
          onSave={handleSaveFlow}
          saveStatus={saveStatus}
          isRunning={isRunning}
        />

        {/* Canvas */}
        <NodeCanvas
          nodes={nodes}
          connections={connections}
          selectedNodeId={selectedNodeId}
          executionStates={executionStates}
          draftConnection={draftConnection}
          zoom={zoom}
          pan={pan}
          onZoomChange={setZoom}
          onPanChange={setPan}
          onCanvasClick={handleCanvasClick}
          onNodeSelect={handleNodeSelect}
          onNodeMove={handleMoveNode}
          onPortMouseDown={handlePortMouseDown}
          onPortMouseUp={handlePortMouseUp}
          onMouseMoveCanvas={handleMouseMoveCanvas}
          onMouseUpCanvas={handleMouseUpCanvas}
        />
      </div>

      {/* Config panel (when node selected) */}
      {selectedNode && (
        <NodeConfigPanel
          node={selectedNode}
          onChange={handleUpdateNode}
          onDelete={handleDeleteNode}
          onClose={() => setSelectedNodeId(null)}
        />
      )}

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete Flow"
          message={`Are you sure you want to delete "${flows.find((f) => f.id === confirmDelete)?.name || "Untitled Flow"}"? This action cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => handleDeleteFlow(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
