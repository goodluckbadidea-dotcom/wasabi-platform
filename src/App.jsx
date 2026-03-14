// ─── Wasabi Platform App Shell ───
// Root component: auth gate → layout → routing.
// Layout: TopHeader + [WasabiPanel | Sidebar | Content]
// Top header: WASABI wordmark + page-level controls (right side).
// Sidebar: FolderDropdown at top, page list, bottom actions.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { PlatformProvider, usePlatform } from "./context/PlatformContext.jsx";
import { LinksProvider } from "./context/LinksContext.jsx";
import { NeuronsProvider } from "./neurons/NeuronsContext.jsx";
import { ThemeProvider, useTheme } from "./context/ThemeContext.jsx";
import { injectAnimations, ANIM, TRANSITION } from "./design/animations.js";
import { S } from "./design/styles.js";
import { C } from "./design/tokens.js";

import SetupWizard from "./core/SetupWizard.jsx";
import TopHeader from "./core/TopHeader.jsx";
import Navigation from "./core/Navigation.jsx";
import WasabiPanel from "./core/WasabiPanel.jsx";
const ZenChatPanel = React.lazy(() => import("./zen/ZenChatPanel.jsx"));
import Onboarding from "./core/Onboarding.jsx";
import PageBuilder from "./core/PageBuilder.jsx";
import PageShell from "./core/PageShell.jsx";
import WasabiFlame from "./core/WasabiFlame.jsx";
import WasabiOrb from "./core/WasabiOrb.jsx";
import SystemManager from "./core/SystemManager.jsx";
import KnowledgeBase from "./core/KnowledgeBase.jsx";
import AutomationPage from "./core/AutomationPage.jsx";
import NotificationFeed from "./views/NotificationFeed.jsx";
import GmailView from "./views/GmailView.jsx";
import CalendarView from "./views/CalendarView.jsx";
import HomePage from "./core/HomePage.jsx";
import Dashboard from "./core/Dashboard.jsx";
import WorkspaceSettings from "./views/WorkspaceSettings.jsx";
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

