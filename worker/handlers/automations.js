// ─── Automation Rules + Flows CRUD ───
import { safeParseJSON } from '../utils.js';

export async function handleListRules(env, url, jsonResponse) {
  const enabled = url.searchParams.get("enabled");
  let query = "SELECT * FROM automation_rules";
  const params = [];
  if (enabled === "true") { query += " WHERE enabled = 1"; }
  else if (enabled === "false") { query += " WHERE enabled = 0"; }
  query += " ORDER BY created_at DESC";

  const { results } = await env.DB.prepare(query).bind(...params).all();
  // Parse JSON config fields
  const rules = (results || []).map((r) => ({
    ...r,
    trigger_config: safeParseJSON(r.trigger_config),
    action_config: safeParseJSON(r.action_config),
    enabled: !!r.enabled,
  }));
  return jsonResponse({ rules });
}

export async function handleCreateRule(env, body, jsonResponse) {
  const id = crypto.randomUUID();
  const {
    name, description = "", trigger_type, trigger_config = {},
    action_config = {}, enabled = false, scope_table_id = null,
  } = body;

  if (!name || !trigger_type) {
    return jsonResponse({ _error: "name and trigger_type required" }, 400);
  }

  await env.DB.prepare(
    `INSERT INTO automation_rules (id, name, description, trigger_type, trigger_config, action_config, enabled, scope_table_id, fire_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`
  ).bind(
    id, name, description, trigger_type,
    JSON.stringify(trigger_config), JSON.stringify(action_config),
    enabled ? 1 : 0, scope_table_id,
  ).run();

  return jsonResponse({ id, name, success: true });
}

export async function handleGetRule(env, id, jsonResponse) {
  const row = await env.DB.prepare("SELECT * FROM automation_rules WHERE id = ?").bind(id).first();
  if (!row) return jsonResponse({ _error: "Rule not found" }, 404);
  row.trigger_config = safeParseJSON(row.trigger_config);
  row.action_config = safeParseJSON(row.action_config);
  row.enabled = !!row.enabled;
  return jsonResponse(row);
}

