// ─── useAICuratedTasks Hook ───
// Scans connected databases for task-like items, uses Haiku to prioritize.
// Caches results for 15 minutes to minimize token costs.

import { useState, useEffect, useCallback, useRef } from "react";
import { usePlatform } from "../context/PlatformContext.jsx";
import { detectSchema } from "../notion/schema.js";
import { queryLimited } from "../notion/pagination.js";
import {
  listRows, claudeProxy, getTableSchema, listTaskActivity, upsertTaskActivity,
  getRecordViews, listRecordComments, listTaskInteractions,
} from "../lib/api.js";
import { loadCachedNeuronGraph } from "../neurons/neuronStorage.js";
import {
  normalizeNotionTask, normalizeD1Task, getCached, setCache, parseDate,
  scoreTerminalStatuses, shouldIncludeTask, isSmartOverdue,
} from "./taskHelpers.js";

const CACHE_KEY_PREFIX = "wasabi_ai_tasks_v9"; // v9: fix ownership extraction + cache timing
const INSIGHT_CACHE_KEY = "wasabi_insight";
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const MAX_DATABASES = 5;
const MAX_ITEMS_PER_DB = 30;

// Per-user cache key — prevents cross-user cache contamination
function cacheKeyForUser(userId) {
  return userId ? `${CACHE_KEY_PREFIX}_${userId}` : CACHE_KEY_PREFIX;
}

// Role-based task filter — non-admins only see owned/mentioned/assigned tasks
function applyRoleFilter(tasks, identity) {
  if (!identity || identity.role === "admin") return tasks;
  return tasks.filter((t) => t._isOwned || t._isMentioned || t._isAssigned);
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

  console.log(`[AICurated] Schema score for "${schema.databaseTitle}": ${score} (${reasons.join("; ")})`);
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

  console.log(`[AICurated] D1 score for "${pageName}": ${score} (${reasons.join("; ")})`);
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
  // Interaction history signals
  if (task._lastInteractionType) obj.lastInteraction = task._lastInteractionType;
  if (task._lastInteractionAgo) obj.lastInteractionAgo = task._lastInteractionAgo;
  if (task._interactionGap) obj.interactionGap = task._interactionGap;
  if (task._otherUserActions?.length) obj.otherUserActions = task._otherUserActions;
  return obj;
}

const BASE_TARGET = 15;
const TARGET_MAX = 25;

