// ─── Google Neuron Cleanup ───
// Auto-cleanup stale Gmail/Calendar neuron nodes.
// Runs on app load (debounced, max once per hour).
// Checks if gmail: neuron nodes still exist in the API,
// and removes dead references using the neuron storage API.

import { getEmail } from "../lib/api.js";
import { removeNode } from "../neurons/neuronStorage.js";

const CLEANUP_KEY = "wasabi_google_neuron_cleanup_ts";
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

/**
 * Check if cleanup should run (max once per hour).
 */
function shouldRunCleanup() {
  try {
    const lastTs = parseInt(localStorage.getItem(CLEANUP_KEY) || "0", 10);
    return Date.now() - lastTs > CLEANUP_INTERVAL;
  } catch {
    return true;
  }
}

/** Mark cleanup as completed. */
function markCleanupDone() {
  try {
    localStorage.setItem(CLEANUP_KEY, String(Date.now()));
  } catch { /* ignore */ }
}

/**
 * Verify if a Gmail message still exists.
 * @param {string} messageId - Gmail message ID
 * @returns {Promise<boolean>}
 */
async function gmailNodeExists(messageId) {
  try {
    const result = await getEmail(messageId);
    return !!result && !result.error;
  } catch {
    return false;
  }
}

/**
 * Run cleanup on Google neuron nodes.
 * Scans all neurons for gmail: and gcal: node_ids,
 * batch-verifies existence, and removes dead ones.
 *
 * @param {Array} neurons - Array of neuron objects (from loadCachedNeurons or context)
 * @returns {Promise<{ cleaned: number, checked: number }>}
 */
export async function cleanupGoogleNeuronNodes(neurons) {
  if (!shouldRunCleanup()) return { cleaned: 0, checked: 0, skipped: true };
  if (!neurons?.length) {
    markCleanupDone();
    return { cleaned: 0, checked: 0 };
  }

  let checked = 0;
  let cleaned = 0;

  for (const neuron of neurons) {
    if (!neuron.nodes?.length) continue;

    const gmailNodes = neuron.nodes.filter(
      (n) => n.node_id?.startsWith("gmail:")
    );

    if (gmailNodes.length === 0) continue;

    for (const node of gmailNodes) {
      checked++;
      const msgId = node.node_id.slice(6); // Remove "gmail:" prefix
      const exists = await gmailNodeExists(msgId);
      if (!exists) {
        try {
          await removeNode(neuron.id, node.node_id);
          cleaned++;
        } catch (err) {
          console.warn("[GoogleNeuronCleanup] Failed to remove node:", node.node_id, err.message);
        }
      }
    }

    // gcal nodes are not checked for now (no direct getEvent endpoint)
    // Calendar events are less likely to be deleted by users.
  }

  markCleanupDone();
  return { cleaned, checked };
}
