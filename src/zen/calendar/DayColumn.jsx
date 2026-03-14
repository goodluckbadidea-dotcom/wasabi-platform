// ─── Day Column ───
// Renders a single day's hour grid (7 AM – 10 PM) with events and tasks.
// Used by the day view in ZenCalendar. Includes current time indicator.
// Supports per-calendar colors and calendar filtering.

import React, { useEffect, useRef, useMemo } from "react";
import { C, FONT } from "../../design/tokens.js";
import { isSameDay, formatHour } from "../zenTaskHelpers.js";
import CalendarEventBlock from "./CalendarEventBlock.jsx";
import CalendarTaskBlock from "./CalendarTaskBlock.jsx";

const HOUR_START = 7;
const HOUR_END = 22;
const HOUR_HEIGHT = 48;

export default function DayColumn({ date, events, tasks, isToday: isTodayProp, hiddenCalendars, onEventClick, onTaskClick }) {
  const nowLineRef = useRef(null);
  const scrollRef = useRef(null);

  const hidden = hiddenCalendars || new Set();

  // Determine if this column is "today"
  const showNow = isTodayProp !== undefined ? isTodayProp : isSameDay(date, new Date());

  // Filter events for this day (excluding hidden calendars)
  const dayEvents = useMemo(() => {
    if (!events?.length) return [];
    return events.filter((ev) => {
      if (hidden.has(ev.calendarId)) return false;
      const evDate = ev.start?.dateTime || ev.start?.date;
      return evDate && isSameDay(evDate, date);
    });
  }, [events, date, hidden]);

  // Filter tasks with due dates on this day
  const dayTasks = useMemo(() => {
    if (!tasks?.length) return [];
    return tasks.filter((t) => t.due && !t.done && isSameDay(t.due, date));
  }, [tasks, date]);

  // Tasks with time → positioned on grid; date-only → "Due" section
  const timedTasks = useMemo(
    () => dayTasks.filter((t) => t.due && t.due.includes("T")),
    [dayTasks]
  );
  const dateOnlyTasks = useMemo(
    () => dayTasks.filter((t) => !t.due || !t.due.includes("T")),
    [dayTasks]
  );

  // All-day events (excluding hidden calendars)
  const allDayEvents = useMemo(() => {
    if (!events?.length) return [];
    return events.filter((ev) => {
      if (hidden.has(ev.calendarId)) return false;
      if (ev.start?.date && !ev.start?.dateTime) {
        return isSameDay(ev.start.date, date);
      }
      return false;
    });
  }, [events, date, hidden]);

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (showNow && nowLineRef.current) {
      setTimeout(() => {
        nowLineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 100);
    }
  }, [showNow]);

  const now = new Date();

  return (
    <div ref={scrollRef} style={{ flex: 1, overflowY: "auto" }}>
      {/* All-day events + date-only tasks */}
      {(allDayEvents.length > 0 || dateOnlyTasks.length > 0) && (
        <div style={{
          padding: "6px 12px",
          borderBottom: `1px solid ${C.darkBorder}`,
        }}>
          {allDayEvents.length > 0 && (
            <div style={{ marginBottom: dateOnlyTasks.length > 0 ? 4 : 0 }}>
              {allDayEvents.map((ev) => {
                const color = ev.calendarColor || C.accent;
                return (
                  <div key={ev.id} onClick={() => onEventClick?.(ev)} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "3px 6px", marginBottom: 2,
                    background: color + "22",
                    borderLeft: `3px solid ${color}`,
                    borderRadius: 4,
                    fontSize: 12, fontFamily: FONT, color: C.darkText,
                    cursor: onEventClick ? "pointer" : "default",
                  }}>
                    <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ev.summary || "Untitled"}
                    </span>
                    <span style={{ fontSize: 10, color: C.darkMuted, flexShrink: 0 }}>All day</span>
                  </div>
                );
              })}
            </div>
          )}
          {dateOnlyTasks.length > 0 && (
            <div>
              <div style={{
                fontSize: 10, fontFamily: FONT, fontWeight: 600,
                color: C.darkMuted, letterSpacing: "0.06em",
                textTransform: "uppercase", marginBottom: 4,
              }}>
                Due
              </div>
              {dateOnlyTasks.map((task) => (
                <div key={task.id} onClick={() => onTaskClick?.(task)} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "3px 0", fontSize: 12, fontFamily: FONT, color: C.darkText, fontWeight: 500,
                  cursor: onTaskClick ? "pointer" : "default",
                }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: C.accent, flexShrink: 0,
                  }} />
                  <span style={{
                    whiteSpace: "nowrap", overflow: "hidden",
                    textOverflow: "ellipsis", flex: 1,
                  }}>
                    {task.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Hour grid */}
      <div style={{ position: "relative", padding: "0 12px" }}>
        {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => {
          const hour = HOUR_START + i;
          return (
            <div
              key={hour}
              style={{
                height: HOUR_HEIGHT,
                borderBottom: `1px solid ${C.darkBorder}22`,
                display: "flex",
                alignItems: "flex-start",
                paddingTop: 4,
                position: "relative",
              }}
            >
              <span style={{
                fontSize: 11, fontFamily: FONT, color: C.darkMuted,
                width: 44, flexShrink: 0, opacity: 0.7, fontWeight: 500,
              }}>
                {formatHour(hour)}
              </span>
            </div>
          );
        })}

        {/* Current time indicator */}
        {showNow && now.getHours() >= HOUR_START && now.getHours() < HOUR_END && (
          <div
            ref={nowLineRef}
            style={{
              position: "absolute",
              left: 44,
              right: 0,
              top: ((now.getHours() - HOUR_START) + now.getMinutes() / 60) * HOUR_HEIGHT,
              height: 2,
              background: "#E05252",
              borderRadius: 1,
              zIndex: 5,
            }}
          >
            <div style={{
              position: "absolute", left: -4, top: -3,
              width: 8, height: 8, borderRadius: "50%",
              background: "#E05252",
            }} />
          </div>
        )}

        {/* Google Calendar event blocks */}
        {dayEvents.filter((ev) => ev.start?.dateTime).map((event, idx) => (
          <CalendarEventBlock
            key={event.id || idx}
            event={event}
            hourHeight={HOUR_HEIGHT}
            hourStart={HOUR_START}
            onClick={onEventClick}
          />
        ))}

        {/* Task blocks (timed) */}
        {timedTasks.map((task) => (
          <CalendarTaskBlock
            key={task.id}
            task={task}
            hourHeight={HOUR_HEIGHT}
            hourStart={HOUR_START}
            onClick={onTaskClick}
          />
        ))}
      </div>
    </div>
  );
}
