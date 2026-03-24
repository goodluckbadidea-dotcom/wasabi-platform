// ─── Navigation Context ───
// Active page, active folder, expanded tree nodes.
// Split from PlatformContext for focused re-renders.
// Uses usePages() internally for auto-expand.
// Persists navigation state to localStorage + D1 (per-user) so the app feels like a persistent desk.

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
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

  const [activePage, setActivePage] = useState(() => loadJSON("wasabi_active_page", null));
  const [activeFolder, setActiveFolder] = useState(() => loadJSON("wasabi_active_folder", null));
  const [expandedNodes, setExpandedNodes] = useState(new Set());

  // Navigation signal for breadcrumb → WorkspaceBrowser path sync
  const [targetFolderPath, setTargetFolderPath] = useState(null);

  // ── Persist to localStorage ──
  useEffect(() => { saveJSON("wasabi_active_page", activePage); }, [activePage]);
  useEffect(() => { saveJSON("wasabi_active_folder", activeFolder); }, [activeFolder]);
  // Clean up vestigial localStorage key (no longer used)
  useEffect(() => { try { localStorage.removeItem("wasabi_expanded_nodes"); } catch {} }, []);

  // ── Restore per-user state from D1 on login ──
  const hasRestoredUserState = useRef(false);
  useEffect(() => {
    if (!identity?.id || hasRestoredUserState.current) return;
    hasRestoredUserState.current = true;
    getUserState()
      .then(({ state }) => {
        if (state?.last_page) {
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
  };

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider");
  return ctx;
}
