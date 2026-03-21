// ─── Flow Executor ───
// Converts a node graph into an execution plan and runs it.
// Supports visual trace callbacks for the node editor UI.

import { expandTemplate } from "./automations.js";
import { updatePage, createPage } from "../notion/client.js";
import * as api from "../lib/api.js";
import { safeJSON } from "../utils/helpers.js";
import { executeSandbox, executePluginSandbox } from "./toolExecutor.js";

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
 * Handles both object and array outputs from upstream nodes.
 */
function gatherInputs(node, connections, nodeOutputs) {
  const incomingConns = connections.filter((c) => c.toNode === node.id);

  // Single upstream: pass output directly (preserves arrays)
  if (incomingConns.length === 1) {
    const output = nodeOutputs[incomingConns[0].fromNode];
    if (output && typeof output === "object") return output;
    return {};
  }

  // Multiple upstream: merge objects, key arrays by port label
  let merged = {};
  for (const conn of incomingConns) {
    const output = nodeOutputs[conn.fromNode];
    if (!output || typeof output !== "object") continue;
    if (Array.isArray(output)) {
      // Find the port label to use as key
      const fromPort = conn.fromPort || conn.fromNode;
      merged[fromPort] = output;
    } else {
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
          result = await executeTransform(node, inputs);
          break;

        default:
          result = inputs;
      }

      nodeOutputs[node.id] = result;
      onNodeComplete?.(node.id, result, "success");

      // Small delay for visual trace
      await sleep(200);

    } catch (err) {
      // Retry logic: if node has retryCount > 0, retry with exponential backoff
      const retryCount = node.config?.retryCount || 0;
      let retried = false;
      let lastError = err;

      if (retryCount > 0) {
        for (let attempt = 1; attempt <= retryCount; attempt++) {
          await sleep(500 * Math.pow(2, attempt - 1)); // 500ms, 1s, 2s...
          try {
            const inputs = gatherInputs(node, connections, nodeOutputs);
            let result;
            switch (node.type) {
              case "action": result = await executeAction(node, inputs, opts); break;
              case "transform": result = await executeTransform(node, inputs); break;
              default: result = inputs;
            }
            nodeOutputs[node.id] = result;
            onNodeComplete?.(node.id, result, "success");
            retried = true;
            break;
          } catch (retryErr) {
            lastError = retryErr;
            if (attempt === retryCount) {
              console.error(`[FlowExecutor] Node "${node.label}" failed after ${retryCount} retries:`, retryErr);
            }
          }
        }
      }

      if (!retried) {
        console.error(`[FlowExecutor] Node "${node.label}" (${node.id}) failed:`, lastError);
        nodeOutputs[node.id] = { _error: lastError.message };
        onNodeComplete?.(node.id, null, "error");
      }
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
      await api.createNotification({
        message,
        type: node.config.type || "notification",
        source: `flow:${node.label}`,
      });
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

    case "do": {
      // Flexible action node — uses resolved config from AI interpretation
      const resolved = node.config?.resolvedConfig || {};
      const actionType = resolved.action_type;
      const actionCfg = resolved.action_config || {};

      switch (actionType) {
        case "send_email": {
          const to = expandTemplate(actionCfg.to || "", templateData);
          const subject = expandTemplate(actionCfg.subject || "", templateData);
          const body = expandTemplate(actionCfg.body || "", templateData);
          // Use the existing send_email flow via API
          try {
            await api.createNotification({
              message: `Email to ${to}: ${subject}`,
              type: "summary",
              source: `flow:${node.label}`,
            });
          } catch (err) { console.warn("[flowExecutor] createNotification:", err.message || err); }
          return { _action: "email_composed", to, subject, body, ...inputs };
        }
        case "create_page": {
          const properties = safeJSON(JSON.stringify(actionCfg.properties || {}), {});
          const expanded = {};
          for (const [key, val] of Object.entries(properties)) {
            expanded[key] = typeof val === "string" ? expandTemplate(val, templateData) : val;
          }
          if (actionCfg.databaseId) {
            const notionProps = {};
            for (const [key, val] of Object.entries(expanded)) {
              if (typeof val === "string") {
                notionProps[key] = { rich_text: [{ type: "text", text: { content: val } }] };
              }
            }
            try {
              const page = await createPage(workerUrl, notionKey, actionCfg.databaseId, notionProps);
              return { _action: "page_created", pageId: page.id, ...expanded, ...inputs };
            } catch (err) {
              return { _action: "create_page_failed", error: err.message, ...inputs };
            }
          }
          return { _action: "create_page", properties: expanded, ...inputs };
        }
        case "update_page": {
          const properties = safeJSON(JSON.stringify(actionCfg.properties || {}), {});
          const expanded = {};
          for (const [key, val] of Object.entries(properties)) {
            expanded[key] = typeof val === "string" ? expandTemplate(val, templateData) : val;
          }
          return { _action: "update_page", properties: expanded, ...inputs };
        }
        case "post_notification": {
          const message = expandTemplate(actionCfg.message || "", templateData);
          await api.createNotification({
            message,
            type: actionCfg.type || "notification",
            source: `flow:${node.label}`,
          });
          return { _action: "notification_sent", message, ...inputs };
        }
        case "query_database": {
          // Query a database and pass results downstream
          try {
            const rows = await api.listRows(actionCfg.databaseId, { limit: 100 });
            return { _action: "database_queried", rows: rows.rows || [], count: (rows.rows || []).length, ...inputs };
          } catch (err) {
            return { _action: "query_failed", error: err.message, ...inputs };
          }
        }
        case "run_agent": {
          // Placeholder — agent execution would need Claude proxy
          return { _action: "agent_prompt", prompt: actionCfg.prompt || "", ...inputs };
        }
        default:
          return { _action: "do_unknown", actionType, ...inputs };
      }
    }

    default:
      return { _action: node.subtype, ...inputs };
  }
}

