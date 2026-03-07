// ─── Automation Execution Engine ───
// Browser-only polling engine. Queries the Automation Rules DB
// periodically and executes rules when trigger conditions are met.
// Also supports node-based automation flows (via flowExecutor).
// No server cron — runs via setInterval in the browser tab.

import * as client from "../notion/client.js";
import { queryAll } from "../notion/pagination.js";
import { readProp } from "../notion/properties.js";
import { safeJSON } from "../utils/helpers.js";

// ─── Constants ───

const LOG_PREFIX = "[Automation]";
const DEFAULT_TICK_MS = 60_000;          // 1 minute default poll
const BACKOFF_TICK_MS = 300_000;         // 5 minutes when no rules found
const MAX_CONCURRENT = 3;               // Max parallel rule executions per tick
const AUTOMATION_MODEL = "claude-haiku-4-5-20251001";

// ─── Template Expansion ───

/**
 * Replace {{field_name}} placeholders in a template string
 * with values from the data object. Missing keys become empty strings.
 *
 * @param {string} template - String containing {{key}} placeholders
 * @param {object} data - Key/value map for substitution
 * @returns {string} Expanded string
 */
export function expandTemplate(template, data) {
  if (!template) return "";
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = data[key];
    if (val === null || val === undefined) return "";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  });
}

// ─── Parse Rule Page ───

/**
 * Convert a raw Notion page from the Rules DB into a clean rule object.
 *
 * @param {object} page - Notion page object with .properties
 * @returns {object} Normalised rule
 */
export function parseRulePage(page) {
  const triggerConfigRaw = readProp(page.properties["Trigger Config"]);
  let triggerConfig = null;
  if (triggerConfigRaw) {
    try {
      triggerConfig = JSON.parse(triggerConfigRaw);
    } catch (err) {
      console.warn(LOG_PREFIX, `Invalid JSON in Trigger Config for page ${page.id}:`, err.message);
    }
  }

  // readProp on a date property returns { start, end, timeZone } or null
  const lastFiredRaw = readProp(page.properties["Last Fired"]);
  const lastFired = lastFiredRaw?.start || lastFiredRaw || null;

  return {
    id: page.id,
    name: readProp(page.properties.Name),
    description: readProp(page.properties.Description),
    trigger: readProp(page.properties.Trigger),
    triggerConfig,
    instruction: readProp(page.properties.Instruction),
    databaseId: readProp(page.properties["Database ID"]),
    enabled: readProp(page.properties.Enabled),
    lastFired,
    fireCount: readProp(page.properties["Fire Count"]) || 0,
    ownerPage: readProp(page.properties["Owner Page"]),
  };
}

// ─── Trigger Evaluation ───

/**
 * Pure function: decide whether a rule should fire right now.
 *
 * Returns:
 *   true          — fire immediately (schedule trigger met)
 *   "needs_query" — engine must query the target DB to decide
 *   false         — do not fire
 *
 * @param {object} rule - Parsed rule object
 * @param {Date}   currentTime - Current timestamp
 * @returns {boolean|string}
 */
export function evaluateTrigger(rule, currentTime) {
  if (!rule.trigger) return false;

  switch (rule.trigger) {
    // ── Schedule trigger ──
    // Fires when enough time has elapsed since lastFired.
    case "schedule": {
      const intervalMin = rule.triggerConfig?.interval_minutes;
      if (!intervalMin || intervalMin <= 0) {
        console.warn(LOG_PREFIX, `Rule "${rule.name}" has schedule trigger but no valid interval_minutes`);
        return false;
      }

      // First run: if never fired before, fire now
      if (!rule.lastFired) return true;

      const lastMs = new Date(rule.lastFired).getTime();
      if (isNaN(lastMs)) return true; // Invalid date — treat as never fired

      const elapsedMs = currentTime.getTime() - lastMs;
      const intervalMs = intervalMin * 60_000;
      return elapsedMs >= intervalMs;
    }

    // ── Event-driven triggers ──
    // The engine must query the target DB to check for changes.
    case "status_change":
    case "field_change":
    case "page_created":
      return "needs_query";

    // ── Manual trigger ──
    // Only fires via explicit runRule() call, never from the poll loop.
    case "manual":
      return false;

    default:
      console.warn(LOG_PREFIX, `Unknown trigger type "${rule.trigger}" on rule "${rule.name}"`);
      return false;
  }
}

