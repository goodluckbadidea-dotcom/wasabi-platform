// ─── useAICuratedTasks Hook ───
// Scans connected databases for task-like items, uses Haiku to prioritize.
// Caches results for 15 minutes to minimize token costs.

import { useState, useEffect, useCallback, useRef } from "react";
import { usePlatform } from "../context/PlatformContext.jsx";
import { useUserSync } from "../context/UserSyncContext.jsx";
import {
  listRows, claudeProxy, getTableSchema, listTaskActivity, upsertTaskActivity,
  getRecordViews, listTaskInteractions, logTaskInteraction,
  getActiveSnoozes, snoozeTask as snoozeTaskApi, unsnoozeTask as unsnoozeTaskApi,
  listNotifications,
} from "../lib/api.js";
import { loadCachedNeuronGraph } from "../neurons/neuronStorage.js";
import {
  normalizeD1Task, getCached, setCache, getStaleCache, parseDate,
  shouldIncludeTask, isSmartOverdue,
  persistInteraction, mergeInteractionAdjustments, loadInteractionLedger,
} from "./taskHelpers.js";

const CACHE_KEY_PREFIX = "wasabi_ai_tasks_v11"; // v11: raised limits, sub-items excluded, updated_at sort
const INSIGHT_CACHE_KEY = "wasabi_insight";
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes — stale-while-revalidate shows cached data instantly
const MAX_DATABASES = 25;
const MAX_ITEMS_PER_DB = 1000;

// Per-user cache key — prevents cross-user cache contamination
function cacheKeyForUser(userId) {
  return userId ? `${CACHE_KEY_PREFIX}_${userId}` : CACHE_KEY_PREFIX;
}

// Role-based task filter — non-admins only see owned/mentioned/assigned/unowned tasks
// Unowned tasks (owner_user_id='default' from Notion sync) are visible to everyone.
// Tasks explicitly assigned to OTHER users are hidden from non-admins.
function applyRoleFilter(tasks, identity) {
  if (identity?.role === "admin") return tasks;
  return tasks.filter((t) => {
    // Unowned tasks (no explicit owner) — visible to all
    if (!t._ownerUserIds || t._ownerUserIds.length === 0) return true;
    // Owned/mentioned/assigned — visible
    return t._isOwned || t._isMentioned || t._isAssigned;
  });
}

// ── Local heuristic adjustments (instant, no AI call) ──
// Applied when enriched WebSocket events arrive so task list reacts immediately
const DONE_STATUSES = new Set([
  "done", "complete", "completed", "shipped", "delivered",
  "closed", "archived", "cancelled", "canceled", "resolved", "finished",
]);
const HOLD_STATUSES = new Set([
  "waiting", "waiting on vendor", "blocked", "on hold", "pending",
]);

function applyLocalAdjustment(tasks, changeEvent, identity) {
  const { recordId, changes } = changeEvent;
  if (!changes) return tasks;
  const userId = identity?.id;
  let modified = tasks.map((t) => ({ ...t })); // shallow clone each task
  let needsResort = false;

  // --- Ownership change ---
  if (changes.ownerChanged) {
    const newOwners = changes.newOwnerUserIds || [];
    const myIdInNewOwners = userId && newOwners.includes(userId);

    modified = modified.map((t) => {
      if (t.id !== recordId) return t;
      const baseScore = t._aiBaseScore ?? t._aiScore ?? 3;
      // Update ownership flags
      t._ownerUserIds = newOwners;
      t._isOwned = !!myIdInNewOwners;
      if (myIdInNewOwners) {
        // Assigned to me → boost
        t._aiBaseScore = baseScore;
        t._aiScore = baseScore + 2;
      } else if (identity?.role !== "admin") {
        // Removed from me (non-admin) → remove from list
        t._aiScore = -99;
      } else {
        // Admin still sees it but deprioritized
        t._aiBaseScore = baseScore;
        t._aiScore = baseScore - 2;
      }
      needsResort = true;
      return t;
    });

    // If ownership was assigned to me and the task isn't in the list yet, we can't
    // add it locally (we don't have full task data). Mark dirty for a background rescan.
    if (myIdInNewOwners && !modified.some((t) => t.id === recordId)) {
      // Task not in list — will be picked up by background rescan
    }
  }

  // --- Status change ---
  if (changes.statusChanged && changes.newStatus != null) {
    const statusLower = String(changes.newStatus).toLowerCase().trim();
    modified = modified.map((t) => {
      if (t.id !== recordId) return t;
      const baseScore = t._aiBaseScore ?? t._aiScore ?? 3;
      t.status = changes.newStatus;
      if (DONE_STATUSES.has(statusLower)) {
        // Terminal status → remove
        t._aiScore = -99;
        t.done = true;
      } else if (statusLower === "paused") {
        t._aiBaseScore = baseScore;
        t._aiScore = baseScore - 1;
      } else if (HOLD_STATUSES.has(statusLower)) {
        t._aiBaseScore = baseScore;
        t._aiScore = baseScore + 1;
      } else {
        // Other status change — mark recently active
        t._recentlyActive = true;
      }
      needsResort = true;
      return t;
    });
  }

  // Filter out removed tasks and re-sort
  if (needsResort) {
    modified = modified.filter((t) => (t._aiScore || 0) > -5);
    modified.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));
  }

  return modified;
}

// ── Task-likeness scoring ──
// Instead of a naive "has status + title" check, we score databases on
// multiple signals. This prevents contacts, inventory, CRM records, etc.
// from being treated as tasks.

// Partial-match: if any of these appear WITHIN a status option name, it's task-like
const TASK_STATUS_FRAGMENTS = [
  "to do", "todo", "progress", "done", "complete", "not started",
  "blocked", "backlog", "pending", "open", "closed", "cancel",
  "on hold", "review", "testing", "ready", "planned", "doing",
  "won't do", "wont do", "started", "finish", "waiting", "deferred",
  "urgent", "overdue",
];

// Partial-match: if any of these appear WITHIN a status option name, it's NOT task-like
const NON_TASK_STATUS_FRAGMENTS = [
  "active", "inactive", "lead", "customer", "prospect", "qualified",
  "churned", "subscri", "verified", "unverified",
  "published", "expired", "available", "unavailable",
  "in stock", "out of stock", "discontinued",
];

const TASK_NAME_PATTERNS = [
  "task", "todo", "to-do", "to do", "action", "issue", "ticket", "bug",
  "story", "epic", "sprint", "milestone", "project", "assignment", "homework",
  "checklist", "backlog", "kanban", "timeline", "shipping", "production",
  "pipeline", "workflow", "tracker", "tracking", "schedule", "roadmap",
];

// Use whole-word patterns to avoid false positives (e.g. "product" matching "production")
const NON_TASK_NAME_WORDS = [
  "contacts", "clients", "customers", "people", "persons", "members", "employees",
  "vendors", "suppliers", "partners", "leads", "accounts",
  "products", "inventory", "catalog", "catalogue", "items", "stock", "skus", "sku",
  "invoices", "payments", "transactions", "orders", "receipts",
  "recipes", "ingredients", "menu",
  "bookmarks", "reading list", "watchlist", "directory",
];

