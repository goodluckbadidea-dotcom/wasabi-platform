// --- Sidebar Navigation ---
// Icon-bar sidebar with search, create menu, and nav items.
// Expandable (hamburger toggle). Bottom nav: Workspaces, Dashboard, To-Do, Notes, Gmail, etc.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { C, FONT, RADIUS, SHADOW, Z } from "../design/tokens.js";
import { useViewport } from "../context/ViewportContext.jsx";
import { ANIM, TRANSITION } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { useNavigation } from "../context/NavigationContext.jsx";
import { savePageConfig, archivePageConfig, createFolderConfig, createWorkspaceConfig, createDashboardConfig } from "../config/pageConfig.js";
import { archivePage } from "../notion/client.js";
import {
  IconGear, IconSearch, IconBrain, IconBell,
  IconMail, IconCalendar, IconGlobe,
} from "../design/icons.jsx";
import { getGoogleStatus, getGmailSummary, getCalendarSummary, getMicrosoftStatus, getOutlookSummary, getFigmaStatus, getUnreadNotificationCount, listRows } from "../lib/api.js";
import { useUserSync } from "../context/UserSyncContext.jsx";
import WasabiFlame from "./WasabiFlame.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import CreateMenu from "./CreateMenu.jsx";
import ContextMenu from "./ContextMenu.jsx";
import { getCreateMenuItems } from "./CreateMenu.jsx";
import useInsight from "../features/useInsight.js";

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
    identity,
  } = usePlatform();
  const { setTargetFolderPath } = useNavigation();
  const { isTouch } = useViewport();
  const userSync = useUserSync();

  const insight = useInsight(identity?.id);

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [insightPopover, setInsightPopover] = useState(false);
  const insightRef = useRef(null);
  const [dbResults, setDbResults] = useState([]); // { pageId, pageName, rowId, title }[]
  const [dbSearching, setDbSearching] = useState(false);
  const dbSearchTimer = useRef(null);

  // ── Google status + sidebar widgets ──
  const [googleConnected, setGoogleConnected] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextEventLabel, setNextEventLabel] = useState("");
  const googlePollRef = useRef(null);

  // ── Microsoft status + sidebar widgets ──
  const [microsoftConnected, setMicrosoftConnected] = useState(false);
  const [outlookUnreadCount, setOutlookUnreadCount] = useState(0);
  const msPollRef = useRef(null);

  // ── Figma status ──
  const [figmaConnected, setFigmaConnected] = useState(false);
  const figmaPollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function checkFigma() {
      try {
        const status = await getFigmaStatus();
        if (!cancelled) setFigmaConnected(!!status?.connected);
      } catch { /* non-fatal */ }
    }
    checkFigma();
    figmaPollRef.current = setInterval(checkFigma, 2 * 60 * 1000);
    return () => { cancelled = true; clearInterval(figmaPollRef.current); };
  }, []);

  // ── Notification unread count polling (30s) ──
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);
  const notifPollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function pollNotifCount() {
      try {
        const res = await getUnreadNotificationCount();
        if (!cancelled) setNotifUnreadCount(res?.unread_count || 0);
      } catch (err) { console.warn("[Navigation] getUnreadNotificationCount:", err.message || err); }
    }
    pollNotifCount();
    notifPollRef.current = setInterval(pollNotifCount, 60_000); // Polling as fallback; instant via WebSocket
    return () => { cancelled = true; clearInterval(notifPollRef.current); };
  }, []);

  // ── Instant notification badge via WebSocket ──
  useEffect(() => {
    if (!userSync?.onNotificationNew) return;
    return userSync.onNotificationNew(() => {
      setNotifUnreadCount((c) => c + 1);
    });
  }, [userSync]);

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
      } catch (err) {
        console.warn("[Navigation] Google status check:", err.message || err);
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

  useEffect(() => {
    let cancelled = false;
    async function checkMicrosoft() {
      try {
        const status = await getMicrosoftStatus();
        if (cancelled) return;
        setMicrosoftConnected(!!status?.connected);
        if (status?.connected) {
          const res = await getOutlookSummary().catch(() => null);
          if (!cancelled && res) setOutlookUnreadCount(res.unread || 0);
        }
      } catch { /* non-fatal */ }
    }
    checkMicrosoft();
    msPollRef.current = setInterval(checkMicrosoft, 2 * 60 * 1000);
    return () => { cancelled = true; clearInterval(msPollRef.current); };
  }, []);

  // Active view index (from App.jsx viewStates)
  const activeViewIndex = viewStates?.[activePage] ?? 0;

  const SIDEBAR_W = collapsed ? (isTouch ? 68 : 62) : 220;

  // ── Debounced database entry search ──
  useEffect(() => {
    if (dbSearchTimer.current) clearTimeout(dbSearchTimer.current);
    if (!searchQuery || searchQuery.length < 2) {
      setDbResults([]);
      setDbSearching(false);
      return;
    }
    setDbSearching(true);
    dbSearchTimer.current = setTimeout(async () => {
      try {
        const q = searchQuery.toLowerCase();
        const dbPages = pages.filter((p) => {
          const pt = p.page_type || p.pageType || p.type;
          return !p._systemInternal && (p.databaseIds?.length > 0 ||
            ["database", "linked_notion", "linked_monday", "linked_sheet"].includes(pt));
        });
        const results = [];
        const seen = new Set();
        for (const page of dbPages) {
          const tableIds = [...(page.databaseIds || [])];
          const pt = page.page_type || page.pageType || page.type;
          if (["database", "linked_sheet", "linked_monday", "linked_notion"].includes(pt) && page.id && !tableIds.includes(page.id)) {
            tableIds.push(page.id);
          }
          for (const tableId of tableIds) {
            try {
              const resp = await listRows(tableId, { limit: 500 });
              const rows = resp?.rows || resp || [];
              for (const row of rows) {
                const title = row.title || row.cells?.Name || row.cells?.Title || row.cells?.name || row.cells?.title ||
                  (row.cells ? Object.values(row.cells).find((v) => typeof v === "string" && v.length > 0) : null);
                if (title && typeof title === "string" && title.toLowerCase().includes(q)) {
                  const key = `${tableId}-${row.id}`;
                  if (!seen.has(key)) {
                    seen.add(key);
                    results.push({ pageId: page.id, pageName: page.name || "Untitled", rowId: row.id, title, tableId });
                  }
                }
              }
            } catch (err) { console.warn("[Navigation] DB search table access:", err.message || err); }
          }
          if (results.length >= 25) break;
        }
        setDbResults(results.slice(0, 25));
      } catch (err) {
        console.error("[Navigation] DB search error:", err);
      } finally {
        setDbSearching(false);
      }
    }, 350);
    return () => { if (dbSearchTimer.current) clearTimeout(dbSearchTimer.current); };
  }, [searchQuery, pages]);

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
    if (user?.notionKey) {
      const pt = pageConfig.pageType || pageConfig.page_type;
      if (pt !== "linked_notion") {
        for (const dbId of (pageConfig.databaseIds || [])) {
          archivePage(dbId).catch(err => console.warn("[Navigation] archivePage:", err.message || err));
        }
      }
      if (pt === "document" && pageConfig.notionPageId) {
        archivePage(pageConfig.notionPageId).catch(err => console.warn("[Navigation] archivePage:", err.message || err));
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
    background: isActive ? C.darkSurf2 : "none",
    boxShadow: isActive ? `inset 0 1px 0 rgba(255,255,255,0.07), 0 1px 3px rgba(0,0,0,0.15)` : "none",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: collapsed ? 0 : 10,
    padding: collapsed ? (isTouch ? "12px 10px" : "10px 8px") : "10px 14px",
    minHeight: isTouch ? 48 : 44,
    borderRadius: RADIUS.lg,
    transition: "background 0.15s, box-shadow 0.15s, transform 0.12s",
    outline: "none",
    width: "100%",
    justifyContent: collapsed ? "center" : "flex-start",
  });

  const iconSize = (isActive) => collapsed ? (isActive ? 24 : 20) : (isActive ? 20 : 18);

  const navInactiveColor = C.darkText + "BB"; // higher contrast than darkMuted
  const bottomLabelStyle = (isActive) => ({
    fontFamily: "'Outfit',sans-serif",
    fontSize: 13,
    fontWeight: isActive ? 600 : 500,
    color: isActive ? C.accent : navInactiveColor,
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
            padding: collapsed ? "10px 6px" : "10px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}>
            {/* Expand / Collapse toggle — sidebar menu icon */}
            <button
              onClick={onToggleCollapse}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              style={{
                background: "none", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: "10px",
                minHeight: 44,
                borderRadius: RADIUS.sm, transition: "background 0.15s",
                outline: "none", width: collapsed ? "100%" : "auto", alignSelf: collapsed ? "center" : "flex-start",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {collapsed ? (
                /* Search / magnifying glass icon */
                <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="4.5" stroke={navInactiveColor} strokeWidth="1.4" />
                  <line x1="10.5" y1="10.5" x2="13.5" y2="13.5" stroke={navInactiveColor} strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              ) : (
                /* Sidebar collapse icon (panel with arrow) */
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="1.5" y="2" width="13" height="12" rx="1.5" stroke={navInactiveColor} strokeWidth="1.3" fill="none" />
                  <line x1="6" y1="2" x2="6" y2="14" stroke={navInactiveColor} strokeWidth="1.3" />
                  <path d="M11 6.5L9 8L11 9.5" stroke={navInactiveColor} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>

            {/* Search bar (expanded only) */}
            {!collapsed && (
              <div style={{ position: "relative" }}>
                <div style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                  <IconSearch size={13} color={navInactiveColor} />
                </div>
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: "100%", padding: "7px 10px 7px 28px",
                    background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
                    borderRadius: RADIUS.pill, fontSize: 12, fontFamily: FONT,
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
                      fontSize: 12, color: navInactiveColor, padding: "2px 4px",
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Insight + spacer */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: collapsed ? 0 : "20px 16px", overflow: "hidden" }}>
            {!collapsed && insight && !searchQuery && (
              <>
                <div
                  ref={insightRef}
                  onClick={() => setInsightPopover((v) => !v)}
                  style={{
                    fontSize: 13, lineHeight: 1.6, fontFamily: FONT,
                    color: navInactiveColor, fontStyle: "italic",
                    opacity: 0.85, transition: "opacity 0.4s ease",
                    textAlign: "center", padding: "0 2px",
                    cursor: "pointer",
                    display: "-webkit-box", WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical", overflow: "hidden",
                  }}
                >
                  {insight}
                </div>
                {insightPopover && (() => {
                  const rect = insightRef.current?.getBoundingClientRect();
                  if (!rect) return null;
                  return (
                    <div
                      onClick={() => setInsightPopover(false)}
                      onKeyDown={(e) => e.key === "Escape" && setInsightPopover(false)}
                      style={{
                        position: "fixed", inset: 0, zIndex: Z.dropdown,
                      }}
                    >
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          position: "fixed",
                          left: rect.right + 8,
                          top: rect.top,
                          maxWidth: 320, minWidth: 200,
                          background: C.surfaceRaised,
                          border: `1px solid ${C.border}`,
                          borderRadius: RADIUS.lg,
                          padding: "14px 16px",
                          boxShadow: SHADOW.dropdown,
                          zIndex: Z.dropdown + 1,
                          fontSize: 13, lineHeight: 1.6, fontFamily: FONT,
                          color: C.text, fontStyle: "italic",
                        }}
                      >
                        {insight}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
            {/* Search results (expanded, when query active) */}
            {!collapsed && searchQuery && (
              <div style={{ padding: "0 4px", overflowY: "auto", flex: 1 }}>
                {/* Page results */}
                {pages
                  .filter((p) => !p._systemInternal && p.name?.toLowerCase().includes(searchQuery.toLowerCase()))
                  .slice(0, 10)
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

                {/* Database entry results */}
                {dbResults.length > 0 && (
                  <>
                    <div style={{
                      fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
                      color: navInactiveColor, padding: "10px 8px 4px", fontFamily: FONT,
                    }}>
                      Records
                    </div>
                    {dbResults.map((r) => (
                      <button
                        key={`${r.tableId}-${r.rowId}`}
                        onClick={() => { setActivePage(r.pageId); setSearchQuery(""); }}
                        style={{
                          background: "none", border: "none", cursor: "pointer",
                          display: "flex", flexDirection: "column", gap: 1,
                          padding: "5px 8px", borderRadius: RADIUS.sm,
                          width: "100%", textAlign: "left", transition: "background 0.12s",
                          outline: "none",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <span style={{ fontSize: 12, color: C.darkText, fontFamily: FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.title}
                        </span>
                        <span style={{ fontSize: 9, color: navInactiveColor, fontFamily: FONT }}>
                          {r.pageName}
                        </span>
                      </button>
                    ))}
                  </>
                )}

                {/* Loading / no results */}
                {dbSearching && dbResults.length === 0 && pages.filter((p) => !p._systemInternal && p.name?.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                  <div style={{ fontSize: 11, color: navInactiveColor, fontFamily: FONT, textAlign: "center", padding: "12px 0" }}>
                    Searching...
                  </div>
                )}
                {!dbSearching && dbResults.length === 0 && searchQuery.length >= 2 &&
                  pages.filter((p) => !p._systemInternal && p.name?.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                  <div style={{ fontSize: 11, color: navInactiveColor, fontFamily: FONT, textAlign: "center", padding: "12px 0" }}>
                    No results
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Feature nav items */}
          <div
            style={{
              flexShrink: 0,
              borderTop: `1px solid ${C.darkBorder}`,
              borderImage: `linear-gradient(90deg, ${C.darkBorder}, ${C.accent}44, ${C.accent}44, ${C.darkBorder}) 1`,
              padding: collapsed ? "8px 6px" : "10px 12px",
              paddingBottom: collapsed ? "calc(8px + env(safe-area-inset-bottom, 0px))" : "calc(10px + env(safe-area-inset-bottom, 0px))",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              transition: "padding 0.25s",
            }}
          >
            {/* Create New — "+" icon above Workspaces, triggers CreateMenu dropdown */}
            <CreateMenu onCreateItem={handleCreateItem} collapsed={collapsed} />

            {/* Workspaces — also highlighted when viewing a real page opened from workspaces */}
            {(() => {
              const SYSTEM_PAGES = new Set(["system", "wasabi", "inbox", "inbox-unified", "automations", "functions", "build", "knowledge-base", "dashboard", "workspaces", "tasks", "notes", "gmail", "outlook", "notifications", "knowledge"]);
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
                  <IconGlobe size={iconSize(isWsActive)} color={isWsActive ? C.accent : navInactiveColor} />
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
                <rect x="1" y="1" width="6" height="6" rx="1.5" stroke={activePage === "dashboard" ? C.accent : navInactiveColor} strokeWidth="1.3" fill="none" />
                <rect x="9" y="1" width="6" height="6" rx="1.5" stroke={activePage === "dashboard" ? C.accent : navInactiveColor} strokeWidth="1.3" fill="none" />
                <rect x="1" y="9" width="6" height="6" rx="1.5" stroke={activePage === "dashboard" ? C.accent : navInactiveColor} strokeWidth="1.3" fill="none" />
                <rect x="9" y="9" width="6" height="6" rx="1.5" stroke={activePage === "dashboard" ? C.accent : navInactiveColor} strokeWidth="1.3" fill="none" />
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
              <IconCalendar size={iconSize(activePage === "tasks" || activePage === null)} color={(activePage === "tasks" || activePage === null) ? C.accent : navInactiveColor} />
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
                <rect x="3" y="2" width="10" height="12" rx="1.5" stroke={activePage === "notes" ? C.accent : navInactiveColor} strokeWidth="1.3" fill="none" />
                <line x1="5.5" y1="5.5" x2="10.5" y2="5.5" stroke={activePage === "notes" ? C.accent : navInactiveColor} strokeWidth="1" />
                <line x1="5.5" y1="8" x2="10.5" y2="8" stroke={activePage === "notes" ? C.accent : navInactiveColor} strokeWidth="1" />
                <line x1="5.5" y1="10.5" x2="8.5" y2="10.5" stroke={activePage === "notes" ? C.accent : navInactiveColor} strokeWidth="1" />
              </svg>
              {!collapsed && <span style={bottomLabelStyle(activePage === "notes")}>Notes</span>}
            </button>

            {/* Unified Inbox (when EITHER Google or Microsoft connected) */}
            {(googleConnected || microsoftConnected) && (
              <button
                onClick={() => setActivePage("inbox-unified")}
                title="Inbox (Gmail + Outlook)"
                style={bottomBtnStyle(activePage === "inbox-unified")}
                onMouseEnter={(e) => { if (activePage !== "inbox-unified") e.currentTarget.style.background = C.darkSurf2; }}
                onMouseLeave={(e) => { if (activePage !== "inbox-unified") e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <IconMail size={iconSize(activePage === "inbox-unified")} color={activePage === "inbox-unified" ? C.accent : navInactiveColor} />
                  {(unreadCount + outlookUnreadCount) > 0 && (
                    <span style={{
                      position: "absolute", top: -5, right: -8,
                      background: C.accent, color: "#fff",
                      borderRadius: 7, fontSize: 9, fontWeight: 700,
                      fontFamily: FONT, lineHeight: 1,
                      width: 18, height: 18,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {(unreadCount + outlookUnreadCount) > 99 ? "99+" : (unreadCount + outlookUnreadCount)}
                    </span>
                  )}
                </div>
                {!collapsed && <span style={bottomLabelStyle(activePage === "inbox-unified")}>Inbox</span>}
              </button>
            )}

            {/* Single-provider Outlook and Gmail buttons removed 2026-05-04.
                The unified "Inbox" button above handles both providers. */}

            {/* Figma (only when connected) */}
            {figmaConnected && (
              <button
                onClick={() => setActivePage("figma")}
                title="Figma"
                style={bottomBtnStyle(activePage === "figma")}
                onMouseEnter={(e) => { if (activePage !== "figma") e.currentTarget.style.background = C.darkSurf2; }}
                onMouseLeave={(e) => { if (activePage !== "figma") e.currentTarget.style.background = "transparent"; }}
              >
                <svg width={iconSize(activePage === "figma")} height={iconSize(activePage === "figma")} viewBox="0 0 24 24" fill="none">
                  <path d="M8 24c2.2 0 4-1.8 4-4v-4H8c-2.2 0-4 1.8-4 4s1.8 4 4 4z" fill={activePage === "figma" ? "#0ACF83" : (C.darkMuted + "99")} />
                  <path d="M4 12c0-2.2 1.8-4 4-4h4v8H8c-2.2 0-4-1.8-4-4z" fill={activePage === "figma" ? "#A259FF" : (C.darkMuted + "88")} />
                  <path d="M4 4c0-2.2 1.8-4 4-4h4v8H8C5.8 8 4 6.2 4 4z" fill={activePage === "figma" ? "#F24E1E" : (C.darkMuted + "77")} />
                  <path d="M12 0h4c2.2 0 4 1.8 4 4s-1.8 4-4 4h-4V0z" fill={activePage === "figma" ? "#FF7262" : (C.darkMuted + "88")} />
                  <path d="M20 12c0 2.2-1.8 4-4 4s-4-1.8-4-4 1.8-4 4-4 4 1.8 4 4z" fill={activePage === "figma" ? "#1ABCFE" : (C.darkMuted + "99")} />
                </svg>
                {!collapsed && <span style={bottomLabelStyle(activePage === "figma")}>Figma</span>}
              </button>
            )}

            {/* Notifications */}
            <button
              onClick={() => { setActivePage("notifications"); setNotifUnreadCount(0); }}
              title="Notifications"
              style={{ ...bottomBtnStyle(activePage === "notifications"), position: "relative" }}
              onMouseEnter={(e) => { if (activePage !== "notifications") e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (activePage !== "notifications") e.currentTarget.style.background = "transparent"; }}
            >
              <IconBell size={iconSize(activePage === "notifications")} color={activePage === "notifications" ? C.accent : navInactiveColor} />
              {notifUnreadCount > 0 && (
                <span style={{
                  position: "absolute",
                  top: collapsed ? 4 : 6,
                  right: collapsed ? 10 : 8,
                  width: 18, height: 18,
                  borderRadius: 7,
                  background: C.accent,
                  color: "#fff",
                  fontSize: 9, fontWeight: 700, fontFamily: FONT,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  lineHeight: 1,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }}>
                  {notifUnreadCount > 99 ? "99+" : notifUnreadCount}
                </span>
              )}
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
              <IconBrain size={iconSize(activePage === "knowledge")} color={activePage === "knowledge" ? C.accent : navInactiveColor} />
              {!collapsed && <span style={bottomLabelStyle(activePage === "knowledge")}>Knowledge Base</span>}
            </button>

            {/* Settings (admin only when multi-user is active) */}
            {identity?.role === "admin" && (
              <button
                onClick={() => setActivePage("system")}
                title="Settings"
                style={bottomBtnStyle(activePage === "system")}
                onMouseEnter={(e) => { if (activePage !== "system") e.currentTarget.style.background = C.darkSurf2; }}
                onMouseLeave={(e) => { if (activePage !== "system") e.currentTarget.style.background = "transparent"; }}
              >
                <IconGear size={iconSize(activePage === "system")} color={activePage === "system" ? C.accent : navInactiveColor} />
                {!collapsed && <span style={bottomLabelStyle(activePage === "system")}>Settings</span>}
              </button>
            )}

            {/* Wasabi flame — hidden for viewers (chat is editor+admin only) */}
            {!wasabiPanelOpen && identity?.role !== "viewer" && (
              <button
                onClick={onToggleWasabiPanel}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center",
                  gap: collapsed ? 0 : 10,
                  padding: collapsed ? "10px 8px" : "10px 14px",
                  minHeight: 44,
                  borderRadius: RADIUS.lg, transition: "background 0.15s",
                  outline: "none", width: "100%",
                  justifyContent: collapsed ? "center" : "flex-start",
                  marginTop: 2,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                title="Open Wasabi"
              >
                <WasabiFlame size={collapsed ? 28 : 34} isThinking={isThinking} />
                {!collapsed && (
                  <span style={{
                    fontFamily: "'Outfit',sans-serif", fontSize: 12, fontWeight: 500,
                    color: navInactiveColor, letterSpacing: "0.02em",
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
