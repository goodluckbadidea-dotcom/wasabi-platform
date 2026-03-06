// ─── Gantt / Timeline View ───
// SVG-based horizontal timeline with zoom, drag-to-reschedule, and frozen sidebar.
// Schema-agnostic — works with any database that has date fields.

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { C, FONT, RADIUS, TIMELINE_PALETTE, getStatusColor } from "../design/tokens.js";
import { readField, getFieldType, getOptionNames, resolveField } from "./_viewHelpers.js";
import { buildProp } from "../notion/properties.js";

// ─── Constants ───

const ZOOM_LEVELS = [
  { key: "1w",  label: "7 days",   days: 7,   pxPerDay: 80  },
  { key: "1m",  label: "30 days",  days: 30,  pxPerDay: 28  },
  { key: "3m",  label: "90 days",  days: 90,  pxPerDay: 11  },
  { key: "6m",  label: "6 months", days: 180, pxPerDay: 5   },
];

const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 52;
const SIDEBAR_WIDTH = 240;
const BAR_HEIGHT_WIDE = 24;
const BAR_HEIGHT_NARROW = 6;
const MIN_BAR_PX = 4;

const DAY_MS = 86400000;

// ─── Date Helpers ───

function parseDate(v) {
  if (!v) return null;
  if (typeof v === "object" && v.start) return new Date(v.start);
  if (typeof v === "string") return new Date(v);
  return null;
}

function parseDateEnd(v) {
  if (!v) return null;
  if (typeof v === "object" && v.end) return new Date(v.end);
  return null;
}

