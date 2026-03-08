// ─── Wasabi Platform Context ───
// Central state provider for the entire application.
// Setup now requires only a worker URL + secret (Notion optional).

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { loadPlatformIds, savePlatformIds } from "../config/setup.js";
import { loadCachedConfigs, loadPageConfigs, validatePageConfigs, archivePageConfig, savePageConfig } from "../config/pageConfig.js";
import { getConnection, saveConnection, getConnections } from "../lib/api.js";

const PlatformContext = createContext(null);

const USER_KEYS_STORAGE = "wasabi_user_keys";

function loadUserKeys() {
  try {
    const stored = localStorage.getItem(USER_KEYS_STORAGE);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function saveUserKeys(keys) {
  try {
    localStorage.setItem(USER_KEYS_STORAGE, JSON.stringify(keys));
  } catch {}
}

export function PlatformProvider({ children }) {
  // ─── User credentials (legacy: workerUrl, notionKey, claudeKey) ───
  const [user, setUser] = useState(() => loadUserKeys());

  // ─── Worker connection (new: workerUrl + secret via api.js) ───
  const [workerConnection, setWorkerConnection] = useState(() => getConnection());

  // ─── Platform infrastructure IDs (legacy Notion-based) ───
  const [platformIds, setPlatformIds] = useState(() => loadPlatformIds());

  // ─── Pages ───
  const [pages, setPages] = useState(() => loadCachedConfigs());
  const [activePage, setActivePage] = useState(null); // page id, "wasabi", "system", or null (home)
  const [activeFolder, setActiveFolder] = useState(null); // folder id or null
  const [activeSubPage, setActiveSubPage] = useState(null); // sub-page id or null (show parent)

  // ─── Page tree (hierarchy) ───
  const pageTree = useMemo(() => {
    const folderList = pages.filter((p) => p.type === "folder");
    const pageList = pages.filter((p) => p.type === "page" || !p.type);
    const subList = pages.filter((p) => p.type === "sub_page");

    const tree = folderList.map((folder) => ({
      ...folder,
      children: pageList
        .filter((p) => p.parentId === folder.id)
        .map((page) => ({
          ...page,
          children: subList.filter((sp) => sp.parentId === page.id),
        })),
    }));

    // Orphan pages → virtual "Uncategorized" folder
    const assigned = new Set(tree.flatMap((f) => f.children.map((p) => p.id)));
    const orphans = pageList.filter((p) => !assigned.has(p.id));
    if (orphans.length > 0) {
      tree.push({
        id: "__uncategorized__",
        name: "Uncategorized",
        icon: "folder",
        type: "folder",
        virtual: true,
        children: orphans.map((p) => ({
          ...p,
          children: subList.filter((sp) => sp.parentId === p.id),
        })),
      });
    }

    return tree;
  }, [pages]);

  const folders = useMemo(() => pages.filter((p) => p.type === "folder"), [pages]);

  const getFolderPages = useCallback(
    (folderId) => {
      if (folderId === "__uncategorized__") {
        const folderIds = new Set(pages.filter((p) => p.type === "folder").map((p) => p.id));
        return pages.filter(
          (p) => (p.type === "page" || !p.type) && (!p.parentId || !folderIds.has(p.parentId))
        );
      }
      return pages.filter((p) => p.parentId === folderId && p.type !== "sub_page" && p.type !== "folder");
    },
    [pages]
  );

  const getSubPages = useCallback(
    (pageId) => pages.filter((p) => p.parentId === pageId && p.type === "sub_page"),
    [pages]
  );

  // ─── Global log (formerly batch queue) ───
  const [batchQueue, setBatchQueue] = useState([]);

  // ─── Loading states ───
  const [isLoading, setIsLoading] = useState(false);
  const [setupError, setSetupError] = useState(null);

  // ─── Sync connection keys from D1 on mount ───
  // Ensures user.notionKey and user.claudeKey are populated even if
  // they were only saved to D1 (not in legacy localStorage).
  const hasLoadedConnections = useRef(false);
  useEffect(() => {
    if (!workerConnection?.workerUrl || hasLoadedConnections.current) return;
    hasLoadedConnections.current = true;

    getConnections()
      .then(({ connections }) => {
        if (!connections || connections.length === 0) return;

        const notionConn = connections.find((c) => c.key === "notion");
        const claudeConn = connections.find((c) => c.key === "claude");

        setUser((prev) => {
          const updated = { ...(prev || { workerUrl: workerConnection.workerUrl }) };
          let changed = false;

          if (notionConn?.value && updated.notionKey !== notionConn.value) {
            updated.notionKey = notionConn.value;
            changed = true;
          }
          if (claudeConn?.value && updated.claudeKey !== claudeConn.value) {
            updated.claudeKey = claudeConn.value;
            changed = true;
          }
          // Ensure workerUrl is always set
          if (!updated.workerUrl && workerConnection.workerUrl) {
            updated.workerUrl = workerConnection.workerUrl;
            changed = true;
          }

          if (changed) {
            saveUserKeys(updated);
            console.log("[Platform] Synced connection keys from D1");
            return updated;
          }
          return prev;
        });
      })
      .catch((err) => {
        console.warn("[Platform] Failed to sync connections from D1:", err);
      });
  }, [workerConnection]);

  // ─── Sync pages from D1 on mount ───
  const hasSynced = useRef(false);
  useEffect(() => {
    if (!workerConnection?.workerUrl || hasSynced.current) return;
    hasSynced.current = true;

    loadPageConfigs()
      .then(async (configs) => {
        if (configs.length > 0) {
          setPages(configs);

          // Background validation: detect and remove stale Notion-linked pages
          if (user?.workerUrl && user?.notionKey) {
            try {
              const { valid, stale } = await validatePageConfigs(user.workerUrl, user.notionKey, configs);
              if (stale.length > 0) {
                setPages(valid);
                try { localStorage.setItem("wasabi_page_configs", JSON.stringify(valid)); } catch {}
                for (const s of stale) {
                  archivePageConfig(s.id).catch(() => {});
                }
                console.log(`[Platform] Cleaned up ${stale.length} stale page config(s)`);
              }
            } catch (err) {
              console.warn("[Platform] Page validation failed:", err);
            }
          }
        }
      })
      .catch((err) => {
        console.warn("Failed to sync page configs:", err);
      });
  }, [workerConnection, user]);

  // ─── Actions ───

  const setUserKeys = useCallback((keys) => {
    setUser(keys);
    saveUserKeys(keys);
  }, []);

  const setIds = useCallback((ids) => {
    setPlatformIds(ids);
    savePlatformIds(ids);
  }, []);

  /**
   * Complete the new simplified setup (worker URL + secret).
   * Seeds legacy user state with workerUrl for backward compat.
   */
  const completeSetup = useCallback((workerUrl, secret) => {
    const conn = saveConnection(workerUrl, secret);
    setWorkerConnection(conn);

    // Seed legacy user keys so existing code keeps working
    const keys = {
      workerUrl,
      notionKey: user?.notionKey || "",
      claudeKey: user?.claudeKey || "",
    };
    setUser(keys);
    saveUserKeys(keys);

    // Mark as "setup complete" without requiring Notion IDs
    if (!platformIds) {
      const stubIds = { d1Initialized: true };
      setPlatformIds(stubIds);
      savePlatformIds(stubIds);
    }
  }, [user, platformIds]);

  /**
   * Update a connection key on the worker. Also updates legacy user keys.
   */
  const updateConnectionKey = useCallback((key, value) => {
    if (key === "notion") {
      setUser((prev) => {
        const updated = { ...prev, notionKey: value };
        saveUserKeys(updated);
        return updated;
      });
    } else if (key === "claude") {
      setUser((prev) => {
        const updated = { ...prev, claudeKey: value };
        saveUserKeys(updated);
        return updated;
      });
    }
  }, []);

  const addPage = useCallback((pageConfig) => {
    setPages((prev) => {
      const updated = [...prev, pageConfig];
      try {
        localStorage.setItem("wasabi_page_configs", JSON.stringify(updated));
      } catch {}
      return updated;
    });
    // Navigate based on type
    if (pageConfig.type === "folder") {
      // Enter the new folder (stay on home, sidebar shows folder contents)
      setActiveFolder(pageConfig.id);
      setActivePage(null);
    } else if (pageConfig.type === "sub_page") {
      // Don't navigate away — just show the new sub-page pill
      setActiveSubPage(pageConfig.id);
    } else {
      // Regular page — navigate to it
      setActivePage(pageConfig.id);
    }
  }, []);

  const updatePageConfig = useCallback((id, updates) => {
    setPages((prev) => {
      const updated = prev.map((p) => (p.id === id ? { ...p, ...updates } : p));
      try {
        localStorage.setItem("wasabi_page_configs", JSON.stringify(updated));
      } catch {}
      // Auto-persist to D1
      const changed = updated.find((p) => p.id === id);
      if (changed) savePageConfig(changed).catch((err) => console.error("[PlatformContext] Failed to persist config:", err));
      return updated;
    });
  }, []);

  const removePage = useCallback((id) => {
    setPages((prev) => {
      // Also remove children (pages in folder, sub-pages in page)
      const updated = prev.filter((p) => p.id !== id && p.parentId !== id);
      try {
        localStorage.setItem("wasabi_page_configs", JSON.stringify(updated));
      } catch {}
      return updated;
    });
    setActivePage((curr) => (curr === id ? null : curr));
    setActiveFolder((curr) => (curr === id ? null : curr));
    setActiveSubPage((curr) => (curr === id ? null : curr));
  }, []);

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
      const updated = [...prev];
      const [item] = updated.splice(fromIdx, 1);
      updated.splice(toIdx, 0, item);
      return updated;
    });
  }, []);

  // ─── Derived state ───
  const isWorkerConnected = !!(workerConnection?.workerUrl);
  const isLegacySetup = !!(platformIds?.rootPageId);
  const isLegacyAuth = !!(user?.notionKey && user?.claudeKey && user?.workerUrl);

  const value = {
    // Credentials
    user,
    setUserKeys,
    isAuthenticated: isWorkerConnected || isLegacyAuth,

    // Worker connection (new)
    workerConnection,
    completeSetup,
    updateConnectionKey,

    // Platform IDs (legacy — still needed for existing Notion features)
    platformIds,
    setPlatformIds: setIds,
    isSetup: isWorkerConnected || isLegacySetup,

    // Pages
    pages,
    activePage,
    setActivePage,
    addPage,
    updatePageConfig,
    removePage,

    // Hierarchy
    activeFolder,
    setActiveFolder,
    activeSubPage,
    setActiveSubPage,
    pageTree,
    folders,
    getFolderPages,
    getSubPages,

    // Log (batch queue)
    batchQueue,
    addToQueue,
    updateQueueItem,
    removeQueueItem,
    reorderQueue,

    // Loading
    isLoading,
    setIsLoading,
    setupError,
    setSetupError,
  };

  return (
    <PlatformContext.Provider value={value}>
      {children}
    </PlatformContext.Provider>
  );
}

/**
 * Hook to access platform context.
 */
export function usePlatform() {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error("usePlatform must be used within PlatformProvider");
  return ctx;
}