const FunctionsPanel = React.lazy(() => import("./core/FunctionsPanel.jsx"));
const BuildPage = React.lazy(() => import("./core/BuildPage.jsx"));
const ZenTasksView = React.lazy(() => import("./zen/ZenTasksView.jsx"));

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

  const { theme, appMode } = useTheme();
  const { toggleOverlay: toggleNeurons } = useNeurons();

  // ── UI State ──
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [wasabiPanelOpen, setWasabiPanelOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [viewStates, setViewStates] = useState({}); // { [pageId]: activeViewIndex }
  const [builderTemplate, setBuilderTemplate] = useState(null);
  const [activePageData, setActivePageData] = useState(null); // { data, schema } from PageShell for WasabiPanel chat
  const [pendingChatMessage, setPendingChatMessage] = useState(null); // Scaffold from FunctionBuilder → WasabiPanel

  // ── Mode transition fade ──
  const [modeTransitioning, setModeTransitioning] = useState(false);
  const prevAppMode = useRef(appMode);
  useEffect(() => {
    if (prevAppMode.current !== appMode) {
      setModeTransitioning(true);
      const timer = setTimeout(() => setModeTransitioning(false), 200);
      prevAppMode.current = appMode;
      return () => clearTimeout(timer);
    }
  }, [appMode]);

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

  // Template selection handler — hooks MUST be called before any early returns
  const handleStartTemplate = useCallback(
    (template) => {
      setBuilderTemplate(template);
      setActivePage("wasabi");
    },
    [setActivePage]
  );

  const handleStartBlank = useCallback(() => {
    setBuilderTemplate(null);
    setActivePage("wasabi");
  }, [setActivePage]);

  const handleAddPage = useCallback(() => {
    setBuilderTemplate(null);
    setActivePage("wasabi");
  }, [setActivePage]);

  // Chat handoff from FunctionsPanel / FunctionBuilder
  const handleFunctionChat = useCallback((message) => {
    setPendingChatMessage(message);
    setWasabiPanelOpen(true);
  }, []);

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
      handler: () => toggleNeurons(),
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
  const sidebarW = sidebarCollapsed ? 48 : 220;
  const panelW = wasabiPanelOpen ? 320 : 0;

  // Orb icon for chat avatars
  const WasabiFlameIcon = <WasabiOrb size={28} />;

  // Determine main content
  const renderContent = () => {
    // ── Zen mode routing ──
    if (appMode === "zen") {
      // System settings is shared between modes
      if (activePage === "system") {
        return <SystemManager />;
      }
      // Notes placeholder
      if (activePage === "zen-notes") {
        return (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            gap: 12, color: C.darkMuted, fontFamily: "'Outfit',sans-serif",
          }}>
            <svg width="32" height="32" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.4 }}>
              <rect x="3" y="2" width="10" height="12" rx="1.5" stroke={C.darkMuted} strokeWidth="1.3" fill="none" />
              <line x1="5.5" y1="5.5" x2="10.5" y2="5.5" stroke={C.darkMuted} strokeWidth="1" />
              <line x1="5.5" y1="8" x2="10.5" y2="8" stroke={C.darkMuted} strokeWidth="1" />
              <line x1="5.5" y1="10.5" x2="8.5" y2="10.5" stroke={C.darkMuted} strokeWidth="1" />
            </svg>
            <span style={{ fontSize: 14, fontWeight: 500 }}>Notes</span>
            <span style={{ fontSize: 11, opacity: 0.6 }}>Coming soon</span>
          </div>
        );
      }
      // Default: Zen Tasks split view (To-Do + Today's Schedule)
      return (
        <React.Suspense fallback={
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
            Loading...
          </div>
        }>
          <ZenTasksView />
        </React.Suspense>
      );
    }

    // ── Samurai mode routing (existing) ──

    // Wasabi page builder
    if (activePage === "wasabi") {
      return (
        <PageBuilder
          initialTemplate={builderTemplate}
          WasabiFlameIcon={WasabiFlameIcon}
        />
      );
    }

    // Global dashboard → redirect to home (widget grid is now in HomePage)
    if (activePage === "dashboard") {
      setActivePage(null);
      return null;
    }

    // Dashboard page type (folder-level dashboards)
    if (activePageConfig && (activePageConfig.page_type === "dashboard" || activePageConfig.pageType === "dashboard")) {
      return (
        <Dashboard
          dashboardConfig={activePageConfig}
          isGlobal={!!activePageConfig.isGlobal}
        />
      );
    }

    // Automations (sub-view tabs: Node Editor, Simple Rules, Upload)
    if (activePage === "automations") {
      return <AutomationPage automationEngine={engineRef.current} activeTab={activeViewIndex} />;
    }

    // Functions (custom data transforms)
    if (activePage === "functions") {
      return (
        <React.Suspense fallback={<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>Loading Functions...</div>}>
          <FunctionsPanel onOpenChat={handleFunctionChat} />
        </React.Suspense>
      );
    }

    // Inbox (Notification Feed)
    if (activePage === "inbox") {
      return <NotificationFeed />;
    }

    // Knowledge Base
    if (activePage === "knowledge-base") {
      return <KnowledgeBase automationEngine={engineRef.current} />;
    }

    // Gmail
    if (activePage === "gmail") {
      return <GmailView />;
    }

    // Calendar
    if (activePage === "calendar") {
      return <CalendarView />;
    }

    // Build (Custom Views + Plugins)
    if (activePage === "build") {
      return (
        <React.Suspense fallback={<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>Loading Build...</div>}>
          <BuildPage onOpenChat={handleFunctionChat} />
        </React.Suspense>
      );
    }

    // System manager
    if (activePage === "system") {
      return <SystemManager />;
    }

    // Workspace pages render settings view
    if (activePageConfig && (activePageConfig.page_type === "workspace" || activePageConfig.pageType === "workspace")) {
      return (
        <WorkspaceSettings
          pageConfig={activePageConfig}
          onUpdate={(updates) => updatePageConfig(activePageConfig.id, updates)}
        />
      );
    }

    // Folders are not pages — redirect to home
    if (activePageConfig && activePageConfig.type === "folder") {
      setActivePage(null);
      setActiveFolder(activePageConfig.id);
      return null;
    }

    // User page
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

    // Home page (default for all other cases, including null/home)
    // Shows onboarding-style quick start when no pages exist,
    // and full dashboard when pages are present.
    return (
      <HomePage
        onStartBlank={handleStartBlank}
        onStartTemplate={handleStartTemplate}
        onNavigate={setActivePage}
      />
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
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
        {/* Wasabi Panel (collapsible, left of sidebar) */}
        {wasabiPanelOpen && (
          <div style={{
            animation: ANIM.snapInLeft(0.02),
            display: "flex",
            flexShrink: 0,
          }}>
            {appMode === "zen" ? (
              <React.Suspense fallback={null}>
                <ZenChatPanel onClose={() => setWasabiPanelOpen(false)} />
              </React.Suspense>
            ) : (
              <WasabiPanel
                onClose={() => setWasabiPanelOpen(false)}
                isThinking={false}
                activePageConfig={activePageConfig}
                activePageData={activePageData}
                pendingChatMessage={pendingChatMessage}
                onClearPendingMessage={() => setPendingChatMessage(null)}
              />
            )}
          </div>
        )}

        {/* Gradient bridge line between sidebar and content */}
        {!wasabiPanelOpen && (
          <div
            style={{
              position: "absolute",
              left: sidebarW,
              top: 0,
              bottom: 0,
              width: 1,
              zIndex: 1,
              pointerEvents: "none",
              background: `linear-gradient(180deg, ${C.edgeLine}00 0%, ${C.edgeLine} 20%, ${C.accent}44 40%, ${C.accent}55 60%, ${C.edgeLine} 85%, ${C.edgeLine}00 100%)`,
              transition: "left 0.32s cubic-bezier(0.25, 1, 0.5, 1)",
            }}
          />
        )}

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
          key={activePage || "__home__"}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 0,
            animation: ANIM.contentSwap(),
            opacity: modeTransitioning ? 0 : 1,
            transition: "opacity 0.2s ease",
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
        <LinksProvider>
          <NeuronsProvider>
            <ErrorBoundary fallbackLabel="Wasabi Platform">
              <AppContent />
            </ErrorBoundary>
          </NeuronsProvider>
        </LinksProvider>
      </PlatformProvider>
    </ThemeProvider>
  );
}
