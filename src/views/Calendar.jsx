// ─── Wasabi Calendar View ───
// Month grid calendar view. Events placed on date cells as colored pills.
// Click a day for a popover list. Navigation: prev/next month, today.

import React, { useState, useMemo, useCallback } from "react";
import { C, FONT, RADIUS, SHADOW, getSolidPillColor } from "../design/tokens.js";
import { readProp } from "../notion/properties.js";
import { IconChevronLeft, IconChevronRight } from "../design/icons.jsx";
import RecordDetail from "./RecordDetail.jsx";

// ── Helpers ──

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = [];
  let week = new Array(firstDay).fill(null);

  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

function toDateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateStr(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/** Find the date field(s) to use from schema */
function resolveDateField(schema, config) {
  if (config?.dateField) return config.dateField;
  if (!schema) return null;
  if (schema.dates?.length > 0) return schema.dates[0].name;
  return null;
}

/** Find title field */
function resolveTitleField(schema) {
  return schema?.title?.name || null;
}

/** Find status/color field */
function resolveColorField(schema) {
  if (schema?.statuses?.length > 0) return schema.statuses[0];
  if (schema?.selects?.length > 0) return schema.selects[0];
  return null;
}

// ── Styles ──
const cal = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    fontFamily: FONT,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    borderBottom: `1px solid ${C.edgeLine}`,
    background: C.darkSurf,
    flexShrink: 0,
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: 700,
    color: C.darkText,
    minWidth: 180,
    textAlign: "center",
  },
  navBtn: {
    width: 32,
    height: 32,
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
    marginLeft: "auto",
  },
  grid: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    overflowY: "auto",
    background: C.dark,
  },
  dayHeader: {
    padding: "8px 6px",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: C.darkMuted,
    textAlign: "center",
    borderBottom: `1px solid ${C.edgeLine}`,
    background: C.darkSurf,
  },
  cell: (isToday, isEmpty) => ({
    minHeight: 90,
    padding: "4px 6px",
    borderBottom: `1px solid ${C.edgeLine}`,
    borderRight: `1px solid ${C.edgeLine}`,
    background: isToday ? `${C.accent}08` : isEmpty ? C.dark : C.darkSurf,
    cursor: isEmpty ? "default" : "pointer",
    transition: "background 0.12s",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  }),
  dayNum: (isToday) => ({
    fontSize: 12,
    fontWeight: isToday ? 700 : 400,
    color: isToday ? C.accent : C.darkMuted,
    marginBottom: 4,
    padding: isToday ? "1px 6px" : "1px 2px",
    borderRadius: isToday ? RADIUS.pill : 0,
    background: isToday ? `${C.accent}18` : "transparent",
    display: "inline-block",
    alignSelf: "flex-start",
  }),
  eventPill: (fillColor) => ({
    display: "block",
    padding: "2px 6px",
    borderRadius: RADIUS.sm,
    fontSize: 10,
    fontWeight: 600,
    color: "#fff",
    background: fillColor,
    marginBottom: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
  }),
  moreLabel: {
    fontSize: 10,
    color: C.accent,
    fontWeight: 600,
    cursor: "pointer",
    padding: "2px 0",
  },
  popover: {
    position: "fixed",
    zIndex: 200,
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.xl,
    boxShadow: SHADOW.dropdown,
    padding: 14,
    maxWidth: 320,
    minWidth: 220,
    maxHeight: 300,
    overflowY: "auto",
  },
  popTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: C.darkText,
    marginBottom: 8,
  },
  popItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 0",
    borderBottom: `1px solid ${C.edgeLine}`,
    fontSize: 12,
    color: C.darkText,
  },
  popDot: (color) => ({
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  }),
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 64,
    gap: 12,
    color: C.darkMuted,
    fontSize: 14,
    textAlign: "center",
    fontFamily: FONT,
  },
};

