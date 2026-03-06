// ─── Wasabi Platform Context ───
// Central state provider for the entire application.

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { loadPlatformIds, savePlatformIds } from "../config/setup.js";
import { loadCachedConfigs, loadPageConfigs } from "../config/pageConfig.js";

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
  // ─── User credentials ───
  const [user, setUser] = useState(() => loadUserKeys());

  // ─── Platform infrastructure IDs ───
  const [platformIds, setPlatformIds] = useState(() => loadPlatformIds());

  // ─── Pages ───
  const [pages, setPages] = useState(() => loadCachedConfigs());
  const [activePage, setActivePage] = useState(null); // page id, "wasabi", "system", or null (onboarding)

  // ─── Global batch queue ───
  const [batchQueue, setBatchQueue] = useState([]);

  // ─── Loading states ───
  const [isLoading, setIsLoading] = useState(false);
  const [setupError, setSetupError] = useState(null);

  // ─── Sync pages from Notion on mount ───
  const hasSynced = useRef(false);
  useEffect(() => {
    if (!user?.workerUrl || !user?.notionKey || !platformIds?.configDbId || hasSynced.current) return;
    hasSynced.current = true;

    loadPageConfigs(user.workerUrl, user.notionKey, platformIds.configDbId)
      .then((configs) => {
        if (configs.length > 0) {
          setPages(configs);
        }
      })
      .catch((err) => {
        console.warn("Failed to sync page configs:", err);
      });
  }, [user, platformIds]);

  // ─── Actions ───

  const setUserKeys = useCallback((keys) => {
    setUser(keys);
    saveUserKeys(keys);
  }, []);

  const setIds = useCallback((ids) => {
    setPlatformIds(ids);
    savePlatformIds(ids);
  }, []);

  const addPage = useCallback((pageConfig) => {
    setPages((prev) => {
      const updated = [...prev, pageConfig];
      try {
        localStorage.setItem("wasabi_page_configs", JSON.stringify(updated));
      } catch {}
      return updated;
    });
    // Navigate to the new page
    setActivePage(pageConfig.id);
  }, []);

  const updatePageConfig = useCallback((id, updates) => {
    setPages((prev) => {
      const updated = prev.map((p) => (p.id === id ? { ...p, ...updates } : p));
      try {
        localStorage.setItem("wasabi_page_configs", JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const removePage = useCallback((id) => {
    setPages((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      try {
        localStorage.setItem("wasabi_page_configs", JSON.stringify(updated));
      } catch {}
      return updated;
    });
    setActivePage((curr) => (curr === id ? null : curr));
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

  const value = {
    // Credentials
    user,
    setUserKeys,
    isAuthenticated: !!(user?.notionKey && user?.claudeKey && user?.workerUrl),

    // Platform IDs
    platformIds,
    setPlatformIds: setIds,
    isSetup: !!(platformIds?.rootPageId),

    // Pages
    pages,
    activePage,
    setActivePage,
    addPage,
    updatePageConfig,
    removePage,

    // Batch queue
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
