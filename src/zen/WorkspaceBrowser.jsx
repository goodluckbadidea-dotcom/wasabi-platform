// ─── Zen Workspaces Browser ───
// Drill-down card browser for Sashimi mode.
// Levels: Workspaces → Folders → Pages
// Features: overflow menu (delete), drag & drop (reorder + cross-container move)

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { C, FONT, RADIUS, Z } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { useNavigation } from "../context/NavigationContext.jsx";
import { IconFolder, IconSearch, IconChevronRight, IconGlobe, IconGear, IconTrash } from "../design/icons.jsx";
import { useRecordDrawer } from "./RecordDrawerContext.jsx";
import RecordDrawer from "./RecordDrawer.jsx";
import { deletePageConfig, reorderPages, updatePageConfig as apiUpdatePage } from "../lib/api.js";

// ── Card hover helpers ──
function applyHover(e) {
  if (e.currentTarget.dataset.dragging === "true") return;
  e.currentTarget.style.borderColor = C.accent;
  e.currentTarget.style.background = C.darkSurf2;
  e.currentTarget.style.transform = "translateY(-1px)";
}
function removeHover(e) {
  if (e.currentTarget.dataset.dragging === "true") return;
  e.currentTarget.style.borderColor = C.darkBorder;
  e.currentTarget.style.background = C.darkSurf;
  e.currentTarget.style.transform = "translateY(0)";
}

// ── Diamond icon for pages ──
function PageIcon({ size = 16, color = C.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="3" y="2" width="10" height="12" rx="1.5" stroke={color} strokeWidth="1.3" fill="none" />
      <line x1="5.5" y1="5.5" x2="10.5" y2="5.5" stroke={color} strokeWidth="1" />
      <line x1="5.5" y1="8" x2="10.5" y2="8" stroke={color} strokeWidth="1" />
    </svg>
  );
}

// ── Overflow "..." button ──
function OverflowDots({ size = 16, color = C.darkMuted }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="4" cy="8" r="1.3" fill={color} />
      <circle cx="8" cy="8" r="1.3" fill={color} />
      <circle cx="12" cy="8" r="1.3" fill={color} />
    </svg>
  );
}

