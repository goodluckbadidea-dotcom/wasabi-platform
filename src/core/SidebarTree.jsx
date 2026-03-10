// --- Sidebar Tree ---
// Recursive expandable tree for workspace > folder > page > view navigation.
// Supports: expand/collapse, inline rename, drag-drop move, right-click context menu.

import React, { useState, useRef, useCallback } from "react";
import { C, FONT, RADIUS, VIEW_PALETTE } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import {
  IconDiamond, IconFolder, IconGlobe, IconGrid, IconChevronDown, IconTrash,
} from "../design/icons.jsx";
import InlineEdit from "./InlineEdit.jsx";
import { isNeuronsMode, dispatchNeuronSelect } from "../neurons/NeuronsContext.jsx";
import NeuronBadge from "../neurons/NeuronBadge.jsx";

// --- View type labels for tree display ---
const VIEW_SHORT = {
  table: "Table", gantt: "Gantt", calendar: "Calendar", cardGrid: "Cards",
  kanban: "Kanban", charts: "Charts", form: "Form", document: "Doc",
  summaryTiles: "Summary", activityFeed: "Activity", notificationFeed: "Notifs",
  linked_sheet: "Sheet", sheet: "Sheet", chat: "Chat",
};

// --- Get folder color from VIEW_PALETTE ---
function getFolderColor(node) {
  const idx = node.colorIndex ?? 0;
  return VIEW_PALETTE[idx % VIEW_PALETTE.length]?.hex || C.darkMuted;
}

// --- Node icon selector ---
function NodeIcon({ node, isActive, size = 10 }) {
  const nt = node.nodeType || node.type;
  if (nt === "workspace") return <IconGlobe size={size} color={isActive ? "#fff" : C.darkMuted} />;
  if (nt === "dashboard") return <IconGrid size={size} color={isActive ? "#fff" : C.darkMuted} />;
  if (nt === "folder") {
    const col = getFolderColor(node);
    return <div style={{ width: 7, height: 7, borderRadius: "50%", background: col, flexShrink: 0 }} />;
  }
  if (nt === "view") {
    return <div style={{ width: 4, height: 4, borderRadius: "50%", background: isActive ? "#fff" : C.darkBorder, flexShrink: 0 }} />;
  }
  // page
  return <IconDiamond size={7} color={isActive ? "#fff" : C.darkBorder} />;
}

// --- Can a node expand? ---
function isExpandable(node) {
  const nt = node.nodeType || node.type;
  if (nt === "workspace" || nt === "folder") return true;
  if (nt === "page" || nt === "dashboard") return (node.viewChildren?.length || 0) > 0;
  return false;
}

