// ─── Automation Engine ───
// Server-side automation: rule evaluation, flow execution, trigger checks, neuron pruning.
// Extracted from worker.js — zero logic changes.

import { safeParseJSON, sleep } from '../utils.js';
import { CLAUDE_API } from '../schema.js';
import { executeSandboxServer, executeSandboxPluginServer } from '../handlers/custom-functions.js';
import { decryptSecret, encryptSecret } from '../crypto.js';

/**
 * Topologically sort nodes from trigger nodes via BFS (server-side mirror).
 */
function buildExecutionPlanServer(nodes, connections) {
  const triggerNodes = nodes.filter(
    (n) => n.type === "trigger" || (n.ports?.in?.length === 0)
  );
  const adjacency = {};
  for (const conn of connections) {
    if (!adjacency[conn.fromNode]) adjacency[conn.fromNode] = [];
    adjacency[conn.fromNode].push(conn);
  }
  const visited = new Set();
  const plan = [];
  const queue = [...triggerNodes];
  while (queue.length > 0) {
    const node = queue.shift();
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    plan.push(node);
    for (const edge of (adjacency[node.id] || [])) {
      const next = nodes.find((n) => n.id === edge.toNode);
      if (next && !visited.has(next.id)) queue.push(next);
    }
  }
  return plan;
}

/**
 * Gather inputs for a node from upstream outputs (server-side mirror).
 */
function gatherInputsServer(node, connections, nodeOutputs) {
  const incoming = connections.filter((c) => c.toNode === node.id);
  if (incoming.length === 1) {
    const output = nodeOutputs[incoming[0].fromNode];
    if (output && typeof output === "object") return output;
    return {};
  }
  let merged = {};
  for (const conn of incoming) {
    const output = nodeOutputs[conn.fromNode];
    if (!output || typeof output !== "object") continue;
    if (Array.isArray(output)) {
      merged[conn.fromPort || conn.fromNode] = output;
    } else {
      merged = { ...merged, ...output };
    }
  }
  return merged;
}

/**
 * Evaluate a condition node (server-side mirror).
 */
function evaluateConditionServer(config, inputData) {
  const { field, operator, value } = config;
  if (!field) return { branch: "true", data: inputData };
  const fieldValue = inputData?.[field] ?? "";
  const testValue = value ?? "";
  let result = false;
  switch (operator) {
    case "equals": result = String(fieldValue) === String(testValue); break;
    case "not_equals": result = String(fieldValue) !== String(testValue); break;
    case "contains": result = String(fieldValue).toLowerCase().includes(String(testValue).toLowerCase()); break;
    case "gt": result = Number(fieldValue) > Number(testValue); break;
    case "lt": result = Number(fieldValue) < Number(testValue); break;
    default: result = String(fieldValue) === String(testValue);
  }
  return { branch: result ? "true" : "false", data: inputData };
}

/**
 * Mark downstream nodes as skipped (server-side mirror).
 */
function markDownstreamServer(startNodeId, connections, skippedSet) {
  const queue = [startNodeId];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (skippedSet.has(nodeId)) continue;
    skippedSet.add(nodeId);
    for (const conn of connections.filter((c) => c.fromNode === nodeId)) {
      queue.push(conn.toNode);
    }
  }
}

/**
 * Execute a full flow graph server-side.
 * Mirrors client-side flowExecutor.js — handles triggers, conditions, transforms, and actions.
 *
 * @param {Array} nodes - Flow node definitions
 * @param {Array} connections - Flow edge definitions
 * @param {object} contextData - Trigger context (matched pages, schedule info, etc.)
 * @param {object} env - Cloudflare Worker env (DB, etc.)
 * @returns {Promise<{ nodeOutputs, status, error? }>}
 */
async function executeFlowServer(nodes, connections, contextData, env) {
  const plan = buildExecutionPlanServer(nodes, connections);
  const nodeOutputs = {};
  const skippedNodes = new Set();
  const nodeStates = {};

  // Build adjacency for condition branching
  const adjacency = {};
  for (const conn of connections) {
    if (!adjacency[conn.fromNode]) adjacency[conn.fromNode] = [];
    adjacency[conn.fromNode].push(conn);
  }

  for (const node of plan) {
    if (skippedNodes.has(node.id)) {
      nodeStates[node.id] = "skipped";
      continue;
    }

    nodeStates[node.id] = "running";

    try {
      const inputs = gatherInputsServer(node, connections, nodeOutputs);
      let result;

      switch (node.type) {
        case "trigger":
          result = { ...contextData, ...inputs, _trigger: node.subtype };
          break;

        case "condition": {
          const condResult = evaluateConditionServer(node.config || {}, inputs);
          result = condResult.data;
          const activeBranch = condResult.branch;
          const outConns = adjacency[node.id] || [];
          for (const conn of outConns) {
            const portLabel = (node.ports?.out || []).find((p) => p.id === conn.fromPort)?.label;
            if (portLabel && portLabel !== activeBranch) {
              markDownstreamServer(conn.toNode, connections, skippedNodes);
            }
          }
          break;
        }

        case "action":
          result = await executeFlowActionServer(node, inputs, env);
          break;

        case "transform":
          result = await executeFlowTransformServer(node, inputs, env);
          break;

        default:
          result = inputs;
      }

      nodeOutputs[node.id] = result;
      nodeStates[node.id] = "success";
    } catch (err) {
      console.error(`[FlowServer] Node "${node.label}" (${node.id}) failed:`, err.message);
      nodeOutputs[node.id] = { _error: err.message };
      nodeStates[node.id] = "error";
    }
  }

  return { nodeOutputs, nodeStates, status: "completed" };
}

