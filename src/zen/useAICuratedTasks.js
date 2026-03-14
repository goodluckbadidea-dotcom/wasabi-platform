// ─── useAICuratedTasks Hook ───
// Scans connected databases for task-like items, uses Haiku to prioritize.
// Caches results for 15 minutes to minimize token costs.

import { useState, useEffect, useCallback, useRef } from "react";
import { usePlatform } from "../context/PlatformContext.jsx";
import { detectSchema } from "../notion/schema.js";
import { queryLimited } from "../notion/pagination.js";
import { listRows, claudeProxy, getTableSchema } from "../lib/api.js";
import { normalizeNotionTask, normalizeD1Task, getCached, setCache } from "./zenTaskHelpers.js";

const CACHE_KEY = "wasabi_zen_ai_tasks";
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const MAX_DATABASES = 5;
const MAX_ITEMS_PER_DB = 30;

/**
 * Check if a classified schema has task-like fields.
 * A database is "task-like" if it has statuses or checkboxes AND a title.
 */
function isTaskLikeSchema(schema) {
  if (!schema) return false;
  const hasStatus = (schema.statuses?.length > 0) || (schema.checkboxes?.length > 0);
  const hasTitle = !!schema.title;
  return hasStatus && hasTitle;
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

  // Load cached results immediately
  useEffect(() => {
    const cached = getCached(CACHE_KEY, CACHE_TTL);
    if (cached) {
      setAiTasks(cached);
      setLastUpdated(new Date(JSON.parse(localStorage.getItem(CACHE_KEY))?.ts));
      setLoading(false);
    }
  }, []);

  // Background scan and AI curation
  const scan = useCallback(async () => {
    if (!user?.workerUrl || !user?.notionKey) {
      setLoading(false);
      return;
    }
    if (scanningRef.current) return;
    scanningRef.current = true;

    try {
      setError(null);

      // Step 1: Find task-like databases
      const taskDbs = [];

      for (const page of pages) {
        if (taskDbs.length >= MAX_DATABASES) break;
        if (page._zenInternal) continue;

        const pt = page.page_type || page.pageType;

        // Notion-linked databases
        if (pt === "linked_notion" && page.databaseIds?.length > 0) {
          for (const dbId of page.databaseIds) {
            if (taskDbs.length >= MAX_DATABASES) break;
            try {
              const schema = await detectSchema(user.workerUrl, user.notionKey, dbId);
              if (isTaskLikeSchema(schema)) {
                taskDbs.push({ type: "notion", dbId, schema, pageName: page.name });
              }
            } catch {}
          }
        }

        // D1 tables
        if (pt === "database" && page.id) {
          try {
            const schemaRes = await getTableSchema(page.id);
            const columns = schemaRes.columns || [];
            // Check for task-like columns
            const hasCheckOrStatus = columns.some((c) =>
              c.type === "checkbox" || c.type === "select" || c.type === "status"
            );
            const hasTitle = columns.some((c) =>
              c.type === "text" && ["task", "title", "name"].some((p) => c.name.toLowerCase().includes(p))
            );
            if (hasCheckOrStatus && hasTitle) {
              taskDbs.push({ type: "d1", tableId: page.id, columns, pageName: page.name });
            }
          } catch {}
        }
      }

      if (taskDbs.length === 0) {
        setLoading(false);
        scanningRef.current = false;
        return;
      }

      // Step 2: Fetch items from each database
      const allTasks = [];

      for (const db of taskDbs) {
        try {
          if (db.type === "notion") {
            const results = await queryLimited(
              user.workerUrl, user.notionKey, db.dbId,
              null, // No filter — we'll let AI filter
              [{ timestamp: "last_edited_time", direction: "descending" }],
              MAX_ITEMS_PER_DB
            );
            for (const page of (results || [])) {
              const task = normalizeNotionTask(page, db.schema, db.pageName);
              if (!task.done) allTasks.push(task);
            }
          } else if (db.type === "d1") {
            const result = await listRows(db.tableId, { limit: MAX_ITEMS_PER_DB });
            for (const row of (result.rows || [])) {
              const task = normalizeD1Task(row, db.columns);
              task.sourceName = db.pageName;
              task.source = `d1:${db.tableId}`;
              if (!task.done) allTasks.push(task);
            }
          }
        } catch (err) {
          console.warn(`[AICurated] Failed to fetch from ${db.pageName}:`, err.message);
        }
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

          const prompt = `You are a task prioritizer. Given the user's tasks from various databases, select the top 10-15 most important items for today (${today}).

Priority rules:
1. Overdue items first (due date before today)
2. Due today next
3. High priority items
4. In-progress items
5. Recently created items without dates

Return ONLY a JSON array of objects with: { "title": "exact title", "priority_score": 1-5, "reason": "brief reason" }
Where 5 = most urgent, 1 = least urgent. Return valid JSON only, no markdown.

Tasks by database:
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
    if (cached) {
      // Cache is fresh — don't re-scan
      return;
    }
    // Delay scan slightly so cached local tasks render first
    const timer = setTimeout(() => scan(), 500);
    return () => clearTimeout(timer);
  }, [scan]);

  return {
    aiTasks,
    loading,
    lastUpdated,
    refresh: scan,
    error,
  };
}