const TASK_COLUMN_PATTERNS = [
  "due", "deadline", "priority", "assignee", "assigned", "sprint",
  "estimate", "effort", "story point", "blocker",
];

/** Check if a string partially matches any fragment in a list */
function matchesAny(str, fragments) {
  return fragments.some((f) => str.includes(f));
}

/**
 * Score how "task-like" a Notion schema is.
 * Databases scoring ≥ 20 are considered task-like.
 * Uses partial matching on status option names for broader coverage.
 */
function scoreTaskLikeness(schema) {
  if (!schema || !schema.title) return 0;
  let score = 0;
  const reasons = [];

  // ── Database title signals ──
  const dbTitle = (schema.databaseTitle || "").toLowerCase();
  // Substring match for task patterns (broad — "production" should match "production")
  if (TASK_NAME_PATTERNS.some((p) => dbTitle.includes(p))) {
    score += 25;
    reasons.push("db name matches task pattern");
  }
  // Word-boundary match for non-task patterns (strict — "product" must NOT match "production")
  const dbWords = dbTitle.split(/[\s\-_,.:;/|]+/);
  if (NON_TASK_NAME_WORDS.some((w) => dbWords.includes(w))) {
    score -= 35;
    reasons.push("db name matches non-task word");
  }

  // ── Notion `status` type property is a strong signal ──
  // Notion designed this property type specifically for workflow/progress tracking.
  if (schema.statuses?.length > 0) {
    score += 20;
    reasons.push("has Notion status property");
  }

  // ── Status/select option analysis (partial matching) ──
  const allOptions = [];
  for (const s of (schema.statuses || [])) allOptions.push(...(s.options || []));
  for (const s of (schema.selects || [])) {
    const sName = s.name.toLowerCase();
    if (["status", "state", "stage", "progress", "phase"].some((p) => sName.includes(p))) {
      allOptions.push(...(s.options || []));
    }
  }

  if (allOptions.length > 0) {
    const optNames = allOptions.map((o) => o.name.toLowerCase());
    const taskMatches = optNames.filter((n) => matchesAny(n, TASK_STATUS_FRAGMENTS)).length;
    const nonTaskMatches = optNames.filter((n) => matchesAny(n, NON_TASK_STATUS_FRAGMENTS)).length;

    if (taskMatches > 0) {
      score += Math.min(taskMatches * 8, 25);
      reasons.push(`${taskMatches} task-like status options`);
    }
    if (nonTaskMatches > 0 && taskMatches === 0) {
      // Only penalize if there are NO task-like options (mixed DBs get benefit of doubt)
      score -= nonTaskMatches * 15;
      reasons.push(`${nonTaskMatches} non-task status options`);
    }
  }

  // ── Checkbox named "done"/"complete" is a strong signal ──
  for (const cb of (schema.checkboxes || [])) {
    const cbName = cb.name.toLowerCase();
    if (["done", "complete", "completed", "finished"].some((p) => cbName.includes(p))) {
      score += 20;
      reasons.push("has done/complete checkbox");
    }
  }

  // ── Task-indicating column names ──
  const allNames = (schema.allFields || []).map((f) => f.name.toLowerCase());
  const taskColHits = TASK_COLUMN_PATTERNS.filter((p) => allNames.some((n) => n.includes(p)));
  if (taskColHits.length > 0) {
    score += taskColHits.length * 8;
    reasons.push(`task columns: ${taskColHits.join(", ")}`);
  }

  // ── Anti-signals: contact/CRM fields ──
  if (schema.emails?.length > 0) { score -= 30; reasons.push("has email fields"); }
  if (schema.phones?.length > 0) { score -= 30; reasons.push("has phone fields"); }

  const contactCols = ["email", "phone", "address", "company", "website", "linkedin", "twitter"];
  const contactHits = contactCols.filter((p) => allNames.some((n) => n.includes(p)));
  if (contactHits.length >= 2) {
    score -= contactHits.length * 10;
    reasons.push(`contact-like columns: ${contactHits.join(", ")}`);
  }

  // ── Date fields with task-like names ──
  if (schema.dates?.length > 0) {
    const dateNames = schema.dates.map((d) => d.name.toLowerCase());
    if (dateNames.some((n) => ["due", "deadline", "start", "end"].some((p) => n.includes(p)))) {
      score += 10;
      reasons.push("has due/deadline date field");
    }
  }

  return score;
}

const TASK_SCHEMA_THRESHOLD = 20;

/**
 * Check if a classified schema has task-like fields.
 * Uses scoring across multiple signals rather than a naive boolean.
 */
function isTaskLikeSchema(schema) {
  return scoreTaskLikeness(schema) >= TASK_SCHEMA_THRESHOLD;
}

/**
 * Score how "task-like" a D1 table is based on column definitions.
 */
function isTaskLikeD1Table(columns, pageName) {
  let score = 0;
  const colNames = columns.map((c) => c.name.toLowerCase());
  const reasons = [];

  // Page name signals
  const nameLower = (pageName || "").toLowerCase();
  if (TASK_NAME_PATTERNS.some((p) => nameLower.includes(p))) {
    score += 30;
    reasons.push("table name matches task pattern");
  }
  const nameWords = nameLower.split(/[\s\-_,.:;/|]+/);
  if (NON_TASK_NAME_WORDS.some((w) => nameWords.includes(w))) {
    score -= 30;
    reasons.push("table name matches non-task word");
  }

  // Has a done/complete checkbox
  const hasCheckbox = columns.some((c) => c.type === "checkbox");
  if (hasCheckbox) {
    const cbNames = columns.filter((c) => c.type === "checkbox").map((c) => c.name.toLowerCase());
    if (cbNames.some((n) => ["done", "complete", "finished"].some((p) => n.includes(p)))) {
      score += 25;
      reasons.push("has done/complete checkbox");
    } else {
      score += 5;
    }
  }

  // Has a title-like text field
  const hasTitle = colNames.some((n) => ["task", "title", "name"].some((p) => n.includes(p)));
  if (hasTitle) score += 5;
  else return false; // Must have a title

  // Task-like column names
  const taskColHits = TASK_COLUMN_PATTERNS.filter((p) => colNames.some((n) => n.includes(p)));
  if (taskColHits.length > 0) {
    score += taskColHits.length * 10;
    reasons.push(`task columns: ${taskColHits.join(", ")}`);
  }

  // Anti-signals
  const contactHits = ["email", "phone", "address", "company", "website"].filter((p) => colNames.some((n) => n.includes(p)));
  if (contactHits.length >= 2) {
    score -= contactHits.length * 10;
    reasons.push(`contact-like columns: ${contactHits.join(", ")}`);
  }

  return score >= 20;
}

/**
 * Extract a minimal task summary for the AI prompt.
 */