/**
 * Execute an action node server-side (reuses executeServerTool pattern).
 */
async function executeFlowActionServer(node, inputs, env) {
  const templateData = { ...inputs };

  switch (node.subtype) {
    case "post_notification": {
      const message = expandTemplateServer(node.config?.message || "", templateData);
      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO notifications (id, message, type, status, source, created_at) VALUES (?, ?, ?, 'unread', ?, datetime('now'))"
      ).bind(id, message, node.config?.type || "notification", `flow:${node.label}`).run();
      return { _action: "notification_sent", message };
    }

    case "update_page": {
      const properties = safeParseJSON(node.config?.properties);
      const expanded = {};
      for (const [key, val] of Object.entries(properties)) {
        expanded[key] = typeof val === "string" ? expandTemplateServer(val, templateData) : val;
      }
      // If we have a page ID from upstream data, do the actual update
      const pageId = inputs?.id || inputs?.pageId || inputs?.page_id;
      const dbId = inputs?.databaseId || inputs?.database_id || inputs?.table_id;
      if (pageId) {
        const existing = await env.DB.prepare("SELECT cells FROM table_rows WHERE id = ?").bind(pageId).first();
        const merged = { ...safeParseJSON(existing?.cells), ...expanded };
        await env.DB.prepare("UPDATE table_rows SET cells = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(JSON.stringify(merged), pageId).run();
        return { _action: "page_updated", pageId, properties: expanded };
      }
      return { _action: "update_page", properties: expanded, ...inputs };
    }

    case "create_page": {
      const properties = safeParseJSON(node.config?.properties);
      const expanded = {};
      for (const [key, val] of Object.entries(properties)) {
        expanded[key] = typeof val === "string" ? expandTemplateServer(val, templateData) : val;
      }
      const dbId = node.config?.databaseId;
      if (dbId) {
        const id = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO table_rows (id, table_id, cells, sort_order, metadata, created_at, updated_at) VALUES (?, ?, ?, 0, '{}', datetime('now'), datetime('now'))"
        ).bind(id, dbId, JSON.stringify(expanded)).run();
        return { _action: "page_created", pageId: id, ...expanded };
      }
      return { _action: "create_page", properties: expanded };
    }

    default:
      return { _action: node.subtype, ...inputs };
  }
}

/**
 * Execute a transform node server-side.
 * For execute_function subtype: fetches function from D1, runs in sandbox.
 */
async function executeFlowTransformServer(node, inputs, env) {
  if (node.subtype === "execute_function") {
    const { functionId } = node.config || {};
    if (!functionId) throw new Error("No function selected for this node.");

    // Fetch the function from D1
    const fn = await env.DB.prepare("SELECT * FROM custom_functions WHERE id = ?").bind(functionId).first();
    if (!fn) throw new Error(`Function not found: ${functionId}`);

    const code = fn.code || "";
    const meta = safeParseJSON(fn.meta);

    // Build datasets from upstream inputs
    const datasets = {};
    if (inputs && typeof inputs === "object") {
      if (inputs.results && Array.isArray(inputs.results)) {
        datasets.data = inputs.results;
      } else {
        Object.assign(datasets, inputs);
      }
    }

    const execStart = Date.now();
    const result = executeSandboxServer(code, datasets);
    const durationMs = Date.now() - execStart;

    // Log execution (non-blocking)
    try {
      const execId = `fex_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      env.DB.prepare(
        `INSERT INTO function_executions (id, function_id, function_name, trigger_source, status, input_summary, output_summary, duration_ms, error, executed_at)
         VALUES (?, ?, ?, 'flow', ?, ?, ?, ?, '', datetime('now'))`
      ).bind(
        execId, functionId, fn.name || "",
        result.success ? "success" : "error",
        JSON.stringify({ datasets: Object.keys(datasets) }),
        JSON.stringify({ type: typeof result.result }),
        durationMs
      ).run().catch(() => {});
    } catch { /* ignore */ }

    if (!result.success) throw new Error(`Function "${fn.name}" execution failed`);

    // Wrap result with output key if configured
    if (node.config?.outputKey) {
      return { ...inputs, [node.config.outputKey]: result.result, _functionResult: true };
    }
    return { ...inputs, result: result.result, _functionResult: true };
  }

  // Plugin transform
  if (node.subtype === "execute_plugin") {
    const { pluginId } = node.config || {};
    if (!pluginId) throw new Error("No plugin selected for this node.");

    const fn = await env.DB.prepare("SELECT * FROM custom_functions WHERE id = ?").bind(pluginId).first();
    if (!fn) throw new Error(`Plugin not found: ${pluginId}`);

    const code = fn.code || "";
    const meta = safeParseJSON(fn.meta);
    const manifest = meta?.manifest || {};

    const datasets = {};
    if (inputs && typeof inputs === "object") {
      if (inputs.results && Array.isArray(inputs.results)) datasets.data = inputs.results;
      else Object.assign(datasets, inputs);
    }

    // Build config from manifest defaults + node overrides
    const pluginConfig = {};
    if (manifest.ui?.configSchema) {
      for (const [k, v] of Object.entries(manifest.ui.configSchema)) pluginConfig[k] = v.default ?? null;
    }
    if (node.config?.config) Object.assign(pluginConfig, node.config.config);

    const execStart = Date.now();
    const result = executeSandboxPluginServer(code, datasets, manifest, pluginConfig);
    const durationMs = Date.now() - execStart;

    // Log execution
    try {
      const execId = `fex_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      env.DB.prepare(
        `INSERT INTO function_executions (id, function_id, function_name, trigger_source, status, input_summary, output_summary, duration_ms, error, executed_at)
         VALUES (?, ?, ?, 'flow', ?, ?, ?, ?, '', datetime('now'))`
      ).bind(execId, pluginId, fn.name || "", result.success ? "success" : "error",
        JSON.stringify({ datasets: Object.keys(datasets) }), JSON.stringify({ type: typeof result.result }), durationMs
      ).run().catch(() => {});
    } catch { /* ignore */ }

    if (!result.success) throw new Error(`Plugin "${fn.name}" execution failed`);

    const output = result.result?.viewSpec ? result.result.data : result.result;
    if (node.config?.outputKey) return { ...inputs, [node.config.outputKey]: output, _functionResult: true };
    return { ...inputs, result: output, _functionResult: true };
  }

  // Template transform
  const template = node.config?.template || "";
  const expanded = expandTemplateServer(template, inputs);
  return { ...inputs, result: expanded, _transformed: true };
}

