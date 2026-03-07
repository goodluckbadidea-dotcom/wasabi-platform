// ─── Flow Storage ───
// Stores and loads automation flows from Notion + localStorage cache.
// Same persistence pattern as pageConfig.js.

import { queryAll, createPage, updatePage, createDatabase } from "../notion/client.js";
import { safeJSON } from "../utils/helpers.js";

const FLOWS_SCHEMA = [
  { name: "Name", type: "title" },
  { name: "Description", type: "rich_text" },
  { name: "Flow Data", type: "rich_text" },
  { name: "Enabled", type: "checkbox" },
  { name: "Last Run", type: "date" },
  { name: "Run Count", type: "number" },
];

const CACHE_KEY = "wasabi_flows";

/**
 * Initialize the Flows database (lazy, called on first use).
 */
export async function initFlowsDB(workerUrl, notionKey, rootPageId) {
  const db = await createDatabase(workerUrl, notionKey, rootPageId, "Automation Flows", FLOWS_SCHEMA);
  return db.id;
}

/**
 * Load all flows from Notion.
 */
export async function loadFlows(workerUrl, notionKey, flowsDbId) {
  const results = await queryAll(workerUrl, notionKey, flowsDbId);

  const flows = results.map((page) => {
    const name = page.properties?.Name?.title?.map((t) => t.plain_text).join("") || "Untitled";
    const description = page.properties?.Description?.rich_text?.map((t) => t.plain_text).join("") || "";
    const flowDataStr = page.properties?.["Flow Data"]?.rich_text?.map((t) => t.plain_text).join("") || "{}";
    const enabled = page.properties?.Enabled?.checkbox || false;
    const lastRun = page.properties?.["Last Run"]?.date?.start || null;
    const runCount = page.properties?.["Run Count"]?.number || 0;

    const flowData = safeJSON(flowDataStr, {});

    return {
      id: page.id,
      name,
      description,
      enabled,
      lastRun,
      runCount,
      nodes: flowData.nodes || [],
      connections: flowData.connections || [],
    };
  });

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
 * Save a flow to Notion (create or update).
 * Returns the page ID.
 */
export async function saveFlow(workerUrl, notionKey, flowsDbId, flow) {
  const { id, name, description, enabled, nodes, connections, lastRun, runCount } = flow;
  const flowDataStr = JSON.stringify({ nodes, connections });

  const properties = {
    Name: { title: [{ type: "text", text: { content: name || "Untitled" } }] },
    Description: { rich_text: [{ type: "text", text: { content: description || "" } }] },
    "Flow Data": { rich_text: [{ type: "text", text: { content: flowDataStr } }] },
    Enabled: { checkbox: enabled || false },
    "Run Count": { number: runCount || 0 },
  };

  // Include Last Run if present
  if (lastRun) {
    properties["Last Run"] = { date: { start: lastRun } };
  }

  // Check if this is an existing Notion page (real UUID) or a temp ID
  const isExisting = id && !id.startsWith("flow_");

  if (isExisting) {
    await updatePage(workerUrl, notionKey, id, properties);

    // Update cache
    updateCachedFlow(flow);

    return id;
  }

  // Create new
  const page = await createPage(workerUrl, notionKey, flowsDbId, properties);

  // Update cache with real ID
  const savedFlow = { ...flow, id: page.id };
  updateCachedFlow(savedFlow, id);

  return page.id;
}

/**
 * Delete (archive) a flow.
 */
export async function deleteFlow(workerUrl, notionKey, flowPageId) {
  await updatePage(workerUrl, notionKey, flowPageId, {
    Enabled: { checkbox: false },
  });
  // Remove from cache
  try {
    const cached = loadCachedFlows();
    const updated = cached.filter((f) => f.id !== flowPageId);
    localStorage.setItem(CACHE_KEY, JSON.stringify(updated));
  } catch {}
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
