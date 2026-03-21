// ─── Zen Tasks View ───
// Main orchestrator for the Zen To-Do split view.
// Left 40%: AI-curated to-do list + quick-add.
// Right 60%: Today's schedule / calendar.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FONT, FONT_DISPLAY, RADIUS } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { IconEdit } from "../design/icons.jsx";
import useTasksTable from "./useTasksTable.js";
import useAICuratedTasks from "./useAICuratedTasks.js";
import useDismissedTasks from "./useDismissedTasks.js";
import TaskList from "./TaskList.jsx";
import CalendarView from "./CalendarView.jsx";
import RecordDrawer from "./RecordDrawer.jsx";
import { useRecordDrawer } from "./RecordDrawerContext.jsx";
import { ErrorBoundary } from "../core/ErrorBoundary.jsx";
import { useColorMapping } from "../context/ColorMappingContext.jsx";
const ViewSettingsPanel = React.lazy(() => import("../components/ViewSettingsPanel.jsx").catch(() =>
  new Promise(r => setTimeout(r, 200)).then(() => import("../components/ViewSettingsPanel.jsx"))
));

export default function TasksView() {
  const {
    tasks: zenTasks,
    loading: zenLoading,
    tableId,
    addTask,
    toggleTask: toggleZenTask,
    deleteTask,
    refresh: refreshZen,
  } = useTasksTable();

  const { dismissedIds, completedCount, dismiss, clear: clearDismissed } = useDismissedTasks();

  const {
    aiTasks,
    loading: aiLoading,
    refreshing: aiRefreshing,
    lastUpdated,
    refresh: refreshAI,
    debouncedRefresh,
    error: aiError,
    recordInteraction,
  } = useAICuratedTasks({ dismissedIds, completedCount, zenTableId: tableId });

  const { openDrawer, onSaved, onDeleted } = useRecordDrawer();
  const calendarRefreshRef = useRef(null);
  const [showSettings, setShowSettings] = useState(false);

  // Subscribe to drawer save/delete events (works regardless of which view rendered the drawer)
  useEffect(() => {
    const unsubSave = onSaved((type, data) => {
      if (type === "task") {
        refreshZen();
        // "Remove from To Do" → dismiss + debounced refresh (not immediate full refresh)
        if (data?._removedFromTodo) {
          dismiss(data.id);
          debouncedRefresh();
        } else {
          refreshAI();
        }
      }
      if (type === "event") calendarRefreshRef.current?.();
    });
    const unsubDelete = onDeleted((type) => {
      if (type === "task") { refreshZen(); refreshAI(); }
      if (type === "event") calendarRefreshRef.current?.();
    });
    return () => { unsubSave(); unsubDelete(); };
  }, [onSaved, onDeleted, refreshZen, refreshAI, debouncedRefresh, dismiss]);
  const { globalColorMapping, globalColorField, getViewColorConfig, updateViewColorConfig, resetViewColorConfig } = useColorMapping();

  // Build colorMapping object for TaskRow color resolution
  const viewColorConfig = getViewColorConfig("tasks");
  const taskColorMapping = useMemo(() => ({
    viewColorMapping: viewColorConfig?.colorMapping || null,
    globalColorMapping,
  }), [viewColorConfig, globalColorMapping]);
  const dateChipColors = viewColorConfig?.dateChipColors || null;

  // ── Toggle for AI-curated tasks ──
  // AI tasks are read-only (no write-back to Notion), but we dismiss them
  // locally and trigger a debounced re-scan to surface new tasks.
  const handleToggleAI = useCallback((taskId) => {
    dismiss(taskId);
    debouncedRefresh();
  }, [dismiss, debouncedRefresh]);

  // ── Toggle for Zen (manual) tasks ──
  // When toggling to done, also trigger debounced AI refresh to surface new tasks
  const handleToggleZen = useCallback((taskId) => {
    const task = zenTasks.find((t) => t.id === taskId);
    toggleZenTask(taskId);
    if (task && !task.done) {
      // Toggling to done → trigger AI re-scan after debounce
      debouncedRefresh();
    }
  }, [zenTasks, toggleZenTask, debouncedRefresh]);

  // ── Add task handler ──
  const handleAddTask = useCallback((title) => {
    addTask(title);
  }, [addTask]);

  // ── Task click → open drawer ──
  const handleTaskClick = useCallback((task) => {
    openDrawer("task", { ...task, tableId });
  }, [openDrawer, tableId]);

  // ── Drawer callbacks ──
  const handleTaskUpdated = useCallback(() => {
    refreshZen();
    refreshAI();
  }, [refreshZen, refreshAI]);

  const handleTaskDeleted = useCallback(() => {
    refreshZen();
  }, [refreshZen]);

  const handleEventUpdated = useCallback(() => {
    calendarRefreshRef.current?.();
  }, []);

  const handleEventDeleted = useCallback(() => {
    calendarRefreshRef.current?.();
  }, []);

  // ── Combined refresh ──
  const handleRefresh = useCallback(() => {
    clearDismissed(); // reset session dismissed state on manual refresh
    refreshZen();
    refreshAI();
  }, [refreshZen, refreshAI, clearDismissed]);

  // ── Collect tasks due today for the schedule panel ──
  const allTasks = useMemo(() => [...zenTasks, ...aiTasks], [zenTasks, aiTasks]);

  // ── Build synthetic schema from task status options for ViewSettingsPanel ──
  const taskSchema = useMemo(() => {
    const seen = new Set();
    const options = [];
    for (const t of allTasks) {
      for (const opt of (t._statusOptions || [])) {
        if (!seen.has(opt.name)) {
          seen.add(opt.name);
          options.push(opt);
        }
      }
    }
    // Also include priority values as options if no status options found
    if (options.length === 0) {
      for (const name of ["High", "Medium", "Normal", "Low"]) {
        options.push({ name, color: "default" });
      }
    }
    return { statuses: [{ name: "Status", type: "status", options }], selects: [], multiSelects: [], allFields: [], dates: [] };
  }, [allTasks]);

  return (
    <div style={{
      flex: 1, display: "flex", overflow: "hidden",
      background: C.dark,
    }}>
      {/* Left panel: To-Do List (40%) */}
      <div style={{
        flex: "0 0 40%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRight: `3px solid ${C.dark}`,
      }}>
        {/* Panel header */}
        <div style={{
          flexShrink: 0, height: 48, padding: "0 20px",
          borderBottom: `1px solid ${C.darkBorder}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{
            fontSize: 18, fontWeight: 600, fontFamily: FONT_DISPLAY, color: C.darkText,
            display: "flex", alignItems: "center", gap: 10,
            animation: ANIM.snapUp(0.03),
          }}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke={C.accent} strokeWidth="1.3" fill="none" />
              <path d="M5 8L7 10L11 6" stroke={C.accent} strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Tasks
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {/* View settings */}
            <button
              onClick={() => setShowSettings(true)}
              title="View settings"
              style={{
                background: "none", border: "none", cursor: "pointer",
                padding: 8, display: "flex", opacity: 0.5,
                outline: "none", borderRadius: RADIUS.md,
                transition: "opacity 0.15s",
                minWidth: 32, minHeight: 32,
                alignItems: "center", justifyContent: "center",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
            >
              <IconEdit size={14} color={C.darkMuted} />
            </button>

            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              title="Refresh tasks"
              style={{
                background: "none", border: "none", cursor: "pointer",
                padding: 8, display: "flex", opacity: 0.5,
                outline: "none", borderRadius: RADIUS.md,
                transition: "opacity 0.15s",
                minWidth: 32, minHeight: 32,
                alignItems: "center", justifyContent: "center",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M14 2v5h-5" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12.5 10A5.5 5.5 0 1 1 13 6" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Task list content */}
        <ErrorBoundary fallbackLabel="Task List">
          <TaskList
            zenTasks={zenTasks}
            aiTasks={aiTasks}
            aiLoading={aiLoading}
            aiRefreshing={aiRefreshing}
            dismissedIds={dismissedIds}
            onToggleZen={handleToggleZen}
            onToggleAI={handleToggleAI}
            onAddTask={handleAddTask}
            onDeleteTask={deleteTask}
            onTaskClick={handleTaskClick}
            colorMapping={taskColorMapping}
            dateChipColors={dateChipColors}
          />
        </ErrorBoundary>

        {/* AI status footer */}
        {(lastUpdated || aiError) && !aiLoading && (
          <div style={{
            flexShrink: 0, padding: "4px 14px 6px",
            borderTop: `1px solid ${C.darkBorder}`,
            fontSize: 11, fontFamily: FONT, color: C.darkMuted,
            opacity: 0.6,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span>
              {aiRefreshing
                ? <span style={{ animation: "pulse 1.5s ease-in-out infinite" }}>Updating...</span>
                : lastUpdated ? `AI updated ${formatRelativeTime(lastUpdated)}` : ""}
              {aiError && !aiRefreshing && <span style={{ color: C.error, marginLeft: lastUpdated ? 6 : 0 }}>
                {lastUpdated ? "· " : ""}{aiError}
              </span>}
            </span>
            {aiError && (
              <button
                onClick={handleRefresh}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: C.accent, fontSize: 9, fontFamily: FONT,
                  padding: 0, outline: "none", opacity: 0.8,
                }}
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      {/* Right panel: Today's Schedule (60%) */}
      <div style={{
        flex: "0 0 60%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        <ErrorBoundary fallbackLabel="Calendar">
          <CalendarView allTasks={allTasks} refreshRef={calendarRefreshRef} />
        </ErrorBoundary>
      </div>

      {/* Sashimi drawer for task/event editing */}
      <RecordDrawer
        onTaskUpdated={handleTaskUpdated}
        onTaskDeleted={handleTaskDeleted}
        onEventUpdated={handleEventUpdated}
        onEventDeleted={handleEventDeleted}
        onRecordInteraction={recordInteraction}
      />

      {/* View settings panel */}
      {showSettings && (
        <React.Suspense fallback={null}>
          <ViewSettingsPanel
            viewKey="tasks"
            viewConfig={{ type: "tasks", label: "Tasks" }}
            schema={taskSchema}
            globalColorMapping={globalColorMapping}
            globalColorField={globalColorField}
            viewColorConfig={getViewColorConfig("tasks")}
            onSave={(updates) => updateViewColorConfig("tasks", updates)}
            onReset={() => resetViewColorConfig("tasks")}
            onClose={() => setShowSettings(false)}
          />
        </React.Suspense>
      )}
    </div>
  );
}

/** Format a Date as a relative time string */
function formatRelativeTime(date) {
  if (!date) return "";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
