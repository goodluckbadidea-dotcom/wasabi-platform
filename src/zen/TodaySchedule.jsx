// ─── Today Schedule ───
// Right panel of the Zen Tasks split view.
// Shows today's Google Calendar events in a compact hour grid.
// Falls back to a "connect" prompt if Google Calendar is not available.

import React, { useState, useEffect, useRef } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { getGoogleStatus, listCalendarEvents } from "../lib/api.js";
import { isToday } from "./zenTaskHelpers.js";

// ── Constants ──
const HOUR_START = 7;
const HOUR_END = 22;
const HOUR_HEIGHT = 48;

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatHour(h) {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

export default function TodaySchedule({ todayTasks }) {
  const [googleConnected, setGoogleConnected] = useState(false);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const nowLineRef = useRef(null);

  // Check Google status and fetch events
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const status = await getGoogleStatus();
        if (cancelled) return;
        setGoogleConnected(!!status?.connected);

        if (status?.connected) {
          const now = new Date();
          const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
          const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
          const result = await listCalendarEvents(dayStart, dayEnd, 30);
          if (cancelled) return;
          setEvents(result.events || result.items || []);
        }
      } catch (err) {
        console.error("[TodaySchedule] Failed to load:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Scroll to current time on mount
  useEffect(() => {
    if (nowLineRef.current) {
      nowLineRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [loading]);

  const now = new Date();
  const dayLabel = now.toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric",
  });

  // Tasks due today
  const tasksDueToday = (todayTasks || []).filter((t) => t.due && isToday(t.due) && !t.done);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, padding: "12px 14px",
        borderBottom: `1px solid ${C.darkBorder}`,
      }}>
        <div style={{
          fontSize: 13, fontWeight: 600, fontFamily: FONT, color: C.darkText,
        }}>
          Today
        </div>
        <div style={{
          fontSize: 11, fontFamily: FONT, color: C.darkMuted, marginTop: 2,
        }}>
          {dayLabel}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0" }}>

        {/* Tasks due today */}
        {tasksDueToday.length > 0 && (
          <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.darkBorder}` }}>
            <div style={{
              fontSize: 10, fontFamily: FONT, fontWeight: 600,
              color: C.darkMuted, letterSpacing: "0.06em",
              textTransform: "uppercase", marginBottom: 6,
            }}>
              Due Today
            </div>
            {tasksDueToday.map((task) => (
              <div key={task.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "4px 0", fontSize: 11, fontFamily: FONT, color: C.darkText,
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

        {/* Calendar grid or connect prompt */}
        {!googleConnected && !loading ? (
          <div style={{
            padding: "40px 20px", textAlign: "center",
            color: C.darkMuted, fontFamily: FONT,
          }}>
            <svg width="28" height="28" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.3, marginBottom: 8 }}>
              <rect x="2" y="3" width="12" height="11" rx="1.5" stroke={C.darkMuted} strokeWidth="1.2" fill="none" />
              <line x1="2" y1="6" x2="14" y2="6" stroke={C.darkMuted} strokeWidth="1" />
              <line x1="5" y1="2" x2="5" y2="4" stroke={C.darkMuted} strokeWidth="1.2" strokeLinecap="round" />
              <line x1="11" y1="2" x2="11" y2="4" stroke={C.darkMuted} strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <div style={{ fontSize: 12, marginBottom: 4 }}>No calendar connected</div>
            <div style={{ fontSize: 10, opacity: 0.6 }}>
              Connect Google Calendar in Settings
            </div>
          </div>
        ) : loading ? (
          // Loading skeleton
          <div style={{ padding: "12px" }}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} style={{
                height: 36, borderRadius: RADIUS.md, marginBottom: 6,
                background: C.darkSurf2, opacity: 0.4,
                animation: "pulse 1.5s ease infinite",
              }} />
            ))}
          </div>
        ) : (
          // Hour grid
          <div style={{ position: "relative", padding: "0 12px" }}>
            {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => {
              const hour = HOUR_START + i;
              const isNowHour = now.getHours() === hour;

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
                    fontSize: 9, fontFamily: FONT, color: C.darkMuted,
                    width: 44, flexShrink: 0, opacity: 0.7,
                  }}>
                    {formatHour(hour)}
                  </span>
                </div>
              );
            })}

            {/* Current time indicator */}
            {now.getHours() >= HOUR_START && now.getHours() < HOUR_END && (
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

            {/* Event blocks */}
            {events.map((event, idx) => {
              const start = event.start?.dateTime ? new Date(event.start.dateTime) : null;
              const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
              if (!start) return null;

              const startHour = start.getHours() + start.getMinutes() / 60;
              const endHour = end ? end.getHours() + end.getMinutes() / 60 : startHour + 1;
              const top = (startHour - HOUR_START) * HOUR_HEIGHT;
              const height = Math.max((endHour - startHour) * HOUR_HEIGHT, 20);

              if (startHour < HOUR_START || startHour >= HOUR_END) return null;

              return (
                <div
                  key={event.id || idx}
                  style={{
                    position: "absolute",
                    left: 48,
                    right: 4,
                    top,
                    height,
                    background: C.accent + "22",
                    border: `1px solid ${C.accent}44`,
                    borderLeft: `3px solid ${C.accent}`,
                    borderRadius: RADIUS.md,
                    padding: "3px 6px",
                    fontSize: 10,
                    fontFamily: FONT,
                    color: C.darkText,
                    overflow: "hidden",
                    zIndex: 2,
                  }}
                >
                  <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {event.summary || "Untitled"}
                  </div>
                  <div style={{ fontSize: 9, color: C.darkMuted, marginTop: 1 }}>
                    {formatTime(event.start.dateTime)}
                    {end ? ` – ${formatTime(event.end.dateTime)}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
