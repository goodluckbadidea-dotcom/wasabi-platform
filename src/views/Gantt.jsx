// ─── Gantt / Timeline View ───
// SVG-based horizontal timeline with zoom, drag-to-reschedule, and frozen sidebar.
// Schema-agnostic — works with any database that has date fields.

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { C, FONT, RADIUS, TIMELINE_PALETTE, VIEW_PALETTE, getStatusColor, getSolidPillColor, resolveViewColor, isLightColor } from "../design/tokens.js";
import { readField, getFieldType, getOptionNames, resolveField } from "./_viewHelpers.js";
import { buildProp } from "../notion/properties.js";
import RecordDetail from "./RecordDetail.jsx";
import { DAY_NAMES, MONTH_NAMES } from "../utils/helpers.js";
import NewRecordModal from "./NewRecordModal.jsx";
import { isNeuronsMode, dispatchNeuronSelect } from "../neurons/NeuronsContext.jsx";
import OwnerAvatars from "../components/OwnerAvatars.jsx";
import { listUserDirectory } from "../lib/api.js";

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

// DAY_NAMES and MONTH_NAMES imported from utils/helpers.js

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
        months.push({ label: `${MONTH_NAMES[prevMonth]} ${year}`, x: monthStart * pxPerDay, width: (i - monthStart) * pxPerDay });
      }
      monthStart = i;
      prevMonth = month;
    }

    if (pxPerDay >= 20) {
      dayHeaders.push({
        label: String(d.getDate()),
        dayName: DAY_NAMES[d.getDay()],
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
      label: `${MONTH_NAMES[prevMonth]} ${d.getFullYear()}`,
      x: monthStart * pxPerDay,
      width: (days + 1 - monthStart) * pxPerDay,
    });
  }

  return { months, dayHeaders };
}

// ─── Main Component ───

const DEFAULT_ZOOM_INDEX = 3; // 90-day default

// Convert a resolved linked value back into a date-field-shaped value the
// existing parseDate/parseDateEnd helpers understand. Date ranges resolve to
// "YYYY-MM-DD – YYYY-MM-DD"; single dates stay as plain strings.
function coerceLinkedDateValue(linkedValue) {
  if (linkedValue == null || linkedValue === "") return null;
  if (typeof linkedValue === "object") return linkedValue;
  if (typeof linkedValue === "string" && linkedValue.includes("–")) {
    const [start, end] = linkedValue.split("–").map((s) => s.trim());
    return { start, end };
  }
  return linkedValue;
}

