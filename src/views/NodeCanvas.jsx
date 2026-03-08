// ─── Node Canvas ───
// Infinite SVG canvas with dot-grid background, pan, and zoom.
// Renders nodes and connections as SVG elements.
// Pan: middle-click or space+left-click drag.
// Zoom: mouse wheel.

import React, { useState, useCallback, useRef, useEffect } from "react";
import { C } from "../design/tokens.js";
import NodeRenderer, { getPortPosition, NODE_WIDTH, getNodeHeight } from "./NodeRenderer.jsx";
import { ConnectionLine, DraftConnection } from "./ConnectionRenderer.jsx";

// ── Constants ──
const DOT_SPACING = 20;
const DOT_RADIUS = 1;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.08;
const GRID_SIZE = 10000; // virtual grid extent

export default function NodeCanvas({
  nodes,
  connections,
  selectedNodeId,
  executionStates,
  draftConnection,
  zoom,
  pan,
  onZoomChange,
  onPanChange,
  onCanvasClick,
  onNodeSelect,
  onNodeMove,
  onPortMouseDown,
  onPortMouseUp,
  onMouseMoveCanvas,
  onMouseUpCanvas,
  children,
}) {
  const svgRef = useRef(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);

  // ── Space key tracking for space+drag pan ──
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const handleKeyUp = (e) => {
      if (e.code === "Space") {
        setSpaceHeld(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // ── Zoom toward cursor ──
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + delta));
    const scale = newZoom / zoom;

    // Zoom toward cursor position
    const newPanX = mouseX - scale * (mouseX - pan.x);
    const newPanY = mouseY - scale * (mouseY - pan.y);

    onZoomChange(newZoom);
    onPanChange({ x: newPanX, y: newPanY });
  }, [zoom, pan, onZoomChange, onPanChange]);

  // Attach wheel listener with passive: false for preventDefault
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // ── Pan handlers ──
  const handlePanStart = useCallback((e) => {
    // Middle-click or Space+Left-click to pan
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    }
  }, [pan, spaceHeld]);

  useEffect(() => {
    if (!isPanning) return;

    const handleMouseMove = (e) => {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      onPanChange({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      });
    };
    const handleMouseUp = () => setIsPanning(false);

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isPanning, onPanChange]);

  // ── Node drag ──
  const dragRef = useRef(null);

  const handleNodeMouseDown = useCallback((e, nodeId) => {
    if (e.button !== 0 || spaceHeld) return;
    e.stopPropagation();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    onNodeSelect(nodeId);

    dragRef.current = {
      nodeId,
      startX: e.clientX,
      startY: e.clientY,
      origX: node.x,
      origY: node.y,
    };

    const handleMouseMove = (ev) => {
      if (!dragRef.current) return;
      const dx = (ev.clientX - dragRef.current.startX) / zoom;
      const dy = (ev.clientY - dragRef.current.startY) / zoom;
      onNodeMove(dragRef.current.nodeId, dragRef.current.origX + dx, dragRef.current.origY + dy);
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [nodes, zoom, onNodeSelect, onNodeMove, spaceHeld]);

  // ── Canvas click (deselect) ──
  const handleSvgClick = useCallback((e) => {
    // Only deselect if clicking on the background (not a node)
    if (e.target === svgRef.current || e.target.tagName === "rect" && e.target.getAttribute("fill")?.startsWith("url(")) {
      onCanvasClick?.();
    }
  }, [onCanvasClick]);

  // ── Convert screen coords to canvas coords ──
  const screenToCanvas = useCallback((clientX, clientY) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    };
  }, [pan, zoom]);

  // ── Mouse move/up forwarding for draft connections ──
  const handleCanvasMouseMove = useCallback((e) => {
    if (onMouseMoveCanvas) {
      const pos = screenToCanvas(e.clientX, e.clientY);
      onMouseMoveCanvas(pos);
    }
  }, [onMouseMoveCanvas, screenToCanvas]);

  const handleCanvasMouseUp = useCallback((e) => {
    if (onMouseUpCanvas) {
      onMouseUpCanvas();
    }
  }, [onMouseUpCanvas]);

  // Resolve connection endpoints
  const resolveConnection = useCallback((conn) => {
    const fromNode = nodes.find((n) => n.id === conn.fromNode);
    const toNode = nodes.find((n) => n.id === conn.toNode);
    if (!fromNode || !toNode) return null;
    return {
      fromPos: getPortPosition(fromNode, conn.fromPort),
      toPos: getPortPosition(toNode, conn.toPort),
    };
  }, [nodes]);

  // Draft connection "from" position
  const draftFromPos = draftConnection
    ? (() => {
        const fromNode = nodes.find((n) => n.id === draftConnection.fromNode);
        return fromNode ? getPortPosition(fromNode, draftConnection.fromPort) : null;
      })()
    : null;

  const cursorStyle = isPanning ? "grabbing"
    : spaceHeld ? "grab"
    : draftConnection ? "crosshair"
    : "default";

  return (
    <div
      style={{
        flex: 1,
        overflow: "hidden",
        position: "relative",
        background: C.dark,
      }}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ cursor: cursorStyle, display: "block" }}
        onMouseDown={handlePanStart}
        onClick={handleSvgClick}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Dot grid background */}
          <defs>
            <pattern
              id="dotgrid"
              width={DOT_SPACING}
              height={DOT_SPACING}
              patternUnits="userSpaceOnUse"
            >
              <circle
                cx={DOT_SPACING / 2}
                cy={DOT_SPACING / 2}
                r={DOT_RADIUS}
                fill={C.darkBorder}
                opacity={0.5}
              />
            </pattern>
          </defs>
          <rect
            x={-GRID_SIZE / 2}
            y={-GRID_SIZE / 2}
            width={GRID_SIZE}
            height={GRID_SIZE}
            fill="url(#dotgrid)"
          />

          {/* Connections layer (below nodes) */}
          {connections.map((conn) => {
            const positions = resolveConnection(conn);
            if (!positions) return null;
            return (
              <ConnectionLine
                key={conn.id}
                fromPos={positions.fromPos}
                toPos={positions.toPos}
                isActive={false}
                executionState={
                  // Wire glows if both connected nodes succeeded
                  executionStates?.[conn.fromNode] === "success" && executionStates?.[conn.toNode] === "success"
                    ? "success"
                    : executionStates?.[conn.toNode] === "error"
                    ? "error"
                    : executionStates?.[conn.fromNode] === "running" || executionStates?.[conn.toNode] === "running"
                    ? "running"
                    : null
                }
              />
            );
          })}

          {/* Draft connection (while drawing) */}
          {draftFromPos && draftConnection?.mousePos && (
            <DraftConnection
              fromPos={draftFromPos}
              mousePos={draftConnection.mousePos}
            />
          )}

          {/* Nodes layer */}
          {nodes.map((node) => (
            <NodeRenderer
              key={node.id}
              node={node}
              isSelected={selectedNodeId === node.id}
              executionState={executionStates?.[node.id] || null}
              onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
              onPortMouseDown={(nodeId, portId, direction) => onPortMouseDown?.(nodeId, portId, direction)}
              onPortMouseUp={(nodeId, portId, direction) => onPortMouseUp?.(nodeId, portId, direction)}
            />
          ))}
        </g>
      </svg>

      {/* Zoom controls overlay */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          right: 16,
          display: "flex",
          gap: 4,
          background: C.darkSurf2,
          borderRadius: 8,
          border: `1px solid ${C.darkBorder}`,
          padding: 4,
        }}
      >
        <button
          onClick={() => onZoomChange(Math.max(MIN_ZOOM, zoom - ZOOM_STEP * 2))}
          style={getZoomBtnStyle()}
          title="Zoom out"
        >
          −
        </button>
        <span
          style={{
            padding: "4px 8px",
            fontSize: 11,
            color: C.darkMuted,
            fontFamily: "Outfit, sans-serif",
            minWidth: 40,
            textAlign: "center",
          }}
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => onZoomChange(Math.min(MAX_ZOOM, zoom + ZOOM_STEP * 2))}
          style={getZoomBtnStyle()}
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => { onZoomChange(1); onPanChange({ x: 0, y: 0 }); }}
          style={{ ...getZoomBtnStyle(), fontSize: 10, padding: "4px 8px" }}
          title="Reset view"
        >
          ⟳
        </button>
      </div>

      {/* Additional overlays from parent */}
      {children}
    </div>
  );
}

function getZoomBtnStyle() {
  return {
    background: "transparent",
    border: "none",
    color: C.darkText,
    fontSize: 14,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: 4,
    fontFamily: "Outfit, sans-serif",
    outline: "none",
  };
}
