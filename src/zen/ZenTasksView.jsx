// ─── Zen Tasks View ───
// Main orchestrator for the Zen To-Do split view.
// Left 40%: AI-curated to-do list + quick-add.
// Right 60%: Today's schedule / calendar.

import React, { useCallback, useMemo } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import useZenTasks from "./useZenTasks.js";
import useAICuratedTasks from "./useAICuratedTasks.js";
import TaskList from "./TaskList.jsx";
import ZenCalendar from "./ZenCalendar.jsx";
import { ErrorBoundary } from "../core/ErrorBoundary.jsx";

export default function ZenTasksView() {
  const {
    tasks: zenTasks,
    loading: zenLoading,
    addTask,
    toggleTask: toggleZenTask,
    deleteTask,
    refresh: refreshZen,
  } = useZenTasks();

  const {
    aiTasks,
    loading: aiLoading,
    lastUpdated,
    refresh: refreshAI,
    error: aiError,
  } = useAICuratedTasks();

  // ── Toggle for AI-curated tasks ──
  // For Notion tasks, we could update the source DB, but for now
  // we remove them from the local AI task list (cache refresh will re-evaluate)
  const handleToggleAI = useCallback((taskId) => {
    // AI tasks are read-only for toggle in this version.
    // A future version could call updateRecord for Notion tasks.
    // For now, the user can mark them done in their source database.
  }, []);

  // ── Add task handler ──
  const handleAddTask = useCallback((title) => {
    addTask(title);
  }, [addTask]);

  // ── Combined refresh ──
  const handleRefresh = useCallback(() => {
    refreshZen();
    refreshAI();
  }, [refreshZen, refreshAI]);

  // ── Collect tasks due today for the schedule panel ──
  const allTasks = useMemo(() => [...zenTasks, ...aiTasks], [zenTasks, aiTasks]);

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
        borderRight: `1px solid ${C.darkBorder}`,
      }}>
        {/* Panel header */}
        <div style={{
          flexShrink: 0, height: 44, padding: "0 14px",
          borderBottom: `1px solid ${C.darkBorder}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{
            fontSize: 13, fontWeight: 600, fontFamily: FONT, color: C.darkText,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke={C.darkText} strokeWidth="1.3" fill="none" />
              <path d="M5 8L7 10L11 6" stroke={C.darkText} strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Tasks
          </div>

          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            title="Refresh tasks"
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: 4, display: "flex", opacity: 0.5,
              outline: "none", borderRadius: RADIUS.md,
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M14 2v5h-5" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12.5 10A5.5 5.5 0 1 1 13 6" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Task list content */}
        <ErrorBoundary fallbackLabel="Task List">
          <TaskList
            zenTasks={zenTasks}
            aiTasks={aiTasks}
            aiLoading={aiLoading}
            onToggleZen={toggleZenTask}
            onToggleAI={handleToggleAI}
            onAddTask={handleAddTask}
            onDeleteTask={deleteTask}
          />
        </ErrorBoundary>

        {/* AI status footer */}
        {lastUpdated && !aiLoading && (
          <div style={{
            flexShrink: 0, padding: "4px 14px 6px",
            borderTop: `1px solid ${C.darkBorder}`,
            fontSize: 9, fontFamily: FONT, color: C.darkMuted,
            opacity: 0.6,
          }}>
            AI updated {formatRelativeTime(lastUpdated)}
            {aiError && <span style={{ color: "#E05252", marginLeft: 6 }}>· Error</span>}
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
          <ZenCalendar allTasks={allTasks} />
        </ErrorBoundary>
      </div>
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
