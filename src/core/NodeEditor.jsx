// ─── Node Editor ───
// Main orchestrator: flow list sidebar + node palette + canvas + config panel.
// Visual automation builder with drag-and-drop nodes and wire connections.

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { C, FONT, FONT_DISPLAY, MONO, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { uuid, timeAgo } from "../utils/helpers.js";
import NodeCanvas from "../views/NodeCanvas.jsx";
import NodeConfigPanel from "../views/NodeConfigPanel.jsx";
import { NODE_WIDTH, NODE_TYPE_COLORS, getNodeHeight } from "../views/NodeRenderer.jsx";
import {
  IconPlay, IconDatabase, IconCalendar, IconBolt, IconCondition,
  IconEdit, IconPlus, IconBell, IconTransform, IconTrash, IconClose,
  IconFunction, IconBrain, IconMail, IconWasabiNode,
} from "../design/icons.jsx";
import { loadCachedFlows, saveFlow, loadFlows, deleteFlow } from "../config/flowStorage.js";
import * as api from "../lib/api.js";
import ConfirmDialog from "./ConfirmDialog.jsx";
import InlineEdit from "./InlineEdit.jsx";

// ── Node Palette Definition ──

const NODE_PALETTE = [
  { type: "trigger",   subtype: "when",              label: "When",         Icon: IconWasabiNode, category: "Triggers" },
  { type: "trigger",   subtype: "status_change",    label: "DB Change",    Icon: IconDatabase,  category: "Triggers" },
  { type: "trigger",   subtype: "schedule",          label: "Schedule",     Icon: IconCalendar,  category: "Triggers" },
  { type: "trigger",   subtype: "manual",            label: "Manual",       Icon: IconBolt,      category: "Triggers" },
  { type: "condition", subtype: "field_check",        label: "Condition",    Icon: IconCondition, category: "Logic" },
  { type: "action",    subtype: "do",                  label: "Do",           Icon: IconBolt,      category: "Actions" },
  { type: "action",    subtype: "update_page",        label: "Update",       Icon: IconEdit,      category: "Actions" },
  { type: "action",    subtype: "create_page",        label: "Create",       Icon: IconPlus,      category: "Actions" },
  { type: "action",    subtype: "post_notification",  label: "Notify",       Icon: IconBell,      category: "Actions" },
  { type: "action",    subtype: "send_email",          label: "Email",        Icon: IconMail,      category: "Actions" },
  { type: "transform", subtype: "template",           label: "Template",     Icon: IconTransform, category: "Transform" },
  { type: "transform", subtype: "execute_function",    label: "Function",     Icon: IconFunction,  category: "Transform" },
  { type: "transform", subtype: "execute_plugin",      label: "Plugin",       Icon: IconBrain,     category: "Transform" },
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
    case "when":
      return { description: "", databaseId: "", databaseName: "", resolved: false, resolvedConfig: null };
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
    case "do":
      return { description: "", resolved: false, resolvedConfig: null };
    case "send_email":
      return { description: "", to: "", subject: "" };
    case "template":
      return { template: "" };
    case "execute_function":
      return { functionId: "", functionName: "" };
    case "execute_plugin":
      return { pluginId: "", pluginName: "", config: {} };
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

function FlowListPanel({ flows, activeFlowId, onSelect, onNew, onDelete, onRename, rules, onDeleteRule, collapsed }) {
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
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: C.darkText,
          fontFamily: FONT,
        }}>
          Flows
        </span>
        <button
          onClick={onNew}
          style={{
            background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
            border: "none",
            borderRadius: RADIUS.lg,
            padding: "5px 12px",
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
                borderRadius: RADIUS.pill,
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
                  background: flow.enabled ? C.accent : C.darkBorder,
                  flexShrink: 0,
                }} />
                <InlineEdit
                  value={flow.name || ""}
                  onCommit={(newName) => onRename(flow.id, newName)}
                  placeholder="Untitled Flow"
                  fontSize={12}
                  fontWeight={isActive ? 600 : 400}
                  color={isActive ? "#fff" : C.darkText}
                />
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

        {/* ── Rules Section ── */}
        {rules && rules.length > 0 && (
          <>
            <div style={{
              padding: "12px 16px 6px",
              borderTop: `1px solid ${C.darkBorder}`,
              marginTop: 8,
            }}>
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.15em",
                color: C.darkMuted,
                fontFamily: FONT,
              }}>
                Rules
              </span>
            </div>
            {rules.map((rule) => {
              const isHovered = hoveredId === `rule_${rule.id}`;
              return (
                <div
                  key={`rule_${rule.id}`}
                  onMouseEnter={() => setHoveredId(`rule_${rule.id}`)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "calc(100% - 12px)",
                    margin: "2px 6px",
                    borderRadius: RADIUS.pill,
                    background: isHovered ? C.darkSurf2 : "transparent",
                    transition: "background 0.1s",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flex: 1,
                      padding: "8px 12px",
                      fontFamily: FONT,
                      minWidth: 0,
                    }}
                  >
                    <IconBolt size={10} color={rule.enabled ? C.accent : C.darkBorder} />
                    <span style={{
                      fontSize: 12,
                      color: C.darkText,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>
                      {rule.name || "Untitled Rule"}
                    </span>
                  </div>
                  {isHovered && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteRule?.(rule.id); }}
                      title="Delete rule"
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
                      <IconTrash size={12} color={C.darkMuted} />
                    </button>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// ── Node Palette Toolbar ──

// ── Execution History Panel ──

function ExecutionHistoryPanel({ executions, loading, onClose, onReplay }) {
  const STATUS_COLORS = {
    completed: C.accent,
    running: "#70AAF0",
    failed: "#DA4060",
  };

  return (
    <div style={{
      position: "absolute",
      bottom: 0, left: 0, right: 0,
      maxHeight: 220,
      background: C.darkSurf,
      borderTop: `1px solid ${C.darkBorder}`,
      display: "flex", flexDirection: "column",
      zIndex: 20,
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 14px",
        borderBottom: `1px solid ${C.darkBorder}`,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#fff", fontFamily: FONT, flex: 1 }}>
          Execution History
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: C.darkMuted, fontSize: 14, padding: 2, outline: "none",
          }}
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 14px 10px" }}>
        {loading ? (
          <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>Loading...</span>
        ) : executions.length === 0 ? (
          <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>No executions yet. Run the flow to see history.</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {executions.map((exec) => {
              const statusColor = STATUS_COLORS[exec.status] || C.darkMuted;
              const nodeStates = exec.node_states || {};
              const nodeCount = Object.keys(nodeStates).length;
              const successCount = Object.values(nodeStates).filter((s) => s === "success").length;
              const errorCount = Object.values(nodeStates).filter((s) => s === "error").length;
              const duration = exec.completed_at && exec.started_at
                ? Math.round((new Date(exec.completed_at) - new Date(exec.started_at)) / 1000)
                : null;

              return (
                <div
                  key={exec.id}
                  onClick={() => onReplay(exec)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "6px 10px",
                    borderRadius: RADIUS.sm,
                    background: C.darkBg,
                    cursor: "pointer",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = C.darkBg; }}
                >
                  {/* Status dot */}
                  <span style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: statusColor, flexShrink: 0,
                  }} />

                  {/* Time */}
                  <span style={{ fontSize: 10, color: "#fff", fontFamily: MONO, minWidth: 65 }}>
                    {timeAgo(exec.started_at)}
                  </span>

                  {/* Status label */}
                  <span style={{
                    fontSize: 8, fontWeight: 600, fontFamily: FONT,
                    color: statusColor,
                    background: statusColor + "18",
                    padding: "2px 6px", borderRadius: 3,
                    textTransform: "uppercase", letterSpacing: "0.04em",
                  }}>
                    {exec.status}
                  </span>

                  {/* Trigger source */}
                  <span style={{
                    fontSize: 8, fontFamily: MONO, color: C.darkMuted,
                    background: C.darkSurf2, padding: "1px 5px", borderRadius: 2,
                    textTransform: "uppercase",
                  }}>
                    {exec.trigger_source}
                  </span>

                  {/* Node progress */}
                  {nodeCount > 0 && (
                    <span style={{ fontSize: 10, fontFamily: MONO, color: C.darkMuted }}>
                      {successCount}/{nodeCount} nodes
                      {errorCount > 0 && <span style={{ color: C.error }}> ({errorCount} err)</span>}
                    </span>
                  )}

                  {/* Duration */}
                  {duration !== null && (
                    <span style={{ fontSize: 10, fontFamily: MONO, color: C.darkMuted, marginLeft: "auto" }}>
                      {duration}s
                    </span>
                  )}

                  {/* Error snippet */}
                  {exec.error && (
                    <span style={{
                      fontSize: 10, fontFamily: MONO, color: C.error,
                      flex: 1, overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: "nowrap", maxWidth: 200,
                    }}>
                      {exec.error}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Node Palette ──

function FlowDatabaseBar({ databaseId, databaseName, onUpdate, pages }) {
  const dbPages = (pages || []).filter(
    (p) => p.type !== "folder" && p.page_type !== "dashboard" && p.page_type !== "workspace"
  );

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "6px 12px",
      background: C.darkBg,
      borderBottom: `1px solid ${C.darkBorder}`,
      flexShrink: 0,
    }}>
      <IconDatabase size={12} color={databaseId ? C.accent : C.darkMuted} />
      <span style={{
        fontSize: 10, fontWeight: 600, textTransform: "uppercase",
        letterSpacing: "0.08em", color: C.darkMuted, fontFamily: FONT,
      }}>
        Flow Database
      </span>
      <select
        value={databaseId || ""}
        onChange={(e) => {
          const page = dbPages.find((p) => p.id === e.target.value);
          onUpdate(e.target.value, page?.title || page?.name || "");
        }}
        style={{
          flex: 1, maxWidth: 260,
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.sm, padding: "5px 8px",
          color: databaseId ? "#fff" : C.darkMuted,
          fontFamily: FONT, fontSize: 11, outline: "none",
          cursor: "pointer",
        }}
      >
        <option value="">No default database</option>
        {dbPages.map((p) => (
          <option key={p.id} value={p.id}>{p.title || p.name || p.id}</option>
        ))}
      </select>
      {databaseId && (
        <span style={{
          fontSize: 9, fontFamily: MONO, color: C.darkMuted,
          background: C.darkSurf2, padding: "2px 6px", borderRadius: 3,
        }}>
          {databaseName || databaseId.slice(0, 8)}
        </span>
      )}
    </div>
  );
}

function NodePalette({ onAddNode, onRun, onSave, saveStatus, isRunning, onToggleHistory, showHistory, onBuildWithWasabi, isBuildingWithWasabi }) {
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
              borderRadius: RADIUS.pill,
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
        color: saveStatus === "saved" ? C.accent
          : saveStatus === "saving" ? C.accent
          : saveStatus === "error" ? C.error
          : C.darkBorder,
        fontFamily: FONT,
        whiteSpace: "nowrap",
      }}>
        {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : saveStatus === "error" ? "Save failed" : ""}
      </span>

      {/* History button */}
      <button
        onClick={onToggleHistory}
        style={{
          padding: "5px 12px",
          background: showHistory ? C.accent + "18" : "transparent",
          border: `1px solid ${showHistory ? C.accent + "44" : C.darkBorder}`,
          borderRadius: RADIUS.pill,
          cursor: "pointer",
          outline: "none",
          fontFamily: FONT,
          fontSize: 11,
          color: showHistory ? C.accent : C.darkText,
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => { if (!showHistory) e.currentTarget.style.background = C.darkSurf2; }}
        onMouseLeave={(e) => { if (!showHistory) e.currentTarget.style.background = "transparent"; }}
      >
        History
      </button>

      {/* Build with Wasabi button */}
      <button
        onClick={onBuildWithWasabi}
        disabled={isBuildingWithWasabi}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "5px 12px",
          background: isBuildingWithWasabi ? C.accent + "18" : `linear-gradient(135deg, ${C.accent}20, ${C.accent}20)`,
          border: `1px solid ${C.accent}44`,
          borderRadius: RADIUS.pill,
          cursor: isBuildingWithWasabi ? "default" : "pointer",
          outline: "none",
          fontFamily: FONT,
          fontSize: 11,
          fontWeight: 600,
          color: C.accent,
          whiteSpace: "nowrap",
          opacity: isBuildingWithWasabi ? 0.7 : 1,
        }}
      >
        <IconWasabiNode size={12} color={C.accent} />
        {isBuildingWithWasabi ? "Interpreting..." : "Build with Wasabi"}
      </button>

      {/* Save button */}
      <button
        onClick={onSave}
        style={{
          padding: "5px 12px",
          background: "transparent",
          border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.pill,
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
          borderRadius: RADIUS.pill,
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
      <IconBolt size={40} color={C.darkBorder} />
      <div style={{ fontSize: 18, fontWeight: 600, color: C.darkText, fontFamily: FONT_DISPLAY }}>Node Automation Editor</div>
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
          padding: "8px 20px",
          background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
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
  const { user, platformIds, pages } = usePlatform();

  // ── Flow state ──
  const [flows, setFlows] = useState(() => loadCachedFlows());
  const [activeFlowId, setActiveFlowId] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [connections, setConnections] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [draftConnection, setDraftConnection] = useState(null);
  const [executionStates, setExecutionStates] = useState({});
  const [isRunning, setIsRunning] = useState(false);
  const [isBuildingWithWasabi, setIsBuildingWithWasabi] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [flowExecutions, setFlowExecutions] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Flow-level database ──
  const [flowDatabaseId, setFlowDatabaseId] = useState("");
  const [flowDatabaseName, setFlowDatabaseName] = useState("");

  // ── Rules state (simple automation rules from D1) ──
  const [rules, setRules] = useState([]);
  const [confirmDeleteRule, setConfirmDeleteRule] = useState(null);

  // ── Canvas state ──
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [saveStatus, setSaveStatus] = useState(null); // null | "saving" | "saved" | "error"
  const [confirmDelete, setConfirmDelete] = useState(null); // flow id to confirm deletion

  const canvasRef = useRef(null);

  // ── Load flows from D1 on mount ──
  useEffect(() => {
    if (!user?.workerUrl) return;
    loadFlows()
      .then((loaded) => {
        if (loaded.length > 0) setFlows(loaded);
      })
      .catch((err) => console.error("[NodeEditor] Failed to load flows:", err));
  }, [user?.workerUrl]);

  // ── Load rules from D1 on mount ──
  useEffect(() => {
    if (!user?.workerUrl) return;
    api.listRules()
      .then((result) => {
        const items = (result.rules || []).map((r) => ({
          id: r.id,
          name: r.name || "Untitled Rule",
          description: r.description || "",
          trigger: r.trigger_type || "",
          enabled: !!r.enabled,
        }));
        setRules(items);
      })
      .catch((err) => console.error("[NodeEditor] Failed to load rules:", err));
  }, [user?.workerUrl]);

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
      const currentFlow = flows.find((f) => f.id === activeFlowId);
      const updatedFlow = {
        ...currentFlow,
        nodes,
        connections,
      };

      const savedId = await saveFlow(updatedFlow);

      // Update flow in local state with the D1 ID
      setFlows((prev) =>
        prev.map((f) =>
          f.id === activeFlowId
            ? { ...updatedFlow, id: savedId || f.id }
            : f
        )
      );

      // If the ID changed (new flow got a D1 UUID), update activeFlowId
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
  }, [activeFlowId, flows, nodes, connections]);

  // ── Toggle execution history panel ──
  const handleToggleHistory = useCallback(() => {
    const nextState = !showHistory;
    setShowHistory(nextState);
    if (nextState && activeFlowId) {
      setHistoryLoading(true);
      api.listFlowExecutions({ flow_id: activeFlowId, limit: 20 })
        .then((res) => setFlowExecutions(res?.executions || []))
        .catch(() => setFlowExecutions([]))
        .finally(() => setHistoryLoading(false));
    }
  }, [showHistory, activeFlowId]);

  // ── Build with Wasabi (interpret plain English nodes) ──
  const handleBuildWithWasabi = useCallback(async () => {
    // Collect nodes that have plain English descriptions needing interpretation
    const plainEnglishNodes = nodes.filter((n) => {
      const c = n.config || {};
      if (n.subtype === "when" && c.description?.trim() && !c.resolved) return true;
      if (n.subtype === "do" && c.description?.trim() && !c.resolved) return true;
      if (n.subtype === "send_email" && c.description?.trim()) return true;
      if ((n.subtype === "update_page" || n.subtype === "create_page" || n.subtype === "post_notification") && c.description?.trim()) return true;
      return false;
    });

    if (plainEnglishNodes.length === 0) {
      alert("No plain English nodes to interpret. Add descriptions to your When or Action nodes first.");
      return;
    }

    setIsBuildingWithWasabi(true);

    try {
      const { runAgent } = await import("../agent/runAgent.js");
      const { WASABI_TOOLS } = await import("../agent/tools.js");
      const { buildWasabiPrompt } = await import("../agent/wasabiPrompt.js");
      const { createToolExecutor } = await import("../agent/toolExecutor.js");

      // Build scaffold prompt
      const lines = [
        "Interpret these automation node descriptions into structured configs.",
        "Use the interpret_automation_nodes tool to return the structured configurations.",
        "",
      ];

      if (flowDatabaseId) {
        lines.push(`Flow default database: "${flowDatabaseName}" (ID: ${flowDatabaseId})`);
        lines.push("");
      }

      plainEnglishNodes.forEach((node, i) => {
        const c = node.config || {};
        const dbHint = c.databaseId || flowDatabaseId;
        const dbNameHint = c.databaseName || flowDatabaseName;

        lines.push(`Node ${i + 1} (${node.subtype}, id: "${node.id}"):`);
        lines.push(`  Description: "${c.description}"`);
        if (dbHint) lines.push(`  Database: "${dbNameHint}" (ID: ${dbHint})`);

        if (node.subtype === "when") {
          lines.push(`  → Convert to: { trigger_type (schedule|status_change|field_change|page_created|manual), trigger_config }`);
        } else if (node.subtype === "update_page") {
          lines.push(`  → Convert to: { properties (JSON object of field:value pairs) }`);
        } else if (node.subtype === "create_page") {
          lines.push(`  → Convert to: { databaseId, properties (JSON) }`);
        } else if (node.subtype === "post_notification") {
          lines.push(`  → Convert to: { message (with {{variables}} if needed), type }`);
        } else if (node.subtype === "send_email") {
          lines.push(`  → Convert to: { to, subject, body }`);
        } else if (node.subtype === "do") {
          lines.push(`  → Convert to: { action_type (send_email|create_page|update_page|post_notification|query_database|run_agent), action_config }`);
          lines.push(`  Action types: send_email={to,subject,body}, create_page={databaseId,properties}, update_page={properties}, post_notification={message,type}, query_database={databaseId,query}, run_agent={prompt}`);
        }
        lines.push("");
      });

      const scaffold = lines.join("\n");

      // Run agent with the interpret tool
      const toolExecutor = createToolExecutor({
        workerUrl: user.workerUrl,
        notionKey: user.notionKey,
        claudeKey: user.claudeKey,
      });

      const result = await runAgent({
        prompt: scaffold,
        systemPrompt: buildWasabiPrompt({ pages: pages || [] }),
        tools: WASABI_TOOLS,
        toolExecutor,
        claudeKey: user.claudeKey,
        maxTurns: 3,
      });

      // Look for interpret_automation_nodes tool call results
      const toolResults = result?.toolResults || [];
      for (const tr of toolResults) {
        if (tr.toolName === "interpret_automation_nodes") {
          const parsed = typeof tr.result === "string" ? JSON.parse(tr.result) : tr.result;
          const interpretations = parsed?.interpretations || [];

          // Apply interpretations to nodes
          setNodes((prev) => prev.map((n) => {
            const interp = interpretations.find((ip) => ip.node_id === n.id);
            if (!interp) return n;

            if (n.subtype === "when") {
              return {
                ...n,
                config: {
                  ...n.config,
                  resolved: true,
                  resolvedConfig: {
                    trigger_type: interp.trigger_type,
                    trigger_config: interp.trigger_config || {},
                  },
                },
              };
            }

            if (n.subtype === "do") {
              return {
                ...n,
                config: {
                  ...n.config,
                  resolved: true,
                  resolvedConfig: {
                    action_type: interp.action_type || interp.config?.action_type,
                    action_config: interp.action_config || interp.config?.action_config || {},
                  },
                },
              };
            }

            // For other action nodes, merge the structured config
            return {
              ...n,
              config: { ...n.config, ...interp.config, resolved: true },
            };
          }));
        }
      }
    } catch (err) {
      console.error("[NodeEditor] Build with Wasabi failed:", err);
      alert("Failed to interpret nodes. Please try again.");
    } finally {
      setIsBuildingWithWasabi(false);
    }
  }, [nodes, flowDatabaseId, flowDatabaseName, user, pages]);

  // ── Run flow (manual execution with visual trace) ──
  const handleRunFlow = useCallback(async () => {
    if (!activeFlowId || isRunning) return;
    setIsRunning(true);
    setExecutionStates({});

    // Create flow execution record
    const activeFlow = flows.find((f) => f.id === activeFlowId);
    let execId = null;
    try {
      const res = await api.createFlowExecution({
        flow_id: activeFlowId,
        flow_name: activeFlow?.name || "Untitled",
        trigger_source: "manual",
      });
      execId = res?.id || null;
    } catch { /* non-blocking */ }

    const nodeStates = {};

    try {
      // Dynamic import to avoid circular deps
      const { executeFlow } = await import("../agent/flowExecutor.js");

      const result = await executeFlow(
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
          nodeStates[nodeId] = "running";
          setExecutionStates((prev) => ({ ...prev, [nodeId]: "running" }));
        },
        // onNodeComplete
        (nodeId, result, status) => {
          nodeStates[nodeId] = status;
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

      // Update flow execution record with success
      if (execId) {
        api.updateFlowExecution(execId, {
          status: "completed",
          node_states: nodeStates,
          completed_at: new Date().toISOString(),
        }).catch(err => console.warn("[NodeEditor] updateFlowExecution:", err.message || err));
      }
    } catch (err) {
      console.error("[NodeEditor] Flow execution error:", err);
      // Update flow execution record with failure
      if (execId) {
        api.updateFlowExecution(execId, {
          status: "failed",
          node_states: nodeStates,
          error: err.message,
          completed_at: new Date().toISOString(),
        }).catch(err2 => console.warn("[NodeEditor] updateFlowExecution:", err2.message || err2));
      }
    } finally {
      setIsRunning(false);
    }
  }, [activeFlowId, isRunning, nodes, connections, user, platformIds, flows]);

  // ── Delete flow ──
  const handleDeleteFlow = useCallback(async (flowId) => {
    // Delete from D1 if it's a persisted flow (not a temp ID)
    const isPersisted = flowId && !flowId.startsWith("flow_");
    if (isPersisted) {
      try {
        await deleteFlow(flowId);
      } catch (err) {
        console.error("[NodeEditor] Failed to delete flow:", err);
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
  }, [activeFlowId]);

  // ── Delete rule ──
  const handleDeleteRule = useCallback(async (ruleId) => {
    try {
      await api.deleteRule(ruleId);
    } catch (err) {
      console.error("[NodeEditor] Failed to delete rule:", err);
    }
    setRules((prev) => prev.filter((r) => r.id !== ruleId));
    setConfirmDeleteRule(null);
  }, []);

  // ── Rename flow ──
  const handleRenameFlow = useCallback((flowId, newName) => {
    setFlows((prev) => prev.map((f) => (f.id === flowId ? { ...f, name: newName } : f)));
    // Update localStorage cache
    try {
      const cached = loadCachedFlows();
      const updated = cached.map((f) => (f.id === flowId ? { ...f, name: newName } : f));
      localStorage.setItem("wasabi_flows", JSON.stringify(updated));
    } catch {}
  }, []);

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
          onRename={handleRenameFlow}
          rules={rules}
          onDeleteRule={(id) => setConfirmDeleteRule(id)}
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
        {confirmDeleteRule && (
          <ConfirmDialog
            title="Delete Rule"
            message={`Are you sure you want to delete "${rules.find((r) => r.id === confirmDeleteRule)?.name || "Untitled Rule"}"? This action cannot be undone.`}
            confirmLabel="Delete"
            onConfirm={() => handleDeleteRule(confirmDeleteRule)}
            onCancel={() => setConfirmDeleteRule(null)}
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
        onRename={handleRenameFlow}
        rules={rules}
        onDeleteRule={(id) => setConfirmDeleteRule(id)}
      />

      {/* Main canvas area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Flow database picker */}
        <FlowDatabaseBar
          databaseId={flowDatabaseId}
          databaseName={flowDatabaseName}
          onUpdate={(id, name) => { setFlowDatabaseId(id); setFlowDatabaseName(name); }}
          pages={pages}
        />

        {/* Palette toolbar */}
        <NodePalette
          onAddNode={handleAddNode}
          onRun={handleRunFlow}
          onSave={handleSaveFlow}
          saveStatus={saveStatus}
          isRunning={isRunning}
          onToggleHistory={handleToggleHistory}
          showHistory={showHistory}
          onBuildWithWasabi={handleBuildWithWasabi}
          isBuildingWithWasabi={isBuildingWithWasabi}
        />

        {/* Canvas */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
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

          {/* Execution History Sliding Panel */}
          {showHistory && (
            <ExecutionHistoryPanel
              executions={flowExecutions}
              loading={historyLoading}
              onClose={() => setShowHistory(false)}
              onReplay={(exec) => {
                // Overlay node states from a past execution
                const states = exec.node_states || {};
                setExecutionStates(states);
                setTimeout(() => setExecutionStates({}), 4000);
              }}
            />
          )}
        </div>
      </div>

      {/* Config panel (when node selected) */}
      {selectedNode && (
        <NodeConfigPanel
          node={selectedNode}
          onChange={handleUpdateNode}
          onDelete={handleDeleteNode}
          onClose={() => setSelectedNodeId(null)}
          defaultDatabaseId={flowDatabaseId}
          defaultDatabaseName={flowDatabaseName}
          pages={pages}
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
      {confirmDeleteRule && (
        <ConfirmDialog
          title="Delete Rule"
          message={`Are you sure you want to delete "${rules.find((r) => r.id === confirmDeleteRule)?.name || "Untitled Rule"}"? This action cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => handleDeleteRule(confirmDeleteRule)}
          onCancel={() => setConfirmDeleteRule(null)}
        />
      )}
    </div>
  );
}
