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

  const [activePage, setActivePageRaw] = useState(() => loadJSON("wasabi_active_page", null));
  const [activeFolder, setActiveFolder] = useState(() => loadJSON("wasabi_active_folder", null));
  const [expandedNodes, setExpandedNodes] = useState(new Set());

  // ── Guarded setter: rejects system-internal pages at the gate ──
  const SYSTEM_PAGE_TYPES = new Set(["color-defaults", "color-view-config"]);
  const setActivePage = useCallback((pageId) => {
    // Allow null, special string IDs ("tasks", "workspaces", "gmail", etc.)
    if (pageId === null || (typeof pageId === "string" && !/^[0-9a-f]{8}-/.test(pageId))) {
      setActivePageRaw(pageId);
      return;
    }
    // Block system-internal pages (User Tasks, color configs, etc.)
    const target = pages.find((p) => p.id === pageId);
    if (target && (target._systemInternal || SYSTEM_PAGE_TYPES.has(target.page_type) || (target.name && (target.name.startsWith("User Tasks") || target.name.startsWith("Zen Tasks"))))) {
      console.warn("[NavigationContext] Blocked navigation to system page:", target.name || pageId);
      return;
    }
    setActivePageRaw(pageId);
  }, [pages]);

  // Navigation signal for breadcrumb → WorkspaceBrowser path sync
  const [targetFolderPath, setTargetFolderPath] = useState(null);

  // Pending record to open after page navigation (e.g. notification click-through)
  const pendingRecordIdRef = useRef(null);
  const navigateToRecord = useCallback((pageId, recordId) => {
    pendingRecordIdRef.current = recordId;
    setActivePage(pageId);
  }, [setActivePage]);
  const consumePendingRecordId = useCallback(() => {
    const id = pendingRecordIdRef.current;
    pendingRecordIdRef.current = null;
    return id;
  }, []);

  // ── Persist to localStorage ──
  useEffect(() => { saveJSON("wasabi_active_page", activePage); }, [activePage]);
  useEffect(() => { saveJSON("wasabi_active_folder", activeFolder); }, [activeFolder]);
  // Clean up vestigial localStorage key (no longer used)
  useEffect(() => { try { localStorage.removeItem("wasabi_expanded_nodes"); } catch {} }, []);

  // ── Evict stale system page from activePage once pages load ──
  const hasEvicted = useRef(false);
  useEffect(() => {
    if (hasEvicted.current || pages.length === 0 || !activePage) return;
    hasEvicted.current = true;
    const target = pages.find((p) => p.id === activePage);
    if (target && (target._systemInternal || SYSTEM_PAGE_TYPES.has(target.page_type) || (target.name && (target.name.startsWith("User Tasks") || target.name.startsWith("Zen Tasks"))))) {
      console.warn("[NavigationContext] Evicting system page from activePage:", target.name);
      setActivePageRaw(null);
      saveJSON("wasabi_active_page", null);
    }
  }, [pages, activePage]);

  // ── Restore per-user state from D1 on login ──
  const hasRestoredUserState = useRef(false);
  useEffect(() => {
    if (!identity?.id || hasRestoredUserState.current) return;
    hasRestoredUserState.current = true;
    getUserState()
      .then(({ state }) => {
        if (state?.last_page) {
          // Don't restore navigation to system-internal pages
          const SYSTEM_PAGE_TYPES = new Set(["color-defaults", "color-view-config"]);
          const target = pages.find((p) => p.id === state.last_page);
          if (target && (target._systemInternal || SYSTEM_PAGE_TYPES.has(target.page_type) || (target.name && (target.name.startsWith("User Tasks") || target.name.startsWith("Zen Tasks"))))) return;
          setActivePage(state.last_page);
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
    if (!identity?.id || !activePage) return;
    // Don't persist system-internal pages as last_page
    const SYSTEM_PAGE_TYPES = new Set(["color-defaults", "color-view-config"]);
    const target = pages.find((p) => p.id === activePage);
    if (target && (target._systemInternal || SYSTEM_PAGE_TYPES.has(target.page_type) || (target.name && (target.name.startsWith("User Tasks") || target.name.startsWith("Zen Tasks"))))) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      putUserState({ last_page: activePage }).catch(err => console.warn("[NavigationContext] putUserState:", err.message || err));
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [activePage, identity]);

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

  const value = {
    activePage,
    setActivePage,
    activeFolder,
    setActiveFolder,
    expandedNodes,
    toggleExpand,
    targetFolderPath,
    setTargetFolderPath,
    navigateToRecord,
    consumePendingRecordId,
  };

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider");
  return ctx;
}
