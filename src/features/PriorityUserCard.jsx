// ─── PriorityUserCard ───
// One stacked card per user on the Team Priorities admin screen.
//
// Collapsed: header only (name, role, pin counter, chevron). Cheap.
// Expanded: full drag-to-pin body — pinned zone on top, AI-ranked zone
// below, with a horizontal divider between. Admin drags rows between
// zones to pin/unpin and reorders within the pinned zone.
//
// State model:
//   pinsFromServer  — the last successful pin set (source of truth on load
//                     and after saves).
//   pinnedOrder     — local ordered list of pinned task_ids while dragging.
//   pinnedReasons   — local map { task_id: reasonText } while editing.
// Any drag or reason edit debounces a POST /task-pins that replaces the
// full pin set for this user (server-side replace-all semantics).
//
// Pins beat everything else: they display even if the target user snoozed
// the task. Once the task hits a done/cancelled status, the server auto-
// clears the pin (via handleUpdateRow in worker/handlers/tables.js).

import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { IconChevronDown, IconStar, IconClose } from "../design/icons.jsx";
import useAICuratedTasks from "./useAICuratedTasks.js";
import { listPinsForTarget, replacePins } from "../lib/api.js";

const SAVE_DEBOUNCE_MS = 400;

export default function PriorityUserCard({ user, isExpanded, onToggle }) {
  const [hasEverExpanded, setHasEverExpanded] = useState(isExpanded);
  const [pinCount, setPinCount] = useState(null);
  // Bumped by the body after every successful save so the header counter
  // refreshes even when the card stays expanded.
  const [refetchTick, setRefetchTick] = useState(0);

  useEffect(() => {
    if (isExpanded && !hasEverExpanded) setHasEverExpanded(true);
  }, [isExpanded, hasEverExpanded]);

  useEffect(() => {
    let cancelled = false;
    listPinsForTarget(user.id)
      .then((res) => { if (!cancelled) setPinCount((res?.pins || []).length); })
      .catch(() => { if (!cancelled) setPinCount(0); });
    return () => { cancelled = true; };
  }, [user.id, isExpanded, refetchTick]);

  const bumpPinCount = useCallback(() => setRefetchTick((t) => t + 1), []);

  return (
    <div style={cardShellStyle()}>
      <button
        type="button"
        onClick={onToggle}
        style={cardHeaderStyle()}
        aria-expanded={isExpanded}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
          <Avatar name={user.display_name} />
          <span style={{ fontSize: 14, fontWeight: 500, color: C.darkText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user.display_name || "Unnamed"}
          </span>
          <RoleChip role={user.role} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <PinCounter count={pinCount} />
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 120ms ease",
          }}>
            <IconChevronDown size={12} color={C.darkMuted} />
          </span>
        </div>
      </button>

      {hasEverExpanded && (
        <div style={{ display: isExpanded ? "block" : "none", borderTop: `1px solid ${C.darkBorder}` }}>
          <PriorityUserCardBody user={user} onPinsChanged={bumpPinCount} />
        </div>
      )}
    </div>
  );
}

// ─── Body: fetches pins + curated tasks, renders drag-to-pin UI ───