function compressTask(task) {
  const obj = { title: task.title };
  if (task.status) obj.status = task.status;
  if (task.done) obj.done = true;
  if (task.priority) obj.priority = task.priority;
  if (task.allDates?.length) {
    obj.dates = task.allDates.map(d => ({
      field: d.fieldName,
      date: typeof d.date === "object" ? `${d.date.start} – ${d.date.end}` : d.date,
    }));
  }
  if (task.nearestDate) {
    obj.nearestDate = task.nearestDate;
    obj.nearestDateField = task.nearestDateField;
  } else if (task.due) {
    obj.nearestDate = task.due;
  }
  if (task._isOverdue) obj.isOverdue = true;
  if (task._isStale) obj.isStale = true;
  // Per-user signals
  if (task._isOwned) obj.ownedByUser = true;
  if (task._isAssigned) obj.assignedToUser = true;
  if (task._hasUnreadComments) obj.hasUnreadComments = true;
  if (task._isMentioned) obj.mentionedUser = true;
  if (task._lastViewedDaysAgo !== undefined) obj.lastViewedDaysAgo = task._lastViewedDaysAgo;
  if (task._blockingCount) obj.blockingCount = task._blockingCount;
  if (task._blockedByOthers) obj.blockedByOthers = true;
  // Neuron sibling signals
  if (task._neuronNames?.length) obj.neuronClusters = task._neuronNames;
  if (task._neuronSiblingUrgent) obj.neuronSiblingUrgent = true;
  // Interaction history signals (from D1 task_interactions table)
  if (task._lastInteractionType) obj.lastInteraction = task._lastInteractionType;
  if (task._lastInteractionAgo) obj.lastInteractionAgo = task._lastInteractionAgo;
  if (task._interactionGap) obj.interactionGap = task._interactionGap;
  if (task._otherUserActions?.length) obj.otherUserActions = task._otherUserActions;
  // Formula-based deprioritization suggestion (from localStorage interaction ledger)
  if (task._interactionCount > 0 && task._interactionAdjustment) {
    const baseScore = task._aiBaseScore || task._aiScore || 3;
    const pct = Math.min(95, Math.round(Math.abs(task._interactionAdjustment) / Math.max(baseScore, 1) * 100));
    if (task._interactionAdjustment < -3) obj.formulaSuggestion = `deprioritize ${pct}%`;
    else if (task._interactionAdjustment > 3) obj.formulaSuggestion = `boost ${pct}%`;
  }
  if (task._interactionBreakdown) obj.interactionBreakdown = task._interactionBreakdown;
  return obj;
}

const BASE_TARGET = 15;
const TARGET_MAX = 25;

