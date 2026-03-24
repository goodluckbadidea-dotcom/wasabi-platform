// ─── Wasabi Platform Context ───
// Thin composition layer over AuthContext, PagesContext, NavigationContext.
// usePlatform() merges all three for backward compatibility.
// Consumers can gradually migrate to useAuth(), usePages(), useNavigation()
// for more focused re-renders.

import React, { useCallback } from "react";
import { AuthProvider, useAuth } from "./AuthContext.jsx";
import { PagesProvider, usePages } from "./PagesContext.jsx";
import { NavigationProvider, useNavigation } from "./NavigationContext.jsx";
import LoginScreen from "../core/LoginScreen.jsx";

/**
 * Auth gate — sits between AuthProvider and data-fetching providers.
 * Nothing below this boundary mounts until authentication is confirmed.
 */
function AuthGate({ children }) {
  const { isSetup, isAuthenticated, identityLoading, bootError } = useAuth();

  if (!isSetup) {
    return <LoginScreen configError="Wasabi worker not configured. Set VITE_WORKER_URL in your build environment." />;
  }
  if (identityLoading) {
    return <LoginScreen loading />;
  }
  if (!isAuthenticated) {
    return <LoginScreen />;
  }
  return children;
}

export function PlatformProvider({ children }) {
  return (
    <AuthProvider>
      <AuthGate>
        <PagesProvider>
          <NavigationProvider>
            {children}
          </NavigationProvider>
        </PagesProvider>
      </AuthGate>
    </AuthProvider>
  );
}

/**
 * Backward-compatible hook that merges all context slices.
 * Cross-context actions (addPage + navigate, removePage + clear nav) are wired here.
 */
export function usePlatform() {
  const auth = useAuth();
  const pagesCtx = usePages();
  const nav = useNavigation();

  // Combined addPage: adds to pages + navigates
  const addPage = useCallback((pageConfig) => {
    pagesCtx.addPage(pageConfig);
    if (pageConfig.type === "folder") {
      nav.setActiveFolder(pageConfig.id);
      nav.setActivePage(null);
    } else {
      nav.setActivePage(pageConfig.id);
    }
  }, [pagesCtx.addPage, nav.setActivePage, nav.setActiveFolder]);

  // Combined removePage: removes from pages + clears nav
  const removePage = useCallback((id) => {
    pagesCtx.removePage(id);
    nav.setActivePage((curr) => (curr === id ? null : curr));
    nav.setActiveFolder((curr) => (curr === id ? null : curr));
  }, [pagesCtx.removePage, nav.setActivePage, nav.setActiveFolder]);

  return {
    // Auth
    user: auth.user,
    setUserKeys: auth.setUserKeys,
    isAuthenticated: auth.isAuthenticated,
    workerConnection: auth.workerConnection,
    completeSetup: auth.completeSetup,
    updateConnectionKey: auth.updateConnectionKey,
    platformIds: auth.platformIds,
    setPlatformIds: auth.setPlatformIds,
    isSetup: auth.isSetup,
    isLoading: auth.isLoading,
    setIsLoading: auth.setIsLoading,
    setupError: auth.setupError,
    setSetupError: auth.setSetupError,

    // Multi-user identity
    identity: auth.identity,
    multiUserEnabled: auth.multiUserEnabled,
    adminInvite: auth.adminInvite,
    identityLoading: auth.identityLoading,
    bootError: auth.bootError,
    login: auth.login,
    register: auth.register,
    logout: auth.logout,
    hasRole: auth.hasRole,

    // Pages (with cross-context wiring)
    pages: pagesCtx.pages,
    addPage,
    updatePageConfig: pagesCtx.updatePageConfig,
    removePage,

    // Hierarchy
    pageTree: pagesCtx.pageTree,
    folders: pagesCtx.folders,
    getFolderPages: pagesCtx.getFolderPages,
    globalDashboard: pagesCtx.globalDashboard,

    // Navigation
    activePage: nav.activePage,
    setActivePage: nav.setActivePage,
    activeFolder: nav.activeFolder,
    setActiveFolder: nav.setActiveFolder,
    expandedNodes: nav.expandedNodes,
    toggleExpand: nav.toggleExpand,

    // Batch queue
    batchQueue: pagesCtx.batchQueue,
    addToQueue: pagesCtx.addToQueue,
    updateQueueItem: pagesCtx.updateQueueItem,
    removeQueueItem: pagesCtx.removeQueueItem,
    reorderQueue: pagesCtx.reorderQueue,
  };
}