// --- Recursive TreeNode ---
function TreeNode({
  node, depth, activePage, activeViewIndex,
  onNavigate, onSetActiveView, onRename, onDelete, onContextMenu,
  expanded, onToggleExpand, collapsed, searchQuery, dragState, onDragStart, onDragOver, onDragEnd,
}) {
  const [hovered, setHovered] = useState(false);
  const nt = node.nodeType || node.type;
  const indent = depth * 14;

  // Active state
  const isActive = nt === "view"
    ? activePage === node.parentPageId && activeViewIndex === node.viewIndex
    : activePage === node.id;

  const expandable = isExpandable(node);
  const isExpanded = expanded;

  // Search filter: if searchQuery and name doesn't match, skip
  // (parent is responsible for filtering)

  const handleClick = useCallback((e) => {
    if ((e.metaKey || e.ctrlKey) && isNeuronsMode() && nt !== "view") {
      e.preventDefault();
      e.stopPropagation();
      dispatchNeuronSelect({ node_type: nt, node_id: node.id, node_label: node.name || "Untitled" });
      return;
    }
    if (nt === "view") {
      onNavigate(node.parentPageId);
      onSetActiveView?.(node.parentPageId, node.viewIndex);
    } else if (nt === "workspace" || nt === "folder") {
      onToggleExpand(node.id);
    } else {
      onNavigate(node.id);
    }
  }, [node, nt, onNavigate, onSetActiveView, onToggleExpand]);

  const isDragging = dragState?.nodeId === node.id;
  const isDropTarget = dragState?.overNodeId === node.id && dragState?.nodeId !== node.id;

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          position: "relative",
          opacity: isDragging ? 0.4 : 1,
          borderTop: isDropTarget ? `2px solid ${C.accent}` : "2px solid transparent",
          transition: "opacity 0.12s",
        }}
        draggable={!collapsed && nt !== "view"}
        onDragStart={(e) => {
          if (nt === "view") return;
          onDragStart?.(node, e);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          onDragOver?.(node);
        }}
        onDragEnd={() => onDragEnd?.()}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onContextMenu={(e) => {
          if (nt === "view") return;
          e.preventDefault();
          e.stopPropagation();
          onContextMenu?.(e, node);
        }}
      >
        <button
          onClick={handleClick}
          style={{
            flex: 1,
            border: "none",
            cursor: "pointer",
            outline: "none",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: collapsed
              ? "8px 0"
              : `6px 10px 6px ${8 + indent}px`,
            background: isActive ? C.accent : hovered ? C.darkSurf2 : "transparent",
            fontFamily: FONT,
            transition: "background 0.1s",
            width: "100%",
            justifyContent: collapsed ? "center" : "flex-start",
            minHeight: nt === "view" ? 24 : 30,
            borderRadius: 0,
          }}
        >
          {/* Expand/collapse chevron */}
          {!collapsed && expandable && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(node.id);
              }}
              style={{
                display: "flex", alignItems: "center", cursor: "pointer",
                transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                transition: "transform 0.12s",
                flexShrink: 0, width: 10,
              }}
            >
              <IconChevronDown size={7} color={isActive ? "#fff" : C.darkMuted} />
            </span>
          )}
          {!collapsed && !expandable && <span style={{ width: 10, flexShrink: 0 }} />}

          {/* Node icon */}
          {!collapsed && <NodeIcon node={node} isActive={isActive} />}

          {/* Label */}
          {!collapsed && nt !== "view" && (
            <InlineEdit
              value={node.name || "Untitled"}
              onCommit={(newName) => onRename?.(node, newName)}
              placeholder="Untitled"
              fontSize={nt === "workspace" ? 11 : 12}
              fontWeight={isActive ? 600 : nt === "workspace" ? 600 : 400}
              color={isActive ? "#fff" : C.darkText}
              style={nt === "workspace" ? {
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              } : undefined}
            />
          )}
          {!collapsed && nt === "view" && (
            <span style={{
              fontSize: 11, fontWeight: isActive ? 600 : 400,
              color: isActive ? "#fff" : C.darkMuted,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {node.name || VIEW_SHORT[node.viewType] || node.viewType}
            </span>
          )}

          {/* Neuron badge */}
          {!collapsed && nt !== "view" && <NeuronBadge nodeId={node.id} />}

          {/* Active dot or delete button */}
          {!collapsed && isActive && !hovered && (
            <div style={{
              marginLeft: "auto", width: 4, height: 4, borderRadius: "50%",
              background: "#fff", flexShrink: 0, boxShadow: "0 0 3px rgba(255,255,255,0.4)",
            }} />
          )}
          {!collapsed && hovered && nt !== "view" && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete?.(node); }}
              title="Delete"
              style={{
                marginLeft: "auto", background: "none", border: "none",
                cursor: "pointer", padding: 2, display: "flex", alignItems: "center",
                opacity: 0.4, transition: "opacity 0.12s", outline: "none", flexShrink: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; }}
            >
              <IconTrash size={8} color={isActive ? "#fff" : C.darkMuted} />
            </button>
          )}
        </button>
      </div>

      {/* Children: child folders → child pages → view children */}
      {isExpanded && !collapsed && (
        <>
          {(node.childFolders || []).map((child) => (
            <TreeNodeWrapper key={child.id} node={child} depth={depth + 1}
              activePage={activePage} activeViewIndex={activeViewIndex}
              onNavigate={onNavigate} onSetActiveView={onSetActiveView}
              onRename={onRename} onDelete={onDelete} onContextMenu={onContextMenu}
              collapsed={collapsed} searchQuery={searchQuery}
              dragState={dragState} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}
            />
          ))}
          {(node.children || []).map((child) => (
            <TreeNodeWrapper key={child.id} node={child} depth={depth + 1}
              activePage={activePage} activeViewIndex={activeViewIndex}
              onNavigate={onNavigate} onSetActiveView={onSetActiveView}
              onRename={onRename} onDelete={onDelete} onContextMenu={onContextMenu}
              collapsed={collapsed} searchQuery={searchQuery}
              dragState={dragState} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}
            />
          ))}
        </>
      )}
    </>
  );
}

