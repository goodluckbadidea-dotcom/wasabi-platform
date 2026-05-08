// ─── Wasabi Platform App Shell ───
// Root component: auth gate → layout → routing
// Layout: [SplitPane(left, right)] + BottomBar
// BottomBar (2026-05-08): horizontal dock at the bottom; replaces the
// old TopHeader chrome and the vertical Navigation sidebar.
// Panels are full-bleed top — no top chrome strip.
// Maximize/minimize per panel via panelMode in NavigationContext.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { PlatformProvider, usePlatform } from "./context/PlatformContext.jsx";
import { LinksProvider } from "./context/LinksContext.jsx";
import { NeuronsProvider } from "./neurons/NeuronsContext.jsx";
import { RelationshipsProvider } from "./context/RelationshipsContext.jsx";
import { RecordDrawerProvider } from "./features/RecordDrawerContext.jsx";
import { ColorMappingProvider } from "./context/ColorMappingContext.jsx";
import { ThemeProvider, useTheme } from "./context/ThemeContext.jsx";
import { UserSyncProvider, useUserSync } from "./context/UserSyncContext.jsx";
import { ViewportProvider, useViewport } from "./context/ViewportContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import { injectAnimations, injectInteractionStyles, injectScrollbarStyles, updateCSSCustomProperties, ANIM, TRANSITION } from "./design/animations.js";
import { S } from "./design/styles.js";
import { C, Z } from "./design/tokens.js";

import LoginScreen from "./core/LoginScreen.jsx";
// TopHeader and Navigation are retained on disk per CLAUDE.md but are
// no longer mounted — BottomBar replaces both as of 2026-05-08.
import BottomBar from "./core/BottomBar.jsx";
import SearchModal from "./core/SearchModal.jsx";
import SplitPane from "./core/SplitPane.jsx";
import Breadcrumb from "./components/Breadcrumb.jsx";
// Retry wrapper for dynamic imports — handles stale chunk errors after deploy
function lazyWithRetry(importFn) {
  return React.lazy(() =>
    importFn().catch(() => {
      // First retry after brief delay
      return new Promise((resolve) => setTimeout(resolve, 200)).then(() =>
        importFn().catch(() => {
          // Final retry with cache-bust: reload the page
          window.location.reload();
          // Return a never-resolving promise so React doesn't crash before reload
          return new Promise(() => {});
        })
      );
    })
  );
}

const WasabiPanel = lazyWithRetry(() => import("./core/WasabiPanel.jsx"));
import Onboarding from "./core/Onboarding.jsx";
import PageBuilder from "./core/PageBuilder.jsx";
import PageShell from "./core/PageShell.jsx";
import WasabiFlame from "./core/WasabiFlame.jsx";
import WasabiOrb from "./core/WasabiOrb.jsx";
import SystemManager from "./core/SystemManager";
import NotificationFeed from "./views/NotificationFeed.jsx";
import WorkspaceSettings from "./views/WorkspaceSettings.jsx";
import WidgetGrid from "./components/WidgetGrid.jsx";
import { ErrorBoundary } from "./core/ErrorBoundary.jsx";
import { createAutomationEngine } from "./agent/automations.js";
import { getGoogleStatus } from "./lib/api.js";
import { cleanupGoogleNeuronNodes } from "./google/googleNeuronCleanup.js";
import { loadCachedNeurons } from "./neurons/neuronStorage.js";
import { useKeyboardShortcuts } from "./utils/useKeyboardShortcuts.js";
import CommandPalette from "./core/CommandPalette.jsx";
import NeuronOverlay from "./neurons/NeuronOverlay.jsx";
import NeuronLines from "./neurons/NeuronLines.jsx";
import { useNeurons } from "./neurons/NeuronsContext.jsx";
import { IconExpand, IconCollapse } from "./design/icons.jsx";