/**
 * Execute a transform node (template expansion or function execution).
 */
async function executeTransform(node, inputs) {
  if (node.subtype === "execute_function") {
    return await executeFunctionNode(node, inputs);
  }
  if (node.subtype === "execute_plugin") {
    return await executePluginNode(node, inputs);
  }
  const template = node.config?.template || "";
  const result = expandTemplate(template, inputs);
  return { ...inputs, result, _transformed: true };
}

/**
 * Execute a custom function node in a flow.
 * Fetches the function from D1, runs it in the sandbox, returns result.
 */
async function executeFunctionNode(node, inputs) {
  const { functionId } = node.config || {};
  if (!functionId) throw new Error("No function selected for this node.");

  const fn = await api.getCustomFunction(functionId);
  if (!fn || fn._error) throw new Error(`Function not found: ${functionId}`);

  // Build datasets from upstream inputs — pass them as a single dataset
  const datasets = {};
  if (inputs && typeof inputs === "object") {
    // If upstream provides named datasets, use them directly
    // Otherwise wrap the full input as "data"
    const keys = Object.keys(inputs);
    if (keys.length > 0) {
      // Check if inputs look like raw data (has results array) or named datasets
      if (inputs.results && Array.isArray(inputs.results)) {
        datasets.data = inputs.results;
      } else {
        Object.assign(datasets, inputs);
      }
    }
  }

  const execStart = Date.now();
  const result = executeSandbox(fn.code, datasets, fn.description || fn.name);
  const durationMs = Date.now() - execStart;

  // Log execution to audit trail (non-blocking)
  try {
    api.createFunctionExecution({
      function_id: functionId,
      function_name: fn.name || "",
      trigger_source: "flow",
      status: result.success ? "success" : "error",
      input_summary: JSON.stringify({ datasets: Object.keys(datasets) }),
      output_summary: JSON.stringify({ type: typeof result.result }),
      duration_ms: durationMs,
      error: result.success ? "" : "execution failed",
    }).catch(err => console.warn("[flowExecutor] createFunctionExecution:", err.message || err));
  } catch { /* ignore */ }

  if (!result.success) throw new Error(`Function "${fn.name}" execution failed`);

  // Wrap result with output key if configured (for chained pipelines)
  if (node.config?.outputKey) {
    return { ...inputs, [node.config.outputKey]: result.result, _functionResult: true };
  }
  return { ...inputs, result: result.result, _functionResult: true };
}

/**
 * Execute a plugin node in a flow.
 * Fetches the plugin from D1, runs with extended sandbox, passes config.
 */
async function executePluginNode(node, inputs) {
  const { pluginId } = node.config || {};
  if (!pluginId) throw new Error("No plugin selected for this node.");

  const fn = await api.getCustomFunction(pluginId);
  if (!fn || fn._error) throw new Error(`Plugin not found: ${pluginId}`);

  const meta = typeof fn.meta === "string" ? JSON.parse(fn.meta) : fn.meta;
  const manifest = meta?.manifest || {};

  // Build datasets from upstream inputs
  const datasets = {};
  if (inputs && typeof inputs === "object") {
    if (inputs.results && Array.isArray(inputs.results)) {
      datasets.data = inputs.results;
    } else {
      Object.assign(datasets, inputs);
    }
  }

  // Build config from manifest defaults + node overrides
  const pluginConfig = {};
  if (manifest.ui?.configSchema) {
    for (const [k, v] of Object.entries(manifest.ui.configSchema)) pluginConfig[k] = v.default ?? null;
  }
  if (node.config?.config) Object.assign(pluginConfig, node.config.config);

  const execStart = Date.now();
  const result = executePluginSandbox(fn.code, datasets, manifest, pluginConfig, fn.description || fn.name);
  const durationMs = Date.now() - execStart;

  // Log execution (non-blocking)
  try {
    api.createFunctionExecution({
      function_id: pluginId,
      function_name: fn.name || "",
      trigger_source: "flow",
      status: result.success ? "success" : "error",
      input_summary: JSON.stringify({ datasets: Object.keys(datasets) }),
      output_summary: JSON.stringify({ type: typeof result.result }),
      duration_ms: durationMs,
      error: result.success ? "" : "execution failed",
    }).catch(err => console.warn("[flowExecutor] createFunctionExecution:", err.message || err));
  } catch { /* ignore */ }

  if (!result.success) throw new Error(`Plugin "${fn.name}" execution failed`);

  // Handle data+view output
  const output = result.result;
  const finalResult = output?.viewSpec ? output.data : output;

  if (node.config?.outputKey) {
    return { ...inputs, [node.config.outputKey]: finalResult, _functionResult: true };
  }
  return { ...inputs, result: finalResult, _functionResult: true };
}

/**
 * Async sleep for visual trace delays.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
