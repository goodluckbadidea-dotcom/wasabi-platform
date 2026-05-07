// ─── Tasks View ───
// Tasks-only panel — lives in the left pane of the dual-pane app shell.
// The standalone Calendar lives separately as a right-pane destination
// (see App.jsx routing for "calendar"). Phase 2 stripped the inner split.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FONT, FONT_DISPLAY, RADIUS } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { IconEdit } from "../design/icons.jsx";
import useTasksTable from "./useTasksTable.js";
import useAICuratedTasks from "./useAICuratedTasks.js";
import useDismissedTasks from "./useDismissedTasks.js";
import TaskList from "./TaskList.jsx";
import RecordDrawer from "./RecordDrawer.jsx";
import { useRecordDrawer } from "./RecordDrawerContext.jsx";
import { ErrorBoundary } from "../core/ErrorBoundary.jsx";
import { useColorMapping } from "../context/ColorMappingContext.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
const ViewSettingsPanel = React.lazy(() => import("../components/ViewSettingsPanel.jsx").catch(() =>
  new Promise(r => setTimeout(r, 200)).then(() => import("../components/ViewSettingsPanel.jsx"))
));

export default function TasksView() {
  const { identity } = usePlatform();
  const isViewer = identity?.role === "viewer";
  const {
    tasks: userTasks,
    loading: tasksLoading,
    tableId,
    addTask,
    toggleTask: toggleTask,
    deleteTask,
    refresh: refreshTasks,
  } = useTasksTable();

  const { dismissedIds, completedCount, dismiss, clear: clearDismissed } = useDismissedTasks();

  const {
    aiTasks,
    loading: aiLoading,
    refreshing: aiRefreshing,
    lastUpdated,
    refresh: refreshAI,
    debouncedRefresh,
    markDirty,
    error: aiError,
    recordInteraction,
    snoozedTasks,
    snooze,
    unsnooze,
  } = useAICuratedTasks({ dismissedIds, completedCount, userTasksTableId: tableId });

  const { openDrawer, onSaved, onDeleted } = useRecordDrawer();
  const [showSettings, setShowSettings] = useState(false);

  // Subscribe to drawer save/delete events. Calendar-related event refreshes
  // now happen inside the standalone CalendarView (post-Phase 2). Tasks
  // listening here only refreshes the task list.
  useEffect(() => {
    const unsubSave = onSaved((type, data) => {
      if (type === "task") {
        refreshTasks();
        // "Remove from To Do" → dismiss + debounced refresh (not immediate full refresh)
        if (data?._removedFromTodo) {
          dismiss(data.id);
          debouncedRefresh();
        } else {
          markDirty(); // background rescan via dirty flag (not immediate full refresh)
        }
      }
    });
    const unsubDelete = onDeleted((type) => {
      if (type === "task") { refreshTasks(); markDirty(); }
    });
    return () => { unsubSave(); unsubDelete(); };
  }, [onSaved, onDeleted, refreshTasks, markDirty, debouncedRefresh, dismiss]);
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

  // ── Toggle for user (manual) tasks ──
  // When toggling to done, also trigger debounced AI refresh to surface new tasks
  const handleToggleTask = useCallback((taskId) => {
    const task = userTasks.find((t) => t.id === taskId);
    toggleTask(taskId);
    if (task && !task.done) {
      // Toggling to done → trigger AI re-scan after debounce
      debouncedRefresh();
    }
  }, [userTasks, toggleTask, debouncedRefresh]);

  // ── Add task handler ──
  const handleAddTask = useCallback((title) => {
    addTask(title);
  }, [addTask]);

  // ── Task click → open drawer ──
  const handleTaskClick = useCallback((task) => {
    openDrawer("task", { ...task, ...(task.source === "manual" ? { tableId } : {}) });
  }, [openDrawer, tableId]);

  // ── Drawer callbacks ──
  const handleTaskUpdated = useCallback(() => {
    refreshTasks();
    markDirty(); // background rescan via dirty flag
  }, [refreshTasks, markDirty]);

  const handleTaskDeleted = useCallback(() => {
    refreshTasks();
  }, [refreshTasks]);

  // Calendar event handlers no longer hooked here — events flow through the
  // standalone CalendarView's own subscription path post-Phase 2.

  // ── Combined refresh ──
  const handleRefresh = useCallback(() => {
    clearDismissed(); // reset session dismissed state on manual refresh
    refreshTasks();
    refreshAI();
  }, [refreshTasks, refreshAI, clearDismissed]);

  // ── Collect tasks due today for the schedule panel ──
  const allTasks = useMemo(() => [...userTasks, ...aiTasks], [userTasks, aiTasks]);

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
      background: "transparent",
    }}>
      {/* Tasks panel — fills the entire left pane (Calendar split removed in Phase 2). */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: C.darkSurf,
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
            userTasks={userTasks}
            aiTasks={aiTasks}
            aiLoading={aiLoading}
            aiRefreshing={aiRefreshing}
            dismissedIds={dismissedIds}
            onToggleTask={handleToggleTask}
            onToggleAI={handleToggleAI}
            onAddTask={handleAddTask}
            onDeleteTask={deleteTask}
            onTaskClick={handleTaskClick}
            colorMapping={taskColorMapping}
            dateChipColors={dateChipColors}
            snoozedTasks={snoozedTasks}
            onUnsnooze={unsnooze}
            readOnly={isViewer}
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

      {/* Sashimi drawer for task editing (calendar event editing now flows
          through the standalone CalendarView). */}
      <RecordDrawer
        onTaskUpdated={handleTaskUpdated}
        onTaskDeleted={handleTaskDeleted}
        onRecordInteraction={recordInteraction}
        onSnooze={snooze}
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