const TasksView = lazyWithRetry(() => import("./features/TasksView.jsx"));
const NotesView = lazyWithRetry(() => import("./features/NotesView.jsx"));
const DashboardView = lazyWithRetry(() => import("./features/DashboardView.jsx"));
const CalendarView = lazyWithRetry(() => import("./features/CalendarView.jsx"));
// GmailView and OutlookView lazy imports removed 2026-05-04 — UnifiedInboxView replaces both.
// The .jsx files are retained on disk in case they need to be re-enabled.
const UnifiedInboxView = lazyWithRetry(() => import("./features/UnifiedInboxView.jsx"));
const FigmaView = lazyWithRetry(() => import("./features/FigmaView.jsx"));
const WorkspaceBrowser = lazyWithRetry(() => import("./features/WorkspaceBrowser.jsx"));
const KnowledgeHub = lazyWithRetry(() => import("./features/KnowledgeHub.jsx"));

// Inject CSS animations + global interaction styles on app load
injectAnimations();
injectInteractionStyles();
injectScrollbarStyles(C);
updateCSSCustomProperties(C);

// ── One-time localStorage key migration (zen → functional names) ──
(() => {
  try {
    if (localStorage.getItem("wasabi_ls_migrated_v1")) return;
    const migrations = [
      ["wasabi_zen_table_id", "wasabi_tasks_table_id"],
      ["wasabi_zen_insight", "wasabi_insight"],
      ["wasabi-zen-hidden-calendars", "wasabi-hidden-calendars"],
      ["wasabi_zen_ai_tasks_v4", "wasabi_ai_tasks_v4"],
      ["wasabi-zen-dashboard-widgets", "wasabi-dashboard-widgets"],
    ];
    for (const [oldKey, newKey] of migrations) {
      const val = localStorage.getItem(oldKey);
      if (val !== null && localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, val);
      }
      localStorage.removeItem(oldKey);
    }
    // Clean up old versioned cache keys
    localStorage.removeItem("wasabi_zen_ai_tasks");
    localStorage.removeItem("wasabi_zen_ai_tasks_v2");
    localStorage.removeItem("wasabi_zen_ai_tasks_v3");
    localStorage.setItem("wasabi_ls_migrated_v1", "1");
  } catch {}
})();

