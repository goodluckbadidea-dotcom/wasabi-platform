// ─── Zen Task List ───
// Left panel of the Zen Tasks split view.
// Quick-add input at top, manual tasks, AI-curated tasks, completed section.

import React, { useState, useRef, useCallback } from "react";
import { C, FONT, RADIUS, VIEW_PALETTE, getSolidPillColor, isLightColor, getThemeMode } from "../design/tokens.js";
import { formatDueDate, isOverdue, isToday } from "./zenTaskHelpers.js";

// ── Priority → palette index mapping ──
const PRIORITY_IDX = { High: 9, Medium: 3, Normal: 4, Low: 6 };

// Resolve a task's display color (hex string) from status or priority
function getTaskBarColor(task) {
  if (task.status) {
    const schemaOpts = task._statusOptions || [];
    const optNames = schemaOpts.map((o) => o.name);
    const pill = getSolidPillColor(task.status, optNames, schemaOpts);
    return pill?.fill || null;
  }
  const idx = PRIORITY_IDX[task.priority];
  if (idx !== undefined) return VIEW_PALETTE[idx].hex;
  return null;
}

function DueBadge({ due }) {
  if (!due) return null;
  const overdue = isOverdue(due);
  const today = isToday(due);
  const redHex = VIEW_PALETTE[9].hex;
  return (
    <span style={{
      fontSize: 11, fontFamily: FONT, flexShrink: 0, fontWeight: 500,
      padding: "2px 7px", borderRadius: RADIUS.pill,
      background: overdue ? redHex + "20" : C.darkSurf2,
      color: overdue ? redHex : today ? C.accent : C.darkMuted,
    }}>
      {formatDueDate(due)}
    </span>
  );
}

function SourceBadge({ sourceName }) {
  if (!sourceName || sourceName === "Zen Tasks") return null;
  return (
    <span style={{
      fontSize: 11, fontFamily: FONT, flexShrink: 0,
      padding: "2px 7px", borderRadius: RADIUS.pill,
      background: C.darkSurf2,
      color: C.darkMuted,
      letterSpacing: "0.02em",
    }}>
      {sourceName}
    </span>
  );
}