// ─── Rule Execution ───

/**
 * Execute a single automation rule.
 *
 * Fast path: Instruction starts with "post_notification:" — expand template
 *            placeholders and post a notification directly (no LLM call).
 *
 * Slow path: Run a Haiku agent with AUTO_TOOLS to carry out the instruction.
 *
 * @param {object} rule - Parsed rule object
 * @param {object} opts - Engine options
 * @param {object} [contextData] - Optional data for template expansion
 * @returns {Promise<{ path: string, result: any }>}
 */
export async function executeRule(rule, opts, contextData = {}) {
  const { workerUrl, notionKey, claudeKey, notifDbId } = opts;

  // Merge rule fields into template data so {{name}}, {{databaseId}}, etc. work
  const templateData = {
    name: rule.name,
    description: rule.description,
    databaseId: rule.databaseId,
    ownerPage: rule.ownerPage,
    fireCount: rule.fireCount,
    ...contextData,
  };

  const instruction = (rule.instruction || "").trim();

  // ── Fast path: direct notification ──
  if (instruction.startsWith("post_notification:")) {
    const messageTemplate = instruction.slice("post_notification:".length).trim();
    const message = expandTemplate(messageTemplate, templateData);

    console.log(LOG_PREFIX, `Fast-path notification for rule "${rule.name}":`, message);

    await client.postNotification(workerUrl, notionKey, notifDbId, {
      message,
      type: "notification",
      source: `automation:${rule.name}`,
    });

    return { path: "fast", result: message };
  }

  // ── Slow path: LLM agent ──
  console.log(LOG_PREFIX, `Running agent for rule "${rule.name}"...`);

  // Dynamic imports to avoid circular dependencies
  const { runAgent } = await import("./runAgent.js");
  const { AUTO_TOOLS } = await import("./tools.js");
  const { createPageToolExecutor } = await import("./toolExecutor.js");

  // Create a scoped executor — automation agents get query + notification tools
  const executeTool = createPageToolExecutor({
    workerUrl,
    notionKey,
    notifDbId,
    kbDbId: opts.kbDbId || null,
    scopedDatabaseIds: rule.databaseId ? [rule.databaseId] : [],
  });

  const systemPrompt = [
    `You are an automation agent for rule "${rule.name}".`,
    rule.description ? `Description: ${rule.description}` : null,
    `Instruction: ${instruction}`,
    rule.databaseId ? `Database: ${rule.databaseId}` : null,
    "Complete the instruction efficiently. Do not ask follow-up questions.",
  ].filter(Boolean).join("\n");

  const result = await runAgent({
    messages: [
      { role: "user", content: `Execute this automation now. ${instruction}` },
    ],
    systemPrompt,
    tools: AUTO_TOOLS,
    model: AUTOMATION_MODEL,
    workerUrl,
    claudeKey,
    executeTool,
    maxIterations: 6,
    maxTokens: 1024,
  });

  console.log(LOG_PREFIX, `Agent finished for rule "${rule.name}":`, result.text?.slice(0, 200));

  return { path: "agent", result };
}

// ─── Event-driven trigger helpers ───

/**
 * For status_change / field_change / page_created triggers, query the
 * target database for pages modified since the rule last fired and
 * check whether trigger conditions are met.
 *
 * @param {object} rule - Parsed rule object
 * @param {object} opts - Engine options (workerUrl, notionKey)
 * @returns {Promise<{ shouldFire: boolean, contextData: object }>}
 */