function PriorityUserCardBody({ user, onPinsChanged }) {
  const overrideIdentity = useMemo(
    () => ({ id: user.id, role: user.role, display_name: user.display_name }),
    [user.id, user.role, user.display_name]
  );

  const { aiTasks, loading, refreshing, error } = useAICuratedTasks({
    dismissedIds: EMPTY_SET,
    completedCount: 0,
    overrideIdentity,
  });

  // Server-loaded pin set — the source of truth for pinned_by_user_id +
  // pinned_by_name attribution. Local state below layers admin edits.
  const [serverPins, setServerPins] = useState([]);
  const [pinsLoaded, setPinsLoaded] = useState(false);

  // Local edit state — drag mutates these, then a debounced effect syncs
  // them to the server via replacePins.
  const [pinnedOrder, setPinnedOrder] = useState([]); // ordered task_ids
  const [pinnedReasons, setPinnedReasons] = useState({}); // task_id → reason
  const [pinnedMeta, setPinnedMeta] = useState({}); // task_id → { source }

  // Load pins from server on mount + whenever the user changes.
  useEffect(() => {
    let cancelled = false;
    listPinsForTarget(user.id)
      .then((res) => {
        if (cancelled) return;
        const pins = res?.pins || [];
        setServerPins(pins);
        setPinnedOrder(pins.map((p) => p.task_id));
        setPinnedReasons(Object.fromEntries(pins.map((p) => [p.task_id, p.reason || ""])));
        setPinnedMeta(Object.fromEntries(pins.map((p) => [p.task_id, { source: p.source || "" }])));
        setPinsLoaded(true);
      })
      .catch(() => { if (!cancelled) setPinsLoaded(true); });
    return () => { cancelled = true; };
  }, [user.id]);

  // Task lookup keyed by id, sourced from the curated list. When a task is
  // pinned we still need its display data (title, source, due). If a pin
  // points at a task that isn't in aiTasks (edge case: task was dropped
  // from the ranked list for some reason), we render a placeholder row
  // so the admin can still un-pin it.
  const taskById = useMemo(() => {
    const m = new Map();
    for (const t of (aiTasks || [])) {
      if (t?.id) m.set(t.id, t);
    }
    return m;
  }, [aiTasks]);

  // Un-pinned curated tasks preserve Claude's order.
  const unpinnedTasks = useMemo(() => {
    const pinnedSet = new Set(pinnedOrder);
    return (aiTasks || []).filter((t) => !pinnedSet.has(t.id));
  }, [aiTasks, pinnedOrder]);

  // Save with debounce: any change to pinnedOrder / reasons / meta triggers
  // a POST to replacePins after a short quiet period.
  const saveTimerRef = useRef(null);
  const isFirstRunRef = useRef(true);
  useEffect(() => {
    // Skip the initial hydration pass — we don't want to POST what we just
    // GOT back from the server.
    if (isFirstRunRef.current) {
      if (pinsLoaded) isFirstRunRef.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const body = pinnedOrder.map((taskId, idx) => ({
        task_id: taskId,
        source: pinnedMeta[taskId]?.source || "",
        pin_order: idx,
        reason: pinnedReasons[taskId] || "",
      }));
      replacePins(user.id, body)
        .then((res) => {
          if (res?.pins) setServerPins(res.pins);
          if (onPinsChanged) onPinsChanged();
        })
        .catch((err) => {
          console.error("[team-priorities] save failed:", err?.message || err);
        });
    }, SAVE_DEBOUNCE_MS);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [pinnedOrder, pinnedReasons, pinnedMeta, pinsLoaded, user.id, onPinsChanged]);

  // ── Drag state ──
  const [dragTaskId, setDragTaskId] = useState(null);
  const [dragOverTarget, setDragOverTarget] = useState(null); // { zone, index }

  const onRowDragStart = (taskId) => (e) => {
    setDragTaskId(taskId);
    e.dataTransfer.effectAllowed = "move";
    // Firefox requires a payload.
    try { e.dataTransfer.setData("text/plain", taskId); } catch {}
  };

  const onRowDragEnd = () => {
    setDragTaskId(null);
    setDragOverTarget(null);
  };

  const onZoneDragOver = (zone, index) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!dragOverTarget || dragOverTarget.zone !== zone || dragOverTarget.index !== index) {
      setDragOverTarget({ zone, index });
    }
  };

  // Handle drop into either zone at a specific insert index.
  //   zone === "pinned"   → task ends up in pinned zone at `index`
  //   zone === "unpinned" → task ends up in un-pinned zone (removed from pins)
  const onZoneDrop = (zone, index) => (e) => {
    e.preventDefault();
    if (!dragTaskId) return;
    if (zone === "pinned") {
      pinTaskAt(dragTaskId, index);
    } else {
      unpinTask(dragTaskId);
    }
    setDragTaskId(null);
    setDragOverTarget(null);
  };

  const pinTaskAt = (taskId, insertIndex) => {
    setPinnedOrder((prev) => {
      const currentIdx = prev.indexOf(taskId);
      const next = prev.filter((id) => id !== taskId);
      // Adjust insertIndex if we removed something from earlier in the list.
      let ins = insertIndex;
      if (currentIdx !== -1 && currentIdx < insertIndex) ins -= 1;
      ins = Math.max(0, Math.min(next.length, ins));
      next.splice(ins, 0, taskId);
      return next;
    });
    // Capture source metadata (so we know which page_config the task lives
    // in when we POST). Prefer freshly-known task; fall back to whatever we
    // already had for pinned tasks.
    const task = taskById.get(taskId);
    if (task) {
      setPinnedMeta((prev) => ({ ...prev, [taskId]: { source: task.source || "" } }));
    }
    // Fresh pins default to empty reason unless one was set earlier.
    setPinnedReasons((prev) => (taskId in prev ? prev : { ...prev, [taskId]: "" }));
  };

  const unpinTask = (taskId) => {
    setPinnedOrder((prev) => prev.filter((id) => id !== taskId));
    setPinnedReasons((prev) => {
      const next = { ...prev }; delete next[taskId]; return next;
    });
    setPinnedMeta((prev) => {
      const next = { ...prev }; delete next[taskId]; return next;
    });
  };

  const updateReason = (taskId, value) => {
    setPinnedReasons((prev) => ({ ...prev, [taskId]: value }));
  };

  if (loading || !pinsLoaded) {
    return <div style={bodyEmptyStyle()}>Loading {user.display_name}'s curated list…</div>;
  }
  if (error) {
    return <div style={{ ...bodyEmptyStyle(), color: C.error }}>Error: {String(error)}</div>;
  }

  return (
    <div style={{ padding: "10px 12px 14px 12px" }}>
      {refreshing && (
        <div style={{ fontSize: 11, color: C.darkMuted, padding: "0 2px 6px 2px" }}>
          Refreshing…
        </div>
      )}

      {/* ── Pinned zone ── */}
      <ZoneLabel>Pinned</ZoneLabel>
      <div
        onDragOver={onZoneDragOver("pinned", pinnedOrder.length)}
        onDrop={onZoneDrop("pinned", pinnedOrder.length)}
        style={pinnedZoneStyle(pinnedOrder.length === 0, dragOverTarget?.zone === "pinned")}
      >
        {pinnedOrder.length === 0 && (
          <div style={emptyPinZoneStyle()}>
            Drag a task here to pin it to the top of {user.display_name}'s list.
          </div>
        )}
        {pinnedOrder.map((taskId, idx) => {
          const task = taskById.get(taskId) || { id: taskId, title: "(Task not in current list)", source: pinnedMeta[taskId]?.source || "" };
          return (
            <DragDropSlot
              key={`slot-p-${idx}`}
              zone="pinned"
              index={idx}
              onDragOver={onZoneDragOver("pinned", idx)}
              onDrop={onZoneDrop("pinned", idx)}
              isActive={dragOverTarget?.zone === "pinned" && dragOverTarget.index === idx}
            >
              <PinnedRow
                task={task}
                reason={pinnedReasons[taskId] || ""}
                onReasonChange={(v) => updateReason(taskId, v)}
                onUnpin={() => unpinTask(taskId)}
                onDragStart={onRowDragStart(taskId)}
                onDragEnd={onRowDragEnd}
              />
            </DragDropSlot>
          );
        })}
      </div>

      {/* ── AI-ranked zone ── */}
      <ZoneLabel>AI-ranked</ZoneLabel>
      <div
        onDragOver={onZoneDragOver("unpinned", 0)}
        onDrop={onZoneDrop("unpinned", 0)}
        style={aiZoneStyle(dragOverTarget?.zone === "unpinned")}
      >
        {unpinnedTasks.length === 0 && (
          <div style={emptyPinZoneStyle()}>No un-pinned curated tasks.</div>
        )}
        {unpinnedTasks.map((task, idx) => (
          <UnpinnedRow
            key={task.id || `u-${idx}`}
            task={task}
            onDragStart={onRowDragStart(task.id)}
            onDragEnd={onRowDragEnd}
          />
        ))}
      </div>
    </div>
  );
}

