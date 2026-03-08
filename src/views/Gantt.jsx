// ─── Gantt / Timeline View ───
// SVG-based horizontal timeline with zoom, drag-to-reschedule, and frozen sidebar.
// Schema-agnostic — works with any database that has date fields.

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { C, FONT, RADIUS, TIMELINE_PALETTE, VIEW_PALETTE, getStatusColor, getSolidPillColor, resolveViewColor } from "../design/tokens.js";
import { readField, getFieldType, getOptionNames, resolveField } from "./_viewHelpers.js";
import { buildProp } from "../notion/properties.js";
import RecordDetail from "./RecordDetail.jsx";
import { isNeuronsMode, dispatchNeuronSelect } from "../neurons/NeuronsContext.jsx";

// ─── Constants ───

const ZOOM_LEVELS = [
  { key: "1w",  label: "7 days",   days: 7,   pxPerDay: 80  },
  { key: "2w",  label: "14 days",  days: 14,  pxPerDay: 50  },
  { key: "1m",  label: "30 days",  days: 30,  pxPerDay: 28  },
  { key: "3m",  label: "90 days",  days: 90,  pxPerDay: 11  },
  { key: "6m",  label: "6 months", days: 180, pxPerDay: 5   },
  { key: "1y",  label: "1 year",   days: 365, pxPerDay: 2.5 },
];

const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 52;
const SIDEBAR_WIDTH = 240;
const BAR_HEIGHT_WIDE = 24;
const BAR_HEIGHT_NARROW = 6;
const MIN_BAR_PX = 4;

const DAY_MS = 86400000;

// ─── Date Helpers ───

