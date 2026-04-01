// ─── Neuron Storage ───
// Client-side wrapper for the Neurons D1 backend.
// Uses localStorage as a read-through cache with TTL.

import {
  listNeurons,
  getNeuron,
  createNeuronAPI,
  updateNeuronAPI,
  deleteNeuronAPI,
  addNeuronNode,
  removeNeuronNode,
  getNeuronsByNode,
  getNeuronGraph,
  getHydratedNeurons,
} from "../lib/api.js";

const CACHE_KEY = "wasabi_neurons";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Cache helpers ───

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    /* quota exceeded */
  }
}

function invalidateCache() {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(GRAPH_CACHE_KEY);
  localStorage.removeItem(HYDRATED_CACHE_KEY);
}

// ─── Public API ───

/** Load all neurons (with node counts). Uses cache if fresh. */
export async function loadNeurons(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = readCache();
    if (cached) return cached;
  }
  const res = await listNeurons();
  const neurons = res.neurons || [];
  writeCache(neurons);
  return neurons;
}

/** Load cached neurons synchronously (for instant mount). */
export function loadCachedNeurons() {
  return readCache() || [];
}

/** Get a single neuron with all its nodes. */
export async function loadNeuron(neuronId) {
  return getNeuron(neuronId);
}

/** Create a neuron with initial nodes. Returns { id, name, node_count }. */
export async function createNeuron(name, nodes) {
  invalidateCache();
  return createNeuronAPI(name, nodes);
}

/** Update a neuron's name. */
export async function updateNeuronName(neuronId, name) {
  invalidateCache();
  return updateNeuronAPI(neuronId, { name });
}

/** Delete a neuron and all its nodes. */
export async function deleteNeuron(neuronId) {
  invalidateCache();
  return deleteNeuronAPI(neuronId);
}

/** Add a node to an existing neuron. */
export async function addNode(neuronId, node) {
  invalidateCache();
  return addNeuronNode(neuronId, node);
}

/** Remove a node from a neuron. */
export async function removeNode(neuronId, nodeId) {
  invalidateCache();
  return removeNeuronNode(neuronId, nodeId);
}

/** Find all neurons containing a specific node (for badge display). */
export async function loadNeuronsByNode(nodeId) {
  const res = await getNeuronsByNode(nodeId);
  return res.neurons || [];
}

/** Full graph dump (all neurons + all nodes). For Wasabi agent context. */
export async function loadNeuronGraph() {
  const res = await getNeuronGraph();
  const neurons = res.neurons || [];
  // Cache the full graph for prompt injection
  try {
    localStorage.setItem(GRAPH_CACHE_KEY, JSON.stringify({ data: neurons, ts: Date.now() }));
  } catch { /* quota */ }
  return neurons;
}

// ─── Full Graph Cache (separate from list cache) ───
const GRAPH_CACHE_KEY = "wasabi_neuron_graph";
const HYDRATED_CACHE_KEY = "wasabi_neuron_hydrated";

