// ─── Wasabi Calendar View ───
// Month grid calendar view. Events placed on date cells as colored pills.
// Click a day for a popover list. Navigation: prev/next month, today.

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { C, FONT, RADIUS, SHADOW, getSolidPillColor } from "../design/tokens.js";
import { readProp } from "../notion/properties.js";
import { IconChevronLeft, IconChevronRight } from "../design/icons.jsx";
import { useRecordDetail } from "../hooks/useRecordDetail.js";
import RecordDetailPortals from "../components/RecordDetailPortals.jsx";
import { isNeuronsMode, dispatchNeuronSelect } from "../neurons/NeuronsContext.jsx";
import { DAY_NAMES, MONTH_NAMES_FULL } from "../utils/helpers.js";
import OwnerAvatars from "../components/OwnerAvatars.jsx";
import { listUserDirectory } from "../lib/api.js";

// Convert a resolved linked value into a date-shaped value for the Calendar's
// existing readProp/parseDateStr path. Date ranges resolve to "start – end".
function coerceLinkedDateValue(linkedValue) {
  if (linkedValue == null || linkedValue === "") return null;
  if (typeof linkedValue === "object") return linkedValue;
  if (typeof linkedValue === "string" && linkedValue.includes("–")) {
    const [start, end] = linkedValue.split("–").map((s) => s.trim());
    return { start, end };
  }
  return linkedValue;
}

