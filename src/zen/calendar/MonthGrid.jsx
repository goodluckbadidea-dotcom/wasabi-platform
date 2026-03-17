// ─── Month Grid ───
// Classic 6×7 monthly calendar grid. Shows compact event pills and task dots.
// Click a day cell to drill into day view.
// Supports per-calendar colors and calendar filtering.

import React, { useMemo } from "react";
import { C, FONT, RADIUS, isLightColor, VIEW_PALETTE, getSolidPillColor, mapCalendarColor } from "../../design/tokens.js";
import { isSameDay, getMonthRange, parseDate } from "../taskHelpers.js";

// Priority → palette index
const PRIORITY_IDX = { High: 9, Medium: 3, Normal: 4, Low: 6 };

function getTaskBarColor(t) {
  if (t.status) {
    const opts = (t._statusOptions || []).map((o) => o.name);
    const pill = getSolidPillColor(t.status, opts, t._statusOptions || []);
    return pill?.fill || null;
  }
  const idx = PRIORITY_IDX[t.priority];
  return idx !== undefined ? VIEW_PALETTE[idx].hex : null;
}

const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_VISIBLE_ITEMS = 2;

export default function MonthGrid({ monthDate, events, tasks, onDayClick, hiddenCalendars, calendarColorMap, onEventClick, onTaskClick }) {
  const hidden = hiddenCalendars || new Set();
  const today = useMemo(() => new Date(), []);
  const currentMonth = monthDate.getMonth();

  // Build 42 day cells (6 weeks)
  const { start } = useMemo(() => getMonthRange(monthDate), [monthDate]);
  const cells = useMemo(() => {
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [start]);

  // Group events by day (excluding hidden calendars)
  const eventsByDay = useMemo(() => {
    const map = new Map();
    cells.forEach((c) => map.set(c.toDateString(), []));
    (events || []).forEach((ev) => {
      if (hidden.has(ev.calendarId)) return;
      const evDate = ev.start?.dateTime || ev.start?.date;
      if (!evDate) return;
      const key = parseDate(evDate).toDateString();
      if (map.has(key)) map.get(key).push(ev);
    });
    return map;
  }, [events, cells, hidden]);

  // Group tasks by day
  const tasksByDay = useMemo(() => {
    const map = new Map();
    cells.forEach((c) => map.set(c.toDateString(), []));
    (tasks || []).forEach((t) => {
      if (!t.due || t.done) return;
      const key = parseDate(t.due).toDateString();
      if (map.has(key)) map.get(key).push(t);
    });
    return map;
  }, [tasks, cells]);

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Header row — Mon–Sun */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
        gap: 3,
        borderBottom: "none",
        paddingBottom: 2,
        flexShrink: 0,
      }}>
        {DAY_ABBR.map((day, idx) => (
          <div
            key={day}
            style={{
              padding: "6px 4px",
              textAlign: "center",
              fontSize: 10,
              fontWeight: 600,
              fontFamily: FONT,
              color: C.darkMuted,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day cells — 6 rows × 7 columns */}
      <div style={{
        flex: 1, display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gridTemplateRows: "repeat(6, 1fr)",
        gap: 3,
        padding: 2,
        overflow: "hidden",
      }}>
        {cells.map((date, idx) => {
          const key = date.toDateString();
          const dayEvents = eventsByDay.get(key) || [];
          const dayTasks = tasksByDay.get(key) || [];
          const isToday = isSameDay(date, today);
          const isCurrentMonth = date.getMonth() === currentMonth;
          const totalItems = dayEvents.length + dayTasks.length;
          const overflow = totalItems > MAX_VISIBLE_ITEMS;
          return (
            <div
              key={idx}
              onClick={() => onDayClick(date)}
              style={{
                padding: "3px 4px",
                borderRadius: RADIUS.lg,
                cursor: "pointer",
                overflow: "hidden",
                opacity: isCurrentMonth ? 1 : 0.35,
                background: isToday ? C.accent + "0A" : C.darkSurf,
                transition: "background 0.15s ease, transform 0.15s ease",
                transform: "scale(1)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = C.darkSurf2;
                e.currentTarget.style.transform = "scale(1.02)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isToday ? C.accent + "0A" : C.darkSurf;
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              {/* Date number */}
              <div style={{
                fontSize: 10,
                fontFamily: FONT,
                fontWeight: isToday ? 700 : 400,
                color: isToday ? C.accent : C.darkText,
                marginBottom: 2,
                textAlign: "right",
                paddingRight: 2,
              }}>
                {date.getDate()}
              </div>

              {/* Event pills */}
              {dayEvents.slice(0, MAX_VISIBLE_ITEMS).map((ev, i) => {
                const calName = ev.calendarName || ev.calendarId;
                const color = (calendarColorMap && calName && calendarColorMap[calName]) || mapCalendarColor(ev.calendarColor) || C.accent;
                const isAllDay = ev.start?.date && !ev.start?.dateTime;
                return isAllDay ? (
                  <div key={ev.id || i} onClick={(e) => { e.stopPropagation(); onEventClick?.(ev); }} style={{
                    padding: "2px 6px",
                    marginBottom: 2,
                    background: color,
                    borderRadius: RADIUS.sm,
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: FONT,
                    color: isLightColor(color) ? "#1a1a1a" : "#fff",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    lineHeight: "16px",
                    cursor: onEventClick ? "pointer" : "default",
                  }}>
                    {ev.summary || "Untitled"}
                  </div>
                ) : (
                  <div key={ev.id || i} onClick={(e) => { e.stopPropagation(); onEventClick?.(ev); }} style={{
                    padding: "2px 6px",
                    marginBottom: 2,
                    background: C.darkSurf2,
                    borderLeft: `2px solid ${color}`,
                    borderRadius: RADIUS.sm,
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: FONT,
                    color: C.darkText,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    lineHeight: "16px",
                    cursor: onEventClick ? "pointer" : "default",
                  }}>
                    {ev.summary || "Untitled"}
                  </div>
                );
              })}

              {/* Task pills */}
              {dayTasks.slice(0, Math.max(0, MAX_VISIBLE_ITEMS - dayEvents.length)).map((t) => {
                const barColor = getTaskBarColor(t) || C.accent;
                return (
                  <div key={t.id} onClick={(e) => { e.stopPropagation(); onTaskClick?.(t); }} style={{
                    padding: "2px 6px",
                    marginBottom: 2,
                    background: C.darkSurf2,
                    borderLeft: `2px solid ${barColor}`,
                    borderRadius: RADIUS.sm,
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: FONT,
                    color: C.darkText,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    lineHeight: "16px",
                    cursor: onTaskClick ? "pointer" : "default",
                  }}>
                    {t.title}
                  </div>
                );
              })}

              {/* Overflow */}
              {overflow && (
                <div style={{
                  fontSize: 9, fontFamily: FONT, color: C.darkMuted,
                  padding: "0 3px", opacity: 0.6, lineHeight: "12px",
                }}>
                  +{totalItems - MAX_VISIBLE_ITEMS}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
