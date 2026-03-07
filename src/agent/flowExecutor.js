// ─── Flow Executor ───
// Converts a node graph into an execution plan and runs it.
// Supports visual trace callbacks for the node editor UI.

import { expandTemplate } from "./automations.js";
import { postNotification, updatePage, createPage } from "../notion/client.js";
import { safeJSON } from "../utils/helpers.js";

/**
 * Topologically sort nodes starting from trigger nodes,
 * following connections. Returns ordered execution plan.
 */
export function buildExecutionPlan(nodes, connections) {
  // Find trigger nodes (no input ports or no incoming connections)
  const triggerNodes = nodes.filter(
    (n) => n.type === "trigger" || (n.ports?.in?.length === 0)
  );

  // Build adjacency map: nodeId -> [{ node, fromPort, toPort }]
  const adjacency = {};
  for (const conn of connections) {
    if (!adjacency[conn.fromNode]) adjacency[conn.fromNode] = [];
    adjacency[conn.fromNode].push({
      toNode: conn.toNode,
      fromPort: conn.fromPort,
      toPort: conn.toPort,
    });
  }

  // BFS from triggers
  const visited = new Set();
  const plan = [];
  const queue = [...triggerNodes];

  while (queue.length > 0) {
    const node = queue.shift();
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    plan.push(node);

    const neighbors = adjacency[node.id] || [];
    for (const edge of neighbors) {
      const nextNode = nodes.find((n) => n.id === edge.toNode);
      if (nextNode && !visited.has(nextNode.id)) {
        queue.push(nextNode);
      }
    }
  }

  return plan;
}

/**
 * Evaluate a condition node against input data.
 */
function evaluateCondition(config, inputData) {
  const { field, operator, value } = config;
  if (!field) return { branch: "true", data: inputData };

  const fieldValue = inputData?.[field] ?? "";
  const testValue = value ?? "";

  let result = false;
  switch (operator) {
    case "equals":
      result = String(fieldValue) === String(testValue);
      break;
    case "not_equals":
      result = String(fieldValue) !== String(testValue);
      break;
    case "contains":
      result = String(fieldValue).toLowerCase().includes(String(testValue).toLowerCase());
      break;
    case "gt":
      result = Number(fieldValue) > Number(testValue);
      break;
    case "lt":
      result = Number(fieldValue) < Number(testValue);
      break;
    default:
      result = String(fieldValue) === String(testValue);
  }

  return {
    branch: result ? "true" : "false",
    data: inputData,
  };
}

/**
 * Gather inputs for a node from upstream node outputs.
 */
function gatherInputs(node, connections, nodeOutputs) {
  const incomingConns = connections.filter((c) => c.toNode === node.id);
  let merged = {};

  for (const conn of incomingConns) {
    const output = nodeOutputs[conn.fromNode];
    if (output && typeof output === "object") {
      merged = { ...merged, ...output };
    }
  }

  return merged;
}

/**
 * Find which output port a connection comes from (for condition branching).
 */
function getFromPortLabel(connections, fromNodeId, toNodeId) {
  const conn = connections.find((c) => c.fromNode === fromNodeId && c.toNode === toNodeId);
  if (!conn) return null;
  return conn.fromPort;
}

/**
 * Execute a flow graph with visual trace callbacks.
 *
 * @param {object} flow - { nodes, connections }
 * @param {object} opts - { workerUrl, notionKey, claudeKey, notifDbId, rulesDbId }
 * @param {object} contextData - Trigger context (matched pages, etc.)
 * @param {Function} onNodeStart - (nodeId) => void
 * @param {Function} onNodeComplete - (nodeId, result, "success"|"error") => void
 * @returns {Promise<object>} - { nodeOutputs, status }
 */