function AppContent() {
  const {
    isAuthenticated,
    isSetup,
    user,
    platformIds,
    pages,
    activeRightPane,
    setActiveRightPane,
    activeFolder,
    setActiveFolder,
    getFolderPages,
    globalDashboard,
    updatePageConfig,
    identity,
    multiUserEnabled,
    identityLoading,
    // Dual-pane state (Phase 2)
    activeLeftPane,
    setActiveLeftPane,
    splitRatio,
    setSplitRatio,
    panelMode,
    setPanelMode,
  } = usePlatform();

  const { theme, themeName } = useTheme();
  const { toggleOverlay: toggleNeurons } = useNeurons();

  // ── UI State (persisted to localStorage) ──
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewStates, setViewStates] = useState(() => {
    try { const v = localStorage.getItem("wasabi_view_states"); return v ? JSON.parse(v) : {}; } catch { return {}; }
  });
  const [builderTemplate, setBuilderTemplate] = useState(null);
  const [activePageData, setActivePageData] = useState(null); // { data, schema } from PageShell for WasabiPanel chat
  const [pendingChatMessage, setPendingChatMessage] = useState(null); // Scaffold from FunctionBuilder → WasabiPanel

  // ── Viewport detection (shared context) ──
  const { isNarrow, isTablet } = useViewport();

  // ── Persist UI state to localStorage ──
  useEffect(() => { try { localStorage.setItem("wasabi_view_states", JSON.stringify(viewStates)); } catch {} }, [viewStates]);

  // Helper: bring chat into the left pane and ensure it's visible.
  const focusChatInLeftPane = useCallback(() => {
    setActiveLeftPane("chat");
    if (panelMode === "right-max") setPanelMode("split");
  }, [setActiveLeftPane, panelMode, setPanelMode]);

  // ── Multi-device sync: navigation + session revocation ──
  const userSync = useUserSync();
  const isRemoteNavRef = useRef(false);

  // Listen for nav updates from other devices
  useEffect(() => {
    if (!userSync?.onNavUpdate) return;
    return userSync.onNavUpdate((pageId, folderId) => {
      if (pageId && pageId !== activeRightPane) {
        isRemoteNavRef.current = true;
        setActiveRightPane(pageId);
        if (folderId) setActiveFolder(folderId);
      }
    });
  }, [userSync, activeRightPane, setActiveRightPane, setActiveFolder]);

  // Broadcast nav changes to other devices (skip system-internal pages)
  useEffect(() => {
    if (!userSync?.sendNavUpdate || !activeRightPane) return;
    if (isRemoteNavRef.current) {
      isRemoteNavRef.current = false;
      return;
    }
    // Don't broadcast system page IDs — receiving devices would get stuck
    const target = pages.find((p) => p.id === activeRightPane);
    if (target && (target._systemInternal || target.name?.startsWith("User Tasks") || target.name?.startsWith("Zen Tasks"))) return;
    userSync.sendNavUpdate(activeRightPane, activeFolder);
  }, [activeRightPane, activeFolder, userSync, pages]);

  // Handle session revocation (logout from another device)
  useEffect(() => {
    if (!userSync?.onSessionRevoked) return;
    return userSync.onSessionRevoked(() => {
      // Clear auth and redirect to login
      try { localStorage.removeItem("wasabi_jwt"); } catch {}
      window.location.reload();
    });
  }, [userSync]);

  // ── Clear page controls when navigating away ──
  const prevActiveRightPane = useRef(activeRightPane);
  useEffect(() => {
    if (prevActiveRightPane.current !== activeRightPane) {
      setActivePageData(null);
      prevActiveRightPane.current = activeRightPane;
    }
  }, [activeRightPane]);

  // ── Automation Engine ──
  const engineRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated || !isSetup || !user?.workerUrl) return;

    // Create and start the automation engine (works without Notion — reads rules from D1)
    const engine = createAutomationEngine({
      workerUrl: user.workerUrl,
      notionKey: user.notionKey || "",
      claudeKey: user.claudeKey || "",
      tickIntervalMs: 300_000,
      onRuleFired: undefined,
      onError: (err, rule) => {
        console.error(`[Automation] Error${rule ? ` on "${rule.name}"` : ""}:`, err.message);
      },
    });

    engine.start();
    engineRef.current = engine;

    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [isAuthenticated, isSetup, user]);

  // ── Google Neuron Cleanup (background, max once per hour) ──
  useEffect(() => {
    if (!isAuthenticated || !isSetup) return;
    let cancelled = false;
    (async () => {
      try {
        const status = await getGoogleStatus();
        if (cancelled || !status?.connected) return;
        const neurons = loadCachedNeurons();
        await cleanupGoogleNeuronNodes(neurons);
      } catch (err) { console.warn("[App] Google neuron cleanup:", err.message || err); }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, isSetup]);

  const handleAddPage = useCallback(() => {
    setBuilderTemplate(null);
    setActiveRightPane("wasabi");
  }, [setActiveRightPane]);

  // ── Keyboard Shortcuts ──
  useKeyboardShortcuts([
    {
      shortcut: "mod+k",
      description: "Command palette",
      handler: () => setCommandPaletteOpen((o) => !o),
    },
    {
      shortcut: "mod+n",
      description: "New page",
      handler: () => handleAddPage(),
    },
    {
      shortcut: "mod+b",
      description: "Toggle search modal",
      handler: () => setSearchOpen((o) => !o),
    },
    {
      shortcut: "mod+.",
      description: "Open Wasabi Chat (left pane)",
      handler: () => {
        if (identity?.role === "viewer") return;
        focusChatInLeftPane();
      },
    },
    {
      shortcut: "mod+i",
      description: "Inbox",
      handler: () => setActiveRightPane("inbox"),
    },
    {
      shortcut: "mod+j",
      description: "Toggle Neurons overlay",
      handler: () => { toggleNeurons(); },
    },
    {
      shortcut: "mod+h",
      description: "Home",
      handler: () => setActiveRightPane(null),
    },
    {
      shortcut: "mod+up",
      description: "Previous page",
      handler: () => {
        const folderPages = activeFolder ? getFolderPages(activeFolder) : pages.filter((p) => p.type !== "folder");
        const idx = folderPages.findIndex((p) => p.id === activeRightPane);
        if (idx > 0) setActiveRightPane(folderPages[idx - 1].id);
      },
    },
    {
      shortcut: "mod+down",
      description: "Next page",
      handler: () => {
        const folderPages = activeFolder ? getFolderPages(activeFolder) : pages.filter((p) => p.type !== "folder");
        const idx = folderPages.findIndex((p) => p.id === activeRightPane);
        if (idx < folderPages.length - 1) setActiveRightPane(folderPages[idx + 1].id);
      },
    },
  ], [handleAddPage, focusChatInLeftPane, activeRightPane, pages, activeFolder, getFolderPages, toggleNeurons, setActiveRightPane, identity, setSearchOpen]);

  // Auth gate is now in PlatformContext (AuthGate component).
  // AppContent only renders when isAuthenticated is true.

  // Find active page config
  const activePageConfig = pages.find((p) => p.id === activeRightPane);

  // Get/set active view for current page
  const activeViewIndex = activePageConfig
    ? viewStates[activePageConfig.id] ?? 0
    : activeRightPane === "automations"
    ? viewStates["automations"] ?? 0
    : 0;

  const setActiveView = (idx) => {
    if (activePageConfig) {
      setViewStates((prev) => ({ ...prev, [activePageConfig.id]: idx }));
    } else if (activeRightPane === "automations") {
      setViewStates((prev) => ({ ...prev, automations: idx }));
    }
  };

  // Orb icon for chat avatars
  const WasabiFlameIcon = <WasabiOrb size={28} />;

  // ── Panel maximize/minimize toggle (floating button per panel) ──
  const toggleLeftMax = useCallback(() => {
    setPanelMode(panelMode === "left-max" ? "split" : "left-max");
  }, [panelMode, setPanelMode]);
  const toggleRightMax = useCallback(() => {
    setPanelMode(panelMode === "right-max" ? "split" : "right-max");
  }, [panelMode, setPanelMode]);

  // ── Left pane: Tasks / Wasabi Chat / Notes (personal context surface) ──
  const renderLeftPane = () => {
    if (activeLeftPane === "chat") {
      // Viewers can't access chat — fall through to tasks instead.
      if (identity?.role === "viewer") {
        return (
          <ErrorBoundary fallbackLabel="Tasks">
            <React.Suspense fallback={
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
                Loading...
              </div>
            }>
              <TasksView />
            </React.Suspense>
          </ErrorBoundary>
        );
      }
      return (
        <ErrorBoundary fallbackLabel="Wasabi Chat">
          <React.Suspense fallback={
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
              Loading...
            </div>
          }>
            <WasabiPanel
              embedded
              activePageConfig={activePageConfig}
              activePageData={activePageData}
              pendingChatMessage={pendingChatMessage}
              onClearPendingMessage={() => setPendingChatMessage(null)}
            />
          </React.Suspense>
        </ErrorBoundary>
      );
    }
    if (activeLeftPane === "notes") {
      return (
        <ErrorBoundary fallbackLabel="Notes">
          <React.Suspense fallback={
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 12 }}>
              Loading...
            </div>
          }>
            <NotesView />
          </React.Suspense>
        </ErrorBoundary>
      );
    }
    // Default: tasks
    return (
      <ErrorBoundary fallbackLabel="Tasks">
        <React.Suspense fallback={
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
            Loading...
          </div>
        }>
          <TasksView />
        </React.Suspense>
      </ErrorBoundary>
    );
  };

  // ── Right pane: workspace content (everything else) ──
  const renderRightPane = () => {
    // System settings
    if (activeRightPane === "system") {
      return <SystemManager />;
    }
    // Page builder (create new page)
    if (activeRightPane === "wasabi") {
      return (
        <PageBuilder
          initialTemplate={builderTemplate}
          WasabiFlameIcon={WasabiFlameIcon}
          defaultParentId={activeFolder}
        />
      );
    }
    // Calendar (standalone right-pane destination, lifted out of TasksView)
    if (activeRightPane === "calendar") {
      return (
        <ErrorBoundary fallbackLabel="Calendar">
          <React.Suspense fallback={
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
              Loading...
            </div>
          }>
            <CalendarView />
          </React.Suspense>
        </ErrorBoundary>
      );
    }
    // Dashboard
    if (activeRightPane === "dashboard") {
      return (
        <ErrorBoundary fallbackLabel="Dashboard">
          <React.Suspense fallback={
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
              Loading...
            </div>
          }>
            <DashboardView key={identity?.id || "default"} />
          </React.Suspense>
        </ErrorBoundary>
      );
    }
    // Legacy "gmail" / "outlook" routes redirect to the unified inbox.
    if (activeRightPane === "gmail" || activeRightPane === "outlook" || activeRightPane === "inbox-unified") {
      return (
        <ErrorBoundary fallbackLabel="Inbox">
          <React.Suspense fallback={
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
              Loading...
            </div>
          }>
            <UnifiedInboxView />
          </React.Suspense>
        </ErrorBoundary>
      );
    }
    // Figma
    if (activeRightPane === "figma") {
      return (
        <ErrorBoundary fallbackLabel="Figma">
          <React.Suspense fallback={
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
              Loading...
            </div>
          }>
            <FigmaView />
          </React.Suspense>
        </ErrorBoundary>
      );
    }
    // Workspaces browser
    if (activeRightPane === "workspaces") {
      return (
        <ErrorBoundary fallbackLabel="Workspaces">
          <React.Suspense fallback={
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
              Loading...
            </div>
          }>
            <WorkspaceBrowser />
          </React.Suspense>
        </ErrorBoundary>
      );
    }
    // Knowledge Hub
    if (activeRightPane === "knowledge") {
      return (
        <ErrorBoundary fallbackLabel="Knowledge Hub">
          <React.Suspense fallback={
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
              Loading...
            </div>
          }>
            <KnowledgeHub onOpenChat={(msg) => { setPendingChatMessage(msg); focusChatInLeftPane(); }} />
          </React.Suspense>
        </ErrorBoundary>
      );
    }
    // Notifications
    if (activeRightPane === "notifications") {
      return <NotificationFeed />;
    }
    // Workspace settings page
    if (activePageConfig && (activePageConfig.pageType === "workspace" || activePageConfig.page_type === "workspace")) {
      return (
        <WorkspaceSettings
          pageConfig={activePageConfig}
          onUpdate={(updates) => updatePageConfig(activePageConfig.id, updates)}
        />
      );
    }
    // Folders redirect to workspaces browser
    if (activePageConfig && activePageConfig.type === "folder") {
      setActiveRightPane("workspaces");
      return null;
    }
    // Dashboard pages → render WidgetGrid directly
    if (activePageConfig && (activePageConfig.page_type === "dashboard" || activePageConfig.pageType === "dashboard")) {
      return (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "transparent" }}>
          <WidgetGrid
            widgets={activePageConfig.widgets || []}
            onUpdateWidgets={(widgets) => updatePageConfig(activePageConfig.id, { widgets })}
          />
        </div>
      );
    }
    // User page (full PageShell with views, CRUD, etc.)
    if (activePageConfig) {
      return (
        <PageShell
          pageConfig={activePageConfig}
          activeViewIndex={activeViewIndex}
          onSetActiveView={setActiveView}
          onPageDataReady={setActivePageData}
        />
      );
    }
    // Default for an empty/unknown right-pane route → Dashboard.
    return (
      <ErrorBoundary fallbackLabel="Dashboard">
        <React.Suspense fallback={
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
            Loading...
          </div>
        }>
          <DashboardView key={identity?.id || "default"} />
        </React.Suspense>
      </ErrorBoundary>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        fontFamily: "'Outfit','DM Sans',sans-serif",
        color: C.darkText,
        background: C.bgGradient,
        overflow: "hidden",
      }}
    >
      {/* ── Command Palette ── */}
      {commandPaletteOpen && (
        <CommandPalette
          open={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          pages={pages}
          activeRightPane={activeRightPane}
          setActiveRightPane={(id) => { setActiveRightPane(id); setCommandPaletteOpen(false); }}
          setActiveLeftPane={(p) => { setActiveLeftPane(p); if (panelMode === "right-max") setPanelMode("split"); setCommandPaletteOpen(false); }}
          onAddPage={() => { handleAddPage(); setCommandPaletteOpen(false); }}
        />
      )}

      {/* ── Search Modal (opened by ⌘B and the bottom-bar search button) ── */}
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
      />

      {/* ── Neuron Overlay (glass pane for selection mode) ── */}
      <NeuronOverlay />
      <NeuronLines />

      {/* ── Main canvas: full-bleed SplitPane (top header removed) ── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          position: "relative",
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <SplitPane
          isNarrow={isNarrow}
          ratio={splitRatio}
          onRatioChange={setSplitRatio}
          panelMode={panelMode}
          onPanelModeChange={setPanelMode}
          leftContent={
            <div
              key={`${activeLeftPane}-${themeName}`}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                minWidth: 0,
                animation: ANIM.contentSwap(),
                opacity: 1,
                position: "relative",
              }}
            >
              {/* Chrome strip — empty content (left pane uses each
                  feature's own internal title), but matches the right
                  pane's height so the two panels feel aligned. The
                  maximize toggle lives at the right edge so it never
                  overlaps with feature header buttons. */}
              {!isNarrow && (
                <div style={paneChromeStripStyle}>
                  <PanelMaxButton
                    side="left"
                    isMaxed={panelMode === "left-max"}
                    onToggle={toggleLeftMax}
                  />
                </div>
              )}
              {renderLeftPane()}
            </div>
          }
          rightContent={
            <div
              key={`${activeRightPane || "__home__"}-${themeName}`}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                minWidth: 0,
                animation: ANIM.contentSwap(),
                opacity: 1,
                position: "relative",
              }}
            >
              {/* Chrome strip — breadcrumb on the left, maximize toggle
                  on the right. Persists across all right-pane routes so
                  navigation back from a database page is one click. */}
              {!isNarrow && (
                <div style={paneChromeStripStyle}>
                  <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                    <Breadcrumb />
                  </div>
                  <PanelMaxButton
                    side="right"
                    isMaxed={panelMode === "right-max"}
                    onToggle={toggleRightMax}
                  />
                </div>
              )}
              {renderRightPane()}
            </div>
          }
        />
      </div>

      {/* ── Bottom navigation bar (replaces TopHeader + Sidebar) ── */}
      <BottomBar
        isThinking={false}
        onCreatePage={handleAddPage}
        onSearchClick={() => setSearchOpen(true)}
      />
    </div>
  );
}

