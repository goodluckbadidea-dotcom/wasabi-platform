// ─── Calendar Task Block ───
// Renders a task with a due time on the day column hour grid.
// Dotted border, lighter background, accent dot — visually distinct from events.

import React from "react";
import { C, FONT, RADIUS } from "../../design/tokens.js";

export default function CalendarTaskBlock({ task, hourHeight, hourStart, onClick }) {
  if (!task.due) return null;
  const d = new Date(task.due);
  // Only render on the grid if the due date has a time component
  const hasTime = task.due.includes("T");
  if (!hasTime) return null;

  const startHour = d.getHours() + d.getMinutes() / 60;
  const top = (startHour - hourStart) * hourHeight;

  if (startHour < hourStart) return null;

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick?.(task); }}
      style={{
        position: "absolute",
        left: 48,
        right: 4,
        top,
        height: 24,
        background: C.accent + "12",
        border: `1px dashed ${C.accent}44`,
        borderRadius: RADIUS.md,
        padding: "3px 6px",
        fontSize: 12,
        fontFamily: FONT,
        color: C.darkText,
        overflow: "hidden",
        zIndex: 2,
        display: "flex",
        alignItems: "center",
        gap: 6,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div style={{
        width: 6, height: 6, borderRadius: "50%",
        background: C.accent, flexShrink: 0,
      }} />
      <span style={{
        fontWeight: 500,
        whiteSpace: "nowrap", overflow: "hidden",
        textOverflow: "ellipsis", flex: 1,
      }}>
        {task.title}
      </span>
    </div>
  );
}