// ── Confirm Dialog ──
function ConfirmDialog({ title, message, warning, onConfirm, onCancel }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: Z.workspace,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: C.overlayBg, backdropFilter: "blur(4px)",
    }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.xl, padding: "24px", width: 380,
        fontFamily: FONT, animation: ANIM.settleIn(0),
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.darkText, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: C.darkMuted, lineHeight: 1.5, marginBottom: warning ? 12 : 20 }}>{message}</div>
        {warning && (
          <div style={{
            fontSize: 12, color: "#e8845a", lineHeight: 1.5,
            padding: "8px 12px", background: "rgba(232,132,90,0.1)",
            borderRadius: RADIUS.md, marginBottom: 20,
            border: "1px solid rgba(232,132,90,0.2)",
          }}>
            ⚠ {warning}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "7px 16px", fontSize: 13, fontFamily: FONT,
              background: "transparent", border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.pill, color: C.darkMuted, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "7px 16px", fontSize: 13, fontFamily: FONT, fontWeight: 600,
              background: "#c0392b", border: "none",
              borderRadius: RADIUS.pill, color: "#fff", cursor: "pointer",
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Overflow Menu (positioned relative to trigger) ──
function OverflowMenu({ item, onDelete, onMove, folders, onClose, anchorRect }) {
  const ref = useRef(null);
  const [showMoveSub, setShowMoveSub] = useState(false);

  useEffect(() => {
    // Delay attaching so the opening click doesn't immediately close the menu
    const timer = setTimeout(() => {
      const handler = (e) => {
        if (ref.current && !ref.current.contains(e.target)) onClose();
      };
      document.addEventListener("mousedown", handler);
      ref.current._cleanup = () => document.removeEventListener("mousedown", handler);
    }, 50);
    return () => {
      clearTimeout(timer);
      if (ref.current?._cleanup) ref.current._cleanup();
    };
  }, [onClose]);

  const top = anchorRect ? anchorRect.bottom + 4 : 0;
  const left = anchorRect ? anchorRect.right - 140 : 0;

  // Build move targets: Root + all folders/workspaces (excluding the item itself and its current parent)
  const moveTargets = [
    { id: null, name: "Root (Uncategorized)", color: C.darkMuted },
    ...folders.filter((f) => f.id !== item.id),
  ];

  const btnStyle = {
    display: "flex", alignItems: "center", gap: 8, width: "100%",
    padding: "8px 14px", border: "none", background: "transparent",
    fontSize: 13, fontFamily: FONT, cursor: "pointer", textAlign: "left",
  };

  return (
    <div
      ref={ref}
      style={{
        position: "fixed", top, left, zIndex: Z.workspace - 1, minWidth: 140,
        background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg, padding: "4px 0",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        fontFamily: FONT, animation: ANIM.settleIn(0),
      }}
    >
      {/* Move to */}
      <button
        onClick={() => setShowMoveSub((v) => !v)}
        onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        style={{ ...btnStyle, color: C.darkText }}
      >
        <IconFolder size={14} color={C.darkMuted} />
        Move to…
        <span style={{ marginLeft: "auto", fontSize: 10, color: C.darkMuted }}>{showMoveSub ? "▾" : "▸"}</span>
      </button>

      {showMoveSub && (
        <div style={{
          borderTop: `1px solid ${C.darkBorder}`,
          borderBottom: `1px solid ${C.darkBorder}`,
          maxHeight: 220, overflowY: "auto",
          background: `${C.dark}40`,
        }}>
          <div style={{
            padding: "5px 14px", fontSize: 10, fontWeight: 600,
            color: C.darkMuted, letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            Select destination
          </div>
          {moveTargets.map((target) => {
            const isCurrent = (item.parentId || null) === target.id;
            return (
              <button
                key={target.id || "__root__"}
                onClick={() => { if (!isCurrent) { onMove(item, target.id); onClose(); } }}
                disabled={isCurrent}
                onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = C.darkSurf; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                style={{
                  ...btnStyle, fontSize: 12,
                  color: isCurrent ? C.darkBorder : C.darkText,
                  opacity: isCurrent ? 0.5 : 1,
                  cursor: isCurrent ? "default" : "pointer",
                }}
              >
                {target.id ? <IconFolder size={12} color={target.page_type === "workspace" ? C.accent : C.darkMuted} /> : <IconGlobe size={12} color={C.darkMuted} />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{target.name}</span>
                {isCurrent && <span style={{ marginLeft: "auto", fontSize: 10, color: C.darkMuted, flexShrink: 0 }}>Current</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Separator */}
      <div style={{ height: 1, background: C.darkBorder, margin: "2px 8px" }} />

      {/* Delete */}
      <button
        onClick={() => { onDelete(item); onClose(); }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(192,57,43,0.15)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        style={{ ...btnStyle, color: "#e74c3c" }}
      >
        <IconTrash size={14} color="#e74c3c" />
        Delete
      </button>
    </div>
  );
}

export default function WorkspaceBrowser() {
  const { pageTree, pages, setActivePage, setActiveFolder, removePage, updatePageConfig } = usePlatform();
  const { targetFolderPath, setTargetFolderPath } = useNavigation();
  const { openDrawer } = useRecordDrawer();

  // Breadcrumb path: array of { id, name, node } — persisted to localStorage
  const [path, setPath] = useState(() => {
    try { const v = localStorage.getItem("wasabi_workspace_path"); return v ? JSON.parse(v) : []; } catch { return []; }
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchAll, setSearchAll] = useState(false);

  // Overflow menu state
  const [menuItem, setMenuItem] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const menuJustOpened = useRef(false);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Drag & drop state
  const [dragItem, setDragItem] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, position: "before"|"after"|"inside" }
  const [dropBreadcrumb, setDropBreadcrumb] = useState(null); // breadcrumb index being hovered
  const dragCounter = useRef({}); // per-element enter/leave counters

  // Persist path to localStorage
  useEffect(() => {
    try { localStorage.setItem("wasabi_workspace_path", JSON.stringify(path)); } catch {}
  }, [path]);

  // Listen for breadcrumb/navigation signals to set path
  useEffect(() => {
    if (targetFolderPath) {
      setPath(targetFolderPath);
      setTargetFolderPath(null);
    }
  }, [targetFolderPath, setTargetFolderPath]);

  // ── Resolve current level items ──
  const currentItems = useMemo(() => {
    if (path.length === 0) {
      return pageTree.map((node) => ({
        ...node,
        itemType: "folder",
        pageCount: (node.children?.length || 0) + (node.childFolders || []).reduce(
          (sum, f) => sum + (f.children?.length || 0), 0
        ),
      }));
    }

    let current = null;
    let nodes = pageTree;
    for (const segment of path) {
      current = nodes.find((n) => n.id === segment.id);
      if (!current) break;
      nodes = [...(current.childFolders || [])];
    }

    if (!current) return [];

    const items = [];
    for (const folder of (current.childFolders || [])) {
      items.push({
        ...folder,
        itemType: "folder",
        pageCount: (folder.children?.length || 0),
      });
    }
    for (const page of (current.children || [])) {
      items.push({
        ...page,
        itemType: "page",
      });
    }
    return items;
  }, [path, pageTree]);

  // ── Search filtering ──
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return searchAll ? [] : currentItems;

    if (searchAll) {
      return pages
        .filter((p) => !p._systemInternal && p.name?.toLowerCase().includes(q))
        .map((p) => ({
          ...p,
          itemType: p.type === "folder" ? "folder" : "page",
          pageCount: p.type === "folder"
            ? pages.filter((c) => c.parentId === p.id && c.type !== "folder").length
            : undefined,
        }));
    }

    return currentItems.filter((item) =>
      item.name?.toLowerCase().includes(q)
    );
  }, [searchQuery, searchAll, currentItems, pages]);

  const displayItems = searchQuery.trim() ? filteredItems : currentItems;

  // ── Navigation handlers ──
  const handleDrillDown = useCallback((node) => {
    setPath((prev) => [...prev, { id: node.id, name: node.name }]);
    setSearchQuery("");
    setSearchAll(false);
  }, []);

  const handleOpenPage = useCallback((page) => {
    setActivePage(page.id);
    if (page.parentId) setActiveFolder(page.parentId);
  }, [setActivePage, setActiveFolder]);

  const handleOpenSettings = useCallback((e, item) => {
    e.stopPropagation();
    openDrawer("workspace-settings", item);
  }, [openDrawer]);

  const handleBreadcrumb = useCallback((index) => {
    if (index < 0) {
      setPath([]);
    } else {
      setPath((prev) => prev.slice(0, index + 1));
    }
    setSearchQuery("");
    setSearchAll(false);
  }, []);

  // ── Overflow menu ──
  const handleOverflowClick = useCallback((e, item) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuAnchor({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
    setMenuItem(item);
    menuJustOpened.current = true;
    setTimeout(() => { menuJustOpened.current = false; }, 100);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuItem(null);
    setMenuAnchor(null);
  }, []);

  // ── Delete flow ──
  const handleDeleteRequest = useCallback((item) => {
    setDeleteTarget(item);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    try {
      await deletePageConfig(id);
      removePage(id);
    } catch (err) {
      console.error("[WorkspaceBrowser] Delete failed:", err);
    }
    setDeleteTarget(null);
  }, [deleteTarget, removePage]);

  // ── Move to folder ──
  const handleMove = useCallback(async (item, newParentId) => {
    // Calculate sort_order for the new parent
    const siblings = pages.filter((p) => (p.parentId || null) === newParentId);
    const newSortOrder = siblings.length > 0
      ? Math.max(...siblings.map((c) => c.sort_order || 0)) + 1
      : 0;
    // Optimistic update
    updatePageConfig(item.id, { parentId: newParentId, sort_order: newSortOrder });
    try {
      await reorderPages([{ id: item.id, sort_order: newSortOrder, parent_id: newParentId }]);
    } catch (err) {
      console.error("[WorkspaceBrowser] Move failed:", err);
    }
  }, [pages, updatePageConfig]);

  // All folders/workspaces for the "Move to" menu
  const allFolders = useMemo(() =>
    pages.filter((p) => p.type === "folder" && !p._systemInternal),
    [pages]
  );

  // ── Drag & Drop ──
  const handleDragStart = useCallback((e, item) => {
    setDragItem(item);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.id);
    // Style the dragged card
    requestAnimationFrame(() => {
      e.target.dataset.dragging = "true";
      e.target.style.opacity = "0.4";
    });
  }, []);

  const handleDragEnd = useCallback((e) => {
    e.target.dataset.dragging = "false";
    e.target.style.opacity = "1";
    setDragItem(null);
    setDropTarget(null);
    setDropBreadcrumb(null);
    dragCounter.current = {};
  }, []);

  const getDropPosition = (e, element) => {
    const rect = element.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const third = rect.height / 3;
    if (y < third) return "before";
    if (y > third * 2) return "after";
    return "inside";
  };

  const handleDragOver = useCallback((e, item) => {
    e.preventDefault();
    if (!dragItem || dragItem.id === item.id) return;
    e.dataTransfer.dropEffect = "move";
    const pos = getDropPosition(e, e.currentTarget);
    // Only allow "inside" drop on folders
    const effectivePos = (pos === "inside" && item.itemType !== "folder") ? "after" : pos;
    setDropTarget({ id: item.id, position: effectivePos });
  }, [dragItem]);

  const handleDragEnter = useCallback((e, item) => {
    e.preventDefault();
    const id = item.id;
    dragCounter.current[id] = (dragCounter.current[id] || 0) + 1;
  }, []);

  const handleDragLeave = useCallback((e, item) => {
    const id = item.id;
    dragCounter.current[id] = (dragCounter.current[id] || 0) - 1;
    if (dragCounter.current[id] <= 0) {
      dragCounter.current[id] = 0;
      if (dropTarget?.id === id) setDropTarget(null);
    }
  }, [dropTarget]);

  const handleDrop = useCallback(async (e, targetItem) => {
    e.preventDefault();
    if (!dragItem || dragItem.id === targetItem.id) return;

    const pos = dropTarget?.position || "after";
    const currentParent = path.length > 0 ? path[path.length - 1].id : null;

    if (pos === "inside" && targetItem.itemType === "folder") {
      // Move into folder
      const newParentId = targetItem.id;
      // Get items inside target folder to determine sort_order
      const targetChildren = pages.filter((p) => p.parentId === newParentId);
      const newSortOrder = targetChildren.length > 0
        ? Math.max(...targetChildren.map((c) => c.sort_order || 0)) + 1
        : 0;
      try {
        await reorderPages([{ id: dragItem.id, sort_order: newSortOrder, parent_id: newParentId }]);
        updatePageConfig(dragItem.id, { parentId: newParentId, sort_order: newSortOrder });
      } catch (err) {
        console.error("[DnD] Move into folder failed:", err);
      }
    } else {
      // Reorder within current container
      const reordered = [...displayItems.filter((it) => it.id !== dragItem.id)];
      const targetIdx = reordered.findIndex((it) => it.id === targetItem.id);
      const insertIdx = pos === "before" ? targetIdx : targetIdx + 1;
      reordered.splice(insertIdx, 0, dragItem);

      // Build batch update
      const batch = reordered.map((it, i) => ({
        id: it.id,
        sort_order: i,
        ...(it.id === dragItem.id && currentParent !== (dragItem.parentId || null)
          ? { parent_id: currentParent }
          : {}
        ),
      }));

      // Optimistic UI update
      for (const b of batch) {
        updatePageConfig(b.id, { sort_order: b.sort_order, ...(b.parent_id !== undefined ? { parentId: b.parent_id } : {}) });
      }

      try {
        await reorderPages(batch);
      } catch (err) {
        console.error("[DnD] Reorder failed:", err);
      }
    }

    setDragItem(null);
    setDropTarget(null);
    dragCounter.current = {};
  }, [dragItem, dropTarget, displayItems, path, pages, updatePageConfig]);

  // ── Breadcrumb drop handlers ──
  const handleBreadcrumbDragOver = useCallback((e, index) => {
    e.preventDefault();
    if (!dragItem) return;
    e.dataTransfer.dropEffect = "move";
    setDropBreadcrumb(index);
  }, [dragItem]);

  const handleBreadcrumbDragLeave = useCallback((e) => {
    setDropBreadcrumb(null);
  }, []);

  const handleBreadcrumbDrop = useCallback(async (e, index) => {
    e.preventDefault();
    if (!dragItem) return;

    // index -1 = root (no parent), otherwise path[index].id
    const newParentId = index < 0 ? null : path[index].id;

    // Don't drop onto current parent
    const currentParent = dragItem.parentId || null;
    if (newParentId === currentParent) {
      setDropBreadcrumb(null);
      return;
    }

    // Get siblings in target to find next sort_order
    const siblings = pages.filter((p) => {
      const pParent = p.parentId || null;
      return pParent === newParentId && p.id !== dragItem.id;
    });
    const newSortOrder = siblings.length > 0
      ? Math.max(...siblings.map((s) => s.sort_order || 0)) + 1
      : 0;

    try {
      await reorderPages([{ id: dragItem.id, sort_order: newSortOrder, parent_id: newParentId }]);
      updatePageConfig(dragItem.id, { parentId: newParentId, sort_order: newSortOrder });
    } catch (err) {
      console.error("[DnD] Breadcrumb move failed:", err);
    }

    setDragItem(null);
    setDropBreadcrumb(null);
    dragCounter.current = {};
  }, [dragItem, path, pages, updatePageConfig]);

  // ── Drop indicator rendering ──
  const getDropIndicatorStyle = (itemId) => {
    if (!dropTarget || dropTarget.id !== itemId || !dragItem) return {};
    if (dropTarget.position === "inside") {
      return { outline: `2px solid ${C.accent}`, outlineOffset: -2 };
    }
    return {};
  };

  const getInsertLineStyle = (itemId, position) => {
    if (!dropTarget || dropTarget.id !== itemId || dropTarget.position !== position || !dragItem) {
      return { display: "none" };
    }
    return {
      position: "absolute",
      left: 0, right: 0,
      height: 2,
      background: C.accent,
      borderRadius: 1,
      zIndex: 10,
      ...(position === "before" ? { top: -7 } : { bottom: -7 }),
    };
  };

  // ── Delete dialog content ──
  const getDeleteInfo = () => {
    if (!deleteTarget) return {};
    const isFolder = deleteTarget.itemType === "folder";
    const isWorkspace = isFolder && path.length === 0;
    const childCount = isFolder
      ? pages.filter((p) => p.parentId === deleteTarget.id).length
      : 0;

    if (isWorkspace) {
      return {
        title: `Delete "${deleteTarget.name}"?`,
        message: `This will permanently delete the workspace and all its contents.`,
        warning: childCount > 0
          ? `This workspace contains ${childCount} item${childCount !== 1 ? "s" : ""} (folders, databases, documents). All will be permanently deleted.`
          : null,
      };
    }
    if (isFolder) {
      return {
        title: `Delete "${deleteTarget.name}"?`,
        message: `This will permanently delete this folder and all its contents.`,
        warning: childCount > 0
          ? `This folder contains ${childCount} item${childCount !== 1 ? "s" : ""}. All will be permanently deleted.`
          : null,
      };
    }
    return {
      title: `Delete "${deleteTarget.name}"?`,
      message: `This will permanently delete this ${deleteTarget.page_type || deleteTarget.pageType || "page"} and all its data.`,
      warning: null,
    };
  };

  // ── Styles ──
  const styles = {
    wrapper: {
      display: "flex", flexDirection: "column", height: "100%",
      overflow: "auto", background: C.dark, fontFamily: FONT,
    },
    header: {
      padding: "24px 28px 0", flexShrink: 0,
    },
    breadcrumb: {
      display: "flex", alignItems: "center", gap: 4,
      marginBottom: 16, flexWrap: "wrap",
    },
    breadcrumbSegment: (isLast, isDropTarget) => ({
      fontSize: 13, fontWeight: isLast ? 600 : 400, fontFamily: FONT,
      color: isDropTarget ? C.accent : (isLast ? C.darkText : C.darkMuted),
      cursor: isLast && !dragItem ? "default" : "pointer",
      background: isDropTarget ? "rgba(76,175,80,0.12)" : "none",
      border: "none", padding: "2px 8px",
      borderRadius: RADIUS.sm, transition: "all 0.15s",
      outline: isDropTarget ? `2px solid ${C.accent}` : "none",
    }),
    backBtn: {
      background: "none", border: "none", cursor: "pointer",
      padding: "4px 6px", borderRadius: RADIUS.sm,
      display: "flex", alignItems: "center", transition: "background 0.15s",
    },
    searchRow: {
      display: "flex", alignItems: "center", gap: 8,
      marginBottom: 20, position: "relative",
    },
    searchInput: {
      flex: 1, padding: "9px 12px 9px 34px",
      background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
      borderRadius: RADIUS.pill, fontSize: 13, fontFamily: FONT,
      color: C.darkText, outline: "none", transition: "border-color 0.15s",
    },
    searchIcon: {
      position: "absolute", left: 10, top: "50%",
      transform: "translateY(-50%)", pointerEvents: "none",
    },
    searchAllToggle: {
      fontSize: 11, fontWeight: 500, fontFamily: FONT,
      color: C.accent, cursor: "pointer", whiteSpace: "nowrap",
      background: "none", border: "none", padding: "4px 8px",
      borderRadius: RADIUS.sm, transition: "opacity 0.15s",
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
      gap: 12, padding: "0 28px 28px",
    },
    card: (delay = 0) => ({
      background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
      borderRadius: RADIUS.xl, padding: "18px 16px",
      cursor: "grab", transition: "all 0.15s", fontFamily: FONT,
      animation: ANIM.settleIn(delay), display: "flex",
      flexDirection: "column", gap: 8, position: "relative",
    }),
    cardTitle: {
      fontSize: 14, fontWeight: 600, color: C.darkText,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    },
    cardMeta: {
      fontSize: 11, color: C.darkMuted, lineHeight: 1.4,
    },
    empty: {
      padding: "40px 28px", textAlign: "center",
      fontSize: 13, color: C.darkMuted, fontFamily: FONT,
    },
    overflowBtn: {
      background: "none", border: "none", cursor: "pointer",
      padding: 4, borderRadius: RADIUS.sm, display: "flex",
      alignItems: "center", justifyContent: "center",
      opacity: 0, transition: "opacity 0.15s",
    },
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        {/* ── Breadcrumb (also drop targets) ── */}
        <div style={styles.breadcrumb}>
          {path.length > 0 && (
            <button
              style={styles.backBtn}
              onClick={() => handleBreadcrumb(path.length - 2)}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              title="Go back"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M10 3L5 8l5 5" stroke={C.darkMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <button
            style={styles.breadcrumbSegment(path.length === 0, dropBreadcrumb === -1)}
            onClick={() => handleBreadcrumb(-1)}
            onMouseEnter={(e) => { if (path.length > 0 && !dragItem) e.currentTarget.style.color = C.accent; }}
            onMouseLeave={(e) => { if (path.length > 0 && !dragItem) e.currentTarget.style.color = C.darkMuted; }}
            onDragOver={(e) => handleBreadcrumbDragOver(e, -1)}
            onDragLeave={handleBreadcrumbDragLeave}
            onDrop={(e) => handleBreadcrumbDrop(e, -1)}
          >
            Workspaces
          </button>
          {path.map((segment, i) => (
            <React.Fragment key={segment.id}>
              <IconChevronRight size={10} color={C.darkMuted} />
              <button
                style={styles.breadcrumbSegment(i === path.length - 1, dropBreadcrumb === i)}
                onClick={() => handleBreadcrumb(i)}
                onMouseEnter={(e) => { if (i < path.length - 1 && !dragItem) e.currentTarget.style.color = C.accent; }}
                onMouseLeave={(e) => { if (i < path.length - 1 && !dragItem) e.currentTarget.style.color = C.darkMuted; }}
                onDragOver={(e) => handleBreadcrumbDragOver(e, i)}
                onDragLeave={handleBreadcrumbDragLeave}
                onDrop={(e) => handleBreadcrumbDrop(e, i)}
              >
                {segment.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* ── Search ── */}
        <div style={styles.searchRow}>
          <div style={{ position: "relative", flex: 1 }}>
            <div style={styles.searchIcon}>
              <IconSearch size={14} color={C.darkMuted} />
            </div>
            <input
              type="text"
              placeholder={searchAll ? "Search all pages..." : `Search ${path.length > 0 ? path[path.length - 1].name : "workspaces"}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
              onFocus={(e) => { e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); setSearchAll(false); }}
                style={{
                  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 14, color: C.darkMuted, padding: "2px 4px",
                }}
              >
                ×
              </button>
            )}
          </div>
          <button
            style={{
              ...styles.searchAllToggle,
              opacity: searchAll ? 1 : 0.6,
              textDecoration: searchAll ? "underline" : "none",
            }}
            onClick={() => setSearchAll((v) => !v)}
            title={searchAll ? "Search current level" : "Search all pages"}
          >
            {searchAll ? "All" : "All"}
          </button>
        </div>
      </div>

      {/* ── Cards Grid ── */}
      {displayItems.length > 0 ? (
        <div style={styles.grid}>
          {displayItems.map((item, i) => (
            <div
              key={item.id}
              draggable
              onDragStart={(e) => handleDragStart(e, item)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, item)}
              onDragEnter={(e) => handleDragEnter(e, item)}
              onDragLeave={(e) => handleDragLeave(e, item)}
              onDrop={(e) => handleDrop(e, item)}
              style={{
                ...styles.card(i * 0.02),
                ...getDropIndicatorStyle(item.id),
              }}
              onClick={(e) => {
                // Don't navigate if overflow menu was just opened
                if (menuJustOpened.current || menuItem) return;
                if (item.itemType === "folder") {
                  handleDrillDown(item);
                } else {
                  handleOpenPage(item);
                }
              }}
              onMouseEnter={(e) => {
                applyHover(e);
                // Show overflow buttons
                const btns = e.currentTarget.querySelectorAll("[data-overflow]");
                btns.forEach((b) => { b.style.opacity = "1"; });
              }}
              onMouseLeave={(e) => {
                removeHover(e);
                // Don't hide overflow buttons if the menu is open for this card
                if (menuItem?.id === item.id) return;
                const btns = e.currentTarget.querySelectorAll("[data-overflow]");
                btns.forEach((b) => { b.style.opacity = "0"; });
              }}
            >
              {/* Drop position indicators */}
              <div style={getInsertLineStyle(item.id, "before")} />
              <div style={getInsertLineStyle(item.id, "after")} />

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                {item.itemType === "folder" ? (
                  <IconFolder size={18} color={C.accent} />
                ) : (
                  <PageIcon size={18} color={C.accent} />
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  {path.length === 0 && item.itemType === "folder" && (
                    <button
                      onClick={(e) => handleOpenSettings(e, item)}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        padding: 4, borderRadius: RADIUS.sm, display: "flex",
                        alignItems: "center", justifyContent: "center",
                        opacity: 0, transition: "opacity 0.15s",
                      }}
                      data-overflow="true"
                      onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      title="Workspace settings"
                    >
                      <IconGear size={14} color={C.darkMuted} />
                    </button>
                  )}
                  <button
                    onClick={(e) => handleOverflowClick(e, item)}
                    style={styles.overflowBtn}
                    data-overflow="true"
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    title="More options"
                  >
                    <OverflowDots size={16} color={C.darkMuted} />
                  </button>
                </div>
              </div>
              <div style={styles.cardTitle}>{item.name}</div>
              <div style={styles.cardMeta}>
                {item.itemType === "folder"
                  ? `${item.pageCount || 0} page${(item.pageCount || 0) !== 1 ? "s" : ""}`
                  : `${item.views?.length || 0} view${(item.views?.length || 0) !== 1 ? "s" : ""}`
                }
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={styles.empty}>
          {searchQuery
            ? "No results found"
            : path.length > 0
              ? "This folder is empty"
              : "No workspaces yet"
          }
        </div>
      )}

      {/* Drawer for workspace settings */}
      <RecordDrawer />

      {/* Overflow menu */}
      {menuItem && (
        <OverflowMenu
          item={menuItem}
          anchorRect={menuAnchor}
          onDelete={handleDeleteRequest}
          onMove={handleMove}
          folders={allFolders}
          onClose={closeMenu}
        />
      )}

      {/* Delete confirmation dialog */}
      {deleteTarget && (() => {
        const info = getDeleteInfo();
        return (
          <ConfirmDialog
            title={info.title}
            message={info.message}
            warning={info.warning}
            onConfirm={handleDeleteConfirm}
            onCancel={() => setDeleteTarget(null)}
          />
        );
      })()}
    </div>
  );
}