// Chrome strip at the top of each pane — holds the breadcrumb (right
// pane) and the maximize button (both panes). Both panes use the same
// strip so their content vertically aligns.
const paneChromeStripStyle = {
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "20px 18px 8px 28px",
  minHeight: 52,
};

// ─── PanelMaxButton ───
// Inline button rendered inside each pane's chrome strip. Hover state
// surfaces a subtle background so it reads as chrome, not feature
// content.
function PanelMaxButton({ side, isMaxed, onToggle }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onToggle}
      title={isMaxed ? "Restore split view" : `Maximize ${side === "left" ? "left" : "right"} panel`}
      aria-label={isMaxed ? "Restore split view" : `Maximize ${side} panel`}
      style={{
        flexShrink: 0,
        width: 30,
        height: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: hover ? C.darkSurf2 : "transparent",
        border: `1px solid ${hover ? C.darkBorder : "transparent"}`,
        borderRadius: 8,
        cursor: "pointer",
        transition: "background 0.15s, border-color 0.15s, opacity 0.15s",
        opacity: hover ? 1 : 0.55,
        outline: "none",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {isMaxed ? (
        <IconCollapse size={15} color={C.darkMuted} />
      ) : (
        <IconExpand size={15} color={C.darkMuted} />
      )}
    </button>
  );
}

export default function App() {
  return (
    <ViewportProvider>
      <ThemeProvider>
        <ToastProvider>
        <PlatformProvider>
          <UserSyncProvider>
            <ColorMappingProvider>
              <LinksProvider>
                <NeuronsProvider>
                  <RelationshipsProvider>
                    <RecordDrawerProvider>
                      <ErrorBoundary fallbackLabel="Wasabi Platform">
                        <AppContent />
                      </ErrorBoundary>
                    </RecordDrawerProvider>
                  </RelationshipsProvider>
                </NeuronsProvider>
              </LinksProvider>
            </ColorMappingProvider>
          </UserSyncProvider>
        </PlatformProvider>
        </ToastProvider>
      </ThemeProvider>
    </ViewportProvider>
  );
}
