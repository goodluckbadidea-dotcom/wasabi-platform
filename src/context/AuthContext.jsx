// ─── Auth Context ───
// User credentials, worker connection, platform IDs, setup state.
// JWT identity layer for multi-user support.
// Split from PlatformContext for focused re-renders.

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { loadPlatformIds, savePlatformIds } from "../config/setup.js";
import {
  getConnection, saveConnection, getConnections, initDatabase,
  getJwt, saveJwt, clearJwt, authMe, authLogin, authRegister as apiAuthRegister,
} from "../lib/api.js";

const AuthContext = createContext(null);

const USER_KEYS_STORAGE = "wasabi_user_keys";
const ROLE_LEVEL = { admin: 3, editor: 2, viewer: 1 };

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

  // ── Multi-user identity ──
  const [identity, setIdentity] = useState(null); // { id, display_name, role }
  const [multiUserEnabled, setMultiUserEnabled] = useState(false);
  const [adminInvite, setAdminInvite] = useState(null); // first-boot invite code
  const [identityLoading, setIdentityLoading] = useState(true);

  // ── D1 schema init ──
  const hasCalledInit = useRef(false);
  useEffect(() => {
    if (!workerConnection?.workerUrl || hasCalledInit.current) return;
    hasCalledInit.current = true;
    initDatabase()
      .then((result) => {
        // If init returns an admin_invite, this is first boot
        if (result?.admin_invite) {
          setAdminInvite(result.admin_invite.invite_code);
          setMultiUserEnabled(true);
        }
        // Backend tells us if registered users exist
        if (result?.multi_user) {
          setMultiUserEnabled(true);
        }
      })
      .catch((err) => {
        console.warn("[Auth] D1 init check:", err.message || err);
      });
  }, [workerConnection]);

  // ── Validate existing JWT on mount ──
  const hasCheckedJwt = useRef(false);
  useEffect(() => {
    if (!workerConnection?.workerUrl || hasCheckedJwt.current) return;
    hasCheckedJwt.current = true;

    const jwt = getJwt();
    if (!jwt) {
      setIdentityLoading(false);
      return;
    }

    authMe()
      .then(({ user: u }) => {
        if (u) {
          setIdentity({ id: u.id, display_name: u.display_name, role: u.role });
          setMultiUserEnabled(true);
        } else {
          clearJwt();
        }
      })
      .catch((err) => {
        // 401/404 = expired/deleted user; 500 = no users table yet (single-user mode)
        if (err.status === 401 || err.status === 404) {
          clearJwt();
        }
        // On 500, assume single-user mode — don't clear JWT
      })
      .finally(() => setIdentityLoading(false));
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

  // ── Multi-user actions ──
  const login = useCallback(async (displayName, password) => {
    const result = await authLogin(displayName, password);
    if (result.token) {
      saveJwt(result.token);
      setIdentity({ id: result.user.id, display_name: result.user.display_name, role: result.user.role });
      setMultiUserEnabled(true);
    }
    return result;
  }, []);

  const register = useCallback(async (inviteCode, displayName, password) => {
    const result = await apiAuthRegister(inviteCode, displayName, password);
    if (result.token) {
      saveJwt(result.token);
      setIdentity({ id: result.user.id, display_name: result.user.display_name, role: result.user.role });
      setMultiUserEnabled(true);
      setAdminInvite(null); // Clear first-boot invite
    }
    return result;
  }, []);

  const logout = useCallback(() => {
    clearJwt();
    setIdentity(null);
  }, []);

  const hasRole = useCallback((minRole) => {
    if (!identity) return true; // Single-user mode: allow everything
    return (ROLE_LEVEL[identity.role] || 0) >= (ROLE_LEVEL[minRole] || 99);
  }, [identity]);

  // ── Derived ──
  const isWorkerConnected = !!(workerConnection?.workerUrl);
  const isLegacySetup = !!(platformIds?.rootPageId);
  const isLegacyAuth = !!(user?.notionKey && user?.claudeKey && user?.workerUrl);

  const value = {
    user,
    setUserKeys,
    isAuthenticated: isWorkerConnected && (!multiUserEnabled || !!identity) || isLegacyAuth,
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
    // Multi-user
    identity,
    multiUserEnabled,
    adminInvite,
    identityLoading,
    login,
    register,
    logout,
    hasRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