export default function Gantt({ data = [], schema, config = {}, onUpdate, onRefresh, onCreate, onDelete, pageConfig, onViewConfigChange, resolvedLinks, onLinkField, onUnlinkField, onCreateOption }) {
  // Cell links are resolved once by ViewRenderer and passed in, so every
  // view shows the same linked values and offers the same link actions.

  const preferredZoomIndex = useMemo(() => {
    if (config.preferredZoom) {
      const idx = ZOOM_LEVELS.findIndex(z => z.key === config.preferredZoom);
      if (idx !== -1) return idx;
    }
    return DEFAULT_ZOOM_INDEX;
  }, []); // Only compute on mount
  const [zoomIndex, setZoomIndex] = useState(preferredZoomIndex);
  const [search, setSearch] = useState("");
  const [scrollLeft, setScrollLeft] = useState(0);
  const [tooltip, setTooltip] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [selectedRowIdx, setSelectedRowIdx] = useState(-1);
  const [detailPage, setDetailPage] = useState(null);
  const lastRowClickRef = useRef({ id: null, time: 0 });
  const [isZooming, setIsZooming] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const showOwner = !!config.showOwner;
  const [teamUsers, setTeamUsers] = useState([]);
  useEffect(() => {
    if (!showOwner) return;
    listUserDirectory().then((res) => setTeamUsers(res.users || [])).catch(() => {});
  }, [showOwner]);
  const [addTitle, setAddTitle] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const svgContainerRef = useRef(null);
  const scrollRef = useRef(null);
  const wrapperRef = useRef(null);

  const zoom = ZOOM_LEVELS[zoomIndex];

  // ─── Resolve fields from config / schema ───

  // All available date fields in the schema
  const allDateFields = useMemo(() => {
    if (!schema) return [];
    return (schema.dates || []).map((f) => f.name);
  }, [schema]);

  // Active date fields: user-selected subset, or all by default
  const dateFields = useMemo(() => {
    if (config.dateFields?.length) return config.dateFields;
    return allDateFields;
  }, [config.dateFields, allDateFields]);

  const labelField = resolveField(schema, config.labelField, ["title"]);
  const colorField = resolveField(schema, config.colorField, ["statuses", "selects"]);
  const colorOptionNames = colorField ? getOptionNames(schema, colorField) : [];

  // ─── Sub-item date fields from sub-schema ───
  const subSchema = schema?._subSchema || null;
  const subDateFields = useMemo(() => {
    if (!subSchema) return [];
    return (subSchema.dates || []).map((f) => f.name);
  }, [subSchema]);

  // ─── Expand/collapse state for parent rows ───
  const [expandedParents, setExpandedParents] = useState({});
  const toggleParentExpand = useCallback((pageId) => {
    setExpandedParents((prev) => ({ ...prev, [pageId]: !prev[pageId] }));
  }, []);

  // ─── Process data into timeline rows (with hierarchy) ───

  const { rows, parentRowMap } = useMemo(() => {
    if (!schema || dateFields.length === 0) return { rows: [], parentRowMap: {} };

    const colorMode = config.colorMode || "dateField";

    // Helper: build bars for a page using a given set of date fields and schema
    const buildBars = (page, fields, schemaForColor) => {
      const bars = [];
      const colorVal = colorField ? readField(page, colorField) : null;

      let propertyColor = null;
      if (colorMode === "property" && colorVal && colorField) {
        const schemaField = (schemaForColor.statuses || []).concat(schemaForColor.selects || [], schemaForColor.multiSelects || []).find((f) => f.name === colorField);
        if (schemaField) {
          const resolved = resolveViewColor(colorVal, config.colorMapping, schemaField?.options);
          propertyColor = resolved.hex;
        }
      }

      for (let fi = 0; fi < fields.length; fi++) {
        const fieldName = fields[fi];
        // Prefer linked value if this cell is linked to a source record.
        // resolvedLinks key: "<pageId>:<fieldName>" (same as Table view).
        const linkData = resolvedLinks.get(`${page.id}:${fieldName}`);
        let raw;
        if (linkData) {
          raw = coerceLinkedDateValue(linkData.value);
        } else {
          raw = readField(page, fieldName);
        }
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
      return bars;
    };

    // Helper: resolve pill color for a row
    const resolvePill = (page, schemaForColor) => {
      const colorVal = colorField ? readField(page, colorField) : null;
      let pillFill = C.darkMuted;
      let pillText = "#fff";
      if (colorVal && colorField) {
        const schemaField = (schemaForColor.statuses || []).concat(schemaForColor.selects || []).find((f) => f.name === colorField);
        const schemaOpts = schemaField?.options || [];
        const resolved = getSolidPillColor(colorVal, colorOptionNames, schemaOpts, config.colorMapping);
        pillFill = resolved.fill;
        pillText = resolved.text;
      }
      return { pillFill, pillText, colorVal };
    };

    // ── Separate parents and children ──
    const parents = [];
    const childrenByParent = {};
    for (const page of data) {
      if (page._parentRowId) {
        (childrenByParent[page._parentRowId] ||= []).push(page);
      } else {
        parents.push(page);
      }
    }

    // ── Build parent rows ──
    const parentRows = [];
    const pMap = {}; // pageId → parent row (for conflict indicator data)

    for (const page of parents) {
      const label = labelField ? readField(page, labelField) : "Untitled";

      // Search filter: match parent name OR any child name
      if (search) {
        const q = search.toLowerCase();
        const parentMatch = (label || "").toLowerCase().includes(q);
        const childMatch = (childrenByParent[page.id] || []).some((child) => {
          const subLabel = subSchema
            ? readField(child, resolveField(subSchema, null, ["title"])) || ""
            : "";
          return subLabel.toLowerCase().includes(q);
        });
        if (!parentMatch && !childMatch) continue;
      }

      const bars = buildBars(page, dateFields, schema);
      const { pillFill, pillText, colorVal } = resolvePill(page, schema);
      const hasChildren = (childrenByParent[page.id] || []).length > 0;
      const rollup = page._rollup || null;

      const parentRow = {
        pageId: page.id,
        page,
        label: label || "Untitled",
        colorVal,
        statusColor: pillFill,
        pillText,
        bars,
        isParent: true,
        isSubItem: false,
        hasChildren,
        childCount: (childrenByParent[page.id] || []).length,
        rollup,
        depth: 0,
      };

      // Even if parent has no bars, include it if it has children with bars
      if (bars.length === 0 && !hasChildren) continue;

      parentRows.push(parentRow);
      pMap[page.id] = parentRow;
    }

    // Sort parents
    if (config.sortField) {
      const dir = config.sortDir === "desc" ? -1 : 1;
      parentRows.sort((a, b) => {
        const va = readField(a.page, config.sortField);
        const vb = readField(b.page, config.sortField);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    } else {
      parentRows.sort((a, b) => {
        const aMin = a.bars.length > 0 ? Math.min(...a.bars.map((b) => b.start.getTime())) : Infinity;
        const bMin = b.bars.length > 0 ? Math.min(...b.bars.map((b) => b.start.getTime())) : Infinity;
        return aMin - bMin;
      });
    }

    // ── Flatten: interleave expanded children ──
    const result = [];
    for (const parentRow of parentRows) {
      result.push(parentRow);

      if (parentRow.hasChildren && expandedParents[parentRow.pageId]) {
        const kids = childrenByParent[parentRow.pageId] || [];
        const subLabelField = subSchema ? resolveField(subSchema, null, ["title"]) : null;

        for (const child of kids) {
          const label = subLabelField ? readField(child, subLabelField) : "Untitled";
          const bars = subDateFields.length > 0
            ? buildBars(child, subDateFields, subSchema)
            : [];
          const { pillFill, pillText, colorVal } = subSchema
            ? resolvePill(child, subSchema)
            : { pillFill: C.darkMuted, pillText: "#fff", colorVal: null };

          result.push({
            pageId: child.id,
            page: child,
            label: label || "Untitled",
            colorVal,
            statusColor: pillFill,
            pillText,
            bars,
            isParent: false,
            isSubItem: true,
            parentId: parentRow.pageId,
            depth: 1,
          });
        }
      }
    }

    return { rows: result, parentRowMap: pMap };
  }, [data, schema, subSchema, dateFields, subDateFields, labelField, colorField, colorOptionNames, search, config.colorMode, config.colorMapping, config.sortField, config.sortDir, expandedParents, resolvedLinks]);

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
      // Include computed range from rollup (children may extend beyond parent bars)
      if (row.rollup?.computedStart) {
        const t = row.rollup.computedStart.getTime();
        if (t < minDate) minDate = t;
      }
      if (row.rollup?.computedEnd) {
        const t = row.rollup.computedEnd.getTime();
        if (t > maxDate) maxDate = t;
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
      // Don't capture when typing in inputs, textareas, selects, or contentEditable
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" ||
          e.target.tagName === "SELECT" || e.target.isContentEditable) return;
      // Don't capture when a modal is open
      if (detailPage || showNewModal) return;

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
  }, [rows.length, zoomIndex, zoom.pxPerDay, todayOffset, handleZoomChange, detailPage, showNewModal]);

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
      isSubItem: !!row.isSubItem,
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
        const lookupSchema = dragState.isSubItem ? subSchema : schema;
        const fieldType = getFieldType(lookupSchema, dragState.fieldName);
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
  }, [dragState, onUpdate, schema, subSchema, zoom.pxPerDay]);

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

        {/* Set as default zoom */}
        {onViewConfigChange && (
          <button
            onClick={() => onViewConfigChange({ preferredZoom: zoom.key })}
            title={config.preferredZoom === zoom.key ? "This is your default view" : `Set "${zoom.label}" as default`}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: "4px 6px",
              fontSize: 14,
              color: config.preferredZoom === zoom.key ? C.accent : C.darkMuted,
              opacity: config.preferredZoom === zoom.key ? 1 : 0.5,
              transition: "all 0.15s",
              display: "flex",
              alignItems: "center",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={config.preferredZoom === zoom.key ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
        )}

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
            borderRadius: RADIUS.pill,
            background: C.darkSurf,
            color: C.darkText,
            outline: "none",
          }}
        />

        {/* Quick-add */}
        {onCreate && (
          <button
            onClick={() => setShowNewModal(true)}
            style={{
              background: "transparent", border: `1px dashed ${C.darkBorder}`,
              borderRadius: RADIUS.md, padding: "3px 10px", color: C.darkMuted,
              fontSize: 11, cursor: "pointer", fontFamily: FONT, outline: "none",
              transition: "border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent + "66"; e.currentTarget.style.color = C.darkText; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; e.currentTarget.style.color = C.darkMuted; }}
          >+ New</button>
        )}

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
                  const now = Date.now();
                  const last = lastRowClickRef.current;
                  if (last.id === row.pageId && now - last.time < 1000) {
                    setDetailPage(row.page);
                    lastRowClickRef.current = { id: null, time: 0 };
                  } else {
                    lastRowClickRef.current = { id: row.pageId, time: now };
                  }
                }}
                style={{
                  height: dynamicRowHeight,
                  display: "flex",
                  alignItems: "center",
                  padding: `0 12px 0 ${12 + (row.depth || 0) * 20}px`,
                  gap: 8,
                  borderBottom: `1px solid ${C.edgeLine}`,
                  overflow: "hidden",
                  background: i === selectedRowIdx ? `${C.accent}14` : "transparent",
                  cursor: "pointer",
                  transition: "background 0.12s",
                  flexWrap: "wrap",
                }}
              >
                {/* Expand/collapse chevron for parents with children */}
                {row.isParent && row.hasChildren ? (
                  <span
                    onClick={(e) => { e.stopPropagation(); toggleParentExpand(row.pageId); }}
                    style={{
                      width: 14, height: 14, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, color: C.darkMuted, cursor: "pointer",
                      transform: expandedParents[row.pageId] ? "rotate(90deg)" : "rotate(0deg)",
                      transition: "transform 0.15s",
                    }}
                    title={expandedParents[row.pageId] ? "Collapse" : `Expand (${row.childCount})`}
                  >
                    ▶
                  </span>
                ) : row.isSubItem ? (
                  // Sub-item indent spacer (no chevron)
                  <span style={{ width: 14, flexShrink: 0 }} />
                ) : (
                  // Parent with no children — no chevron, just spacer
                  <span style={{ width: 14, flexShrink: 0 }} />
                )}

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
                  fontSize: row.isSubItem ? 11 : 12,
                  color: row.isSubItem ? C.darkMuted : C.darkText,
                  fontWeight: row.isParent && row.hasChildren ? 600 : 400,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                  minWidth: 0,
                }}>
                  {row.label}
                </span>

                {/* Progress badge for parents with children */}
                {row.isParent && row.hasChildren && row.rollup && (
                  <span style={{
                    fontSize: 9, fontWeight: 600,
                    color: row.rollup.progress.percent === 100 ? "#22c55e" : C.darkMuted,
                    background: row.rollup.progress.percent === 100 ? "#22c55e18" : C.darkSurf2,
                    borderRadius: RADIUS.pill, padding: "1px 5px",
                    whiteSpace: "nowrap", flexShrink: 0,
                  }}>
                    {row.rollup.progress.complete}/{row.rollup.progress.total}
                  </span>
                )}

                {/* Owner avatars */}
                {showOwner && <OwnerAvatars ownerIds={row.page?._ownerUserIds} users={teamUsers} size={16} />}

                {/* Sidebar badges from config.sidebarFields */}
                {(config.sidebarFields || []).map((fieldName) => {
                  const rowSchema = row.isSubItem ? subSchema : schema;
                  const val = readField(row.page, fieldName);
                  if (!val) return null;
                  const schemaField = (rowSchema?.statuses || []).concat(rowSchema?.selects || [], rowSchema?.multiSelects || []).find((f) => f.name === fieldName);
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

                {/* ─── Computed range bars for parents (rendered behind actual bars) ─── */}
                {rows.map((row, rowIdx) => {
                  if (!row.isParent || !row.hasChildren || !row.rollup) return null;
                  const { computedStart, computedEnd, hasConflict } = row.rollup;
                  if (!computedStart || !computedEnd) return null;

                  const y = rowIdx * dynamicRowHeight + (dynamicRowHeight - barHeight) / 2;
                  const rx = diffDays(origin, startOfDay(computedStart)) * zoom.pxPerDay;
                  const rw = Math.max(MIN_BAR_PX, diffDays(startOfDay(computedStart), startOfDay(computedEnd)) * zoom.pxPerDay);

                  return (
                    <g key={`range-${row.pageId}`}>
                      {/* Translucent range bar spanning all children */}
                      <rect
                        x={rx}
                        y={y + 2}
                        width={rw}
                        height={barHeight - 4}
                        rx={(barHeight - 4) / 2}
                        ry={(barHeight - 4) / 2}
                        fill={row.statusColor}
                        opacity={0.15}
                        style={{ pointerEvents: "none" }}
                      />
                      {/* Conflict indicator: amber triangle at end of computed range */}
                      {hasConflict && zoom.pxPerDay >= 5 && (
                        <g transform={`translate(${rx + rw + 4}, ${y + barHeight / 2})`}>
                          <polygon
                            points="-5,4 5,4 0,-5"
                            fill="#eab308"
                            opacity={0.9}
                          />
                          <text
                            x={8}
                            y={4}
                            fontSize={9}
                            fill="#eab308"
                            fontFamily={FONT}
                            style={{ pointerEvents: "none" }}
                          >!</text>
                        </g>
                      )}
                    </g>
                  );
                })}

                {/* ─── Bars ─── */}
                {rows.map((row, rowIdx) => {
                  const y = rowIdx * dynamicRowHeight + (dynamicRowHeight - barHeight) / 2;
                  const pillRadius = barHeight / 2;
                  const isChild = row.isSubItem;

                  return row.bars.map((bar, barIdx) => {
                    const { x, w } = getBarRect(row, bar);
                    const isDragging = dragState?.pageId === row.pageId && dragState?.fieldName === bar.fieldName;

                    return (
                      <g key={`bar-${row.pageId}-${barIdx}`}>
                        {/* Bar background — pill shape */}
                        <rect
                          x={x}
                          y={isChild ? y + 2 : y}
                          width={w}
                          height={isChild ? barHeight - 4 : barHeight}
                          rx={isChild ? (barHeight - 4) / 2 : pillRadius}
                          ry={isChild ? (barHeight - 4) / 2 : pillRadius}
                          fill={bar.color}
                          opacity={isDragging ? 0.95 : isChild ? 0.75 : 1}
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

                        {/* Resize handles at wide zoom */}
                        {showBarLabels && onUpdate && w > 20 && (
                          <>
                            <rect
                              x={x}
                              y={isChild ? y + 2 : y}
                              width={6}
                              height={isChild ? barHeight - 4 : barHeight}
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
                              y={isChild ? y + 2 : y}
                              width={6}
                              height={isChild ? barHeight - 4 : barHeight}
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

                {/* ─── Bars: Pass 3 — text labels (rendered on top of ALL bars) ─── */}
                {rows.map((row, rowIdx) => {
                  const y = rowIdx * dynamicRowHeight + (dynamicRowHeight - barHeight) / 2;

                  return row.bars.map((bar, barIdx) => {
                    const { x, w } = getBarRect(row, bar);
                    if (!showBarLabels || w <= 60) return null;

                    return (
                      <g key={`label-${row.pageId}-${barIdx}`}>
                        {/* Bar label */}
                        <text
                          x={x + 8}
                          y={y + (barFieldCount > 0 ? 14 : barHeight / 2)}
                          dominantBaseline="middle"
                          fill={isLightColor(bar.color) ? "#1a1a1a" : "#fff"}
                          fontSize={11}
                          fontWeight={600}
                          fontFamily={FONT}
                          style={{ pointerEvents: "none" }}
                        >
                          {row.label.length > Math.floor(w / 7) ? row.label.slice(0, Math.floor(w / 7) - 2) + "…" : row.label}
                        </text>

                        {/* Bar property labels (from config.barFields) */}
                        {(config.barFields || []).map((fieldName, idx) => {
                          const val = readField(row.page, fieldName);
                          if (!val) return null;
                          return (
                            <text
                              key={fieldName}
                              x={x + 8}
                              y={y + 14 + ((idx + 1) * LABEL_LINE_H)}
                              dominantBaseline="middle"
                              fill={isLightColor(bar.color) ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.8)"}
                              fontSize={9}
                              fontFamily={FONT}
                              style={{ pointerEvents: "none" }}
                            >
                              {String(val).slice(0, Math.floor(w / 6))}
                            </text>
                          );
                        })}
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
          schema={detailPage._parentRowId && subSchema ? subSchema : schema}
          onClose={() => setDetailPage(null)}
          onUpdate={onUpdate}
          onDelete={onDelete ? (ids) => { onDelete(ids); setDetailPage(null); } : undefined}
          pageConfigId={pageConfig?.id}
          resolvedLinks={resolvedLinks}
          onLinkField={onLinkField ? (fieldName, fieldType) => onLinkField(detailPage.id, fieldName, fieldType) : null}
          onUnlinkField={onUnlinkField}
          onCreateOption={onCreateOption ? (colName, optionName) => onCreateOption(detailPage, colName, optionName) : null}
        />
      )}

      {showNewModal && onCreate && (
        <NewRecordModal
          schema={schema}
          databaseId={config.databaseId || pageConfig?.databaseIds?.[0] || pageConfig?.id}
          onCreate={onCreate}
          onClose={() => setShowNewModal(false)}
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
