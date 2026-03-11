// ─── Auth Context ───
// User credentials, worker connection, platform IDs, setup state.
// Split from PlatformContext for focused re-renders.

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { loadPlatformIds, savePlatformIds } from "../config/setup.js";
import { getConnection, saveConnection, getConnections, initDatabase } from "../lib/api.js";

const AuthContext = createContext(null);

const USER_KEYS_STORAGE = "wasabi_user_keys";

function loadUserKeys() {
  try {
    const stored = localStorage.getItem(USER_KEYS_STORAGE);
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
}

function saveUserKeys(keys) {
  try { localStorage.setItem(USER_KEYS_STORAGE, JSON.stringify(keys)); } catch {}
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => loadUserKeys());
  const [workerConnection, setWorkerConnection] = useState(() => getConnection());
  const [platformIds, setPlatformIds] = useState(() => loadPlatformIds());
  const [isLoading, setIsLoading] = useState(false);
  const [setupError, setSetupError] = useState(null);

  // ── D1 schema init ──
  const hasCalledInit = useRef(false);
  useEffect(() => {
    if (!workerConnection?.workerUrl || hasCalledInit.current) return;
    hasCalledInit.current = true;
    initDatabase().catch((err) => {
      console.warn("[Auth] D1 init check:", err.message || err);
    });
  }, [workerConnection]);

  // ── Sync connection keys from D1 ──
  const hasLoadedConnections = useRef(false);
  useEffect(() => {
    if (!workerConnection?.workerUrl || hasLoadedConnections.current) return;
    hasLoadedConnections.current = true;

    getConnections()
      .then(({ connections }) => {
        if (!connections || connections.length === 0) return;
        const notionConn = connections.find((c) => c.key === "notion");
        const claudeConn = connections.find((c) => c.key === "claude");
        const mondayConn = connections.find((c) => c.key === "monday");

        setUser((prev) => {
          const updated = { ...(prev || { workerUrl: workerConnection.workerUrl }) };
          let changed = false;
          if (notionConn?.value && updated.notionKey !== notionConn.value) { updated.notionKey = notionConn.value; changed = true; }
          if (claudeConn?.value && updated.claudeKey !== claudeConn.value) { updated.claudeKey = claudeConn.value; changed = true; }
          if (mondayConn?.value && updated.mondayKey !== mondayConn.value) { updated.mondayKey = mondayConn.value; changed = true; }
          if (!updated.workerUrl && workerConnection.workerUrl) { updated.workerUrl = workerConnection.workerUrl; changed = true; }
          if (changed) { saveUserKeys(updated); return updated; }
          return prev;
        });
      })
      .catch((err) => console.warn("[Auth] Failed to sync connections:", err));
  }, [workerConnection]);

  // ── Actions ──
  const setUserKeys = useCallback((keys) => {
    setUser(keys);
    saveUserKeys(keys);
  }, []);

  const setIds = useCallback((ids) => {
    setPlatformIds(ids);
    savePlatformIds(ids);
  }, []);

  const completeSetup = useCallback((workerUrl, secret) => {
    const conn = saveConnection(workerUrl, secret);
    setWorkerConnection(conn);
    const keys = { workerUrl, notionKey: user?.notionKey || "", claudeKey: user?.claudeKey || "" };
    setUser(keys);
    saveUserKeys(keys);
    if (!platformIds) {
      const stubIds = { d1Initialized: true };
      setPlatformIds(stubIds);
      savePlatformIds(stubIds);
    }
  }, [user, platformIds]);

  const updateConnectionKey = useCallback((key, value) => {
    setUser((prev) => {
      const field = key === "notion" ? "notionKey" : key === "claude" ? "claudeKey" : key === "monday" ? "mondayKey" : null;
      if (!field) return prev;
      const updated = { ...prev, [field]: value };
      saveUserKeys(updated);
      return updated;
    });
  }, []);

  // ── Derived ──
  const isWorkerConnected = !!(workerConnection?.workerUrl);
  const isLegacySetup = !!(platformIds?.rootPageId);
  const isLegacyAuth = !!(user?.notionKey && user?.claudeKey && user?.workerUrl);

  const value = {
    user,
    setUserKeys,
    isAuthenticated: isWorkerConnected || isLegacyAuth,
    workerConnection,
    completeSetup,
    updateConnectionKey,
    platformIds,
    setPlatformIds: setIds,
    isSetup: isWorkerConnected || isLegacySetup,
    isLoading,
    setIsLoading,
    setupError,
    setSetupError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
