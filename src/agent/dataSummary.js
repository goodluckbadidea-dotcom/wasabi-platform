// ─── Shared Agent Utilities ───
// Extracted from ChatPanel.jsx for reuse across WasabiPanel and ChatPanel.
// buildDataSummary, findWorkspaceAncestor, getTokenBudget.

import { readField } from "../views/_viewHelpers.js";

/**
 * Build a compact markdown data summary for the agent's system prompt.
 * Includes property distributions, number stats, date ranges, and a sample table.
 *
 * @param {Array} data - Records array
 * @param {object} schema - Database schema
 * @returns {string} Markdown summary
 */
export function buildDataSummary(data, schema) {
  if (!data?.length || !schema) return "";

  const lines = [];
  lines.push(`## Current Page Data (${data.length} records) — SCHEMA ONLY`);
  lines.push(`⚠ **NO data values are shown here.** You MUST call \`query_database\` to get actual values. Do NOT guess, estimate, or fabricate any data.`);

  // Title field
  const titleField = schema.title?.name;
  if (titleField) lines.push(`- Title column: "${titleField}"`);

  // Column types (schema info only — no actual values)
  const catFields = [...(schema.statuses || []), ...(schema.selects || [])];
  if (catFields.length > 0) {
    lines.push(`- Select/Status columns: ${catFields.slice(0, 6).map((f) => `"${f.name}"`).join(", ")}`);
  }

  if (schema.numbers?.length > 0) {
    lines.push(`- Number columns: ${schema.numbers.slice(0, 6).map((f) => `"${f.name}"`).join(", ")}`);
  }

  if (schema.dates?.length > 0) {
    lines.push(`- Date columns: ${schema.dates.slice(0, 4).map((f) => `"${f.name}"`).join(", ")}`);
  }

  if (schema.richTexts?.length > 0) {
    lines.push(`- Text columns: ${schema.richTexts.slice(0, 4).map((f) => `"${f.name}"`).join(", ")}`);
  }

  // Available category values (helpful for filtering, but NO counts)
  for (const field of catFields.slice(0, 3)) {
    const uniqueVals = new Set();
    for (const page of data) {
      const val = readField(page, field.name);
      if (val) uniqueVals.add(val);
    }
    if (uniqueVals.size > 0 && uniqueVals.size <= 20) {
      lines.push(`- "${field.name}" values: ${[...uniqueVals].sort().join(", ")}`);
    }
  }

  lines.push(`\n**CRITICAL**: The data above is schema metadata ONLY. Every number, status, or fact you present to the user MUST come from a \`query_database\` tool call result. Never present data you haven't queried for.`);

  return lines.join("\n");
}

/**
 * Dynamic token budget based on message complexity.
 *
 * @param {string} text - User message text
 * @param {number} conversationDepth - Number of messages in history
 * @returns {{ maxTokens: number, maxIterations: number }}
 */
export function getTokenBudget(text, conversationDepth) {
  if (/build|create|design|setup|implement|system|track|manage/i.test(text) && text.length > 150)
    return { maxTokens: 6144, maxIterations: 12 };
  // Data-related queries need enough tokens for tool calls + formatted results
  if (/\b(sku|inventory|stock|sales|revenue|cost|price|quantity|remaining|weeks|margin|profit|calculate|per\s|by\s)\b/i.test(text))
    return { maxTokens: 4096, maxIterations: 8 };
  if (/analyze|summarize|compare|report|show|find/i.test(text))
    return { maxTokens: 4096, maxIterations: 8 };
  if (text.length < 40 && conversationDepth < 3) return { maxTokens: 2048, maxIterations: 6 };
  return { maxTokens: 4096, maxIterations: 8 };
}

/**
 * Walk up the page tree to find the workspace ancestor.
 *
 * @param {string} pageId - Starting page ID
 * @param {Array} pages - All page configs
 * @returns {object|null} Workspace page config or null
 */
export function findWorkspaceAncestor(pageId, pages) {
  if (!pageId || !pages?.length) return null;
  const byId = {};
  for (const p of pages) byId[p.id] = p;
  let current = byId[pageId];
  const visited = new Set();
  while (current) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    const pt = current.page_type || current.pageType;
    if (pt === "workspace") return current;
    current = current.parentId ? byId[current.parentId] : null;
  }
  return null;
}
