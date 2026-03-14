// ─── useZenTasks Hook ───
// Manages the "Zen Tasks" D1 table: auto-provisions on first use,
// provides CRUD operations with optimistic updates.

import { useState, useEffect, useCallback, useRef } from "react";
import { usePlatform } from "../context/PlatformContext.jsx";
import { createTableConfig, savePageConfig } from "../config/pageConfig.js";
import { listRows, createRows, updateRow, deleteRow } from "../lib/api.js";
import { normalizeD1Task } from "./zenTaskHelpers.js";

const ZEN_TABLE_LS_KEY = "wasabi_zen_table_id";

// Column definitions for the Zen Tasks table
const ZEN_COLUMNS = [
  { name: "Task", type: "text", id: "task" },
  { name: "Done", type: "checkbox", id: "done" },
  { name: "Priority", type: "select", id: "priority", options: ["High", "Medium", "Low"] },
  { name: "Due", type: "date", id: "due" },
  { name: "Notes", type: "text", id: "notes" },
];

export default function useZenTasks() {
  const { pages, addPage } = usePlatform();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tableId, setTableId] = useState(null);
  const provisioningRef = useRef(false);

  // ── Find or create the Zen Tasks table ──
  useEffect(() => {
    let cancelled = false;

    async function initTable() {
      // 1. Check localStorage cache
      const cachedId = localStorage.getItem(ZEN_TABLE_LS_KEY);
      if (cachedId) {
        setTableId(cachedId);
        return;
      }

      // 2. Search existing pages for a zen-internal page
      const existing = pages.find((p) => p._zenInternal);
      if (existing) {
        setTableId(existing.id);
        localStorage.setItem(ZEN_TABLE_LS_KEY, existing.id);
        return;
      }

      // 3. Auto-provision (only once)
      if (provisioningRef.current) return;
      provisioningRef.current = true;

      try {
        const config = createTableConfig("Zen Tasks", "check", ZEN_COLUMNS);
        config._zenInternal = true;
        const id = await savePageConfig(config);
        if (!cancelled) {
          setTableId(id);
          localStorage.setItem(ZEN_TABLE_LS_KEY, id);
          addPage({ ...config, id });
        }
      } catch (err) {
        console.error("[ZenTasks] Failed to create table:", err);
      } finally {
        provisioningRef.current = false;
      }
    }

    initTable();
    return () => { cancelled = true; };
  }, [pages, addPage]);

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