// ─── Server-Side Automation Engine ───

/**
 * Main automation tick — called every 2 minutes by Cloudflare cron.
 * Queries enabled rules, evaluates triggers with field-level change detection,
 * and executes matched rules server-side (no browser required).
 */
async function runAutomationTick(env) {
  const LOG = "[AutoCron]";
  const MAX_RULES_PER_TICK = 5;
  const MAX_AGENT_ITERATIONS = 8;
  const AGENT_MAX_TOKENS = 2048;

  try {
    // 1. Fetch all enabled rules
    const { results: rawRules } = await env.DB.prepare(
      "SELECT * FROM automation_rules WHERE enabled = 1"
    ).all();

    if (!rawRules || rawRules.length === 0) {
      console.log(LOG, "No enabled rules — skipping tick");
      return;
    }

    console.log(LOG, `Found ${rawRules.length} enabled rule(s)`);

    const rules = rawRules.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || "",
      trigger: r.trigger_type,
      triggerConfig: safeParseJSON(r.trigger_config),
      actionConfig: safeParseJSON(r.action_config),
      instruction: safeParseJSON(r.action_config).instruction || "",
      databaseId: safeParseJSON(r.action_config).database_id || r.scope_table_id || "",
      enabled: !!r.enabled,
      lastFired: r.last_fired_at || null,
      fireCount: r.fire_count || 0,
      ownerPage: safeParseJSON(r.action_config).owner_page || "",
    }));

    // 2. Evaluate each rule
    const now = new Date();
    const toExecute = [];

    for (const rule of rules) {
      if (toExecute.length >= MAX_RULES_PER_TICK) break;

      try {
        const result = await evaluateRuleServer(rule, now, env);
        if (result.shouldFire) {
          toExecute.push({ rule, changedRecords: result.changedRecords || [] });
        }
      } catch (err) {
        console.error(LOG, `Trigger eval failed for "${rule.name}":`, err.message);
      }
    }

    if (toExecute.length === 0) {
      console.log(LOG, "No rules triggered this tick");
      return;
    }

    console.log(LOG, `${toExecute.length} rule(s) triggered — executing`);

    // 3. Get Claude key for agent-based rules
    let claudeKey = null;
    try {
      const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'claude'").first();
      if (row?.value) {
        claudeKey = await decryptSecret(row.value, env);
        // Lazy migration: re-encrypt if it was plaintext
        if (claudeKey === row.value && !row.value.startsWith('enc:v1:')) {
          await env.DB.prepare(
            "UPDATE connections SET value = ?, updated_at = datetime('now') WHERE key = 'claude'"
          ).bind(await encryptSecret(claudeKey, env)).run();
        }
      }
    } catch {}

    // 4. Execute triggered rules
    for (const { rule, changedRecords } of toExecute) {
      try {
        await executeRuleServer(rule, changedRecords, claudeKey, env);

        // Update last_fired_at and fire_count
        await env.DB.prepare(
          "UPDATE automation_rules SET last_fired_at = datetime('now'), fire_count = fire_count + 1, updated_at = datetime('now') WHERE id = ?"
        ).bind(rule.id).run();

        console.log(LOG, `Rule "${rule.name}" fired successfully`);
      } catch (err) {
        console.error(LOG, `Rule "${rule.name}" execution failed:`, err.message);
      }
    }

    // ── 5. Process enabled automation flows ──
    await processEnabledFlows(env, now);

  } catch (err) {
    console.error(LOG, "Tick failed:", err.message);
  }
}

/**
 * Process enabled automation flows.
 * Queries flows with enabled=1, evaluates trigger nodes (schedule or event-based),
 * and executes matching flows using the server-side flow executor.
 */
