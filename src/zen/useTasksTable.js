// ─── useZenTasks Hook ───
// Manages per-user "Zen Tasks" D1 table: auto-provisions on first use per user,
// provides CRUD operations with optimistic updates.
// Each user gets their own isolated task table, stored in user_state.

import { useState, useEffect, useCallback, useRef } from "react";
import { usePlatform } from "../context/PlatformContext.jsx";
import { createTableConfig, savePageConfig } from "../config/pageConfig.js";
import { listRows, createRows, updateRow, deleteRow, getUserState, putUserState } from "../lib/api.js";
import { normalizeD1Task } from "./taskHelpers.js";

// Column definitions for the Zen Tasks table
const ZEN_COLUMNS = [
  { name: "Task", type: "text", id: "task" },
  { name: "Done", type: "checkbox", id: "done" },
  { name: "Priority", type: "select", id: "priority", options: ["High", "Medium", "Low"] },
  { name: "Due", type: "date", id: "due" },
  { name: "Notes", type: "text", id: "notes" },
];

export default function useTasksTable() {
  const { pages, addPage, identity } = usePlatform();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tableId, setTableId] = useState(null);
  const provisioningRef = useRef(false);
  const hasInitRef = useRef(false);

  // ── Find or create per-user Zen Tasks table ──
  useEffect(() => {
    let cancelled = false;
    hasInitRef.current = false;

    async function initTable() {
      if (hasInitRef.current) return;
      hasInitRef.current = true;

      // 1. If logged in, check user_state for per-user table ID
      if (identity?.id) {
        try {
          const { state } = await getUserState();
          if (state?.zen_tasks_table_id) {
            if (!cancelled) setTableId(state.zen_tasks_table_id);
            return;
          }
        } catch {}

        // Fallback: search pages for existing zen table (may exist from before user_state was set)
        const existing = pages.find((p) => p._systemInternal || (p.name && p.name.startsWith("Zen Tasks")));
        if (existing) {
          if (!cancelled) setTableId(existing.id);
          // Persist to user_state so we find it next time
          putUserState({ zen_tasks_table_id: existing.id }).catch(() => {});
          return;
        }
      }

      // 2. Fallback for single-user mode: check localStorage
      if (!identity?.id) {
        const cachedId = localStorage.getItem("wasabi_tasks_table_id");
        if (cachedId) {
          if (!cancelled) setTableId(cachedId);
          return;
        }

        // Search existing pages for a system-internal page
        const existing = pages.find((p) => p._systemInternal || (p.name && p.name.startsWith("Zen Tasks")));
        if (existing) {
          if (!cancelled) setTableId(existing.id);
          localStorage.setItem("wasabi_tasks_table_id", existing.id);
          return;
        }
      }

      // 3. Auto-provision a new table for this user
      if (provisioningRef.current) return;
      provisioningRef.current = true;

      try {
        const suffix = identity?.display_name ? ` (${identity.display_name})` : "";
        const config = createTableConfig(`Zen Tasks${suffix}`, "check", ZEN_COLUMNS);
        config._systemInternal = true;
        const id = await savePageConfig(config);
        if (!cancelled) {
          setTableId(id);
          addPage({ ...config, id });

          // Save to user_state if logged in
          if (identity?.id) {
            putUserState({ zen_tasks_table_id: id }).catch(() => {});
          } else {
            localStorage.setItem("wasabi_tasks_table_id", id);
          }
        }
      } catch (err) {
        console.error("[ZenTasks] Failed to create table:", err);
      } finally {
        provisioningRef.current = false;
      }
    }

    initTable();
    return () => { cancelled = true; };
  }, [pages, addPage, identity]);

  // Reset when user changes
  useEffect(() => {
    setTableId(null);
    setTasks([]);
    setLoading(true);
    hasInitRef.current = false;
    provisioningRef.current = false;
  }, [identity?.id]);

  // ── Fetch tasks from D1 ──
  const fetchTasks = useCallback(async () => {
    if (!tableId) return;
    try {
      setLoading(true);
      const result = await listRows(tableId);
      const rows = result.rows || [];
      setTasks(rows.map((r) => normalizeD1Task(r, ZEN_COLUMNS)));
    } catch (err) {
      console.error("[ZenTasks] Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [tableId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // ── Add a new task (optimistic) ──
  const addTask = useCallback(async (title, priority, due) => {
    if (!tableId || !title.trim()) return;

    const tempId = `temp_${Date.now()}`;
    const optimistic = {
      id: tempId,
      title: title.trim(),
      done: false,
      priority: priority || null,
      due: due || null,
      notes: "",
      source: "manual",
      sourceName: "Zen Tasks",
      createdAt: new Date().toISOString(),
      _raw: null,
    };

    // Add optimistically
    setTasks((prev) => [optimistic, ...prev]);

    try {
      const cells = { task: title.trim(), done: false };
      if (priority) cells.priority = priority;
      if (due) cells.due = due;
      const result = await createRows(tableId, { cells });
      const newId = result.rows?.[0]?.id || result.id;

      // Replace temp with real ID
      setTasks((prev) =>
        prev.map((t) => (t.id === tempId ? { ...t, id: newId } : t))
      );
    } catch (err) {
      console.error("[ZenTasks] Failed to add:", err);
      // Remove optimistic entry on failure
      setTasks((prev) => prev.filter((t) => t.id !== tempId));
    }
  }, [tableId]);

  // ── Toggle task done state ──
  const toggleTask = useCallback(async (taskId) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !tableId) return;

    const newDone = !task.done;

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, done: newDone } : t))
    );

    try {
      await updateRow(tableId, taskId, { cells: { done: newDone } });
    } catch (err) {
      console.error("[ZenTasks] Failed to toggle:", err);
      // Revert
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, done: !newDone } : t))
      );
    }
  }, [tasks, tableId]);

  // ── Delete a task ──
  const deleteTask = useCallback(async (taskId) => {
    if (!tableId) return;

    const removed = tasks.find((t) => t.id === taskId);

    // Optimistic remove
    setTasks((prev) => prev.filter((t) => t.id !== taskId));

    try {
      await deleteRow(tableId, taskId);
    } catch (err) {
      console.error("[ZenTasks] Failed to delete:", err);
      // Restore on failure
      if (removed) setTasks((prev) => [...prev, removed]);
    }
  }, [tasks, tableId]);

  return {
    tasks,
    loading: loading && !tasks.length,
    tableId,
    addTask,
    toggleTask,
    deleteTask,
    refresh: fetchTasks,
  };
}
