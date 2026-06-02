// ─── useRowDrag Hook ───
// Drag-to-nest for table rows. The interaction:
//   • Grab the ⋮⋮ handle on a row (visible on hover).
//   • Drop on another row → moved row becomes a child of that target.
//   • Drop on the empty space below the last row → moved row is un-nested
//     to top level.
//   • Drops that would push any row past MAX_DEPTH are blocked client-side
//     with a toast (server enforces the same cap as a safety net).
// Disabled entirely when a column sort is active, when the table is linked
// (non-D1), or when the dragged row is the same as the target.

import { useState, useCallback, useRef, useMemo } from "react";
import { reparentRow } from "../../../lib/api.js";
import { globalToast } from "../../../context/ToastContext.jsx";

const MAX_DEPTH = 2; // mirrors useTreeData.MAX_DEPTH + worker MAX_NEST_DEPTH

// Walks the (already-built) childMap to find the deepest descendant offset
// below `rowId`. Returns 0 when the row has no children. Bounded by MAX_DEPTH
// so a corrupted tree can't spin.
function computeSubtreeDepth(rowId, childMap) {
  const stack = [{ id: rowId, depth: 0 }];
  let maxD = 0;
  while (stack.length) {
    const { id, depth } = stack.pop();
    if (depth > maxD) maxD = depth;
    if (depth >= MAX_DEPTH) continue;
    for (const c of (childMap[id] || [])) {
      stack.push({ id: c.id, depth: depth + 1 });
    }
  }
  return maxD;
}

// Returns true when `candidateAncestorId` is `targetId` or sits anywhere
// above `targetId` in the tree. Used to block drops on self/descendants —
// dragging a parent onto its own child would orphan the descendants.
function isSelfOrDescendant(candidateAncestorId, targetId, data) {
  if (candidateAncestorId === targetId) return true;
  const byId = {};
  for (const r of data) byId[r.id] = r;
  let cur = byId[targetId];
  const visited = new Set();
  while (cur) {
    if (visited.has(cur.id)) return false;
    visited.add(cur.id);
    if (cur._parentRowId === candidateAncestorId) return true;
    cur = byId[cur._parentRowId];
  }
  return false;
}

