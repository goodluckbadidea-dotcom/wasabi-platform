// ─── Bottom Navigation Bar ───
// Horizontal dock at the bottom of the viewport. Replaces the old
// vertical sidebar (Navigation.jsx) and the TopHeader chrome cluster.
//
// Layout:
//   [Search] [Create+]  [Tasks] [Notes] [Wasabi flame]   |   [Workspaces] [Dashboard] [Calendar] [Inbox?] [Figma?] [Notifications] [KB]   [Refresh] [Neurons] [Theme] [Settings?] [User pill]
//
// Left-pane nav items sit left of the center divider; right-pane
// items + chrome sit right of it. Chrome (refresh/neurons/theme/
// settings/user) lives on the far right because it doesn't target
// either panel.
//
// Polling logic for Google/Figma/Notifications is local —
// the old Navigation.jsx is kept on disk but no longer renders, so
// nothing else is running these pollers.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { C, FONT, RADIUS, SHADOW, Z } from "../design/tokens.js";
import { useViewport } from "../context/ViewportContext.jsx";
import { TRANSITION } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { useNavigation } from "../context/NavigationContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { useNeurons } from "../neurons/NeuronsContext.jsx";
import { usePages } from "../context/PagesContext.jsx";
import { useUserSync } from "../context/UserSyncContext.jsx";
import { focusRing } from "../design/interactions.js";
import { savePageConfig, createFolderConfig, createWorkspaceConfig, createDashboardConfig } from "../config/pageConfig.js";
import {
  IconGear, IconBrain, IconBell, IconMail, IconCalendar, IconRefresh, IconUsers, IconArchive,
} from "../design/icons.jsx";
import { isAdmin } from "../lib/roles.js";
import {
  getGoogleStatus, getGmailSummary, getCalendarSummary,
  getFigmaStatus, getUnreadNotificationCount,
} from "../lib/api.js";
import WasabiFlame from "./WasabiFlame.jsx";
import CreateMenu from "./CreateMenu.jsx";

const BAR_HEIGHT = 68;
const ITEM_GAP = 10;
const DIVIDER_W = 1;

