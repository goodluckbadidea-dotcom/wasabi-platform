// ─── Calendar View ───
// Smart calendar for the tasks split view. Replaces TodaySchedule.
// Supports day, week, and month views with Google Calendar events + task due dates.
// Fetches events from ALL connected Google calendars with per-calendar colors.
// Includes a filter dropdown to toggle individual calendars on/off.

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { C, FONT, RADIUS, VIEW_PALETTE } from "../design/tokens.js";
import { DAY_NAMES, MONTH_NAMES } from "../utils/helpers.js";
import { IconEdit } from "../design/icons.jsx";
import { getGoogleStatus, listCalendarEvents, getMicrosoftStatus, listOutlookEvents } from "../lib/api.js";
import { isSameDay, getWeekRange, getMonthRange, getListViewRange, formatWeekDateHeader, formatMonthHeader } from "./taskHelpers.js";
import { useRecordDrawer } from "./RecordDrawerContext.jsx";
import { useColorMapping } from "../context/ColorMappingContext.jsx";
import DayColumn from "./calendar/DayColumn.jsx";
import WeekListView from "./calendar/WeekListView.jsx";
import MonthGrid from "./calendar/MonthGrid.jsx";
import QuickCreateBar from "./calendar/QuickCreateBar.jsx";
import CalendarFilterDropdown from "./calendar/CalendarFilterDropdown.jsx";
const ViewSettingsPanel = React.lazy(() => import("../components/ViewSettingsPanel.jsx").catch(() =>
  new Promise(r => setTimeout(r, 200)).then(() => import("../components/ViewSettingsPanel.jsx"))
));

// DAY_NAMES and MONTH_NAMES imported from utils/helpers.js
const HIDDEN_KEY = "wasabi-hidden-calendars";

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

