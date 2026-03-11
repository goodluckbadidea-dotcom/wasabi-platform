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
  lines.push(`## Current Data Summary (${data.length} records)`);

  // Title field
  const titleField = schema.title?.name;

  // Property distributions for select/status fields
  const catFields = [...(schema.statuses || []), ...(schema.selects || [])];
  for (const field of catFields.slice(0, 5)) {
    const counts = {};
    for (const page of data) {
      const val = readField(page, field.name);
      if (val) counts[val] = (counts[val] || 0) + 1;
    }
    if (Object.keys(counts).length > 0) {
      const dist = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      lines.push(`- **${field.name}**: ${dist}`);
    }
  }

  // Number summaries
  for (const field of (schema.numbers || []).slice(0, 4)) {
    const vals = data.map((p) => readField(p, field.name)).filter((v) => v != null && !isNaN(v));
    if (vals.length > 0) {
      const sum = vals.reduce((a, b) => a + Number(b), 0);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const avg = (sum / vals.length).toFixed(1);
      lines.push(`- **${field.name}**: min=${min}, max=${max}, avg=${avg}, total=${sum} (${vals.length} values)`);
    }
  }

  // Date ranges
  for (const field of (schema.dates || []).slice(0, 3)) {
    const dates = data.map((p) => {
      const val = readField(p, field.name);
      if (!val) return null;
      return typeof val === "object" ? val.start : val;
    }).filter(Boolean).sort();
    if (dates.length > 0) {
      lines.push(`- **${field.name}**: ${dates[0]} to ${dates[dates.length - 1]} (${dates.length} values)`);
    }
  }

  // First 15 records as compact table
  if (titleField) {
    const keyFields = [];
    if (catFields.length > 0) keyFields.push(catFields[0].name);
    if (schema.numbers?.length > 0) keyFields.push(schema.numbers[0].name);
    if (schema.dates?.length > 0) keyFields.push(schema.dates[0].name);
    if (keyFields.length === 0 && schema.richTexts?.length > 0) keyFields.push(schema.richTexts[0].name);

    const headers = [titleField, ...keyFields.slice(0, 3)];
    lines.push("");
    lines.push(`### Sample Records`);
    lines.push(`| ${headers.join(" | ")} |`);
    lines.push(`| ${headers.map(() => "---").join(" | ")} |`);

    for (const page of data.slice(0, 15)) {
      const cells = headers.map((h) => {
        const val = readField(page, h);
        if (val === null || val === undefined) return "";
        if (typeof val === "object" && val.start) return val.start;
        return String(val).slice(0, 40);
      });
      lines.push(`| ${cells.join(" | ")} |`);
    }

    if (data.length > 15) {
      lines.push(`\n*...and ${data.length - 15} more records. Use \`query_database\` for full data.*`);
    }
  }

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
  if (text.length < 80 && conversationDepth < 3) return { maxTokens: 1024, maxIterations: 6 };
  if (/build|create|design|setup|implement|system|track|manage/i.test(text) && text.length > 150)
    return { maxTokens: 4096, maxIterations: 12 };
  if (/analyze|summarize|compare|report|show|find/i.test(text))
    return { maxTokens: 2048, maxIterations: 8 };
  return { maxTokens: 2048, maxIterations: 8 };
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