// ── Helpers ──

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
  // Parse as local date to avoid UTC off-by-one
  const parts = str.split("T")[0].split("-");
  if (parts.length === 3) {
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return isNaN(d.getTime()) ? null : d;
  }
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
    borderRadius: RADIUS.md,
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
export default function Calendar({ data = [], schema, config = {}, onUpdate, onRefresh, onCreate, onDelete, pageConfig, resolvedLinks, onLinkField, onUnlinkField, onCreateOption }) {
  // Cell links are resolved once by ViewRenderer and passed in, so every
  // view shows the same linked values and offers the same link actions.

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [popover, setPopover] = useState(null); // { x, y, date, events }
  const record = useRecordDetail();
  const showOwner = !!config.showOwner;
  const [teamUsers, setTeamUsers] = useState([]);
  useEffect(() => {
    if (!showOwner) return;
    listUserDirectory().then((res) => setTeamUsers(res.users || [])).catch(() => {});
  }, [showOwner]);

  const dateField = resolveDateField(schema, config);
  const titleField = resolveTitleField(schema);
  const colorField = resolveColorField(schema);

  // Build event map: { "YYYY-MM-DD": [{ title, color, page }] }
  // Sub-items are excluded from the main grid and shown in popover on parent expand.
  const [expandedPopoverParent, setExpandedPopoverParent] = useState(null);

  const { eventMap, childEventsMap } = useMemo(() => {
    if (!dateField) return { eventMap: {}, childEventsMap: {} };
    const map = {};
    const childMap = {}; // parentId → [{ title, color, page, dateKey }]

    for (const page of data) {
      const isSubItem = !!page._parentRowId;

      // Sub-items: use sub-schema date fields if available, otherwise skip
      const subSchema = schema?._subSchema;
      const subDateField = subSchema?.dates?.[0]?.name;

      const fieldToUse = isSubItem ? subDateField : dateField;
      if (!fieldToUse) continue;

      // Prefer linked value if this cell is linked to another record's date.
      const linkData = resolvedLinks.get(`${page.id}:${fieldToUse}`);
      let raw;
      if (linkData) {
        raw = coerceLinkedDateValue(linkData.value);
        if (!raw) continue;
      } else {
        const dateProp = page.properties?.[fieldToUse];
        if (!dateProp) continue;
        raw = readProp(dateProp);
      }
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

      // Get title — sub-items use sub-schema title field
      let title = "Untitled";
      if (isSubItem && subSchema) {
        const subTitleField = subSchema.title?.name;
        if (subTitleField) title = readProp(page.properties?.[subTitleField]) || "Untitled";
      } else {
        title = titleField ? readProp(page.properties?.[titleField]) || "Untitled" : "Untitled";
      }

      // Get color
      let eventColor = C.accent;
      if (colorField) {
        const colorVal = readProp(page.properties?.[colorField.name]);
        if (colorVal) {
          const opts = colorField.options?.map((o) => o.name) || [];
          const { fill } = getSolidPillColor(colorVal, opts, colorField.options || [], config.colorMapping);
          eventColor = fill;
        }
      }

      if (isSubItem) {
        // Store sub-item events grouped by parent
        const parentId = page._parentRowId;
        if (!childMap[parentId]) childMap[parentId] = [];
        childMap[parentId].push({ title, color: eventColor, page, isSubItem: true });
      } else {
        // Place parent event on all days it spans
        const end = endStr ? parseDateStr(endStr) : null;
        const lastDay = end || start;
        const cur = new Date(start);

        while (cur <= lastDay) {
          const key = cur.toISOString().slice(0, 10);
          if (!map[key]) map[key] = [];
          map[key].push({
            title, color: eventColor, page,
            isStart: cur.getTime() === start.getTime(),
            hasChildren: !!(childMap[page.id]?.length),
          });
          cur.setDate(cur.getDate() + 1);
        }
      }
    }

    // Second pass: mark parent events that have children (child data may arrive after parent)
    for (const key of Object.keys(map)) {
      for (const ev of map[key]) {
        if (childMap[ev.page.id]?.length) ev.hasChildren = true;
      }
    }

    return { eventMap: map, childEventsMap: childMap };
  }, [data, dateField, titleField, colorField, schema, resolvedLinks]);

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

  // Target DB for creating records
  const targetDatabaseId = config.databaseId || pageConfig?.databaseIds?.[0] || pageConfig?.id;

  // Click on a day cell
  const handleDayClick = useCallback((day, e) => {
    if (!day) return;
    const key = toDateStr(year, month, day);
    const events = eventMap[key] || [];

    // Empty day with onCreate — open modal with date prefill
    if (events.length === 0 && onCreate && targetDatabaseId) {
      const prefill = {};
      if (dateField) prefill[dateField] = key;
      record.openNew(prefill);
      return;
    }
    if (events.length === 0) return;

    const rect = e.currentTarget.getBoundingClientRect();
    setPopover({
      x: Math.min(rect.right + 8, window.innerWidth - 340),
      y: Math.min(rect.top, window.innerHeight - 320),
      date: key,
      events,
    });
  }, [year, month, eventMap, onCreate, targetDatabaseId]);

  // Close popover on outside click
  const handleBackdropClick = useCallback(() => { setPopover(null); setExpandedPopoverParent(null); }, []);

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
          {MONTH_NAMES_FULL[month]} {year}
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

        {onCreate && targetDatabaseId && (
          <button
            onClick={() => record.openNew()}
            style={{
              padding: "5px 14px", borderRadius: RADIUS.pill,
              border: `1px solid ${C.accent}44`, background: C.accent + "18",
              cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: FONT,
              color: C.accent, transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.accent + "30"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.accent + "18"; }}
          >
            + New
          </button>
        )}
      </div>

      {/* Day headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", flexShrink: 0 }}>
        {DAY_NAMES.map((d) => (
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
                {day && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={cal.dayNum(isToday)}>{day}</span>
                    {onCreate && targetDatabaseId && key && (
                      <span
                        style={{ fontSize: 14, color: C.darkMuted, cursor: "pointer", lineHeight: 1, padding: "0 2px", opacity: 0.4, transition: "opacity 0.15s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPopover(null);
                          const prefill = {};
                          if (dateField) prefill[dateField] = key;
                          record.openNew(prefill);
                        }}
                        title="Add event"
                      >+</span>
                    )}
                  </div>
                )}
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
            {popover.events.map((ev, i) => {
              const childEvents = childEventsMap[ev.page?.id] || [];
              const isExpanded = expandedPopoverParent === ev.page?.id;
              return (
                <React.Fragment key={i}>
                  <div
                    style={{ ...cal.popItem, cursor: "pointer", borderRadius: RADIUS.md, padding: "6px 4px" }}
                    onClick={(e) => {
                      if ((e.metaKey || e.ctrlKey) && isNeuronsMode()) {
                        e.preventDefault();
                        e.stopPropagation();
                        dispatchNeuronSelect({ node_type: "row", node_id: ev.page?.id, node_label: ev.title || "Untitled" });
                        return;
                      }
                      record.openDetail(ev.page); setPopover(null);
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    {/* Expand chevron for parents with sub-items */}
                    {childEvents.length > 0 && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedPopoverParent(isExpanded ? null : ev.page.id);
                        }}
                        style={{
                          fontSize: 8, color: C.darkMuted, cursor: "pointer",
                          padding: "0 4px 0 0", flexShrink: 0,
                          transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                          transition: "transform 0.15s", display: "inline-block",
                        }}
                      >▶</span>
                    )}
                    <span style={cal.popDot(ev.color)} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ev.title}
                    </span>
                    {showOwner && <OwnerAvatars ownerIds={ev.page?._ownerUserIds} users={teamUsers} size={16} />}
                    {childEvents.length > 0 && (
                      <span style={{ fontSize: 9, color: C.darkMuted, flexShrink: 0 }}>
                        {childEvents.length}
                      </span>
                    )}
                  </div>
                  {/* Expanded sub-items */}
                  {isExpanded && childEvents.map((child, ci) => (
                    <div
                      key={`child-${ci}`}
                      style={{ ...cal.popItem, cursor: "pointer", borderRadius: RADIUS.md, padding: "4px 4px 4px 24px" }}
                      onClick={() => { record.openDetail(child.page); setPopover(null); }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{ ...cal.popDot(child.color), width: 5, height: 5 }} />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: C.darkMuted }}>
                        {child.title}
                      </span>
                    </div>
                  ))}
                </React.Fragment>
              );
            })}
          </div>
        </>
      )}

      <RecordDetailPortals
        hook={record}
        schema={schema}
        pageConfigId={pageConfig?.id}
        databaseId={targetDatabaseId}
        onUpdate={onUpdate}
        onCreate={onCreate}
        resolvedLinks={resolvedLinks}
        onLinkField={onLinkField}
        onUnlinkField={onUnlinkField}
        onCreateOption={onCreateOption}
        onDelete={onDelete}
      />
    </div>
  );
}
