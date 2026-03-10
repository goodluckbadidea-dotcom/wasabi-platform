// ─── Flow Storage ───
// Stores and loads automation flows using D1 (via worker API).
// Falls back to localStorage cache for instant startup.

import * as api from "../lib/api.js";

const CACHE_KEY = "wasabi_flows";

/**
 * Load all flows from D1.
 */
export async function loadFlows() {
  const result = await api.listFlows();
  const flows = (result.flows || []).map(fromD1Row);

  // Cache locally
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(flows));
  } catch {}

  return flows;
}

/**
 * Load flows from localStorage cache (instant, no API call).
 */
export function loadCachedFlows() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) : [];
  } catch {
    return [];
  }
}

/**
 * Save a flow to D1 (create or update).
 * Returns the flow ID.
 */
export async function saveFlow(flow) {
  const { id, name, description, enabled, nodes, connections, lastRun, runCount } = flow;
  const flowData = { nodes, connections };

  // Check if this is an existing D1 record or a temp local ID
  const isExisting = id && !id.startsWith("flow_");

  if (isExisting) {
    await api.updateFlow(id, {
      name: name || "Untitled",
      description: description || "",
      flow_data: flowData,
      enabled: enabled || false,
      run_count: runCount || 0,
      last_run: lastRun || null,
    });
    updateCachedFlow(flow);
    return id;
  }

  // Create new
  const result = await api.createFlow({
    name: name || "Untitled",
    description: description || "",
    flow_data: flowData,
    enabled: enabled || false,
  });

  const savedFlow = { ...flow, id: result.id };
  updateCachedFlow(savedFlow, id);
  return result.id;
}

/**
 * Delete a flow from D1.
 */
export async function deleteFlow(flowId) {
  await api.deleteFlow(flowId);
  // Remove from cache
  try {
    const cached = loadCachedFlows();
    const updated = cached.filter((f) => f.id !== flowId);
    localStorage.setItem(CACHE_KEY, JSON.stringify(updated));
  } catch {}
}

/**
 * Convert a D1 row to frontend flow format.
 */
function fromD1Row(row) {
  const flowData = typeof row.flow_data === "string"
    ? JSON.parse(row.flow_data || "{}")
    : (row.flow_data || {});

  return {
    id: row.id,
    name: row.name || "Untitled",
    description: row.description || "",
    enabled: !!row.enabled,
    lastRun: row.last_run || null,
    runCount: row.run_count || 0,
    nodes: flowData.nodes || [],
    connections: flowData.connections || [],
  };
}

/**
 * Update a single flow in the localStorage cache.
 */
function updateCachedFlow(flow, oldId) {
  try {
    const cached = loadCachedFlows();
    const idx = cached.findIndex((f) => f.id === (oldId || flow.id));
    if (idx >= 0) {
      cached[idx] = flow;
    } else {
      cached.push(flow);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch {}
}
