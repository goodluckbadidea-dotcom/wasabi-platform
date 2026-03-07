// ─── Wasabi Platform App Shell ───
// Root component: auth gate → layout → routing.
// Layout: TopHeader + [WasabiPanel | Sidebar | Content]
// Matches original app: top header with page dropdown, left sidebar with sub-nav,
// collapsible Wasabi panel (Log/Chat/Notifications), flame at sidebar bottom.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { PlatformProvider, usePlatform } from "./context/PlatformContext.jsx";
import { LinksProvider } from "./context/LinksContext.jsx";
import { injectAnimations } from "./design/animations.js";
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
    activeSubPage,
    setActiveSubPage,
    getFolderPages,
  } = usePlatform();

  // ── UI State ──
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [wasabiPanelOpen, setWasabiPanelOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [viewStates, setViewStates] = useState({}); // { [pageId]: activeViewIndex }
  const [builderTemplate, setBuilderTemplate] = useState(null);

  // ── Automation Engine ──
  const engineRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated || !isSetup || !user || !platformIds?.rulesDbId) return;

    // Create and start the automation engine
    const engine = createAutomationEngine({
      workerUrl: user.workerUrl,
      notionKey: user.notionKey,
      claudeKey: user.claudeKey,
      rulesDbId: platformIds.rulesDbId,
      notifDbId: platformIds.notifDbId,
      kbDbId: platformIds.kbDbId,
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
  }, [isAuthenticated, isSetup, user, platformIds]);

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
        const folderPages = activeFolder ? getFolderPages(activeFolder) : pages.filter((p) => p.type !== "folder" && p.type !== "sub_page");
        const idx = folderPages.findIndex((p) => p.id === activePage);
        if (idx > 0) setActivePage(folderPages[idx - 1].id);
      },
    },
    {
      shortcut: "mod+down",
      description: "Next page",
      handler: () => {
        const folderPages = activeFolder ? getFolderPages(activeFolder) : pages.filter((p) => p.type !== "folder" && p.type !== "sub_page");
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

  // Get/set active view for current page, sub-page, or automations pseudo-page
  const viewKey = activeSubPage || (activePageConfig ? activePageConfig.id : null);
  const activeViewIndex = activePageConfig
    ? viewStates[viewKey] ?? 0
    : activePage === "automations"
    ? viewStates["automations"] ?? 0
    : 0;

  const setActiveView = (idx) => {
    if (activePageConfig) {
      const key = activeSubPage || activePageConfig.id;
      setViewStates((prev) => ({ ...prev, [key]: idx }));
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
          onAddSubPage={() => handleAddPage()}
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
      <TopHeader onAddPage={handleAddPage} />

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
          <WasabiPanel
            onClose={() => setWasabiPanelOpen(false)}
            isThinking={false}
          />
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
              transition: "left 0.25s cubic-bezier(0.4,0,0.2,1)",
            }}
          />
        )}

        {/* Left Sidebar */}
        <Navigation
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          wasabiPanelOpen={wasabiPanelOpen}
          onToggleWasabiPanel={() => setWasabiPanelOpen((o) => !o)}
          isThinking={false}
          onCreatePage={handleAddPage}
        />

        {/* Main Content */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 0,
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