async function checkEventTrigger(rule, opts) {
  const { workerUrl, notionKey } = opts;

  if (!rule.databaseId) {
    console.warn(LOG_PREFIX, `Rule "${rule.name}" needs a Database ID for event triggers`);
    return { shouldFire: false, contextData: {} };
  }

  // Build a filter for pages modified since last fired
  const lastFiredISO = rule.lastFired
    ? new Date(rule.lastFired).toISOString()
    : new Date(Date.now() - 24 * 60 * 60_000).toISOString(); // Default: last 24h

  const filter = {
    timestamp: "last_edited_time",
    last_edited_time: { after: lastFiredISO },
  };

  let results;
  try {
    results = await queryAll(workerUrl, notionKey, rule.databaseId, filter);
  } catch (err) {
    console.error(LOG_PREFIX, `Failed to query DB for rule "${rule.name}":`, err.message);
    return { shouldFire: false, contextData: {} };
  }

  if (!results || results.length === 0) {
    return { shouldFire: false, contextData: {} };
  }

  const cfg = rule.triggerConfig || {};

  switch (rule.trigger) {
    // ── status_change ──
    // triggerConfig: { field: "Status", to: "Done" }
    case "status_change": {
      const fieldName = cfg.field || "Status";
      const targetValue = cfg.to;
      if (!targetValue) {
        // No target value configured — fire on any change
        return {
          shouldFire: true,
          contextData: { matched_count: results.length },
        };
      }
      const matched = results.filter((page) => {
        const val = readProp(page.properties[fieldName]);
        return val === targetValue;
      });
      return {
        shouldFire: matched.length > 0,
        contextData: {
          matched_count: matched.length,
          matched_ids: matched.map((p) => p.id).slice(0, 10),
          field: fieldName,
          to: targetValue,
        },
      };
    }

    // ── field_change ──
    // triggerConfig: { field: "Priority", value: "High" }
    case "field_change": {
      const fieldName = cfg.field;
      if (!fieldName) {
        // No field specified — any edit counts
        return {
          shouldFire: true,
          contextData: { changed_count: results.length },
        };
      }
      const targetValue = cfg.value;
      const matched = results.filter((page) => {
        const val = readProp(page.properties[fieldName]);
        if (targetValue === undefined || targetValue === null) return true;
        return val === targetValue;
      });
      return {
        shouldFire: matched.length > 0,
        contextData: {
          matched_count: matched.length,
          matched_ids: matched.map((p) => p.id).slice(0, 10),
          field: fieldName,
          value: targetValue,
        },
      };
    }

    // ── page_created ──
    // triggerConfig: (optional) { filter_field: "Type", filter_value: "Bug" }
    case "page_created": {
      // Filter to pages created (not just edited) since lastFired
      const created = results.filter((page) => {
        const createdTime = page.created_time;
        if (!createdTime) return false;
        return new Date(createdTime).getTime() > new Date(lastFiredISO).getTime();
      });
      if (created.length === 0) {
        return { shouldFire: false, contextData: {} };
      }
      // Optional field filter
      if (cfg.filter_field && cfg.filter_value) {
        const matched = created.filter((page) => {
          const val = readProp(page.properties[cfg.filter_field]);
          return val === cfg.filter_value;
        });
        return {
          shouldFire: matched.length > 0,
          contextData: {
            new_count: matched.length,
            new_ids: matched.map((p) => p.id).slice(0, 10),
          },
        };
      }
      return {
        shouldFire: true,
        contextData: {
          new_count: created.length,
          new_ids: created.map((p) => p.id).slice(0, 10),
        },
      };
    }

    default:
      return { shouldFire: false, contextData: {} };
  }
}

// ─── Engine Factory ───

/**
 * Create and return the automation engine.
 *
 * @param {object} opts
 * @param {string} opts.workerUrl       - Cloudflare Worker proxy URL
 * @param {string} opts.notionKey       - Notion API key
 * @param {string} opts.claudeKey       - Anthropic API key
 * @param {string} opts.rulesDbId       - Automation Rules database ID
 * @param {string} opts.notifDbId       - Notifications database ID
 * @param {string} [opts.kbDbId]        - Knowledge Base database ID
 * @param {number} [opts.tickIntervalMs=60000] - Poll interval in ms
 * @param {Function} [opts.onRuleFired] - Callback: (rule, result) => void
 * @param {Function} [opts.onError]     - Callback: (error, rule?) => void
 * @returns {{ start: Function, stop: Function, runRule: Function, getStatus: Function }}
 */