const EMPTY_SET = new Set();

// ── Zone container: transparent drop target that shows a highlighted
// line when a drag is hovering it. `index` is the insert position.
function DragDropSlot({ zone, index, onDragOver, onDrop, isActive, children }) {
  return (
    <div style={{ position: "relative" }}>
      {isActive && (
        <div style={{
          position: "absolute", top: -3, left: 0, right: 0,
          height: 2, background: C.accent, borderRadius: 2,
          pointerEvents: "none",
        }} />
      )}
      <div onDragOver={onDragOver} onDrop={onDrop}>
        {children}
      </div>
    </div>
  );
}

// ── Pinned row: draggable, has reason input + unpin button ──
function PinnedRow({ task, reason, onReasonChange, onUnpin, onDragStart, onDragEnd }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={pinnedRowStyle()}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <DragHandle />
        <IconStar size={12} color={C.accent} />
        <span style={{
          fontSize: 13, color: C.darkText,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          flex: 1, minWidth: 0,
        }}>
          {task.title || "Untitled"}
        </span>
        {task.due && <span style={dueChipStyle()}>{formatShortDate(task.due)}</span>}
        {task.sourceName && task.sourceName !== "User Tasks" && (
          <span style={sourceChipStyle()}>{task.sourceName}</span>
        )}
        <button
          type="button"
          onClick={onUnpin}
          title="Unpin"
          aria-label="Unpin"
          style={unpinButtonStyle()}
        >
          <IconClose size={12} color={C.darkMuted} />
        </button>
      </div>
      <input
        type="text"
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        placeholder="Reason (optional) — shown to the user"
        style={reasonInputStyle()}
      />
    </div>
  );
}

