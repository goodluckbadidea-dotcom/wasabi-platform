import { useState, useMemo, useCallback } from "react";

// Hard cap on tree depth. Depth 0 = top-level, 1 = sub-item, 2 = sub-sub-item.
// Anything past depth 2 is rejected — keeps the visual model legible and
// the drag-to-nest interaction tractable. Server-side cap in
// worker/handlers/tables.js mirrors this.
const MAX_DEPTH = 2;

/**
 * Build a lookup: parentId → [childRows] preserving sort order.
 * Rows with _parentRowId pointing to a non-existent row are treated as top-level.
 */
function buildChildMap(data) {
  const rowIndex = new Set(data.map((r) => r.id));
  const childMap = {}; // parentId → [rows]
  const topLevel = [];
  for (const row of data) {
    const pid = row._parentRowId;
    if (pid && rowIndex.has(pid)) {
      (childMap[pid] ||= []).push(row);
    } else {
      topLevel.push(row);
    }
  }
  return { childMap, topLevel };
}

/**
 * Flatten tree into display list respecting expanded state.
 * Each entry: { row, depth, hasChildren, isExpanded }
 */
function flattenTree(topLevel, childMap, expandedSet, sortFn, depth = 0) {
  const sorted = sortFn ? [...topLevel].sort(sortFn) : topLevel;
  const result = [];
  for (const row of sorted) {
    const children = childMap[row.id] || [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedSet.has(row.id);
    result.push({ row, depth, hasChildren, isExpanded });
    if (hasChildren && isExpanded && depth < MAX_DEPTH) {
      const sortedChildren = sortFn ? [...children].sort(sortFn) : children;
      result.push(
        ...flattenTree(sortedChildren, childMap, expandedSet, sortFn, depth + 1)
      );
    }
  }
  return result;
}

export function useTreeData(data, { enabled = true, sortFn = null } = {}) {
  const [expandedRows, setExpandedRows] = useState(new Set());

  const { childMap, topLevel } = useMemo(
    () => (enabled ? buildChildMap(data) : { childMap: {}, topLevel: data }),
    [data, enabled]
  );

  const displayList = useMemo(() => {
    if (!enabled)
      return data.map((row) => ({
        row,
        depth: 0,
        hasChildren: false,
        isExpanded: false,
      }));
    return flattenTree(topLevel, childMap, expandedRows, sortFn);
  }, [topLevel, childMap, expandedRows, enabled, sortFn, data]);

  const toggleExpand = useCallback((rowId) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const allParents = new Set(Object.keys(childMap));
    setExpandedRows(allParents);
  }, [childMap]);

  const collapseAll = useCallback(() => {
    setExpandedRows(new Set());
  }, []);

  const getChildren = useCallback(
    (rowId) => childMap[rowId] || [],
    [childMap]
  );

  const getDepth = useCallback(
    (rowId) => {
      const entry = displayList.find((e) => e.row.id === rowId);
      return entry?.depth ?? 0;
    },
    [displayList]
  );

  return {
    displayList, // [{ row, depth, hasChildren, isExpanded }]
    expandedRows, // Set<string>
    toggleExpand, // (rowId) => void
    expandAll, // () => void
    collapseAll, // () => void
    getChildren, // (rowId) => Row[]
    getDepth, // (rowId) => number
    childMap, // { parentId: [rows] }
  };
}