function formatDateISO(d) {
  return d.toISOString().split("T")[0];
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function diffDays(a, b) {
  return Math.round((b - a) / DAY_MS);
}

function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─── Generate timeline headers ───

function buildHeaders(origin, days, pxPerDay) {
  const months = [];
  const dayHeaders = [];

  let prevMonth = -1;
  let monthStart = 0;

  for (let i = 0; i <= days; i++) {
    const d = addDays(origin, i);
    const month = d.getMonth();
    const year = d.getFullYear();

    if (month !== prevMonth) {
      if (prevMonth >= 0) {
        months.push({ label: `${MONTHS[prevMonth]} ${year}`, x: monthStart * pxPerDay, width: (i - monthStart) * pxPerDay });
      }
      monthStart = i;
      prevMonth = month;
    }

    if (pxPerDay >= 20) {
      dayHeaders.push({
        label: String(d.getDate()),
        dayName: DAYS_SHORT[d.getDay()],
        x: i * pxPerDay,
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
        isToday: formatDateISO(d) === formatDateISO(new Date()),
      });
    }
  }

  // Last month
  if (prevMonth >= 0) {
    const d = addDays(origin, days);
    months.push({
      label: `${MONTHS[prevMonth]} ${d.getFullYear()}`,
      x: monthStart * pxPerDay,
      width: (days + 1 - monthStart) * pxPerDay,
    });
  }

  return { months, dayHeaders };
}

// ─── Main Component ───

export default function Gantt({ data = [], schema, config = {}, onUpdate, onRefresh }) {
  const [zoomIndex, setZoomIndex] = useState(1); // Default 30-day
  const [search, setSearch] = useState("");
  const [scrollLeft, setScrollLeft] = useState(0);
  const [tooltip, setTooltip] = useState(null);
  const [dragState, setDragState] = useState(null);
  const svgContainerRef = useRef(null);
  const scrollRef = useRef(null);

  const zoom = ZOOM_LEVELS[zoomIndex];

  // ─── Resolve fields from config / schema ───

  const dateFields = useMemo(() => {
    if (config.dateFields?.length) return config.dateFields;
    if (!schema) return [];
    return (schema.dates || []).map((f) => f.name).slice(0, 3);
  }, [config.dateFields, schema]);

  const labelField = resolveField(schema, config.labelField, ["title"]);
  const colorField = resolveField(schema, config.colorField, ["statuses", "selects"]);
  const colorOptionNames = colorField ? getOptionNames(schema, colorField) : [];

  // ─── Process data into timeline rows ───

  const rows = useMemo(() => {
    if (!schema || dateFields.length === 0) return [];

    const result = [];
    for (const page of data) {
      const label = labelField ? readField(page, labelField) : "Untitled";
      const colorVal = colorField ? readField(page, colorField) : null;

      // Search filter
      if (search) {
        const q = search.toLowerCase();
        if (!(label || "").toLowerCase().includes(q)) continue;
      }

      // Extract date bars (one per dateField, or start/end pair from first field)
      const bars = [];

      for (let fi = 0; fi < dateFields.length; fi++) {
        const fieldName = dateFields[fi];
        const raw = readField(page, fieldName);
        if (!raw) continue;

        const start = parseDate(raw);
        const end = parseDateEnd(raw) || (start ? addDays(start, 1) : null);

        if (start) {
          const palette = TIMELINE_PALETTE[fi % TIMELINE_PALETTE.length];
          bars.push({
            fieldName,
            start: startOfDay(start),
            end: startOfDay(end || addDays(start, 1)),
            color: palette.color,
            fieldIndex: fi,
          });
        }
      }

      if (bars.length === 0) continue;

      result.push({
        pageId: page.id,
        label: label || "Untitled",
        colorVal,
        statusColor: colorVal ? getStatusColor(colorVal, colorOptionNames) : C.darkMuted,
        bars,
      });
    }

    // Sort by earliest bar start
    result.sort((a, b) => {
      const aMin = Math.min(...a.bars.map((b) => b.start.getTime()));
      const bMin = Math.min(...b.bars.map((b) => b.start.getTime()));
      return aMin - bMin;
    });

    return result;
  }, [data, schema, dateFields, labelField, colorField, colorOptionNames, search]);

  // ─── Compute timeline origin + bounds ───

  const { origin, totalDays, totalWidth } = useMemo(() => {
    if (rows.length === 0) {
      const today = startOfDay(new Date());
      return { origin: addDays(today, -3), totalDays: zoom.days, totalWidth: zoom.days * zoom.pxPerDay };
    }

    let minDate = Infinity;
    let maxDate = -Infinity;
    for (const row of rows) {
      for (const bar of row.bars) {
        if (bar.start.getTime() < minDate) minDate = bar.start.getTime();
        if (bar.end.getTime() > maxDate) maxDate = bar.end.getTime();
      }
    }

    const earliest = new Date(minDate);
    const latest = new Date(maxDate);
    const originDate = addDays(startOfDay(earliest), -3);
    const span = diffDays(originDate, latest) + 7;
    const days = Math.max(span, zoom.days);
    return { origin: originDate, totalDays: days, totalWidth: days * zoom.pxPerDay };
  }, [rows, zoom]);

  // ─── Headers ───

  const { months, dayHeaders } = useMemo(() => buildHeaders(origin, totalDays, zoom.pxPerDay), [origin, totalDays, zoom.pxPerDay]);

  // ─── Today marker ───

  const todayOffset = useMemo(() => {
    const today = startOfDay(new Date());
    const off = diffDays(origin, today);
    if (off < 0 || off > totalDays) return null;
    return off * zoom.pxPerDay;
  }, [origin, totalDays, zoom.pxPerDay]);

  // ─── Bar dimensions ───

  const barHeight = zoom.pxPerDay >= 20 ? BAR_HEIGHT_WIDE : BAR_HEIGHT_NARROW;
  const showBarLabels = zoom.pxPerDay >= 20;

  // ─── Scroll to today on mount ───

  useEffect(() => {
    if (todayOffset !== null && scrollRef.current) {
      const containerWidth = scrollRef.current.clientWidth;
      const scrollTarget = Math.max(0, todayOffset - containerWidth / 3);
      scrollRef.current.scrollLeft = scrollTarget;
    }
  }, [todayOffset]);

  // ─── Drag-to-reschedule ───

  const handleBarMouseDown = useCallback((e, row, bar) => {
    if (!onUpdate) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = svgContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Determine drag mode: resize-start, resize-end, or move
    let mode = "move";
    if (bar._forceMode) {
      mode = bar._forceMode;
    } else {
      const barStartPx = diffDays(origin, bar.start) * zoom.pxPerDay;
      const barEndPx = diffDays(origin, bar.end) * zoom.pxPerDay;
      const barWidthPx = barEndPx - barStartPx;
      const clickX = e.clientX - rect.left + (scrollRef.current?.scrollLeft || 0);
      const relX = clickX - barStartPx;
      const edgeThreshold = Math.min(8, barWidthPx / 4);

      if (relX <= edgeThreshold) mode = "resize-start";
      else if (relX >= barWidthPx - edgeThreshold) mode = "resize-end";
    }

    setDragState({
      pageId: row.pageId,
      fieldName: bar.fieldName,
      mode,
      originalStart: bar.start,
      originalEnd: bar.end,
      startX: e.clientX,
      currentStart: bar.start,
      currentEnd: bar.end,
    });
  }, [onUpdate, origin, zoom.pxPerDay]);

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e) => {
      const dx = e.clientX - dragState.startX;
      const dayDelta = Math.round(dx / zoom.pxPerDay);

      let newStart = dragState.originalStart;
      let newEnd = dragState.originalEnd;

      if (dragState.mode === "move") {
        newStart = addDays(dragState.originalStart, dayDelta);
        newEnd = addDays(dragState.originalEnd, dayDelta);
      } else if (dragState.mode === "resize-start") {
        newStart = addDays(dragState.originalStart, dayDelta);
        if (newStart >= dragState.originalEnd) newStart = addDays(dragState.originalEnd, -1);
      } else if (dragState.mode === "resize-end") {
        newEnd = addDays(dragState.originalEnd, dayDelta);
        if (newEnd <= dragState.originalStart) newEnd = addDays(dragState.originalStart, 1);
      }

      setDragState((prev) => ({ ...prev, currentStart: newStart, currentEnd: newEnd }));
    };

    const handleMouseUp = () => {
      if (onUpdate && dragState.fieldName) {
        const fieldType = getFieldType(schema, dragState.fieldName);
        if (fieldType === "date") {
          const startStr = formatDateISO(dragState.currentStart);
          const endStr = formatDateISO(dragState.currentEnd);
          const dateValue = diffDays(dragState.currentStart, dragState.currentEnd) > 1
            ? { start: startStr, end: endStr }
            : startStr;
          const propPayload = buildProp("date", dateValue);
          if (propPayload) {
            onUpdate(dragState.pageId, dragState.fieldName, propPayload);
          }
        }
      }
      setDragState(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, onUpdate, schema, zoom.pxPerDay]);

  // ─── Get bar position (accounting for drag) ───

  const getBarRect = useCallback((row, bar) => {
    let start = bar.start;
    let end = bar.end;

    // If this bar is being dragged, use drag state
    if (dragState && dragState.pageId === row.pageId && dragState.fieldName === bar.fieldName) {
      start = dragState.currentStart;
      end = dragState.currentEnd;
    }

    const x = diffDays(origin, start) * zoom.pxPerDay;
    const w = Math.max(MIN_BAR_PX, diffDays(start, end) * zoom.pxPerDay);
    return { x, w };
  }, [origin, zoom.pxPerDay, dragState]);

  // ─── Render ───

  if (!schema) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        Loading schema...
      </div>
    );
  }

  if (dateFields.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        No date fields found for timeline. Add a date property to your database.
      </div>
    );
  }

  const contentHeight = rows.length * ROW_HEIGHT;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      fontFamily: FONT,
      overflow: "hidden",
    }}>
      {/* ─── Toolbar ─── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 16px",
        borderBottom: `1px solid ${C.edgeLine}`,
        gap: 8,
        flexShrink: 0,
      }}>
        {/* Zoom buttons */}
        <div style={{ display: "flex", gap: 2, background: C.darkSurf, borderRadius: RADIUS.lg, padding: 2 }}>
          {ZOOM_LEVELS.map((z, i) => (
            <button
              key={z.key}
              onClick={() => setZoomIndex(i)}
              style={{
                border: "none",
                background: i === zoomIndex ? C.accent : "transparent",
                color: i === zoomIndex ? "#fff" : C.darkMuted,
                fontSize: 11,
                fontWeight: 600,
                fontFamily: FONT,
                padding: "4px 10px",
                borderRadius: RADIUS.md,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {z.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            marginLeft: "auto",
            width: 180,
            padding: "5px 10px",
            fontSize: 12,
            fontFamily: FONT,
            border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.md,
            background: C.darkSurf,
            color: C.darkText,
            outline: "none",
          }}
        />

        {/* Date field legend */}
        <div style={{ display: "flex", gap: 10, marginLeft: 8 }}>
          {dateFields.map((fname, i) => {
            const palette = TIMELINE_PALETTE[i % TIMELINE_PALETTE.length];
            return (
              <span key={fname} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: C.darkMuted }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: palette.color, display: "inline-block" }} />
                {fname}
              </span>
            );
          })}
        </div>

        <span style={{ fontSize: 11, color: C.darkMuted }}>
          {rows.length} item{rows.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ─── Timeline body ─── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Frozen sidebar */}
        <div style={{
          width: SIDEBAR_WIDTH,
          minWidth: SIDEBAR_WIDTH,
          borderRight: `1px solid ${C.edgeLine}`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          {/* Sidebar header */}
          <div style={{
            height: HEADER_HEIGHT,
            minHeight: HEADER_HEIGHT,
            display: "flex",
            alignItems: "flex-end",
            padding: "0 12px 6px",
            borderBottom: `1px solid ${C.edgeLine}`,
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: C.darkMuted }}>
              {labelField || "Items"}
            </span>
          </div>

          {/* Sidebar rows */}
          <div style={{ flex: 1, overflowY: "auto" }} className="gantt-sidebar-scroll">
            {rows.map((row, i) => (
              <div
                key={row.pageId}
                style={{
                  height: ROW_HEIGHT,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 12px",
                  gap: 8,
                  borderBottom: `1px solid ${C.edgeLine}`,
                  overflow: "hidden",
                }}
              >
                {/* Status dot */}
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: row.statusColor,
                  flexShrink: 0,
                }} />

                {/* Label */}
                <span style={{
                  fontSize: 12,
                  color: C.darkText,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}>
                  {row.label}
                </span>

                {/* Status pill */}
                {row.colorVal && (
                  <span style={{
                    fontSize: 9,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: row.statusColor,
                    background: row.statusColor + "18",
                    border: `1px solid ${row.statusColor}40`,
                    borderRadius: RADIUS.pill,
                    padding: "1px 6px",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}>
                    {row.colorVal}
                  </span>
                )}
              </div>
            ))}

            {rows.length === 0 && (
              <div style={{ padding: 20, textAlign: "center", color: C.darkMuted, fontSize: 12 }}>
                No items with dates
              </div>
            )}
          </div>
        </div>

        {/* Scrollable timeline area */}
        <div
          ref={scrollRef}
          style={{ flex: 1, overflow: "auto", position: "relative" }}
          onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        >
          <div style={{ width: totalWidth, minHeight: "100%" }}>
            {/* ─── Header ─── */}
            <div style={{
              position: "sticky",
              top: 0,
              zIndex: 10,
              height: HEADER_HEIGHT,
              background: C.dark,
              borderBottom: `1px solid ${C.edgeLine}`,
            }}>
              {/* Month row */}
              <div style={{ height: 24, position: "relative", overflow: "hidden" }}>
                {months.map((m, i) => (
                  <div key={i} style={{
                    position: "absolute",
                    left: m.x,
                    width: m.width,
                    height: 24,
                    display: "flex",
                    alignItems: "center",
                    paddingLeft: 8,
                    fontSize: 11,
                    fontWeight: 600,
                    color: C.darkText,
                    borderRight: `1px solid ${C.edgeLine}`,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                  }}>
                    {m.label}
                  </div>
                ))}
              </div>

              {/* Day row (only at wide zoom) */}
              {dayHeaders.length > 0 && (
                <div style={{ height: 28, position: "relative", overflow: "hidden" }}>
                  {dayHeaders.map((d, i) => (
                    <div key={i} style={{
                      position: "absolute",
                      left: d.x,
                      width: zoom.pxPerDay,
                      height: 28,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      color: d.isToday ? C.accent : d.isWeekend ? C.darkMuted + "66" : C.darkMuted,
                      fontWeight: d.isToday ? 700 : 400,
                      borderRight: `1px solid ${C.edgeLine}`,
                    }}>
                      <span>{d.label}</span>
                      {zoom.pxPerDay >= 40 && <span style={{ fontSize: 8, opacity: 0.5 }}>{d.dayName}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ─── Grid area (SVG) ─── */}
            <div ref={svgContainerRef} style={{ position: "relative" }}>
              <svg
                width={totalWidth}
                height={Math.max(contentHeight, 200)}
                style={{ display: "block" }}
              >
                {/* Weekend stripes */}
                {dayHeaders.filter((d) => d.isWeekend).map((d, i) => (
                  <rect
                    key={`we-${i}`}
                    x={d.x}
                    y={0}
                    width={zoom.pxPerDay}
                    height={Math.max(contentHeight, 200)}
                    fill={C.darkSurf}
                    opacity={0.4}
                  />
                ))}

                {/* Row lines */}
                {rows.map((_, i) => (
                  <line
                    key={`rl-${i}`}
                    x1={0}
                    y1={(i + 1) * ROW_HEIGHT}
                    x2={totalWidth}
                    y2={(i + 1) * ROW_HEIGHT}
                    stroke={C.edgeLine}
                    strokeWidth={1}
                  />
                ))}

                {/* Today marker */}
                {todayOffset !== null && (
                  <g>
                    <line
                      x1={todayOffset}
                      y1={0}
                      x2={todayOffset}
                      y2={Math.max(contentHeight, 200)}
                      stroke={C.accent}
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      opacity={0.7}
                    />
                    <circle
                      cx={todayOffset}
                      cy={0}
                      r={4}
                      fill={C.accent}
                    />
                  </g>
                )}

                {/* ─── Bars ─── */}
                {rows.map((row, rowIdx) => {
                  const y = rowIdx * ROW_HEIGHT + (ROW_HEIGHT - barHeight) / 2;

                  return row.bars.map((bar, barIdx) => {
                    const { x, w } = getBarRect(row, bar);
                    const isDragging = dragState?.pageId === row.pageId && dragState?.fieldName === bar.fieldName;
                    const radius = barHeight >= 16 ? 6 : 3;

                    return (
                      <g key={`${row.pageId}-${barIdx}`}>
                        {/* Bar background */}
                        <rect
                          x={x}
                          y={y}
                          width={w}
                          height={barHeight}
                          rx={radius}
                          ry={radius}
                          fill={bar.color}
                          opacity={isDragging ? 0.9 : 0.75}
                          style={{
                            cursor: onUpdate ? (isDragging ? "grabbing" : "grab") : "default",
                            filter: isDragging ? "drop-shadow(0 2px 6px rgba(0,0,0,0.3))" : "none",
                            transition: isDragging ? "none" : "all 0.2s ease",
                          }}
                          onMouseDown={(e) => handleBarMouseDown(e, row, bar)}
                          onMouseEnter={(e) => {
                            const svgRect = svgContainerRef.current?.getBoundingClientRect();
                            if (svgRect) {
                              setTooltip({
                                x: e.clientX - svgRect.left,
                                y: y - 4,
                                label: row.label,
                                field: bar.fieldName,
                                start: formatDateISO(isDragging ? dragState.currentStart : bar.start),
                                end: formatDateISO(isDragging ? dragState.currentEnd : bar.end),
                                days: diffDays(
                                  isDragging ? dragState.currentStart : bar.start,
                                  isDragging ? dragState.currentEnd : bar.end
                                ),
                              });
                            }
                          }}
                          onMouseLeave={() => !isDragging && setTooltip(null)}
                        />

                        {/* Bar label (only at wide zoom) */}
                        {showBarLabels && w > 60 && (
                          <text
                            x={x + 8}
                            y={y + barHeight / 2}
                            dominantBaseline="middle"
                            fill="#fff"
                            fontSize={11}
                            fontWeight={600}
                            fontFamily={FONT}
                            style={{ pointerEvents: "none" }}
                          >
                            {row.label.length > Math.floor(w / 7) ? row.label.slice(0, Math.floor(w / 7) - 2) + "…" : row.label}
                          </text>
                        )}

                        {/* Resize handles at wide zoom */}
                        {showBarLabels && onUpdate && w > 20 && (
                          <>
                            <rect
                              x={x}
                              y={y}
                              width={6}
                              height={barHeight}
                              fill="transparent"
                              style={{ cursor: "ew-resize" }}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleBarMouseDown(e, row, { ...bar, _forceMode: "resize-start" });
                              }}
                            />
                            <rect
                              x={x + w - 6}
                              y={y}
                              width={6}
                              height={barHeight}
                              fill="transparent"
                              style={{ cursor: "ew-resize" }}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleBarMouseDown(e, row, { ...bar, _forceMode: "resize-end" });
                              }}
                            />
                          </>
                        )}
                      </g>
                    );
                  });
                })}
              </svg>

              {/* Tooltip */}
              {tooltip && !dragState && (
                <div style={{
                  position: "absolute",
                  left: tooltip.x + 12,
                  top: tooltip.y - 8,
                  background: C.darkSurf2,
                  border: `1px solid ${C.darkBorder}`,
                  borderRadius: RADIUS.lg,
                  padding: "8px 12px",
                  zIndex: 20,
                  pointerEvents: "none",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                  minWidth: 160,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.darkText, marginBottom: 4 }}>
                    {tooltip.label}
                  </div>
                  <div style={{ fontSize: 11, color: C.darkMuted }}>
                    {tooltip.field}
                  </div>
                  <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 2 }}>
                    {tooltip.start} → {tooltip.end}
                  </div>
                  <div style={{ fontSize: 11, color: C.accent, marginTop: 2 }}>
                    {tooltip.days} day{tooltip.days !== 1 ? "s" : ""}
                  </div>
                </div>
              )}

              {/* Drag tooltip */}
              {dragState && (
                <div style={{
                  position: "fixed",
                  left: "50%",
                  bottom: 24,
                  transform: "translateX(-50%)",
                  background: C.accent,
                  color: "#fff",
                  padding: "6px 16px",
                  borderRadius: RADIUS.pill,
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: FONT,
                  zIndex: 100,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                  pointerEvents: "none",
                }}>
                  {formatDateISO(dragState.currentStart)} → {formatDateISO(dragState.currentEnd)}
                  {" · "}
                  {diffDays(dragState.currentStart, dragState.currentEnd)} day{diffDays(dragState.currentStart, dragState.currentEnd) !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Sync sidebar scroll with timeline scroll ─── */}
      <SyncScroll scrollRef={scrollRef} />
    </div>
  );
}

// ─── Scroll sync component ───
// Keeps sidebar Y-scroll in sync with timeline Y-scroll

function SyncScroll({ scrollRef }) {
  useEffect(() => {
    const timeline = scrollRef.current;
    if (!timeline) return;

    const sidebar = timeline.parentElement?.querySelector(".gantt-sidebar-scroll");
    if (!sidebar) return;

    const handleTimelineScroll = () => {
      sidebar.scrollTop = timeline.scrollTop;
    };
    const handleSidebarScroll = () => {
      timeline.scrollTop = sidebar.scrollTop;
    };

    timeline.addEventListener("scroll", handleTimelineScroll);
    sidebar.addEventListener("scroll", handleSidebarScroll);

    return () => {
      timeline.removeEventListener("scroll", handleTimelineScroll);
      sidebar.removeEventListener("scroll", handleSidebarScroll);
    };
  }, [scrollRef]);

  return null;
}
