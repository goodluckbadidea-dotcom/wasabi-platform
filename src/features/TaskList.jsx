// ─── Task List ───
// Left panel of the To-Do split view.
// Quick-add input at top, manual tasks, AI-curated tasks, completed section.

import React, { useState, useRef, useCallback, useMemo } from "react";
import { C, FONT, RADIUS, SHADOW, VIEW_PALETTE, getSolidPillColor, isLightColor, getThemeMode, resolveUnifiedColor } from "../design/tokens.js";
import { formatDueDate, isOverdue, isToday, parseDate } from "./taskHelpers.js";

// ── Priority → palette index mapping ──
const PRIORITY_IDX = { High: 9, Medium: 3, Normal: 4, Low: 6 };

// ── Snooze presets ──
function getSnoozePresets() {
  const now = new Date();
  const twoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const nextMonday = new Date(now);
  nextMonday.setDate(nextMonday.getDate() + ((1 + 7 - nextMonday.getDay()) % 7 || 7));
  nextMonday.setHours(9, 0, 0, 0);
  return [
    { label: "2 hours", until: twoHours },
    { label: "Tomorrow morning", until: tomorrow.toISOString() },
    { label: "Next week", until: nextMonday.toISOString() },
  ];
}

function formatSnoozeTime(isoStr) {
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const diffH = Math.round((d - now) / 3600000);
    if (diffH < 1) return "soon";
    if (diffH < 24) return `in ${diffH}h`;
    const diffD = Math.round(diffH / 24);
    return `in ${diffD}d`;
  } catch { return ""; }
}

// ── Date tier classification ──
export const DATE_TIERS = ["Overdue", "Due Today", "Due This Week", "Due Later", "No Date"];
export const DATE_TIER_DEFAULTS = { Overdue: 9, "Due Today": 3, "Due This Week": 7, "Due Later": 0, "No Date": 0 };

function getDateTier(due) {
  if (!due) return "No Date";
  if (isOverdue(due)) return "Overdue";
  if (isToday(due)) return "Due Today";
  const d = parseDate(due);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((dDay - now) / (1000 * 60 * 60 * 24));
  if (diff <= 7) return "Due This Week";
  return "Due Later";
}

