// ─── Zen Calendar ───
// Smart calendar for the Zen split view. Replaces TodaySchedule.
// Supports day, week, and month views with Google Calendar events + task due dates.
// Fetches events from ALL connected Google calendars with per-calendar colors.
// Includes a filter dropdown to toggle individual calendars on/off.

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { getGoogleStatus, listCalendarEvents } from "../lib/api.js";
import { isSameDay, getWeekRange, getMonthRange, formatWeekDateHeader, formatMonthHeader } from "./zenTaskHelpers.js";
import DayColumn from "./calendar/DayColumn.jsx";
import WeekGrid from "./calendar/WeekGrid.jsx";
import MonthGrid from "./calendar/MonthGrid.jsx";
import QuickCreateBar from "./calendar/QuickCreateBar.jsx";
import CalendarFilterDropdown from "./calendar/CalendarFilterDropdown.jsx";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HIDDEN_KEY = "wasabi-zen-hidden-calendars";

function formatDayHeader(date) {
  return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}

function loadHiddenCalendars() {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveHiddenCalendars(set) {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set]));
}

export default function ZenCalendar({ allTasks }) {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState("day"); // "day" | "week" | "month"
  const [googleConnected, setGoogleConnected] = useState(false);
  const [events, setEvents] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [hiddenCalendars, setHiddenCalendars] = useState(() => loadHiddenCalendars());
  const [loading, setLoading] = useState(true);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [error, setError] = useState(null); // "auth" | "fetch" | null

  const today = useMemo(() => new Date(), []);
  const isViewingToday = isSameDay(selectedDate, today);

  // Compute the fetch range based on view mode
  const fetchRange = useMemo(() => {
    if (viewMode === "month") return getMonthRange(selectedDate);
    return getWeekRange(selectedDate); // day + week both use week range
  }, [selectedDate, viewMode]);

  // Week range (used by WeekGrid — always available)
  const weekRange = useMemo(() => getWeekRange(selectedDate), [selectedDate]);

  // ── Fetch Google Calendar data (with retry) ──
  useEffect(() => {
    let cancelled = false;
    async function load(attempt = 0) {
      setLoading(true);
      setError(null);
      try {
        const status = await getGoogleStatus();
        if (cancelled) return;
        setGoogleConnected(!!status?.connected);

        if (status?.connected) {
          const maxResults = viewMode === "month" ? 250 : 50;
          const result = await listCalendarEvents(
            fetchRange.start.toISOString(),
            fetchRange.end.toISOString(),
            maxResults
          );
          if (cancelled) return;
          setEvents(result.events || result.items || []);
          if (result.calendars?.length) {
            setCalendars(result.calendars);
          }
        }
      } catch (err) {
        console.error("[ZenCalendar] Failed to load:", err);
        if (cancelled) return;

        if (attempt === 0) {
          setTimeout(() => { if (!cancelled) load(1); }, 2000);
          return;
        }

        const isAuth = err?.status === 401 || err?.message?.includes("auth");
        setError(isAuth ? "auth" : "fetch");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [fetchRange]);

  // ── Navigation ──
  const goToday = useCallback(() => setSelectedDate(new Date()), []);

  const goPrev = useCallback(() => {
    setSelectedDate((prev) => {
      const d = new Date(prev);
      if (viewMode === "month") {
        d.setMonth(d.getMonth() - 1);
      } else {
        d.setDate(d.getDate() - (viewMode === "week" ? 7 : 1));
      }
      return d;
    });
  }, [viewMode]);

  const goNext = useCallback(() => {
    setSelectedDate((prev) => {
      const d = new Date(prev);
      if (viewMode === "month") {
        d.setMonth(d.getMonth() + 1);
      } else {
        d.setDate(d.getDate() + (viewMode === "week" ? 7 : 1));
      }
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

  // ── Calendar filter toggle ──
  const handleToggleCalendar = useCallback((calendarId) => {
    setHiddenCalendars((prev) => {
      const next = new Set(prev);
      if (next.has(calendarId)) {
        next.delete(calendarId);
      } else {
        next.add(calendarId);
      }
      saveHiddenCalendars(next);
      return next;
    });
  }, []);

  // ── Date label ──
  const dateLabel = viewMode === "month"
    ? formatMonthHeader(selectedDate)
    : viewMode === "day"
      ? formatDayHeader(selectedDate)
      : formatWeekDateHeader(weekRange.start, weekRange.end);

  // Count visible calendars for badge
  const visibleCount = calendars.length - hiddenCalendars.size;
  const hasFilters = hiddenCalendars.size > 0;

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
        position: "relative",
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

        {/* Calendar filter button (only if we have calendars) */}
        {calendars.length > 1 && (
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setFilterOpen((v) => !v)}
              title="Filter calendars"
              style={{
                ...navBtnStyle,
                opacity: filterOpen ? 1 : 0.5,
                background: filterOpen ? C.accent + "22" : "transparent",
                position: "relative",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1.5 3H10.5M3 6H9M4.5 9H7.5" stroke={filterOpen ? C.accent : C.darkMuted} strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              {/* Active filter indicator */}
              {hasFilters && (
                <div style={{
                  position: "absolute", top: 0, right: 0,
                  width: 6, height: 6, borderRadius: "50%",
                  background: C.accent,
                }} />
              )}
            </button>
            {filterOpen && (
              <CalendarFilterDropdown
                calendars={calendars}
                hiddenCalendars={hiddenCalendars}
                onToggle={handleToggleCalendar}
                onClose={() => setFilterOpen(false)}
              />
            )}
          </div>
        )}

        {/* View toggle: Day | Week | Month */}
        <div style={{
          display: "flex", borderRadius: RADIUS.md,
          border: `1px solid ${C.darkBorder}`,
          overflow: "hidden",
        }}>
          {["day", "week", "month"].map((mode, i) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                background: viewMode === mode ? C.darkSurf2 : "transparent",
                border: "none", cursor: "pointer",
                padding: "3px 8px",
                fontSize: 10, fontFamily: FONT,
                color: viewMode === mode ? C.darkText : C.darkMuted,
                fontWeight: viewMode === mode ? 600 : 400,
                outline: "none",
                borderRight: i < 2 ? `1px solid ${C.darkBorder}` : "none",
              }}
            >
              {mode === "day" ? "D" : mode === "week" ? "W" : "M"}
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
          hiddenCalendars={hiddenCalendars}
        />
      ) : viewMode === "week" ? (
        <WeekGrid
          weekStart={weekRange.start}
          events={events}
          tasks={allTasks}
          selectedDate={selectedDate}
          onDayClick={handleDayClick}
          hiddenCalendars={hiddenCalendars}
        />
      ) : (
        <MonthGrid
          monthDate={selectedDate}
          events={events}
          tasks={allTasks}
          onDayClick={handleDayClick}
          hiddenCalendars={hiddenCalendars}
        />
      )}

      {/* ── Status banners ── */}
      {!loading && error === "auth" && (
        <div style={{
          flexShrink: 0, padding: "6px 12px",
          borderTop: `1px solid ${C.darkBorder}`,
          fontSize: 9, fontFamily: FONT, color: "#E05252",
          textAlign: "center",
        }}>
          Google session expired — reconnect in Settings
        </div>
      )}
      {!loading && error === "fetch" && (
        <div style={{
          flexShrink: 0, padding: "6px 12px",
          borderTop: `1px solid ${C.darkBorder}`,
          fontSize: 9, fontFamily: FONT, color: "#E0A030",
          textAlign: "center",
        }}>
          Failed to load calendar events — will retry on next navigation
        </div>
      )}
      {!loading && !googleConnected && !error && (
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