// ── Main Component ──
export default function Calendar({ data = [], schema, config = {}, onUpdate, onRefresh }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [popover, setPopover] = useState(null); // { x, y, date, events }
  const [detailPage, setDetailPage] = useState(null);

  const dateField = resolveDateField(schema, config);
  const titleField = resolveTitleField(schema);
  const colorField = resolveColorField(schema);

  // Build event map: { "YYYY-MM-DD": [{ title, color, page }] }
  const eventMap = useMemo(() => {
    if (!dateField) return {};
    const map = {};

    for (const page of data) {
      const dateProp = page.properties?.[dateField];
      if (!dateProp) continue;

      const raw = readProp(dateProp);
      let startStr, endStr;

      if (typeof raw === "object" && raw?.start) {
        startStr = raw.start;
        endStr = raw.end || null;
      } else if (typeof raw === "string") {
        startStr = raw;
        endStr = null;
      } else {
        continue;
      }

      const start = parseDateStr(startStr);
      if (!start) continue;

      // Get title
      const title = titleField ? readProp(page.properties?.[titleField]) || "Untitled" : "Untitled";

      // Get color
      let eventColor = C.accent;
      if (colorField) {
        const colorVal = readProp(page.properties?.[colorField.name]);
        if (colorVal) {
          const opts = colorField.options?.map((o) => o.name) || [];
          const { fill } = getSolidPillColor(colorVal, opts, colorField.options || []);
          eventColor = fill;
        }
      }

      // Place event on all days it spans
      const end = endStr ? parseDateStr(endStr) : null;
      const lastDay = end || start;
      const cur = new Date(start);

      while (cur <= lastDay) {
        const key = cur.toISOString().slice(0, 10);
        if (!map[key]) map[key] = [];
        map[key].push({ title, color: eventColor, page, isStart: cur.getTime() === start.getTime() });
        cur.setDate(cur.getDate() + 1);
      }
    }
    return map;
  }, [data, dateField, titleField, colorField]);

  const weeks = useMemo(() => getMonthGrid(year, month), [year, month]);

  // Navigation
  const goPrev = useCallback(() => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
    setPopover(null);
  }, [month]);

  const goNext = useCallback(() => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
    setPopover(null);
  }, [month]);

  const goToday = useCallback(() => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setPopover(null);
  }, []); // eslint-disable-line

  // Click on a day cell
  const handleDayClick = useCallback((day, e) => {
    if (!day) return;
    const key = toDateStr(year, month, day);
    const events = eventMap[key] || [];
    if (events.length === 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    setPopover({
      x: Math.min(rect.right + 8, window.innerWidth - 340),
      y: Math.min(rect.top, window.innerHeight - 320),
      date: key,
      events,
    });
  }, [year, month, eventMap]);

  // Close popover on outside click
  const handleBackdropClick = useCallback(() => setPopover(null), []);

  if (!dateField) {
    return (
      <div style={cal.empty}>
        <div style={{ fontSize: 32, opacity: 0.4 }}>&#x1F4C5;</div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>No date fields detected</div>
        <div style={{ maxWidth: 300, lineHeight: 1.5, fontSize: 13 }}>
          This database needs at least one date property to use the calendar view.
        </div>
      </div>
    );
  }

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();
  const todayDay = today.getDate();
  const MAX_VISIBLE = 3;

  return (
    <div style={cal.wrapper}>
      {/* Toolbar */}
      <div style={cal.toolbar}>
        <button
          style={cal.navBtn}
          onClick={goPrev}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.darkBorder; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
        >
          <IconChevronLeft size={14} color={C.darkMuted} />
        </button>
        <div style={cal.monthLabel}>
          {MONTHS[month]} {year}
        </div>
        <button
          style={cal.navBtn}
          onClick={goNext}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.darkBorder; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
        >
          <IconChevronRight size={14} color={C.darkMuted} />
        </button>

        <button
          style={cal.todayBtn}
          onClick={goToday}
          onMouseEnter={(e) => { e.currentTarget.style.color = C.darkText; e.currentTarget.style.borderColor = C.accent; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; e.currentTarget.style.borderColor = C.darkBorder; }}
        >
          Today
        </button>

        <span style={{ fontSize: 11, color: C.darkMuted }}>
          {data.length} event{data.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Day headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", flexShrink: 0 }}>
        {DAYS.map((d) => (
          <div key={d} style={cal.dayHeader}>{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div style={cal.grid}>
        {weeks.map((week, wi) =>
          week.map((day, di) => {
            const isToday = isCurrentMonth && day === todayDay;
            const isEmpty = day === null;
            const key = day ? toDateStr(year, month, day) : null;
            const events = key ? eventMap[key] || [] : [];

            return (
              <div
                key={`${wi}-${di}`}
                style={cal.cell(isToday, isEmpty)}
                onClick={(e) => handleDayClick(day, e)}
                onMouseEnter={(e) => { if (!isEmpty) e.currentTarget.style.background = isToday ? `${C.accent}14` : C.darkSurf2; }}
                onMouseLeave={(e) => { if (!isEmpty) e.currentTarget.style.background = isToday ? `${C.accent}08` : C.darkSurf; }}
              >
                {day && <span style={cal.dayNum(isToday)}>{day}</span>}
                {events.slice(0, MAX_VISIBLE).map((ev, ei) => (
                  <span key={ei} style={cal.eventPill(ev.color)}>
                    {ev.title}
                  </span>
                ))}
                {events.length > MAX_VISIBLE && (
                  <span style={cal.moreLabel}>
                    +{events.length - MAX_VISIBLE} more
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Day popover */}
      {popover && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 199 }}
            onClick={handleBackdropClick}
          />
          <div style={{ ...cal.popover, left: popover.x, top: popover.y }}>
            <div style={cal.popTitle}>
              {new Date(popover.date + "T00:00:00").toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </div>
            {popover.events.map((ev, i) => (
              <div
                key={i}
                style={{ ...cal.popItem, cursor: "pointer", borderRadius: RADIUS.md, padding: "6px 4px" }}
                onClick={() => { setDetailPage(ev.page); setPopover(null); }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={cal.popDot(ev.color)} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ev.title}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Record Detail Panel */}
      {detailPage && (
        <RecordDetail
          page={detailPage}
          schema={schema}
          onClose={() => setDetailPage(null)}
          onUpdate={async (pageId, properties) => {
            if (!onUpdate) return;
            for (const [fieldName, payload] of Object.entries(properties)) {
              await onUpdate(pageId, fieldName, payload);
            }
          }}
        />
      )}
    </div>
  );
}
