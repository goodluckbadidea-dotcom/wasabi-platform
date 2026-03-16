// ─── Week List View ───
// Vertical scrollable day list replacing the 7-column grid.
// Shows 21 days (7 past + today + 13 future), auto-scrolls to today on mount.
// Supports per-calendar colors, calendar filtering, and staggered entrance animations.

import React, { useEffect, useRef, useMemo } from "react";
import { C, FONT, RADIUS, isLightColor, VIEW_PALETTE, getSolidPillColor, mapCalendarColor } from "../../design/tokens.js";
import { ANIM, TRANSITION } from "../../design/animations.js";
import { isSameDay, formatTime, parseDate } from "../zenTaskHelpers.js";

// Priority → palette index mapping
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

export default function WeekListView({ selectedDate, events, tasks, onDayClick, hiddenCalendars, calendarColorMap, onEventClick, onTaskClick }) {
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
      const key = parseDate(evDate).toDateString();
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
      const key = parseDate(t.due).toDateString();
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
                padding: "10px 14px 6px",
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
                  fontSize: 13, fontWeight: 700, fontFamily: FONT,
                  color: isToday ? C.accent : C.darkText,
                }}>
                  {relativeLabel}
                </span>
              )}
              {relativeLabel && (
                <span style={{
                  fontSize: 10, fontFamily: FONT, color: C.darkMuted,
                }}>
                  —
                </span>
              )}
              <span style={{
                fontSize: relativeLabel ? 11 : 13,
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
                const calName = ev.calendarName || ev.calendarId;
                const color = (calendarColorMap && calName && calendarColorMap[calName]) || mapCalendarColor(ev.calendarColor) || C.accent;
                const isAllDay = ev.start?.date && !ev.start?.dateTime;
                const idx = itemIndex++;
                return isAllDay ? (
                  <div
                    key={ev.id || idx}
                    onClick={(e) => { e.stopPropagation(); onEventClick?.(ev); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "7px 12px", marginBottom: 4,
                      background: color,
                      borderRadius: RADIUS.lg,
                      animation: ANIM.scrollReveal(idx),
                      cursor: onEventClick ? "pointer" : "default",
                    }}
                  >
                    <span style={{
                      fontSize: 12, fontFamily: FONT, fontWeight: 600,
                      color: isLightColor(color) ? "#1a1a1a" : "#fff",
                      whiteSpace: "nowrap", overflow: "hidden",
                      textOverflow: "ellipsis", flex: 1,
                    }}>
                      {ev.summary || "Untitled"}
                    </span>
                    <span style={{
                      fontSize: 11, fontFamily: FONT,
                      color: isLightColor(color) ? "#1a1a1a99" : "#ffffffaa",
                      flexShrink: 0,
                    }}>
                      All day
                    </span>
                  </div>
                ) : (
                  <div
                    key={ev.id || idx}
                    onClick={(e) => { e.stopPropagation(); onEventClick?.(ev); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "7px 12px", marginBottom: 4,
                      background: C.darkSurf,
                      borderLeft: `3px solid ${color}`,
                      borderRadius: RADIUS.lg,
                      transition: "background 0.15s ease",
                      animation: ANIM.scrollReveal(idx),
                      cursor: onEventClick ? "pointer" : "default",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf; }}
                  >
                    <span style={{
                      fontSize: 12, fontFamily: FONT, fontWeight: 600,
                      color: C.darkText,
                      whiteSpace: "nowrap", overflow: "hidden",
                      textOverflow: "ellipsis", flex: 1,
                    }}>
                      {ev.summary || "Untitled"}
                    </span>
                    <span style={{
                      fontSize: 11, fontFamily: FONT, color: C.darkMuted,
                      flexShrink: 0,
                    }}>
                      {ev.start?.dateTime ? formatTime(ev.start.dateTime) : ""}
                    </span>
                  </div>
                );
              })}

              {dayTasks.map((t) => {
                const idx = itemIndex++;
                const barColor = getTaskBarColor(t) || C.accent;
                return (
                  <div
                    key={t.id}
                    onClick={(e) => { e.stopPropagation(); onTaskClick?.(t); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "7px 12px", marginBottom: 4,
                      background: C.darkSurf,
                      borderLeft: `3px solid ${barColor}`,
                      borderRadius: RADIUS.lg,
                      transition: "background 0.15s ease",
                      animation: ANIM.scrollReveal(idx),
                      cursor: onTaskClick ? "pointer" : "default",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf; }}
                  >
                    <span style={{
                      fontSize: 12, fontFamily: FONT, fontWeight: 600,
                      color: C.darkText,
                      whiteSpace: "nowrap", overflow: "hidden",
                      textOverflow: "ellipsis", flex: 1,
                    }}>
                      {t.title}
                    </span>
                    {t.due && t.due.includes("T") && (
                      <span style={{
                        fontSize: 11, fontFamily: FONT, color: C.darkMuted,
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
                  fontSize: 10, fontFamily: FONT, color: C.darkMuted,
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