function TaskRow({ task, onToggle, onDelete, onTaskClick }) {
  const [hovered, setHovered] = useState(false);
  const barColor = getTaskBarColor(task);
  const overdue = task.due && isOverdue(task.due);
  const isDark = getThemeMode() === "dark";
  // Overdue items get a subtle tinted fill
  const overdueBg = overdue && barColor
    ? barColor + (isDark ? "18" : "14")
    : null;

  return (
    <div
      onClick={() => onTaskClick?.(task)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        marginBottom: 4,
        borderRadius: RADIUS.lg,
        cursor: "pointer",
        transition: "background 0.15s ease",
        background: overdueBg || (hovered ? C.darkSurf2 : C.darkSurf),
        opacity: task.done ? 0.5 : 1,
        position: "relative",
        overflow: "hidden",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Left color bar */}
      {barColor && (
        <div style={{
          position: "absolute",
          left: 0, top: "20%", bottom: "20%",
          width: 3, borderRadius: 2,
          background: barColor,
        }} />
      )}

      {/* Title */}
      <span style={{
        flex: 1, fontSize: 13, fontFamily: FONT, color: C.darkText,
        textDecoration: task.done ? "line-through" : "none",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        minWidth: 0,
        paddingLeft: barColor ? 4 : 0,
      }}>
        {task.title}
      </span>

      {/* Badges */}
      <DueBadge due={task.due} />
      <SourceBadge sourceName={task.sourceName} />

      {/* Delete (on hover, manual tasks only) */}
      {hovered && task.source === "manual" && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
          style={{
            background: "none", border: "none", cursor: "pointer",
            padding: 2, display: "flex", opacity: 0.5,
            outline: "none", flexShrink: 0,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2L8 8M8 2L2 8" stroke={C.darkMuted} strokeWidth="1.2" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default function TaskList({ zenTasks, aiTasks, aiLoading, onToggleZen, onToggleAI, onAddTask, onDeleteTask, onTaskClick }) {
  const [inputValue, setInputValue] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const inputRef = useRef(null);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    const val = inputValue.trim();
    if (!val) return;
    onAddTask(val);
    setInputValue("");
    inputRef.current?.focus();
  }, [inputValue, onAddTask]);

  // Split tasks into active and completed
  const activeZen = zenTasks.filter((t) => !t.done);
  const completedZen = zenTasks.filter((t) => t.done);
  const activeAI = aiTasks.filter((t) => !t.done);
  const completedAI = aiTasks.filter((t) => t.done);
  const allCompleted = [...completedZen, ...completedAI];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Quick-add input */}
      <form onSubmit={handleSubmit} style={{ flexShrink: 0, padding: "12px 12px 4px" }}>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Add a task..."
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 14px",
            borderRadius: 20,
            border: `1px solid ${C.darkBorder}`,
            background: C.darkSurf2,
            color: C.darkText,
            fontSize: 13,
            fontFamily: FONT,
            outline: "none",
            transition: "border-color 0.15s",
          }}
          onFocus={(e) => { e.target.style.borderColor = C.accent; }}
          onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
        />
      </form>

      {/* Scrollable task list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
        {/* My Tasks section */}
        {activeZen.length > 0 && (
          <div style={{ padding: "4px 0" }}>
            <div style={{
              padding: "6px 14px", fontSize: 10, fontFamily: FONT,
              fontWeight: 600, color: C.darkMuted, letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}>
              My Tasks
            </div>
            {activeZen.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={onToggleZen}
                onDelete={onDeleteTask}
                onTaskClick={onTaskClick}
              />
            ))}
          </div>
        )}

        {/* AI-Curated section */}
        {(activeAI.length > 0 || aiLoading) && (
          <div style={{ padding: "4px 0" }}>
            {/* Separator */}
            <div style={{
              margin: "4px 14px 0",
              borderTop: `1px solid ${C.darkBorder}`,
            }} />
            <div style={{
              padding: "8px 14px 4px", fontSize: 10, fontFamily: FONT,
              fontWeight: 600, color: C.darkMuted, letterSpacing: "0.06em",
              textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6,
            }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <circle cx="5" cy="5" r="4" stroke={C.darkMuted} strokeWidth="1" fill="none" />
                <circle cx="5" cy="5" r="1.5" fill={C.darkMuted} />
              </svg>
              From your databases
            </div>

            {aiLoading && activeAI.length === 0 ? (
              // Shimmer skeleton
              <div style={{ padding: "4px 12px" }}>
                {[1, 2, 3].map((i) => (
                  <div key={i} style={{
                    height: 36, borderRadius: 20,
                    background: C.darkSurf2, marginBottom: 4,
                    animation: "pulse 1.5s ease infinite",
                    opacity: 0.5,
                  }} />
                ))}
              </div>
            ) : (
              activeAI.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={onToggleAI}
                  onDelete={() => {}}
                  onTaskClick={onTaskClick}
                />
              ))
            )}
          </div>
        )}

        {/* Empty state */}
        {activeZen.length === 0 && activeAI.length === 0 && !aiLoading && (
          <div style={{
            padding: "40px 20px", textAlign: "center",
            color: C.darkMuted, fontFamily: FONT, fontSize: 12,
          }}>
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.3, marginBottom: 8 }}>
              <circle cx="8" cy="8" r="6" stroke={C.darkMuted} strokeWidth="1.3" fill="none" />
              <path d="M5 8L7 10L11 6" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <div>All clear! Add a task above.</div>
          </div>
        )}

        {/* Completed section */}
        {allCompleted.length > 0 && (
          <div style={{ padding: "4px 0" }}>
            <div style={{ margin: "4px 14px 0", borderTop: `1px solid ${C.darkBorder}` }} />
            <button
              onClick={() => setShowCompleted(!showCompleted)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                padding: "8px 14px 4px", fontSize: 10, fontFamily: FONT,
                fontWeight: 600, color: C.darkMuted, letterSpacing: "0.06em",
                textTransform: "uppercase", outline: "none",
                display: "flex", alignItems: "center", gap: 4,
                width: "100%",
              }}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none"
                style={{ transform: showCompleted ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
                <path d="M2 1L6 4L2 7" stroke={C.darkMuted} strokeWidth="1.2" />
              </svg>
              Completed ({allCompleted.length})
            </button>
            {showCompleted && allCompleted.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={task.source === "manual" ? onToggleZen : onToggleAI}
                onDelete={task.source === "manual" ? onDeleteTask : () => {}}
                onTaskClick={onTaskClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
