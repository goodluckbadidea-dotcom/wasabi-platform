// ─── Zen Calendar ───
// Smart calendar for the Zen split view. Replaces TodaySchedule.
// Supports day and week views with Google Calendar events + task due dates.

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { getGoogleStatus, listCalendarEvents } from "../lib/api.js";
import { isSameDay, getWeekRange, formatWeekDateHeader } from "./zenTaskHelpers.js";
import DayColumn from "./calendar/DayColumn.jsx";
import WeekGrid from "./calendar/WeekGrid.jsx";
import QuickCreateBar from "./calendar/QuickCreateBar.jsx";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDayHeader(date) {
  return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}

export default function ZenCalendar({ allTasks }) {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState("day"); // "day" | "week"
  const [googleConnected, setGoogleConnected] = useState(false);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  const today = useMemo(() => new Date(), []);
  const isViewingToday = isSameDay(selectedDate, today);

  // Compute the week range for the selected date (always fetched for instant toggle)
  const weekRange = useMemo(() => getWeekRange(selectedDate), [selectedDate]);

  // ── Fetch Google Calendar data ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const status = await getGoogleStatus();
        if (cancelled) return;
        setGoogleConnected(!!status?.connected);

        if (status?.connected) {
          // Always fetch the full week range for instant day↔week toggle
          const result = await listCalendarEvents(
            weekRange.start.toISOString(),
            weekRange.end.toISOString(),
            50
          );
          if (cancelled) return;
          setEvents(result.events || result.items || []);
        }
      } catch (err) {
        console.error("[ZenCalendar] Failed to load:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [weekRange]);

  // ── Navigation ──
  const goToday = useCallback(() => setSelectedDate(new Date()), []);

  const goPrev = useCallback(() => {
    setSelectedDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - (viewMode === "week" ? 7 : 1));
      return d;
    });
  }, [viewMode]);

  const goNext = useCallback(() => {
    setSelectedDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + (viewMode === "week" ? 7 : 1));
      return d;
    });
  }, [viewMode]);

  const handleDayClick = useCallback((date) => {
    setSelectedDate(date);
    setViewMode("day");
  }, []);

  // ── Event created callback ──
  const handleEventCreated = useCallback((newEvent) => {
    setEvents((prev) => [...prev, newEvent]);
    setQuickCreateOpen(false);
  }, []);

  // ── Date label ──
  const dateLabel = viewMode === "day"
    ? formatDayHeader(selectedDate)
    : formatWeekDateHeader(weekRange.start, weekRange.end);

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100%", overflow: "hidden",
    }}>
      {/* ── Header ── */}
      <div style={{
        flexShrink: 0, height: 44, padding: "0 14px",
        borderBottom: `1px solid ${C.darkBorder}`,
        display: "flex", alignItems: "center", gap: 6,
      }}>
        {/* Nav arrows + Today */}
        <button onClick={goPrev} style={navBtnStyle} title="Previous">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M6.5 2L3.5 5L6.5 8" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={goToday}
          style={{
            ...navBtnStyle,
            fontSize: 10, fontFamily: FONT, color: C.darkMuted,
            padding: "2px 6px", opacity: isViewingToday ? 0.4 : 0.7,
          }}
        >
          Today
        </button>
        <button onClick={goNext} style={navBtnStyle} title="Next">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M3.5 2L6.5 5L3.5 8" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Date label */}
        <div style={{
          flex: 1, fontSize: 12, fontWeight: 600,
          fontFamily: FONT, color: C.darkText, marginLeft: 4,
        }}>
          {dateLabel}
        </div>

        {/* View toggle: Day | Week */}
        <div style={{
          display: "flex", borderRadius: RADIUS.md,
          border: `1px solid ${C.darkBorder}`,
          overflow: "hidden",
        }}>
          {["day", "week"].map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                background: viewMode === mode ? C.darkSurf2 : "transparent",
                border: "none", cursor: "pointer",
                padding: "3px 10px",
                fontSize: 10, fontFamily: FONT,
                color: viewMode === mode ? C.darkText : C.darkMuted,
                fontWeight: viewMode === mode ? 600 : 400,
                outline: "none",
                borderRight: mode === "day" ? `1px solid ${C.darkBorder}` : "none",
              }}
            >
              {mode === "day" ? "Day" : "Week"}
            </button>
          ))}
        </div>

        {/* Quick create button (only if Google connected) */}
        {googleConnected && (
          <button
            onClick={() => setQuickCreateOpen((v) => !v)}
            title="Create event"
            style={{
              ...navBtnStyle,
              opacity: quickCreateOpen ? 1 : 0.5,
              background: quickCreateOpen ? C.accent + "22" : "transparent",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 2V10M2 6H10" stroke={quickCreateOpen ? C.accent : C.darkMuted} strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Quick Create Bar ── */}
      {quickCreateOpen && googleConnected && (
        <QuickCreateBar
          selectedDate={selectedDate}
          onCreated={handleEventCreated}
          onClose={() => setQuickCreateOpen(false)}
        />
      )}

      {/* ── Content ── */}
      {loading ? (
        <div style={{ flex: 1, padding: "12px" }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{
              height: 36, borderRadius: RADIUS.md, marginBottom: 6,
              background: C.darkSurf2, opacity: 0.4,
              animation: "pulse 1.5s ease infinite",
            }} />
          ))}
        </div>
      ) : viewMode === "day" ? (
        <DayColumn
          date={selectedDate}
          events={events}
          tasks={allTasks}
          isToday={isViewingToday}
        />
      ) : (
        <WeekGrid
          weekStart={weekRange.start}
          events={events}
          tasks={allTasks}
          selectedDate={selectedDate}
          onDayClick={handleDayClick}
        />
      )}

      {/* ── Google not connected banner ── */}
      {!loading && !googleConnected && (
        <div style={{
          flexShrink: 0, padding: "6px 12px",
          borderTop: `1px solid ${C.darkBorder}`,
          fontSize: 9, fontFamily: FONT, color: C.darkMuted,
          opacity: 0.6, textAlign: "center",
        }}>
          Connect Google Calendar in Settings for events
        </div>
      )}
    </div>
  );
}

// ── Shared nav button style ──
const navBtnStyle = {
  background: "none", border: "none", cursor: "pointer",
  padding: 4, display: "flex", alignItems: "center", justifyContent: "center",
  borderRadius: RADIUS.md, outline: "none",
  transition: "opacity 0.15s",
};
