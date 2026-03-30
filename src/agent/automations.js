// ─── Automation Execution Engine ───
// Browser-only polling engine. Queries D1 automation_rules
// periodically and executes rules when trigger conditions are met.
// Also supports node-based automation flows (via flowExecutor).
// No server cron — runs via setInterval in the browser tab.

import * as api from "../lib/api.js";

// Legacy Notion imports (kept for backward compat)
import * as client from "../notion/client.js";
import { queryAll } from "../notion/pagination.js";
import { readProp } from "../notion/properties.js";
import { safeJSON } from "../utils/helpers.js";

// ─── Constants ───

const LOG_PREFIX = "[Automation]";
const DEFAULT_TICK_MS = 300_000;         // 5 minutes default poll
const BACKOFF_TICK_MS = 1_800_000;       // 30 minutes when no rules found
const MAX_CONCURRENT = 3;               // Max parallel rule executions per tick
const AUTOMATION_MODEL = "claude-haiku-4-5-20251001";

// ─── Template Expansion ───

/**
 * Replace {{field_name}} placeholders in a template string
 * with values from the data object. Missing keys become empty strings.
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

// ─── Parse D1 Rule ───

/**
 * Convert a D1 automation_rules row into a normalized rule object.
 */
export function parseD1Rule(row) {
  const triggerConfig = typeof row.trigger_config === "string"
    ? safeJSON(row.trigger_config, {})
    : (row.trigger_config || {});
  const actionConfig = typeof row.action_config === "string"
    ? safeJSON(row.action_config, {})
    : (row.action_config || {});

  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    trigger: row.trigger_type,
    triggerConfig,
    instruction: actionConfig.instruction || "",
    databaseId: actionConfig.database_id || row.scope_table_id || "",
    enabled: !!row.enabled,
    lastFired: row.last_fired_at || null,
    fireCount: row.fire_count || 0,
    ownerPage: actionConfig.owner_page || "",
  };
}

// ─── Trigger Evaluation ───

/**
 * Pure function: decide whether a rule should fire right now.
 */
