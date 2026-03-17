// --- Sidebar Navigation ---
// Icon-bar sidebar with search, create menu, and nav items.
// Expandable (hamburger toggle). Bottom nav: Workspaces, Dashboard, To-Do, Notes, Gmail, etc.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { ANIM, TRANSITION } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { useNavigation } from "../context/NavigationContext.jsx";
import { savePageConfig, archivePageConfig, createFolderConfig, createWorkspaceConfig, createDashboardConfig } from "../config/pageConfig.js";
import { archivePage } from "../notion/client.js";
import {
  IconGear, IconSearch, IconBrain, IconBell,
  IconMail, IconCalendar, IconGlobe,
} from "../design/icons.jsx";
import { getGoogleStatus, getGmailSummary, getCalendarSummary } from "../lib/api.js";
import WasabiFlame from "./WasabiFlame.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import CreateMenu from "./CreateMenu.jsx";
import ContextMenu from "./ContextMenu.jsx";
import { getCreateMenuItems } from "./CreateMenu.jsx";
import useInsight from "../zen/useInsight.js";

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
  const { setTargetFolderPath } = useNavigation();

  const zenInsight = useInsight();

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
    let retryCount = 0;
    async function checkGoogle() {
      try {
        const status = await getGoogleStatus();
        if (cancelled) return;
        setGoogleConnected(!!status?.connected);
        retryCount = 0; // reset on success
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
      } catch (_) {
        // Retry up to 3 times with increasing delay on initial load failure
        if (!cancelled && retryCount < 3) {
          retryCount++;
          setTimeout(checkGoogle, retryCount * 3000);
        }
      }
    }
    checkGoogle();
    // Re-poll every 2 min (more responsive than 5min for connection state changes)
    googlePollRef.current = setInterval(checkGoogle, 2 * 60 * 1000);
    return () => { cancelled = true; clearInterval(googlePollRef.current); };
  }, []);

  // Active view index (from App.jsx viewStates)
  const activeViewIndex = viewStates?.[activePage] ?? 0;

  const SIDEBAR_W = collapsed ? 54 : 220;

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
    padding: collapsed ? "8px 6px" : "8px 12px",
    minHeight: 36,
    borderRadius: RADIUS.lg,
    transition: "background 0.15s, transform 0.12s",
    outline: "none",
    width: "100%",
    justifyContent: collapsed ? "center" : "flex-start",
  });

  const iconSize = (isActive) => collapsed ? (isActive ? 22 : 18) : (isActive ? 18 : 16);

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
        background: `linear-gradient(to bottom, ${C.edgeLine} 10%, ${C.accent}44 30%, ${C.accent}44 70%, ${C.edgeLine} 90%), ${C.dark}`,
        borderRight: "none",
        display: "flex",
        flexDirection: "column",
        transition: TRANSITION.sidebar,
        position: "relative",
      }}
    >
      {/* Top: expand/collapse toggle + search */}
          <div style={{
            flexShrink: 0,
            padding: collapsed ? "8px 4px" : "8px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            borderBottom: `1px solid ${C.darkBorder}`,
          }}>
            {/* Expand / Collapse toggle — sidebar menu icon */}
            <button
              onClick={onToggleCollapse}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              style={{
                background: "none", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: "6px",
                borderRadius: RADIUS.sm, transition: "background 0.15s",
                outline: "none", width: collapsed ? "100%" : "auto", alignSelf: collapsed ? "center" : "flex-start",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {collapsed ? (
                /* Hamburger menu icon */
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <line x1="2" y1="4" x2="14" y2="4" stroke={C.darkMuted} strokeWidth="1.4" strokeLinecap="round" />
                  <line x1="2" y1="8" x2="14" y2="8" stroke={C.darkMuted} strokeWidth="1.4" strokeLinecap="round" />
                  <line x1="2" y1="12" x2="14" y2="12" stroke={C.darkMuted} strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              ) : (
                /* Sidebar collapse icon (panel with arrow) */
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="1.5" y="2" width="13" height="12" rx="1.5" stroke={C.darkMuted} strokeWidth="1.3" fill="none" />
                  <line x1="6" y1="2" x2="6" y2="14" stroke={C.darkMuted} strokeWidth="1.3" />
                  <path d="M11 6.5L9 8L11 9.5" stroke={C.darkMuted} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>

            {/* Search bar (expanded only) */}
            {!collapsed && (
              <div style={{ position: "relative" }}>
                <div style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                  <IconSearch size={13} color={C.darkMuted} />
                </div>
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: "100%", padding: "7px 10px 7px 28px",
                    background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
                    borderRadius: RADIUS.lg, fontSize: 12, fontFamily: FONT,
                    color: C.darkText, outline: "none", transition: "border-color 0.15s",
                    boxSizing: "border-box",
                  }}
                  onFocus={(e) => { e.target.style.borderColor = C.accent; }}
                  onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    style={{
                      position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", cursor: "pointer",
                      fontSize: 12, color: C.darkMuted, padding: "2px 4px",
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Zen Insight + spacer */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: collapsed ? 0 : "20px 16px", overflow: "hidden" }}>
            {!collapsed && zenInsight && !searchQuery && (
              <div style={{
                fontSize: 13, lineHeight: 1.6, fontFamily: FONT,
                color: C.darkMuted, fontStyle: "italic",
                opacity: 0.85, transition: "opacity 0.4s ease",
                textAlign: "center", padding: "0 2px",
              }}>
                {zenInsight}
              </div>
            )}
            {/* Search results (expanded, when query active) */}
            {!collapsed && searchQuery && (
              <div style={{ padding: "0 4px", overflowY: "auto", flex: 1 }}>
                {pages
                  .filter((p) => !p._systemInternal && p.name?.toLowerCase().includes(searchQuery.toLowerCase()))
                  .slice(0, 15)
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setActivePage(p.id); setSearchQuery(""); }}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 8px", borderRadius: RADIUS.sm,
                        width: "100%", textAlign: "left", transition: "background 0.12s",
                        outline: "none",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{ fontSize: 12, color: C.darkText, fontFamily: FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.name}
                      </span>
                    </button>
                  ))
                }
                {pages.filter((p) => !p._systemInternal && p.name?.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                  <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, textAlign: "center", padding: "12px 0" }}>
                    No results
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Zen nav items */}
          <div
            style={{
              flexShrink: 0,
              borderTop: `1px solid ${C.darkBorder}`,
              borderImage: `linear-gradient(90deg, ${C.darkBorder}, ${C.accent}44, ${C.accent}44, ${C.darkBorder}) 1`,
              padding: collapsed ? "6px 4px" : "8px 12px",
              paddingBottom: collapsed ? "calc(6px + env(safe-area-inset-bottom, 0px))" : "calc(8px + env(safe-area-inset-bottom, 0px))",
              display: "flex",
              flexDirection: "column",
              gap: 1,
              transition: "padding 0.25s",
            }}
          >
            {/* Create New — "+" icon above Workspaces, triggers CreateMenu dropdown */}
            <CreateMenu onCreateItem={handleCreateItem} collapsed={collapsed} />

            {/* Workspaces — also highlighted when viewing a real page opened from workspaces */}
            {(() => {
              const SYSTEM_PAGES = new Set(["system", "wasabi", "inbox", "automations", "functions", "build", "knowledge-base", "dashboard", "workspaces", "tasks", "notes", "gmail", "notifications", "knowledge"]);
              const isWsActive = activePage === "workspaces" ||
                (activePage && !SYSTEM_PAGES.has(activePage) && pages.some(p => p.id === activePage));
              return (
                <button
                  onClick={() => {
                    // If viewing a page, return to the folder containing it
                    if (activePage && activePage !== "workspaces" && !SYSTEM_PAGES.has(activePage)) {
                      const pageConfig = pages.find((p) => p.id === activePage);
                      if (pageConfig?.parentId) {
                        const byId = {};
                        for (const p of pages) byId[p.id] = p;
                        const folderPath = [];
                        let cur = byId[pageConfig.parentId];
                        const seen = new Set();
                        while (cur) {
                          if (seen.has(cur.id)) break;
                          seen.add(cur.id);
                          folderPath.unshift({ id: cur.id, name: cur.name || "Untitled" });
                          cur = cur.parentId ? byId[cur.parentId] : null;
                        }
                        setTargetFolderPath(folderPath);
                      }
                    }
                    setActivePage("workspaces");
                  }}
                  title="Workspaces"
                  style={bottomBtnStyle(isWsActive)}
                  onMouseEnter={(e) => { if (!isWsActive) e.currentTarget.style.background = C.darkSurf2; }}
                  onMouseLeave={(e) => { if (!isWsActive) e.currentTarget.style.background = "transparent"; }}
                >
                  <IconGlobe size={iconSize(isWsActive)} color={isWsActive ? "#fff" : C.darkMuted} />
                  {!collapsed && <span style={bottomLabelStyle(isWsActive)}>Workspaces</span>}
                </button>
              );
            })()}

            {/* Dashboard */}
            <button
              onClick={() => { setActivePage("dashboard"); setActiveFolder(null); }}
              title="Dashboard"
              style={bottomBtnStyle(activePage === "dashboard")}
              onMouseEnter={(e) => { if (activePage !== "dashboard") e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (activePage !== "dashboard") e.currentTarget.style.background = "transparent"; }}
            >
              <svg width={iconSize(activePage === "dashboard")} height={iconSize(activePage === "dashboard")} viewBox="0 0 16 16" fill="none">
                <rect x="1" y="1" width="6" height="6" rx="1.5" stroke={activePage === "dashboard" ? "#fff" : C.darkMuted} strokeWidth="1.3" fill="none" />
                <rect x="9" y="1" width="6" height="6" rx="1.5" stroke={activePage === "dashboard" ? "#fff" : C.darkMuted} strokeWidth="1.3" fill="none" />
                <rect x="1" y="9" width="6" height="6" rx="1.5" stroke={activePage === "dashboard" ? "#fff" : C.darkMuted} strokeWidth="1.3" fill="none" />
                <rect x="9" y="9" width="6" height="6" rx="1.5" stroke={activePage === "dashboard" ? "#fff" : C.darkMuted} strokeWidth="1.3" fill="none" />
              </svg>
              {!collapsed && <span style={bottomLabelStyle(activePage === "dashboard")}>Dashboard</span>}
            </button>

            {/* To-Do / Calendar (default landing) */}
            <button
              onClick={() => { setActivePage("tasks"); setActiveFolder(null); }}
              title="To-Do & Calendar"
              style={bottomBtnStyle(activePage === "tasks" || activePage === null)}
              onMouseEnter={(e) => { if (activePage !== "tasks" && activePage !== null) e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (activePage !== "tasks" && activePage !== null) e.currentTarget.style.background = "transparent"; }}
            >
              <IconCalendar size={iconSize(activePage === "tasks" || activePage === null)} color={(activePage === "tasks" || activePage === null) ? "#fff" : C.darkMuted} />
              {!collapsed && <span style={bottomLabelStyle(activePage === "tasks" || activePage === null)}>To-Do & Calendar</span>}
            </button>

            {/* Notes */}
            <button
              onClick={() => setActivePage("notes")}
              title="Notes"
              style={bottomBtnStyle(activePage === "notes")}
              onMouseEnter={(e) => { if (activePage !== "notes") e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (activePage !== "notes") e.currentTarget.style.background = "transparent"; }}
            >
              <svg width={iconSize(activePage === "notes")} height={iconSize(activePage === "notes")} viewBox="0 0 16 16" fill="none">
                <rect x="3" y="2" width="10" height="12" rx="1.5" stroke={activePage === "notes" ? "#fff" : C.darkMuted} strokeWidth="1.3" fill="none" />
                <line x1="5.5" y1="5.5" x2="10.5" y2="5.5" stroke={activePage === "notes" ? "#fff" : C.darkMuted} strokeWidth="1" />
                <line x1="5.5" y1="8" x2="10.5" y2="8" stroke={activePage === "notes" ? "#fff" : C.darkMuted} strokeWidth="1" />
                <line x1="5.5" y1="10.5" x2="8.5" y2="10.5" stroke={activePage === "notes" ? "#fff" : C.darkMuted} strokeWidth="1" />
              </svg>
              {!collapsed && <span style={bottomLabelStyle(activePage === "notes")}>Notes</span>}
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
                  <IconMail size={iconSize(activePage === "gmail")} color={activePage === "gmail" ? "#fff" : C.darkMuted} />
                  {unreadCount > 0 && (
                    <span style={{
                      position: "absolute", top: -5, right: -8,
                      background: C.accent, color: "#fff",
                      fontSize: 10, fontWeight: 700, fontFamily: FONT,
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

            {/* Notifications */}
            <button
              onClick={() => setActivePage("notifications")}
              title="Notifications"
              style={bottomBtnStyle(activePage === "notifications")}
              onMouseEnter={(e) => { if (activePage !== "notifications") e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (activePage !== "notifications") e.currentTarget.style.background = "transparent"; }}
            >
              <IconBell size={iconSize(activePage === "notifications")} color={activePage === "notifications" ? "#fff" : C.darkMuted} />
              {!collapsed && <span style={bottomLabelStyle(activePage === "notifications")}>Notifications</span>}
            </button>

            {/* Knowledge Base */}
            <button
              onClick={() => { setActivePage("knowledge"); setActiveFolder(null); }}
              title="Knowledge Base"
              style={bottomBtnStyle(activePage === "knowledge")}
              onMouseEnter={(e) => { if (activePage !== "knowledge") e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (activePage !== "knowledge") e.currentTarget.style.background = "transparent"; }}
            >
              <IconBrain size={iconSize(activePage === "knowledge")} color={activePage === "knowledge" ? "#fff" : C.darkMuted} />
              {!collapsed && <span style={bottomLabelStyle(activePage === "knowledge")}>Knowledge Base</span>}
            </button>

            {/* Settings */}
            <button
              onClick={() => setActivePage("system")}
              title="Settings"
              style={bottomBtnStyle(activePage === "system")}
              onMouseEnter={(e) => { if (activePage !== "system") e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (activePage !== "system") e.currentTarget.style.background = "transparent"; }}
            >
              <IconGear size={iconSize(activePage === "system")} color={activePage === "system" ? "#fff" : C.darkMuted} />
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
                  padding: collapsed ? "8px 6px" : "8px 12px",
                  borderRadius: RADIUS.lg, transition: "background 0.15s",
                  outline: "none", width: "100%",
                  justifyContent: collapsed ? "center" : "flex-start",
                  marginTop: 1,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                title="Open Wasabi"
              >
                <WasabiFlame size={collapsed ? 28 : 34} isThinking={isThinking} />
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
