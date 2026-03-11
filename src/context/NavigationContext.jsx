// ─── Navigation Context ───
// Active page, active folder, expanded tree nodes.
// Split from PlatformContext for focused re-renders.
// Uses usePages() internally for auto-expand.

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { usePages } from "./PagesContext.jsx";

const NavigationContext = createContext(null);

export function NavigationProvider({ children }) {
  const { pages } = usePages();

  const [activePage, setActivePage] = useState(null);
  const [activeFolder, setActiveFolder] = useState(null);
  const [expandedNodes, setExpandedNodes] = useState(new Set());

  // ── Auto-expand workspaces on first load ──
  const hasAutoExpanded = useRef(false);
  useEffect(() => {
    if (hasAutoExpanded.current || pages.length === 0) return;
    hasAutoExpanded.current = true;
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
  };

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider");
  return ctx;
}
