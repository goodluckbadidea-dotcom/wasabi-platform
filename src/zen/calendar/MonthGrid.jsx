// ─── Month Grid ───
// Classic 6×7 monthly calendar grid. Shows compact event pills and task dots.
// Click a day cell to drill into day view.
// Supports per-calendar colors and calendar filtering.

import React, { useMemo } from "react";
import { C, FONT, RADIUS } from "../../design/tokens.js";
import { isSameDay, getMonthRange } from "../zenTaskHelpers.js";

const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_VISIBLE_ITEMS = 2;

export default function MonthGrid({ monthDate, events, tasks, onDayClick, hiddenCalendars, onEventClick, onTaskClick }) {
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
      const key = new Date(evDate).toDateString();
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
      const key = new Date(t.due).toDateString();
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
        borderBottom: `1px solid ${C.darkBorder}`,
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
              borderRight: idx < 6 ? `1px solid ${C.darkBorder}22` : "none",
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
          const col = idx % 7;

          return (
            <div
              key={idx}
              onClick={() => onDayClick(date)}
              style={{
                padding: "3px 4px",
                borderRight: col < 6 ? `1px solid ${C.darkBorder}22` : "none",
                borderBottom: `1px solid ${C.darkBorder}22`,
                cursor: "pointer",
                overflow: "hidden",
                opacity: isCurrentMonth ? 1 : 0.35,
                background: isToday ? C.accent + "0A" : "transparent",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = isToday ? C.accent + "0A" : "transparent"; }}
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
                const color = ev.calendarColor || C.accent;
                return (
                  <div key={ev.id || i} onClick={(e) => { e.stopPropagation(); onEventClick?.(ev); }} style={{
                    padding: "1px 3px",
                    marginBottom: 1,
                    background: color + "22",
                    borderLeft: `2px solid ${color}`,
                    borderRadius: 2,
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: FONT,
                    color: C.darkText,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    lineHeight: "12px",
                    cursor: onEventClick ? "pointer" : "default",
                  }}>
                    {ev.summary || "Untitled"}
                  </div>
                );
              })}

              {/* Task dots */}
              {dayTasks.slice(0, Math.max(0, MAX_VISIBLE_ITEMS - dayEvents.length)).map((t) => (
                <div key={t.id} onClick={(e) => { e.stopPropagation(); onTaskClick?.(t); }} style={{
                  padding: "1px 3px",
                  marginBottom: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  fontSize: 10,
                  fontWeight: 500,
                  fontFamily: FONT,
                  color: C.darkMuted,
                  lineHeight: "12px",
                  cursor: onTaskClick ? "pointer" : "default",
                }}>
                  <div style={{
                    width: 4, height: 4, borderRadius: "50%",
                    background: C.accent, flexShrink: 0, opacity: 0.7,
                  }} />
                  <span style={{
                    whiteSpace: "nowrap", overflow: "hidden",
                    textOverflow: "ellipsis", flex: 1,
                  }}>
                    {t.title}
                  </span>
                </div>
              ))}

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