// --- Wrapper that reads expand state from context ---
function TreeNodeWrapper(props) {
  const { expandedNodes, toggleExpand } = usePlatform();
  const expanded = expandedNodes.has(props.node.id);

  // For pages with view children: auto-expand if active
  const autoExpanded = props.activePage === props.node.id && (props.node.viewChildren?.length || 0) > 0;

  return (
    <>
      <TreeNode
        {...props}
        expanded={expanded || autoExpanded}
        onToggleExpand={toggleExpand}
      />
      {/* Render view children for pages (only if expanded or active) */}
      {(expanded || autoExpanded) && (props.node.viewChildren || []).map((viewNode) => (
        <TreeNode
          key={viewNode.id}
          node={viewNode}
          depth={props.depth + 1}
          activePage={props.activePage}
          activeViewIndex={props.activeViewIndex}
          onNavigate={props.onNavigate}
          onSetActiveView={props.onSetActiveView}
          onRename={props.onRename}
          onDelete={props.onDelete}
          onContextMenu={props.onContextMenu}
          expanded={false}
          onToggleExpand={() => {}}
          collapsed={props.collapsed}
          searchQuery={props.searchQuery}
          dragState={props.dragState}
          onDragStart={props.onDragStart}
          onDragOver={props.onDragOver}
          onDragEnd={props.onDragEnd}
        />
      ))}
    </>
  );
}

// --- Main SidebarTree ---
export default function SidebarTree({
  activePage,
  activeViewIndex,
  onNavigate,
  onSetActiveView,
  onRename,
  onDelete,
  onContextMenu,
  collapsed,
  searchQuery,
}) {
  const { pageTree } = usePlatform();
  const [dragState, setDragState] = useState(null);
  const { updatePageConfig } = usePlatform();

  const handleDragStart = useCallback((node, e) => {
    setDragState({ nodeId: node.id, overNodeId: null });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.id);
  }, []);

  const handleDragOver = useCallback((node) => {
    setDragState((prev) => prev ? { ...prev, overNodeId: node.id } : null);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragState?.nodeId && dragState?.overNodeId && dragState.nodeId !== dragState.overNodeId) {
      // Move the dragged node into the drop target (if target is a folder/workspace)
      updatePageConfig(dragState.nodeId, { parentId: dragState.overNodeId });
    }
    setDragState(null);
  }, [dragState, updatePageConfig]);

  // Filter tree by search query
  const filteredTree = searchQuery ? filterTree(pageTree, searchQuery.toLowerCase()) : pageTree;

  if (filteredTree.length === 0 && !collapsed) {
    return (
      <div style={{
        padding: "20px 16px", fontFamily: FONT,
        fontSize: 11, color: C.darkMuted, textAlign: "center",
      }}>
        {searchQuery ? "No results found" : "No workspaces yet"}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", paddingTop: 2, paddingBottom: 4 }}>
      {filteredTree.map((node) => (
        <TreeNodeWrapper
          key={node.id}
          node={node}
          depth={0}
          activePage={activePage}
          activeViewIndex={activeViewIndex}
          onNavigate={onNavigate}
          onSetActiveView={onSetActiveView}
          onRename={onRename}
          onDelete={onDelete}
          onContextMenu={onContextMenu}
          collapsed={collapsed}
          searchQuery={searchQuery}
          dragState={dragState}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        />
      ))}
    </div>
  );
}

// --- Filter tree by search query ---
function filterTree(nodes, query) {
  return nodes
    .map((node) => {
      const nameMatch = (node.name || "").toLowerCase().includes(query);
      const filteredChildFolders = filterTree(node.childFolders || [], query);
      const filteredChildren = (node.children || []).filter((c) =>
        (c.name || "").toLowerCase().includes(query)
      );
      if (nameMatch || filteredChildFolders.length > 0 || filteredChildren.length > 0) {
        return {
          ...node,
          childFolders: nameMatch ? (node.childFolders || []) : filteredChildFolders,
          children: nameMatch ? (node.children || []) : filteredChildren,
        };
      }
      return null;
    })
    .filter(Boolean);
}