export default function useRowDrag({
  tableId,
  isD1Table,
  sortActive,        // boolean — column sort is currently set
  childMap,          // from useTreeData
  data,              // full row array (incl. all sub-items)
  onMoveComplete,    // () => void — refresh callback
}) {
  const [dragState, setDragState] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const dragCounter = useRef({});

  const isDragDisabled = !isD1Table || sortActive;
  const disabledReason = !isD1Table
    ? "Reordering is available on Wasabi tables only"
    : sortActive
    ? "Clear column sort to reorder"
    : null;

  // depth of `rowId` by walking _parentRowId pointers in `data`
  const getDepth = useCallback((rowId) => {
    const byId = {};
    for (const r of data) byId[r.id] = r;
    let cur = byId[rowId];
    let depth = 0;
    const visited = new Set();
    while (cur && cur._parentRowId) {
      if (visited.has(cur.id)) break;
      visited.add(cur.id);
      cur = byId[cur._parentRowId];
      depth++;
      if (depth > MAX_DEPTH + 2) break;
    }
    return depth;
  }, [data]);

  // Pre-computed map of rowId → subtreeDepth, used to gate drop targets
  // without re-walking the tree on every dragover event.
  const subtreeDepths = useMemo(() => {
    const out = {};
    for (const r of data) {
      out[r.id] = computeSubtreeDepth(r.id, childMap);
    }
    return out;
  }, [data, childMap]);

  // ── Drag start ──
  const handleDragStart = useCallback((rowId, e) => {
    if (isDragDisabled) {
      e.preventDefault();
      if (disabledReason) globalToast?.(disabledReason, "info");
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", rowId);
    const subDepth = subtreeDepths[rowId] || 0;
    setDragState({ rowId, subDepth });
  }, [isDragDisabled, disabledReason, subtreeDepths]);

  // ── Drag end (cleanup regardless of drop success) ──
  const handleDragEnd = useCallback(() => {
    setDragState(null);
    setDropTarget(null);
    dragCounter.current = {};
  }, []);

  // ── Drag over a row ──
  const handleRowDragOver = useCallback((rowId, e) => {
    if (!dragState) return;
    e.preventDefault();

    // Self / descendant — drop blocked
    if (isSelfOrDescendant(dragState.rowId, rowId, data)) {
      e.dataTransfer.dropEffect = "none";
      setDropTarget({ rowId, type: "row", invalid: true });
      return;
    }

    // Depth cap — drop blocked client-side
    const targetDepth = getDepth(rowId);
    const wouldExceed = targetDepth + 1 + (dragState.subDepth || 0) > MAX_DEPTH;
    if (wouldExceed) {
      e.dataTransfer.dropEffect = "none";
      setDropTarget({ rowId, type: "row", invalid: true });
      return;
    }

    e.dataTransfer.dropEffect = "move";
    setDropTarget({ rowId, type: "row", invalid: false });
  }, [dragState, data, getDepth]);

  const handleRowDragEnter = useCallback((rowId) => {
    dragCounter.current[rowId] = (dragCounter.current[rowId] || 0) + 1;
  }, []);

  const handleRowDragLeave = useCallback((rowId) => {
    dragCounter.current[rowId] = (dragCounter.current[rowId] || 0) - 1;
    if (dragCounter.current[rowId] <= 0) {
      dragCounter.current[rowId] = 0;
      setDropTarget((cur) => (cur?.rowId === rowId ? null : cur));
    }
  }, []);

  // ── Drop on a row → nest ──
  const handleRowDrop = useCallback(async (targetRowId, e) => {
    e.preventDefault();
    e.stopPropagation(); // keep the scrollArea empty-drop handler from also firing
    if (!dragState) return;
    const { rowId } = dragState;
    setDragState(null);
    setDropTarget(null);
    dragCounter.current = {};

    if (rowId === targetRowId) return;
    if (isSelfOrDescendant(rowId, targetRowId, data)) {
      globalToast?.("Can't nest a row inside its own descendant", "error");
      return;
    }

    // Client-side depth gate
    const targetDepth = getDepth(targetRowId);
    const subDepth = computeSubtreeDepth(rowId, childMap);
    if (targetDepth + 1 + subDepth > MAX_DEPTH) {
      globalToast?.(`Maximum ${MAX_DEPTH + 1} levels of nesting`, "error");
      return;
    }

    // Land at bottom of the target's existing children
    const targetChildren = childMap[targetRowId] || [];
    const newSortOrder = targetChildren.length > 0
      ? Math.max(...targetChildren.map((c) => c._sortOrder || 0)) + 1
      : 0;

    try {
      await reparentRow(tableId, rowId, targetRowId, newSortOrder);
      onMoveComplete?.();
    } catch (err) {
      console.error("[useRowDrag] reparent failed:", err);
      const msg = err?.data?._error || err?.message || "Move failed";
      globalToast?.(msg, "error");
    }
  }, [dragState, data, childMap, tableId, getDepth, onMoveComplete]);

  // ── Drop on empty space → un-nest to top level ──
  const handleEmptyDragOver = useCallback((e) => {
    if (!dragState) return;
    // Already at top level → no-op visual
    const byId = {};
    for (const r of data) byId[r.id] = r;
    const draggedRow = byId[dragState.rowId];
    if (!draggedRow || !draggedRow._parentRowId) {
      e.dataTransfer.dropEffect = "none";
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget({ rowId: null, type: "empty", invalid: false });
  }, [dragState, data]);

  const handleEmptyDragLeave = useCallback(() => {
    setDropTarget((cur) => (cur?.type === "empty" ? null : cur));
  }, []);

  const handleEmptyDrop = useCallback(async (e) => {
    e.preventDefault();
    if (!dragState) return;
    const { rowId } = dragState;
    setDragState(null);
    setDropTarget(null);
    dragCounter.current = {};

    const byId = {};
    for (const r of data) byId[r.id] = r;
    const draggedRow = byId[rowId];
    if (!draggedRow || !draggedRow._parentRowId) return; // already top-level

    // Land at bottom of top-level rows
    const topRows = data.filter((r) => !r._parentRowId);
    const newSortOrder = topRows.length > 0
      ? Math.max(...topRows.map((r) => r._sortOrder || 0)) + 1
      : 0;

    try {
      await reparentRow(tableId, rowId, null, newSortOrder);
      onMoveComplete?.();
    } catch (err) {
      console.error("[useRowDrag] un-nest failed:", err);
      const msg = err?.data?._error || err?.message || "Move failed";
      globalToast?.(msg, "error");
    }
  }, [dragState, data, tableId, onMoveComplete]);

  return {
    dragState,
    dropTarget,
    isDragging: !!dragState,
    isDragDisabled,
    disabledReason,
    handleDragStart,
    handleDragEnd,
    handleRowDragOver,
    handleRowDragEnter,
    handleRowDragLeave,
    handleRowDrop,
    handleEmptyDragOver,
    handleEmptyDragLeave,
    handleEmptyDrop,
  };
}