// Parse a date string as local time (avoids UTC off-by-one)
function toLocalDate(str) {
  if (!str) return null;
  const parts = str.split("T")[0].split("-");
  if (parts.length !== 3) return new Date(str);
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function parseDate(v) {
  if (!v) return null;
  if (typeof v === "object" && v.start) return toLocalDate(v.start);
  if (typeof v === "string") return toLocalDate(v);
  return null;
}

function parseDateEnd(v) {
  if (!v) return null;
  if (typeof v === "object" && v.end) return toLocalDate(v.end);
  return null;
}

function formatDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

export default function Gantt({ data = [], schema, config = {}, onUpdate, onRefresh, pageConfig }) {
  const [zoomIndex, setZoomIndex] = useState(2); // Default 30-day
  const [search, setSearch] = useState("");
  const [scrollLeft, setScrollLeft] = useState(0);
  const [tooltip, setTooltip] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [selectedRowIdx, setSelectedRowIdx] = useState(-1);
  const [detailPage, setDetailPage] = useState(null);
  const [isZooming, setIsZooming] = useState(false);
  const svgContainerRef = useRef(null);
  const scrollRef = useRef(null);
  const wrapperRef = useRef(null);

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
      const colorMode = config.colorMode || "dateField";

      // Pre-resolve property color for the row (used when colorMode === "property")
      let propertyColor = null;
      if (colorMode === "property" && colorVal && colorField) {
        const schemaField = (schema.statuses || []).concat(schema.selects || [], schema.multiSelects || []).find((f) => f.name === colorField);
        const resolved = resolveViewColor(colorVal, config.colorMapping, schemaField?.options);
        propertyColor = resolved.hex;
      }

      for (let fi = 0; fi < dateFields.length; fi++) {
        const fieldName = dateFields[fi];
        const raw = readField(page, fieldName);
        if (!raw) continue;

        const start = parseDate(raw);
        const end = parseDateEnd(raw) || (start ? addDays(start, 1) : null);

        if (start) {
          const barColor = (colorMode === "property" && propertyColor)
            ? propertyColor
            : TIMELINE_PALETTE[fi % TIMELINE_PALETTE.length].color;
          bars.push({
            fieldName,
            start: startOfDay(start),
            end: startOfDay(end || addDays(start, 1)),
            color: barColor,
            fieldIndex: fi,
          });
        }
      }

      if (bars.length === 0) continue;

      // Resolve pill color using Wasabi solid palette
      let pillFill = C.darkMuted;
      let pillText = "#fff";
      if (colorVal && colorField) {
        const schemaField = (schema.statuses || []).concat(schema.selects || []).find((f) => f.name === colorField);
        const schemaOpts = schemaField?.options || [];
        const resolved = getSolidPillColor(colorVal, colorOptionNames, schemaOpts);
        pillFill = resolved.fill;
        pillText = resolved.text;
      }

      result.push({
        pageId: page.id,
        page,
        label: label || "Untitled",
        colorVal,
        statusColor: pillFill,
        pillText,
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
  }, [data, schema, dateFields, labelField, colorField, colorOptionNames, search, config.colorMode, config.colorMapping]);

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

  // ─── Keyboard navigation ───

  const handleZoomChange = useCallback((newIndex) => {
    const clamped = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, newIndex));
    if (clamped === zoomIndex) return;

    // Smooth zoom transition
    setIsZooming(true);
    const centerX = scrollRef.current
      ? scrollRef.current.scrollLeft + scrollRef.current.clientWidth / 2
      : 0;
    const centerDay = centerX / zoom.pxPerDay;

    setZoomIndex(clamped);

    // Re-center after zoom
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        const newZoom = ZOOM_LEVELS[clamped];
        const newCenterX = centerDay * newZoom.pxPerDay;
        scrollRef.current.scrollLeft = newCenterX - scrollRef.current.clientWidth / 2;
      }
      setTimeout(() => setIsZooming(false), 200);
    });
  }, [zoomIndex, zoom.pxPerDay]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const handleKeyDown = (e) => {
      // Don't capture when typing in search input
      if (e.target.tagName === "INPUT") return;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setSelectedRowIdx((prev) => Math.max(0, prev - 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedRowIdx((prev) => Math.min(rows.length - 1, prev + 1));
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (scrollRef.current) scrollRef.current.scrollLeft -= zoom.pxPerDay * 3;
          break;
        case "ArrowRight":
          e.preventDefault();
          if (scrollRef.current) scrollRef.current.scrollLeft += zoom.pxPerDay * 3;
          break;
        case "+":
        case "=":
          e.preventDefault();
          handleZoomChange(zoomIndex - 1); // zoom in = fewer days
          break;
        case "-":
        case "_":
          e.preventDefault();
          handleZoomChange(zoomIndex + 1); // zoom out = more days
          break;
        case "t":
        case "T":
          e.preventDefault();
          // Jump to today
          if (todayOffset !== null && scrollRef.current) {
            scrollRef.current.scrollLeft = todayOffset - scrollRef.current.clientWidth / 3;
          }
          break;
        case "Escape":
          setSelectedRowIdx(-1);
          break;
        default:
          break;
      }
    };

    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [rows.length, zoomIndex, zoom.pxPerDay, todayOffset, handleZoomChange]);

  // Scroll selected row into view
  useEffect(() => {
    if (selectedRowIdx < 0) return;
    const sidebar = wrapperRef.current?.querySelector(".gantt-sidebar-scroll");
    if (!sidebar) return;
    const rowTop = selectedRowIdx * dynamicRowHeight;
    const rowBottom = rowTop + dynamicRowHeight;
    if (rowTop < sidebar.scrollTop) {
      sidebar.scrollTop = rowTop;
    } else if (rowBottom > sidebar.scrollTop + sidebar.clientHeight) {
      sidebar.scrollTop = rowBottom - sidebar.clientHeight;
    }
  }, [selectedRowIdx]);

  // ─── Bar dimensions ───

  const barFieldCount = (config.barFields || []).length;
  const LABEL_LINE_H = 14;
  const baseBarHeight = zoom.pxPerDay >= 20 ? BAR_HEIGHT_WIDE : BAR_HEIGHT_NARROW;
  const barHeight = zoom.pxPerDay >= 20
    ? BAR_HEIGHT_WIDE + (barFieldCount * LABEL_LINE_H)
    : BAR_HEIGHT_NARROW;
  const dynamicRowHeight = Math.max(ROW_HEIGHT, barHeight + 16);
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

  const contentHeight = rows.length * dynamicRowHeight;

  return (
    <div
      ref={wrapperRef}
      tabIndex={0}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        fontFamily: FONT,
        overflow: "hidden",
        outline: "none",
      }}
    >
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
              onClick={() => handleZoomChange(i)}
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

        {/* Keyboard hint */}
        <span style={{ fontSize: 10, color: C.darkMuted + "88", letterSpacing: "0.02em" }} title="Arrow keys navigate, +/- zoom, T = today, Esc = deselect">
          ⌨
        </span>

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

        {/* Legend — switches based on color mode */}
        <div style={{ display: "flex", gap: 10, marginLeft: 8, flexWrap: "wrap" }}>
          {(config.colorMode === "property" && colorField) ? (
            // Property-based legend: show each option value with its mapped color
            colorOptionNames.slice(0, 8).map((optName) => {
              const schemaField = (schema?.statuses || []).concat(schema?.selects || [], schema?.multiSelects || []).find((f) => f.name === colorField);
              const resolved = resolveViewColor(optName, config.colorMapping, schemaField?.options);
              return (
                <span key={optName} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: C.darkMuted }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: resolved.hex, display: "inline-block" }} />
                  {optName}
                </span>
              );
            })
          ) : (
            // Date field legend (default)
            dateFields.map((fname, i) => {
              const palette = TIMELINE_PALETTE[i % TIMELINE_PALETTE.length];
              return (
                <span key={fname} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: C.darkMuted }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: palette.color, display: "inline-block" }} />
                  {fname}
                </span>
              );
            })
          )}
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
                data-neuron-node={`row:${row.pageId}`}
                onClick={(e) => {
                  if ((e.metaKey || e.ctrlKey) && isNeuronsMode()) {
                    e.preventDefault();
                    e.stopPropagation();
                    dispatchNeuronSelect({ node_type: "row", node_id: row.pageId, node_label: row.label || "Untitled" });
                    return;
                  }
                  setSelectedRowIdx(i);
                }}
                onDoubleClick={() => setDetailPage(row.page)}
                style={{
                  height: dynamicRowHeight,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 12px",
                  gap: 8,
                  borderBottom: `1px solid ${C.edgeLine}`,
                  overflow: "hidden",
                  background: i === selectedRowIdx ? `${C.accent}14` : "transparent",
                  cursor: "pointer",
                  transition: "background 0.12s",
                  flexWrap: "wrap",
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
                  minWidth: 0,
                }}>
                  {row.label}
                </span>

                {/* Sidebar badges from config.sidebarFields */}
                {(config.sidebarFields || []).map((fieldName) => {
                  const val = readField(row.page, fieldName);
                  if (!val) return null;
                  const schemaField = (schema.statuses || []).concat(schema.selects || [], schema.multiSelects || []).find((f) => f.name === fieldName);
                  const resolved = resolveViewColor(String(val), config.colorMapping, schemaField?.options);
                  return (
                    <span key={fieldName} style={{
                      fontSize: 8,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: resolved.text,
                      background: resolved.hex,
                      borderRadius: RADIUS.pill,
                      padding: "1px 6px",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}>
                      {String(val)}
                    </span>
                  );
                })}
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
          <div style={{
            width: totalWidth,
            minHeight: "100%",
            transition: isZooming ? "width 0.2s ease-out" : "none",
          }}>
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

                {/* Row lines + selected row highlight */}
                {rows.map((_, i) => (
                  <g key={`rl-${i}`}>
                    {i === selectedRowIdx && (
                      <rect
                        x={0}
                        y={i * dynamicRowHeight}
                        width={totalWidth}
                        height={dynamicRowHeight}
                        fill={C.accent}
                        opacity={0.06}
                      />
                    )}
                    <line
                      x1={0}
                      y1={(i + 1) * dynamicRowHeight}
                      x2={totalWidth}
                      y2={(i + 1) * dynamicRowHeight}
                      stroke={C.edgeLine}
                      strokeWidth={1}
                    />
                  </g>
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
                  const y = rowIdx * dynamicRowHeight + (dynamicRowHeight - barHeight) / 2;

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
                          onDoubleClick={(e) => { e.stopPropagation(); setDetailPage(row.page); }}
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
                            y={y + (barFieldCount > 0 ? 14 : barHeight / 2)}
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

                        {/* Bar property labels (from config.barFields) */}
                        {showBarLabels && w > 60 && (config.barFields || []).map((fieldName, idx) => {
                          const val = readField(row.page, fieldName);
                          if (!val) return null;
                          return (
                            <text
                              key={fieldName}
                              x={x + 8}
                              y={y + 14 + ((idx + 1) * LABEL_LINE_H)}
                              dominantBaseline="middle"
                              fill="rgba(255,255,255,0.8)"
                              fontSize={9}
                              fontFamily={FONT}
                              style={{ pointerEvents: "none" }}
                            >
                              {String(val).slice(0, Math.floor(w / 6))}
                            </text>
                          );
                        })}

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

      {detailPage && (
        <RecordDetail
          page={detailPage}
          schema={schema}
          onClose={() => setDetailPage(null)}
          onUpdate={onUpdate}
          pageConfigId={pageConfig?.id}
        />
      )}
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