/** Load cached full graph synchronously. Returns neurons with nodes[] arrays. */
export function loadCachedNeuronGraph() {
  try {
    const raw = localStorage.getItem(GRAPH_CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

// ─── Hydrated Neurons Cache ───

/** Fetch hydrated neurons from worker and cache. */
export async function loadHydratedNeurons(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = loadCachedHydratedNeurons();
    if (cached) return cached;
  }
  const res = await getHydratedNeurons(30);
  const neurons = res.neurons || [];
  try {
    localStorage.setItem(HYDRATED_CACHE_KEY, JSON.stringify({ data: neurons, ts: Date.now() }));
  } catch { /* quota */ }
  return neurons;
}

/** Load cached hydrated neurons synchronously. */
export function loadCachedHydratedNeurons() {
  try {
    const raw = localStorage.getItem(HYDRATED_CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

// ─── Context Summary Builder ───

/** Format a single hydrated neuron into prompt-friendly markdown. */
function formatHydratedNeuron(n) {
  const name = n.name || "(unnamed)";
  const nodeList = (n.nodes || []).map((nd) => {
    const label = nd.node_label || nd.node_id;
    const typeBadge = nd.node_type ? `[${nd.node_type}` : "[node";
    const pagePart = nd.page_name ? `, ${nd.page_name}` : "";
    let fieldsPart = "";
    if (nd.hydrated) {
      const entries = Object.entries(nd.hydrated)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      if (entries) fieldsPart = ` — ${entries}`;
    }
    return `  - ${label} ${typeBadge}${pagePart}]${fieldsPart}`;
  }).join("\n");
  return `### ${name} (id: ${n.id})\n${nodeList}`;
}

/**
 * Build a rich neuron summary for injection into AI prompts.
 * Priority: hydrated (with field values) > graph (labels only) > list (names + counts).
 */
export function buildNeuronContextSummary() {
  // Try hydrated cache first (has actual field values)
  const hydrated = loadCachedHydratedNeurons();
  if (hydrated && hydrated.length > 0) {
    return hydrated.slice(0, 30).map(formatHydratedNeuron).join("\n\n");
  }

  // Fallback: full graph (labels only, no field values)
  const graph = loadCachedNeuronGraph();
  if (graph && graph.length > 0) {
    return graph.slice(0, 30).map((n) => {
      const name = n.name || "(unnamed)";
      const nodeList = (n.nodes || []).map((nd) => {
        const label = nd.node_label || nd.node_id;
        return `  - ${label} [${nd.node_type}]`;
      }).join("\n");
      return `### ${name} (id: ${n.id})\n${nodeList}`;
    }).join("\n\n");
  }

  // Fallback: list-only cache (names + counts, no node details)
  const list = loadCachedNeurons();
  if (list.length > 0) {
    return list.slice(0, 30).map((n) =>
      `- ${n.name || "(unnamed)"} (${n.node_count || 0} nodes, id: ${n.id})`
    ).join("\n");
  }

  return "";
}

// ─── Relevance-Filtered Context ───

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "about", "between",
  "through", "after", "before", "during", "without", "and", "or", "but",
  "not", "no", "if", "then", "than", "so", "up", "out", "just", "also",
  "how", "what", "when", "where", "which", "who", "whom", "why", "all",
  "each", "every", "both", "few", "more", "most", "other", "some", "any",
  "my", "your", "his", "her", "its", "our", "their", "this", "that",
  "these", "those", "me", "him", "us", "them", "it", "i", "you", "we",
  "they", "he", "she", "show", "tell", "get", "find", "look", "give",
]);

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/**
 * Build neuron context filtered by relevance to the user's query.
 * Scores neurons by keyword overlap with name, node labels, and hydrated values.
 * Falls back to first N neurons if no keywords match (always inject something).
 */
export function buildFilteredNeuronContext(query, maxNeurons = 15) {
  const keywords = tokenize(query);
  if (!keywords.length) return buildNeuronContextSummary();

  // Load best available cache
  const hydrated = loadCachedHydratedNeurons();
  const graph = !hydrated?.length ? loadCachedNeuronGraph() : null;
  const source = hydrated?.length ? hydrated : graph?.length ? graph : null;
  if (!source) {
    // Fall back to list-only
    const list = loadCachedNeurons();
    if (!list.length) return "";
    return list.slice(0, maxNeurons).map((n) =>
      `- ${n.name || "(unnamed)"} (${n.node_count || 0} nodes, id: ${n.id})`
    ).join("\n");
  }

  // Score each neuron
  const scored = source.map((n) => {
    let score = 0;
    const nameLower = (n.name || "").toLowerCase();

    for (const kw of keywords) {
      // Neuron name match: +3
      if (nameLower.includes(kw)) score += 3;

      // Node label match: +2, hydrated value match: +1
      for (const nd of (n.nodes || [])) {
        const label = (nd.node_label || "").toLowerCase();
        if (label.includes(kw)) score += 2;

        if (nd.hydrated) {
          for (const v of Object.values(nd.hydrated)) {
            if (v != null && String(v).toLowerCase().includes(kw)) {
              score += 1;
              break; // one point per node per keyword max
            }
          }
        }
      }
    }

    return { neuron: n, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // If all scores 0, take first maxNeurons (always inject something)
  const allZero = scored.every((s) => s.score === 0);
  const selected = scored.slice(0, maxNeurons).map((s) => s.neuron);

  // Format using hydrated or graph formatter
  if (hydrated?.length) {
    return selected.map(formatHydratedNeuron).join("\n\n");
  }
  return selected.map((n) => {
    const name = n.name || "(unnamed)";
    const nodeList = (n.nodes || []).map((nd) => {
      const label = nd.node_label || nd.node_id;
      return `  - ${label} [${nd.node_type}]`;
    }).join("\n");
    return `### ${name} (id: ${n.id})\n${nodeList}`;
  }).join("\n\n");
}