export async function handleUpdateRule(env, id, body, jsonResponse) {
  const sets = [];
  const vals = [];

  for (const [key, val] of Object.entries(body)) {
    if (["name", "description", "trigger_type", "scope_table_id", "last_fired_at"].includes(key)) {
      sets.push(`${key} = ?`);
      vals.push(val);
    } else if (key === "trigger_config" || key === "action_config") {
      sets.push(`${key} = ?`);
      vals.push(typeof val === "string" ? val : JSON.stringify(val));
    } else if (key === "enabled") {
      sets.push("enabled = ?");
      vals.push(val ? 1 : 0);
    } else if (key === "fire_count") {
      sets.push("fire_count = ?");
      vals.push(val);
    }
  }

  if (sets.length === 0) return jsonResponse({ _error: "No valid fields to update" }, 400);

  sets.push("updated_at = datetime('now')");
  vals.push(id);

  await env.DB.prepare(`UPDATE automation_rules SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return jsonResponse({ success: true, id });
}

export async function handleDeleteRule(env, id, jsonResponse) {
  await env.DB.prepare("DELETE FROM automation_rules WHERE id = ?").bind(id).run();
  return jsonResponse({ success: true, id });
}

// ─── D1 Automation Flows Handlers ───

export async function handleListFlows(env, url, jsonResponse) {
  const enabled = url.searchParams.get("enabled");
  let query = "SELECT * FROM automation_flows";
  const params = [];
  if (enabled === "true") { query += " WHERE enabled = 1"; }
  else if (enabled === "false") { query += " WHERE enabled = 0"; }
  query += " ORDER BY updated_at DESC";

  const { results } = await env.DB.prepare(query).bind(...params).all();
  const flows = (results || []).map((r) => ({
    ...r,
    flow_data: safeParseJSON(r.flow_data),
    enabled: !!r.enabled,
  }));
  return jsonResponse({ flows });
}

export async function handleCreateFlow(env, body, jsonResponse) {
  const id = crypto.randomUUID();
  const {
    name = "Untitled", description = "", flow_data = {},
    enabled = false,
  } = body;

  await env.DB.prepare(
    `INSERT INTO automation_flows (id, name, description, flow_data, enabled, run_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`
  ).bind(
    id, name, description,
    typeof flow_data === "string" ? flow_data : JSON.stringify(flow_data),
    enabled ? 1 : 0,
  ).run();

  return jsonResponse({ id, name, success: true });
}

export async function handleGetFlow(env, id, jsonResponse) {
  const row = await env.DB.prepare("SELECT * FROM automation_flows WHERE id = ?").bind(id).first();
  if (!row) return jsonResponse({ _error: "Flow not found" }, 404);
  row.flow_data = safeParseJSON(row.flow_data);
  row.enabled = !!row.enabled;
  return jsonResponse(row);
}

export async function handleUpdateFlow(env, id, body, jsonResponse) {
  const sets = [];
  const vals = [];

  for (const [key, val] of Object.entries(body)) {
    if (["name", "description", "last_run"].includes(key)) {
      sets.push(`${key} = ?`);
      vals.push(val);
    } else if (key === "flow_data") {
      sets.push("flow_data = ?");
      vals.push(typeof val === "string" ? val : JSON.stringify(val));
    } else if (key === "enabled") {
      sets.push("enabled = ?");
      vals.push(val ? 1 : 0);
    } else if (key === "run_count") {
      sets.push("run_count = ?");
      vals.push(val);
    }
  }

  if (sets.length === 0) return jsonResponse({ _error: "No valid fields to update" }, 400);

  sets.push("updated_at = datetime('now')");
  vals.push(id);

  await env.DB.prepare(`UPDATE automation_flows SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return jsonResponse({ success: true, id });
}

export async function handleDeleteFlow(env, id, jsonResponse) {
  await env.DB.prepare("DELETE FROM automation_flows WHERE id = ?").bind(id).run();
  return jsonResponse({ success: true, id });
}

// ─── Function Executions (Audit Trail) ───

export async function handleListFunctionExecutions(env, url, jsonResponse) {
  const functionId = url.searchParams.get("function_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

  let query = "SELECT * FROM function_executions";
  const params = [];
  if (functionId) {
    query += " WHERE function_id = ?";
    params.push(functionId);
  }
  query += " ORDER BY executed_at DESC LIMIT ?";
  params.push(limit);

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return jsonResponse({ executions: results || [] });
}

export async function handleCreateFunctionExecution(env, body, jsonResponse) {
  const id = `fex_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const {
    function_id, function_name = "", trigger_source = "chat",
    status = "success", input_summary = "{}", output_summary = "{}",
    mutations_count = 0, duration_ms = 0, error = "",
  } = body;

  if (!function_id) return jsonResponse({ _error: "function_id required" }, 400);

  await env.DB.prepare(
    `INSERT INTO function_executions (id, function_id, function_name, trigger_source, status, input_summary, output_summary, mutations_count, duration_ms, error, executed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(
    id, function_id, function_name, trigger_source, status,
    typeof input_summary === "string" ? input_summary : JSON.stringify(input_summary),
    typeof output_summary === "string" ? output_summary : JSON.stringify(output_summary),
    mutations_count, duration_ms, error
  ).run();

  return jsonResponse({ id, success: true }, 201);
}

// ─── Flow Execution Handlers ───

export async function handleListFlowExecutions(env, url, jsonResponse) {
  const flowId = url.searchParams.get("flow_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

  let query = "SELECT * FROM flow_executions";
  const params = [];
  if (flowId) {
    query += " WHERE flow_id = ?";
    params.push(flowId);
  }
  query += " ORDER BY started_at DESC LIMIT ?";
  params.push(limit);

  const { results } = await env.DB.prepare(query).bind(...params).all();
  const parsed = (results || []).map((r) => ({
    ...r,
    node_states: safeParseJSON(r.node_states),
  }));
  return jsonResponse({ executions: parsed });
}

export async function handleCreateFlowExecution(env, body, jsonResponse) {
  const id = `flx_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const {
    flow_id, flow_name = "", trigger_source = "manual",
    status = "running", node_states = "{}", error = "",
  } = body;

  if (!flow_id) return jsonResponse({ _error: "flow_id required" }, 400);

  await env.DB.prepare(
    `INSERT INTO flow_executions (id, flow_id, flow_name, trigger_source, status, node_states, started_at, error)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`
  ).bind(
    id, flow_id, flow_name, trigger_source, status,
    typeof node_states === "string" ? node_states : JSON.stringify(node_states),
    error
  ).run();

  return jsonResponse({ id, success: true }, 201);
}

export async function handleUpdateFlowExecution(env, id, body, jsonResponse) {
  const sets = [];
  const vals = [];

  for (const [key, val] of Object.entries(body)) {
    if (key === "status") { sets.push("status = ?"); vals.push(val); }
    else if (key === "node_states") {
      sets.push("node_states = ?");
      vals.push(typeof val === "string" ? val : JSON.stringify(val));
    }
    else if (key === "error") { sets.push("error = ?"); vals.push(val); }
    else if (key === "completed_at") { sets.push("completed_at = ?"); vals.push(val); }
  }

  if (sets.length === 0) return jsonResponse({ _error: "No valid fields to update" }, 400);

  vals.push(id);
  await env.DB.prepare(`UPDATE flow_executions SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return jsonResponse({ success: true, id });
}