// ── Un-pinned row: draggable, no reason/unpin controls ──
function UnpinnedRow({ task, onDragStart, onDragEnd }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={unpinnedRowStyle()}
    >
      <DragHandle />
      <span style={{
        fontSize: 13, color: C.darkText,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        flex: 1, minWidth: 0,
      }}>
        {task.title || "Untitled"}
      </span>
      {task.due && <span style={dueChipStyle()}>{formatShortDate(task.due)}</span>}
      {task.sourceName && task.sourceName !== "User Tasks" && (
        <span style={sourceChipStyle()}>{task.sourceName}</span>
      )}
    </div>
  );
}

function DragHandle() {
  return (
    <span style={{
      display: "inline-flex", flexDirection: "column", gap: 2,
      cursor: "grab", padding: "0 4px",
      opacity: 0.4,
    }}
    aria-label="Drag handle">
      <span style={{ width: 10, height: 2, background: C.darkMuted, borderRadius: 1 }} />
      <span style={{ width: 10, height: 2, background: C.darkMuted, borderRadius: 1 }} />
      <span style={{ width: 10, height: 2, background: C.darkMuted, borderRadius: 1 }} />
    </span>
  );
}

function ZoneLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontFamily: FONT,
      color: C.darkMuted,
      textTransform: "uppercase", letterSpacing: "0.06em",
      padding: "10px 2px 6px 2px",
    }}>
      {children}
    </div>
  );
}

function formatShortDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

// ─── Small render helpers ───

function Avatar({ name }) {
  const initials = (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("") || "?";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 26, height: 26, borderRadius: "50%",
      background: C.darkSurf2, color: C.darkText,
      fontSize: 11, fontWeight: 600, letterSpacing: "0.02em",
      flexShrink: 0,
    }}>
      {initials}
    </span>
  );
}

