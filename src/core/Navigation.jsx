// ─── Sidebar Navigation ───
// FolderDropdown at top → page list below for selected folder.
// Collapsible: 48px (icons) or 220px (full).
// Supports: right-click context menu, drag-drop page reordering.

import React, { useState, useCallback } from "react";
import { C, FONT, RADIUS, VIEW_PALETTE } from "../design/tokens.js";
import { ANIM, TRANSITION } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { savePageConfig, archivePageConfig, createFolderConfig } from "../config/pageConfig.js";
import { archivePage } from "../notion/client.js";
import {
  IconBolt, IconGear, IconStar, IconPlus, IconTrash, IconDiamond,
} from "../design/icons.jsx";
import WasabiFlame from "./WasabiFlame.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import InlineEdit from "./InlineEdit.jsx";
import FolderDropdown from "./FolderDropdown.jsx";
import ContextMenu, { MoveToMenu } from "./ContextMenu.jsx";

export default function Navigation({
  collapsed,
  onToggleCollapse,
  wasabiPanelOpen,
  onToggleWasabiPanel,
  isThinking,
  onCreatePage,
}) {
  const {
    user, pages, activePage, setActivePage,
    updatePageConfig, removePage, addPage,
    activeFolder, setActiveFolder, pageTree, folders, getFolderPages,
  } = usePlatform();

  const [hoveredItem, setHoveredItem] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, page }
  const [moveToMenu, setMoveToMenu] = useState(null); // { x, y, page }
  const [dragIdx, setDragIdx] = useState(null);
  const [dropIdx, setDropIdx] = useState(null);

  const SIDEBAR_W = collapsed ? 48 : 220;

  // Pages in the current folder
  const folderPages = activeFolder ? getFolderPages(activeFolder) : [];

  // ── Create Folder ──
  const handleCreateFolder = useCallback(async () => {
    const allFolders = pages.filter((p) => p.type === "folder");
    const colorIndex = allFolders.length % 10;
    const config = createFolderConfig("New Folder", "folder");
    config.colorIndex = colorIndex;
    try {
      const id = await savePageConfig(config);
      addPage({ ...config, id });
      setActiveFolder(id);
    } catch (err) {
      console.error("[Navigation] Failed to create folder:", err);
    }
  }, [addPage, pages, setActiveFolder]);

  // ── Rename Page ──
  const handleRename = useCallback((pageConfig, newName) => {
    updatePageConfig(pageConfig.id, { name: newName });
  }, [updatePageConfig]);

  // ── Delete Page / Folder ──
  const handleDelete = useCallback(async (pageConfig) => {
    removePage(pageConfig.id);
    setConfirmDelete(null);

    archivePageConfig(pageConfig.id).catch((err) => {
      console.error("[Navigation] Failed to delete page from D1:", err);
    });

    if (user?.workerUrl && user?.notionKey) {
      const pt = pageConfig.pageType || pageConfig.page_type;
      if (pt !== "linked_notion") {
        for (const dbId of (pageConfig.databaseIds || [])) {
          archivePage(user.workerUrl, user.notionKey, dbId).catch(() => {});
        }
      }
      if (pt === "document" && pageConfig.notionPageId) {
        archivePage(user.workerUrl, user.notionKey, pageConfig.notionPageId).catch(() => {});
      }
    }
  }, [user, removePage]);

  // ── Move page to folder ──
  const handleMoveTo = useCallback((page, targetFolderId) => {
    updatePageConfig(page.id, { parentId: targetFolderId });
    setMoveToMenu(null);
    setContextMenu(null);
  }, [updatePageConfig]);

  // ── Navigate to page ──
  const navigateToPage = useCallback((page) => {
    setActivePage(page.id);
  }, [setActivePage]);

  // ── Handle dashboard selection ──
  const handleSelectDashboard = useCallback(() => {
    setActivePage("dashboard");
    setActiveFolder(null);
  }, [setActivePage, setActiveFolder]);

  // ── Right-click context menu ──
  const handleContextMenu = useCallback((e, page) => {
    e.preventDefault();
    e.stopPropagation();
    setMoveToMenu(null);
    setContextMenu({ x: e.clientX, y: e.clientY, page });
  }, []);

  // ── Drag-drop page reordering ──
  const handleDragEnd = useCallback(() => {
    if (dragIdx !== null && dropIdx !== null && dragIdx !== dropIdx) {
      const reordered = [...folderPages];
      const [moved] = reordered.splice(dragIdx, 1);
      reordered.splice(dropIdx, 0, moved);
      // Update sort_order for all affected pages
      reordered.forEach((page, idx) => {
        if (page.sort_order !== idx) {
          updatePageConfig(page.id, { sort_order: idx });
        }
      });
    }
    setDragIdx(null);
    setDropIdx(null);
  }, [dragIdx, dropIdx, folderPages, updatePageConfig]);

  // Build folder list for "Move to..." (with colors)
  const allFoldersForMove = folders.map((f) => ({
    ...f,
    color: VIEW_PALETTE[(f.colorIndex ?? 0) % VIEW_PALETTE.length]?.hex,
  }));

  // ── Style helpers ──
  const bottomBtnStyle = (isActive) => ({
    background: isActive ? C.accent : "none",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: collapsed ? 0 : 10,
    padding: collapsed ? "8px 0" : "7px 10px",
    borderRadius: RADIUS.lg,
    transition: "background 0.15s",
    outline: "none",
    width: "100%",
    justifyContent: collapsed ? "center" : "flex-start",
  });

  const bottomLabelStyle = (isActive) => ({
    fontFamily: "'Outfit',sans-serif",
    fontSize: 12,
    fontWeight: isActive ? 600 : 400,
    color: isActive ? "#fff" : C.darkMuted,
    letterSpacing: "0.02em",
  });

  const itemStyle = (isActive, isHovered) => ({
    width: collapsed ? "100%" : "calc(100% - 16px)",
    margin: collapsed ? "0" : "3px 8px",
    border: isActive ? "none" : `1px solid ${C.darkBorder}`,
    cursor: "pointer",
    outline: "none",
    display: "flex",
    alignItems: "center",
    gap: collapsed ? 0 : 10,
    justifyContent: collapsed ? "center" : "flex-start",
    padding: collapsed ? "11px 0" : "9px 14px",
    borderRadius: collapsed ? 0 : 999,
    background: isActive ? C.accent : isHovered ? C.darkSurf2 : "transparent",
    transition: "all 0.12s",
    fontFamily: "'Outfit',sans-serif",
  });

  return (
    <div
      style={{
        width: SIDEBAR_W,
        flexShrink: 0,
        background: C.dark,
        borderRight: `1px solid ${C.edgeLine}`,
        display: "flex",
        flexDirection: "column",
        transition: TRANSITION.sidebar,
        position: "relative",
        boxShadow: "2px 0 8px rgba(0,0,0,0.2)",
        overflow: "hidden",
      }}
    >
      {/* ── Folder Dropdown (top of sidebar) ── */}
      <FolderDropdown
        activeFolder={activeFolder}
        activePage={activePage}
        onSelectFolder={setActiveFolder}
        onSelectDashboard={handleSelectDashboard}
        onCreateFolder={handleCreateFolder}
        pageTree={pageTree}
        collapsed={collapsed}
      />

      {/* ── Main list area ── */}
      <div style={{ flex: 1, overflowY: "auto", paddingTop: 6, paddingBottom: 48 }}>
        {/* ── Page list (when folder is selected) ── */}
        {activeFolder && folderPages.map((page, idx) => {
          const isActive = activePage === page.id;
          const isHovered = hoveredItem === `page_${page.id}`;
          const isDragging = dragIdx === idx;
          const isDropTarget = dropIdx === idx && dragIdx !== null && dragIdx !== idx;
          return (
            <div
              key={page.id}
              draggable={!collapsed}
              onDragStart={(e) => {
                setDragIdx(idx);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(idx));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropIdx(idx);
              }}
              onDragEnd={handleDragEnd}
              onDragLeave={() => setDropIdx(null)}
              style={{
                display: "flex",
                alignItems: "center",
                position: "relative",
                opacity: isDragging ? 0.4 : 1,
                borderTop: isDropTarget && dragIdx > idx ? `2px solid ${C.accent}` : "2px solid transparent",
                borderBottom: isDropTarget && dragIdx < idx ? `2px solid ${C.accent}` : "2px solid transparent",
                transition: "opacity 0.12s",
                animation: ANIM.listItem(idx),
              }}
            >
              <button
                onClick={() => navigateToPage(page)}
                onContextMenu={(e) => handleContextMenu(e, page)}
                onMouseEnter={() => setHoveredItem(`page_${page.id}`)}
                onMouseLeave={() => setHoveredItem(null)}
                title={collapsed ? page.name : undefined}
                style={{
                  ...itemStyle(isActive, isHovered),
                  flex: 1,
                }}
              >
                <IconDiamond
                  size={8}
                  color={isActive ? "#fff" : C.darkBorder}
                />
                {!collapsed && (
                  <InlineEdit
                    value={page.name}
                    onCommit={(newName) => handleRename(page, newName)}
                    placeholder="Untitled"
                    fontSize={13}
                    fontWeight={isActive ? 600 : 400}
                    color={isActive ? "#fff" : C.darkText}
                  />
                )}
                {/* Active dot */}
                {isActive && !collapsed && !isHovered && (
                  <div style={{
                    marginLeft: "auto", width: 5, height: 5,
                    borderRadius: "50%", background: "#fff", flexShrink: 0,
                    boxShadow: "0 0 4px rgba(255,255,255,0.4)",
                  }} />
                )}
                {/* Delete on hover */}
                {isHovered && !collapsed && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete({ type: "page", pageConfig: page });
                    }}
                    title="Delete page"
                    style={{
                      marginLeft: "auto", background: "none", border: "none",
                      cursor: "pointer", padding: 2, display: "flex",
                      alignItems: "center", opacity: 0.5, transition: "opacity 0.12s",
                      outline: "none", flexShrink: 0,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
                  >
                    <IconTrash size={9} color={isActive ? "#fff" : C.darkMuted} />
                  </button>
                )}
              </button>
            </div>
          );
        })}

        {/* Empty folder message */}
        {activeFolder && folderPages.length === 0 && !collapsed && (
          <div style={{
            padding: "16px 20px", fontFamily: "'Outfit',sans-serif",
            fontSize: 11, color: C.darkBorder, letterSpacing: "0.04em",
          }}>
            No pages in this folder
          </div>
        )}

        {/* No folder selected — prompt to pick one */}
        {!activeFolder && activePage !== "dashboard" && !collapsed && (
          <div style={{
            padding: "20px 16px", fontFamily: "'Outfit',sans-serif",
            fontSize: 11, color: C.darkMuted, letterSpacing: "0.02em",
            textAlign: "center", lineHeight: 1.5,
          }}>
            Select a folder above to view pages
          </div>
        )}

        {/* ── "New Page" button (when inside a folder) ── */}
        {activeFolder && !collapsed && (
          <div style={{ padding: "4px 8px" }}>
            <button
              onClick={() => onCreatePage?.(activeFolder)}
              style={{
                width: "100%", border: `1px dashed ${C.darkBorder}`,
                background: "transparent", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 14px", borderRadius: 999,
                fontFamily: "'Outfit',sans-serif", fontSize: 12,
                color: C.darkMuted, outline: "none", transition: "all 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; e.currentTarget.style.color = C.darkMuted; }}
            >
              <IconPlus size={10} color="currentColor" />
              <span>New Page</span>
            </button>
          </div>
        )}
        {activeFolder && collapsed && (
          <button
            onClick={() => onCreatePage?.(activeFolder)}
            title="New Page"
            style={{
              width: "100%", border: "none", background: "transparent",
              cursor: "pointer", display: "flex", alignItems: "center",
              justifyContent: "center", padding: "10px 0", outline: "none",
            }}
          >
            <IconPlus size={12} color={C.darkMuted} />
          </button>
        )}
      </div>

      {/* ── Bottom action buttons ── */}
      <div
        style={{
          flexShrink: 0,
          borderTop: `1px solid ${C.darkBorder}`,
          padding: collapsed ? "8px 0" : "8px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflow: "hidden",
          transition: "padding 0.25s",
        }}
      >
        {/* Home */}
        <button
          onClick={() => { setActivePage(null); setActiveFolder(null); }}
          title="Home"
          style={bottomBtnStyle(activePage === null && !activeFolder)}
          onMouseEnter={(e) => { if (activePage !== null || activeFolder) e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { if (activePage !== null || activeFolder) e.currentTarget.style.background = "transparent"; }}
        >
          <IconStar size={collapsed ? 16 : 14} color={(activePage === null && !activeFolder) ? "#fff" : C.darkMuted} />
          {!collapsed && <span style={bottomLabelStyle(activePage === null && !activeFolder)}>Home</span>}
        </button>

        {/* Automations */}
        <button
          onClick={() => setActivePage("automations")}
          title="Automations"
          style={bottomBtnStyle(activePage === "automations")}
          onMouseEnter={(e) => { if (activePage !== "automations") e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { if (activePage !== "automations") e.currentTarget.style.background = "transparent"; }}
        >
          <IconBolt size={collapsed ? 16 : 14} color={activePage === "automations" ? "#fff" : C.darkMuted} />
          {!collapsed && <span style={bottomLabelStyle(activePage === "automations")}>Automations</span>}
        </button>

        {/* System */}
        <button
          onClick={() => setActivePage("system")}
          title="System"
          style={bottomBtnStyle(activePage === "system")}
          onMouseEnter={(e) => { if (activePage !== "system") e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { if (activePage !== "system") e.currentTarget.style.background = "transparent"; }}
        >
          <IconGear size={collapsed ? 16 : 14} color={activePage === "system" ? "#fff" : C.darkMuted} />
          {!collapsed && <span style={bottomLabelStyle(activePage === "system")}>System</span>}
        </button>

        {/* Wasabi flame */}
        {!wasabiPanelOpen && (
          <button
            onClick={onToggleWasabiPanel}
            style={{
              background: "none", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center",
              gap: collapsed ? 0 : 10,
              padding: collapsed ? "6px 0" : "6px 8px",
              borderRadius: RADIUS.lg, transition: "background 0.15s",
              outline: "none", width: "100%",
              justifyContent: collapsed ? "center" : "flex-start",
              marginTop: 2,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            title="Open Wasabi"
          >
            <WasabiFlame size={collapsed ? 26 : 30} isThinking={isThinking} />
            {!collapsed && (
              <span style={{
                fontFamily: "'Outfit',sans-serif", fontSize: 12, fontWeight: 500,
                color: C.darkMuted, letterSpacing: "0.02em",
              }}>
                Wasabi
              </span>
            )}
          </button>
        )}
      </div>

      {/* ── Collapse toggle tab ── */}
      <button
        onClick={onToggleCollapse}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        style={{
          position: "absolute", top: "50%", right: -12,
          transform: "translateY(-50%)",
          width: 22, height: 44,
          background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
          borderRadius: "0 8px 8px 0",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", outline: "none", zIndex: 10,
          transition: "background 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#363636"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
      >
        <svg width="8" height="12" viewBox="0 0 8 12" fill="none">
          <path
            d={collapsed ? "M2 2L6 6L2 10" : "M6 2L2 6L6 10"}
            stroke={C.darkMuted}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* ── Context Menu ── */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => { setContextMenu(null); setMoveToMenu(null); }}
          items={[
            {
              label: "Rename",
              onClick: () => {
                // Rename is handled inline — just close menu
              },
            },
            {
              label: "Move to...",
              sub: true,
              onClick: () => {
                setMoveToMenu({
                  x: contextMenu.x,
                  y: contextMenu.y,
                  page: contextMenu.page,
                });
              },
            },
            { separator: true },
            {
              label: "Delete",
              danger: true,
              onClick: () => {
                setConfirmDelete({ type: "page", pageConfig: contextMenu.page });
              },
            },
          ]}
        />
      )}

      {/* ── Move To sub-menu ── */}
      {moveToMenu && (
        <MoveToMenu
          x={moveToMenu.x}
          y={moveToMenu.y}
          folders={allFoldersForMove}
          currentFolderId={activeFolder}
          onMove={(targetFolderId) => handleMoveTo(moveToMenu.page, targetFolderId)}
          onClose={() => setMoveToMenu(null)}
        />
      )}

      {/* ── Confirm dialogs ── */}
      {confirmDelete?.type === "page" && (
        <ConfirmDialog
          title="Delete Page"
          message={`Are you sure you want to delete "${confirmDelete.pageConfig.name}"? This action cannot be undone.`}
          onConfirm={() => handleDelete(confirmDelete.pageConfig)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
