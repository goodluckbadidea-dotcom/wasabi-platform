// ─── useAICuratedTasks Hook ───
// Scans connected databases for task-like items, uses Haiku to prioritize.
// Caches results for 15 minutes to minimize token costs.

import { useState, useEffect, useCallback, useRef } from "react";
import { usePlatform } from "../context/PlatformContext.jsx";
import { detectSchema } from "../notion/schema.js";
import { queryLimited } from "../notion/pagination.js";
import { listRows, claudeProxy, getTableSchema } from "../lib/api.js";
import { normalizeNotionTask, normalizeD1Task, getCached, setCache } from "./zenTaskHelpers.js";

const CACHE_KEY = "wasabi_zen_ai_tasks_v4"; // v4: word-boundary name matching
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const MAX_DATABASES = 5;
const MAX_ITEMS_PER_DB = 30;

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
  if (task.due) obj.due = task.due;
  return obj;
}

export default function useAICuratedTasks() {
  const { user, pages } = usePlatform();
  const [aiTasks, setAiTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const scanningRef = useRef(false);

  // Load cached results immediately + clean up old cache keys
  useEffect(() => {
    // Clean up old cache keys
    try { localStorage.removeItem("wasabi_zen_ai_tasks"); } catch {}
    try { localStorage.removeItem("wasabi_zen_ai_tasks_v2"); } catch {}
    try { localStorage.removeItem("wasabi_zen_ai_tasks_v3"); } catch {}
    const cached = getCached(CACHE_KEY, CACHE_TTL);
    if (cached) {
      setAiTasks(cached);
      setLastUpdated(new Date(JSON.parse(localStorage.getItem(CACHE_KEY))?.ts));
      setLoading(false);
    }
  }, []);

  // Background scan and AI curation
  const scan = useCallback(async (force = false) => {
    if (!user?.workerUrl || !user?.notionKey) {
      setLoading(false);
      return;
    }
    if (scanningRef.current) return;

    // Force refresh: clear stale cache so results aren't served from old data
    if (force) {
      try { localStorage.removeItem(CACHE_KEY); } catch {}
    }

    scanningRef.current = true;

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
        if (page._zenInternal) continue;
        const pt = page.page_type || page.pageType;

        if (pt === "linked_notion" && page.databaseIds?.length > 0) {
          for (const dbId of page.databaseIds) {
            candidates.push({ type: "notion", dbId, pageName: page.name });
          }
        }
        if (pt === "database" && page.id) {
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

      if (taskDbs.length === 0) {
        // Only treat as a real "no tasks" if we didn't have errors
        if (schemaErrors > 0) {
          setError(`Failed to scan ${schemaErrors} database(s)`);
        }
        setLoading(false);
        scanningRef.current = false;
        return;
      }

      // Step 2: Fetch items from each database (parallel with retry)
      const allTasks = [];
      let fetchErrors = 0;

      const fetchPromises = taskDbs.map(async (db) => {
        try {
          if (db.type === "notion") {
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
              const task = normalizeNotionTask(page, db.schema, db.pageName);
              if (!task.done) tasks.push(task);
            }
            return tasks;
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
            return tasks;
          }
        } catch (err) {
          console.warn(`[AICurated] Failed to fetch from "${db.pageName}":`, err.message);
          fetchErrors++;
        }
        return [];
      });

      const fetchResults = await Promise.allSettled(fetchPromises);
      for (const r of fetchResults) {
        if (r.status === "fulfilled" && r.value) {
          allTasks.push(...r.value);
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

      // Step 3: Call Haiku for prioritization
      if (user.claudeKey) {
        try {
          const today = new Date().toISOString().split("T")[0];
          const dbSummaries = {};
          for (const task of allTasks) {
            const name = task.sourceName;
            if (!dbSummaries[name]) dbSummaries[name] = [];
            dbSummaries[name].push(compressTask(task));
          }

          const prompt = `You are a smart task prioritizer. Given items from the user's databases, do TWO things:

1. FILTER: Exclude anything that is NOT an actionable task. Skip contacts, records, reference entries, inventory items, labels, categories, or any non-actionable item. A real task is something a person needs to DO (write, call, fix, review, build, send, prepare, etc.). Items with statuses like "Active/Inactive" on contacts are NOT tasks.

2. PRIORITIZE: From the remaining real tasks, select the top 10-15 most important for today (${today}).

Priority rules (in order):
1. Overdue items (due date before today) — highest priority
2. Due today
3. Marked high priority or urgent
4. In-progress / actively being worked on
5. Recently created actionable items

Return ONLY a JSON array of objects with: { "title": "exact title", "priority_score": 1-5, "reason": "brief reason" }
Where 5 = most urgent, 1 = least urgent. If NO items are real actionable tasks, return an empty array []. Return valid JSON only, no markdown.

Items by database:
${JSON.stringify(dbSummaries, null, 0)}`;

          const aiResult = await claudeProxy({
            messages: [{ role: "user", content: prompt }],
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1024,
          }, user.claudeKey);

          const responseText = aiResult.content?.[0]?.text || aiResult.text || "";

          // Parse AI response
          let prioritized = [];
          try {
            // Extract JSON from response (handle potential markdown wrapping)
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              prioritized = JSON.parse(jsonMatch[0]);
            }
          } catch {
            console.warn("[AICurated] Failed to parse AI response");
          }

          // Map AI prioritized titles back to full task objects
          if (prioritized.length > 0) {
            const result = [];
            for (const item of prioritized) {
              const match = allTasks.find((t) =>
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
            setAiTasks(result);
            setCache(CACHE_KEY, result);
          } else {
            // Fallback: show all tasks sorted by due date
            allTasks.sort((a, b) => {
              if (a.due && !b.due) return -1;
              if (!a.due && b.due) return 1;
              if (a.due && b.due) return new Date(a.due) - new Date(b.due);
              return 0;
            });
            setAiTasks(allTasks.slice(0, 15));
            setCache(CACHE_KEY, allTasks.slice(0, 15));
          }
        } catch (err) {
          console.warn("[AICurated] AI call failed, using fallback:", err.message);
          // Fallback without AI
          allTasks.sort((a, b) => {
            if (a.due && !b.due) return -1;
            if (!a.due && b.due) return 1;
            if (a.due && b.due) return new Date(a.due) - new Date(b.due);
            return 0;
          });
          setAiTasks(allTasks.slice(0, 15));
          setCache(CACHE_KEY, allTasks.slice(0, 15));
        }
      } else {
        // No Claude key — just sort by due date
        allTasks.sort((a, b) => {
          if (a.due && !b.due) return -1;
          if (!a.due && b.due) return 1;
          if (a.due && b.due) return new Date(a.due) - new Date(b.due);
          return 0;
        });
        setAiTasks(allTasks.slice(0, 15));
        setCache(CACHE_KEY, allTasks.slice(0, 15));
      }

      setLastUpdated(new Date());
    } catch (err) {
      console.error("[AICurated] Scan failed:", err);
      setError(err.message);
    } finally {
      setLoading(false);
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

  return {
    aiTasks,
    loading,
    lastUpdated,
    refresh: forceRefresh,
    error,
  };
}
