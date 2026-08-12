// ─── Navigation Context ───
// Active page, active folder, expanded tree nodes.
// Split from PlatformContext for focused re-renders.
// Uses usePages() internally for auto-expand.
// Persists navigation state to localStorage + D1 (per-user) so the app feels like a persistent desk.

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { usePages } from "./PagesContext.jsx";
import { useAuth } from "./AuthContext.jsx";
import { getUserState, putUserState } from "../lib/api.js";

const NavigationContext = createContext(null);

// ── localStorage helpers ──
function loadJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function NavigationProvider({ children }) {
  const { pages } = usePages();
  const { identity } = useAuth();

  // ── Phase 2 migration: convert pre-split-pane activeRightPane values to the
  // new dual-pane state. Runs once per browser, gated by a flag so
  // returning users land cleanly. Mirrors the App.jsx zen→functional
  // names migration pattern.
  (() => {
    try {
      if (localStorage.getItem("wasabi_phase2_migrated_v1")) return;
      const prev = loadJSON("wasabi_active_page", null);
      // "tasks" / "notes" / null all defaulted to TasksView before; lift them
      // to the left pane and set the right pane to Dashboard so the user
      // doesn't land on a blank screen.
      if (prev === "tasks" || prev === "notes" || prev === null) {
        const leftPane = prev === "notes" ? "notes" : "tasks";
        saveJSON("wasabi_active_left_pane", leftPane);
        saveJSON("wasabi_active_page", "dashboard");
      } else {
        // Any other route stays as the right pane; left pane defaults to tasks.
        saveJSON("wasabi_active_left_pane", "tasks");
      }
      localStorage.setItem("wasabi_phase2_migrated_v1", "1");
    } catch {}
  })();

  const [activeRightPane, setActiveRightPaneRaw] = useState(() => loadJSON("wasabi_active_page", null));
  const [activeFolder, setActiveFolder] = useState(() => loadJSON("wasabi_active_folder", null));
  const [expandedNodes, setExpandedNodes] = useState(new Set());

  // ── Dual-pane state (Phase 2) ──
  // Left pane is always one of "tasks" | "chat" | "notes". Right pane is
  // anything else routed via activeRightPane. The two are independent — clicking
  // a left-pane nav item only updates activeLeftPane; clicking a right-pane
  // nav item only updates activeRightPane.
  const [activeLeftPaneRaw, setActiveLeftPaneRaw] = useState(() => loadJSON("wasabi_active_left_pane", "tasks"));
  const [splitRatio, setSplitRatio] = useState(() => loadJSON("wasabi_split_ratio", 0.4));

  // ── Panel mode (2026-05-08) ──
  // "split"      — both panes visible (default)
  // "left-max"   — left pane fills the viewport, right hidden
  // "right-max"  — right pane fills the viewport, left hidden
  // Clicking a nav item for the OTHER pane snaps back to "split"; clicking
  // a nav item for the currently-maximized pane preserves the mode.
  // Migrates from the old `wasabi_left_pane_collapsed` boolean — `true`
  // there meant "right pane fills" (= "right-max" here).
  const [panelMode, setPanelModeRaw] = useState(() => {
    const stored = loadJSON("wasabi_panel_mode", null);
    if (stored === "split" || stored === "left-max" || stored === "right-max") return stored;
    // Legacy migration
    const legacyCollapsed = loadJSON("wasabi_left_pane_collapsed", false);
    return legacyCollapsed ? "right-max" : "split";
  });
  const setPanelMode = useCallback((mode) => {
    if (mode !== "split" && mode !== "left-max" && mode !== "right-max") return;
    setPanelModeRaw(mode);
  }, []);

  // ── Guarded setter: rejects system-internal pages at the gate ──
  // Also handles cross-side maximize reset: clicking a right-pane item
  // while the LEFT pane is maximized snaps the layout back to "split".
  const SYSTEM_PAGE_TYPES = new Set(["color-defaults", "color-view-config"]);
  const setActiveRightPane = useCallback((pageId) => {
    // Allow null, special string IDs ("tasks", "workspaces", "gmail", etc.)
    if (pageId === null || (typeof pageId === "string" && !/^[0-9a-f]{8}-/.test(pageId))) {
      setActiveRightPaneRaw(pageId);
      if (panelMode === "left-max") setPanelModeRaw("split");
      return;
    }
    // Block system-internal pages (User Tasks, color configs, etc.)
    const target = pages.find((p) => p.id === pageId);
    if (target && (target._systemInternal || SYSTEM_PAGE_TYPES.has(target.page_type) || (target.name && (target.name.startsWith("User Tasks") || target.name.startsWith("Zen Tasks"))))) {
      console.warn("[NavigationContext] Blocked navigation to system page:", target.name || pageId);
      return;
    }
    setActiveRightPaneRaw(pageId);
    if (panelMode === "left-max") setPanelModeRaw("split");
  }, [pages, panelMode]);

  // Wrap activeLeftPane setter so cross-side clicks snap "right-max" → "split".
  const setActiveLeftPane = useCallback((pane) => {
    setActiveLeftPaneRaw(pane);
    if (panelMode === "right-max") setPanelModeRaw("split");
  }, [panelMode]);
  const activeLeftPane = activeLeftPaneRaw;

  // Navigation signal for breadcrumb → WorkspaceBrowser path sync
  const [targetFolderPath, setTargetFolderPath] = useState(null);

  // Pending record to open after page navigation (e.g. notification click-through)
  const pendingRecordIdRef = useRef(null);
  const navigateToRecord = useCallback((pageId, recordId) => {
    pendingRecordIdRef.current = recordId;
    setActiveRightPane(pageId);
  }, [setActiveRightPane]);
  const consumePendingRecordId = useCallback(() => {
    const id = pendingRecordIdRef.current;
    pendingRecordIdRef.current = null;
    return id;
  }, []);

  // Pending Figma file to open in-app after navigating to the Figma feature
  // (used by notification click-through on a Figma @-mention).
  const pendingFigmaFileRef = useRef(null);
  const navigateToFigmaFile = useCallback((fileKey, fileName) => {
    pendingFigmaFileRef.current = { fileKey, fileName: fileName || "" };
    setActiveRightPane("figma");
  }, [setActiveRightPane]);
  const consumePendingFigmaFile = useCallback(() => {
    const f = pendingFigmaFileRef.current;
    pendingFigmaFileRef.current = null;
    return f;
  }, []);

  // ── Persist to localStorage ──
  useEffect(() => { saveJSON("wasabi_active_page", activeRightPane); }, [activeRightPane]);
  useEffect(() => { saveJSON("wasabi_active_folder", activeFolder); }, [activeFolder]);
  useEffect(() => { saveJSON("wasabi_active_left_pane", activeLeftPane); }, [activeLeftPane]);
  useEffect(() => { saveJSON("wasabi_split_ratio", splitRatio); }, [splitRatio]);
  useEffect(() => { saveJSON("wasabi_panel_mode", panelMode); }, [panelMode]);
  // Clean up vestigial localStorage keys (no longer used)
  useEffect(() => { try { localStorage.removeItem("wasabi_expanded_nodes"); } catch {} }, []);

  // ── Evict stale system page from activeRightPane once pages load ──
  const hasEvicted = useRef(false);
  useEffect(() => {
    if (hasEvicted.current || pages.length === 0 || !activeRightPane) return;
    hasEvicted.current = true;
    const target = pages.find((p) => p.id === activeRightPane);
    if (target && (target._systemInternal || SYSTEM_PAGE_TYPES.has(target.page_type) || (target.name && (target.name.startsWith("User Tasks") || target.name.startsWith("Zen Tasks"))))) {
      console.warn("[NavigationContext] Evicting system page from activeRightPane:", target.name);
      setActiveRightPaneRaw(null);
      saveJSON("wasabi_active_page", null);
    }
  }, [pages, activeRightPane]);

  // ── Landing view on app open ──
  // Tasks on the left, the global dashboard on the right, both panes visible —
  // every time the app opens, not just on a fresh sign-in.
  //
  // The dashboard is resolved by page_type rather than by id: dashboards are
  // ordinary pages now, and the legacy pane key "dashboard" that the Phase 2
  // migration wrote into wasabi_active_page matches no route at all, so anyone
  // still carrying that value fell through to the Workspaces browser.
  //
  // Waits for `pages` so the dashboard can be found, and runs once per load so
  // it never yanks the user away from somewhere they navigated to themselves.
  const hasAppliedLanding = useRef(false);
  useEffect(() => {
    if (hasAppliedLanding.current) return;
    if (!identity?.id || pages.length === 0) return;
    hasAppliedLanding.current = true;

    const isDashboard = (p) => p.page_type === "dashboard" || p.pageType === "dashboard";
    const dashboard = pages.find((p) => isDashboard(p) && p.config?.isGlobal)
      || pages.find(isDashboard);

    setActiveLeftPaneRaw("tasks");
    saveJSON("wasabi_active_left_pane", "tasks");
    setPanelModeRaw("split");
    saveJSON("wasabi_panel_mode", "split");
    if (dashboard) {
      setActiveRightPaneRaw(dashboard.id);
      saveJSON("wasabi_active_page", dashboard.id);
    }
  }, [identity, pages]);

  // ── Restore per-user state from D1 on login ──
  // Superseded by the landing view above, which is unconditional. `last_page`
  // is still written on navigation (see the debounced save below), so flipping
  // this back on restores resume-where-you-left-off without any other change.
  const RESTORE_LAST_PAGE_ON_LOGIN = false;
  const hasRestoredUserState = useRef(false);
  useEffect(() => {
    if (!RESTORE_LAST_PAGE_ON_LOGIN) return;
    if (!identity?.id || hasRestoredUserState.current) return;
    hasRestoredUserState.current = true;
    getUserState()
      .then(({ state }) => {
        if (state?.last_page) {
          // Don't restore navigation to system-internal pages
          const SYSTEM_PAGE_TYPES = new Set(["color-defaults", "color-view-config"]);
          const target = pages.find((p) => p.id === state.last_page);
          if (target && (target._systemInternal || SYSTEM_PAGE_TYPES.has(target.page_type) || (target.name && (target.name.startsWith("User Tasks") || target.name.startsWith("Zen Tasks"))))) return;
          setActiveRightPane(state.last_page);
          saveJSON("wasabi_active_page", state.last_page);
        }
      })
      .catch(err => console.warn("[NavigationContext] getUserState:", err.message || err));
  }, [identity]);

  // Reset restoration flag on identity change (user switch)
  useEffect(() => {
    if (!identity) hasRestoredUserState.current = false;
  }, [identity]);

  // ── Debounced save to D1 on page navigation ──
  const saveTimerRef = useRef(null);
  useEffect(() => {
    if (!identity?.id || !activeRightPane) return;
    // Don't persist system-internal pages as last_page
    const SYSTEM_PAGE_TYPES = new Set(["color-defaults", "color-view-config"]);
    const target = pages.find((p) => p.id === activeRightPane);
    if (target && (target._systemInternal || SYSTEM_PAGE_TYPES.has(target.page_type) || (target.name && (target.name.startsWith("User Tasks") || target.name.startsWith("Zen Tasks"))))) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      putUserState({ last_page: activeRightPane }).catch(err => console.warn("[NavigationContext] putUserState:", err.message || err));
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [activeRightPane, identity]);

  // ── Auto-expand workspaces on first load ──
  const hasAutoExpanded = useRef(false);
  useEffect(() => {
    if (hasAutoExpanded.current || pages.length === 0) return;
    hasAutoExpanded.current = true;
    // Only auto-expand if no saved state
    if (expandedNodes.size > 0) return;
    const workspaces = pages.filter((p) => p.page_type === "workspace" || p.pageType === "workspace");
    if (workspaces.length > 0) {
      setExpandedNodes(new Set(workspaces.map((w) => w.id)));
    } else {
      const roots = pages.filter((p) => p.type === "folder" && !p.parentId);
      if (roots.length > 0) setExpandedNodes(new Set(roots.map((r) => r.id)));
    }
  }, [pages]);

  const toggleExpand = useCallback((nodeId) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId);
      return next;
    });
  }, []);

  // Backwards-compat shims for callers that still expect `leftPaneCollapsed`
  // and `setLeftPaneCollapsed`. Maps `true` ↔ "right-max", `false` ↔ "split".
  // Does NOT cover the new "left-max" state — those callers must use panelMode.
  const leftPaneCollapsed = panelMode === "right-max";
  const setLeftPaneCollapsed = useCallback((collapsed) => {
    if (collapsed) setPanelModeRaw("right-max");
    else if (panelMode === "right-max") setPanelModeRaw("split");
  }, [panelMode]);

  const value = {
    activeRightPane,
    setActiveRightPane,
    activeFolder,
    setActiveFolder,
    expandedNodes,
    toggleExpand,
    targetFolderPath,
    setTargetFolderPath,
    navigateToRecord,
    consumePendingRecordId,
    navigateToFigmaFile,
    consumePendingFigmaFile,
    // Dual-pane state
    activeLeftPane,
    setActiveLeftPane,
    splitRatio,
    setSplitRatio,
    leftPaneCollapsed,
    setLeftPaneCollapsed,
    // Panel maximize mode (2026-05-08)
    panelMode,
    setPanelMode,
  };

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider");
  return ctx;
}