export default function BottomBar({ isThinking, onCreatePage, onSearchClick }) {
  const {
    pages, identity, logout,
    activeRightPane, setActiveRightPane,
    activeFolder, setActiveFolder,
    activeLeftPane, setActiveLeftPane,
    addPage, leftPaneCollapsed, setLeftPaneCollapsed,
  } = usePlatform();
  const { setTargetFolderPath } = useNavigation();
  const { themeName, toggleMode } = useTheme();
  const { overlayActive, toggleOverlay, selection } = useNeurons();
  const { saveStatus } = usePages();
  const { isTouch, isNarrow } = useViewport();
  const userSync = useUserSync();

  // ── Service status polling (mirrors Navigation.jsx) ──
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleGrants, setGoogleGrants] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const googlePollRef = useRef(null);
  const gmailGranted = googleGrants.includes("gmail");

  const [figmaConnected, setFigmaConnected] = useState(false);
  const figmaPollRef = useRef(null);

  const [notifUnreadCount, setNotifUnreadCount] = useState(0);
  const notifPollRef = useRef(null);

  // User dropdown
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e) => { if (e.key === "Escape") setDropdownOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [dropdownOpen]);

  // Google
  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;
    async function checkGoogle() {
      try {
        const status = await getGoogleStatus();
        if (cancelled) return;
        setGoogleConnected(!!status?.connected);
        const grants = Array.isArray(status?.grants) ? status.grants : [];
        setGoogleGrants(grants);
        retryCount = 0;
        if (status?.connected) {
          const wantsGmail = grants.includes("gmail");
          const [gmailRes] = await Promise.allSettled([
            wantsGmail ? getGmailSummary() : Promise.resolve(null),
          ]);
          if (cancelled) return;
          if (wantsGmail && gmailRes.status === "fulfilled") {
            setUnreadCount(gmailRes.value?.unread || 0);
          } else if (!wantsGmail) {
            setUnreadCount(0);
          }
        } else {
          setUnreadCount(0);
        }
      } catch (err) {
        if (!cancelled && retryCount < 3) {
          retryCount++;
          setTimeout(checkGoogle, retryCount * 3000);
        }
      }
    }
    checkGoogle();
    googlePollRef.current = setInterval(checkGoogle, 2 * 60 * 1000);
    return () => { cancelled = true; clearInterval(googlePollRef.current); };
  }, []);

  // Figma
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

  // Notifications
  useEffect(() => {
    let cancelled = false;
    async function pollNotifCount() {
      try {
        const res = await getUnreadNotificationCount();
        if (!cancelled) setNotifUnreadCount(res?.unread_count || 0);
      } catch { /* non-fatal */ }
    }
    pollNotifCount();
    notifPollRef.current = setInterval(pollNotifCount, 60_000);
    return () => { cancelled = true; clearInterval(notifPollRef.current); };
  }, []);

  // Instant push
  useEffect(() => {
    if (!userSync?.onNotificationNew) return;
    return userSync.onNotificationNew(() => {
      setNotifUnreadCount((c) => c + 1);
    });
  }, [userSync]);

  // ── Helpers ──
  const focusLeftPane = useCallback((pane) => {
    setActiveLeftPane(pane);
    if (leftPaneCollapsed) setLeftPaneCollapsed(false);
  }, [setActiveLeftPane, leftPaneCollapsed, setLeftPaneCollapsed]);

  const handleCreateItem = useCallback(async (type) => {
    if (type === "page") {
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
      if (activeFolder) config.parentId = activeFolder;
    } else if (type === "dashboard") {
      config = createDashboardConfig("New Dashboard");
      if (activeFolder) config.parentId = activeFolder;
    }
    if (!config) return;
    if (activeFolder && !config.parentId) config.parentId = activeFolder;

    try {
      const id = await savePageConfig(config);
      addPage({ ...config, id });
      if (type === "workspace" || type === "folder") {
        setActiveFolder(id);
      } else {
        setActiveRightPane(id);
      }
    } catch (err) {
      console.error("[BottomBar] Failed to create:", err);
    }
  }, [addPage, pages, activeFolder, setActiveFolder, setActiveRightPane, onCreatePage]);

  // ── Style helpers ──
  const inactiveColor = C.darkText + "BB";

  const itemBtnStyle = (isActive) => ({
    background: isActive ? C.darkSurf2 : "transparent",
    boxShadow: isActive ? `inset 0 1px 0 rgba(255,255,255,0.07), 0 1px 3px rgba(0,0,0,0.15)` : "none",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    width: isTouch ? 50 : 46,
    height: isTouch ? 50 : 46,
    borderRadius: RADIUS.lg,
    transition: "background 0.15s, box-shadow 0.15s",
    outline: "none",
    flexShrink: 0,
    position: "relative",
  });

  const iconColor = (isActive) => isActive ? C.accent : inactiveColor;
  const ICON = 22;

  // Workspace highlight rule: Workspaces icon is also lit when viewing a user-built page.
  const SYSTEM_PAGES = new Set(["system", "wasabi", "inbox", "inbox-unified", "automations", "functions", "build", "knowledge-base", "workspaces", "calendar", "notifications", "knowledge", "team-priorities", "archive"]);
  const isWsActive = activeRightPane === "workspaces" ||
    (activeRightPane && !SYSTEM_PAGES.has(activeRightPane) && pages.some((p) => p.id === activeRightPane));

  const handleWorkspacesClick = () => {
    if (activeRightPane && activeRightPane !== "workspaces" && !SYSTEM_PAGES.has(activeRightPane)) {
      const pageConfig = pages.find((p) => p.id === activeRightPane);
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
    setActiveRightPane("workspaces");
  };

  const handleHardRefresh = () => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("wasabi_zen_") || key.startsWith("wasabi_ai_") || key.startsWith("wasabi_insight") || key.startsWith("wasabi_cal_") || key.startsWith("wasabi_tasks_") || key.startsWith("wasabi-dashboard-") || key.startsWith("wasabi-hidden-")) {
          localStorage.removeItem(key);
        }
      }
    } catch {}
    window.location.reload();
  };

  // ── Render ──
  return (
    <nav
      role="navigation"
      aria-label="Primary navigation"
      style={{
        flexShrink: 0,
        height: BAR_HEIGHT,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        background: C.dark,
        borderTop: `1px solid ${C.edgeLine}`,
        borderImage: `linear-gradient(90deg, ${C.edgeLine}, ${C.accent}22, ${C.accent}33, ${C.accent}22, ${C.edgeLine}) 1`,
        display: "flex",
        alignItems: "center",
        gap: ITEM_GAP,
        padding: `0 ${isNarrow ? 8 : 14}px`,
        position: "relative",
        zIndex: Z.header,
        overflowX: isNarrow ? "auto" : "visible",
        overflowY: "visible",
      }}
    >
      {/* ─ Search ─ */}
      <button
        onClick={() => onSearchClick?.()}
        title="Search (⌘K)"
        aria-label="Open search"
        {...focusRing()}
        style={itemBtnStyle(false)}
        onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <svg width={ICON} height={ICON} viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="4.5" stroke={inactiveColor} strokeWidth="1.4" />
          <line x1="10.5" y1="10.5" x2="13.5" y2="13.5" stroke={inactiveColor} strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

      {/* ─ Left-pane group: Tasks / Notes / Wasabi ─ */}
      {/* Tasks */}
      <button
        onClick={() => focusLeftPane("tasks")}
        title="Tasks"
        aria-label="Tasks"
        {...focusRing()}
        style={itemBtnStyle(activeLeftPane === "tasks")}
        onMouseEnter={(e) => { if (activeLeftPane !== "tasks") e.currentTarget.style.background = C.darkSurf2; }}
        onMouseLeave={(e) => { if (activeLeftPane !== "tasks") e.currentTarget.style.background = "transparent"; }}
      >
        <svg width={ICON} height={ICON} viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke={iconColor(activeLeftPane === "tasks")} strokeWidth="1.3" fill="none" />
          <path d="M5 8L7 10L11 6" stroke={iconColor(activeLeftPane === "tasks")} strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>

      {/* Notes */}
      <button
        onClick={() => focusLeftPane("notes")}
        title="Notes"
        aria-label="Notes"
        {...focusRing()}
        style={itemBtnStyle(activeLeftPane === "notes")}
        onMouseEnter={(e) => { if (activeLeftPane !== "notes") e.currentTarget.style.background = C.darkSurf2; }}
        onMouseLeave={(e) => { if (activeLeftPane !== "notes") e.currentTarget.style.background = "transparent"; }}
      >
        <svg width={ICON} height={ICON} viewBox="0 0 16 16" fill="none">
          <rect x="3" y="2" width="10" height="12" rx="1.5" stroke={iconColor(activeLeftPane === "notes")} strokeWidth="1.3" fill="none" />
          <line x1="5.5" y1="5.5" x2="10.5" y2="5.5" stroke={iconColor(activeLeftPane === "notes")} strokeWidth="1" />
          <line x1="5.5" y1="8" x2="10.5" y2="8" stroke={iconColor(activeLeftPane === "notes")} strokeWidth="1" />
          <line x1="5.5" y1="10.5" x2="8.5" y2="10.5" stroke={iconColor(activeLeftPane === "notes")} strokeWidth="1" />
        </svg>
      </button>

      {/* Wasabi flame (hidden for viewers — chat is editor + admin only) */}
      {identity?.role !== "viewer" && (
        <button
          onClick={() => focusLeftPane("chat")}
          title="Wasabi Chat (⌘.)"
          aria-label="Open Wasabi chat"
          {...focusRing()}
          style={itemBtnStyle(activeLeftPane === "chat")}
          onMouseEnter={(e) => { if (activeLeftPane !== "chat") e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { if (activeLeftPane !== "chat") e.currentTarget.style.background = "transparent"; }}
        >
          <WasabiFlame size={36} isThinking={isThinking} />
        </button>
      )}

      {/* ─ Center divider ─ */}
      <div
        style={{
          width: DIVIDER_W,
          height: 28,
          background: `linear-gradient(180deg, transparent, ${C.darkBorder}, transparent)`,
          flexShrink: 0,
          margin: `0 ${isNarrow ? 6 : 10}px`,
        }}
      />

      {/* ─ Right-pane group ─ */}
      {/* Workspaces (grid icon — the old Dashboard button, retargeted after
          per-user dashboards were removed and folded into the page tree) */}
      <button
        onClick={handleWorkspacesClick}
        title="Workspaces"
        aria-label="Workspaces"
        {...focusRing()}
        style={itemBtnStyle(isWsActive)}
        onMouseEnter={(e) => { if (!isWsActive) e.currentTarget.style.background = C.darkSurf2; }}
        onMouseLeave={(e) => { if (!isWsActive) e.currentTarget.style.background = "transparent"; }}
      >
        <svg width={ICON} height={ICON} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="6" height="6" rx="1.5" stroke={iconColor(isWsActive)} strokeWidth="1.3" fill="none" />
          <rect x="9" y="1" width="6" height="6" rx="1.5" stroke={iconColor(isWsActive)} strokeWidth="1.3" fill="none" />
          <rect x="1" y="9" width="6" height="6" rx="1.5" stroke={iconColor(isWsActive)} strokeWidth="1.3" fill="none" />
          <rect x="9" y="9" width="6" height="6" rx="1.5" stroke={iconColor(isWsActive)} strokeWidth="1.3" fill="none" />
        </svg>
      </button>

      {/* Calendar */}
      <button
        onClick={() => { setActiveRightPane("calendar"); setActiveFolder(null); }}
        title="Calendar"
        aria-label="Calendar"
        {...focusRing()}
        style={itemBtnStyle(activeRightPane === "calendar")}
        onMouseEnter={(e) => { if (activeRightPane !== "calendar") e.currentTarget.style.background = C.darkSurf2; }}
        onMouseLeave={(e) => { if (activeRightPane !== "calendar") e.currentTarget.style.background = "transparent"; }}
      >
        <IconCalendar size={ICON} color={iconColor(activeRightPane === "calendar")} />
      </button>

      {/* Inbox (only when Gmail granted) */}
      {gmailGranted && (
        <button
          onClick={() => setActiveRightPane("inbox-unified")}
          title="Inbox"
          aria-label="Inbox"
          {...focusRing()}
          style={itemBtnStyle(activeRightPane === "inbox-unified")}
          onMouseEnter={(e) => { if (activeRightPane !== "inbox-unified") e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { if (activeRightPane !== "inbox-unified") e.currentTarget.style.background = "transparent"; }}
        >
          <IconMail size={ICON} color={iconColor(activeRightPane === "inbox-unified")} />
          {unreadCount > 0 && (
            <span style={badgeStyle()}>
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      )}

      {/* Figma (only when connected) */}
      {figmaConnected && (
        <button
          onClick={() => setActiveRightPane("figma")}
          title="Figma"
          aria-label="Figma"
          {...focusRing()}
          style={itemBtnStyle(activeRightPane === "figma")}
          onMouseEnter={(e) => { if (activeRightPane !== "figma") e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { if (activeRightPane !== "figma") e.currentTarget.style.background = "transparent"; }}
        >
          <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none">
            <path d="M8 24c2.2 0 4-1.8 4-4v-4H8c-2.2 0-4 1.8-4 4s1.8 4 4 4z" fill={activeRightPane === "figma" ? "#0ACF83" : (C.darkMuted + "99")} />
            <path d="M4 12c0-2.2 1.8-4 4-4h4v8H8c-2.2 0-4-1.8-4-4z" fill={activeRightPane === "figma" ? "#A259FF" : (C.darkMuted + "88")} />
            <path d="M4 4c0-2.2 1.8-4 4-4h4v8H8C5.8 8 4 6.2 4 4z" fill={activeRightPane === "figma" ? "#F24E1E" : (C.darkMuted + "77")} />
            <path d="M12 0h4c2.2 0 4 1.8 4 4s-1.8 4-4 4h-4V0z" fill={activeRightPane === "figma" ? "#FF7262" : (C.darkMuted + "88")} />
            <path d="M20 12c0 2.2-1.8 4-4 4s-4-1.8-4-4 1.8-4 4-4 4 1.8 4 4z" fill={activeRightPane === "figma" ? "#1ABCFE" : (C.darkMuted + "99")} />
          </svg>
        </button>
      )}

      {/* Notifications */}
      <button
        onClick={() => { setActiveRightPane("notifications"); setNotifUnreadCount(0); }}
        title="Notifications"
        aria-label="Notifications"
        {...focusRing()}
        style={itemBtnStyle(activeRightPane === "notifications")}
        onMouseEnter={(e) => { if (activeRightPane !== "notifications") e.currentTarget.style.background = C.darkSurf2; }}
        onMouseLeave={(e) => { if (activeRightPane !== "notifications") e.currentTarget.style.background = "transparent"; }}
      >
        <IconBell size={ICON} color={iconColor(activeRightPane === "notifications")} />
        {notifUnreadCount > 0 && (
          <span style={badgeStyle()}>
            {notifUnreadCount > 99 ? "99+" : notifUnreadCount}
          </span>
        )}
      </button>

      {/* Knowledge Base */}
      <button
        onClick={() => { setActiveRightPane("knowledge"); setActiveFolder(null); }}
        title="Knowledge Base"
        aria-label="Knowledge Base"
        {...focusRing()}
        style={itemBtnStyle(activeRightPane === "knowledge")}
        onMouseEnter={(e) => { if (activeRightPane !== "knowledge") e.currentTarget.style.background = C.darkSurf2; }}
        onMouseLeave={(e) => { if (activeRightPane !== "knowledge") e.currentTarget.style.background = "transparent"; }}
      >
        <IconBrain size={ICON} color={iconColor(activeRightPane === "knowledge")} />
      </button>

      {/* Team Priorities (admin only) */}
      {isAdmin(identity) && (
        <button
          onClick={() => { setActiveRightPane("team-priorities"); setActiveFolder(null); }}
          title="Team Priorities"
          aria-label="Team Priorities"
          {...focusRing()}
          style={itemBtnStyle(activeRightPane === "team-priorities")}
          onMouseEnter={(e) => { if (activeRightPane !== "team-priorities") e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { if (activeRightPane !== "team-priorities") e.currentTarget.style.background = "transparent"; }}
        >
          <IconUsers size={ICON} color={iconColor(activeRightPane === "team-priorities")} />
        </button>
      )}

      {/* Archive (admin only) — parallel to Trash: safe/reversible removal */}
      {isAdmin(identity) && (
        <button
          onClick={() => { setActiveRightPane("archive"); setActiveFolder(null); }}
          title="Archive"
          aria-label="Archive"
          {...focusRing()}
          style={itemBtnStyle(activeRightPane === "archive")}
          onMouseEnter={(e) => { if (activeRightPane !== "archive") e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { if (activeRightPane !== "archive") e.currentTarget.style.background = "transparent"; }}
        >
          <IconArchive size={ICON} color={iconColor(activeRightPane === "archive")} />
        </button>
      )}

      {/* ─ Spacer pushes the create button + chrome to the right ─ */}
      <div style={{ flex: 1, minWidth: 8 }} />

      {/* ─ Create (moved to right side) ─ */}
      <CreateMenu onCreateItem={handleCreateItem} collapsed={true} />

      {/* Save status indicator */}
      {saveStatus !== "idle" && (
        <div style={{
          fontSize: 10, fontFamily: FONT, fontWeight: 500,
          color: saveStatus === "error" ? C.error : saveStatus === "saving" ? C.darkMuted : C.accent,
          padding: "4px 10px", borderRadius: RADIUS.pill, flexShrink: 0,
          background: saveStatus === "error" ? C.errorDim : "transparent",
          letterSpacing: "0.03em",
        }}>
          {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save failed"}
        </div>
      )}

      {/* ─ Chrome cluster ─ */}
      {/* Hard refresh */}
      <button
        onClick={handleHardRefresh}
        title="Hard refresh — clear caches & reload"
        aria-label="Hard refresh"
        {...focusRing()}
        style={{ ...itemBtnStyle(false), opacity: 0.55 }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = C.darkSurf2; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.55"; e.currentTarget.style.background = "transparent"; }}
      >
        <IconRefresh size={ICON - 2} color={C.darkMuted} />
      </button>

      {/* Neurons toggle */}
      <button
        onClick={toggleOverlay}
        title={overlayActive ? "Exit Neurons mode (Esc)" : "Enter Neurons mode (⌘J)"}
        aria-label="Toggle neurons overlay"
        {...focusRing()}
        style={{
          ...itemBtnStyle(overlayActive),
          background: overlayActive ? C.accent + "22" : "transparent",
          border: `1px solid ${overlayActive ? C.accent : "transparent"}`,
        }}
        onMouseEnter={(e) => { if (!overlayActive) e.currentTarget.style.background = C.darkSurf2; }}
        onMouseLeave={(e) => { if (!overlayActive) e.currentTarget.style.background = "transparent"; }}
      >
        <svg width={ICON - 2} height={ICON - 2} viewBox="0 0 16 16" fill="none">
          <circle cx="4" cy="4" r="2" fill={overlayActive ? C.accent : C.darkMuted} />
          <circle cx="12" cy="4" r="2" fill={overlayActive ? C.accent : C.darkMuted} />
          <circle cx="8" cy="12" r="2" fill={overlayActive ? C.accent : C.darkMuted} />
          <line x1="4" y1="4" x2="12" y2="4" stroke={overlayActive ? C.accent : C.darkMuted} strokeWidth="1" />
          <line x1="4" y1="4" x2="8" y2="12" stroke={overlayActive ? C.accent : C.darkMuted} strokeWidth="1" />
          <line x1="12" y1="4" x2="8" y2="12" stroke={overlayActive ? C.accent : C.darkMuted} strokeWidth="1" />
        </svg>
        {overlayActive && selection.length > 0 && (
          <span style={{ ...badgeStyle(), background: C.accent }}>
            {selection.length}
          </span>
        )}
      </button>

      {/* Theme cycle */}
      <button
        onClick={toggleMode}
        title={`Theme: ${themeName} — click to cycle`}
        aria-label="Cycle theme"
        {...focusRing()}
        style={itemBtnStyle(false)}
        onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <span style={{
          width: 14, height: 14, borderRadius: "50%",
          background: C.accent,
          border: `1px solid ${C.darkBorder}`,
        }} />
      </button>

      {/* Settings gear (admin only) */}
      {identity?.role === "admin" && (
        <button
          onClick={() => setActiveRightPane("system")}
          title="Settings"
          aria-label="Open settings"
          {...focusRing()}
          style={{ ...itemBtnStyle(activeRightPane === "system"), opacity: activeRightPane === "system" ? 1 : 0.6 }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; if (activeRightPane !== "system") e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = activeRightPane === "system" ? "1" : "0.6"; if (activeRightPane !== "system") e.currentTarget.style.background = "transparent"; }}
        >
          <IconGear size={ICON - 2} color={C.darkMuted} />
        </button>
      )}

      {/* User pill */}
      {identity && (
        <div ref={dropdownRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            onClick={() => setDropdownOpen((p) => !p)}
            title={`${identity.display_name} (${identity.role})`}
            aria-label="User menu"
            {...focusRing()}
            style={{
              background: dropdownOpen ? C.accent + "22" : "transparent",
              border: `1px solid ${dropdownOpen ? C.accent : C.darkBorder}`,
              borderRadius: RADIUS.pill,
              padding: "6px 14px 6px 7px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 9,
              transition: "background 0.15s, border-color 0.15s",
              color: C.darkMuted,
              fontSize: 13,
              fontFamily: FONT,
              fontWeight: 500,
              minHeight: 42,
              outline: "none",
            }}
            onMouseEnter={(e) => {
              if (!dropdownOpen) {
                e.currentTarget.style.borderColor = C.darkMuted;
                e.currentTarget.style.background = C.darkSurf2;
              }
            }}
            onMouseLeave={(e) => {
              if (!dropdownOpen) {
                e.currentTarget.style.borderColor = C.darkBorder;
                e.currentTarget.style.background = "transparent";
              }
            }}
          >
            <span style={{
              width: 26, height: 26, borderRadius: "50%",
              background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 12, fontWeight: 700,
              flexShrink: 0,
            }}>
              {(identity.display_name || "U").charAt(0).toUpperCase()}
            </span>
            {!isNarrow && (
              <span style={{ color: C.darkText, fontWeight: 500 }}>
                {identity.display_name}
              </span>
            )}
          </button>

          {dropdownOpen && (
            <div style={{
              position: "absolute",
              bottom: "calc(100% + 8px)",
              right: 0,
              background: C.darkSurf,
              border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.lg,
              boxShadow: SHADOW.dropdown,
              minWidth: 170,
              zIndex: Z.dropdown,
              padding: "4px 0",
              fontFamily: FONT,
            }}>
              <button
                onClick={() => { setActiveRightPane("system"); setDropdownOpen(false); }}
                style={dropdownItemStyle()}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                Settings
              </button>
              {isAdmin(identity) && (
                <button
                  onClick={() => { setActiveRightPane("system"); setDropdownOpen(false); }}
                  style={dropdownItemStyle()}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  User Management
                </button>
              )}
              <div style={{ height: 1, background: C.edgeLine, margin: "4px 0" }} />
              <button
                onClick={() => { logout?.(); setDropdownOpen(false); }}
                style={{ ...dropdownItemStyle(), color: C.error }}
                onMouseEnter={(e) => { e.currentTarget.style.background = `${C.error}15`; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                Log Out
              </button>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

function badgeStyle() {
  return {
    position: "absolute",
    top: 4,
    right: 4,
    background: C.accent,
    color: "#fff",
    borderRadius: 7,
    fontSize: 9,
    fontWeight: 700,
    fontFamily: FONT,
    lineHeight: 1,
    width: 16,
    height: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
    pointerEvents: "none",
  };
}

function dropdownItemStyle() {
  return {
    display: "block",
    width: "100%",
    padding: "8px 14px",
    background: "transparent",
    border: "none",
    color: C.darkText,
    fontSize: 13,
    fontFamily: FONT,
    fontWeight: 400,
    textAlign: "left",
    cursor: "pointer",
    transition: "background 0.1s",
    outline: "none",
  };
}