export default function useAICuratedTasks({ dismissedIds, completedCount, userTasksTableId } = {}) {
  const { user, pages, identity } = usePlatform();
  const userSync = useUserSync();
  const CACHE_KEY = cacheKeyForUser(identity?.id);
  const INSIGHT_KEY = identity?.id ? `${INSIGHT_CACHE_KEY}_${identity.id}` : INSIGHT_CACHE_KEY;
  const [aiTasks, setAiTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false); // background re-scan indicator
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const [insight, setInsight] = useState(null);
  const [snoozedTasks, setSnoozedTasks] = useState([]);
  const [cacheDirty, setCacheDirty] = useState(false); // event-driven invalidation flag
  const scanningRef = useRef(false);
  const debounceTimerRef = useRef(null);
  const dismissedIdsRef = useRef(dismissedIds || new Set());
  const completedCountRef = useRef(completedCount || 0);
  const identityRef = useRef(identity);
  const aiTasksRef = useRef(aiTasks);

  // Keep refs in sync with latest values
  dismissedIdsRef.current = dismissedIds || new Set();
  completedCountRef.current = completedCount || 0;
  identityRef.current = identity;
  aiTasksRef.current = aiTasks;

  // Clean up old cache keys + load cached results
  // Re-runs when identity changes so role filter is always applied correctly
  useEffect(() => {
    // Cleanup stale cache versions (idempotent, cheap)
    try { localStorage.removeItem("wasabi_zen_ai_tasks"); } catch {}
    try { localStorage.removeItem("wasabi_zen_ai_tasks_v2"); } catch {}
    try { localStorage.removeItem("wasabi_zen_ai_tasks_v3"); } catch {}
    try { localStorage.removeItem("wasabi_ai_tasks_v4"); } catch {}
    try { localStorage.removeItem("wasabi_ai_tasks_v7"); } catch {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("wasabi_ai_tasks_v8") || k.startsWith("wasabi_ai_tasks_v9"))) { localStorage.removeItem(k); i--; }
      }
    } catch {}

    // Load cached results with proper role filtering — skip if identity not yet loaded
    // Stale-while-revalidate: always show cached data immediately, even if stale.
    // Background rescan is triggered by the auto-scan effect if cache exceeds CACHE_TTL.
    if (!identity?.id) return;
    const cached = getStaleCache(CACHE_KEY);
    if (cached?.data) {
      let filtered = userTasksTableId
        ? cached.data.filter((t) => t.source !== `d1:${userTasksTableId}` && t.source !== "manual")
        : cached.data.filter((t) => t.source !== "manual");
      filtered = applyRoleFilter(filtered, identity);
      setAiTasks(filtered);
      setLastUpdated(new Date(cached.ts));
      setLoading(false);
    }
    const cachedInsight = getCached(INSIGHT_KEY, 7 * 24 * 60 * 60 * 1000);
    if (cachedInsight) setInsight(cachedInsight);
  }, [CACHE_KEY, identity?.id, identity?.role]);

  // Background scan and AI curation
  const scan = useCallback(async (force = false) => {
    if (!user?.workerUrl) {
      setLoading(false);
      return;
    }
    // Never scan without identity — role filter treats null identity as admin
    if (!identity?.id) return;
    if (scanningRef.current) return;

    // Force refresh: clear stale cache so results aren't served from old data
    if (force) {
      try { localStorage.removeItem(CACHE_KEY); } catch {}
    }

    scanningRef.current = true;
    // Use refreshing (not loading) when we already have results
    const isBackground = aiTasks.length > 0;
    if (isBackground) setRefreshing(true);

    try {
      setError(null);

      // Helper: retry a function once on failure (with 1s delay)
      async function withRetry(fn, label) {
        try {
          return await fn();
        } catch (err) {
          console.warn(`[AICurated] ${label} failed, retrying...`, err.message);
          await new Promise((r) => setTimeout(r, 1000));
          return await fn(); // throws on second failure
        }
      }

      // Step 1: Find task-like databases (parallel schema detection)
      const candidates = [];
      let schemaErrors = 0;

      for (const page of pages) {
        if (page._systemInternal) continue;
        const pt = page.page_type || page.pageType;

        // All data lives in D1 — linked_notion databases are synced to D1,
        // so we scan D1 directly (no Notion API dependency).
        if (pt === "linked_notion" && page.id) {
          candidates.push({ type: "d1", tableId: page.id, pageName: page.name });
        }
        if (pt === "database" && page.id) {
          // Skip the user tasks table — it's the user's manual task list, not a source DB
          // Check by ID, name pattern, and _systemInternal flag for robustness
          if (userTasksTableId && page.id === userTasksTableId) continue;
          if (page.name && (page.name.startsWith("User Tasks") || page.name.startsWith("Zen Tasks"))) continue;
          candidates.push({ type: "d1", tableId: page.id, pageName: page.name });
        }
      }

      // Detect schemas in parallel — all from D1
      const taskDbs = [];
      const schemaPromises = candidates.slice(0, MAX_DATABASES * 2).map(async (c) => {
        try {
          const schemaRes = await withRetry(
            () => getTableSchema(c.tableId),
            `D1 schema for "${c.pageName}"`
          );
          const columns = schemaRes.columns || [];
          if (isTaskLikeD1Table(columns, c.pageName)) {
            return { ...c, columns };
          }
        } catch (err) {
          console.warn(`[AICurated] Schema detection failed for "${c.pageName}":`, err.message);
          schemaErrors++;
        }
        return null;
      });

      const schemaResults = await Promise.allSettled(schemaPromises);
      for (const r of schemaResults) {
        if (r.status === "fulfilled" && r.value && taskDbs.length < MAX_DATABASES) {
          taskDbs.push(r.value);
        }
      }

      if (taskDbs.length === 0) {
        console.warn("[AICurated] No task-like databases found. Candidates checked:", candidates.length);
        // Only treat as a real "no tasks" if we didn't have errors
        if (schemaErrors > 0) {
          setError(`Failed to scan ${schemaErrors} database(s)`);
        }
        setLoading(false);
        scanningRef.current = false;
        return;
      }

      // Step 2: Fetch items from each database (all from D1)
      const allTasks = [];
      let fetchErrors = 0;

      const fetchPromises = taskDbs.map(async (db) => {
        try {
          const result = await withRetry(
            // topLevelOnly: sub-items handled separately elsewhere; they'd
            // consume slots against MAX_ITEMS_PER_DB and render as "Untitled"
            // noise because parent-table columns don't match sub-column cells.
            () => listRows(db.tableId, { limit: MAX_ITEMS_PER_DB, topLevelOnly: true }),
            `D1 rows for "${db.pageName}"`
          );
          const rows = result.rows || [];
          // Sort newest-activity first so when we hit MAX_ITEMS_PER_DB the cut
          // falls on stale rows, not fresh ones. Worker's SQL sort is
          // created_at ASC which would hide new assignments behind old imports.
          rows.sort((a, b) => {
            const ta = new Date(a.updated_at || a.created_at || 0).getTime();
            const tb = new Date(b.updated_at || b.created_at || 0).getTime();
            return tb - ta;
          });
          // parentCellMap still built for normalizeD1Task's inherited-field
          // lookup; topLevelOnly filter means it's now always empty, but the
          // param is kept for API compatibility.
          const parentCellMap = {};
          const tasks = [];
          for (const row of rows) {
            const task = normalizeD1Task(row, db.columns, parentCellMap);
            task.sourceName = db.pageName;
            task.source = `d1:${db.tableId}`;
            if (!task.done) tasks.push(task);
          }
          return { tasks, source: `d1:${db.tableId}` };
        } catch (err) {
          console.warn(`[AICurated] Failed to fetch from "${db.pageName}":`, err.message);
          fetchErrors++;
        }
        return { tasks: [], source: "" };
      });

      const fetchResults = await Promise.allSettled(fetchPromises);
      const tasksBySource = {};
      // Build set of sources to exclude (user tasks table)
      const excludedSources = new Set();
      if (userTasksTableId) excludedSources.add(`d1:${userTasksTableId}`);
      for (const r of fetchResults) {
        if (r.status === "fulfilled" && r.value) {
          // Safety: never include user/manual tasks in AI-curated list
          const safeTasks = r.value.tasks.filter((t) =>
            t.source !== "manual" && !excludedSources.has(t.source)
          );
          allTasks.push(...safeTasks);
          if (r.value.source && !excludedSources.has(r.value.source)) {
            tasksBySource[r.value.source] = safeTasks;
          }
        }
      }

      if (fetchErrors > 0) {
        setError(`Failed to fetch from ${fetchErrors} database(s)`);
      }

      if (allTasks.length === 0) {
        setAiTasks([]);
        setCache(CACHE_KEY, []);
        setLoading(false);
        scanningRef.current = false;
        return;
      }

      // Step 2.5: Fetch activity data and apply smart inclusion filter
      const activityMap = new Map(); // taskId → lastActivityAt
      const bootstrapQueue = [];

      // Fetch existing activity records per source (in parallel)
      const activityPromises = Object.keys(tasksBySource).map(async (source) => {
        try {
          const result = await listTaskActivity(source);
          for (const a of (result?.activities || [])) {
            activityMap.set(a.task_id, a.last_activity_at);
          }
        } catch (err) {
          console.warn(`[AICurated] Activity fetch failed for ${source}:`, err.message);
        }
      });
      await Promise.allSettled(activityPromises);

      // Bootstrap missing activity records from lastEditedTime
      for (const task of allTasks) {
        if (!activityMap.has(task.id) && task.lastEditedTime) {
          activityMap.set(task.id, task.lastEditedTime);
          bootstrapQueue.push({ taskId: task.id, source: task.source, time: task.lastEditedTime });
        }
      }
      // Bootstrap in background (don't block UI)
      if (bootstrapQueue.length > 0) {
        Promise.allSettled(
          bootstrapQueue.map((b) => upsertTaskActivity(b.taskId, b.source, b.time))
        ).catch(err => console.warn("[useAICuratedTasks] upsertTaskActivity:", err.message || err));
      }

      // Fetch all task interactions once — reused for staleness signals (below)
      // and interaction-history enrichment later. Replaces the previous double-fetch.
      const interactionTypeMap = new Map(); // taskId → lastInteractionType (string)
      const interactionMap = new Map(); // taskId → all interactions[] for enrichment
      if (identity?.id) {
        try {
          const intPromises = Object.keys(tasksBySource).map(async (source) => {
            try {
              const result = await listTaskInteractions(source, identity.id);
              return result?.interactions || [];
            } catch (err) {
              console.warn("[useAICuratedTasks] listTaskInteractions:", err.message || err);
              return [];
            }
          });
          const results = await Promise.allSettled(intPromises);
          for (const r of results) {
            if (r.status !== "fulfilled") continue;
            for (const i of r.value) {
              if (!interactionMap.has(i.task_id)) interactionMap.set(i.task_id, []);
              interactionMap.get(i.task_id).push(i);
              if (!interactionTypeMap.has(i.task_id)) {
                interactionTypeMap.set(i.task_id, i.interaction_type);
              }
            }
          }
        } catch (err) { console.warn("[useAICuratedTasks] interaction fetch:", err.message || err); }
      }

      // Annotate all tasks with staleness/overdue signals
      for (const task of allTasks) {
        const lastActivity = activityMap.get(task.id) || null;
        const nearest = task.nearestDate || task.due;
        const lastInteractionType = interactionTypeMap.get(task.id) || null;

        task._isOverdue = isSmartOverdue(nearest, lastActivity);
        task._isStale = shouldIncludeTask(nearest, lastActivity, lastInteractionType);
      }

      // Step 2.7a: Fetch user's @mention notifications once — replaces per-task
      // comment fan-out (N+1 → 1). Notifications are the authoritative source for
      // mentions; write path hardened in Stage 0.
      const mentionedRecordIds = new Set();
      const mentionMetaMap = new Map(); // record_id → most-recent mention created_at
      if (identity?.id) {
        try {
          const notifResult = await listNotifications({ limit: 500 });
          for (const n of (notifResult?.notifications || [])) {
            if (n.type === "mention" && n.record_id) {
              mentionedRecordIds.add(n.record_id);
              const prev = mentionMetaMap.get(n.record_id);
              if (!prev || new Date(n.created_at) > new Date(prev)) {
                mentionMetaMap.set(n.record_id, n.created_at);
              }
            }
          }
        } catch (err) {
          console.warn("[AICurated] Mention notifications fetch failed:", err.message);
        }
      }

      // Step 2.7b: Cheap per-user flags (ownership, assignment, mention).
      // These must be set BEFORE the role filter so it can decide what survives.
      if (identity?.id) {
        const userName = identity.display_name?.toLowerCase() || "";
        const userId = identity.id;
        for (const task of allTasks) {
          // Ownership: owner_user_id array includes current user
          if (task._ownerUserIds && Array.isArray(task._ownerUserIds)) {
            task._isOwned = task._ownerUserIds.includes(userId);
          }
          // Assignment: display-name substring match in assignee/owner text field
          const assignee = (task.assignee || task.owner || task.assigned || "").toLowerCase();
          if (assignee && assignee.includes(userName)) {
            task._isAssigned = true;
          }
          // Assignment via people-column user ID match (array of {name, id})
          if (!task._isAssigned && task._fieldMap) {
            const assigneeKey = task._fieldMap.assignee;
            const rawAssignee = assigneeKey && task._raw?.cells?.[assigneeKey];
            if (Array.isArray(rawAssignee) && rawAssignee.some(p => p.id === userId)) {
              task._isAssigned = true;
            }
          }
          // Mention: record_id appears in user's mention notifications
          if (mentionedRecordIds.has(task.id)) {
            task._isMentioned = true;
          }
        }
      }

      // Step 2.75: Role-based task filtering — runs BEFORE expensive enrichment
      // so non-admins don't waste cycles enriching tasks they can't see.
      // Non-admins: only owned/mentioned/unowned survive. Admins see everything.
      const isAdmin = identity?.role === "admin";
      let filteredTasks = applyRoleFilter(allTasks, identity);

      // Step 2.76: Snooze filtering — remove snoozed tasks from active list
      try {
        if (identity?.id) {
          const snoozeResult = await getActiveSnoozes(identity.id);
          const snoozes = snoozeResult?.snoozes || [];
          if (snoozes.length > 0) {
            const snoozeMap = new Map(snoozes.map(s => [s.task_id, s]));
            const snoozed = filteredTasks
              .filter(t => snoozeMap.has(t.id))
              .map(t => ({ ...t, _snoozeUntil: snoozeMap.get(t.id).snooze_until, _snoozeId: snoozeMap.get(t.id).id }));
            setSnoozedTasks(snoozed);
            filteredTasks = filteredTasks.filter(t => !snoozeMap.has(t.id));
          } else {
            setSnoozedTasks([]);
          }
        }
      } catch (err) {
        console.warn("[AICurated] Snooze fetch failed:", err.message);
      }

      // Expensive enrichment below feeds Claude's ranking prompt. Viewers can't
      // call /claude (editor+ only) so they fall through to date-sort — no need
      // to spend cycles enriching their list.
      const skipExpensiveEnrichment = identity?.role === "viewer";
      let neuronClusterSummary = ""; // populated in 2.9, consumed by Claude prompt

      // Step 2.7c: Record views + unread mention detection (post-filter, non-viewer)
      if (!skipExpensiveEnrichment && identity?.id) {
        try {
          const viewsResult = await getRecordViews().catch(() => ({ views: [] }));
          const viewMap = new Map();
          for (const v of (viewsResult.views || [])) {
            viewMap.set(v.record_id, v.last_viewed_at);
          }
          const now = Date.now();
          for (const task of filteredTasks) {
            const lastViewed = viewMap.get(task.id);
            if (lastViewed) {
              task._lastViewedDaysAgo = Math.floor((now - new Date(lastViewed).getTime()) / 86400000);
            }
            // Unread mention: user was @mentioned AND mention postdates last view
            if (task._isMentioned) {
              const mentionTime = mentionMetaMap.get(task.id);
              if (mentionTime && (!lastViewed || new Date(mentionTime) > new Date(lastViewed))) {
                task._hasUnreadComments = true;
              }
            }
          }
        } catch (err) {
          console.warn("[AICurated] Per-user signal enrichment failed:", err.message);
        }
      }

      // Step 2.9: Neuron sibling enrichment (zero API calls — uses cached graph)
      if (!skipExpensiveEnrichment) {
        try {
          const neuronGraph = loadCachedNeuronGraph();
          if (neuronGraph && neuronGraph.length > 0) {
            // Build nodeId → task lookup
            const taskById = new Map();
            for (const task of filteredTasks) {
              taskById.set(task.id, task);
            }

            // Build nodeId → neuron lookup and annotate tasks
            for (const neuron of neuronGraph) {
              const nodeIds = (neuron.nodes || []).map((nd) => nd.node_id);
              // Find which filtered tasks are in this neuron
              const tasksInNeuron = nodeIds
                .map((nid) => taskById.get(nid))
                .filter(Boolean);

              if (tasksInNeuron.length === 0) continue;

              // Check if any sibling in this neuron is urgent (overdue/high priority)
              const hasUrgentSibling = tasksInNeuron.some((t) =>
                t._isOverdue || t.priority === "High" || t.priority === "Urgent"
              );

              // Annotate each task with its neuron membership
              for (const task of tasksInNeuron) {
                if (!task._neuronNames) task._neuronNames = [];
                task._neuronNames.push(neuron.name || "(unnamed)");
                if (hasUrgentSibling) task._neuronSiblingUrgent = true;
              }
            }

            // Build cluster health summary for the insight prompt
            const clusterStats = [];
            for (const neuron of neuronGraph) {
              const nodeIds = (neuron.nodes || []).map((nd) => nd.node_id);
              const tasksInNeuron = nodeIds.map((nid) => taskById.get(nid)).filter(Boolean);
              if (tasksInNeuron.length === 0) continue;

              const overdueCount = tasksInNeuron.filter((t) => t._isOverdue).length;
              const staleCount = tasksInNeuron.filter((t) => t._isStale).length;
              const totalInCluster = (neuron.nodes || []).length;

              if (overdueCount > 0 || staleCount > 0) {
                clusterStats.push(
                  `- "${neuron.name || "(unnamed)"}" (${totalInCluster} items): ${overdueCount} overdue, ${staleCount} stale`
                );
              }
            }
            if (clusterStats.length > 0) {
              neuronClusterSummary = "\n\nNeuron cluster health:\n" + clusterStats.join("\n");
            }
          }
        } catch (err) {
          console.warn("[AICurated] Neuron enrichment failed:", err.message);
        }
      }

      // Step 2.95: Interaction history enrichment — reuses interactionMap from the
      // earlier combined fetch (no second API round-trip).
      if (!skipExpensiveEnrichment) {
        try {
          const userId = identity?.id;
          if (userId) {
            const now = Date.now();
            for (const task of filteredTasks) {
              const interactions = interactionMap.get(task.id);
              if (!interactions?.length) continue;
              // Find my most recent interaction
              const myInteractions = interactions.filter((i) => i.user_id === userId);
              const otherInteractions = interactions.filter((i) => i.user_id !== userId && i.user_id !== "default");
              if (myInteractions.length > 0) {
                const latest = myInteractions[0]; // already sorted DESC by created_at
                task._lastInteractionType = latest.interaction_type;
                const ago = now - new Date(latest.created_at).getTime();
                if (ago < 3600000) task._lastInteractionAgo = `${Math.round(ago / 60000)}m ago`;
                else if (ago < 86400000) task._lastInteractionAgo = `${Math.round(ago / 3600000)}h ago`;
                else task._lastInteractionAgo = `${Math.round(ago / 86400000)}d ago`;
                // Detect interaction gap: commented but didn't update status
                if (latest.interaction_type === "comment") {
                  const hasStatusChange = myInteractions.find((i) => i.interaction_type === "status_change" && i.created_at >= latest.created_at);
                  if (!hasStatusChange) {
                    task._interactionGap = "commented but status unchanged";
                  }
                }
              }
              // Other user signals (shared signals)
              if (otherInteractions.length > 0) {
                task._otherUserActions = otherInteractions.slice(0, 3).map((i) => ({
                  user: i.display_name || "A team member",
                  type: i.interaction_type,
                  detail: i.detail,
                }));
              }
            }
          }
        } catch (err) {
          console.warn("[AICurated] Interaction enrichment failed:", err.message);
        }
      }

      // Step 2.96: Enrich with interaction breakdown from localStorage ledger
      // This adds _interactionBreakdown (e.g., "3 views, 2 edits today") to each task
      // so compressTask() can include it and the formula suggestion in the Claude prompt.
      if (!skipExpensiveEnrichment) {
        try {
          const ledger = loadInteractionLedger(identity?.id);
          const now = Date.now();
          for (const task of filteredTasks) {
            const entry = ledger[task.id];
            if (!entry?.interactions?.length) continue;
            const todayInteractions = entry.interactions.filter(i => (now - i.ts) < 86400000);
            if (todayInteractions.length > 0) {
              const counts = {};
              for (const i of todayInteractions) counts[i.type] = (counts[i.type] || 0) + 1;
              task._interactionBreakdown = Object.entries(counts)
                .map(([type, count]) => `${count} ${type}${count > 1 ? "s" : ""}`)
                .join(", ") + " today";
            }
            // Carry over interaction adjustment data from mergeInteractionAdjustments
            // (which may not have run yet on filteredTasks — it runs on results after Claude)
            if (entry.totalAdjustment !== undefined) {
              task._interactionAdjustment = entry.totalAdjustment;
              task._interactionCount = entry.interactions.length;
            }
          }
        } catch (err) {
          console.warn("[AICurated] Interaction breakdown enrichment failed:", err.message);
        }
      }

      // Step 3: Call Haiku for prioritization (on filtered tasks)
      if (user.claudeKey && filteredTasks.length > 0) {
        try {
          const today = new Date().toISOString().split("T")[0];
          const dbSummaries = {};
          for (const task of filteredTasks) {
            const name = task.sourceName;
            if (!dbSummaries[name]) dbSummaries[name] = [];
            dbSummaries[name].push(compressTask(task));
          }

          const ownershipGuidance = isAdmin
            ? `\nIMPORTANT: This user is an admin and sees ALL tasks. Ownership is a MAJOR scoring factor:
- Tasks owned by this user: boost score by +2 (owned tasks should almost always appear near the top)
- Tasks NOT owned by this user: reduce base score by -1 (only surface unowned tasks if they are truly urgent — overdue, blocking, or high priority)
- The admin's owned tasks should dominate the list unless an unowned task is critically urgent\n`
            : "";

          const userContext = identity?.display_name
            ? `\nYou are prioritizing for user "${identity.display_name}" (role: ${identity.role}). Per-user signals are included when available:
- ownedByUser: this user owns the task
- assignedToUser: this user is assigned to the task
- hasUnreadComments: comments exist that this user hasn't seen
- mentionedUser: this user was @mentioned in comments
- lastViewedDaysAgo: days since this user last viewed the record
- blockingCount: number of other tasks this task blocks
- blockedByOthers: this task is blocked by other tasks
- neuronClusters: names of neuron clusters this task belongs to (campaigns, initiatives)
- neuronSiblingUrgent: another task in the same neuron cluster is overdue/high-priority
- lastInteraction: type of this user's most recent interaction (comment, status_change, field_edit, view)
- lastInteractionAgo: human-readable time since last interaction (e.g., "2h ago")
- interactionGap: describes incomplete workflows (e.g., "commented but status unchanged" — user acknowledged but didn't progress)
- otherUserActions: recent interactions by other team members (shared signals)
- interactionCount: total accumulated interactions by this user on this task
- interactionBreakdown: today's interaction summary (e.g., "3 views, 2 field_edits today")
- formulaSuggestion: formula-based recommendation (e.g., "deprioritize 60%") based on accumulated user interactions with time decay. FOLLOW this unless the task has NEW urgency since the interactions (new unread comments, deadline within 24h, blocking count increased)
${ownershipGuidance}`
            : "";

          const prompt = `You are a smart task prioritizer and workspace advisor. You are ranking ALL active (non-complete) tasks from the user's databases. Your job is to score and rank them so the most important surface first.

Each task includes:
- dates: all date fields on this task (e.g., [{field: "Design Timeline", date: "2026-03-15"}, {field: "Production Timeline", date: "2026-04-10 – 2026-05-01"}])
- nearestDate: the system's pick for the most relevant date (closest upcoming or most recently passed)
- nearestDateField: which field nearestDate came from
- isOverdue: true if this date passed and the task wasn't updated since
- isStale: true if the task hasn't been touched relative to how close its deadline is
${userContext}
Today is ${today}.

PIPELINE REASONING:
When a task has multiple date fields AND a status field, reason about pipeline position:
- Match date field names to status values (e.g., "Design Timeline" relates to "Design" status, "Production Timeline" relates to "In Production")
- If the task's current status is PAST a date field's stage but that date hasn't lapsed yet, the task is AHEAD of schedule → lower priority
- If a date field's deadline has passed but the task status hasn't advanced past that stage, the task is BEHIND schedule → higher priority
- Use ALL date fields to understand the full timeline, not just the nearest date

HOLD STATES:
These statuses indicate external dependencies requiring proactive check-ins — BOOST priority:
- "Waiting on Vendor" — outside partner dependency, forgetting causes deadline lapse
- "Waiting on Deposit" — financial dependency needing follow-up
- "Quality Check" — inspection hold, can happen at any pipeline stage
- "Awaiting PO" — purchase order dependency

These statuses indicate intentional pauses — LOWER priority:
- "Paused" — user chose to pause, don't nag

Do TWO things:

1. RANK these tasks from most to least urgent (priority_score 5 = most urgent, 1 = least).
Priority rules:
- Tasks owned by or assigned to this user with unread comments or @mentions — highest priority (score 5)
- Tasks blocking others (blockingCount > 0) — boost score by +1
- Tasks blocked by others — reduce score (not actionable)
- Overdue + stale items — highest priority (score 5)
- Due today or tomorrow (score 4-5)
- Stale items approaching deadlines (score 3-4)
- High priority or urgent status (score 3-4)
- In-progress items approaching dates (score 2-3)
- Tasks owned by or assigned to this user get a STRONG boost (+2) — ownership is a primary signal
- Tasks with neuronSiblingUrgent=true belong to a campaign where another task is already overdue — boost score by +1 (cascading urgency)
- interactionGap="commented but status unchanged" — this user acknowledged the task but didn't progress it. BOOST score +1 (needs follow-through)
- lastInteraction="comment" with no status_change — task is not resolved, should resurface
- lastInteraction="status_change" — user progressed this, lower priority
- otherUserActions present — mention team activity in the reason (e.g., "Graham commented 2h ago")
- When writing reasons, mention the neuron cluster name if present (e.g., "Part of the Q3 Launch campaign, which has 2 overdue items")
- formulaSuggestion present with "deprioritize" — user has heavily interacted with this task. Follow the suggestion unless there's new external urgency (new unread comments from others, deadline within 24h, blocking count increased). The user has seen and worked on this; fresher tasks should surface.
- formulaSuggestion present with "boost" — user has been commenting/discussing. This needs follow-through, keep it visible.
Exclude any items that are NOT actionable tasks (contacts, records, inventory, labels).

For each task, write a "reason" — a concise 1-2 sentence attention summary written for the user. It should feel like a helpful assistant briefing them. Be specific: reference actual dates, how many days overdue, the database name, blocking relationships, and why it matters NOW. Don't list tags — write natural language.
Good examples:
- "Due 3 days ago and you haven't viewed it since last week. It's blocking 2 other tasks in Projects."
- "You were @mentioned in a comment and this is due tomorrow. Likely needs your input before the deadline."
- "Marked high priority but hasn't been updated in 8 days. The design deadline is in 3 days."
Bad examples (too generic, don't do this):
- "This task is overdue and stale."
- "High priority task that needs attention."

2. Generate ONE short workspace insight (max 120 chars) personalized for this user. This appears in the navigation sidebar. It should feel illuminating — not a status report. Observe patterns, convergences, risks, or perspective. Be specific to the actual data. If neuron clusters have overdue items, prioritize mentioning the campaign health.${neuronClusterSummary}

Return valid JSON only, no markdown: { "tasks": [{ "title": "exact title", "priority_score": 1-5, "reason": "tagged reason" }], "insight": "your insight here" }

Items by database:
${JSON.stringify(dbSummaries, null, 0)}`;

          const aiResult = await claudeProxy({
            messages: [{ role: "user", content: prompt }],
            model: "claude-haiku-4-5-20251001",
            max_tokens: 4096,
          }, user.claudeKey);

          if (aiResult.stop_reason === "max_tokens") {
            console.warn("[AICurated] Response truncated: stop_reason is max_tokens");
          }

          const rawText = aiResult.content?.[0]?.text || aiResult.text || "";
          // Extract JSON object by finding outermost braces — handles code fences, leading text, or clean JSON
          const firstBrace = rawText.indexOf("{");
          const lastBrace = rawText.lastIndexOf("}");
          const responseText = firstBrace !== -1 && lastBrace > firstBrace
            ? rawText.slice(firstBrace, lastBrace + 1)
            : rawText.trim();

          let prioritized = [];
          let aiInsight = null;
          let parsed = null;
          try {
            parsed = JSON.parse(responseText);
          } catch (err) {
            console.warn(
              "[AICurated] Failed to parse AI response:", err.message,
              `(len=${rawText.length}, stop=${aiResult.stop_reason})`,
              "start:", responseText.slice(0, 200),
              "end:", responseText.slice(-200)
            );
          }

          if (parsed) {
            if (Array.isArray(parsed.tasks)) prioritized = parsed.tasks;
            if (parsed.insight) aiInsight = parsed.insight;
          }

          // Store insight
          if (aiInsight) {
            setInsight(aiInsight);
            setCache(INSIGHT_KEY, aiInsight);
          }

          // Map AI prioritized titles back to full task objects
          if (prioritized.length > 0) {
            const result = [];
            for (const item of prioritized) {
              const match = filteredTasks.find((t) =>
                t.title.toLowerCase() === item.title?.toLowerCase()
              );
              if (match) {
                result.push({
                  ...match,
                  _aiScore: item.priority_score,
                  _aiReason: item.reason,
                });
              }
            }
            // Merge persisted interaction adjustments so user interactions survive rescans
            const merged = mergeInteractionAdjustments(result, identity?.id);
            // Sort by AI priority score (highest first)
            merged.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));
            // Dynamic fill: show more tasks as user completes/dismisses items
            const targetCount = Math.min(TARGET_MAX, BASE_TARGET + completedCountRef.current);
            // Filter out dismissed tasks, then slice to target
            const visible = merged.filter((t) => !dismissedIdsRef.current.has(t.id));
            setAiTasks(visible.slice(0, targetCount));
            setCache(CACHE_KEY, merged); // cache includes interaction adjustments
          } else {
            // Fallback: show filtered tasks sorted by nearest date
            const merged = mergeInteractionAdjustments(filteredTasks, identity?.id);
            merged.sort((a, b) => {
              // Primary: interaction-adjusted score (if any), secondary: date
              const scoreDiff = (b._aiScore || 0) - (a._aiScore || 0);
              if (Math.abs(scoreDiff) > 1) return scoreDiff;
              const aDate = a.nearestDate || a.due;
              const bDate = b.nearestDate || b.due;
              if (aDate && !bDate) return -1;
              if (!aDate && bDate) return 1;
              if (aDate && bDate) return parseDate(aDate) - parseDate(bDate);
              return 0;
            });
            const targetCount = Math.min(TARGET_MAX, BASE_TARGET + completedCountRef.current);
            const visible = merged.filter((t) => !dismissedIdsRef.current.has(t.id));
            setAiTasks(visible.slice(0, targetCount));
            setCache(CACHE_KEY, merged); // cache includes interaction adjustments
          }
        } catch (err) {
          console.warn("[AICurated] AI call failed, using fallback:", err.message);
          const merged = mergeInteractionAdjustments(filteredTasks, identity?.id);
          merged.sort((a, b) => {
            const scoreDiff = (b._aiScore || 0) - (a._aiScore || 0);
            if (Math.abs(scoreDiff) > 1) return scoreDiff;
            const aDate = a.nearestDate || a.due;
            const bDate = b.nearestDate || b.due;
            if (aDate && !bDate) return -1;
            if (!aDate && bDate) return 1;
            if (aDate && bDate) return parseDate(aDate) - parseDate(bDate);
            return 0;
          });
          const targetCount = Math.min(TARGET_MAX, BASE_TARGET + completedCountRef.current);
          const visible = merged.filter((t) => !dismissedIdsRef.current.has(t.id));
          setAiTasks(visible.slice(0, targetCount));
          setCache(CACHE_KEY, merged); // cache includes interaction adjustments
        }
      } else {
        // No Claude key or no filtered tasks — sort by nearest date
        const merged = mergeInteractionAdjustments(filteredTasks, identity?.id);
        merged.sort((a, b) => {
          const scoreDiff = (b._aiScore || 0) - (a._aiScore || 0);
          if (Math.abs(scoreDiff) > 1) return scoreDiff;
          const aDate = a.nearestDate || a.due;
          const bDate = b.nearestDate || b.due;
          if (aDate && !bDate) return -1;
          if (!aDate && bDate) return 1;
          if (aDate && bDate) return parseDate(aDate) - parseDate(bDate);
          return 0;
        });
        const targetCount = Math.min(TARGET_MAX, BASE_TARGET + completedCountRef.current);
        const visible = merged.filter((t) => !dismissedIdsRef.current.has(t.id));
        setAiTasks(visible.slice(0, targetCount));
        setCache(CACHE_KEY, merged); // cache includes interaction adjustments
      }

      setLastUpdated(new Date());
    } catch (err) {
      console.error("[AICurated] Scan failed:", err);
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
      scanningRef.current = false;
    }
  }, [user, pages, identity]);

  // Auto-scan on mount or when cache is dirty (event-driven invalidation).
  // Stale cache data is already showing from the mount effect (stale-while-revalidate),
  // so this scan runs in background mode (refreshing indicator, not loading spinner).
  useEffect(() => {
    if (!identity?.id) return; // Don't scan until we know who the user is
    const cached = getCached(CACHE_KEY, CACHE_TTL);
    const hasInsight = getCached(INSIGHT_KEY, 7 * 24 * 60 * 60 * 1000);
    if (cached && cached.length > 0 && !cacheDirty && (hasInsight || !user?.claudeKey)) {
      // Cache is fresh and not invalidated. Skip rescan unless insight is missing
      // and claudeKey is now available (race: first scan ran before key loaded).
      return;
    }
    // Delay scan slightly so cached local tasks render first
    // Use longer delay if pages haven't loaded yet to avoid scanning empty page list
    const delay = pages.length === 0 ? 1500 : 500;
    const timer = setTimeout(() => {
      scan();
      setCacheDirty(false);
    }, delay);
    return () => clearTimeout(timer);
  }, [scan, pages.length, identity?.id, cacheDirty]);

  // Force refresh clears cache and rescans
  const forceRefresh = useCallback(() => scan(true), [scan]);

  // Debounced refresh: collapses rapid completion events into one scan (2.5s trailing edge)
  const debouncedRefresh = useCallback(() => {
    clearTimeout(debounceTimerRef.current);
    // Invalidate cache immediately so stale data isn't served
    try { localStorage.removeItem(CACHE_KEY); } catch {}
    debounceTimerRef.current = setTimeout(() => scan(true), 2500);
  }, [scan]);

  // Mark cache dirty — triggers background rescan via auto-scan effect.
  // Lighter than debouncedRefresh: doesn't clear cache, just sets the dirty flag.
  const markDirty = useCallback(() => {
    setCacheDirty(true);
  }, []);

  // Cleanup debounce timer on unmount
  useEffect(() => () => clearTimeout(debounceTimerRef.current), []);

  // Cross-user cache invalidation via UserSocket (enriched events)
  useEffect(() => {
    if (!userSync?.onTaskCacheInvalidate) return;
    return userSync.onTaskCacheInvalidate((event) => {
      // Enriched event: apply local heuristic adjustments instantly
      if (event?.type === "task_record_changed" && event.changes) {
        setAiTasks((prev) => {
          const updated = applyLocalAdjustment(prev, event, identityRef.current);
          // Update localStorage cache with adjusted scores
          try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed.data)) {
                localStorage.setItem(CACHE_KEY, JSON.stringify({ data: updated, ts: parsed.ts }));
              }
            }
          } catch {}
          return updated;
        });
      }
      // Always mark dirty so background AI rescan picks up the full context
      markDirty();
    });
  }, [userSync, markDirty, CACHE_KEY]);

  // Visibility-aware lazy polling: every 10 min, scan if visible + cache expired
  useEffect(() => {
    const POLL_INTERVAL = 10 * 60 * 1000; // 10 minutes
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const cached = getCached(CACHE_KEY, CACHE_TTL);
      if (!cached && !scanningRef.current) {
        scan(); // background re-scan
      }
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [scan]);

  // ── Snooze callbacks ──
  const snooze = useCallback(async (taskId, until, reason) => {
    const task = aiTasksRef.current?.find(t => t.id === taskId);
    if (!task?.source || !identityRef.current?.id) return;
    await snoozeTaskApi(taskId, task.source, identityRef.current.id, until, reason);
    // Move from active to snoozed locally (instant UI update)
    setAiTasks(prev => prev.filter(t => t.id !== taskId));
    setSnoozedTasks(prev => [...prev, { ...task, _snoozeUntil: until, _snoozeId: `${taskId}:${identityRef.current.id}` }]);
  }, []);

  const unsnooze = useCallback(async (snoozeId, taskId) => {
    await unsnoozeTaskApi(snoozeId);
    setSnoozedTasks(prev => prev.filter(t => t._snoozeId !== snoozeId));
    markDirty(); // trigger rescan to re-rank the un-snoozed task
  }, [markDirty]);

  // ── Interaction-based deprioritization (instant + persisted) ──
  // Interactions are accumulated in a localStorage ledger with time decay.
  // Score adjustments persist across remounts and survive rescans via mergeInteractionAdjustments.
  const TERMINAL_STATUSES = new Set(["done", "complete", "completed", "cancelled", "canceled", "archived", "delivered", "closed"]);

  const recordInteraction = useCallback((taskId, type, detail) => {
    // 1. Persist to localStorage interaction ledger (accumulates with time decay)
    const entry = persistInteraction(taskId, type, detail, identity?.id);

    // 2. Fire-and-forget: persist to D1 so Claude sees interaction history on next scan
    const id = identityRef.current;
    const task = aiTasksRef.current?.find(t => t.id === taskId);
    if (id?.id && task?.source) {
      logTaskInteraction(taskId, task.source, id.id, type, detail).catch(() => {});
    }

    // 3. Update React state with ledger's calculated adjustment
    setAiTasks((prev) => {
      let tasks = prev.map((t) => {
        if (t.id !== taskId) return t;
        const baseScore = t._aiBaseScore ?? t._aiScore ?? 3;
        const adjustment = entry?.totalAdjustment ?? 0;
        // Terminal status → remove from list
        if (type === "status_change") {
          const newStatus = (detail || "").split("→").pop()?.trim().toLowerCase() || "";
          if (TERMINAL_STATUSES.has(newStatus) || detail === "completed") {
            return { ...t, _aiScore: -99 };
          }
        }
        return { ...t, _aiBaseScore: baseScore, _aiScore: baseScore + adjustment };
      });
      // Filter out tasks with very low scores (terminal status changes)
      tasks = tasks.filter((t) => (t._aiScore || 0) > -5);
      // Re-sort by score
      tasks.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));
      return tasks;
    });

    // 4. Update localStorage task cache so reloads see adjustments
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.data)) {
          const updated = mergeInteractionAdjustments(parsed.data, identity?.id);
          localStorage.setItem(CACHE_KEY, JSON.stringify({ data: updated, ts: parsed.ts }));
        }
      }
    } catch {}
  }, [CACHE_KEY]);

  return {
    aiTasks,
    loading,
    refreshing,
    lastUpdated,
    refresh: forceRefresh,
    debouncedRefresh,
    markDirty,
    error,
    insight,
    recordInteraction,
    snoozedTasks,
    snooze,
    unsnooze,
  };
}
