// ─── Sidebar Navigation ───
// Folder → Page hierarchy navigation sidebar.
// Shows folders at top level, pages within a folder when selected.
// View tabs have moved to SubPageNav (in the main content area).
// Collapsible: 48px (icons) or 220px (full).

import React, { useState, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { savePageConfig, archivePageConfig, createFolderConfig } from "../config/pageConfig.js";
import { archivePage, ensurePageActive } from "../notion/client.js";
import {
  IconBolt, IconGear, IconStar, IconPlus, IconPage, IconTrash,
  IconFolder, IconChevronLeft, IconDiamond,
} from "../design/icons.jsx";
import WasabiFlame from "./WasabiFlame.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import InlineEdit from "./InlineEdit.jsx";

export default function Navigation({
  collapsed,
  onToggleCollapse,
  wasabiPanelOpen,
  onToggleWasabiPanel,
  isThinking,
  onCreatePage,  // opens builder in page-creation mode for current folder
}) {
  const {
    user, platformIds, pages, activePage, setActivePage,
    updatePageConfig, removePage, addPage,
    activeFolder, setActiveFolder, pageTree, getFolderPages,
  } = usePlatform();

  const [hoveredItem, setHoveredItem] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const SIDEBAR_W = collapsed ? 48 : 220;

  // Get the active folder object from pageTree
  const folderObj = activeFolder
    ? pageTree.find((f) => f.id === activeFolder)
    : null;

  // Pages in the current folder
  const folderPages = activeFolder ? getFolderPages(activeFolder) : [];

  // ── Create Folder ──
  const handleCreateFolder = useCallback(async () => {
    const config = createFolderConfig("New Folder", "folder");
    try {
      const id = await savePageConfig(config);
      addPage({ ...config, id });
    } catch (err) {
      console.error("[Navigation] Failed to create folder:", err);
    }
  }, [addPage]);

  // ── Rename Folder / Page ──
  const handleRename = useCallback((pageConfig, newName) => {
    // updatePageConfig now auto-persists to D1
    updatePageConfig(pageConfig.id, { name: newName });
  }, [updatePageConfig]);

  // ── Delete Page / Folder ──
  const handleDelete = useCallback(async (pageConfig) => {
    // 1. Remove from local state (instant UI update)
    removePage(pageConfig.id);
    setConfirmDelete(null);

    // 2. Delete from D1 (permanent — cascades to rows, schema, docs, sheets)
    archivePageConfig(pageConfig.id).catch((err) => {
      console.error("[Navigation] Failed to delete page from D1:", err);
    });

    // 3. Best-effort Notion cleanup for linked pages (does NOT delete from Notion DB)
    if (user?.workerUrl && user?.notionKey) {
      // Archive Notion databases that were created by the app (not linked ones)
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

  // ── Navigate to page (also set its folder) ──
  const navigateToPage = useCallback((page) => {
    setActivePage(page.id);
  }, [setActivePage]);

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
        transition: "width 0.25s cubic-bezier(0.4,0,0.2,1)",
        position: "relative",
        boxShadow: "2px 0 8px rgba(0,0,0,0.2)",
        overflow: "hidden",
      }}
    >
      {/* ── Header: Folder navigation ── */}
      {!collapsed && (
        <div
          style={{
            padding: "14px 16px 10px",
            borderBottom: `1px solid ${C.darkBorder}`,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {activeFolder ? (
            <>
              {/* Back to folder list */}
              <button
                onClick={() => setActiveFolder(null)}
                title="Back to folders"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  padding: 4, display: "flex", alignItems: "center",
                  outline: "none", flexShrink: 0,
                }}
              >
                <IconChevronLeft size={14} color={C.darkMuted} />
              </button>
              {folderObj?.virtual ? (
                <span style={{
                  fontFamily: "'Outfit',sans-serif", fontSize: 11, fontWeight: 600,
                  letterSpacing: "0.1em", textTransform: "uppercase", color: C.darkMuted,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {folderObj.name}
                </span>
              ) : folderObj ? (
                <InlineEdit
                  value={folderObj.name}
                  onCommit={(newName) => handleRename(folderObj, newName)}
                  placeholder="Folder"
                  fontSize={11}
                  fontWeight={600}
                  color={C.darkMuted}
                  maxWidth="130px"
                />
              ) : null}
              {/* Delete folder */}
              {folderObj && !folderObj.virtual && (
                <button
                  onClick={() => setConfirmDelete({ type: "folder", pageConfig: folderObj })}
                  title="Delete folder"
                  style={{
                    marginLeft: "auto", background: "none", border: "none",
                    cursor: "pointer", padding: 4, display: "flex",
                    alignItems: "center", opacity: 0.3, transition: "opacity 0.15s",
                    outline: "none", flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.3"; }}
                >
                  <IconTrash size={11} color={C.darkMuted} />
                </button>
              )}
            </>
          ) : (
            <span style={{
              fontFamily: "'Outfit',sans-serif", fontSize: 10, fontWeight: 600,
              letterSpacing: "0.2em", textTransform: "uppercase", color: C.darkMuted,
            }}>
              Folders
            </span>
          )}
        </div>
      )}
      {collapsed && (
        <div style={{ height: 45, borderBottom: `1px solid ${C.darkBorder}`, flexShrink: 0 }} />
      )}

      {/* ── Main list area ── */}
      <div style={{ flex: 1, overflowY: "auto", paddingTop: 6, paddingBottom: 48 }}>
        {/* ── Folder list (when no folder selected) ── */}
        {!activeFolder && pageTree.map((folder) => {
          const isHovered = hoveredItem === `folder_${folder.id}`;
          return (
            <button
              key={folder.id}
              onClick={() => setActiveFolder(folder.id)}
              onMouseEnter={() => setHoveredItem(`folder_${folder.id}`)}
              onMouseLeave={() => setHoveredItem(null)}
              title={collapsed ? folder.name : undefined}
              style={itemStyle(false, isHovered)}
            >
              <IconFolder
                size={collapsed ? 14 : 12}
                color={isHovered ? C.darkText : C.darkMuted}
              />
              {!collapsed && (
                <span style={{
                  fontSize: 13, fontWeight: 400, color: C.darkText,
                  letterSpacing: "0.01em", whiteSpace: "nowrap",
                  overflow: "hidden", textOverflow: "ellipsis",
                  flex: 1,
                }}>
                  {folder.name}
                </span>
              )}
              {!collapsed && (
                <span style={{
                  fontSize: 10, color: C.darkBorder, flexShrink: 0,
                }}>
                  {folder.children?.length || 0}
                </span>
              )}
            </button>
          );
        })}

        {/* ── "New Folder" button (when no folder selected) ── */}
        {!activeFolder && !collapsed && (
          <div style={{ padding: "4px 8px" }}>
            <button
              onClick={handleCreateFolder}
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
              <span>New Folder</span>
            </button>
          </div>
        )}
        {!activeFolder && collapsed && (
          <button
            onClick={handleCreateFolder}
            title="New Folder"
            style={{
              width: "100%", border: "none", background: "transparent",
              cursor: "pointer", display: "flex", alignItems: "center",
              justifyContent: "center", padding: "10px 0", outline: "none",
            }}
          >
            <IconPlus size={12} color={C.darkMuted} />
          </button>
        )}

        {/* ── Page list (when folder is selected) ── */}
        {activeFolder && folderPages.map((page) => {
          const isActive = activePage === page.id;
          const isHovered = hoveredItem === `page_${page.id}`;
          return (
            <div
              key={page.id}
              style={{ display: "flex", alignItems: "center", position: "relative" }}
            >
              <button
                onClick={() => navigateToPage(page)}
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

      {/* ── Confirm dialogs ── */}
      {confirmDelete?.type === "page" && (
        <ConfirmDialog
          title="Delete Page"
          message={`Are you sure you want to delete "${confirmDelete.pageConfig.name}"? This action cannot be undone.`}
          onConfirm={() => handleDelete(confirmDelete.pageConfig)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {confirmDelete?.type === "folder" && (
        <ConfirmDialog
          title="Delete Folder"
          message={`Are you sure you want to delete "${confirmDelete.pageConfig.name}" and all pages inside it? This action cannot be undone.`}
          onConfirm={() => handleDelete(confirmDelete.pageConfig)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
