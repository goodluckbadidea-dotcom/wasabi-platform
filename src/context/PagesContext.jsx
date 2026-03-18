// ─── Pages Context ───
// Pages array CRUD, tree structure, folder helpers, global dashboard.
// Split from PlatformContext for focused re-renders.
// Uses useAuth() internally for data fetching from D1.

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { loadCachedConfigs, loadPageConfigs, validatePageConfigs, archivePageConfig, savePageConfig, createDashboardConfig, createWorkspaceConfig } from "../config/pageConfig.js";
import { useAuth } from "./AuthContext.jsx";

const PagesContext = createContext(null);

export function PagesProvider({ children }) {
  const { user, workerConnection } = useAuth();

  const [pages, setPages] = useState(() => loadCachedConfigs());

  // Save status: "idle" | "saving" | "saved" | "error"
  const [saveStatus, setSaveStatus] = useState("idle");
  const saveTimerRef = useRef(null);

  // Warn on tab close if saving
  useEffect(() => {
    const handler = (e) => {
      if (saveStatus === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveStatus]);

  // ── Batch queue (log) ──
  const [batchQueue, setBatchQueue] = useState([]);

  // ── Sync pages from D1 ──
  const hasSynced = useRef(false);
  useEffect(() => {
    if (!workerConnection?.workerUrl || hasSynced.current) return;
    hasSynced.current = true;

    loadPageConfigs()
      .then(async (configs) => {
        let finalConfigs = configs.length > 0 ? configs : [];

        if (finalConfigs.length > 0 && user?.workerUrl && user?.notionKey) {
          try {
            const { valid, stale } = await validatePageConfigs(user.workerUrl, user.notionKey, finalConfigs);
            if (stale.length > 0) {
              finalConfigs = valid;
              try { localStorage.setItem("wasabi_page_configs", JSON.stringify(valid)); } catch {}
              for (const s of stale) archivePageConfig(s.id).catch(() => {});
            }
          } catch (err) { console.warn("[Pages] Validation failed:", err); }
        }

        // Auto-create workspace
        if (!finalConfigs.some((c) => c.page_type === "workspace" || c.pageType === "workspace")) {
          try {
            const wsConfig = createWorkspaceConfig("My Workspace");
            const id = await savePageConfig(wsConfig);
            finalConfigs = [...finalConfigs, { ...wsConfig, id }];
          } catch (err) { console.warn("[Pages] Failed to create workspace:", err); }
        }

        // Auto-create global dashboard
        if (!finalConfigs.some((c) => (c.page_type === "dashboard" || c.pageType === "dashboard") && c.isGlobal)) {
          try {
            const dashConfig = createDashboardConfig("Dashboard", true);
            const id = await savePageConfig(dashConfig);
            finalConfigs = [...finalConfigs, { ...dashConfig, id }];
          } catch (err) { console.warn("[Pages] Failed to create dashboard:", err); }
        }

        setPages(finalConfigs);
      })
      .catch((err) => console.warn("[Pages] Failed to sync:", err));
  }, [workerConnection, user]);

  // ── Page tree ──
  const pageTree = useMemo(() => {
    const folderList = pages.filter((p) => p.type === "folder");
    const SYSTEM_PAGE_TYPES = new Set(["color-defaults", "color-view-config"]);
    const isSystemPage = (p) => p._systemInternal || SYSTEM_PAGE_TYPES.has(p.page_type) || (p.name && p.name.startsWith("Zen Tasks"));
    const pageList = pages.filter((p) => (p.type === "page" || !p.type) && !isSystemPage(p));
    const folderIdSet = new Set(folderList.map((f) => f.id));

    function buildViewNodes(page) {
      if (!page.views || page.views.length <= 1) return [];
      return page.views.map((view, idx) => ({
        id: page.id + "_view_" + idx,
        name: view.label || view.type,
        type: "view",
        nodeType: "view",
        viewIndex: idx,
        viewType: view.type,
        parentPageId: page.id,
        virtual: true,
      }));
    }

    function buildTree(parentId, depth) {
      return folderList
        .filter((f) => (parentId ? f.parentId === parentId : !f.parentId || !folderIdSet.has(f.parentId)))
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map((folder) => ({
          ...folder,
          nodeType: folder.page_type === "workspace" || folder.pageType === "workspace" ? "workspace" : "folder",
          depth,
          children: pageList
            .filter((p) => p.parentId === folder.id)
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
            .map((p) => ({
              ...p,
              nodeType: (p.page_type === "dashboard" || p.pageType === "dashboard") ? "dashboard" : "page",
              depth: depth + 1,
              viewChildren: buildViewNodes(p),
            })),
          childFolders: buildTree(folder.id, depth + 1),
        }));
    }

    const tree = buildTree(null, 0);

    // Orphan pages → virtual "Uncategorized" folder
    const allAssignedPageIds = new Set();
    function collectAssigned(nodes) {
      for (const node of nodes) {
        for (const child of (node.children || [])) allAssignedPageIds.add(child.id);
        collectAssigned(node.childFolders || []);
      }
    }
    collectAssigned(tree);

    const orphans = pageList.filter((p) => !allAssignedPageIds.has(p.id));
    if (orphans.length > 0) {
      tree.push({
        id: "__uncategorized__",
        name: "Uncategorized",
        icon: "folder",
        type: "folder",
        nodeType: "folder",
        virtual: true,
        depth: 0,
        children: orphans.map((p) => ({
          ...p,
          nodeType: (p.page_type === "dashboard" || p.pageType === "dashboard") ? "dashboard" : "page",
          depth: 1,
          viewChildren: buildViewNodes(p),
        })),
        childFolders: [],
      });
    }

    return tree;
  }, [pages]);

  const folders = useMemo(() => pages.filter((p) => p.type === "folder"), [pages]);

  const globalDashboard = useMemo(
    () => pages.find((p) => (p.page_type === "dashboard" || p.pageType === "dashboard") && p.isGlobal) || null,
    [pages]
  );

  const getFolderPages = useCallback((folderId) => {
    if (folderId === "__uncategorized__") {
      const folderIds = new Set(pages.filter((p) => p.type === "folder").map((p) => p.id));
      return pages.filter((p) => (p.type === "page" || !p.type) && (!p.parentId || !folderIds.has(p.parentId)));
    }
    return pages.filter((p) => p.parentId === folderId && p.type !== "folder");
  }, [pages]);

  // ── Page CRUD (raw — no navigation side-effects) ──
  const addPageRaw = useCallback((pageConfig) => {
    setPages((prev) => {
      const updated = [...prev, pageConfig];
      try { localStorage.setItem("wasabi_page_configs", JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  const updatePageConfig = useCallback(async (id, updates) => {
    // Capture previous state for rollback
    const prevPages = pages;
    const updated = pages.map((p) => (p.id === id ? { ...p, ...updates } : p));
    const changed = updated.find((p) => p.id === id);

    // Optimistic update
    setPages(updated);
    try { localStorage.setItem("wasabi_page_configs", JSON.stringify(updated)); } catch {}

    // Persist to D1 with rollback on failure
    if (changed) {
      setSaveStatus("saving");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      try {
        await savePageConfig(changed);
        setSaveStatus("saved");
        saveTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
      } catch (err) {
        console.error("[Pages] Persist failed, rolling back:", err);
        setSaveStatus("error");
        saveTimerRef.current = setTimeout(() => setSaveStatus("idle"), 4000);
        // Rollback: restore previous state and localStorage
        setPages(prevPages);
        try { localStorage.setItem("wasabi_page_configs", JSON.stringify(prevPages)); } catch {}
      }
    }
  }, [pages]);

  const removePageRaw = useCallback((id) => {
    setPages((prev) => {
      let updated = prev.filter((p) => p.id !== id && p.parentId !== id);
      // Clean dashboard widgets referencing deleted page
      updated = updated.map((p) => {
        if ((p.page_type === "dashboard" || p.pageType === "dashboard") && p.widgets?.length) {
          const cleaned = p.widgets.filter((w) => w.pageId !== id);
          if (cleaned.length !== p.widgets.length) {
            const result = { ...p, widgets: cleaned };
            savePageConfig(result).catch(() => {});
            return result;
          }
        }
        return p;
      });
      try { localStorage.setItem("wasabi_page_configs", JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  // ── Queue actions ──
  const addToQueue = useCallback((item) => {
    setBatchQueue((prev) => [...prev, { id: Date.now().toString(), ...item, status: "pending" }]);
  }, []);

  const updateQueueItem = useCallback((id, updates) => {
    setBatchQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...updates } : q)));
  }, []);

  const removeQueueItem = useCallback((id) => {
    setBatchQueue((prev) => prev.filter((q) => q.id !== id));
  }, []);

  const reorderQueue = useCallback((fromIdx, toIdx) => {
    setBatchQueue((prev) => {
      const arr = [...prev];
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      return arr;
    });
  }, []);

  const value = {
    pages,
    addPage: addPageRaw,
    updatePageConfig,
    removePage: removePageRaw,
    pageTree,
    folders,
    getFolderPages,
    globalDashboard,
    saveStatus,
    batchQueue,
    addToQueue,
    updateQueueItem,
    removeQueueItem,
    reorderQueue,
  };

  return <PagesContext.Provider value={value}>{children}</PagesContext.Provider>;
}

export function usePages() {
  const ctx = useContext(PagesContext);
  if (!ctx) throw new Error("usePages must be used within PagesProvider");
  return ctx;
}
