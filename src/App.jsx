// ─── Wasabi Platform App Shell ───
// Root component: auth gate → layout → routing.
// Layout: TopHeader + [WasabiPanel | Sidebar | Content]
// Top header: WASABI wordmark + page-level controls (right side).
// Sidebar: FolderDropdown at top, page list, bottom actions.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { PlatformProvider, usePlatform } from "./context/PlatformContext.jsx";
import { LinksProvider } from "./context/LinksContext.jsx";
import { injectAnimations, ANIM, TRANSITION } from "./design/animations.js";
import { S } from "./design/styles.js";
import { C } from "./design/tokens.js";

import SetupWizard from "./core/SetupWizard.jsx";
import TopHeader from "./core/TopHeader.jsx";
import Navigation from "./core/Navigation.jsx";
import WasabiPanel from "./core/WasabiPanel.jsx";
import Onboarding from "./core/Onboarding.jsx";
import PageBuilder from "./core/PageBuilder.jsx";
import PageShell from "./core/PageShell.jsx";
import WasabiFlame from "./core/WasabiFlame.jsx";
import WasabiOrb from "./core/WasabiOrb.jsx";
import SystemManager from "./core/SystemManager.jsx";
import AutomationPage from "./core/AutomationPage.jsx";
import HomePage from "./core/HomePage.jsx";
import Dashboard from "./core/Dashboard.jsx";
import { ErrorBoundary } from "./core/ErrorBoundary.jsx";
import { createAutomationEngine } from "./agent/automations.js";
import { useKeyboardShortcuts } from "./utils/useKeyboardShortcuts.js";
import CommandPalette from "./core/CommandPalette.jsx";
import { IconGear } from "./design/icons.jsx";

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
  } = usePlatform();

  // ── UI State ──
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [wasabiPanelOpen, setWasabiPanelOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [viewStates, setViewStates] = useState({}); // { [pageId]: activeViewIndex }
  const [builderTemplate, setBuilderTemplate] = useState(null);
  const [pageControls, setPageControls] = useState(null); // lifted from PageShell for TopHeader

  // ── Clear page controls when navigating away ──
  const prevActivePage = useRef(activePage);
  useEffect(() => {
    if (prevActivePage.current !== activePage) {
      setPageControls(null);
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
      tickIntervalMs: 60_000,
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
      shortcut: "mod+w",
      description: "Toggle Wasabi panel",
      handler: () => setWasabiPanelOpen((o) => !o),
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
  ], [handleAddPage, wasabiPanelOpen, activePage, pages, activeFolder, getFolderPages]);

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
    // Wasabi page builder
    if (activePage === "wasabi") {
      return (
        <PageBuilder
          initialTemplate={builderTemplate}
          WasabiFlameIcon={WasabiFlameIcon}
        />
      );
    }

    // Global dashboard
    if (activePage === "dashboard" && globalDashboard) {
      return (
        <Dashboard
          dashboardConfig={globalDashboard}
          isGlobal
        />
      );
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

    // System manager
    if (activePage === "system") {
      return <SystemManager />;
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
          onRegisterControls={setPageControls}
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
      <TopHeader pageControls={pageControls} />

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
            <WasabiPanel
              onClose={() => setWasabiPanelOpen(false)}
              isThinking={false}
              activePageConfig={activePageConfig}
            />
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
              background: `linear-gradient(180deg, ${C.edgeLine}00 0%, ${C.edgeLine} 30%, ${C.accent}44 60%, ${C.edgeLine} 85%, ${C.edgeLine}00 100%)`,
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
    <PlatformProvider>
      <LinksProvider>
        <ErrorBoundary fallbackLabel="Wasabi Platform">
          <AppContent />
        </ErrorBoundary>
      </LinksProvider>
    </PlatformProvider>
  );
}
