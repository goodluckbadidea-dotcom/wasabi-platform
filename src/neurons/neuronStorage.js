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
  return res.neurons || [];
}
