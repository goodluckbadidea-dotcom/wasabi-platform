// ─── Week List View ───
// Vertical scrollable day list replacing the 7-column grid.
// Shows 21 days (7 past + today + 13 future), auto-scrolls to today on mount.
// Supports per-calendar colors, calendar filtering, and staggered entrance animations.

import React, { useEffect, useRef, useMemo } from "react";
import { C, FONT, RADIUS } from "../../design/tokens.js";
import { ANIM, TRANSITION } from "../../design/animations.js";
import { isSameDay, formatTime } from "../zenTaskHelpers.js";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDayLabel(date, today) {
  if (isSameDay(date, today)) return "Today";
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (isSameDay(date, tomorrow)) return "Tomorrow";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, yesterday)) return "Yesterday";
  return null;
}

function formatDateHeader(date) {
  return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}

export default function WeekListView({ selectedDate, events, tasks, onDayClick, hiddenCalendars }) {
  const scrollRef = useRef(null);
  const todayRef = useRef(null);
  const hidden = hiddenCalendars || new Set();
  const today = useMemo(() => new Date(), []);

  // Build 21-day window: 7 past + today + 13 future
  const days = useMemo(() => {
    const arr = [];
    for (let i = -7; i <= 13; i++) {
      const d = new Date(selectedDate);
      d.setDate(selectedDate.getDate() + i);
      d.setHours(0, 0, 0, 0);
      arr.push(d);
    }
    return arr;
  }, [selectedDate]);

  // Group events by day (excluding hidden calendars)
  const eventsByDay = useMemo(() => {
    const map = new Map();
    days.forEach((d) => map.set(d.toDateString(), []));
    (events || []).forEach((ev) => {
      if (hidden.has(ev.calendarId)) return;
      const evDate = ev.start?.dateTime || ev.start?.date;
      if (!evDate) return;
      const key = new Date(evDate).toDateString();
      if (map.has(key)) map.get(key).push(ev);
    });
    return map;
  }, [events, days, hidden]);

  // Group tasks by day
  const tasksByDay = useMemo(() => {
    const map = new Map();
    days.forEach((d) => map.set(d.toDateString(), []));
    (tasks || []).forEach((t) => {
      if (!t.due || t.done) return;
      const key = new Date(t.due).toDateString();
      if (map.has(key)) map.get(key).push(t);
    });
    return map;
  }, [tasks, days]);

  // Auto-scroll to today on mount
  useEffect(() => {
    setTimeout(() => {
      todayRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 100);
  }, []);

  let itemIndex = 0;

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflowY: "auto",
      }}
    >
      {days.map((date, dayIdx) => {
        const key = date.toDateString();
        const dayEvents = eventsByDay.get(key) || [];
        const dayTasks = tasksByDay.get(key) || [];
        const isToday = isSameDay(date, today);
        const isPast = date < today && !isToday;
        const relativeLabel = formatDayLabel(date, today);
        const hasItems = dayEvents.length > 0 || dayTasks.length > 0;

        return (
          <div
            key={key}
            ref={isToday ? todayRef : undefined}
            style={{
              borderBottom: `1px solid ${C.darkBorder}44`,
              opacity: isPast ? 0.5 : 1,
              animation: ANIM.scrollReveal(dayIdx),
            }}
          >
            {/* Day header */}
            <div
              onClick={() => onDayClick(date)}
              style={{
                padding: "8px 14px 4px",
                display: "flex",
                alignItems: "baseline",
                gap: 6,
                cursor: "pointer",
                transition: TRANSITION.color,
                background: isToday ? C.accent + "0A" : "transparent",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = isToday ? C.accent + "0A" : "transparent"; }}
            >
              {relativeLabel && (
                <span style={{
                  fontSize: 11, fontWeight: 700, fontFamily: FONT,
                  color: isToday ? C.accent : C.darkText,
                }}>
                  {relativeLabel}
                </span>
              )}
              {relativeLabel && (
                <span style={{
                  fontSize: 9, fontFamily: FONT, color: C.darkMuted,
                }}>
                  —
                </span>
              )}
              <span style={{
                fontSize: relativeLabel ? 10 : 11,
                fontWeight: relativeLabel ? 400 : 600,
                fontFamily: FONT,
                color: relativeLabel ? C.darkMuted : C.darkText,
              }}>
                {formatDateHeader(date)}
              </span>
            </div>

            {/* Events + Tasks */}
            <div style={{ padding: "2px 14px 8px" }}>
              {dayEvents.map((ev) => {
                const color = ev.calendarColor || C.accent;
                const isAllDay = ev.start?.date && !ev.start?.dateTime;
                const idx = itemIndex++;
                return (
                  <div
                    key={ev.id || idx}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "4px 8px", marginBottom: 3,
                      background: color + "18",
                      borderLeft: `3px solid ${color}`,
                      borderRadius: RADIUS.sm,
                      transition: TRANSITION.color,
                      animation: ANIM.scrollReveal(idx),
                      cursor: "default",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = color + "28"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = color + "18"; }}
                  >
                    <span style={{
                      fontSize: 10, fontFamily: FONT, fontWeight: 600,
                      color: C.darkText,
                      whiteSpace: "nowrap", overflow: "hidden",
                      textOverflow: "ellipsis", flex: 1,
                    }}>
                      {ev.summary || "Untitled"}
                    </span>
                    <span style={{
                      fontSize: 9, fontFamily: FONT, color: C.darkMuted,
                      flexShrink: 0,
                    }}>
                      {isAllDay ? "All day" : ev.start?.dateTime ? formatTime(ev.start.dateTime) : ""}
                    </span>
                  </div>
                );
              })}

              {dayTasks.map((t) => {
                const idx = itemIndex++;
                return (
                  <div
                    key={t.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "4px 8px", marginBottom: 3,
                      background: C.accent + "0A",
                      borderLeft: `2px dashed ${C.accent}44`,
                      borderRadius: RADIUS.sm,
                      transition: TRANSITION.color,
                      animation: ANIM.scrollReveal(idx),
                      cursor: "default",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.accent + "18"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = C.accent + "0A"; }}
                  >
                    <div style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: C.accent, flexShrink: 0, opacity: 0.7,
                    }} />
                    <span style={{
                      fontSize: 10, fontFamily: FONT,
                      color: C.darkText,
                      whiteSpace: "nowrap", overflow: "hidden",
                      textOverflow: "ellipsis", flex: 1,
                    }}>
                      {t.title}
                    </span>
                    {t.due && t.due.includes("T") && (
                      <span style={{
                        fontSize: 9, fontFamily: FONT, color: C.darkMuted,
                        flexShrink: 0,
                      }}>
                        {formatTime(t.due)}
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Empty state */}
              {!hasItems && (
                <div style={{
                  fontSize: 9, fontFamily: FONT, color: C.darkMuted,
                  opacity: 0.5, padding: "2px 8px",
                }}>
                  No events
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
