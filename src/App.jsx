// ─── Wasabi Platform App Shell ───
// Root component: auth gate → layout → routing.
// Layout: TopHeader + [SashimiChatPanel | Sidebar | Content]
// Top header: WASABI wordmark + page-level controls (right side).
// Sidebar: Icon-bar navigation, expandable.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { PlatformProvider, usePlatform } from "./context/PlatformContext.jsx";
import { LinksProvider } from "./context/LinksContext.jsx";
import { NeuronsProvider } from "./neurons/NeuronsContext.jsx";
import { SashimiDrawerProvider } from "./zen/SashimiDrawerContext.jsx";
import { ColorMappingProvider } from "./context/ColorMappingContext.jsx";
import { ThemeProvider, useTheme } from "./context/ThemeContext.jsx";
import { injectAnimations, ANIM, TRANSITION } from "./design/animations.js";
import { S } from "./design/styles.js";
import { C } from "./design/tokens.js";

import SetupWizard from "./core/SetupWizard.jsx";
import TopHeader from "./core/TopHeader.jsx";
import Navigation from "./core/Navigation.jsx";
const SashimiChatPanel = React.lazy(() => import("./zen/SashimiChatPanel.jsx"));
import Onboarding from "./core/Onboarding.jsx";
import PageBuilder from "./core/PageBuilder.jsx";
import PageShell from "./core/PageShell.jsx";
import WasabiFlame from "./core/WasabiFlame.jsx";
import WasabiOrb from "./core/WasabiOrb.jsx";
import SystemManager from "./core/SystemManager.jsx";
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
import { IconGear } from "./design/icons.jsx";

const ZenTasksView = React.lazy(() => import("./zen/ZenTasksView.jsx"));
const ZenNotes = React.lazy(() => import("./zen/ZenNotes.jsx"));
const ZenDashboard = React.lazy(() => import("./zen/ZenDashboard.jsx"));
const ZenGmail = React.lazy(() => import("./zen/ZenGmail.jsx"));
const ZenWorkspaces = React.lazy(() => import("./zen/ZenWorkspaces.jsx"));
const ZenKnowledgeHub = React.lazy(() => import("./zen/ZenKnowledgeHub.jsx"));

// Inject CSS animations on app load
injectAnimations();

