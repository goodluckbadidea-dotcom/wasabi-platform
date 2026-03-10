// ─── Network Graph ───
// Force-directed graph visualization of automations + neurons.
// Canvas-based rendering with real-time activation highlighting.
// Nodes: automation rules + neuron clusters.
// Edges: connections between linked items.

import React, { useEffect, useRef, useState, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import * as api from "../lib/api.js";

// ── Physics constants ──
const REPULSION = 800;
const SPRING_K = 0.04;
const SPRING_LEN = 120;
const DAMPING = 0.9;
const CENTER_GRAVITY = 0.01;
const DT = 0.8;
const MIN_VEL = 0.01;

// ── Node types & colors ──
// Use theme accent + wasabi green for the graph
const WASABI = "#7DC143";
function getNodeColor(type) {
  if (type === "automation") return C.accent;
  if (type === "neuron") return WASABI;
  if (type === "page") return C.accentDim || C.accent;
  return C.darkMuted;
}

const NODE_RADIUS = {
  automation: 18,
  neuron: 14,
  page: 10,
};

// ── Force simulation ──
function createSimulation(nodes, edges, width, height) {
  // Initialize positions in a circle around the canvas center
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(Math.max(80, nodes.length * 18), Math.min(width, height) * 0.35);

  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    n.x = cx + r * Math.cos(angle) + (Math.random() - 0.5) * 20;
    n.y = cy + r * Math.sin(angle) + (Math.random() - 0.5) * 20;
    n.vx = 0;
    n.vy = 0;
    n.fx = 0;
    n.fy = 0;
  });

  return { nodes, edges };
}

function tick(sim, width, height) {
  const { nodes, edges } = sim;
  const centerX = width / 2;
  const centerY = height / 2;

  // Reset forces
  nodes.forEach((n) => { n.fx = 0; n.fy = 0; });

  // Repulsion (all pairs)
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = REPULSION / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.fx -= fx;
      a.fy -= fy;
      b.fx += fx;
      b.fy += fy;
    }
  }

  // Spring attraction (edges)
  edges.forEach((e) => {
    const a = nodes.find((n) => n.id === e.source);
    const b = nodes.find((n) => n.id === e.target);
    if (!a || !b) return;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const displacement = dist - SPRING_LEN;
    const force = SPRING_K * displacement;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    a.fx += fx;
    a.fy += fy;
    b.fx -= fx;
    b.fy -= fy;
  });

  // Center gravity
  nodes.forEach((n) => {
    n.fx += (centerX - n.x) * CENTER_GRAVITY;
    n.fy += (centerY - n.y) * CENTER_GRAVITY;
  });

  // Integrate
  let totalVel = 0;
  nodes.forEach((n) => {
    n.vx = (n.vx + n.fx * DT) * DAMPING;
    n.vy = (n.vy + n.fy * DT) * DAMPING;
    n.x += n.vx * DT;
    n.y += n.vy * DT;
    totalVel += Math.abs(n.vx) + Math.abs(n.vy);
  });

  return totalVel / nodes.length;
}

// ── Render ──
function render(ctx, sim, width, height, hoveredNode, activeNodes, dpr) {
  ctx.clearRect(0, 0, width * dpr, height * dpr);
  ctx.save();
  ctx.scale(dpr, dpr);

  const { nodes, edges } = sim;

  // Draw edges with gradients (accent → wasabi green)
  edges.forEach((e) => {
    const a = nodes.find((n) => n.id === e.source);
    const b = nodes.find((n) => n.id === e.target);
    if (!a || !b) return;

    const isActive = activeNodes.has(a.id) || activeNodes.has(b.id);

    // Create gradient from source node color to target node color
    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    const colA = getNodeColor(a.type);
    const colB = getNodeColor(b.type);
    if (isActive) {
      grad.addColorStop(0, colA + "BB");
      grad.addColorStop(1, colB + "BB");
    } else {
      grad.addColorStop(0, colA + "44");
      grad.addColorStop(1, colB + "44");
    }

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = grad;
    ctx.lineWidth = isActive ? 2.5 : 1.2;
    ctx.stroke();

    // Directional arrow
    if (e.directed) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const r = NODE_RADIUS[b.type] || 12;
      const arrowX = b.x - (dx / dist) * (r + 4);
      const arrowY = b.y - (dy / dist) * (r + 4);
      const angle = Math.atan2(dy, dx);
      const arrowSize = 6;

      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(
        arrowX - arrowSize * Math.cos(angle - Math.PI / 6),
        arrowY - arrowSize * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        arrowX - arrowSize * Math.cos(angle + Math.PI / 6),
        arrowY - arrowSize * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fillStyle = isActive ? colB + "BB" : colB + "44";
      ctx.fill();
    }
  });

  // Draw nodes
  nodes.forEach((n) => {
    const r = NODE_RADIUS[n.type] || 12;
    const color = getNodeColor(n.type);
    const isActive = activeNodes.has(n.id);
    const isHovered = hoveredNode?.id === n.id;

    // Glow for active nodes
    if (isActive) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 8, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r + 8);
      grad.addColorStop(0, color + "55");
      grad.addColorStop(1, color + "00");
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Node circle
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? color : color + "33";
    ctx.fill();
    ctx.strokeStyle = isHovered ? "#fff" : color;
    ctx.lineWidth = isHovered ? 2.5 : 1.5;
    ctx.stroke();

    // Icon character
    const icon = n.type === "automation" ? "\u26A1" : n.type === "neuron" ? "\u25C6" : "\u25CF";
    ctx.font = `${r * 0.8}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = isActive ? "#fff" : color;
    ctx.fillText(icon, n.x, n.y);

    // Label
    ctx.font = `${isHovered ? 11 : 10}px 'Outfit', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = isHovered ? C.darkText : C.darkMuted;
    const label = n.label.length > 18 ? n.label.slice(0, 16) + "..." : n.label;
    ctx.fillText(label, n.x, n.y + r + 5);
  });

  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════════