export default function useAICuratedTasks({ dismissedIds, completedCount, zenTableId } = {}) {
  const { user, pages, identity } = usePlatform();
  const CACHE_KEY = cacheKeyForUser(identity?.id);
  const [aiTasks, setAiTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false); // background re-scan indicator
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const [insight, setInsight] = useState(null);
  const scanningRef = useRef(false);
  const debounceTimerRef = useRef(null);
  const dismissedIdsRef = useRef(dismissedIds || new Set());
  const completedCountRef = useRef(completedCount || 0);

  // Keep refs in sync with latest values
  dismissedIdsRef.current = dismissedIds || new Set();
  completedCountRef.current = completedCount || 0;

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
        if (k && k.startsWith("wasabi_ai_tasks_v8")) { localStorage.removeItem(k); i--; }
      }
    } catch {}

    // Load cached results with proper role filtering
    const cached = getCached(CACHE_KEY, CACHE_TTL);
    if (cached) {
      let filtered = zenTableId
        ? cached.filter((t) => t.source !== `d1:${zenTableId}` && t.source !== "manual")
        : cached.filter((t) => t.source !== "manual");
      filtered = applyRoleFilter(filtered, identity);
      setAiTasks(filtered);
      setLastUpdated(new Date(JSON.parse(localStorage.getItem(CACHE_KEY))?.ts));
      setLoading(false);
    }
    const cachedInsight = getCached(INSIGHT_CACHE_KEY, CACHE_TTL);
    if (cachedInsight) setInsight(cachedInsight);
  }, [CACHE_KEY, identity?.id, identity?.role]);

  // Background scan and AI curation
  const scan = useCallback(async (force = false) => {
    if (!user?.workerUrl) {
      setLoading(false);
      return;
    }
    const hasNotion = !!user?.notionKey;
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

        if (hasNotion && pt === "linked_notion" && page.databaseIds?.length > 0) {
          for (const dbId of page.databaseIds) {
            candidates.push({ type: "notion", dbId, pageName: page.name });
          }
        }
        if (pt === "database" && page.id) {
          // Skip the zen tasks table — it's the user's manual task list, not a source DB
          // Check by ID, name pattern, and _systemInternal flag for robustness
          if (zenTableId && page.id === zenTableId) continue;
          if (page.name && page.name.startsWith("Zen Tasks")) continue;
          candidates.push({ type: "d1", tableId: page.id, pageName: page.name });
        }
      }

      // Detect schemas in parallel (batched to respect rate limits)
      const taskDbs = [];
      const schemaPromises = candidates.slice(0, MAX_DATABASES * 2).map(async (c) => {
        try {
          if (c.type === "notion") {
            const schema = await withRetry(
              () => detectSchema(user.workerUrl, user.notionKey, c.dbId),
              `Schema detection for "${c.pageName}"`
            );
            if (isTaskLikeSchema(schema)) {
              return { ...c, schema };
            }
          } else if (c.type === "d1") {
            const schemaRes = await withRetry(
              () => getTableSchema(c.tableId),
              `D1 schema for "${c.pageName}"`
            );
            const columns = schemaRes.columns || [];
            if (isTaskLikeD1Table(columns, c.pageName)) {
              return { ...c, columns };
            }
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

      console.log(`[AICurated] Task-like databases found: ${taskDbs.length}`, taskDbs.map((d) => d.pageName));

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

      // Step 2: Fetch items from each database (parallel with retry)
      // Also compute terminal statuses per database for smart done detection
      const allTasks = [];
      let fetchErrors = 0;

      const fetchPromises = taskDbs.map(async (db) => {
        try {
          if (db.type === "notion") {
            // Compute terminal statuses for this database
            const allOptions = [
              ...(db.schema?.statuses || []).flatMap((f) => f.options || []),
              ...(db.schema?.selects || []).flatMap((f) => f.options || []),
            ];
            const terminalStatuses = scoreTerminalStatuses(allOptions);

            const results = await withRetry(
              () => queryLimited(
                user.workerUrl, user.notionKey, db.dbId,
                null,
                [{ timestamp: "last_edited_time", direction: "descending" }],
                MAX_ITEMS_PER_DB
              ),
              `Query "${db.pageName}"`
            );
            const tasks = [];
            for (const page of (results || [])) {
              const task = normalizeNotionTask(page, db.schema, db.pageName, terminalStatuses, db.dbId);
              if (!task.done) tasks.push(task);
            }
            return { tasks, source: `notion:${db.dbId}` };
          } else if (db.type === "d1") {
            const result = await withRetry(
              () => listRows(db.tableId, { limit: MAX_ITEMS_PER_DB }),
              `D1 rows for "${db.pageName}"`
            );
            const tasks = [];
            for (const row of (result.rows || [])) {
              const task = normalizeD1Task(row, db.columns);
              task.sourceName = db.pageName;
              task.source = `d1:${db.tableId}`;
              if (!task.done) tasks.push(task);
            }
            return { tasks, source: `d1:${db.tableId}` };
          }
        } catch (err) {
          console.warn(`[AICurated] Failed to fetch from "${db.pageName}":`, err.message);
          fetchErrors++;
        }
        return { tasks: [], source: "" };
      });

      const fetchResults = await Promise.allSettled(fetchPromises);
      const tasksBySource = {};
      // Build set of sources to exclude (zen tasks table)
      const excludedSources = new Set();
      if (zenTableId) excludedSources.add(`d1:${zenTableId}`);
      for (const r of fetchResults) {
        if (r.status === "fulfilled" && r.value) {
          // Safety: never include zen/manual tasks in AI-curated list
          const safeTasks = r.value.tasks.filter((t) =>
            t.source !== "manual" && !excludedSources.has(t.source)
          );
          allTasks.push(...safeTasks);
          if (r.value.source && !excludedSources.has(r.value.source)) {
            tasksBySource[r.value.source] = safeTasks;
          }
        }
      }

      console.log(`[AICurated] allTasks count: ${allTasks.length}`, allTasks.map((t) => ({ title: t.title, done: t.done, nearestDate: t.nearestDate, status: t.status })));

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
        ).catch(() => {});
      }

      // Build interaction type map from new task_interactions table (if available)
      const interactionTypeMap = new Map(); // taskId → lastInteractionType
      if (identity?.id) {
        try {
          const intPromises = Object.keys(tasksBySource).map(async (source) => {
            try {
              const result = await listTaskInteractions(source, identity.id);
              for (const i of (result?.interactions || [])) {
                // Only store the first (most recent) per task
                if (!interactionTypeMap.has(i.task_id)) {
                  interactionTypeMap.set(i.task_id, i.interaction_type);
                }
              }
            } catch {}
          });
          await Promise.allSettled(intPromises);
        } catch {}
      }

      // Annotate all tasks with staleness/overdue signals
      for (const task of allTasks) {
        const lastActivity = activityMap.get(task.id) || null;
        const nearest = task.nearestDate || task.due;
        const lastInteractionType = interactionTypeMap.get(task.id) || null;

        task._isOverdue = isSmartOverdue(nearest, lastActivity);
        task._isStale = shouldIncludeTask(nearest, lastActivity, lastInteractionType);
      }

      // Step 2.7: Enrich tasks with per-user signals + comment fetching
      if (identity?.id) {
        try {
          // Fetch record views for "last viewed" / "unread" detection
          const viewsResult = await getRecordViews().catch(() => ({ views: [] }));
          const viewMap = new Map();
          for (const v of (viewsResult.views || [])) {
            viewMap.set(v.record_id, v.last_viewed_at);
          }

          // Fetch comments for all D1 tasks (batched by source table)
          // This populates task._comments so @mention detection works
          try {
            const commentPromises = [];
            for (const task of allTasks) {
              if (!task.source) continue;
              const [sourceType, sourceId] = task.source.split(":");
              if (sourceType === "d1" && sourceId) {
                commentPromises.push(
                  listRecordComments(task.id, sourceId)
                    .then((res) => ({ taskId: task.id, comments: res.comments || [] }))
                    .catch(() => ({ taskId: task.id, comments: [] }))
                );
              }
            }
            if (commentPromises.length > 0) {
              const commentResults = await Promise.allSettled(commentPromises);
              for (const r of commentResults) {
                if (r.status !== "fulfilled" || !r.value.comments.length) continue;
                const task = allTasks.find((t) => t.id === r.value.taskId);
                if (task) task._comments = r.value.comments;
              }
            }
          } catch (err) {
            console.warn("[AICurated] Comment fetching failed:", err.message);
          }

          const userName = identity.display_name?.toLowerCase() || "";
          const userId = identity.id;
          const now = Date.now();

          for (const task of allTasks) {
            // Ownership: owner_user_id includes current user
            if (task._ownerUserIds && Array.isArray(task._ownerUserIds)) {
              task._isOwned = task._ownerUserIds.includes(userId);
            }

            // Assignment: task assignee field matches user display name
            const assignee = (task.assignee || task.owner || task.assigned || "").toLowerCase();
            if (assignee && assignee.includes(userName)) {
              task._isAssigned = true;
            }

            // Last viewed: days since user viewed this record
            const lastViewed = viewMap.get(task.id);
            if (lastViewed) {
              task._lastViewedDaysAgo = Math.floor((now - new Date(lastViewed).getTime()) / 86400000);
            }

            // @mention detection: check if user was mentioned in task comments
            if (task._comments) {
              for (const c of task._comments) {
                const body = (c.content || c.body || "").toLowerCase();
                if (body.includes(`@${userName}`)) {
                  task._isMentioned = true;
                  // Unread if mentioned after last view
                  if (!lastViewed || new Date(c.created_at) > new Date(lastViewed)) {
                    task._hasUnreadComments = true;
                  }
                  break;
                }
              }
            }
          }
        } catch (err) {
          console.warn("[AICurated] Per-user signal enrichment failed:", err.message);
        }
      }

      // Step 2.75: Role-based task filtering
      // Non-admins: ONLY see tasks they own or are mentioned in
      // Admins: see all tasks (ownership influences AI scoring weight)
      const isAdmin = !identity || identity.role === "admin";
      const filteredTasks = applyRoleFilter(allTasks, identity);
      console.log(`[AICurated] ${isAdmin ? "Admin/single-user" : "Non-admin"}: ${filteredTasks.length}/${allTasks.length} tasks after role filter`);

      // Step 2.8: Dependency awareness (Phase 1 — implicit keyword scanning)
      try {
        const DEP_KEYWORDS = [
          "blocked", "blocking", "waiting on", "depends on", "prerequisite",
          "before we can", "blocked by", "waiting for", "can't start until",
        ];
        const titleIndex = new Map(); // lowercase title → task
        for (const task of filteredTasks) {
          titleIndex.set(task.title.toLowerCase(), task);
        }

        // Build dependency map by scanning task text content for keywords + title references
        const blockingMap = new Map(); // taskId → Set of taskIds it blocks
        const blockedByMap = new Map(); // taskId → Set of taskIds blocking it

        for (const task of filteredTasks) {
          // Combine all text content for scanning
          const textContent = [
            task.notes || "",
            task.description || "",
            ...(task._comments || []).map((c) => c.content || ""),
          ].join(" ").toLowerCase();

          if (!textContent) continue;

          // Check for dependency keywords
          const hasDep = DEP_KEYWORDS.some((kw) => textContent.includes(kw));
          if (!hasDep) continue;

          // Look for references to other task titles in the text
          for (const [otherTitle, otherTask] of titleIndex) {
            if (otherTask.id === task.id) continue;
            if (otherTitle.length < 4) continue; // Skip very short titles to avoid false matches
            if (textContent.includes(otherTitle)) {
              // This task references another task in a dependency context
              // "blocked by X" → this task is blocked, X is blocking
              const isBlockedPattern = /block(ed|ing)\s*(by|on)|waiting\s*(on|for)|depends\s*on|can't start until/i;
              if (isBlockedPattern.test(textContent)) {
                // This task is blocked BY the other
                if (!blockedByMap.has(task.id)) blockedByMap.set(task.id, new Set());
                blockedByMap.get(task.id).add(otherTask.id);
                if (!blockingMap.has(otherTask.id)) blockingMap.set(otherTask.id, new Set());
                blockingMap.get(otherTask.id).add(task.id);
              }
            }
          }
        }

        // Annotate tasks with blocking/blocked signals
        for (const task of filteredTasks) {
          const blocking = blockingMap.get(task.id);
          if (blocking && blocking.size > 0) {
            task._blockingCount = blocking.size;
          }
          const blockedBy = blockedByMap.get(task.id);
          if (blockedBy && blockedBy.size > 0) {
            task._blockedByOthers = true;
          }
        }
      } catch (err) {
        console.warn("[AICurated] Dependency scan failed:", err.message);
      }

      // Step 2.9: Neuron sibling enrichment (zero API calls — uses cached graph)
      let neuronClusterSummary = "";
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

      // Step 2.95: Interaction history enrichment (per-user, typed)
      try {
        const userId = identity?.id;
        if (userId) {
          const interactionPromises = Object.keys(tasksBySource).map(async (source) => {
            try {
              const result = await listTaskInteractions(source, userId);
              return result?.interactions || [];
            } catch { return []; }
          });
          const interactionResults = await Promise.allSettled(interactionPromises);
          // Build per-task interaction map: taskId → { myLast, otherActions }
          const interactionMap = new Map(); // taskId → interactions[]
          for (const r of interactionResults) {
            if (r.status !== "fulfilled") continue;
            for (const interaction of r.value) {
              if (!interactionMap.has(interaction.task_id)) interactionMap.set(interaction.task_id, []);
              interactionMap.get(interaction.task_id).push(interaction);
            }
          }
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
                user: i.user_id,
                type: i.interaction_type,
                detail: i.detail,
              }));
            }
          }
        }
      } catch (err) {
        console.warn("[AICurated] Interaction enrichment failed:", err.message);
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
${ownershipGuidance}`
            : "";

          const prompt = `You are a smart task prioritizer and workspace advisor. You are ranking ALL active (non-complete) tasks from the user's databases. Your job is to score and rank them so the most important surface first.

Each task includes:
- nearestDate: the closest date across ALL date fields (timeline ends, deadlines, etc.)
- nearestDateField: which field it came from (e.g., "Design Deadline", "Timeline")
- isOverdue: true if this date passed and the task wasn't updated since
- isStale: true if the task hasn't been touched relative to how close its deadline is
${userContext}
Today is ${today}.

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
Exclude any items that are NOT actionable tasks (contacts, records, inventory, labels).

For each task, write a "reason" — a concise 1-2 sentence attention summary written for the user. It should feel like a helpful assistant briefing them. Be specific: reference actual dates, how many days overdue, the database name, blocking relationships, and why it matters NOW. Don't list tags — write natural language.
Good examples:
- "Due 3 days ago and you haven't viewed it since last week. It's blocking 2 other tasks in Projects."
- "You were @mentioned in a comment and this is due tomorrow. Likely needs your input before the deadline."
- "Marked high priority but hasn't been updated in 8 days. The design deadline is in 3 days."
Bad examples (too generic, don't do this):
- "This task is overdue and stale."
- "High priority task that needs attention."

2. Generate ONE short workspace insight (max 120 chars) personalized for this user. This appears in a zen/mindfulness sidebar. It should feel illuminating — not a status report. Observe patterns, convergences, risks, or perspective. Be specific to the actual data. If neuron clusters have overdue items, prioritize mentioning the campaign health.${neuronClusterSummary}

Return valid JSON only, no markdown: { "tasks": [{ "title": "exact title", "priority_score": 1-5, "reason": "tagged reason" }], "insight": "your insight here" }

Items by database:
${JSON.stringify(dbSummaries, null, 0)}`;

          const aiResult = await claudeProxy({
            messages: [{ role: "user", content: prompt }],
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1024,
          }, user.claudeKey);

          const responseText = aiResult.content?.[0]?.text || aiResult.text || "";

          // Parse AI response (new format: { tasks: [...], insight: "..." })
          let prioritized = [];
          let aiInsight = null;
          try {
            // Try object format first: { tasks: [...], insight: "..." }
            const objMatch = responseText.match(/\{[\s\S]*\}/);
            if (objMatch) {
              const parsed = JSON.parse(objMatch[0]);
              if (Array.isArray(parsed.tasks)) {
                prioritized = parsed.tasks;
                aiInsight = parsed.insight || null;
              } else if (Array.isArray(parsed)) {
                prioritized = parsed;
              }
            }
            // Fallback: bare array format
            if (prioritized.length === 0) {
              const arrMatch = responseText.match(/\[[\s\S]*\]/);
              if (arrMatch) prioritized = JSON.parse(arrMatch[0]);
            }
          } catch {
            console.warn("[AICurated] Failed to parse AI response");
          }

          // Store insight
          if (aiInsight) {
            setInsight(aiInsight);
            setCache(INSIGHT_CACHE_KEY, aiInsight);
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
            // Sort by AI priority score (highest first)
            result.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));
            // Dynamic fill: show more tasks as user completes/dismisses items
            const targetCount = Math.min(TARGET_MAX, BASE_TARGET + completedCountRef.current);
            // Filter out dismissed tasks, then slice to target
            const visible = result.filter((t) => !dismissedIdsRef.current.has(t.id));
            console.log(`[AICurated] AI scored ${result.length} tasks, showing ${Math.min(visible.length, targetCount)} (target: ${targetCount}, dismissed: ${dismissedIdsRef.current.size})`);
            setAiTasks(visible.slice(0, targetCount));
            setCache(CACHE_KEY, result); // cache full ranked list (unfiltered)
          } else {
            // Fallback: show filtered tasks sorted by nearest date
            filteredTasks.sort((a, b) => {
              const aDate = a.nearestDate || a.due;
              const bDate = b.nearestDate || b.due;
              if (aDate && !bDate) return -1;
              if (!aDate && bDate) return 1;
              if (aDate && bDate) return parseDate(aDate) - parseDate(bDate);
              return 0;
            });
            const targetCount = Math.min(TARGET_MAX, BASE_TARGET + completedCountRef.current);
            const visible = filteredTasks.filter((t) => !dismissedIdsRef.current.has(t.id));
            setAiTasks(visible.slice(0, targetCount));
            setCache(CACHE_KEY, filteredTasks); // cache full list
          }
        } catch (err) {
          console.warn("[AICurated] AI call failed, using fallback:", err.message);
          filteredTasks.sort((a, b) => {
            const aDate = a.nearestDate || a.due;
            const bDate = b.nearestDate || b.due;
            if (aDate && !bDate) return -1;
            if (!aDate && bDate) return 1;
            if (aDate && bDate) return parseDate(aDate) - parseDate(bDate);
            return 0;
          });
          const targetCount = Math.min(TARGET_MAX, BASE_TARGET + completedCountRef.current);
          const visible = filteredTasks.filter((t) => !dismissedIdsRef.current.has(t.id));
          setAiTasks(visible.slice(0, targetCount));
          setCache(CACHE_KEY, filteredTasks); // cache full list
        }
      } else {
        // No Claude key or no filtered tasks — sort by nearest date
        filteredTasks.sort((a, b) => {
          const aDate = a.nearestDate || a.due;
          const bDate = b.nearestDate || b.due;
          if (aDate && !bDate) return -1;
          if (!aDate && bDate) return 1;
          if (aDate && bDate) return parseDate(aDate) - parseDate(bDate);
          return 0;
        });
        const targetCount = Math.min(TARGET_MAX, BASE_TARGET + completedCountRef.current);
        const visible = filteredTasks.filter((t) => !dismissedIdsRef.current.has(t.id));
        setAiTasks(visible.slice(0, targetCount));
        setCache(CACHE_KEY, filteredTasks); // cache full list
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
  }, [user, pages]);

  // Auto-scan on mount (after brief delay for cached results to render)
  useEffect(() => {
    const cached = getCached(CACHE_KEY, CACHE_TTL);
    if (cached && cached.length > 0) {
      // Cache is fresh and has results — don't re-scan
      return;
    }
    // Delay scan slightly so cached local tasks render first
    // Use longer delay if pages haven't loaded yet to avoid scanning empty page list
    const delay = pages.length === 0 ? 1500 : 500;
    const timer = setTimeout(() => scan(), delay);
    return () => clearTimeout(timer);
  }, [scan, pages.length]);

  // Force refresh clears cache and rescans
  const forceRefresh = useCallback(() => scan(true), [scan]);

  // Debounced refresh: collapses rapid completion events into one scan (2.5s trailing edge)
  const debouncedRefresh = useCallback(() => {
    clearTimeout(debounceTimerRef.current);
    // Invalidate cache immediately so stale data isn't served
    try { localStorage.removeItem(CACHE_KEY); } catch {}
    debounceTimerRef.current = setTimeout(() => scan(true), 2500);
  }, [scan]);

  // Cleanup debounce timer on unmount
  useEffect(() => () => clearTimeout(debounceTimerRef.current), []);

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

  // ── Local score adjustments on interaction (instant, zero tokens) ──
  const TERMINAL_STATUSES = new Set(["done", "complete", "completed", "cancelled", "canceled", "archived", "delivered", "closed"]);

  const recordInteraction = useCallback((taskId, type, detail) => {
    setAiTasks((prev) => {
      let tasks = prev.map((t) => {
        if (t.id !== taskId) return t;
        const currentScore = t._aiScore || 3;
        let adjustment = 0;
        if (type === "status_change") {
          // Check if the new status is terminal
          const newStatus = (detail || "").split("→").pop()?.trim().toLowerCase() || "";
          if (TERMINAL_STATUSES.has(newStatus) || detail === "completed") {
            adjustment = -10; // Remove from list
          } else {
            adjustment = -2; // Deprioritize but keep
          }
        } else if (type === "field_edit") {
          adjustment = -1;
        } else if (type === "comment") {
          adjustment = +1; // Bump UP — needs more work
        } else if (type === "view") {
          adjustment = -0.5;
        }
        return { ...t, _aiScore: currentScore + adjustment };
      });
      // Filter out tasks with very low scores (terminal status changes)
      tasks = tasks.filter((t) => (t._aiScore || 0) > -5);
      // Re-sort by score
      tasks.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));
      return tasks;
    });
  }, []);

  return {
    aiTasks,
    loading,
    refreshing,
    lastUpdated,
    refresh: forceRefresh,
    debouncedRefresh,
    error,
    insight,
    recordInteraction,
  };
}