// Resolve a task's display color (hex string) from status or priority
// Supports unified color mapping when provided
function getTaskBarColor(task, colorMapping) {
  const value = task.status || task.priority;
  if (!value) return null;

  // Use unified color resolution if mapping is available
  if (colorMapping) {
    const schemaOpts = task._statusOptions || [];
    const optNames = schemaOpts.map((o) => o.name);
    const resolved = resolveUnifiedColor(value, {
      viewColorMapping: colorMapping.viewColorMapping,
      globalColorMapping: colorMapping.globalColorMapping,
      schemaOptions: schemaOpts,
      options: optNames,
    });
    return resolved.hex;
  }

  // Fallback: original behavior
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

function DueBadge({ due, dateChipColors }) {
  if (!due) return null;
  const tier = getDateTier(due);
  const mapping = dateChipColors || DATE_TIER_DEFAULTS;
  const paletteIdx = mapping[tier] ?? DATE_TIER_DEFAULTS[tier] ?? 0;
  const entry = VIEW_PALETTE[paletteIdx] || VIEW_PALETTE[0];
  const textColor = isLightColor(entry.hex) ? "#1a1a1a" : "#fff";
  return (
    <span style={{
      fontSize: 11, fontFamily: FONT, flexShrink: 0, fontWeight: 500,
      padding: "2px 7px", borderRadius: RADIUS.pill,
      background: entry.hex,
      color: textColor,
    }}>
      {formatDueDate(due)}
    </span>
  );
}

function SourceBadge({ sourceName }) {
  if (!sourceName || sourceName === "User Tasks") return null;
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

function TaskRow({ task, onToggle, onDelete, onTaskClick, colorMapping, dateChipColors }) {
  const [hovered, setHovered] = useState(false);
  const barColor = getTaskBarColor(task, colorMapping);
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
        padding: "10px 14px",
        marginBottom: 4,
        borderRadius: RADIUS.lg,
        cursor: "pointer",
        transition: "background 0.15s ease, box-shadow 0.15s ease",
        background: overdueBg || (hovered ? C.darkSurf2 : C.darkSurf),
        border: `1px solid ${hovered ? C.border2 : C.darkBorder}`,
        boxShadow: SHADOW.cardMaterial,
        opacity: task.done ? 0.5 : 1,
        position: "relative",
        overflow: "hidden",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Left color fill */}
      {barColor && (
        <div style={{
          position: "absolute",
          left: 0, top: 0, bottom: 0,
          width: 6, borderRadius: 0,
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
      <DueBadge due={task.due} dateChipColors={dateChipColors} />
      <SourceBadge sourceName={task.sourceName} />

      {/* Delete (on hover, manual tasks only, hidden when readOnly/no handler) */}
      {hovered && task.source === "manual" && onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
          style={{
            background: "none", border: "none", cursor: "pointer",
            padding: 6, display: "flex", opacity: 0.5,
            outline: "none", flexShrink: 0,
            borderRadius: RADIUS.sm, minWidth: 28, minHeight: 28,
            alignItems: "center", justifyContent: "center",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
            <path d="M2 2L8 8M8 2L2 8" stroke={C.darkMuted} strokeWidth="1.2" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default function TaskList({ userTasks, aiTasks, aiLoading, aiRefreshing, dismissedIds, onToggleTask, onToggleAI, onAddTask, onDeleteTask, onTaskClick, colorMapping, dateChipColors, snoozedTasks = [], onUnsnooze, readOnly = false }) {
  const [inputValue, setInputValue] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const inputRef = useRef(null);
  const prevAIIdsRef = useRef(new Set());

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    const val = inputValue.trim();
    if (!val) return;
    onAddTask(val);
    setInputValue("");
    inputRef.current?.focus();
  }, [inputValue, onAddTask]);

  // Split tasks into active and completed, filtering out dismissed
  const activeUserTasks = userTasks.filter((t) => !t.done);
  const completedUserTasks = userTasks.filter((t) => t.done);
  const _dismissed = dismissedIds || new Set();
  const activeAI = aiTasks.filter((t) => !t.done && !_dismissed.has(t.id));

  // Track which AI task IDs are new (for fade-in animation)
  const newAIIds = useMemo(() => {
    const currentIds = new Set(activeAI.map((t) => t.id));
    const prev = prevAIIdsRef.current;
    const newIds = new Set();
    for (const id of currentIds) {
      if (!prev.has(id)) newIds.add(id);
    }
    // Update ref for next render
    prevAIIdsRef.current = currentIds;
    return newIds;
  }, [activeAI]);
  const completedAI = aiTasks.filter((t) => t.done);
  const allCompleted = [...completedUserTasks, ...completedAI];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Quick-add input (hidden for read-only viewers) */}
      {!readOnly && (
        <form onSubmit={handleSubmit} style={{ flexShrink: 0, padding: "12px 14px 4px" }}>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Add a task..."
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "12px 16px",
              borderRadius: RADIUS.md,
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
      )}

      {/* Scrollable task list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
        {/* My Tasks section */}
        {activeUserTasks.length > 0 && (
          <div style={{ padding: "4px 0" }}>
            <div style={{
              padding: "6px 14px", fontSize: 10, fontFamily: FONT,
              fontWeight: 600, color: C.darkMuted, letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}>
              My Tasks
            </div>
            {activeUserTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onToggle={readOnly ? undefined : onToggleTask}
                onDelete={readOnly ? undefined : onDeleteTask}
                onTaskClick={onTaskClick}
                colorMapping={colorMapping}
                dateChipColors={dateChipColors}
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
              {aiRefreshing && (
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: C.accent, display: "inline-block",
                  animation: "pulse 1.5s ease-in-out infinite",
                }} />
              )}
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
                <div
                  key={task.id}
                  style={newAIIds.has(task.id) ? {
                    animation: "fadeSlideIn 0.3s ease both",
                  } : undefined}
                >
                  <TaskRow
                    task={task}
                    onToggle={readOnly ? undefined : onToggleAI}
                    onDelete={readOnly ? undefined : () => {}}
                    onTaskClick={onTaskClick}
                    colorMapping={colorMapping}
                    dateChipColors={dateChipColors}
                  />
                </div>
              ))
            )}
          </div>
        )}

        {/* Empty state */}
        {activeUserTasks.length === 0 && activeAI.length === 0 && !aiLoading && (
          <div style={{
            padding: "40px 20px", textAlign: "center",
            color: C.darkMuted, fontFamily: FONT, fontSize: 12,
          }}>
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.3, marginBottom: 8 }}>
              <circle cx="8" cy="8" r="6" stroke={C.darkMuted} strokeWidth="1.3" fill="none" />
              <path d="M5 8L7 10L11 6" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <div>{readOnly ? "No tasks assigned to you." : "All clear! Add a task above."}</div>
          </div>
        )}

        {/* Snoozed section */}
        {snoozedTasks.length > 0 && (
          <div style={{ padding: "4px 0" }}>
            <div style={{ margin: "4px 14px 0", borderTop: `1px solid ${C.darkBorder}` }} />
            <button
              onClick={() => setShowSnoozed(!showSnoozed)}
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
                style={{ transform: showSnoozed ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
                <path d="M2 1L6 4L2 7" stroke={C.darkMuted} strokeWidth="1.2" />
              </svg>
              Snoozed ({snoozedTasks.length})
            </button>
            {showSnoozed && snoozedTasks.map((task) => (
              <div key={task.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 14px", opacity: 0.55,
              }}>
                <div style={{ flex: 1, fontSize: 13, fontFamily: FONT, color: C.darkText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {task.title}
                </div>
                <span style={{ fontSize: 10, fontFamily: FONT, color: C.darkMuted, flexShrink: 0 }}>
                  {formatSnoozeTime(task._snoozeUntil)}
                </span>
                {onUnsnooze && !readOnly && (
                  <button
                    onClick={() => onUnsnooze(task._snoozeId, task.id)}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      fontSize: 10, fontFamily: FONT, color: C.accent,
                      padding: "2px 6px", flexShrink: 0,
                    }}
                  >
                    Wake
                  </button>
                )}
              </div>
            ))}
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
                onToggle={readOnly ? undefined : (task.source === "manual" ? onToggleTask : onToggleAI)}
                onDelete={readOnly ? undefined : (task.source === "manual" ? onDeleteTask : () => {})}
                onTaskClick={onTaskClick}
                colorMapping={colorMapping}
                dateChipColors={dateChipColors}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