export function evaluateTrigger(rule, currentTime) {
  if (!rule.trigger) return false;

  switch (rule.trigger) {
    case "schedule": {
      const intervalMin = rule.triggerConfig?.interval_minutes;
      if (!intervalMin || intervalMin <= 0) {
        console.warn(LOG_PREFIX, `Rule "${rule.name}" has schedule trigger but no valid interval_minutes`);
        return false;
      }
      if (!rule.lastFired) return true;
      const lastMs = new Date(rule.lastFired).getTime();
      if (isNaN(lastMs)) return true;
      const elapsedMs = currentTime.getTime() - lastMs;
      return elapsedMs >= intervalMin * 60_000;
    }
    case "status_change":
    case "field_change":
    case "page_created":
      return "needs_query";
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
 */
export async function executeRule(rule, opts, contextData = {}) {
  const { workerUrl, claudeKey } = opts;

  // Spread first changed record's cells into templateData for {{field}} resolution
  const firstRecord = contextData.changed_records?.[0] || {};
  const templateData = {
    name: rule.name,
    description: rule.description,
    databaseId: rule.databaseId,
    ownerPage: rule.ownerPage,
    fireCount: rule.fireCount,
    matched_count: contextData.matched_count || 0,
    changed_field: firstRecord.changed_field || "",
    new_value: firstRecord.new_value || "",
    record_name: firstRecord.name || "",
    ...(firstRecord.cells || {}),
    ...contextData,
  };

  const instruction = (rule.instruction || "").trim();

  // ── Fast path: direct notification ──
  if (instruction.startsWith("post_notification:")) {
    const messageTemplate = instruction.slice("post_notification:".length).trim();
    const message = expandTemplate(messageTemplate, templateData);

    await api.createNotification({
      message,
      type: "notification",
      source: `automation:${rule.name}`,
    });

    return { path: "fast", result: message };
  }

  // ── Slow path: LLM agent ──

  const { runAgent } = await import("./runAgent.js");
  const { AUTO_TOOLS } = await import("./tools.js");
  const { createToolExecutor } = await import("./toolExecutor.js");

  const executeTool = createToolExecutor({
    notifDbId: "d1",
    kbDbId: "d1",
    claudeKey: opts.claudeKey || "",
  });

  // Build rich context summary for the agent
  const changedRecords = contextData.changed_records || [];
  const changedSummary = changedRecords.slice(0, 5).map((r) => {
    const label = r.name || r.id;
    const field = r.changed_field || "record";
    const val = r.new_value !== undefined && r.new_value !== null ? ` → "${r.new_value}"` : "";
    return `- ${label}: ${field} changed${val}`;
  }).join("\n");

  const systemPrompt = [
    `You are an automation agent for rule "${rule.name}".`,
    rule.description ? `Description: ${rule.description}` : null,
    `Instruction: ${instruction}`,
    rule.databaseId ? `Database ID: ${rule.databaseId}` : null,
    changedRecords.length > 0
      ? `\nTriggered by ${changedRecords.length} changed record(s):\n${changedSummary}`
      : null,
    "\nComplete the instruction efficiently. Do not ask follow-up questions.",
    "Use query_database to look up data, update_page to modify records, and post_notification for alerts.",
  ].filter(Boolean).join("\n");

  const userMessage = changedRecords.length > 0
    ? `Execute this automation now. ${instruction}\n\nChanged records: ${JSON.stringify(changedRecords.slice(0, 5))}`
    : `Execute this automation now. ${instruction}`;

  const result = await runAgent({
    messages: [
      { role: "user", content: userMessage },
    ],
    systemPrompt,
    tools: AUTO_TOOLS,
    model: AUTOMATION_MODEL,
    workerUrl,
    claudeKey,
    executeTool,
    maxIterations: 8,
    maxTokens: 2048,
  });

  return { path: "agent", result };
}

// ─── Event-driven trigger helpers ───

/**
 * For status_change / field_change / page_created triggers, query the
 * target database for pages modified since the rule last fired.
 */
async function checkEventTrigger(rule, opts) {
  const { workerUrl, notionKey } = opts;

  if (!rule.databaseId) {
    console.warn(LOG_PREFIX, `Rule "${rule.name}" needs a Database ID for event triggers`);
    return { shouldFire: false, contextData: {} };
  }

  const lastFiredISO = rule.lastFired
    ? new Date(rule.lastFired).toISOString()
    : new Date(Date.now() - 24 * 60 * 60_000).toISOString();

  // Try D1 table query first, fall back to Notion
  let results;
  try {
    // For Notion databases (UUID format with dashes)
    if (notionKey && rule.databaseId.includes("-") && rule.databaseId.length === 36) {
      const filter = {
        timestamp: "last_edited_time",
        last_edited_time: { after: lastFiredISO },
      };
      results = await queryAll(rule.databaseId, filter);
    } else {
      // D1 standalone table — query for recently modified rows
      const queryResult = await api.queryTable(rule.databaseId, {
        limit: 100,
      });
      results = (queryResult.rows || []).map((r) => ({
        id: r.id,
        properties: r.cells || {},
        created_time: r.created_at,
        last_edited_time: r.updated_at,
      }));
    }
  } catch (err) {
    console.error(LOG_PREFIX, `Failed to query DB for rule "${rule.name}":`, err.message);
    return { shouldFire: false, contextData: {} };
  }

  if (!results || results.length === 0) {
    return { shouldFire: false, contextData: {} };
  }

  // Simple trigger evaluation
  const cfg = rule.triggerConfig || {};

  switch (rule.trigger) {
    case "status_change":
    case "field_change": {
      // Extract the watched field from trigger config
      const watchedField = cfg.field || null;

      // Filter to records that were actually modified since last fired
      const recentlyModified = results.filter((page) => {
        const editTime = page.last_edited_time;
        if (!editTime) return true; // can't check, include it
        return new Date(editTime).getTime() > new Date(lastFiredISO).getTime();
      });

      if (recentlyModified.length === 0) {
        return { shouldFire: false, contextData: {} };
      }

      // Build rich context with actual record data
      const changedRecords = recentlyModified.slice(0, 10).map((page) => {
        const cells = page.properties || {};
        // Find a title/name field
        const name = Object.values(cells).find((v) => typeof v === "string" && v.length > 0) || page.id;
        return {
          id: page.id,
          name: typeof name === "string" ? name : page.id,
          changed_field: watchedField || "(any)",
          new_value: watchedField ? (cells[watchedField] ?? "") : null,
          cells,
        };
      });

      return {
        shouldFire: true,
        contextData: {
          matched_count: recentlyModified.length,
          changed_records: changedRecords,
        },
      };
    }
    case "page_created": {
      const created = results.filter((page) => {
        const createdTime = page.created_time;
        if (!createdTime) return false;
        return new Date(createdTime).getTime() > new Date(lastFiredISO).getTime();
      });

      const newRecords = created.slice(0, 10).map((page) => {
        const cells = page.properties || {};
        const name = Object.values(cells).find((v) => typeof v === "string" && v.length > 0) || page.id;
        return { id: page.id, name: typeof name === "string" ? name : page.id, cells };
      });

      return {
        shouldFire: created.length > 0,
        contextData: {
          new_count: created.length,
          matched_count: created.length,
          changed_records: newRecords,
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
 * Now reads rules from D1 by default.
 */
export function createAutomationEngine(opts) {
  const {
    workerUrl,
    notionKey,
    claudeKey,
    tickIntervalMs = DEFAULT_TICK_MS,
    onRuleFired,
    onError,
  } = opts;

  let _intervalId = null;
  let _running = false;
  let _tickCount = 0;
  let _lastTickTime = null;
  let _lastRuleCount = -1;
  let _currentIntervalMs = tickIntervalMs;
  let _consecutiveErrors = 0;
  const _executing = new Set();

  // ── Single tick ──

  async function tick() {
    if (typeof document !== "undefined" && document.hidden) {
      return;
    }

    _tickCount++;
    _lastTickTime = new Date();

    // 1. Query D1 for enabled rules
    let rules;
    try {
      const result = await api.listRules({ enabled: true });
      rules = (result.rules || []).map(parseD1Rule);
    } catch (err) {
      _consecutiveErrors++;
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
    _consecutiveErrors = 0;


    // Backoff if no rules
    if (rules.length === 0) {
      if (_lastRuleCount === 0 && _currentIntervalMs < BACKOFF_TICK_MS) {
        _currentIntervalMs = BACKOFF_TICK_MS;
        restartInterval();
      }
      _lastRuleCount = 0;
      return;
    }

    if (_lastRuleCount === 0 && _currentIntervalMs !== tickIntervalMs) {
      _currentIntervalMs = tickIntervalMs;
      restartInterval();
    }
    _lastRuleCount = rules.length;

    // 2. Evaluate each rule
    const now = new Date();
    const toExecute = [];

    for (const rule of rules) {
      if (_executing.has(rule.id)) {
        continue;
      }

      // Dedup: skip if server cron already fired this rule within the tick window
      if (rule.lastFired) {
        const lastFiredMs = new Date(rule.lastFired).getTime();
        if (!isNaN(lastFiredMs) && (now.getTime() - lastFiredMs) < _currentIntervalMs) {
          continue;
        }
      }

      const verdict = evaluateTrigger(rule, now);

      if (verdict === true) {
        toExecute.push({ rule, contextData: {} });
      } else if (verdict === "needs_query") {
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
    }

    if (toExecute.length === 0) {
      return;
    }

    // 3. Execute triggered rules
    const batch = toExecute.slice(0, MAX_CONCURRENT);

    const executions = batch.map(async ({ rule, contextData }) => {
      _executing.add(rule.id);

      try {
        const result = await executeRule(rule, opts, contextData);

        // Update Last Fired + increment Fire Count in D1
        try {
          await api.updateRule(rule.id, {
            last_fired_at: new Date().toISOString(),
            fire_count: (rule.fireCount || 0) + 1,
          });
        } catch (updateErr) {
          console.error(LOG_PREFIX, `Failed to update rule "${rule.name}" after execution:`, updateErr.message);
        }

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
  }

  /**
   * Manually trigger a specific rule by ID.
   */
  async function runRule(ruleId) {
    if (_executing.has(ruleId)) {
      console.warn(LOG_PREFIX, `Rule ${ruleId} already executing`);
      return null;
    }


    let rule;
    try {
      const row = await api.getRule(ruleId);
      rule = parseD1Rule(row);
    } catch (err) {
      console.error(LOG_PREFIX, `Failed to fetch rule ${ruleId}:`, err.message);
      if (onError) onError(err);
      return null;
    }

    _executing.add(ruleId);
    try {
      const result = await executeRule(rule, opts);

      try {
        await api.updateRule(ruleId, {
          last_fired_at: new Date().toISOString(),
          fire_count: (rule.fireCount || 0) + 1,
        });
      } catch (updateErr) {
        console.error(LOG_PREFIX, `Failed to update rule after manual run:`, updateErr.message);
      }

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