export default function CalendarView({ allTasks, refreshRef }) {
  const { openDrawer } = useRecordDrawer();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState("day"); // "day" | "week" | "month"
  const [googleConnected, setGoogleConnected] = useState(false);
  const [outlookConnected, setOutlookConnected] = useState(false);
  const [events, setEvents] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [hiddenCalendars, setHiddenCalendars] = useState(() => loadHiddenCalendars());
  const [loading, setLoading] = useState(true);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState(null); // "auth" | "fetch" | null
  const [refreshCounter, setRefreshCounter] = useState(0);
  const { globalColorMapping, globalColorField, getViewColorConfig, updateViewColorConfig, resetViewColorConfig } = useColorMapping();

  // Build schema from calendars for ViewSettingsPanel
  const calendarSchema = useMemo(() => {
    const options = calendars.map((cal) => ({
      name: cal.summary || cal.id,
      color: cal.backgroundColor || "default",
    }));
    if (options.length === 0) return null;
    return {
      statuses: [{ name: "Calendar", type: "status", options }],
      selects: [],
      multiSelects: [],
      allFields: [],
      dates: [],
    };
  }, [calendars]);

  // Resolve calendar name → palette hex from color mapping context
  const calendarColorMap = useMemo(() => {
    const viewConfig = getViewColorConfig("calendar");
    const viewMapping = viewConfig?.colorMapping || {};
    const map = {};
    for (const cal of calendars) {
      const name = cal.summary || cal.id;
      const idx = viewMapping[name] ?? globalColorMapping?.[name];
      if (idx !== undefined) {
        map[name] = VIEW_PALETTE[idx]?.hex || null;
      }
    }
    return map;
  }, [calendars, getViewColorConfig, globalColorMapping]);

  const today = useMemo(() => new Date(), []);
  const isViewingToday = isSameDay(selectedDate, today);

  // Compute the fetch range based on view mode
  const fetchRange = useMemo(() => {
    if (viewMode === "month") return getMonthRange(selectedDate);
    if (viewMode === "week") return getListViewRange(selectedDate);
    return getWeekRange(selectedDate); // day uses week range
  }, [selectedDate, viewMode]);

  // Week range (used for date header label)
  const weekRange = useMemo(() => viewMode === "week" ? getListViewRange(selectedDate) : getWeekRange(selectedDate), [selectedDate, viewMode]);

  // ── Fetch calendar data (Google + Outlook, in parallel, with retry) ──
  useEffect(() => {
    let cancelled = false;
    async function load(attempt = 0) {
      setLoading(true);
      setError(null);
      try {
        const maxResults = viewMode === "month" ? 250 : viewMode === "week" ? 150 : 50;
        const [googleStatus, msStatus] = await Promise.all([
          getGoogleStatus().catch(() => null),
          getMicrosoftStatus().catch(() => null),
        ]);
        if (cancelled) return;

        // googleConnected here means "user has Calendar grant" — Sheets-only or
        // Gmail-only Google connections don't surface in the calendar.
        const isGoogle = !!googleStatus?.connected && (googleStatus?.grants || []).includes("calendar");
        const isMs = !!msStatus?.connected;
        setGoogleConnected(isGoogle);
        setOutlookConnected(isMs);

        const fetches = [];
        if (isGoogle) {
          fetches.push(
            listCalendarEvents(
              fetchRange.start.toISOString(),
              fetchRange.end.toISOString(),
              maxResults
            ).catch(() => null)
          );
        } else {
          fetches.push(Promise.resolve(null));
        }
        if (isMs) {
          fetches.push(
            listOutlookEvents(
              fetchRange.start.toISOString(),
              fetchRange.end.toISOString(),
              maxResults
            ).catch(() => null)
          );
        } else {
          fetches.push(Promise.resolve(null));
        }

        const [googleResult, outlookResult] = await Promise.all(fetches);
        if (cancelled) return;

        const googleEvents = googleResult
          ? (googleResult.events || googleResult.items || []).map((ev) => ({ ...ev, provider: "google" }))
          : [];
        const googleCals = googleResult?.calendars || [];

        // Normalize Outlook events to match Google Calendar event shape
        const outlookEvents = outlookResult?.events
          ? outlookResult.events.map((ev) => ({
              ...ev,
              start: ev.isAllDay ? { date: ev.start?.split("T")[0] || ev.start } : { dateTime: ev.start },
              end: ev.isAllDay ? { date: ev.end?.split("T")[0] || ev.end } : { dateTime: ev.end },
              calendarId: "outlook",
              calendarName: "Outlook Calendar",
              calendarColor: "#0078d4",
              provider: "microsoft",
            }))
          : [];

        const allCals = [...googleCals];
        if (isMs) {
          allCals.push({ id: "outlook", summary: "Outlook Calendar", backgroundColor: "#0078d4" });
        }

        setEvents([...googleEvents, ...outlookEvents]);
        if (allCals.length) setCalendars(allCals);
      } catch (err) {
        console.error("[Calendar] Failed to load:", err);
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
  }, [fetchRange, refreshCounter]);

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

  // ── Event click → open drawer ──
  const handleEventClick = useCallback((event) => {
    openDrawer("event", event);
  }, [openDrawer]);

  // ── Task click (from calendar) → open drawer ──
  const handleTaskClick = useCallback((task) => {
    openDrawer("task", task);
  }, [openDrawer]);

  // ── Expose refresh for parent (drawer callbacks) ──
  useEffect(() => {
    if (refreshRef) {
      refreshRef.current = () => setRefreshCounter((c) => c + 1);
    }
  }, [refreshRef]);

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
        flexShrink: 0, height: 48, padding: "0 20px",
        borderBottom: `1px solid ${C.darkBorder}`,
        display: "flex", alignItems: "center", gap: 8,
        position: "relative",
      }}>
        {/* Nav arrows + Today */}
        <button onClick={goPrev} style={navBtnStyle} title="Previous">
          <svg width="14" height="14" viewBox="0 0 10 10" fill="none">
            <path d="M6.5 2L3.5 5L6.5 8" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={goToday}
          style={{
            ...navBtnStyle,
            fontSize: 12, fontFamily: FONT, color: C.darkMuted,
            padding: "4px 12px", opacity: isViewingToday ? 0.4 : 0.7,
          }}
        >
          Today
        </button>
        <button onClick={goNext} style={navBtnStyle} title="Next">
          <svg width="14" height="14" viewBox="0 0 10 10" fill="none">
            <path d="M3.5 2L6.5 5L3.5 8" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Date label */}
        <div style={{
          flex: 1, fontSize: 16, fontWeight: 600,
          fontFamily: FONT, color: C.darkText, marginLeft: 4,
        }}>
          {dateLabel}
        </div>

        {/* View settings button */}
        {calendars.length > 0 && (
          <button
            onClick={() => setShowSettings(true)}
            title="View settings"
            style={{
              ...navBtnStyle,
              opacity: 0.5,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
          >
            <IconEdit size={14} color={C.darkMuted} />
          </button>
        )}

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
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
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
          display: "flex", borderRadius: RADIUS.pill,
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
                padding: "6px 12px",
                fontSize: 12, fontFamily: FONT,
                color: viewMode === mode ? C.darkText : C.darkMuted,
                fontWeight: viewMode === mode ? 600 : 400,
                outline: "none",
                borderRight: i < 2 ? `1px solid ${C.darkBorder}` : "none",
              }}
            >
              {mode === "day" ? "Day" : mode === "week" ? "Week" : "Month"}
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
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
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
          calendarColorMap={calendarColorMap}
          onEventClick={handleEventClick}
          onTaskClick={handleTaskClick}
        />
      ) : viewMode === "week" ? (
        <WeekListView
          selectedDate={selectedDate}
          events={events}
          tasks={allTasks}
          onDayClick={handleDayClick}
          hiddenCalendars={hiddenCalendars}
          calendarColorMap={calendarColorMap}
          onEventClick={handleEventClick}
          onTaskClick={handleTaskClick}
        />
      ) : (
        <MonthGrid
          monthDate={selectedDate}
          events={events}
          tasks={allTasks}
          onDayClick={handleDayClick}
          hiddenCalendars={hiddenCalendars}
          calendarColorMap={calendarColorMap}
          onEventClick={handleEventClick}
          onTaskClick={handleTaskClick}
        />
      )}

      {/* ── Status banners ── */}
      {!loading && error === "auth" && (
        <div style={{
          flexShrink: 0, padding: "6px 12px",
          borderTop: `1px solid ${C.darkBorder}`,
          fontSize: 9, fontFamily: FONT, color: C.error,
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
      {!loading && !googleConnected && !outlookConnected && !error && (
        <div style={{
          flexShrink: 0, padding: "6px 12px",
          borderTop: `1px solid ${C.darkBorder}`,
          fontSize: 9, fontFamily: FONT, color: C.darkMuted,
          opacity: 0.6, textAlign: "center",
        }}>
          Connect Google or Microsoft calendar in Settings for events
        </div>
      )}

      {/* View settings panel */}
      {showSettings && calendarSchema && (
        <React.Suspense fallback={null}>
          <ViewSettingsPanel
            viewKey="calendar"
            viewConfig={{ type: "calendar", label: "Calendar" }}
            schema={calendarSchema}
            globalColorMapping={globalColorMapping}
            globalColorField={globalColorField}
            viewColorConfig={getViewColorConfig("calendar")}
            onSave={(updates) => updateViewColorConfig("calendar", updates)}
            onReset={() => resetViewColorConfig("calendar")}
            onClose={() => setShowSettings(false)}
          />
        </React.Suspense>
      )}
    </div>
  );
}

// ── Shared nav button style ──
const navBtnStyle = {
  background: "none", border: "none", cursor: "pointer",
  padding: 8, display: "flex", alignItems: "center", justifyContent: "center",
  borderRadius: RADIUS.md, outline: "none",
  transition: "opacity 0.15s",
  minWidth: 32, minHeight: 32,
};
