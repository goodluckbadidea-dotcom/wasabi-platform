// ─── Auth Context ───
// JWT identity layer for multi-user support.
// Worker URL comes from VITE_WORKER_URL (build-time config via getWorkerUrl()).
// Split from PlatformContext for focused re-renders.

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import {
  getWorkerUrl, getConnections, initDatabase,
  getJwt, saveJwt, clearJwt, saveRefreshToken, authMe, authLogin, authRegister as apiAuthRegister,
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
  // platformIds: legacy Notion setup IDs. Kept as null for backward compat with consumers.
  const platformIds = null;
  const [isLoading, setIsLoading] = useState(false);
  const [setupError, setSetupError] = useState(null);

  // Worker URL from build-time config (no state needed — it's constant)
  const workerUrl = getWorkerUrl();

  // ── Multi-user identity ──
  const [identity, setIdentity] = useState(null); // { id, display_name, role }
  const [multiUserEnabled, setMultiUserEnabled] = useState(false);
  const [adminInvite, setAdminInvite] = useState(null); // first-boot invite code
  const [identityLoading, setIdentityLoading] = useState(true);

  // ── D1 init + JWT validation (state machine to avoid race) ──
  // bootState: "idle" → "booting" → "ready" | "error"
  const [bootState, setBootState] = useState("idle");
  useEffect(() => {
    if (!workerUrl || bootState !== "idle") return;
    setBootState("booting");

    (async () => {
      // Step 1: Init DB and detect multi-user state
      let isMultiUser = false;
      try {
        const result = await initDatabase();
        if (result?.admin_invite) {
          setAdminInvite(result.admin_invite.invite_code);
          isMultiUser = true;
        }
        if (result?.multi_user) {
          isMultiUser = true;
        }
        if (isMultiUser) setMultiUserEnabled(true);
      } catch (err) {
        console.warn("[Auth] D1 init check:", err.message || err);
      }

      // Step 2: Validate JWT — try memory first, fall back to refresh token.
      // On page refresh, memory is empty but the refresh token restores the session.
      if (!isMultiUser) {
        // Single-user mode — no auth needed
        setIdentityLoading(false);
        setBootState("ready");
        return;
      }

      try {
        const result = await authMe();
        if (result?.user) {
          setIdentity({ id: result.user.id, display_name: result.user.display_name, role: result.user.role });
          setMultiUserEnabled(true);
          if (result.token) saveJwt(result.token);
          if (result.refreshToken) saveRefreshToken(result.refreshToken);
        } else {
          clearJwt();
        }
      } catch (err) {
        if (err.status === 401 || err.status === 404) {
          clearJwt();
        }
      } finally {
        setIdentityLoading(false);
        setBootState("ready");
      }
    })();
  }, [workerUrl, bootState]);

  // ── Sync connection keys from D1 ──
  const hasLoadedConnections = useRef(false);
  useEffect(() => {
    if (!workerUrl || hasLoadedConnections.current) return;
    hasLoadedConnections.current = true;

    getConnections()
      .then(({ connections }) => {
        if (!connections || connections.length === 0) return;
        const notionConn = connections.find((c) => c.key === "notion");
        const claudeConn = connections.find((c) => c.key === "claude");
        const mondayConn = connections.find((c) => c.key === "monday");

        setUser((prev) => {
          const updated = { ...(prev || { workerUrl }) };
          let changed = false;
          if (notionConn?.value && updated.notionKey !== notionConn.value) { updated.notionKey = notionConn.value; changed = true; }
          if (claudeConn?.value && updated.claudeKey !== claudeConn.value) { updated.claudeKey = claudeConn.value; changed = true; }
          if (mondayConn?.value && updated.mondayKey !== mondayConn.value) { updated.mondayKey = mondayConn.value; changed = true; }
          if (!updated.workerUrl && workerUrl) { updated.workerUrl = workerUrl; changed = true; }
          if (changed) { saveUserKeys(updated); return updated; }
          return prev;
        });
      })
      .catch((err) => console.warn("[Auth] Failed to sync connections:", err));
  }, [workerUrl]);

  // ── Actions ──
  const setUserKeys = useCallback((keys) => {
    setUser(keys);
    saveUserKeys(keys);
  }, []);

  /** @deprecated Legacy Notion setup. No-op. */
  const setIds = useCallback(() => {}, []);

  /** @deprecated No longer needed — worker URL comes from VITE_WORKER_URL. */
  const completeSetup = useCallback(() => {}, []);

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
      if (result.refreshToken) saveRefreshToken(result.refreshToken);
      setIdentity({ id: result.user.id, display_name: result.user.display_name, role: result.user.role });
      setMultiUserEnabled(true);
    }
    return result;
  }, []);

  const register = useCallback(async (inviteCode, displayName, password) => {
    const result = await apiAuthRegister(inviteCode, displayName, password);
    if (result.token) {
      saveJwt(result.token);
      if (result.refreshToken) saveRefreshToken(result.refreshToken);
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
  const isWorkerConnected = !!workerUrl;
  // Backward-compat: expose workerConnection as object for consumers that destructure it
  const workerConnection = workerUrl ? { workerUrl } : null;

  const value = {
    user,
    setUserKeys,
    isAuthenticated: isWorkerConnected && (!multiUserEnabled || !!identity),
    workerConnection,
    completeSetup,
    updateConnectionKey,
    platformIds,
    setPlatformIds: setIds,
    isSetup: isWorkerConnected,
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
