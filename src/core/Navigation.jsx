// --- Sidebar Navigation ---
// Expandable tree navigation with search bar at top.
// Hierarchy: Workspace > Folder > Dashboard/Page > View
// Bottom nav: Home, Knowledge Base, Automations, System, Wasabi

import React, { useState, useCallback, useEffect, useRef } from "react";
import { C, FONT, RADIUS, VIEW_PALETTE } from "../design/tokens.js";
import { ANIM, TRANSITION } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { savePageConfig, archivePageConfig, createFolderConfig, createWorkspaceConfig, createDashboardConfig } from "../config/pageConfig.js";
import { archivePage } from "../notion/client.js";
import {
  IconBolt, IconGear, IconStar, IconSearch, IconBrain, IconBell,
  IconChevronLeft, IconChevronRight, IconMail, IconCalendar, IconFunction,
  IconGrid,
} from "../design/icons.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { getGoogleStatus, getGmailSummary, getCalendarSummary } from "../lib/api.js";
import WasabiFlame from "./WasabiFlame.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import SidebarTree from "./SidebarTree.jsx";
import CreateMenu from "./CreateMenu.jsx";
import ContextMenu from "./ContextMenu.jsx";
import { getCreateMenuItems } from "./CreateMenu.jsx";

export default function Navigation({
  collapsed,
  onToggleCollapse,
  onExpandSidebar,
  wasabiPanelOpen,
  onToggleWasabiPanel,
  isThinking,
  onCreatePage,
  viewStates,
  onSetViewForPage,
}) {
  const {
    user, pages, activePage, setActivePage,
    updatePageConfig, removePage, addPage,
    activeFolder, setActiveFolder,
  } = usePlatform();

  const { appMode } = useTheme();

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // ── Google status + sidebar widgets ──
  const [googleConnected, setGoogleConnected] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextEventLabel, setNextEventLabel] = useState("");
  const googlePollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function checkGoogle() {
      try {
        const status = await getGoogleStatus();
        if (cancelled) return;
        setGoogleConnected(!!status?.connected);
        if (status?.connected) {
          // Fetch summaries in parallel
          const [gmailRes, calRes] = await Promise.allSettled([
            getGmailSummary(),
            getCalendarSummary(),
          ]);
          if (cancelled) return;
          if (gmailRes.status === "fulfilled") {
            setUnreadCount(gmailRes.value?.unread || 0);
          }
          if (calRes.status === "fulfilled") {
            const upcoming = calRes.value?.upcoming;
            if (upcoming?.length > 0) {
              const ev = upcoming[0];
              const time = ev.start?.dateTime
                ? new Date(ev.start.dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                : "";
              setNextEventLabel(time ? `${time} ${(ev.summary || "").slice(0, 16)}` : (ev.summary || "").slice(0, 20));
            } else {
              setNextEventLabel("");
            }
          }
        }
      } catch (_) { /* best effort */ }
    }
    checkGoogle();
    // Re-poll every 5 min
    googlePollRef.current = setInterval(checkGoogle, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(googlePollRef.current); };
  }, []);

  // Active view index (from App.jsx viewStates)
  const activeViewIndex = viewStates?.[activePage] ?? 0;

  const SIDEBAR_W = collapsed ? 48 : 220;

  // -- Create item handler --
  const handleCreateItem = useCallback(async (type) => {
    if (type === "page") {
      // Delegate to existing PageBuilder flow
      onCreatePage?.();
      return;
    }

    let config;
    if (type === "workspace") {
      config = createWorkspaceConfig("New Workspace");
    } else if (type === "folder") {
      const allFolders = pages.filter((p) => p.type === "folder");
      const colorIndex = allFolders.length % 10;
      config = createFolderConfig("New Folder", "folder");
      config.colorIndex = colorIndex;
      // If inside a workspace/folder, nest it
      if (activeFolder) config.parentId = activeFolder;
    } else if (type === "dashboard") {
      config = createDashboardConfig("New Dashboard");
      if (activeFolder) config.parentId = activeFolder;
    }

    if (!config) return;

    // Universal: auto-parent all page types when inside a folder
    if (activeFolder && !config.parentId) {
      config.parentId = activeFolder;
    }

    try {
      const id = await savePageConfig(config);
      addPage({ ...config, id });
      if (type === "workspace" || type === "folder") {
        setActiveFolder(id);
      } else {
        setActivePage(id);
      }
    } catch (err) {
      console.error("[Navigation] Failed to create:", err);
    }
  }, [addPage, pages, activeFolder, setActiveFolder, setActivePage, onCreatePage]);

  // -- Rename --
  const handleRename = useCallback((node, newName) => {
    updatePageConfig(node.id, { name: newName });
  }, [updatePageConfig]);

  // -- Delete --
  const handleDelete = useCallback(async (pageConfig) => {
    removePage(pageConfig.id);
    setConfirmDelete(null);
    archivePageConfig(pageConfig.id).catch((err) => {
      console.error("[Navigation] Failed to delete from D1:", err);
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

  // -- Navigate --
  const navigateToPage = useCallback((pageId) => {
    const page = pages.find((p) => p.id === pageId);
    if (!page) return;
    const pt = page.page_type || page.pageType;
    if (pt === "workspace") {
      // Workspaces: expand in sidebar AND show settings in main content
      setActiveFolder(pageId);
      setActivePage(pageId);
    } else if (page.type === "folder") {
      setActiveFolder(pageId);
    } else {
      setActivePage(pageId);
    }
  }, [pages, setActivePage, setActiveFolder]);

  // -- Context menu --
  const handleContextMenu = useCallback((e, node) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  // -- Style helpers --
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
      }}
    >
      {/* ── Zen mode: simplified sidebar ── */}
      {appMode === "zen" ? (
        <>
          {/* Zen header label */}
          {!collapsed && (
            <div style={{
              flexShrink: 0, borderBottom: `1px solid ${C.darkBorder}`,
              padding: "12px 14px", display: "flex", alignItems: "center", gap: 8,
            }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke={C.accent} strokeWidth="1.5" fill="none" />
                <circle cx="8" cy="8" r="2" fill={C.accent} />
              </svg>
              <span style={{
                fontFamily: FONT, fontSize: 12, fontWeight: 600,
                color: C.darkText, letterSpacing: "0.04em", textTransform: "uppercase",
              }}>
                Zen
              </span>
            </div>
          )}

          {/* Spacer to push buttons to bottom */}
          <div style={{ flex: 1 }} />

          {/* Zen bottom nav */}
          <div
            style={{
              flexShrink: 0,
              borderTop: `1px solid ${C.darkBorder}`,
              borderImage: `linear-gradient(90deg, ${C.darkBorder}, ${C.accent}44, ${C.accent}44, ${C.darkBorder}) 1`,
              padding: collapsed ? "8px 0" : "8px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              overflow: "hidden",
              transition: "padding 0.25s",
            }}
          >
            {/* To-Do / Calendar */}
            <button
              onClick={() => { setActivePage("zen-tasks"); setActiveFolder(null); }}
              title="To-Do & Calendar"
              style={bottomBtnStyle(activePage === "zen-tasks" || activePage === null)}
              onMouseEnter={(e) => { if (activePage !== "zen-tasks" && activePage !== null) e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (activePage !== "zen-tasks" && activePage !== null) e.currentTarget.style.background = "transparent"; }}
            >
              <IconCalendar size={collapsed ? 16 : 14} color={(activePage === "zen-tasks" || activePage === null) ? "#fff" : C.darkMuted} />
              {!collapsed && <span style={bottomLabelStyle(activePage === "zen-tasks" || activePage === null)}>To-Do & Calendar</span>}
            </button>

            {/* Notes */}
            <button
              onClick={() => setActivePage("zen-notes")}
              title="Notes"
              style={bottomBtnStyle(activePage === "zen-notes")}
              onMouseEnter={(e) => { if (activePage !== "zen-notes") e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (activePage !== "zen-notes") e.currentTarget.style.background = "transparent"; }}
            >
              <svg width={collapsed ? 16 : 14} height={collapsed ? 16 : 14} viewBox="0 0 16 16" fill="none">
                <rect x="3" y="2" width="10" height="12" rx="1.5" stroke={activePage === "zen-notes" ? "#fff" : C.darkMuted} strokeWidth="1.3" fill="none" />
                <line x1="5.5" y1="5.5" x2="10.5" y2="5.5" stroke={activePage === "zen-notes" ? "#fff" : C.darkMuted} strokeWidth="1" />
                <line x1="5.5" y1="8" x2="10.5" y2="8" stroke={activePage === "zen-notes" ? "#fff" : C.darkMuted} strokeWidth="1" />
                <line x1="5.5" y1="10.5" x2="8.5" y2="10.5" stroke={activePage === "zen-notes" ? "#fff" : C.darkMuted} strokeWidth="1" />
              </svg>
              {!collapsed && <span style={bottomLabelStyle(activePage === "zen-notes")}>Notes</span>}
            </button>

            {/* Settings */}
            <button
              onClick={() => setActivePage("system")}
              title="Settings"
              style={bottomBtnStyle(activePage === "system")}
              onMouseEnter={(e) => { if (activePage !== "system") e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (activePage !== "system") e.currentTarget.style.background = "transparent"; }}
            >
              <IconGear size={collapsed ? 16 : 14} color={activePage === "system" ? "#fff" : C.darkMuted} />
              {!collapsed && <span style={bottomLabelStyle(activePage === "system")}>Settings</span>}
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
        </>
      ) : (
        <>
          {/* ── Samurai mode: full sidebar ── */}

          {/* -- Search Bar (replaces FolderDropdown) -- */}
          {!collapsed ? (
            <div style={{
              flexShrink: 0, borderBottom: `1px solid ${C.darkBorder}`,
              padding: "8px 10px", display: "flex", alignItems: "center", gap: 8,
            }}>
              <IconSearch size={12} color={C.darkMuted} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search this workspace..."
                style={{
                  flex: 1, background: "transparent", border: "none",
                  outline: "none", fontFamily: FONT, fontSize: 12,
                  color: C.darkText, padding: 0,
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    padding: 0, display: "flex", outline: "none",
                  }}
                >
                  <span style={{ fontSize: 10, color: C.darkMuted, lineHeight: 1 }}>&times;</span>
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={onExpandSidebar}
              style={{
                flexShrink: 0, borderBottom: `1px solid ${C.darkBorder}`,
                padding: "12px 0", background: "transparent", border: "none",
                cursor: "pointer", display: "flex", justifyContent: "center",
                outline: "none",
              }}
            >
              <IconSearch size={14} color={C.darkMuted} />
            </button>
          )}

          {/* -- Sidebar Tree -- */}
          <SidebarTree
            activePage={activePage}
            activeViewIndex={activeViewIndex}
            onNavigate={navigateToPage}
            onSetActiveView={(pageId, viewIdx) => onSetViewForPage?.(pageId, viewIdx)}
            onRename={handleRename}
            onDelete={(node) => setConfirmDelete({ node })}
            onContextMenu={handleContextMenu}
            collapsed={collapsed}
            searchQuery={searchQuery}
          />

          {/* -- Create Menu (replaces "+ New Page") -- */}
          <CreateMenu onCreateItem={handleCreateItem} collapsed={collapsed} />

          {/* -- Bottom action buttons -- */}
          <div
            style={{
              flexShrink: 0,
              borderTop: `1px solid ${C.darkBorder}`,
              borderImage: `linear-gradient(90deg, ${C.darkBorder}, ${C.accent}44, ${C.accent}44, ${C.darkBorder}) 1`,
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

            {/* Inbox */}
            <button
              onClick={() => setActivePage("inbox")}
              title="Inbox"
              style={bottomBtnStyle(activePage === "inbox")}
              onMouseEnter={(e) => { if (activePage !== "inbox") e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (activePage !== "inbox") e.currentTarget.style.background = "transparent"; }}
            >
              <IconBell size={collapsed ? 16 : 14} color={activePage === "inbox" ? "#fff" : C.darkMuted} />
              {!collapsed && <span style={bottomLabelStyle(activePage === "inbox")}>Inbox</span>}
            </button>

            {/* Knowledge Base */}
            <button
              onClick={() => setActivePage("knowledge-base")}
              title="Knowledge Base"
              style={bottomBtnStyle(activePage === "knowledge-base")}
              onMouseEnter={(e) => { if (activePage !== "knowledge-base") e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (activePage !== "knowledge-base") e.currentTarget.style.background = "transparent"; }}
            >
              <IconBrain size={collapsed ? 16 : 14} color={activePage === "knowledge-base" ? "#fff" : C.darkMuted} />
              {!collapsed && <span style={bottomLabelStyle(activePage === "knowledge-base")}>Knowledge Base</span>}
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

            {/* Functions */}
            <button
              onClick={() => setActivePage("functions")}
              title="Functions"
              style={bottomBtnStyle(activePage === "functions")}
              onMouseEnter={(e) => { if (activePage !== "functions") e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (activePage !== "functions") e.currentTarget.style.background = "transparent"; }}
            >
              <IconFunction size={collapsed ? 16 : 14} color={activePage === "functions" ? "#fff" : C.darkMuted} />
              {!collapsed && <span style={bottomLabelStyle(activePage === "functions")}>Functions</span>}
            </button>

            {/* Build (Custom Views + Plugins) */}
            <button
              onClick={() => setActivePage("build")}
              title="Build"
              style={bottomBtnStyle(activePage === "build")}
              onMouseEnter={(e) => { if (activePage !== "build") e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (activePage !== "build") e.currentTarget.style.background = "transparent"; }}
            >
              <IconGrid size={collapsed ? 16 : 14} color={activePage === "build" ? "#fff" : C.darkMuted} />
              {!collapsed && <span style={bottomLabelStyle(activePage === "build")}>Build</span>}
            </button>

            {/* Gmail (only when Google connected) */}
            {googleConnected && (
              <button
                onClick={() => setActivePage("gmail")}
                title="Gmail"
                style={bottomBtnStyle(activePage === "gmail")}
                onMouseEnter={(e) => { if (activePage !== "gmail") e.currentTarget.style.background = C.darkSurf2; }}
                onMouseLeave={(e) => { if (activePage !== "gmail") e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <IconMail size={collapsed ? 16 : 14} color={activePage === "gmail" ? "#fff" : C.darkMuted} />
                  {unreadCount > 0 && (
                    <span style={{
                      position: "absolute", top: -5, right: -8,
                      background: C.accent, color: "#fff",
                      fontSize: 8, fontWeight: 700, fontFamily: FONT,
                      borderRadius: 999, minWidth: 14, height: 14,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      padding: "0 3px", lineHeight: 1,
                    }}>
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </div>
                {!collapsed && <span style={bottomLabelStyle(activePage === "gmail")}>Gmail</span>}
              </button>
            )}

            {/* Calendar (only when Google connected) */}
            {googleConnected && (
              <button
                onClick={() => setActivePage("calendar")}
                title="Calendar"
                style={bottomBtnStyle(activePage === "calendar")}
                onMouseEnter={(e) => { if (activePage !== "calendar") e.currentTarget.style.background = C.darkSurf2; }}
                onMouseLeave={(e) => { if (activePage !== "calendar") e.currentTarget.style.background = "transparent"; }}
              >
                <IconCalendar size={collapsed ? 16 : 14} color={activePage === "calendar" ? "#fff" : C.darkMuted} />
                {!collapsed && (
                  <span style={bottomLabelStyle(activePage === "calendar")}>
                    {nextEventLabel || "Calendar"}
                  </span>
                )}
              </button>
            )}

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
        </>
      )}

      {/* -- Collapse / Expand Chevron -- */}
      <button
        onClick={onToggleCollapse}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        style={{
          position: "absolute", top: "50%", right: -12,
          transform: "translateY(-50%)",
          width: 16, height: 24,
          background: C.darkSurf,
          border: `1px solid ${C.darkBorder}`,
          borderRadius: "0 4px 4px 0",
          cursor: "pointer",
          outline: "none",
          zIndex: 10,
          transition: "background 0.15s, border-color 0.15s",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = C.darkSurf2;
          e.currentTarget.style.borderColor = C.accent;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = C.darkSurf;
          e.currentTarget.style.borderColor = C.darkBorder;
        }}
      >
        {collapsed
          ? <IconChevronRight size={10} color={C.darkMuted} />
          : <IconChevronLeft size={10} color={C.darkMuted} />
        }
      </button>

      {/* -- Context Menu -- */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: "Rename",
              onClick: () => {
                // Rename is handled inline via double-click
                setContextMenu(null);
              },
            },
            { separator: true },
            ...getCreateMenuItems((type) => {
              setContextMenu(null);
              handleCreateItem(type);
            }),
            { separator: true },
            {
              label: "Delete",
              danger: true,
              onClick: () => {
                setConfirmDelete({ node: contextMenu.node });
                setContextMenu(null);
              },
            },
          ]}
        />
      )}

      {/* -- Confirm Dialogs -- */}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${confirmDelete.node?.nodeType === "workspace" ? "Workspace" : confirmDelete.node?.nodeType === "folder" ? "Folder" : "Page"}`}
          message={`Are you sure you want to delete "${confirmDelete.node?.name}"? This action cannot be undone.`}
          onConfirm={() => handleDelete(confirmDelete.node)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