export async function executeFlow(flow, opts, contextData, onNodeStart, onNodeComplete) {
  const { nodes, connections } = flow;
  const plan = buildExecutionPlan(nodes, connections);
  const nodeOutputs = {};
  const skippedNodes = new Set();

  // Build adjacency for port label lookups
  const adjacency = {};
  for (const conn of connections) {
    if (!adjacency[conn.fromNode]) adjacency[conn.fromNode] = [];
    adjacency[conn.fromNode].push(conn);
  }

  for (const node of plan) {
    // Skip nodes on inactive condition branches
    if (skippedNodes.has(node.id)) {
      onNodeComplete?.(node.id, null, "success"); // silently pass
      continue;
    }

    onNodeStart?.(node.id);

    try {
      const inputs = gatherInputs(node, connections, nodeOutputs);
      let result;

      switch (node.type) {
        case "trigger":
          // Trigger just passes through context data
          result = { ...contextData, ...inputs, _trigger: node.subtype };
          break;

        case "condition": {
          const condResult = evaluateCondition(node.config, inputs);
          result = condResult.data;

          // Mark downstream nodes on the INACTIVE branch to be skipped
          const activeBranch = condResult.branch; // "true" or "false"
          const outConns = adjacency[node.id] || [];

          for (const conn of outConns) {
            // Find the port this connection comes from
            const portLabel = (node.ports?.out || []).find((p) => p.id === conn.fromPort)?.label;
            if (portLabel && portLabel !== activeBranch) {
              // Skip all nodes downstream of the inactive branch
              markDownstream(conn.toNode, nodes, connections, skippedNodes);
            }
          }
          break;
        }

        case "action":
          result = await executeAction(node, inputs, opts);
          break;

        case "transform":
          result = executeTransform(node, inputs);
          break;

        default:
          result = inputs;
      }

      nodeOutputs[node.id] = result;
      onNodeComplete?.(node.id, result, "success");

      // Small delay for visual trace
      await sleep(200);

    } catch (err) {
      console.error(`[FlowExecutor] Node "${node.label}" (${node.id}) failed:`, err);
      nodeOutputs[node.id] = { _error: err.message };
      onNodeComplete?.(node.id, null, "error");
    }
  }

  return { nodeOutputs, status: "completed" };
}

/**
 * Mark all downstream nodes from a starting node as skipped (BFS).
 */
function markDownstream(startNodeId, nodes, connections, skippedSet) {
  const queue = [startNodeId];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (skippedSet.has(nodeId)) continue;
    skippedSet.add(nodeId);
    const outConns = connections.filter((c) => c.fromNode === nodeId);
    for (const conn of outConns) {
      queue.push(conn.toNode);
    }
  }
}

/**
 * Execute an action node.
 */
async function executeAction(node, inputs, opts) {
  const { workerUrl, notionKey, notifDbId } = opts;
  const templateData = { ...inputs };

  switch (node.subtype) {
    case "post_notification": {
      const message = expandTemplate(node.config.message || "", templateData);
      if (notifDbId) {
        await postNotification(workerUrl, notionKey, notifDbId, {
          message,
          type: node.config.type || "notification",
          source: `flow:${node.label}`,
        });
      }
      return { _action: "notification_sent", message };
    }

    case "update_page": {
      const properties = safeJSON(node.config.properties, {});
      // Expand template variables in property values
      const expanded = {};
      for (const [key, val] of Object.entries(properties)) {
        expanded[key] = typeof val === "string" ? expandTemplate(val, templateData) : val;
      }
      // Note: In a real flow, we'd need a pageId from upstream data
      // For now, return the expanded properties as output
      return { _action: "update_page", properties: expanded, ...inputs };
    }

    case "create_page": {
      const properties = safeJSON(node.config.properties, {});
      const expanded = {};
      for (const [key, val] of Object.entries(properties)) {
        expanded[key] = typeof val === "string" ? expandTemplate(val, templateData) : val;
      }
      if (node.config.databaseId) {
        // Build Notion property format
        const notionProps = {};
        for (const [key, val] of Object.entries(expanded)) {
          if (typeof val === "string") {
            notionProps[key] = { rich_text: [{ type: "text", text: { content: val } }] };
          }
        }
        try {
          const page = await createPage(workerUrl, notionKey, node.config.databaseId, notionProps);
          return { _action: "page_created", pageId: page.id, ...expanded };
        } catch (err) {
          return { _action: "create_page_failed", error: err.message };
        }
      }
      return { _action: "create_page", properties: expanded };
    }

    default:
      return { _action: node.subtype, ...inputs };
  }
}

/**
 * Execute a transform node (template expansion).
 */
function executeTransform(node, inputs) {
  const template = node.config?.template || "";
  const result = expandTemplate(template, inputs);
  return { ...inputs, result, _transformed: true };
}

/**
 * Async sleep for visual trace delays.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
