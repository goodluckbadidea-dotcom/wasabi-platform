// ─── Week Grid ───
// 7-column Mon–Sun grid showing compact event pills and task dots.
// Click a day cell to drill into day view.
// Supports per-calendar colors and calendar filtering.

import React, { useMemo } from "react";
import { C, FONT, RADIUS } from "../../design/tokens.js";
import { getWeekColumns, isSameDay } from "../zenTaskHelpers.js";

const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_VISIBLE_ITEMS = 3;

export default function WeekGrid({ weekStart, events, tasks, selectedDate, onDayClick, hiddenCalendars }) {
  const columns = useMemo(() => getWeekColumns(weekStart), [weekStart]);
  const today = useMemo(() => new Date(), []);

  const hidden = hiddenCalendars || new Set();

  // Group events by day (excluding hidden calendars)
  const eventsByDay = useMemo(() => {
    const map = new Map();
    columns.forEach((col) => map.set(col.toDateString(), []));
    (events || []).forEach((ev) => {
      if (hidden.has(ev.calendarId)) return;
      const evDate = ev.start?.dateTime || ev.start?.date;
      if (!evDate) return;
      const key = new Date(evDate).toDateString();
      if (map.has(key)) map.get(key).push(ev);
    });
    return map;
  }, [events, columns, hidden]);

  // Group tasks by day
  const tasksByDay = useMemo(() => {
    const map = new Map();
    columns.forEach((col) => map.set(col.toDateString(), []));
    (tasks || []).forEach((t) => {
      if (!t.due || t.done) return;
      const key = new Date(t.due).toDateString();
      if (map.has(key)) map.get(key).push(t);
    });
    return map;
  }, [tasks, columns]);

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Header row */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
        borderBottom: `1px solid ${C.darkBorder}`,
        flexShrink: 0,
      }}>
        {columns.map((col, idx) => {
          const isToday = isSameDay(col, today);
          return (
            <div
              key={idx}
              style={{
                padding: "6px 4px",
                textAlign: "center",
                borderRight: idx < 6 ? `1px solid ${C.darkBorder}22` : "none",
                background: isToday ? C.accent + "0A" : "transparent",
              }}
            >
              <div style={{
                fontSize: 9, fontFamily: FONT, color: C.darkMuted,
                textTransform: "uppercase", letterSpacing: "0.05em",
              }}>
                {DAY_ABBR[idx]}
              </div>
              <div style={{
                fontSize: 14, fontFamily: FONT, fontWeight: 600,
                color: isToday ? C.accent : C.darkText,
                marginTop: 1,
              }}>
                {col.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Day cells */}
      <div style={{
        flex: 1, display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
        overflow: "auto",
      }}>
        {columns.map((col, idx) => {
          const key = col.toDateString();
          const dayEvents = eventsByDay.get(key) || [];
          const dayTasks = tasksByDay.get(key) || [];
          const isToday = isSameDay(col, today);
          const totalItems = dayEvents.length + dayTasks.length;
          const overflow = totalItems > MAX_VISIBLE_ITEMS;

          return (
            <div
              key={idx}
              onClick={() => onDayClick(col)}
              style={{
                padding: "4px",
                borderRight: idx < 6 ? `1px solid ${C.darkBorder}22` : "none",
                borderBottom: `1px solid ${C.darkBorder}22`,
                cursor: "pointer",
                minHeight: 80,
                background: isToday ? C.accent + "06" : "transparent",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = isToday ? C.accent + "06" : "transparent"; }}
            >
              {/* Event pills — per-calendar colors */}
              {dayEvents.slice(0, MAX_VISIBLE_ITEMS).map((ev, i) => {
                const color = ev.calendarColor || C.accent;
                return (
                  <div key={ev.id || i} style={{
                    padding: "2px 4px", marginBottom: 2,
                    background: color + "22",
                    borderLeft: `2px solid ${color}`,
                    borderRadius: 3,
                    fontSize: 9, fontFamily: FONT, color: C.darkText,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {ev.summary || "Untitled"}
                  </div>
                );
              })}

              {/* Task dots */}
              {dayTasks.slice(0, Math.max(0, MAX_VISIBLE_ITEMS - dayEvents.length)).map((t) => (
                <div key={t.id} style={{
                  padding: "2px 4px", marginBottom: 2,
                  display: "flex", alignItems: "center", gap: 4,
                  fontSize: 9, fontFamily: FONT, color: C.darkMuted,
                }}>
                  <div style={{
                    width: 5, height: 5, borderRadius: "50%",
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

              {/* Overflow indicator */}
              {overflow && (
                <div style={{
                  fontSize: 9, fontFamily: FONT, color: C.darkMuted,
                  padding: "1px 4px", opacity: 0.6,
                }}>
                  +{totalItems - MAX_VISIBLE_ITEMS} more
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