async function processEnabledFlows(env, now) {
  const LOG = "[FlowCron]";
  const MAX_FLOWS_PER_TICK = 3;

  try {
    const { results: flows } = await env.DB.prepare(
      "SELECT * FROM automation_flows WHERE enabled = 1"
    ).all();

    if (!flows || flows.length === 0) return;

    console.log(LOG, `Found ${flows.length} enabled flow(s)`);

    let executedCount = 0;

    for (const flow of flows) {
      if (executedCount >= MAX_FLOWS_PER_TICK) break;

      const flowData = safeParseJSON(flow.flow_data);
      const nodes = flowData.nodes || [];
      const connections = flowData.connections || [];

      if (nodes.length === 0) continue;

      // Find trigger nodes
      const triggerNodes = nodes.filter((n) => n.type === "trigger");
      if (triggerNodes.length === 0) continue;

      // Evaluate each trigger node to see if the flow should fire
      let shouldFire = false;
      let contextData = {};

      for (const trigger of triggerNodes) {
        const trigResult = await evaluateFlowTrigger(trigger, flow, now, env);
        if (trigResult.shouldFire) {
          shouldFire = true;
          contextData = { ...contextData, ...trigResult.contextData };
          break; // One matching trigger is enough
        }
      }

      if (!shouldFire) continue;

      console.log(LOG, `Flow "${flow.name}" (${flow.id}) triggered — executing`);

      // Create flow execution record
      const execId = `flx_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      try {
        await env.DB.prepare(
          `INSERT INTO flow_executions (id, flow_id, flow_name, trigger_source, status, node_states, started_at)
           VALUES (?, ?, ?, 'cron', 'running', '{}', datetime('now'))`
        ).bind(execId, flow.id, flow.name).run();
      } catch { /* ignore logging errors */ }

      try {
        const result = await executeFlowServer(nodes, connections, contextData, env);

        // Update flow execution record
        await env.DB.prepare(
          `UPDATE flow_executions SET status = ?, node_states = ?, completed_at = datetime('now') WHERE id = ?`
        ).bind(
          result.status || "completed",
          JSON.stringify(result.nodeStates || {}),
          execId
        ).run();

        // Update flow's last_run and run_count
        await env.DB.prepare(
          "UPDATE automation_flows SET last_run = datetime('now'), run_count = run_count + 1, updated_at = datetime('now') WHERE id = ?"
        ).bind(flow.id).run();

        executedCount++;
        console.log(LOG, `Flow "${flow.name}" completed successfully`);
      } catch (err) {
        console.error(LOG, `Flow "${flow.name}" failed:`, err.message);
        try {
          await env.DB.prepare(
            `UPDATE flow_executions SET status = 'failed', error = ?, completed_at = datetime('now') WHERE id = ?`
          ).bind(err.message, execId).run();
        } catch { /* ignore */ }
      }
    }

    if (executedCount > 0) {
      console.log(LOG, `Executed ${executedCount} flow(s) this tick`);
    }
  } catch (err) {
    console.error(LOG, "Flow processing failed:", err.message);
  }
}

/**
 * Evaluate whether a flow's trigger node should fire.
 * Supports: schedule, field_change/status_change, page_created, manual (never fires on cron).
 */
async function evaluateFlowTrigger(triggerNode, flow, now, env) {
  const config = triggerNode.config || {};

  switch (triggerNode.subtype) {
    case "schedule": {
      const intervalMin = config.interval_minutes;
      if (!intervalMin || intervalMin <= 0) return { shouldFire: false };

      // Check flow's last_run to see if enough time has passed
      if (!flow.last_run) return { shouldFire: true, contextData: { _trigger: "schedule" } };
      const lastMs = new Date(flow.last_run).getTime();
      if (isNaN(lastMs)) return { shouldFire: true, contextData: { _trigger: "schedule" } };

      const elapsed = now.getTime() - lastMs;
      if (elapsed >= intervalMin * 60_000) {
        return { shouldFire: true, contextData: { _trigger: "schedule", elapsed_minutes: Math.round(elapsed / 60_000) } };
      }
      return { shouldFire: false };
    }

    case "field_change":
    case "status_change":
    case "database_change": {
      const databaseId = config.databaseId;
      if (!databaseId) return { shouldFire: false };

      // Check for changed records since flow's last_run
      const since = flow.last_run
        ? new Date(flow.last_run).toISOString()
        : new Date(now.getTime() - 5 * 60_000).toISOString(); // Default: last 5 min

      try {
        const { results } = await env.DB.prepare(
          "SELECT id, cells, updated_at FROM table_rows WHERE table_id = ? AND archived = 0 AND updated_at > ? ORDER BY updated_at DESC LIMIT 50"
        ).bind(databaseId, since).all();

        if (!results || results.length === 0) return { shouldFire: false };

        const changedRows = results.map((r) => ({
          id: r.id,
          ...safeParseJSON(r.cells),
          _updated: r.updated_at,
        }));

        // If a specific field/value is configured, filter to matching changes
        if (config.field && config.to) {
          const matchingRows = changedRows.filter((r) => {
            const fieldVal = String(r[config.field] ?? "");
            return fieldVal === config.to;
          });
          if (matchingRows.length === 0) return { shouldFire: false };
          return {
            shouldFire: true,
            contextData: {
              _trigger: triggerNode.subtype,
              matched_count: matchingRows.length,
              results: matchingRows.slice(0, 10),
              databaseId,
            },
          };
        }

        return {
          shouldFire: true,
          contextData: {
            _trigger: triggerNode.subtype,
            matched_count: changedRows.length,
            results: changedRows.slice(0, 10),
            databaseId,
          },
        };
      } catch (err) {
        console.error("[FlowCron] Field change detection failed:", err.message);
        return { shouldFire: false };
      }
    }

    case "page_created": {
      const databaseId = config.databaseId;
      if (!databaseId) return { shouldFire: false };

      const since = flow.last_run
        ? new Date(flow.last_run).toISOString()
        : new Date(now.getTime() - 5 * 60_000).toISOString();

      try {
        const { results } = await env.DB.prepare(
          "SELECT id, cells, created_at FROM table_rows WHERE table_id = ? AND archived = 0 AND created_at > ? ORDER BY created_at DESC LIMIT 50"
        ).bind(databaseId, since).all();

        if (!results || results.length === 0) return { shouldFire: false };

        const newRows = results.map((r) => ({
          id: r.id,
          ...safeParseJSON(r.cells),
          _created: r.created_at,
        }));

        return {
          shouldFire: true,
          contextData: {
            _trigger: "page_created",
            matched_count: newRows.length,
            results: newRows.slice(0, 10),
            databaseId,
          },
        };
      } catch (err) {
        console.error("[FlowCron] New record detection failed:", err.message);
        return { shouldFire: false };
      }
    }

    case "manual":
    default:
      return { shouldFire: false };
  }
}

/**
 * Server-side trigger evaluation with field-level change detection via snapshots.
 */
async function evaluateRuleServer(rule, now, env) {
  switch (rule.trigger) {
    case "schedule": {
      const intervalMin = rule.triggerConfig?.interval_minutes;
      if (!intervalMin || intervalMin <= 0) return { shouldFire: false };
      if (!rule.lastFired) return { shouldFire: true, changedRecords: [] };
      const lastMs = new Date(rule.lastFired).getTime();
      if (isNaN(lastMs)) return { shouldFire: true, changedRecords: [] };
      return {
        shouldFire: (now.getTime() - lastMs) >= intervalMin * 60_000,
        changedRecords: [],
      };
    }

    case "field_change":
    case "status_change": {
      if (!rule.databaseId) return { shouldFire: false };
      return await detectFieldChanges(rule, env);
    }

    case "page_created": {
      if (!rule.databaseId) return { shouldFire: false };
      return await detectNewRecords(rule, env);
    }

    case "manual":
    default:
      return { shouldFire: false };
  }
}

/**
 * Field-level change detection using rule_snapshots table.
 * Hashes the watched field (or all fields) for each record and compares to stored snapshots.
 * Returns specific changed records with old/new values.
 */
async function detectFieldChanges(rule, env) {
  const watchedField = rule.triggerConfig?.field || null;

  // Get current records from D1 table
  let rows;
  try {
    const result = await env.DB.prepare(
      "SELECT id, cells, updated_at FROM table_rows WHERE table_id = ? AND archived = 0 ORDER BY updated_at DESC LIMIT 200"
    ).bind(rule.databaseId).all();
    rows = (result.results || []).map((r) => ({
      id: r.id,
      cells: safeParseJSON(r.cells),
      updated_at: r.updated_at,
    }));
  } catch (err) {
    console.error("[AutoCron] Failed to query table for field changes:", err.message);
    return { shouldFire: false };
  }

  if (rows.length === 0) return { shouldFire: false };

  // Get existing snapshots for this rule
  const { results: existingSnaps } = await env.DB.prepare(
    "SELECT record_id, field_name, value_hash FROM rule_snapshots WHERE rule_id = ?"
  ).bind(rule.id).all();

  const snapMap = new Map();
  for (const snap of existingSnaps || []) {
    snapMap.set(`${snap.record_id}::${snap.field_name}`, snap.value_hash);
  }

  // Compare current values against snapshots
  const changedRecords = [];
  const upserts = [];

  for (const row of rows) {
    const fieldsToCheck = watchedField
      ? [watchedField]
      : Object.keys(row.cells);

    for (const field of fieldsToCheck) {
      const value = row.cells[field];
      const valueStr = value === null || value === undefined ? "" : String(value);
      const hash = simpleHash(valueStr);
      const key = `${row.id}::${field}`;
      const oldHash = snapMap.get(key);

      if (oldHash !== undefined && oldHash !== hash) {
        // Value changed
        changedRecords.push({
          id: row.id,
          cells: row.cells,
          changed_field: field,
          new_value: value,
          old_hash: oldHash,
        });
      }

      // Upsert snapshot (always update to latest)
      upserts.push({ ruleId: rule.id, recordId: row.id, field, hash });
    }
  }

  // Batch upsert snapshots
  if (upserts.length > 0) {
    const batchSize = 50;
    for (let i = 0; i < upserts.length; i += batchSize) {
      const batch = upserts.slice(i, i + batchSize);
      const stmts = batch.map((u) =>
        env.DB.prepare(
          "INSERT OR REPLACE INTO rule_snapshots (rule_id, record_id, field_name, value_hash, updated_at) VALUES (?, ?, ?, ?, datetime('now'))"
        ).bind(u.ruleId, u.recordId, u.field, u.hash)
      );
      await env.DB.batch(stmts);
    }
  }

  // For first run (no existing snapshots), don't fire — just seed
  if (existingSnaps.length === 0) {
    console.log("[AutoCron]", `Rule "${rule.name}": seeded ${upserts.length} snapshots (first run, no fire)`);
    return { shouldFire: false };
  }

  return {
    shouldFire: changedRecords.length > 0,
    changedRecords: changedRecords.slice(0, 10),
  };
}

/**
 * Detect newly created records since rule last fired.
 */
async function detectNewRecords(rule, env) {
  const lastFiredISO = rule.lastFired
    ? new Date(rule.lastFired).toISOString()
    : new Date(Date.now() - 24 * 60 * 60_000).toISOString();

  try {
    const { results } = await env.DB.prepare(
      "SELECT id, cells, created_at FROM table_rows WHERE table_id = ? AND archived = 0 AND created_at > ? ORDER BY created_at DESC LIMIT 50"
    ).bind(rule.databaseId, lastFiredISO).all();

    const newRecords = (results || []).map((r) => ({
      id: r.id,
      cells: safeParseJSON(r.cells),
      created_at: r.created_at,
    }));

    return {
      shouldFire: newRecords.length > 0,
      changedRecords: newRecords.slice(0, 10),
    };
  } catch (err) {
    console.error("[AutoCron] Failed to detect new records:", err.message);
    return { shouldFire: false };
  }
}

/**
 * Execute a rule server-side. Fast path for notifications, slow path for Claude agent.
 */
async function executeRuleServer(rule, changedRecords, claudeKey, env) {
  const instruction = (rule.instruction || "").trim();

  // Build template data from first changed record
  const firstRecord = changedRecords[0] || {};
  const templateData = {
    name: rule.name,
    description: rule.description,
    databaseId: rule.databaseId,
    matched_count: changedRecords.length,
    changed_field: firstRecord.changed_field || "",
    new_value: firstRecord.new_value || "",
    ...(firstRecord.cells || {}),
  };

  // Also get the table schema to help with column names
  let schemaColumns = [];
  try {
    const schemaRow = await env.DB.prepare(
      "SELECT columns FROM table_schemas WHERE id = ?"
    ).bind(rule.databaseId).first();
    if (schemaRow) {
      schemaColumns = JSON.parse(schemaRow.columns || "[]");
    }
  } catch {}

  // Try to find the "title" column (first column, or one named "Name"/"Title")
  const titleCol = schemaColumns.find((c) => c.name === "Name" || c.name === "Title" || c.type === "title")
    || schemaColumns[0];
  if (titleCol && firstRecord.cells) {
    templateData.record_name = firstRecord.cells[titleCol.name] || "";
  }

  // ── Fast path: direct notification ──
  if (instruction.startsWith("post_notification:")) {
    const messageTemplate = instruction.slice("post_notification:".length).trim();
    const message = expandTemplateServer(messageTemplate, templateData);

    await env.DB.prepare(
      "INSERT INTO notifications (id, message, type, status, source, created_at) VALUES (?, ?, 'alert', 'unread', ?, datetime('now'))"
    ).bind(crypto.randomUUID(), message, `automation:${rule.name}`).run();

    console.log("[AutoCron]", `Fast-path notification: "${message}"`);
    return { path: "fast", message };
  }

  // ── Slow path: Claude agent ──
  if (!claudeKey) {
    console.warn("[AutoCron]", `Rule "${rule.name}" needs Claude API key for agent execution — skipping`);
    return { path: "skipped", reason: "no_claude_key" };
  }

  // Build a rich system prompt with actual record data
  const changedSummary = changedRecords.slice(0, 5).map((r) => {
    const name = titleCol ? (r.cells?.[titleCol.name] || r.id) : r.id;
    const field = r.changed_field || "record";
    const val = r.new_value !== undefined ? ` → "${r.new_value}"` : "";
    return `- ${name}: ${field} changed${val}`;
  }).join("\n");

  const systemPrompt = [
    `You are an automation agent for rule "${rule.name}".`,
    rule.description ? `Description: ${rule.description}` : null,
    `Instruction: ${instruction}`,
    rule.databaseId ? `Target database ID: ${rule.databaseId}` : null,
    schemaColumns.length > 0
      ? `Database columns: ${schemaColumns.map((c) => `${c.name} (${c.type})`).join(", ")}`
      : null,
    changedRecords.length > 0
      ? `\nTriggered by ${changedRecords.length} changed record(s):\n${changedSummary}`
      : null,
    "\nComplete the instruction efficiently. Do not ask follow-up questions.",
    "Use the available tools to query data, update records, or post notifications.",
  ].filter(Boolean).join("\n");

  const userMessage = changedRecords.length > 0
    ? `Execute this automation now. ${instruction}\n\nChanged records: ${JSON.stringify(changedRecords.slice(0, 5).map((r) => ({ id: r.id, ...r.cells, _changed: r.changed_field, _new_value: r.new_value })))}`
    : `Execute this automation now. ${instruction}`;

  // Server-side tool definitions (subset for automation)
  const serverTools = [
    {
      name: "query_database",
      description: "Query a D1 table for records. Returns rows with all cell values.",
      input_schema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "The D1 table ID to query." },
        },
        required: ["database_id"],
      },
    },
    {
      name: "update_page",
      description: "Update a record's cells in a D1 table.",
      input_schema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "The row ID to update." },
          database_id: { type: "string", description: "The D1 table ID." },
          properties: { type: "object", description: "Key-value pairs of cell values to update." },
        },
        required: ["page_id", "properties"],
      },
    },
    {
      name: "create_page",
      description: "Create a new record in a D1 table.",
      input_schema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "The D1 table ID." },
          properties: { type: "object", description: "Key-value pairs for the new record's cells." },
        },
        required: ["database_id", "properties"],
      },
    },
    {
      name: "post_notification",
      description: "Post a notification to the user's feed.",
      input_schema: {
        type: "object",
        properties: {
          message: { type: "string", description: "The notification message." },
          type: { type: "string", enum: ["notification", "alert", "summary"], description: "Type." },
          source: { type: "string", description: "Source label." },
        },
        required: ["message"],
      },
    },
  ];

  // Run the agent loop server-side
  const messages = [{ role: "user", content: userMessage }];
  let finalText = "";

  for (let iter = 0; iter < 8; iter++) {
    const body = {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: systemPrompt,
      messages,
      tools: serverTools,
    };

    const res = await fetch(CLAUDE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": claudeKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429 || res.status === 529) {
      await sleep(Math.min(2000 * Math.pow(2, iter), 30000));
      continue;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Claude API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    messages.push({ role: "assistant", content: data.content });

    // Extract text
    const textBlocks = (data.content || []).filter((b) => b.type === "text").map((b) => b.text);
    if (textBlocks.length > 0) finalText = textBlocks.join("\n");

    // If no tool use, we're done
    const toolBlocks = (data.content || []).filter((b) => b.type === "tool_use");
    if (data.stop_reason !== "tool_use" || toolBlocks.length === 0) break;

    // Execute tool calls against D1 directly
    const toolResults = [];
    for (const block of toolBlocks) {
      let result;
      try {
        result = await executeServerTool(block.name, block.input, env);
      } catch (err) {
        result = JSON.stringify({ error: err.message });
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  console.log("[AutoCron]", `Agent completed for "${rule.name}": ${finalText.slice(0, 200)}`);
  return { path: "agent", text: finalText };
}

/**
 * Execute a tool call directly against D1 (no HTTP round-trip).
 */
async function executeServerTool(toolName, input, env) {
  switch (toolName) {
    case "query_database": {
      const tableId = input.database_id;
      if (!tableId) return JSON.stringify({ error: "database_id required" });

      const { results } = await env.DB.prepare(
        "SELECT id, cells, created_at, updated_at FROM table_rows WHERE table_id = ? AND archived = 0 ORDER BY sort_order, created_at LIMIT 100"
      ).bind(tableId).all();

      const rows = (results || []).map((r) => ({
        id: r.id,
        ...safeParseJSON(r.cells),
        _created: r.created_at,
        _updated: r.updated_at,
      }));

      return JSON.stringify({ count: rows.length, rows });
    }

    case "create_page": {
      const tableId = input.database_id;
      if (!tableId) return JSON.stringify({ error: "database_id required" });

      const id = crypto.randomUUID();
      const cells = input.properties || {};

      await env.DB.prepare(
        "INSERT INTO table_rows (id, table_id, cells, sort_order, metadata, created_at, updated_at) VALUES (?, ?, ?, 0, '{}', datetime('now'), datetime('now'))"
      ).bind(id, tableId, JSON.stringify(cells)).run();

      return JSON.stringify({ success: true, id });
    }

    case "update_page": {
      const rowId = input.page_id;
      const tableId = input.database_id;
      if (!rowId) return JSON.stringify({ error: "page_id required" });

      // Merge cells
      const existing = tableId
        ? await env.DB.prepare("SELECT cells FROM table_rows WHERE id = ? AND table_id = ?").bind(rowId, tableId).first()
        : await env.DB.prepare("SELECT cells FROM table_rows WHERE id = ?").bind(rowId).first();

      const currentCells = existing ? safeParseJSON(existing.cells) : {};
      const merged = { ...currentCells, ...(input.properties || {}) };

      if (tableId) {
        await env.DB.prepare(
          "UPDATE table_rows SET cells = ?, updated_at = datetime('now') WHERE id = ? AND table_id = ?"
        ).bind(JSON.stringify(merged), rowId, tableId).run();
      } else {
        await env.DB.prepare(
          "UPDATE table_rows SET cells = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(JSON.stringify(merged), rowId).run();
      }

      return JSON.stringify({ success: true, id: rowId });
    }

    case "post_notification": {
      const id = crypto.randomUUID();
      const message = input.message || "";
      const type = input.type || "notification";
      const source = input.source || "automation";

      await env.DB.prepare(
        "INSERT INTO notifications (id, message, type, status, source, created_at) VALUES (?, ?, ?, 'unread', ?, datetime('now'))"
      ).bind(id, message, type, source).run();

      return JSON.stringify({ success: true, id });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

/**
 * Simple string hash for snapshot comparison (non-cryptographic, fast).
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return String(hash);
}

/**
 * Expand {{template}} variables in a string.
 */
function expandTemplateServer(template, data) {
  if (!template) return "";
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = data[key];
    if (val === null || val === undefined) return "";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  });
}

// safeParseJSON moved to worker/utils.js

// ─── Notion Sync Handlers ───

/**
 * Event-driven automation trigger check.
 * Called inline from handleUpdateRow when cells change.
 * Compares old vs new cells to detect field/status changes,
 * then executes matching rules immediately (fast path inline, slow path async).
 */
async function checkAutomationTriggers(env, tableId, rowId, oldCells, newCells) {
  // Find enabled rules that watch this table for field/status changes
  const { results: rules } = await env.DB.prepare(
    `SELECT * FROM automation_rules
     WHERE scope_table_id = ? AND enabled = 1
     AND trigger_type IN ('field_change', 'status_change')`
  ).bind(tableId).all();

  if (!rules || rules.length === 0) return;

  // Detect which fields actually changed
  const changedFields = {};
  const allKeys = new Set([...Object.keys(oldCells), ...Object.keys(newCells)]);
  for (const key of allKeys) {
    const oldVal = oldCells[key] === undefined ? "" : String(oldCells[key]);
    const newVal = newCells[key] === undefined ? "" : String(newCells[key]);
    if (oldVal !== newVal) {
      changedFields[key] = { old: oldCells[key], new: newCells[key] };
    }
  }

  if (Object.keys(changedFields).length === 0) return;

  // Get Claude key for slow-path rules
  let claudeKey = null;
  try {
    const row = await env.DB.prepare("SELECT value FROM connections WHERE key = 'claude'").first();
    if (row?.value) {
      claudeKey = await decryptSecret(row.value, env);
      // Lazy migration: re-encrypt if it was plaintext
      if (claudeKey === row.value && !row.value.startsWith('enc:v1:')) {
        await env.DB.prepare(
          "UPDATE connections SET value = ?, updated_at = datetime('now') WHERE key = 'claude'"
        ).bind(await encryptSecret(claudeKey, env)).run();
      }
    }
  } catch {}

  for (const rawRule of rules) {
    const triggerConfig = safeParseJSON(rawRule.trigger_config);
    const actionConfig = safeParseJSON(rawRule.action_config);
    const watchedField = triggerConfig?.field || null;

    // Check if the watched field changed (or any field if no specific watch)
    const relevantChange = watchedField
      ? changedFields[watchedField]
      : Object.keys(changedFields).length > 0;

    if (!relevantChange) continue;

    const changedRecords = [{
      id: rowId,
      cells: newCells,
      changed_field: watchedField || Object.keys(changedFields)[0],
      new_value: watchedField ? newCells[watchedField] : newCells[Object.keys(changedFields)[0]],
    }];

    const rule = {
      id: rawRule.id,
      name: rawRule.name,
      description: rawRule.description || "",
      trigger: rawRule.trigger_type,
      triggerConfig,
      actionConfig,
      instruction: actionConfig.instruction || "",
      databaseId: rawRule.scope_table_id || "",
      enabled: true,
      lastFired: rawRule.last_fired_at,
      fireCount: rawRule.fire_count || 0,
    };

    try {
      await executeRuleServer(rule, changedRecords, claudeKey, env);
      await env.DB.prepare(
        "UPDATE automation_rules SET last_fired_at = datetime('now'), fire_count = fire_count + 1, updated_at = datetime('now') WHERE id = ?"
      ).bind(rule.id).run();

      // Update snapshots so cron doesn't double-fire
      for (const field of Object.keys(changedFields)) {
        const hash = simpleHash(String(newCells[field] ?? ""));
        await env.DB.prepare(
          "INSERT OR REPLACE INTO rule_snapshots (rule_id, record_id, field_name, value_hash, updated_at) VALUES (?, ?, ?, ?, datetime('now'))"
        ).bind(rule.id, rowId, field, hash).run();
      }

      console.log("[AutoTrigger]", `Rule "${rule.name}" fired for row ${rowId}`);
    } catch (err) {
      console.error("[AutoTrigger]", `Rule "${rule.name}" failed:`, err.message);
    }
  }
}

/**
 * Cron-triggered sync flush — processes dirty rows to Notion.
 * Runs alongside the automation tick on every cron invocation.
 */

// ─── Neuron Pruning (cron safety net) ───
// Removes orphaned neuron nodes pointing to deleted pages or archived rows,
// then cleans up any neurons left with zero nodes.
async function runNeuronPruneTick(env) {
  try {
    // Remove nodes pointing to deleted pages
    const pageResult = await env.DB.prepare(`
      DELETE FROM neuron_nodes
      WHERE page_config_id != '' AND page_config_id NOT IN (SELECT id FROM page_configs)
    `).run();

    // Remove nodes pointing to archived/deleted rows
    const rowResult = await env.DB.prepare(`
      DELETE FROM neuron_nodes
      WHERE node_type = 'row' AND node_id NOT IN (SELECT id FROM table_rows WHERE archived = 0)
    `).run();

    const pruned = (pageResult.meta?.changes || 0) + (rowResult.meta?.changes || 0);

    // Clean up empty neurons (no remaining nodes)
    if (pruned > 0) {
      await env.DB.prepare(`
        DELETE FROM neurons WHERE id NOT IN (SELECT DISTINCT neuron_id FROM neuron_nodes)
      `).run();
    }
  } catch (_) {
    // Non-critical — swallow errors to avoid blocking cron
  }
}

export { runAutomationTick, checkAutomationTriggers, runNeuronPruneTick };