function AppContent() {
  const {
    isAuthenticated,
    isSetup,
    user,
    platformIds,
    pages,
    activePage,
    setActivePage,
    activeFolder,
    setActiveFolder,
    getFolderPages,
    globalDashboard,
    updatePageConfig,
  } = usePlatform();

  const { theme, themeName } = useTheme();
  const { toggleOverlay: toggleNeurons } = useNeurons();

  // ── UI State (persisted to localStorage) ──
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { const v = localStorage.getItem("wasabi_sidebar_collapsed"); return v !== null ? JSON.parse(v) : true; } catch { return true; }
  });
  const [wasabiPanelOpen, setWasabiPanelOpen] = useState(() => {
    try { const v = localStorage.getItem("wasabi_panel_open"); return v !== null ? JSON.parse(v) : false; } catch { return false; }
  });
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [viewStates, setViewStates] = useState(() => {
    try { const v = localStorage.getItem("wasabi_view_states"); return v ? JSON.parse(v) : {}; } catch { return {}; }
  });
  const [builderTemplate, setBuilderTemplate] = useState(null);
  const [activePageData, setActivePageData] = useState(null); // { data, schema } from PageShell for WasabiPanel chat
  const [pendingChatMessage, setPendingChatMessage] = useState(null); // Scaffold from FunctionBuilder → WasabiPanel

  // ── Narrow viewport detection (tablet / iPad) ──
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 1024);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const handler = (e) => {
      setIsNarrow(e.matches);
      if (e.matches) setSidebarCollapsed(true);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // ── Persist UI state to localStorage ──
  useEffect(() => { try { localStorage.setItem("wasabi_sidebar_collapsed", JSON.stringify(sidebarCollapsed)); } catch {} }, [sidebarCollapsed]);
  useEffect(() => { try { localStorage.setItem("wasabi_panel_open", JSON.stringify(wasabiPanelOpen)); } catch {} }, [wasabiPanelOpen]);
  useEffect(() => { try { localStorage.setItem("wasabi_view_states", JSON.stringify(viewStates)); } catch {} }, [viewStates]);

  // ── Clear page controls when navigating away ──
  const prevActivePage = useRef(activePage);
  useEffect(() => {
    if (prevActivePage.current !== activePage) {
      setActivePageData(null);
      prevActivePage.current = activePage;
    }
  }, [activePage]);

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
      onRuleFired: (rule, result) => {
        console.log(`[Automation] Rule "${rule.name}" fired (${result.path})`);
      },
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
      } catch (_) { /* best effort */ }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, isSetup]);

  const handleAddPage = useCallback(() => {
    setBuilderTemplate(null);
    setActivePage("wasabi");
  }, [setActivePage]);

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
      description: "Toggle sidebar",
      handler: () => setSidebarCollapsed((c) => !c),
    },
    {
      shortcut: "mod+.",
      description: "Toggle Wasabi panel",
      handler: () => setWasabiPanelOpen((o) => !o),
    },
    {
      shortcut: "mod+i",
      description: "Inbox",
      handler: () => setActivePage("inbox"),
    },
    {
      shortcut: "escape",
      description: "Close Wasabi panel",
      handler: () => {
        if (wasabiPanelOpen) setWasabiPanelOpen(false);
      },
      when: () => wasabiPanelOpen,
    },
    {
      shortcut: "mod+j",
      description: "Toggle Neurons overlay",
      handler: () => { toggleNeurons(); },
    },
    {
      shortcut: "mod+h",
      description: "Home",
      handler: () => setActivePage(null),
    },
    {
      shortcut: "mod+up",
      description: "Previous page",
      handler: () => {
        const folderPages = activeFolder ? getFolderPages(activeFolder) : pages.filter((p) => p.type !== "folder");
        const idx = folderPages.findIndex((p) => p.id === activePage);
        if (idx > 0) setActivePage(folderPages[idx - 1].id);
      },
    },
    {
      shortcut: "mod+down",
      description: "Next page",
      handler: () => {
        const folderPages = activeFolder ? getFolderPages(activeFolder) : pages.filter((p) => p.type !== "folder");
        const idx = folderPages.findIndex((p) => p.id === activePage);
        if (idx < folderPages.length - 1) setActivePage(folderPages[idx + 1].id);
      },
    },
  ], [handleAddPage, wasabiPanelOpen, activePage, pages, activeFolder, getFolderPages, toggleNeurons, setActivePage]);

  // Auth gate: show setup wizard if not connected
  if (!isAuthenticated || !isSetup) {
    return <SetupWizard />;
  }

  // Find active page config
  const activePageConfig = pages.find((p) => p.id === activePage);

  // Get/set active view for current page
  const activeViewIndex = activePageConfig
    ? viewStates[activePageConfig.id] ?? 0
    : activePage === "automations"
    ? viewStates["automations"] ?? 0
    : 0;

  const setActiveView = (idx) => {
    if (activePageConfig) {
      setViewStates((prev) => ({ ...prev, [activePageConfig.id]: idx }));
    } else if (activePage === "automations") {
      setViewStates((prev) => ({ ...prev, automations: idx }));
    }
  };

  // Sidebar width for gradient bridge line positioning
  const sidebarW = sidebarCollapsed ? 54 : 220;
  const panelW = wasabiPanelOpen ? 320 : 0;

  // Orb icon for chat avatars
  const WasabiFlameIcon = <WasabiOrb size={28} />;

  // Determine main content
  const renderContent = () => {
    // System settings
    if (activePage === "system") {
      return <SystemManager />;
    }
    // Page builder (create new page)
    if (activePage === "wasabi") {
      return (
        <PageBuilder
          initialTemplate={builderTemplate}
          WasabiFlameIcon={WasabiFlameIcon}
          defaultParentId={activeFolder}
        />
      );
    }
    // Notes scratchpad
    if (activePage === "zen-notes") {
      return (
        <React.Suspense fallback={
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 12 }}>
            Loading...
          </div>
        }>
          <ZenNotes />
        </React.Suspense>
      );
    }
    // Dashboard
    if (activePage === "zen-dashboard") {
      return (
        <React.Suspense fallback={
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
            Loading...
          </div>
        }>
          <ZenDashboard />
        </React.Suspense>
      );
    }
    // Gmail
    if (activePage === "zen-gmail") {
      return (
        <ErrorBoundary fallbackLabel="Gmail">
          <React.Suspense fallback={
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
              Loading...
            </div>
          }>
            <ZenGmail />
          </React.Suspense>
        </ErrorBoundary>
      );
    }
    // Workspaces browser
    if (activePage === "zen-workspaces") {
      return (
        <React.Suspense fallback={
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
            Loading...
          </div>
        }>
          <ZenWorkspaces />
        </React.Suspense>
      );
    }
    // Knowledge Hub (KB, Automations, Functions, Build)
    if (activePage === "zen-knowledge") {
      return (
        <React.Suspense fallback={
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
            Loading...
          </div>
        }>
          <ZenKnowledgeHub />
        </React.Suspense>
      );
    }
    // Notifications
    if (activePage === "zen-notifications") {
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
      setActivePage("zen-workspaces");
      return null;
    }
    // Dashboard pages → render WidgetGrid directly
    if (activePageConfig && (activePageConfig.page_type === "dashboard" || activePageConfig.pageType === "dashboard")) {
      return (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: C.dark }}>
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
    // Default: Tasks split view (To-Do + Calendar)
    return (
      <React.Suspense fallback={
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
          Loading...
        </div>
      }>
        <ZenTasksView />
      </React.Suspense>
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
        background: C.dark,
        overflow: "hidden",
      }}
    >
      {/* ── Command Palette ── */}
      {commandPaletteOpen && (
        <CommandPalette
          open={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          pages={pages}
          activePage={activePage}
          setActivePage={(id) => { setActivePage(id); setCommandPaletteOpen(false); }}
          onAddPage={() => { handleAddPage(); setCommandPaletteOpen(false); }}
        />
      )}

      {/* ── Top Header Bar ── */}
      <TopHeader />

      {/* ── Neuron Overlay (glass pane for selection mode) ── */}
      <NeuronOverlay />
      <NeuronLines />

      {/* ── Main Row: [Wasabi Panel] [Sidebar] [Content] ── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Wasabi Panel (inline on desktop, overlay on narrow viewports) */}
        {wasabiPanelOpen && !isNarrow && (
          <div style={{
            animation: ANIM.snapInLeft(0.02),
            display: "flex",
            flexShrink: 0,
            borderRight: `1px solid ${C.edgeLine}`,
          }}>
            <React.Suspense fallback={null}>
              <SashimiChatPanel
                onClose={() => setWasabiPanelOpen(false)}
                activePageConfig={activePageConfig}
                activePageData={activePageData}
                pendingChatMessage={pendingChatMessage}
                onClearPendingMessage={() => setPendingChatMessage(null)}
              />
            </React.Suspense>
          </div>
        )}
        {wasabiPanelOpen && isNarrow && (
          <>
            {/* Backdrop */}
            <div
              onClick={() => setWasabiPanelOpen(false)}
              style={{
                position: "fixed", inset: 0,
                background: "rgba(0,0,0,0.5)",
                zIndex: 900,
                animation: ANIM.backdropFade,
              }}
            />
            {/* Overlay panel */}
            <div style={{
              position: "fixed", top: 0, left: 0, bottom: 0,
              width: "min(320px, 85vw)",
              zIndex: 901,
              display: "flex",
              paddingTop: "env(safe-area-inset-top, 0px)",
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
              animation: ANIM.drawerSlideLeft,
            }}>
              <React.Suspense fallback={null}>
                <SashimiChatPanel
                  onClose={() => setWasabiPanelOpen(false)}
                  activePageConfig={activePageConfig}
                  activePageData={activePageData}
                  pendingChatMessage={pendingChatMessage}
                  onClearPendingMessage={() => setPendingChatMessage(null)}
                />
              </React.Suspense>
            </div>
          </>
        )}

        {/* Gradient bridge line between sidebar and content */}
        <div
          style={{
            position: "absolute",
            left: panelW + sidebarW,
            top: 0,
            bottom: 0,
            width: 1,
            zIndex: 1,
            pointerEvents: "none",
            background: `linear-gradient(180deg, ${C.edgeLine}00 0%, ${C.edgeLine} 20%, ${C.accent}44 40%, ${C.accent}55 60%, ${C.edgeLine} 85%, ${C.edgeLine}00 100%)`,
            transition: "left 0.32s cubic-bezier(0.25, 1, 0.5, 1)",
          }}
        />

        {/* Left Sidebar */}
        <Navigation
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          onExpandSidebar={() => setSidebarCollapsed(false)}
          wasabiPanelOpen={wasabiPanelOpen}
          onToggleWasabiPanel={() => setWasabiPanelOpen((o) => !o)}
          isThinking={false}
          onCreatePage={handleAddPage}
          viewStates={viewStates}
          onSetViewForPage={(pageId, viewIdx) => setViewStates((prev) => ({ ...prev, [pageId]: viewIdx }))}
        />

        {/* Main Content */}
        <div
          key={`${activePage || "__home__"}-${themeName}`}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 0,
            animation: ANIM.contentSwap(),
            opacity: 1,
          }}
        >
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <PlatformProvider>
        <ColorMappingProvider>
          <LinksProvider>
            <NeuronsProvider>
              <SashimiDrawerProvider>
                <ErrorBoundary fallbackLabel="Wasabi Platform">
                  <AppContent />
                </ErrorBoundary>
              </SashimiDrawerProvider>
            </NeuronsProvider>
          </LinksProvider>
        </ColorMappingProvider>
      </PlatformProvider>
    </ThemeProvider>
  );
}