function RoleChip({ role }) {
  const label = role || "viewer";
  return (
    <span style={{
      fontSize: 10, fontFamily: FONT,
      padding: "2px 7px", borderRadius: RADIUS.pill,
      background: C.darkSurf2, color: C.darkMuted,
      letterSpacing: "0.04em", textTransform: "uppercase",
      flexShrink: 0,
    }}>
      {label}
    </span>
  );
}

function PinCounter({ count }) {
  const displayValue = count == null ? "—" : count;
  return (
    <span style={{
      fontSize: 11, color: count > 0 ? C.accent : C.darkMuted,
      fontFamily: FONT,
      padding: "2px 8px",
      background: count > 0 ? `${C.accent}18` : "transparent",
      borderRadius: RADIUS.pill,
      flexShrink: 0,
    }}>
      {displayValue} pinned
    </span>
  );
}

// ─── Styles ───

function cardShellStyle() {
  return {
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.lg,
    background: C.darkSurf2,
    overflow: "hidden",
    // Cards sit inside a flex-column scroll parent. Without flexShrink:0
    // each card would be squished to fit the viewport (fighting the scroll
    // container's overflow:auto) — clipping their content instead of
    // letting the parent scroll. Locking shrink to 0 makes each card take
    // its natural height and any excess falls into the parent's scroll.
    flexShrink: 0,
  };
}

function cardHeaderStyle() {
  return {
    width: "100%",
    display: "flex", alignItems: "center", gap: 12,
    padding: "12px 14px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: FONT,
    color: C.darkText,
  };
}

function pinnedZoneStyle(isEmpty, isDragTarget) {
  return {
    minHeight: isEmpty ? 60 : "auto",
    border: `1px dashed ${isDragTarget ? C.accent : C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: 6,
    background: isDragTarget ? `${C.accent}0a` : "transparent",
    transition: "background 100ms ease, border-color 100ms ease",
  };
}

function aiZoneStyle(isDragTarget) {
  return {
    borderRadius: RADIUS.md,
    padding: 6,
    background: isDragTarget ? `${C.darkMuted}12` : "transparent",
    transition: "background 100ms ease",
  };
}

function pinnedRowStyle() {
  return {
    display: "flex", flexDirection: "column", gap: 6,
    padding: "8px 10px",
    borderRadius: RADIUS.md,
    background: C.darkSurf,
    marginBottom: 6,
    border: `1px solid ${C.accent}33`,
    cursor: "grab",
  };
}

function unpinnedRowStyle() {
  return {
    display: "flex", alignItems: "center", gap: 8,
    padding: "8px 10px",
    borderRadius: RADIUS.md,
    background: C.darkSurf,
    marginBottom: 6,
    minWidth: 0,
    cursor: "grab",
  };
}

function reasonInputStyle() {
  return {
    background: "transparent",
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.sm,
    color: C.darkText,
    fontFamily: FONT,
    fontSize: 12,
    padding: "4px 8px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };
}

function unpinButtonStyle() {
  return {
    background: "transparent",
    border: "none",
    padding: 4,
    cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    borderRadius: RADIUS.sm,
    flexShrink: 0,
  };
}

function dueChipStyle() {
  return {
    fontSize: 11, fontFamily: FONT,
    padding: "2px 7px", borderRadius: RADIUS.pill,
    background: C.darkSurf2, color: C.darkMuted,
    flexShrink: 0,
  };
}

function sourceChipStyle() {
  return {
    fontSize: 10, fontFamily: FONT,
    padding: "2px 7px", borderRadius: RADIUS.pill,
    background: C.darkSurf2, color: C.darkMuted,
    letterSpacing: "0.02em",
    flexShrink: 0,
  };
}

function emptyPinZoneStyle() {
  return {
    padding: "12px 10px", textAlign: "center",
    color: C.darkMuted, fontSize: 12, fontFamily: FONT,
  };
}

function bodyEmptyStyle() {
  return {
    padding: "20px 16px", textAlign: "center",
    color: C.darkMuted, fontSize: 13, fontFamily: FONT,
  };
}
