// ─── Wasabi Google Calendar View ───
// Standalone Google Calendar integration view. Fetches events from the
// connected Google account and renders them in List, Day, or Week modes.
// Supports creating and deleting events. No external CSS -- all inline.

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import {
  listCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getCalendarSummary,
} from "../lib/api.js";
import {
  IconCalendar,
  IconPlus,
  IconRefresh,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconTrash,
} from "../design/icons.jsx";

// ─── Date Helpers ───

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const LONG_DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2:30 PM" */
function formatTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** "Wednesday, Mar 12" */
function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  return `${LONG_DAYS[d.getDay()]}, ${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Mar 10 - 16, 2026" */
function formatWeekRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  if (s.getMonth() === e.getMonth()) {
    return `${SHORT_MONTHS[s.getMonth()]} ${s.getDate()} - ${e.getDate()}, ${s.getFullYear()}`;
  }
  return `${SHORT_MONTHS[s.getMonth()]} ${s.getDate()} - ${SHORT_MONTHS[e.getMonth()]} ${e.getDate()}, ${s.getFullYear()}`;
}

/** Returns { start: Date, end: Date } for the Monday..Sunday week containing `date`. */
function getWeekRange(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diffToMon);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** ISO string for API: "2026-03-10T00:00:00Z" */
function toISO(date) {
  return new Date(date).toISOString();
}

/** Same calendar day? */
function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Format as YYYY-MM-DDTHH:mm for datetime-local inputs */
function toLocalInput(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Friendly day label: "Today", "Tomorrow", or full date */
function dayLabel(date, today) {
  if (isSameDay(date, today)) return "Today";
  const tom = new Date(today);
  tom.setDate(today.getDate() + 1);
  if (isSameDay(date, tom)) return "Tomorrow";
  return formatDate(date);
}

/** Check if event is all-day (no time component or dateTime missing) */
function isAllDay(event) {
  if (event.start?.date && !event.start?.dateTime) return true;
  return false;
}

/** Get a Date from an event start/end (handles both date and dateTime) */
function eventDate(eventTime) {
  if (!eventTime) return null;
  if (eventTime.dateTime) return new Date(eventTime.dateTime);
  if (eventTime.date) {
    // "YYYY-MM-DD" -- parse as local
    const parts = eventTime.date.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }
  return null;
}

// ─── Styles ───

const S = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    fontFamily: FONT,
    background: C.dark,
    color: C.darkText,
  },

  // Header
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 20px",
    borderBottom: `1px solid ${C.darkBorder}`,
    background: C.darkSurf,
    flexShrink: 0,
    flexWrap: "wrap",
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: C.darkText,
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginRight: 8,
    animation: ANIM.snapUp(0.03),
  },
  navGroup: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  navBtn: {
    width: 30,
    height: 30,
    borderRadius: RADIUS.md,
    border: `1px solid ${C.darkBorder}`,
    background: C.darkSurf2,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.15s",
    flexShrink: 0,
  },
  todayBtn: {
    padding: "5px 14px",
    borderRadius: RADIUS.pill,
    border: `1px solid ${C.darkBorder}`,
    background: C.darkSurf2,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: FONT,
    color: C.darkMuted,
    transition: "all 0.15s",
  },
  dateRange: {
    fontSize: 13,
    fontWeight: 600,
    color: C.darkText,
    minWidth: 160,
    whiteSpace: "nowrap",
  },
  pillGroup: {
    display: "flex",
    alignItems: "center",
    background: C.darkSurf2,
    borderRadius: RADIUS.pill,
    border: `1px solid ${C.darkBorder}`,
    overflow: "hidden",
  },
  pillBtn: (active) => ({
    padding: "5px 14px",
    fontSize: 11,
    fontWeight: 600,
    fontFamily: FONT,
    border: "none",
    cursor: "pointer",
    background: active ? C.accent : "transparent",
    color: active ? "#fff" : C.darkMuted,
    transition: "all 0.15s",
    borderRadius: RADIUS.pill,
  }),
  newBtn: {
    marginLeft: "auto",
    padding: "6px 16px",
    borderRadius: RADIUS.pill,
    border: `1px solid ${C.accent}44`,
    background: `${C.accent}18`,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: FONT,
    color: C.accent,
    display: "flex",
    alignItems: "center",
    gap: 6,
    transition: "all 0.15s",
  },
  refreshBtn: {
    width: 30,
    height: 30,
    borderRadius: RADIUS.md,
    border: `1px solid ${C.darkBorder}`,
    background: C.darkSurf2,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.15s",
    flexShrink: 0,
  },

  // List view
  listScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "0 0 24px 0",
  },
  daySection: {
    padding: "0 20px",
  },
  dayHeader: {
    fontSize: 13,
    fontWeight: 700,
    color: C.darkText,
    padding: "16px 0 8px 0",
    borderBottom: `1px solid ${C.darkBorder}`,
    marginBottom: 4,
    position: "sticky",
    top: 0,
    background: C.dark,
    zIndex: 2,
  },
  eventRow: (expanded) => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "10px 12px",
    borderRadius: RADIUS.lg,
    cursor: "pointer",
    transition: "background 0.12s",
    background: expanded ? C.darkSurf2 : "transparent",
  }),
  eventTime: {
    fontSize: 12,
    fontWeight: 500,
    color: C.darkMuted,
    minWidth: 130,
    flexShrink: 0,
    paddingTop: 1,
  },
  eventTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: C.darkText,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  eventLocation: {
    fontSize: 11,
    color: C.darkMuted,
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  allDayBadge: {
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: RADIUS.pill,
    fontSize: 10,
    fontWeight: 600,
    background: `${C.accent}18`,
    color: C.accent,
    marginRight: 8,
  },
  expandedDetail: {
    padding: "10px 12px 10px 154px",
    fontSize: 12,
    color: C.darkMuted,
    lineHeight: 1.6,
  },
  detailLabel: {
    fontWeight: 600,
    color: C.darkText,
    marginRight: 6,
  },
  detailActions: {
    display: "flex",
    gap: 8,
    marginTop: 10,
  },
  actionBtn: (destructive) => ({
    padding: "5px 14px",
    borderRadius: RADIUS.pill,
    border: `1px solid ${destructive ? "#e0434344" : C.darkBorder}`,
    background: destructive ? "#e0434318" : C.darkSurf2,
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
    fontFamily: FONT,
    color: destructive ? "#e04343" : C.darkMuted,
    display: "flex",
    alignItems: "center",
    gap: 5,
    transition: "all 0.15s",
  }),

  // Day view
  dayViewWrap: {
    flex: 1,
    overflowY: "auto",
    position: "relative",
  },
  dayTimeline: {
    position: "relative",
    minHeight: 960,
  },
  hourRow: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 60,
    borderBottom: `1px solid ${C.darkBorder}`,
    display: "flex",
    alignItems: "flex-start",
  },
  hourLabel: {
    width: 64,
    flexShrink: 0,
    fontSize: 11,
    fontWeight: 500,
    color: C.darkMuted,
    textAlign: "right",
    paddingRight: 12,
    paddingTop: 2,
  },
  hourLine: {
    flex: 1,
    borderTop: `1px solid ${C.darkBorder}`,
    height: 1,
    marginTop: 6,
  },
  dayEventBlock: (top, height) => ({
    position: "absolute",
    left: 76,
    right: 16,
    top,
    height: Math.max(height, 22),
    borderRadius: RADIUS.md,
    background: `${C.accent}28`,
    borderLeft: `3px solid ${C.accent}`,
    padding: "4px 8px",
    fontSize: 11,
    fontWeight: 600,
    color: C.darkText,
    overflow: "hidden",
    cursor: "pointer",
    transition: "background 0.12s",
  }),

  // Week view
  weekWrap: {
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
  },
  weekGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    minHeight: "100%",
  },
  weekColHeader: (isToday) => ({
    padding: "10px 8px",
    fontSize: 11,
    fontWeight: 700,
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: isToday ? C.accent : C.darkMuted,
    borderBottom: `1px solid ${C.darkBorder}`,
    borderRight: `1px solid ${C.darkBorder}`,
    background: isToday ? `${C.accent}08` : C.darkSurf,
    position: "sticky",
    top: 0,
    zIndex: 3,
  }),
  weekCol: (isToday) => ({
    minHeight: 400,
    borderRight: `1px solid ${C.darkBorder}`,
    background: isToday ? `${C.accent}06` : "transparent",
    padding: 4,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  }),
  weekEvent: {
    padding: "4px 6px",
    borderRadius: RADIUS.sm,
    fontSize: 12,
    fontWeight: 600,
    color: C.darkText,
    background: `${C.accent}22`,
    borderLeft: `2px solid ${C.accent}`,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
    transition: "background 0.12s",
  },
  weekEventTime: {
    fontSize: 10,
    fontWeight: 500,
    color: C.darkMuted,
    marginBottom: 1,
  },

  // Modal overlay
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 900,
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  modal: {
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.xl,
    boxShadow: SHADOW.dropdown,
    padding: 24,
    width: 440,
    maxWidth: "90vw",
    maxHeight: "85vh",
    overflowY: "auto",
    position: "relative",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: C.darkText,
    marginBottom: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fieldGroup: {
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: C.darkMuted,
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    borderRadius: RADIUS.md,
    border: `1px solid ${C.darkBorder}`,
    background: C.darkSurf2,
    color: C.darkText,
    fontSize: 13,
    fontFamily: FONT,
    outline: "none",
    transition: "border-color 0.15s",
  },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    borderRadius: RADIUS.md,
    border: `1px solid ${C.darkBorder}`,
    background: C.darkSurf2,
    color: C.darkText,
    fontSize: 13,
    fontFamily: FONT,
    outline: "none",
    resize: "vertical",
    minHeight: 64,
    transition: "border-color 0.15s",
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 20,
  },
  cancelBtn: {
    padding: "7px 18px",
    borderRadius: RADIUS.pill,
    border: `1px solid ${C.darkBorder}`,
    background: C.darkSurf2,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: FONT,
    color: C.darkMuted,
    transition: "all 0.15s",
  },
  createBtn: {
    padding: "7px 18px",
    borderRadius: RADIUS.pill,
    border: "none",
    background: C.accent,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: FONT,
    color: "#fff",
    transition: "all 0.15s",
  },

  // Loading / empty
  emptyState: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 64,
    color: C.darkMuted,
    fontSize: 14,
    textAlign: "center",
  },
  spinner: {
    width: 20,
    height: 20,
    border: `2px solid ${C.darkBorder}`,
    borderTopColor: C.accent,
    borderRadius: "50%",
    animation: "calview-spin 0.6s linear infinite",
  },
};

// ─── Keyframe injection (spinner) ───
const SPIN_ID = "__calview-spin-kf__";
if (typeof document !== "undefined" && !document.getElementById(SPIN_ID)) {
  const sheet = document.createElement("style");
  sheet.id = SPIN_ID;
  sheet.textContent = "@keyframes calview-spin { to { transform: rotate(360deg) } }";
  document.head.appendChild(sheet);
}

// ─── Constants ───
const VISIBLE_HOURS_START = 7;
const VISIBLE_HOURS_END = 22;
const HOUR_PX = 60;

// ─── Main Component ───

export default function CalendarView() {
  const [events, setEvents] = useState([]);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState("list");
  const [expandedEvent, setExpandedEvent] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createData, setCreateData] = useState({
    summary: "",
    start: "",
    end: "",
    description: "",
    location: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const dayViewRef = useRef(null);

  // ── Derived week range ──
  const weekRange = useMemo(() => getWeekRange(selectedDate), [selectedDate]);

  // ── Fetch events ──
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const range = getWeekRange(selectedDate);
      const res = await listCalendarEvents(toISO(range.start), toISO(range.end));
      const items = res.events || res.items || res || [];
      setEvents(Array.isArray(items) ? items : []);
    } catch (err) {
      console.error("CalendarView fetch error:", err);
      setError(err.message || "Failed to load calendar events");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Scroll day view to 7am on mount / view switch
  useEffect(() => {
    if (viewMode === "day" && dayViewRef.current) {
      dayViewRef.current.scrollTop = VISIBLE_HOURS_START * HOUR_PX;
    }
  }, [viewMode]);

  // ── Navigation ──
  const goToday = useCallback(() => {
    setSelectedDate(new Date());
    setExpandedEvent(null);
  }, []);

  const goPrev = useCallback(() => {
    setSelectedDate((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() - 7);
      return n;
    });
    setExpandedEvent(null);
  }, []);

  const goNext = useCallback(() => {
    setSelectedDate((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() + 7);
      return n;
    });
    setExpandedEvent(null);
  }, []);

  // ── Create event ──
  const openCreate = useCallback(() => {
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
    const endTime = new Date(now);
    endTime.setHours(endTime.getHours() + 1);
    setCreateData({
      summary: "",
      start: toLocalInput(now),
      end: toLocalInput(endTime),
      description: "",
      location: "",
    });
    setCreating(true);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!createData.summary.trim() || !createData.start || !createData.end) return;
    try {
      await createCalendarEvent({
        summary: createData.summary.trim(),
        start: { dateTime: new Date(createData.start).toISOString() },
        end: { dateTime: new Date(createData.end).toISOString() },
        description: createData.description.trim() || undefined,
        location: createData.location.trim() || undefined,
      });
      setCreating(false);
      fetchEvents();
    } catch (err) {
      console.error("Create event error:", err);
    }
  }, [createData, fetchEvents]);

  // ── Delete event ──
  const handleDelete = useCallback(async (eventId) => {
    try {
      await deleteCalendarEvent(eventId);
      setExpandedEvent(null);
      fetchEvents();
    } catch (err) {
      console.error("Delete event error:", err);
    }
  }, [fetchEvents]);

  // ── Group events by day for list view ──
  const groupedByDay = useMemo(() => {
    const groups = {};
    for (const ev of events) {
      const d = eventDate(ev.start);
      if (!d) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!groups[key]) groups[key] = { date: d, events: [] };
      groups[key].events.push(ev);
    }
    // Sort days ascending
    const sorted = Object.values(groups).sort((a, b) => a.date - b.date);
    // Sort events within each day by start time
    for (const g of sorted) {
      g.events.sort((a, b) => {
        // All-day events first
        const aAll = isAllDay(a) ? 0 : 1;
        const bAll = isAllDay(b) ? 0 : 1;
        if (aAll !== bAll) return aAll - bAll;
        const aDate = eventDate(a.start);
        const bDate = eventDate(b.start);
        return (aDate?.getTime() || 0) - (bDate?.getTime() || 0);
      });
    }
    return sorted;
  }, [events]);

  // ── Events for a specific day (week view) ──
  const eventsForDay = useCallback(
    (date) =>
      events.filter((ev) => {
        const d = eventDate(ev.start);
        return d && isSameDay(d, date);
      }).sort((a, b) => {
        const aAll = isAllDay(a) ? 0 : 1;
        const bAll = isAllDay(b) ? 0 : 1;
        if (aAll !== bAll) return aAll - bAll;
        return (eventDate(a.start)?.getTime() || 0) - (eventDate(b.start)?.getTime() || 0);
      }),
    [events],
  );

  // ── Week columns ──
  const weekColumns = useMemo(() => {
    const cols = [];
    const cur = new Date(weekRange.start);
    for (let i = 0; i < 7; i++) {
      cols.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return cols;
  }, [weekRange]);

  const today = useMemo(() => new Date(), []);

  // ── Events for selected day (day view) ──
  const dayEvents = useMemo(
    () =>
      events.filter((ev) => {
        const d = eventDate(ev.start);
        return d && isSameDay(d, selectedDate);
      }).sort((a, b) => {
        return (eventDate(a.start)?.getTime() || 0) - (eventDate(b.start)?.getTime() || 0);
      }),
    [events, selectedDate],
  );

  // ── Render helpers ──
  const hoverBg = (base) => ({
    onMouseEnter: (e) => { e.currentTarget.style.background = C.darkBorder; },
    onMouseLeave: (e) => { e.currentTarget.style.background = base; },
  });

  // ─── RENDER ───

  return (
    <div style={S.wrapper}>
      {/* ── Header ── */}
      <div style={S.header}>
        <div style={S.title}>
          <IconCalendar size={18} color={C.accent} />
          Calendar
        </div>

        {/* Today */}
        <button
          style={S.todayBtn}
          onClick={goToday}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = C.darkText;
            e.currentTarget.style.borderColor = C.accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = C.darkMuted;
            e.currentTarget.style.borderColor = C.darkBorder;
          }}
        >
          Today
        </button>

        {/* Prev / Next */}
        <div style={S.navGroup}>
          <button style={S.navBtn} onClick={goPrev} {...hoverBg(C.darkSurf2)}>
            <IconChevronLeft size={14} color={C.darkMuted} />
          </button>
          <button style={S.navBtn} onClick={goNext} {...hoverBg(C.darkSurf2)}>
            <IconChevronRight size={14} color={C.darkMuted} />
          </button>
        </div>

        {/* Date range */}
        <div style={S.dateRange}>
          {formatWeekRange(weekRange.start, weekRange.end)}
        </div>

        {/* View toggle */}
        <div style={S.pillGroup}>
          {["list", "day", "week"].map((mode) => (
            <button
              key={mode}
              style={S.pillBtn(viewMode === mode)}
              onClick={() => { setViewMode(mode); setExpandedEvent(null); }}
              onMouseEnter={(e) => {
                if (viewMode !== mode) e.currentTarget.style.color = C.darkText;
              }}
              onMouseLeave={(e) => {
                if (viewMode !== mode) e.currentTarget.style.color = C.darkMuted;
              }}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {/* New Event */}
        <button
          style={S.newBtn}
          onClick={openCreate}
          onMouseEnter={(e) => { e.currentTarget.style.background = `${C.accent}30`; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = `${C.accent}18`; }}
        >
          <IconPlus size={13} color={C.accent} />
          New Event
        </button>

        {/* Refresh */}
        <button style={S.refreshBtn} onClick={fetchEvents} {...hoverBg(C.darkSurf2)}>
          <IconRefresh size={14} color={C.darkMuted} />
        </button>
      </div>

      {/* ── Loading / Error / Empty ── */}
      {loading && (
        <div style={S.emptyState}>
          <div style={S.spinner} />
          <div style={{ fontSize: 13, color: C.darkMuted }}>Loading events...</div>
        </div>
      )}

      {!loading && error && (
        <div style={S.emptyState}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#e04343" }}>{error}</div>
          <button
            style={{ ...S.todayBtn, marginTop: 8 }}
            onClick={fetchEvents}
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <div style={S.emptyState}>
          <IconCalendar size={32} color={C.darkMuted} style={{ opacity: 0.4 }} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>No events this week</div>
          <div style={{ maxWidth: 280, lineHeight: 1.5, fontSize: 13, color: C.darkMuted }}>
            Navigate to another week or create a new event to get started.
          </div>
        </div>
      )}

      {/* ── List View ── */}
      {!loading && !error && events.length > 0 && viewMode === "list" && (
        <div style={S.listScroll}>
          {groupedByDay.map((group) => (
            <div key={group.date.toISOString()} style={S.daySection}>
              <div style={S.dayHeader}>{dayLabel(group.date, today)}</div>
              {group.events.map((ev) => {
                const expanded = expandedEvent === ev.id;
                const allDay = isAllDay(ev);
                return (
                  <React.Fragment key={ev.id}>
                    <div
                      style={S.eventRow(expanded)}
                      onClick={() => setExpandedEvent(expanded ? null : ev.id)}
                      onMouseEnter={(e) => {
                        if (!expanded) e.currentTarget.style.background = C.darkSurf;
                      }}
                      onMouseLeave={(e) => {
                        if (!expanded) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <div style={S.eventTime}>
                        {allDay ? (
                          <span style={S.allDayBadge}>All Day</span>
                        ) : (
                          `${formatTime(ev.start?.dateTime)} - ${formatTime(ev.end?.dateTime)}`
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={S.eventTitle}>{ev.summary || "Untitled"}</div>
                        {ev.location && (
                          <div style={S.eventLocation}>{ev.location}</div>
                        )}
                      </div>
                    </div>

                    {/* Expanded details */}
                    {expanded && (
                      <div style={S.expandedDetail}>
                        {ev.description && (
                          <div style={{ marginBottom: 8 }}>
                            <span style={S.detailLabel}>Description:</span>
                            {ev.description}
                          </div>
                        )}
                        {ev.attendees && ev.attendees.length > 0 && (
                          <div style={{ marginBottom: 8 }}>
                            <span style={S.detailLabel}>Attendees:</span>
                            {ev.attendees.map((a) => a.email || a.displayName).join(", ")}
                          </div>
                        )}
                        {ev.location && (
                          <div style={{ marginBottom: 8 }}>
                            <span style={S.detailLabel}>Location:</span>
                            {ev.location}
                          </div>
                        )}
                        <div style={S.detailActions}>
                          <button
                            style={S.actionBtn(true)}
                            onClick={(e) => { e.stopPropagation(); handleDelete(ev.id); }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "#e0434330"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "#e0434318"; }}
                          >
                            <IconTrash size={12} color="#e04343" />
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* ── Day View ── */}
      {!loading && !error && viewMode === "day" && events.length > 0 && (
        <div style={S.dayViewWrap} ref={dayViewRef}>
          <div style={{ ...S.dayTimeline, height: 24 * HOUR_PX }}>
            {/* Hour rows */}
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ ...S.hourRow, top: h * HOUR_PX }}>
                <div style={S.hourLabel}>
                  {h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
                </div>
                <div style={S.hourLine} />
              </div>
            ))}

            {/* Event blocks */}
            {dayEvents.filter((ev) => !isAllDay(ev)).map((ev) => {
              const start = eventDate(ev.start);
              const end = eventDate(ev.end);
              if (!start || !end) return null;
              const topMin = start.getHours() * 60 + start.getMinutes();
              const endMin = end.getHours() * 60 + end.getMinutes();
              const duration = Math.max(endMin - topMin, 15);
              const topPx = (topMin / 60) * HOUR_PX;
              const heightPx = (duration / 60) * HOUR_PX;

              return (
                <div
                  key={ev.id}
                  style={S.dayEventBlock(topPx, heightPx)}
                  onClick={() => setExpandedEvent(expandedEvent === ev.id ? null : ev.id)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = `${C.accent}40`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = `${C.accent}28`; }}
                  title={ev.summary || "Untitled"}
                >
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ev.summary || "Untitled"}
                  </div>
                  {heightPx > 30 && (
                    <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 2 }}>
                      {formatTime(ev.start?.dateTime)} - {formatTime(ev.end?.dateTime)}
                    </div>
                  )}
                </div>
              );
            })}

            {/* All-day events bar at top */}
            {dayEvents.filter(isAllDay).length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 76,
                  right: 16,
                  padding: "6px 8px",
                  background: C.darkSurf,
                  borderBottom: `1px solid ${C.darkBorder}`,
                  borderRadius: RADIUS.md,
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  zIndex: 2,
                }}
              >
                {dayEvents.filter(isAllDay).map((ev) => (
                  <span key={ev.id} style={S.allDayBadge}>
                    {ev.summary || "Untitled"}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Show day view empty when no events but day selected */}
      {!loading && !error && viewMode === "day" && events.length > 0 && dayEvents.length === 0 && (
        <div style={{ ...S.emptyState, flex: "none", padding: "32px 0" }}>
          <div style={{ fontSize: 13, color: C.darkMuted }}>
            No events on {formatDate(selectedDate)}
          </div>
        </div>
      )}

      {/* ── Week View ── */}
      {!loading && !error && events.length > 0 && viewMode === "week" && (
        <div style={S.weekWrap}>
          {/* Column headers */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", position: "sticky", top: 0, zIndex: 3 }}>
            {weekColumns.map((date, i) => {
              const isToday_ = isSameDay(date, today);
              return (
                <div key={i} style={S.weekColHeader(isToday_)}>
                  <div>{SHORT_DAYS[date.getDay()]}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2, color: isToday_ ? C.accent : C.darkText }}>
                    {date.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Columns */}
          <div style={S.weekGrid}>
            {weekColumns.map((date, i) => {
              const isToday_ = isSameDay(date, today);
              const colEvents = eventsForDay(date);
              return (
                <div key={i} style={S.weekCol(isToday_)}>
                  {colEvents.map((ev) => (
                    <div
                      key={ev.id}
                      style={S.weekEvent}
                      onClick={() => setExpandedEvent(expandedEvent === ev.id ? null : ev.id)}
                      onMouseEnter={(e) => { e.currentTarget.style.background = `${C.accent}38`; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = `${C.accent}22`; }}
                      title={ev.summary || "Untitled"}
                    >
                      {!isAllDay(ev) && (
                        <div style={S.weekEventTime}>{formatTime(ev.start?.dateTime)}</div>
                      )}
                      {isAllDay(ev) && (
                        <div style={S.weekEventTime}>All Day</div>
                      )}
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ev.summary || "Untitled"}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Create Event Modal ── */}
      {creating && (
        <div style={S.overlay} onClick={() => setCreating(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalTitle}>
              New Event
              <button
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 4,
                  display: "flex",
                  alignItems: "center",
                }}
                onClick={() => setCreating(false)}
              >
                <IconClose size={14} color={C.darkMuted} />
              </button>
            </div>

            {/* Summary */}
            <div style={S.fieldGroup}>
              <div style={S.fieldLabel}>Summary</div>
              <input
                style={S.input}
                type="text"
                placeholder="Event title"
                value={createData.summary}
                onChange={(e) => setCreateData((d) => ({ ...d, summary: e.target.value }))}
                onFocus={(e) => { e.currentTarget.style.borderColor = C.accent; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
                autoFocus
              />
            </div>

            {/* Start */}
            <div style={S.fieldGroup}>
              <div style={S.fieldLabel}>Start</div>
              <input
                style={S.input}
                type="datetime-local"
                value={createData.start}
                onChange={(e) => setCreateData((d) => ({ ...d, start: e.target.value }))}
                onFocus={(e) => { e.currentTarget.style.borderColor = C.accent; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
              />
            </div>

            {/* End */}
            <div style={S.fieldGroup}>
              <div style={S.fieldLabel}>End</div>
              <input
                style={S.input}
                type="datetime-local"
                value={createData.end}
                onChange={(e) => setCreateData((d) => ({ ...d, end: e.target.value }))}
                onFocus={(e) => { e.currentTarget.style.borderColor = C.accent; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
              />
            </div>

            {/* Location */}
            <div style={S.fieldGroup}>
              <div style={S.fieldLabel}>Location</div>
              <input
                style={S.input}
                type="text"
                placeholder="Optional"
                value={createData.location}
                onChange={(e) => setCreateData((d) => ({ ...d, location: e.target.value }))}
                onFocus={(e) => { e.currentTarget.style.borderColor = C.accent; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
              />
            </div>

            {/* Description */}
            <div style={S.fieldGroup}>
              <div style={S.fieldLabel}>Description</div>
              <textarea
                style={S.textarea}
                placeholder="Optional"
                value={createData.description}
                onChange={(e) => setCreateData((d) => ({ ...d, description: e.target.value }))}
                onFocus={(e) => { e.currentTarget.style.borderColor = C.accent; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
              />
            </div>

            {/* Actions */}
            <div style={S.modalActions}>
              <button
                style={S.cancelBtn}
                onClick={() => setCreating(false)}
                onMouseEnter={(e) => { e.currentTarget.style.color = C.darkText; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
              >
                Cancel
              </button>
              <button
                style={{
                  ...S.createBtn,
                  opacity: createData.summary.trim() && createData.start && createData.end ? 1 : 0.5,
                  cursor: createData.summary.trim() && createData.start && createData.end ? "pointer" : "not-allowed",
                }}
                onClick={handleCreate}
                onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
              >
                Create Event
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