export function createAutomationEngine(opts) {
  const {
    workerUrl,
    notionKey,
    claudeKey,
    rulesDbId,
    notifDbId,
    kbDbId,
    tickIntervalMs = DEFAULT_TICK_MS,
    onRuleFired,
    onError,
  } = opts;

  // ── Internal state ──
  let _intervalId = null;
  let _running = false;
  let _tickCount = 0;
  let _lastTickTime = null;
  let _lastRuleCount = -1;       // -1 = unknown, 0 = none found (triggers backoff)
  let _currentIntervalMs = tickIntervalMs;
  let _consecutiveErrors = 0;    // Track consecutive fetch failures
  const _executing = new Set();  // Rule IDs currently executing (prevents double-fire)

  // ── Single tick ──

  async function tick() {
    // Skip if tab is hidden (save resources)
    if (typeof document !== "undefined" && document.hidden) {
      console.log(LOG_PREFIX, "Tab hidden — skipping tick");
      return;
    }

    _tickCount++;
    _lastTickTime = new Date();
    console.log(LOG_PREFIX, `Tick #${_tickCount} at ${_lastTickTime.toISOString()}`);

    // 1. Query Rules DB for enabled rules
    let rules;
    try {
      const filter = {
        property: "Enabled",
        checkbox: { equals: true },
      };
      const pages = await queryAll(workerUrl, notionKey, rulesDbId, filter);
      rules = pages.map(parseRulePage);
    } catch (err) {
      _consecutiveErrors++;
      const is404 = err.message?.includes("404") || err.message?.includes("object_not_found");
      if (is404) {
        console.warn(LOG_PREFIX, `Rules database not found (404). Stopping automation engine.`);
        if (onError) onError(err);
        stop();
        return;
      }
      if (_consecutiveErrors >= 5) {
        console.warn(LOG_PREFIX, `${_consecutiveErrors} consecutive failures — stopping automation engine.`);
        if (onError) onError(err);
        stop();
        return;
      }
      if (_consecutiveErrors >= 3) {
        _currentIntervalMs = BACKOFF_TICK_MS;
        restartInterval();
      }
      console.error(LOG_PREFIX, "Failed to fetch rules:", err.message);
      if (onError) onError(err);
      return;
    }
    _consecutiveErrors = 0; // Reset on success

    console.log(LOG_PREFIX, `Found ${rules.length} enabled rule(s)`);

    // Backoff logic: if 0 enabled rules, slow down
    if (rules.length === 0) {
      if (_lastRuleCount === 0 && _currentIntervalMs < BACKOFF_TICK_MS) {
        _currentIntervalMs = BACKOFF_TICK_MS;
        restartInterval();
        console.log(LOG_PREFIX, `No rules found twice — backing off to ${BACKOFF_TICK_MS / 1000}s`);
      }
      _lastRuleCount = 0;
      return;
    }

    // Restore normal interval if we previously backed off
    if (_lastRuleCount === 0 && _currentIntervalMs !== tickIntervalMs) {
      _currentIntervalMs = tickIntervalMs;
      restartInterval();
      console.log(LOG_PREFIX, `Rules found again — restoring ${tickIntervalMs / 1000}s interval`);
    }
    _lastRuleCount = rules.length;

    // 2. Evaluate each rule
    const now = new Date();
    const toExecute = []; // { rule, contextData }

    for (const rule of rules) {
      // Skip if already executing
      if (_executing.has(rule.id)) {
        console.log(LOG_PREFIX, `Rule "${rule.name}" already executing — skipping`);
        continue;
      }

      const verdict = evaluateTrigger(rule, now);

      if (verdict === true) {
        toExecute.push({ rule, contextData: {} });
      } else if (verdict === "needs_query") {
        // Check event trigger against the database
        try {
          const { shouldFire, contextData } = await checkEventTrigger(rule, opts);
          if (shouldFire) {
            toExecute.push({ rule, contextData });
          }
        } catch (err) {
          console.error(LOG_PREFIX, `Event check failed for rule "${rule.name}":`, err.message);
          if (onError) onError(err, rule);
        }
      }
      // verdict === false: do nothing
    }

    if (toExecute.length === 0) {
      console.log(LOG_PREFIX, "No rules triggered this tick");
      return;
    }

    console.log(LOG_PREFIX, `${toExecute.length} rule(s) triggered — executing (max ${MAX_CONCURRENT} concurrent)`);

    // 3. Execute triggered rules (capped at MAX_CONCURRENT)
    const batch = toExecute.slice(0, MAX_CONCURRENT);

    const executions = batch.map(async ({ rule, contextData }) => {
      _executing.add(rule.id);

      try {
        // Execute the rule
        const result = await executeRule(rule, opts, contextData);

        // 4. Update Last Fired + increment Fire Count
        const updatedProps = {
          "Last Fired": { date: { start: new Date().toISOString() } },
          "Fire Count": { number: (rule.fireCount || 0) + 1 },
        };

        try {
          await client.updatePage(workerUrl, notionKey, rule.id, updatedProps);
        } catch (updateErr) {
          console.error(LOG_PREFIX, `Failed to update rule "${rule.name}" after execution:`, updateErr.message);
        }

        // 5. Callback
        console.log(LOG_PREFIX, `Rule "${rule.name}" fired successfully (${result.path} path)`);
        if (onRuleFired) onRuleFired(rule, result);

        return result;
      } catch (err) {
        console.error(LOG_PREFIX, `Rule "${rule.name}" execution failed:`, err.message);
        if (onError) onError(err, rule);
        return null;
      } finally {
        _executing.delete(rule.id);
      }
    });

    await Promise.allSettled(executions);

    // ── Flow processing (node-based automations) ──
    await processFlows();
  }

  /**
   * Process enabled node-based automation flows.
   * Lazily checks for flowsDbId and runs triggered flows.
   */
  async function processFlows() {
    // Check if flowsDbId exists (may have been created after engine start)
    let flowsDbId;
    try {
      const stored = JSON.parse(localStorage.getItem("wasabi_platform_ids") || "{}");
      flowsDbId = stored.flowsDbId;
    } catch {}
    if (!flowsDbId) return;

    let flowPages;
    try {
      flowPages = await queryAll(workerUrl, notionKey, flowsDbId, {
        property: "Enabled",
        checkbox: { equals: true },
      });
    } catch (err) {
      // Silently skip — flows DB might not exist yet
      if (!err.message?.includes("404")) {
        console.warn(LOG_PREFIX, "Failed to fetch flows:", err.message);
      }
      return;
    }

    if (flowPages.length === 0) return;

    // Lazy import flowExecutor to avoid circular deps
    let executeFlow;
    try {
      const mod = await import("./flowExecutor.js");
      executeFlow = mod.executeFlow;
    } catch (err) {
      console.warn(LOG_PREFIX, "Flow executor not available:", err.message);
      return;
    }

    for (const page of flowPages) {
      const flowDataStr = page.properties?.["Flow Data"]?.rich_text?.map((t) => t.plain_text).join("") || "{}";
      const flowData = safeJSON(flowDataStr, {});
      const flowId = page.id;

      if (!flowData.nodes || flowData.nodes.length === 0) continue;
      if (_executing.has(flowId)) continue;

      // Check if any trigger node should fire
      const triggerNodes = flowData.nodes.filter((n) => n.type === "trigger");
      let shouldFire = false;

      for (const trigger of triggerNodes) {
        if (trigger.subtype === "schedule") {
          const lastRun = page.properties?.["Last Run"]?.date?.start;
          const interval = trigger.config?.interval_minutes || 60;
          if (!lastRun) { shouldFire = true; break; }
          const elapsed = (Date.now() - new Date(lastRun).getTime()) / 60_000;
          if (elapsed >= interval) { shouldFire = true; break; }
        }
        // manual triggers don't fire on poll, status_change/field_change need query (Phase 2)
      }

      if (!shouldFire) continue;

      _executing.add(flowId);
      try {
        await executeFlow(
          flowData,
          { workerUrl, notionKey, claudeKey, notifDbId, rulesDbId },
          {},
          null, null // no visual trace in background
        );

        // Update Last Run + Run Count
        const runCount = page.properties?.["Run Count"]?.number || 0;
        await client.updatePage(workerUrl, notionKey, flowId, {
          "Last Run": { date: { start: new Date().toISOString() } },
          "Run Count": { number: runCount + 1 },
        }).catch(() => {});

        console.log(LOG_PREFIX, `Flow "${page.properties?.Name?.title?.[0]?.plain_text || flowId}" executed`);
      } catch (err) {
        console.error(LOG_PREFIX, `Flow execution failed:`, err.message);
      } finally {
        _executing.delete(flowId);
      }
    }
  }

  // ── Interval management ──

  function restartInterval() {
    if (_intervalId !== null) {
      clearInterval(_intervalId);
    }
    if (_running) {
      _intervalId = setInterval(tick, _currentIntervalMs);
    }
  }

  // ── Public API ──

  function start() {
    if (_running) {
      console.warn(LOG_PREFIX, "Engine already running");
      return;
    }
    _running = true;
    _currentIntervalMs = tickIntervalMs;
    console.log(LOG_PREFIX, `Starting engine (interval: ${tickIntervalMs / 1000}s)`);

    // Run first tick immediately, then schedule repeats
    tick().catch((err) => {
      console.error(LOG_PREFIX, "First tick error:", err.message);
      if (onError) onError(err);
    });
    _intervalId = setInterval(tick, _currentIntervalMs);
  }

  function stop() {
    if (!_running) {
      console.warn(LOG_PREFIX, "Engine not running");
      return;
    }
    _running = false;
    if (_intervalId !== null) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
    console.log(LOG_PREFIX, "Engine stopped");
  }

  /**
   * Manually trigger a specific rule by ID, bypassing trigger evaluation.
   * Useful for "manual" trigger type or testing.
   *
   * @param {string} ruleId - Notion page ID of the rule
   * @returns {Promise<{ path: string, result: any }|null>}
   */
  async function runRule(ruleId) {
    if (_executing.has(ruleId)) {
      console.warn(LOG_PREFIX, `Rule ${ruleId} already executing`);
      return null;
    }

    console.log(LOG_PREFIX, `Manual trigger for rule ${ruleId}`);

    // Fetch the rule page
    let page;
    try {
      page = await client.getPage(workerUrl, notionKey, ruleId);
    } catch (err) {
      console.error(LOG_PREFIX, `Failed to fetch rule ${ruleId}:`, err.message);
      if (onError) onError(err);
      return null;
    }

    const rule = parseRulePage(page);

    _executing.add(ruleId);
    try {
      const result = await executeRule(rule, opts);

      // Update Last Fired + Fire Count
      const updatedProps = {
        "Last Fired": { date: { start: new Date().toISOString() } },
        "Fire Count": { number: (rule.fireCount || 0) + 1 },
      };

      try {
        await client.updatePage(workerUrl, notionKey, ruleId, updatedProps);
      } catch (updateErr) {
        console.error(LOG_PREFIX, `Failed to update rule after manual run:`, updateErr.message);
      }

      console.log(LOG_PREFIX, `Manual rule "${rule.name}" completed (${result.path} path)`);
      if (onRuleFired) onRuleFired(rule, result);

      return result;
    } catch (err) {
      console.error(LOG_PREFIX, `Manual rule execution failed:`, err.message);
      if (onError) onError(err, rule);
      return null;
    } finally {
      _executing.delete(ruleId);
    }
  }

  /**
   * Get engine status snapshot.
   *
   * @returns {object}
   */
  function getStatus() {
    return {
      running: _running,
      tickCount: _tickCount,
      lastTickTime: _lastTickTime ? _lastTickTime.toISOString() : null,
      currentIntervalMs: _currentIntervalMs,
      lastRuleCount: _lastRuleCount,
      executingRuleIds: [..._executing],
    };
  }

  return { start, stop, runRule, getStatus };
}