// NetworkGraph Component
// ════════════════════════════════════════════════════════════════════════════

export default function NetworkGraph({ automationEngine }) {
  const canvasRef = useRef(null);
  const simRef = useRef(null);
  const animRef = useRef(null);
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [activeNodes, setActiveNodes] = useState(new Set());
  const [stats, setStats] = useState({ automations: 0, neurons: 0, edges: 0 });
  const [dragNode, setDragNode] = useState(null);
  const sizeRef = useRef({ width: 800, height: 600 });

  // Load data and build graph
  useEffect(() => {
    let cancelled = false;

    async function loadGraph() {
      setLoading(true);
      try {
        const [rulesResult, graphResult] = await Promise.all([
          api.listRules().catch(() => ({ rules: [] })),
          api.getNeuronGraph().catch(() => ({ neurons: [], edges: [] })),
        ]);

        if (cancelled) return;

        const rules = rulesResult.rules || [];
        const neurons = graphResult.neurons || [];
        const neuronEdges = graphResult.edges || [];

        // Build nodes
        const nodes = [];
        const edges = [];

        // Automation nodes
        rules.forEach((rule) => {
          nodes.push({
            id: `auto_${rule.id}`,
            label: rule.name || "Untitled Rule",
            type: "automation",
            data: rule,
          });
        });

        // Neuron nodes
        neurons.forEach((neuron) => {
          nodes.push({
            id: `neuron_${neuron.id}`,
            label: neuron.name || "Untitled Neuron",
            type: "neuron",
            data: neuron,
          });

          // Edges from neuron to its page nodes
          (neuron.nodes || []).forEach((pageNode) => {
            const pageId = `page_${pageNode.node_id}`;
            if (!nodes.find((n) => n.id === pageId)) {
              nodes.push({
                id: pageId,
                label: pageNode.node_label || "Page",
                type: "page",
                data: pageNode,
              });
            }
            edges.push({
              source: `neuron_${neuron.id}`,
              target: pageId,
              directed: false,
            });
          });
        });

        // Neuron-to-neuron edges
        neuronEdges.forEach((e) => {
          edges.push({
            source: `neuron_${e.source}`,
            target: `neuron_${e.target}`,
            directed: false,
          });
        });

        // Automation to related nodes (if they have target_page_id or similar)
        rules.forEach((rule) => {
          if (rule.config) {
            try {
              const cfg = typeof rule.config === "string" ? JSON.parse(rule.config) : rule.config;
              if (cfg.target_page_id) {
                const pageId = `page_${cfg.target_page_id}`;
                if (!nodes.find((n) => n.id === pageId)) {
                  nodes.push({ id: pageId, label: "Target Page", type: "page", data: {} });
                }
                edges.push({ source: `auto_${rule.id}`, target: pageId, directed: true });
              }
            } catch {}
          }
        });

        if (cancelled) return;

        setStats({
          automations: rules.length,
          neurons: neurons.length,
          edges: edges.length,
        });

        // Create simulation (use current canvas size or fallback)
        if (nodes.length > 0) {
          const { width, height } = sizeRef.current;
          const sim = createSimulation(nodes, edges, width || 800, height || 600);
          simRef.current = sim;
        } else {
          simRef.current = null;
        }
      } catch (err) {
        console.warn("Failed to load network graph:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadGraph();
    return () => { cancelled = true; };
  }, []);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        sizeRef.current = { width, height };
        const canvas = canvasRef.current;
        if (canvas) {
          const dpr = window.devicePixelRatio || 1;
          canvas.width = width * dpr;
          canvas.height = height * dpr;
          canvas.style.width = `${width}px`;
          canvas.style.height = `${height}px`;
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [loading]);

  // Animation loop
  useEffect(() => {
    if (loading || !simRef.current) return;

    let running = true;
    let settled = false;
    let settleCount = 0;

    function animate() {
      if (!running) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      const { width, height } = sizeRef.current;
      const dpr = window.devicePixelRatio || 1;

      if (!settled) {
        const avgVel = tick(simRef.current, width, height);
        if (avgVel < MIN_VEL) {
          settleCount++;
          if (settleCount > 30) settled = true;
        } else {
          settleCount = 0;
        }
      }

      render(ctx, simRef.current, width, height, hoveredNode, activeNodes, dpr);
      animRef.current = requestAnimationFrame(animate);
    }

    animate();
    return () => {
      running = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [loading, hoveredNode, activeNodes]);

  // Real-time activation from automation engine
  useEffect(() => {
    if (!automationEngine) return;

    const originalOnFired = automationEngine.onRuleFired;
    automationEngine.onRuleFired = (rule, result) => {
      originalOnFired?.(rule, result);
      const nodeId = `auto_${rule.id}`;
      setActiveNodes((prev) => new Set([...prev, nodeId]));

      // Clear after 3 seconds
      setTimeout(() => {
        setActiveNodes((prev) => {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
      }, 3000);
    };

    return () => {
      automationEngine.onRuleFired = originalOnFired;
    };
  }, [automationEngine]);

  // Mouse interaction
  const findNode = useCallback((e) => {
    if (!simRef.current || !canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (const node of simRef.current.nodes) {
      const r = NODE_RADIUS[node.type] || 12;
      const dx = mx - node.x;
      const dy = my - node.y;
      if (dx * dx + dy * dy <= (r + 4) * (r + 4)) {
        return node;
      }
    }
    return null;
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (dragNode) {
      const rect = canvasRef.current.getBoundingClientRect();
      dragNode.x = e.clientX - rect.left;
      dragNode.y = e.clientY - rect.top;
      dragNode.vx = 0;
      dragNode.vy = 0;
      return;
    }
    const node = findNode(e);
    setHoveredNode(node);
    if (canvasRef.current) {
      canvasRef.current.style.cursor = node ? "pointer" : "default";
    }
  }, [findNode, dragNode]);

  const handleMouseDown = useCallback((e) => {
    const node = findNode(e);
    if (node) {
      setDragNode(node);
    }
  }, [findNode]);

  const handleMouseUp = useCallback(() => {
    setDragNode(null);
  }, []);

  if (loading) {
    return (
      <div style={{
        height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        color: C.darkMuted, fontSize: 12, fontFamily: FONT,
      }}>
        Loading network graph...
      </div>
    );
  }

  if (!simRef.current || simRef.current.nodes.length === 0) {
    return (
      <div style={{
        height: "100%", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 12, padding: 40,
      }}>
        <div style={{ fontSize: 36, opacity: 0.3 }}>&#9671;</div>
        <div style={{ fontSize: 13, color: C.darkMuted, fontFamily: FONT, textAlign: "center" }}>
          No automations or neurons found.
        </div>
        <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, textAlign: "center", maxWidth: 300 }}>
          Create automation rules or neuron connections to see them visualized here as an interactive network graph.
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Stats bar */}
      <div style={{
        flexShrink: 0, padding: "10px 20px", borderBottom: `1px solid ${C.darkBorder}`,
        display: "flex", gap: 16, alignItems: "center",
      }}>
        <Stat label="Automations" value={stats.automations} color={getNodeColor("automation")} />
        <Stat label="Neurons" value={stats.neurons} color={getNodeColor("neuron")} />
        <Stat label="Connections" value={stats.edges} color={C.darkMuted} />
        {hoveredNode && (
          <span style={{
            marginLeft: "auto", fontSize: 11, color: C.darkText, fontFamily: FONT,
          }}>
            {hoveredNode.label} ({hoveredNode.type})
          </span>
        )}
      </div>

      {/* Canvas */}
      <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { setHoveredNode(null); setDragNode(null); }}
          style={{ display: "block", width: "100%", height: "100%" }}
        />

        {/* Legend */}
        <div style={{
          position: "absolute", bottom: 12, left: 12,
          background: C.darkSurf + "DD", border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.lg, padding: "8px 12px",
          display: "flex", gap: 12,
        }}>
          {[
            { color: getNodeColor("automation"), label: "Automation" },
            { color: getNodeColor("neuron"), label: "Neuron" },
            { color: getNodeColor("page"), label: "Page" },
          ].map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.color }} />
              <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>{label}:</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: C.darkText, fontFamily: FONT }}>{value}</span>
    </div>
  );
}
