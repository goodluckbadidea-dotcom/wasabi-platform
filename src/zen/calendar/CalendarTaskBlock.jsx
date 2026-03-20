// ─── Calendar Task Block ───
// Renders a task with a due time on the day column hour grid.
// Surface bg + left color bar, matching task list treatment.

import React from "react";
import { C, FONT, RADIUS, VIEW_PALETTE, getSolidPillColor } from "../../design/tokens.js";
import { parseDate } from "../taskHelpers.js";

// Priority → palette index
const PRIORITY_IDX = { High: 9, Medium: 3, Normal: 4, Low: 6 };

function getTaskBarColor(task) {
  if (task.status) {
    const opts = (task._statusOptions || []).map((o) => o.name);
    const pill = getSolidPillColor(task.status, opts, task._statusOptions || []);
    return pill?.fill || null;
  }
  const idx = PRIORITY_IDX[task.priority];
  return idx !== undefined ? VIEW_PALETTE[idx].hex : null;
}

export default function CalendarTaskBlock({ task, hourHeight, hourStart, onClick }) {
  if (!task.due) return null;
  const d = parseDate(task.due);
  const hasTime = task.due.includes("T");
  if (!hasTime) return null;

  const startHour = d.getHours() + d.getMinutes() / 60;
  const top = (startHour - hourStart) * hourHeight;
  if (startHour < hourStart) return null;

  const barColor = getTaskBarColor(task) || C.accent;

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick?.(task); }}
      style={{
        position: "absolute",
        left: 48,
        right: 4,
        top,
        height: 30,
        background: C.darkSurf,
        borderLeft: `3px solid ${barColor}`,
        borderRadius: RADIUS.pill,
        padding: "5px 10px",
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
